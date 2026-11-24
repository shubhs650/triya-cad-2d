// M9-03 part 4: dimensional constraints shown on the drawing. On an empty part of the plan a line
// is drawn and DCALIGNED put on it, the dimension line above it: the dynamic constraint shows,
// its extension lines, arrows and `d1=60.0000` in the constraint blue. Zoomed out it keeps its
// size on screen. The Parametric tab's Show Dynamic Constraints hides it; selecting the line
// shows it again (DYNCONSTRAINTMODE 1); CONSTRAINTNAMEFORMAT 0 shows the name alone. Shapes and
// text are unit-tested in packages/engine/test/edit/constraint-display.test.ts and
// packages/render/test/canvas2d-constraints.test.ts; this checks the app, settings and worker.
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

test('a dynamic constraint shows, keeps its size, hides and shows while selected', async ({
  page,
}) => {
  test.setTimeout(150_000);
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

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000020,1000040', 'Specify next point or [Undo]:');
  await type(page, '1000080,1000040', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  let view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The band above the line where the constraint is drawn. */
  const band = () => bluePixels(page, at(10, 46), at(90, 70));
  expect(await band()).toBe(0);

  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 40);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, '', 'Command:');
  await expect.poll(band, { timeout: 15_000 }).toBeGreaterThan(100);
  const shown = await band();
  await shot('1-dynamic-constraint.png');

  // Zoomed out four times, the constraint's arrows and text keep their size on screen: well over
  // the quarter of its blue pixels a drawing-sized dimension would keep.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '0.25X', 'Command:');
  view = await viewOf(page);
  const far = await bluePixels(page, at(-50, 25), at(150, 85));
  expect(far).toBeGreaterThan(shown / 3);
  await shot('2-zoomed-out-same-size.png');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '4X', 'Command:');
  view = await viewOf(page);

  // Parametric > Dimensional > Show Dynamic Constraints hides it.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  const toggle = page
    .getByRole('group', { name: 'Dimensional' })
    .getByRole('button', { name: 'Show Dynamic Constraints', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(band).toBe(0);
  await shot('3-hidden.png');

  // Selecting the line shows its constraint again (DYNCONSTRAINTMODE 1, initially).
  await click(30, 40);
  await expect.poll(band).toBeGreaterThan(100);
  await shot('4-shown-while-selected.png');
  await page.keyboard.press('Escape');
  await expect.poll(band).toBe(0);

  // Shown again, with CONSTRAINTNAMEFORMAT 0: the name alone, fewer blue pixels of text.
  await toggle.click();
  await expect.poll(band).toBeGreaterThan(100);
  await type(page, 'CONSTRAINTNAMEFORMAT', /^Enter new value for CONSTRAINTNAMEFORMAT <2>:/);
  await type(page, '0', 'Command:');
  await expect.poll(band).toBeLessThan(shown - 20);
  await shot('5-name-only.png');
});
