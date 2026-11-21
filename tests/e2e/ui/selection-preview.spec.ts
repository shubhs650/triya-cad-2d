// M3-04 part 5: the selection preview, as AutoCAD 2024 shows it (AutoCAD Help, "SELECTIONPREVIEW
// (System Variable)": "objects are highlighted when the pickbox cursor rolls over them"). At
// `Command:` (bit 1) and at a command's "Select objects" (bit 2) the line under the cursor lights
// up in the selection colour and goes dark again when the cursor moves off; SELECTIONPREVIEW 2
// previews only inside commands, 0 nowhere. Which objects PREVIEWFILTER leaves out is
// unit-tested (packages/engine/test/commands/selection-preview.test.ts), as is the renderer's
// drawing (packages/render/test/select.test.ts).
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Pixels in the selection colour (#4DA3FF and its glow) in a square of the page around a point. */
async function lit(page: Page, p: { x: number; y: number }, r = 8): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (B > 150 && B - R > 80 && G > R) n++;
    }
    return n;
  }, png.toString('base64'));
}

test('lights up the line under the pickbox at Command: and at Select objects', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across it.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000040,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000120,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const box = (await canvas.boundingBox())!;
  const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const off = { x: on.x, y: on.y - box.height / 4 };
  // Along the line, away from the cursor: the whole line lights up, not only where it is. 20
  // units left of the centre, at the scale ZOOM W gives the 160 × 100 window in this canvas.
  const scale = Math.min(box.width / 160, box.height / 100);
  const along = { x: on.x - 20 * scale, y: on.y };

  await page.mouse.move(off.x, off.y);
  await shot(page, '1-before-hover');
  expect(await lit(page, along)).toBe(0);

  // SELECTIONPREVIEW 3 (initially): at Command: the line lights up, and goes dark off it.
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await expect.poll(() => lit(page, along)).toBeGreaterThan(10);
  await shot(page, '2-hover-at-command');
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await expect.poll(() => lit(page, along)).toBe(0);

  // At ERASE's "Select objects" too; the line picked is selected (dashed), and Enter erases it.
  await type(page, 'ERASE', 'Select objects:');
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await expect.poll(() => lit(page, along)).toBeGreaterThan(10);
  await shot(page, '3-hover-at-select-objects');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // SELECTIONPREVIEW 2: not at Command:, still at "Select objects".
  await type(page, 'SELECTIONPREVIEW', 'Enter new value for SELECTIONPREVIEW <3>:');
  await type(page, '2', 'Command:');
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await page.mouse.move(on.x, on.y, { steps: 4 });
  // The preview would show within a frame or two; give it a moment before saying it did not.
  await page.waitForTimeout(300);
  expect(await lit(page, along)).toBe(0);
  await type(page, 'ERASE', 'Select objects:');
  await page.mouse.move(on.x + 3, on.y, { steps: 2 });
  await expect.poll(() => lit(page, along)).toBeGreaterThan(10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // 0: nowhere.
  await type(page, 'SELECTIONPREVIEW', 'Enter new value for SELECTIONPREVIEW <2>:');
  await type(page, '0', 'Command:');
  await type(page, 'ERASE', 'Select objects:');
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await page.waitForTimeout(300);
  expect(await lit(page, along)).toBe(0);
  await page.keyboard.press('Escape');
});
