// M9-05 part 6: constraint bars are dragged. Two lines on an empty part of the plan are made
// parallel: each line's bar holds a Parallel icon under its middle. Pressing on the lower bar and
// dragging moves it (AutoCAD 2024 Help, "About Displaying and Verifying Geometric Constraints");
// a click on it without a drag leaves it where it is; it keeps its place beside the line when
// the line moves; CONSTRAINTBAR Reset puts it back under the line's middle ("resets them to their
// default locations"). Where a dragged bar is laid out is tested in
// packages/render/test/canvas2d-constraint-bars.test.ts, the display state in
// apps/web/test/constraint-bars.test.ts, Reset's request in
// packages/engine/test/commands/constraint-bar.test.ts; this checks the canvas.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Pixels of the constraints' and the selection's blue on the dark canvas in the CSS-pixel
 * rectangle between `a` and `b` of the active canvas.
 */
async function bluePixels(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
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
        if (d[i + 2]! > 150 && d[i + 2]! - d[i]! > 70 && d[i + 1]! > d[i]!) n++;
      }
      return n;
    },
    {
      b64: png,
      x0: Math.round(Math.min(a.x, b.x)),
      y0: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y)),
    },
  );
}

test('a constraint bar is dragged, stays beside its line and is put back by Reset', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) =>
    page.screenshot({ path: shots ? path.join(shots, name) : test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and two lines 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [20, 60]) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `1000020,${1000000 + y}`, 'Specify next point or [Undo]:');
    await type(page, `1000080,${1000000 + y}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const client = (p: { x: number; y: number }) => ({ x: view.box.x + p.x, y: view.box.y + p.y });
  const click = async (x: number, y: number) => {
    const p = client(at(x, y));
    await page.mouse.click(p.x, p.y);
  };
  /** The band under the line at `y`'s middle, `dx`, `dy` screen pixels off, where its bar sits. */
  const band = (y: number, dx = 0, dy = 0) => {
    const p = at(50, y);
    return bluePixels(
      page,
      { x: p.x + dx - 30, y: p.y + dy + 3 },
      { x: p.x + dx + 30, y: p.y + dy + 32 },
    );
  };
  /** The upper line itself, left of its bar: blue only while highlighted. */
  const upperLine = () => {
    const a = at(25, 60);
    const b = at(40, 60);
    return bluePixels(page, { x: a.x, y: a.y - 4 }, { x: b.x, y: b.y + 4 });
  };
  /**
   * The bar's one icon under the line at `y`, `dx`, `dy` off, in client pixels: the bar sits 6 px
   * under the line's middle, 20 px high, its 16 px icon (CONSTRAINT_BAR_PX).
   */
  const icon = (y: number, dx = 0, dy = 0) => {
    const p = at(50, y);
    return client({ x: p.x + dx, y: p.y + 16 + dy });
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);

  await type(page, 'GCPARALLEL', 'Select first object:');
  await click(50, 20);
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await park();
  await expect.poll(() => band(20), { timeout: 15_000 }).toBeGreaterThan(10);
  await expect.poll(() => band(60)).toBeGreaterThan(10);
  await shot('1-bars-laid-out.png');

  // Pressed on the lower bar's icon (resting there first, as a drafter's cursor does) and
  // dragged 150 px right, 40 px down: the bar goes with the pointer.
  const from = icon(20);
  await page.mouse.move(from.x, from.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 15 * i, from.y + 4 * i);
  await expect.poll(() => band(20, 150, 40)).toBeGreaterThan(10);
  await shot('2-bar-dragged.png');
  await page.mouse.up();
  await park();
  await expect.poll(() => band(20)).toBe(0);
  expect(await band(20, 150, 40)).toBeGreaterThan(10);
  // The upper bar stays.
  expect(await band(60)).toBeGreaterThan(10);
  expect(await prompt(page).textContent()).toBe('Command:');
  await shot('3-bar-dropped.png');

  // A click on the dragged bar does not move it; it picks there as any click does (nothing
  // under it, so a selection window begins, which Esc ends).
  const moved = icon(20, 150, 40);
  await page.mouse.move(moved.x, moved.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.click(moved.x, moved.y);
  await page.keyboard.press('Escape');
  await park();
  await expect(prompt(page)).toHaveText('Command:');
  expect(await band(20, 150, 40)).toBeGreaterThan(10);
  expect(await band(20)).toBe(0);

  // MOVE the lower line 10 units down: its bar keeps its place beside it.
  await type(page, 'MOVE', 'Select objects:');
  await click(30, 20);
  await type(page, '', /^Specify base point/);
  await type(page, '0,0', /^Specify second point/);
  await type(page, '0,-10', 'Command:');
  await park();
  const tenUnits = at(0, 10).y - at(0, 20).y;
  await expect.poll(() => band(20, 150, 40 + tenUnits)).toBeGreaterThan(10);
  expect(await band(20, 150, 40)).toBe(0);

  // CONSTRAINTBAR Reset puts it back under the line's middle.
  await type(page, 'CONSTRAINTBAR', 'Select objects or [Showall/Hideall]:');
  await click(30, 10);
  await type(page, '', 'Enter an option [Show/Hide/Reset] <Show>:');
  await type(page, 'R', 'Command:');
  await park();
  await expect.poll(() => band(10)).toBeGreaterThan(10);
  expect(await band(20, 150, 40 + tenUnits)).toBe(0);
  await shot('4-bar-reset.png');
});
