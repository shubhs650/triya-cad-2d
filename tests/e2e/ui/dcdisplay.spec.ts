// M9-03 part 7: DCDISPLAY, the Parametric tab's Dimensional > Show/Hide. On an empty part of the
// plan two lines each get a DCALIGNED constraint. Show/Hide with the lower line selected hides
// its constraint alone, the upper one staying; selecting the lower line shows its constraint
// while it is selected (DYNCONSTRAINTMODE 1); DCDISPLAY's Show (the default) brings it back, and U
// takes that back. The flag's record is tested in packages/io/test/export-dimensional-constraints
// .test.ts and the drawing in packages/render/test/canvas2d-constraints.test.ts; this checks the
// ribbon, the command line and the worker.
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

test('Show/Hide hides the constraints of the objects selected, each on its own', async ({
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
  await shot('1-two-dynamic-constraints.png');

  // Parametric > Dimensional > Show/Hide: the lower line, Hide.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  await page
    .getByRole('group', { name: 'Dimensional' })
    .getByRole('button', { name: 'Show/Hide', exact: true })
    .click();
  await expect(prompt(page)).toHaveText('Select objects:');
  await click(30, 20);
  await type(page, '', 'Enter an option [Show/Hide] <Show>:');
  await shot('2-show-hide-option.png', false);
  await type(page, 'H', 'Command:');
  await expect.poll(lower).toBe(0);
  expect(await upper()).toBeGreaterThan(100);
  await shot('3-lower-hidden.png');

  // Selected, the lower line shows its hidden constraint (DYNCONSTRAINTMODE 1, initially).
  await click(30, 20);
  await expect.poll(lower).toBeGreaterThan(100);
  await shot('4-shown-while-selected.png');
  await page.keyboard.press('Escape');
  await expect.poll(lower).toBe(0);

  // DCDISPLAY with Enter at the option shows it again; U hides it once more.
  await type(page, 'DCDISPLAY', 'Select objects:');
  await click(30, 20);
  await type(page, '', 'Enter an option [Show/Hide] <Show>:');
  await type(page, '', 'Command:');
  await expect.poll(lower).toBeGreaterThan(100);
  await type(page, 'U', 'Command:');
  await expect.poll(lower).toBe(0);
  expect(await upper()).toBeGreaterThan(100);
});
