// M9-03 part 10: a dimensional constraint is selected by a click on it at `Command:` and edited
// in the Properties palette's Constraint rows. On an empty part of the plan two lines each get a
// DCALIGNED constraint. A click on the lower one's dimension line selects it: the palette lists
// "Dimensional Constraint (1)" with Constraint Form, Reference, Name, Expression, Value and
// Description. Constraint Form Annotational draws it in the foreground (no longer blue once
// deselected); Reference Yes shows its text in parentheses and makes the Expression read only;
// back to No, a new Expression moves the line; Name renames the parameter. ERASE with the upper
// constraint selected erases it alone, and U brings it back. The rows and edits are tested in
// packages/engine/test/commands/constraint-selection.test.ts and the pick and highlight in
// packages/render/test/canvas2d-constraints.test.ts; this checks the canvas, the worker and the
// palette.
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
 * Pixels of the dynamic constraints' blue on the dark canvas (#5ab4ff, blended at its edges, and
 * the selection's #4da3ff) in the CSS-pixel rectangle between `a` and `b` of the active canvas.
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

test('a constraint picked on the canvas is edited in the Properties palette', async ({ page }) => {
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
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The bands above the lower and the upper line, where their constraints are drawn. */
  const lower = () => bluePixels(page, at(10, 24), at(90, 44));
  const upper = () => bluePixels(page, at(10, 64), at(90, 84));

  for (const y of [20, 60]) {
    await type(page, 'DCALIGNED', /^Specify first constraint point or/);
    await type(page, '', 'Select object:');
    await click(50, y);
    await expect(prompt(page)).toHaveText('Specify dimension line location:', {
      timeout: 15_000,
    });
    await click(50, y + 14);
    await expect(prompt(page)).toHaveText(/^Dimension text <d\d=60.0000>:/);
    await type(page, '', 'Command:');
  }
  await expect.poll(lower, { timeout: 15_000 }).toBeGreaterThan(100);
  await expect.poll(upper, { timeout: 15_000 }).toBeGreaterThan(100);

  // A click on the lower constraint's dimension line, clear of its text, selects it.
  await click(30, 34);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  const constraint = palette.getByRole('table', { name: 'Constraint' });
  await expect(constraint).toBeVisible();
  const form = constraint.getByRole('combobox', { name: 'Constraint Form' });
  const reference = constraint.getByRole('combobox', { name: 'Reference' });
  const name = constraint.getByRole('textbox', { name: 'Name' });
  const expression = constraint.getByRole('textbox', { name: 'Expression' });
  await expect(form).toHaveValue('dynamic');
  await expect(reference).toHaveValue('no');
  await expect(name).toHaveValue('d1');
  await expect(expression).toHaveValue('60');
  await expect(constraint.getByLabel('Value', { exact: true })).toHaveText(/^60\.0+$/);
  await shot('1-constraint-selected.png');

  // Annotational: drawn in the foreground, so no blue once deselected; the upper one stays.
  await form.selectOption({ label: 'Annotational' });
  await expect(form).toHaveValue('annotational');
  await palette.getByRole('heading', { name: 'Properties' }).click();
  await page.keyboard.press('Escape');
  await expect(objects).toHaveText('No selection');
  await expect.poll(lower).toBe(0);
  expect(await upper()).toBeGreaterThan(100);
  await shot('2-annotational.png');

  // Reference Yes: the expression is measured and read only; No makes it drive again.
  await click(30, 34);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  await reference.selectOption({ label: 'Yes' });
  await expect(reference).toHaveValue('yes');
  await expect(constraint.getByRole('textbox', { name: 'Expression' })).toHaveCount(0);
  await expect(constraint.getByLabel('Expression', { exact: true })).toHaveText('60');
  await shot('3-reference.png');
  await reference.selectOption({ label: 'No' });
  await expect(reference).toHaveValue('no');

  // A new expression moves the line's end; a new name renames the parameter.
  await expression.fill('50');
  await expression.press('Enter');
  await expect(constraint.getByLabel('Value', { exact: true })).toHaveText(/^50\.0+$/);
  await name.fill('width');
  await name.press('Enter');
  await expect(name).toHaveValue('width');
  await shot('4-renamed-and-set.png');

  // ERASE with the upper constraint selected erases it, the line staying; U brings it back.
  await palette.getByRole('heading', { name: 'Properties' }).click();
  await page.keyboard.press('Escape');
  await expect(objects).toHaveText('No selection');
  await click(30, 74);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  await expect(name).toHaveValue('d2');
  await type(page, 'ERASE', 'Command:');
  await expect(objects).toHaveText('No selection');
  await expect.poll(upper).toBe(0);
  await shot('5-erased.png');
  await type(page, 'U', 'Command:');
  await expect.poll(upper).toBeGreaterThan(100);
});
