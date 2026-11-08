// Helpers the app specs share: open a drawing through each route, and measure what the
// canvas shows from a screenshot (the canvas belongs to the render worker, so its pixels cannot
// be read back in the page; the screenshot sees the composited result either way).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { CORPUS } from './server';

export const DXF = path.join(CORPUS, 'ezdxf/examples_dxf/clockwise_arcs_hatch.dxf');
export const DWG = path.join(CORPUS, 'acadsharp/sample_AC1018.dwg');

/** The canvas of the document tab that is showing. */
export const activeCanvas = (page: Page): Locator => page.locator('canvas[data-active="true"]');

/** Opens a file through the Open button's file picker. */
export async function openWithPicker(page: Page, file: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooser).setFiles(file);
}

/** Serves `file` to the page at a test-only URL, so its bytes need not pass through evaluate. */
export async function serve(page: Page, file: string): Promise<string> {
  const url = `/__test__/${path.basename(file)}`;
  await page.route(`**${url}`, (route) =>
    route.fulfill({ body: readFileSync(file), contentType: 'application/octet-stream' }),
  );
  return url;
}

/** Drops a file, or several at once, on the app window, as dragging them from the desktop does. */
export async function openWithDrop(page: Page, file: string | readonly string[]): Promise<void> {
  const files = typeof file === 'string' ? [file] : file;
  const sources = [];
  for (const f of files) sources.push({ url: await serve(page, f), name: path.basename(f) });
  const data = await page.evaluateHandle(async (sources) => {
    const dt = new DataTransfer();
    for (const { url, name } of sources) {
      const bytes = await (await fetch(url)).arrayBuffer();
      dt.items.add(new File([bytes], name));
    }
    return dt;
  }, sources);
  const target = page.getByTestId('app');
  await target.dispatchEvent('dragenter', { dataTransfer: data });
  await target.dispatchEvent('dragover', { dataTransfer: data });
  await target.dispatchEvent('drop', { dataTransfer: data });
}

/** Non-background pixels of the visible canvas. */
export async function ink(page: Page): Promise<number> {
  return canvasInk(page, false);
}

/**
 * How strongly the canvas is inked: the summed RGB distance of every pixel from the dark
 * canvas colour. A faded object (M1-69) counts for less while covering the same pixels.
 */
export async function inkWeight(page: Page): Promise<number> {
  return canvasInk(page, true);
}

/** Non-background pixels of any element, against the dark model canvas colour. */
export async function inkOf(page: Page, target: Locator): Promise<number> {
  return canvasInk(page, false, target);
}

async function canvasInk(
  page: Page,
  weighted: boolean,
  target: Locator = activeCanvas(page),
): Promise<number> {
  const png = (await target.screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, weighted }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // The dark model canvas, #212830 (UI_SPEC.md §6).
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const off =
          Math.abs(d[i]! - 0x21) + Math.abs(d[i + 1]! - 0x28) + Math.abs(d[i + 2]! - 0x30);
        if (weighted) n += off;
        else if (off > 24) n++;
      }
      return n;
    },
    { b64: png, weighted },
  );
}

/** Waits until the tab for `name` is selected and its drawing is on the canvas. */
export async function expectShown(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab', { name });
  await expect(tab).toHaveAttribute('aria-selected', 'true', {
    timeout: 30_000,
  });
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(200);
}

/** The world point the status bar shows for the cursor at canvas point (x, y). */
export async function worldAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  const coords = page.getByTestId('coords');
  await expect(coords).not.toHaveText('');
  const [wx, wy] = (await coords.textContent())!.split(',').map((s) => Number(s.trim()));
  return { x: wx!, y: wy! };
}

/** Pixels of the visible canvas close to white: a layout's paper. */
export async function paperPixels(page: Page): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 245 && d[i + 1]! > 245 && d[i + 2]! > 245) n++;
    return n;
  }, png);
}

/** Screen ↔ world on the active canvas, from the status bar's cursor coordinates. */
export async function viewOf(page: Page) {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const r = await worldAt(page, cx + 100, cy);
  const unit = (r.x - c.x) / 100;
  return {
    box,
    /** CSS pixel of the canvas at world (x, y). */
    at: (x: number, y: number) => ({ x: cx + (x - c.x) / unit, y: cy - (y - c.y) / unit }),
  };
}

/** The canvas's colour at CSS pixel (x, y), from a screenshot (the worker's canvas cannot be read). */
export async function colourAt(page: Page, p: { x: number; y: number }): Promise<number[]> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, x, y }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // The screenshot is in CSS pixels (scale factor 1).
      return [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    },
    { b64: png, ...p },
  );
}

/**
 * Neutral light pixels (each channel over 120, within 30 of each other) in the CSS-pixel
 * rectangle of the active canvas between corners `a` and `b`: white text and linework on the
 * dark canvas, which coloured images and their blends never are (M1-109).
 */
export async function lightPixels(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  const x0 = Math.round(Math.min(a.x, b.x));
  const y0 = Math.round(Math.min(a.y, b.y));
  const w = Math.round(Math.abs(b.x - a.x));
  const h = Math.round(Math.abs(b.y - a.y));
  return page.evaluate(
    async ({ b64, x0, y0, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]!;
        const g = d[i + 1]!;
        const b = d[i + 2]!;
        if (Math.min(r, g, b) > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 30) n++;
      }
      return n;
    },
    { b64: png, x0, y0, w, h },
  );
}
