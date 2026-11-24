// M9-03 part 11: a selected dimensional constraint's grips, and its text edited by a double
// click. On an empty part of the plan a line 60 long gets a DCALIGNED constraint, its dimension
// line 14 units above. A click on the dimension line selects it, showing triangles at the
// dimension line's ends and a square at its text. The triangle at the line's end, clicked and
// placed 10 further on, makes the value 70 (the end moves); the one at its start, placed 10
// before it, 80 (the start moves, the end stays). The square moves the dimension line up, and U
// puts it back. A double click on the constraint asks for its text, `d1=80` shown; `len=75`
// renames the parameter and sets the value. What a grip sets and the prompts are tested in
// packages/engine/test/commands/constraint-grips.test.ts and the drawing of the grips in
// packages/render/test/canvas2d-constraints.test.ts; this checks the canvas, the worker and
// the palette together.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DOCKED_PALETTES,
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

test.use({ viewport: DOCKED_PALETTES });

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types at the command line (taking the focus back from the palette) and waits for `next`. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  await page.locator('#command-input').click();
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Pixels of the dynamic constraints' blue on the dark canvas (and the selection's) in the
 * CSS-pixel rectangle between `a` and `b` of the active canvas.
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

test('a selected constraint is edited by its grips and by a double click', async ({ page }) => {
  test.setTimeout(180_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string, park = true) => {
    if (park) await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // The palette docked first: it narrows the canvas the clicks below are worked out on.
  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000040,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000100,1000020', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const screen = (x: number, y: number) => {
    const p = at(x, y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  const click = async (x: number, y: number) => {
    const p = screen(x, y);
    await page.mouse.click(p.x, p.y);
  };
  /** The band of the dimension line at height `y`, between the extension lines. */
  const band = (y: number) => bluePixels(page, at(45, y - 4), at(95, y + 4));

  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(70, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(70, 34);
  await expect(prompt(page)).toHaveText(/^Dimension text <d1=60.0000>:/);
  await type(page, '', 'Command:');
  await expect.poll(() => band(34), { timeout: 15_000 }).toBeGreaterThan(100);

  // A click on its dimension line, clear of the text, selects it and shows its grips.
  await click(50, 34);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  const constraint = palette.getByRole('table', { name: 'Constraint' });
  const value = constraint.getByLabel('Value', { exact: true });
  const name = constraint.getByRole('textbox', { name: 'Name' });
  await expect(value).toHaveText(/^60\.0+$/);
  await shot('1-grips.png');

  // The triangle at the end: hot, then placed 10 further on (and 5 off the line, which does
  // not count): 70, the end moved. The points are typed, as a click falls between units.
  await click(100, 34);
  await expect(prompt(page)).toHaveText('Specify stretch point or [eXit]:');
  const placed = screen(110, 39);
  await page.mouse.move(placed.x, placed.y, { steps: 4 });
  await shot('2-triangle-hot.png', false);
  await type(page, '1000110,1000039', 'Command:');
  await expect(value).toHaveText(/^70\.0+$/);
  await expect(constraint.getByRole('textbox', { name: 'Expression' })).toHaveValue('70');

  // The triangle at the start, placed 10 before it: 80, the end where it was.
  await click(40, 34);
  await expect(prompt(page)).toHaveText('Specify stretch point or [eXit]:');
  await type(page, '1000030,1000034', 'Command:');
  await expect(value).toHaveText(/^80\.0+$/);
  await shot('3-value-set-from-start.png');
  // Its triangles now at x 30 and 110: the end's still there, so the end did not move.
  await click(110, 34);
  await expect(prompt(page)).toHaveText('Specify stretch point or [eXit]:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // The square at the text, (70, 34), moved up 20: the dimension line follows; U puts it back.
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  await click(70, 34);
  await expect(prompt(page)).toHaveText('Specify stretch point or [eXit]:');
  await type(page, '1000070,1000054', 'Command:');
  await expect.poll(() => band(54)).toBeGreaterThan(100);
  expect(await band(34)).toBe(0);
  await shot('4-text-moved.png');
  await type(page, 'U', 'Command:');
  await expect.poll(() => band(34)).toBeGreaterThan(100);
  expect(await band(54)).toBe(0);

  // A double click on it asks for its text; a new name and value both apply.
  await page.keyboard.press('Escape');
  await expect(objects).toHaveText('No selection');
  const on = screen(50, 34);
  await page.mouse.dblclick(on.x, on.y);
  await expect(prompt(page)).toHaveText('Dimension text <d1=80>:');
  await shot('5-double-click.png', false);
  await page.keyboard.type('len=75');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  await expect(name).toHaveValue('len');
  await expect(value).toHaveText(/^75\.0+$/);
  await shot('6-renamed-and-set.png');
});
