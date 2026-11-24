// M9-03 part 14: a selection window or crossing window at `Command:` selects the dimensional
// constraints drawn in it along with the objects. On an empty part of the plan two lines each get
// a DCALIGNED constraint. A window (left to right) round the lower constraint's dimension line and
// text, but not its line, selects that constraint alone: the Properties palette lists
// "Dimensional Constraint (1)". A crossing window (right to left) over both constraints and the
// upper line selects all three (a line and two constraints); ERASE erases them (the lower line stays) and U brings
// them back. Shift with a window removes the constraint in it. The bus is tested in
// packages/engine/test/commands/constraint-window.test.ts and the canvas's part in
// packages/render/test/canvas2d-constraints.test.ts; this checks the canvas, the worker and the
// palette together.
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

test('a window or crossing window selects the constraints drawn in it', async ({ page }) => {
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
  const click = async (x: number, y: number, o: { shift?: boolean } = {}) => {
    const p = at(x, y);
    if (o.shift) await page.keyboard.down('Shift');
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
    if (o.shift) await page.keyboard.up('Shift');
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

  // A window round the lower constraint's dimension line and text, clear of its line: the
  // constraint alone (its extension lines down to the line need not be inside).
  await click(10, 27);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await click(90, 44);
  await expect(objects).toHaveText('Dimensional Constraint (1)');
  const name = palette
    .getByRole('table', { name: 'Constraint' })
    .getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('d1');
  await shot('1-window-selects-constraint.png');

  // Shift with a window removes it again.
  await click(10, 27, { shift: true });
  await click(90, 44, { shift: true });
  await expect(objects).toHaveText('No selection');

  // A crossing window over both constraints and the upper line: all three.
  await click(70, 78);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await click(40, 30);
  await expect(objects.locator('option')).toHaveText([
    'All (3)',
    'Line (1)',
    'Dimensional Constraint (2)',
  ]);
  await shot('2-crossing-selects-constraints-and-line.png');

  // ERASE takes them all; the lower line stays. U brings them back.
  await type(page, 'ERASE', 'Command:');
  await expect(objects).toHaveText('No selection');
  await expect.poll(lower).toBe(0);
  await expect.poll(upper).toBe(0);
  await shot('3-erased.png');
  await type(page, 'U', 'Command:');
  await expect.poll(lower).toBeGreaterThan(100);
  await expect.poll(upper).toBeGreaterThan(100);
});
