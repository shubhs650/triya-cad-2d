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

/** Drops a file on the app window, as dragging it from the desktop does. */
export async function openWithDrop(page: Page, file: string): Promise<void> {
  const url = await serve(page, file);
  const data = await page.evaluateHandle(
    async ({ url, name }) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name));
      return dt;
    },
    { url, name: path.basename(file) },
  );
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

async function canvasInk(page: Page, weighted: boolean): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
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
