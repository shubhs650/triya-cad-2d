// M3-12 part 6: COMMANDPREVIEW (AutoCAD 2024 Help, "COMMANDPREVIEW (System Variable)": "a preview
// of the possible outcome of certain commands") and TRIM's freehand fence ("click and drag to
// start a freehand selection path"), from the app's canvas. TRIM's pick prompt fades the part of
// the line under the cursor that a click would trim, FILLET shows the arc as the cursor hovers
// over the second line, OFFSET shows the copy on the cursor's side, and COMMANDPREVIEW 0 shows
// none. A press on nothing dragged across a line trims it there. What each command previews is
// unit-tested in packages/engine (commands/command-preview.test.ts), and the renderer's fading in
// packages/render (drag.test.ts).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

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

/** A 1 px line drawn in white on the dark canvas, antialiased, is brighter than this … */
const DRAWN = 110;
/** … and a canvas with nothing drawn darker than this. */
const DARK = 50;

/** The brightest grey level (0–255) in a small square of the page around a point. */
async function bright(page: Page, p: { x: number; y: number }, r = 3): Promise<number> {
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
    let most = 0;
    for (let i = 0; i < d.length; i += 4)
      most = Math.max(most, (d[i]! + d[i + 1]! + d[i + 2]!) / 3);
    return most;
  }, png.toString('base64'));
}

/** An empty part of the plan, 160 × 100 units from (1000000, 1000000), with `lines` drawn. */
async function setup(page: Page, lines: [number, number, number, number][]) {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const [x1, y1, x2, y2] of lines) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `${1000000 + x1},${1000000 + y1}`, 'Specify next point or [Undo]:');
    await type(page, `${1000000 + x2},${1000000 + y2}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  const view = await viewOf(page);
  /** The page point at plan (1000000 + x, 1000000 + y). */
  const at = (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  // Away from the lines and from the navigation bar's menu at the top right.
  const off = at(140, 4);
  return { at, off };
}

test('TRIM fades what a pick would trim, and a freehand fence trims what it crosses', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A line across two verticals.
  const { at, off } = await setup(page, [
    [40, 50, 120, 50],
    [60, 20, 60, 80],
    [100, 20, 100, 80],
  ]);
  await page.mouse.move(off.x, off.y);
  const full = await bright(page, at(80, 50));
  expect(full).toBeGreaterThan(DRAWN);

  await type(page, 'TR', /^Select object to trim/);
  // Over the line between the verticals: that part fades, the rest of the line does not.
  const over = at(84, 50);
  await page.mouse.move(over.x, over.y, { steps: 4 });
  await expect.poll(() => bright(page, at(75, 50))).toBeLessThan(full * 0.6);
  expect(await bright(page, at(50, 50))).toBeGreaterThan(DRAWN);
  expect(await bright(page, at(110, 50))).toBeGreaterThan(DRAWN);
  await shot(page, '1-trim-preview');
  // Off the line, the preview goes.
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await expect.poll(() => bright(page, at(75, 50))).toBeGreaterThan(DRAWN);

  // A press on nothing dragged across the vertical at x = 60 above the line, let go: its upper
  // half is trimmed.
  const a = at(50, 70);
  const b = at(70, 66);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y - 10, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await shot(page, '2-freehand-fence');
  await page.mouse.up();
  await page.mouse.move(off.x, off.y);
  await expect.poll(() => bright(page, at(60, 72))).toBeLessThan(DARK);
  expect(await bright(page, at(60, 35))).toBeGreaterThan(DRAWN);
  await expect(prompt(page)).toHaveText(/^Select object to trim/);
  await shot(page, '3-freehand-trimmed');
  await type(page, '', 'Command:');
});

test('FILLET shows the fillet over the second line, OFFSET the copy; COMMANDPREVIEW 0 none', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { at, off } = await setup(page, [
    [20, 10, 70, 10],
    [80, 20, 80, 90],
  ]);
  const canvas = activeCanvas(page);
  await expect(canvas).toBeVisible();
  // The fillet arc of radius 10 passes (77.07, 12.93), where nothing is drawn yet.
  const arc = at(77.07, 12.93);
  await page.mouse.move(off.x, off.y);
  expect(await bright(page, arc, 2)).toBeLessThan(DARK);

  await type(page, 'F', /^Select first object/);
  await type(page, 'R', /^Specify fillet radius/);
  await type(page, '10', /^Select first object/);
  const first = at(40, 10);
  await page.mouse.click(first.x, first.y);
  await expect(prompt(page)).toHaveText(/^Select second object/);
  const second = at(80, 60);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await expect.poll(() => bright(page, arc, 2)).toBeGreaterThan(DRAWN);
  await shot(page, '4-fillet-preview');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(off.x, off.y, { steps: 2 });
  await expect.poll(() => bright(page, arc, 2)).toBeLessThan(DARK);

  // OFFSET 15: the copy of the horizontal line shows 15 above it on the cursor's side.
  await type(page, 'O', /^Specify offset distance/);
  await type(page, '15', /^Select object to offset/);
  await page.mouse.click(first.x, first.y);
  await expect(prompt(page)).toHaveText(/^Specify point on side to offset/);
  const above = at(45, 40);
  await page.mouse.move(above.x, above.y, { steps: 4 });
  await expect.poll(() => bright(page, at(30, 25))).toBeGreaterThan(DRAWN);
  await shot(page, '5-offset-preview');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // COMMANDPREVIEW 0: no preview.
  await type(page, 'COMMANDPREVIEW', /^Enter new value for COMMANDPREVIEW <1>/);
  await type(page, '0', 'Command:');
  await type(page, 'O', /^Specify offset distance/);
  await type(page, '', /^Select object to offset/);
  await page.mouse.click(first.x, first.y);
  await expect(prompt(page)).toHaveText(/^Specify point on side to offset/);
  await page.mouse.move(off.x, off.y, { steps: 2 });
  await page.mouse.move(above.x, above.y, { steps: 4 });
  await page.waitForTimeout(500);
  expect(await bright(page, at(30, 25))).toBeLessThan(DARK);
  await page.keyboard.press('Escape');
});
