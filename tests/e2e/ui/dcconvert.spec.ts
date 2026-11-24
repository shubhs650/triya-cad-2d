// M9-03 part 9: DCCONVERT, the Parametric tab's Dimensional > Convert. On an empty part of the
// plan an L of two lines gets a horizontal and a vertical DIMLINEAR dimension; Convert with both
// selected turns them into dynamic dimensional constraints (d1, d2) of the values they measured,
// the dimensions gone, and the Parameters Manager's new value for d1 then drives the lower line.
// U takes the edit back, and U again puts the dimensions back. What each dimension converts to is
// tested in packages/engine/test/edit/dimension-convert.test.ts and the command in
// packages/engine/test/commands/dcconvert.test.ts; this checks the ribbon, the command line and
// the worker's solver.
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
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Pixels of the dynamic constraints' blue on the dark canvas (#5ab4ff, blended at its edges) in
 * the CSS-pixel rectangle between `a` and `b` of the active canvas.
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

test('Convert turns dimensions into dimensional constraints that drive the geometry', async ({
  page,
}) => {
  test.setTimeout(150_000);
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

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and an L: a line 60 long
  // along y = 20 and one 40 up from its right end.
  const p = (x: number, y: number) => `${1000000 + x},${1000000 + y}`;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(0, 0), 'Specify opposite corner:');
  await type(page, p(160, 100), 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, p(20, 20), 'Specify next point or [Undo]:');
  await type(page, p(80, 20), 'Specify next point or [Undo]:');
  await type(page, p(80, 60), 'Specify next point or [Close/Undo]:');
  await type(page, '', 'Command:');
  // A horizontal dimension under the lower line and a vertical one beside the upright.
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(20, 20), 'Specify second extension line origin:');
  await type(page, p(80, 20), /^Specify dimension line location/);
  await type(page, p(50, 8), 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(80, 20), 'Specify second extension line origin:');
  await type(page, p(80, 60), /^Specify dimension line location/);
  await type(page, p(95, 40), 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(view.box.x + q.x, view.box.y + q.y);
  };
  /** The bands where the dimensions (and then the constraints) are drawn. */
  const below = () => bluePixels(page, at(15, 2), at(85, 16));
  const beside = () => bluePixels(page, at(86, 15), at(110, 65));
  expect(await below()).toBe(0);
  await shot('1-dimensions.png');

  // Parametric > Dimensional > Convert, both dimensions picked on their dimension lines.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  await page
    .getByRole('group', { name: 'Dimensional' })
    .getByRole('button', { name: 'Convert', exact: true })
    .click();
  await expect(prompt(page)).toHaveText('Select associative dimensions to convert:');
  await click(35, 8);
  await click(95, 30);
  await shot('2-dimensions-selected.png', false);
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('2 dimensions converted.', { timeout: 15_000 });
  await expect.poll(below, { timeout: 15_000 }).toBeGreaterThan(100);
  await expect.poll(beside, { timeout: 15_000 }).toBeGreaterThan(100);
  await shot('3-converted.png');

  // The Parameters Manager lists d1 = 60 and d2 = 40; d1 = 80 stretches the lower line.
  await type(page, 'PARAMETERS', 'Command:');
  const manager = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(manager).toBeVisible();
  const expression = (name: string) =>
    manager.getByRole('textbox', { name: `Expression of ${name}` });
  await expect(expression('d1')).toHaveValue('60');
  await expect(expression('d2')).toHaveValue('40');
  await expression('d1').fill('80');
  await expression('d1').press('Enter');
  await expect(expression('d1')).toHaveValue('80');
  await expect
    .poll(() => bluePixels(page, at(85, 2), at(105, 16)), { timeout: 15_000 })
    .toBeGreaterThan(20);
  await shot('4-d1-set-to-80.png');

  // U takes the edit back; U again puts the dimensions back in place of the constraints.
  // The expression cell keeps the focus after Enter: the command line takes it back.
  await page.locator('#command-input').click();
  await type(page, 'U', 'Command:');
  await expect.poll(() => bluePixels(page, at(85, 2), at(105, 16)), { timeout: 15_000 }).toBe(0);
  await type(page, 'U', 'Command:');
  await shot('5-undone.png');
  await expect.poll(below, { timeout: 15_000 }).toBe(0);
  await expect.poll(beside, { timeout: 15_000 }).toBe(0);
});
