// M1-22: the app shell. A drawing opens through each route (file picker, drag and drop, the
// installed app's file handler), shows on the dark model canvas in a document tab, and the
// canvas zooms at the cursor with the wheel, pans with a middle-button drag and zooms to the
// extents on a middle-button double click, as AutoCAD does. The status bar's coordinates are
// how the test reads the view, through the UI a drafter sees.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  DXF,
  activeCanvas,
  expectShown,
  openWithDrop,
  openWithPicker,
  serve,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DXF_NAME = path.basename(DXF);
const DWG_NAME = path.basename(DWG);

/** The world point the status bar shows for the cursor at canvas point (x, y). */
async function worldAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  const coords = page.getByTestId('coords');
  await expect(coords).not.toHaveText('');
  const [wx, wy] = (await coords.textContent())!.split(',').map((s) => Number(s.trim()));
  return { x: wx!, y: wy! };
}

test.describe('app shell', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens a DXF from the file picker', async ({ page }) => {
    await page.goto(app.url);
    await openWithPicker(page, DXF);
    await expectShown(page, DXF_NAME);
    await expect(page.getByTestId('space')).toHaveText('MODEL');
  });

  test('opens a DWG dropped on the window', async ({ page }) => {
    await page.goto(app.url);
    await openWithDrop(page, DWG);
    await expectShown(page, DWG_NAME);
  });

  test('opens a file the installed app was launched with', async ({ page }) => {
    // The browser delivers a launch through window.launchQueue; this stands in for the OS.
    await page.addInitScript(() => {
      // Chromium has a native, read-only window.launchQueue, so define over it.
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        value: {
          setConsumer(c: unknown) {
            (window as unknown as Record<string, unknown>)['__launchConsumer'] = c;
          },
        },
      });
    });
    await page.goto(app.url);
    // The browser holds launches until the app sets its consumer, on start-up.
    await page.waitForFunction(() => '__launchConsumer' in window);
    const url = await serve(page, DXF);
    await page.evaluate(
      async ({ url, name }) => {
        const file = new File([await (await fetch(url)).arrayBuffer()], name);
        const consume = (window as unknown as Record<string, unknown>)['__launchConsumer'] as (
          p: unknown,
        ) => void;
        consume({ files: [{ kind: 'file', name, getFile: async () => file }] });
      },
      { url, name: DXF_NAME },
    );
    await expectShown(page, DXF_NAME);
  });

  test('keeps one tab per document and closes them', async ({ page }) => {
    await page.goto(app.url);
    await openWithPicker(page, DXF);
    await expectShown(page, DXF_NAME);
    await openWithPicker(page, DWG);
    await expectShown(page, DWG_NAME);
    await expect(page.getByRole('tab')).toHaveCount(2);

    await page.getByRole('tab', { name: DXF_NAME, exact: true }).click();
    await expectShown(page, DXF_NAME);

    await page.getByRole('button', { name: `Close ${DXF_NAME}` }).click();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expectShown(page, DWG_NAME);
    await page.getByRole('button', { name: `Close ${DWG_NAME}` }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('start')).toBeVisible();
  });

  test('zooms at the cursor, pans with the middle button and zooms to extents', async ({
    page,
  }) => {
    await page.goto(app.url);
    await openWithPicker(page, DXF);
    await expectShown(page, DXF_NAME);
    const box = (await activeCanvas(page).boundingBox())!;
    const cx = Math.round(box.width / 2);
    const cy = Math.round(box.height / 2);
    const startCentre = await worldAt(page, cx, cy);

    // Wheel forward one notch: the point under the cursor stays, everything else closes in.
    const at = { x: cx - 120, y: cy + 60 };
    const p0 = await worldAt(page, at.x, at.y);
    const q0 = await worldAt(page, at.x + 100, at.y);
    await page.mouse.move(box.x + at.x, box.y + at.y);
    await page.mouse.wheel(0, -100);
    const p1 = await worldAt(page, at.x, at.y);
    const q1 = await worldAt(page, at.x + 100, at.y);
    const unit = Math.abs(q0.x - p0.x) / 100;
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(2 * unit);
    expect(Math.abs(p1.y - p0.y)).toBeLessThan(2 * unit);
    expect((q1.x - p1.x) / (q0.x - p0.x)).toBeCloseTo(1 / 1.25, 1);

    // Middle-button drag: the point grabbed follows the pointer.
    const grab = await worldAt(page, cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + cx + 80, box.y + cy + 40, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    const moved = await worldAt(page, cx + 80, cy + 40);
    const unit1 = Math.abs(q1.x - p1.x) / 100;
    expect(Math.abs(moved.x - grab.x)).toBeLessThan(2 * unit1);
    expect(Math.abs(moved.y - grab.y)).toBeLessThan(2 * unit1);

    // Middle-button double click: back to the extents view the drawing opened in.
    await page.mouse.move(box.x + cx, box.y + cy);
    for (let i = 0; i < 2; i++) {
      await page.mouse.down({ button: 'middle' });
      await page.mouse.up({ button: 'middle' });
    }
    const back = await worldAt(page, cx, cy);
    expect(Math.abs(back.x - startCentre.x)).toBeLessThan(2 * unit);
    expect(Math.abs(back.y - startCentre.y)).toBeLessThan(2 * unit);
  });

  test('reports a file it cannot read and keeps working', async ({ page }) => {
    await page.goto(app.url);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: 'broken.dwg', mimeType: 'application/octet-stream', buffer: brokenDwg() });
    await expect(page.getByRole('alert')).toContainText('broken.dwg');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await openWithPicker(page, DXF);
    await expectShown(page, DXF_NAME);
  });

  test('has the OET home and Report issue links in the title bar', async ({ page }) => {
    await page.goto(app.url);
    await expect(page.getByRole('link', { name: 'Open Engineering Tools home' })).toHaveAttribute(
      'href',
      'https://openengtools.com/',
    );
    await expect(page.getByRole('link', { name: 'Report issue' })).toHaveAttribute(
      'href',
      'https://github.com/shubhs650/triya-cad-2d/issues/new',
    );
  });
});

/** A DWG header with nothing after it: the reader rejects it. */
function brokenDwg(): Buffer {
  const head = readFileSync(DWG).subarray(0, 6);
  return Buffer.concat([head, Buffer.alloc(64)]);
}
