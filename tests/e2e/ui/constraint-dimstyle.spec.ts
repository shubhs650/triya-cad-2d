// M9-03 part 15 (DEC-088): an annotational dimensional constraint's dimension style and the
// DIMVAR rows it is drawn with, in the Properties palette. On an empty part of the plan a line
// gets a DCALIGNED constraint with CCONSTRAINTFORM 1 (annotational). A click on its dimension
// line selects it: the palette shows Misc (Dim style, the drawing's current style), Lines &
// Arrows (Arrow size, Ext line ext, Ext line offset), Text (Text height, Text offset) and Fit
// (Dim scale overall) beside its Constraint rows. Dim scale overall 2 draws it bigger, Arrow
// size and Text height take new values, U puts the scale back, and Constraint Form Dynamic
// takes the rows away. The rows and edits are tested in
// packages/engine/test/commands/constraint-dimstyle.test.ts, the sizes in
// packages/render/test/canvas2d-constraints.test.ts and the record in
// packages/io/test/export-dimensional-constraints.test.ts; this checks the canvas, the worker
// and the palette.
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
 * Pixels lighter than the dark canvas's grey in the CSS-pixel rectangle between `a` and `b` of
 * the active canvas: an annotational constraint is drawn in the foreground (white), selected
 * with the selection's light blue.
 */
async function lightPixels(
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
      for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 360) n++;
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

test("an annotational constraint's dimension style and sizes are set in Properties", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
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
  await type(page, '1000020,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000080,1000020', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The band above the line, where its constraint is drawn (the line itself left out). */
  const band = () => lightPixels(page, at(5, 22), at(95, 60));

  await type(page, 'CCONSTRAINTFORM', /^Enter new value for CCONSTRAINTFORM/);
  await type(page, '1', 'Command:');
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 34);
  await expect(prompt(page)).toHaveText(/^Dimension text <d1=60.0000>:/);
  await type(page, '', 'Command:');
  await expect.poll(band, { timeout: 15_000 }).toBeGreaterThan(40);

  // A click on the dimension line, clear of its text, selects it.
  await click(30, 34);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  const constraint = palette.getByRole('table', { name: 'Constraint' });
  await expect(constraint.getByRole('combobox', { name: 'Constraint Form' })).toHaveValue(
    'annotational',
  );
  const misc = palette.getByRole('table', { name: 'Misc' });
  const lines = palette.getByRole('table', { name: 'Lines & Arrows' });
  const text = palette.getByRole('table', { name: 'Text', exact: true });
  const fit = palette.getByRole('table', { name: 'Fit' });
  const style = misc.getByRole('combobox', { name: 'Dim style' });
  await expect(style).toBeVisible();
  // The drawing's current style, which the constraint took as it was made.
  expect(await style.locator('option:checked').textContent()).toMatch(/\S/);
  for (const label of ['Arrow size', 'Ext line ext', 'Ext line offset']) {
    await expect(lines.getByRole('textbox', { name: label })).toBeVisible();
  }
  for (const label of ['Text height', 'Text offset']) {
    await expect(text.getByRole('textbox', { name: label })).toBeVisible();
  }
  const scale = fit.getByRole('textbox', { name: 'Dim scale overall' });
  await expect(scale).toBeVisible();
  await shot('1-dimension-rows.png');

  // Dim scale overall 2: arrows, gaps and text twice their style's size.
  const before = await band();
  await scale.fill('2');
  await scale.press('Enter');
  await expect(scale).toHaveValue(/^2(\.0+)?$/);
  await expect.poll(band, { timeout: 15_000 }).toBeGreaterThan(before + 100);
  const scaled = await band();
  await shot('2-dim-scale-2.png');

  // Arrow size and Text height take the values typed.
  const arrow = lines.getByRole('textbox', { name: 'Arrow size' });
  await arrow.fill('1.5');
  await arrow.press('Enter');
  await expect(arrow).toHaveValue(/^1\.5/);
  const height = text.getByRole('textbox', { name: 'Text height' });
  await height.fill('3.5');
  await height.press('Enter');
  await expect(height).toHaveValue(/^3\.5/);
  await expect.poll(band, { timeout: 15_000 }).not.toBe(scaled);
  await shot('3-arrow-and-text-height.png');

  // U undoes each edit: three steps back, the scale is as it was.
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await click(30, 34);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  await expect(scale).toHaveValue(/^1(\.0+)?$/);

  // Dynamic: sized on screen, by no style, so the rows go.
  await constraint.getByRole('combobox', { name: 'Constraint Form' }).selectOption({
    label: 'Dynamic',
  });
  await expect(misc).toHaveCount(0);
  await expect(fit).toHaveCount(0);
});
