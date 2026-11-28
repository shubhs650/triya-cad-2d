// M9-14: a block's constraints shown in the Block Editor. On an empty part of the plan an L of two
// lines is constrained with AUTOCONSTRAIN and its foot given `width=30` with DCALIGNED; -BLOCK
// makes block ELL of it, the constraints going into the block (M9-13), where the plan shows
// neither them nor width in the Parameters Manager. -BEDIT ELL shows the block in the Block
// Editor with its constraint bars, its dimensional constraint and width's row (AutoCAD 2024 Help,
// "About Constraints in Blocks"); BCLOSE takes all three away again. The drawing is unit-tested
// in packages/render/test/canvas2d-block-editor-constraints.test.ts and the palette's rows in
// packages/engine/test/commands/parameters.test.ts; this checks the app's canvases and palette.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  enterCommand,
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

type Point = { x: number; y: number };

/**
 * Pixels of the constraints' blue on the dark canvas (#5ab4ff, blended at its edges) in the
 * CSS-pixel rectangle between `a` and `b` of the active canvas (clear of the palettes over it).
 */
async function bluePixels(page: Page, a: Point, b: Point): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  const box = {
    x0: Math.round(Math.min(a.x, b.x)),
    y0: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(b.x - a.x)),
    h: Math.round(Math.abs(b.y - a.y)),
  };
  return page.evaluate(
    async ({ b64, box }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(box.x0, box.y0, box.w, box.h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 2]! > 150 && d[i + 2]! - d[i]! > 70 && d[i + 1]! > d[i]!) n++;
      }
      return n;
    },
    { b64: png, box },
  );
}

test('the Block Editor shows a block’s constraints and parameters, gone after BCLOSE', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const park = async () => {
    const box = (await activeCanvas(page).boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + box.height - 40);
  };
  const shot = async (name: string) => {
    await expectDrawn(page);
    await park();
    await page.screenshot({ path: shots ? path.join(shots, name) : test.info().outputPath(name) });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  await page.keyboard.press('F3');

  // An empty part of the plan, 200 × 120 units from (1000000, 1000000): an L, foot 30, upright 20.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000200,1000120', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000010,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000040,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000040,1000040', 'Specify next point or [Close/Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const plan = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = plan.at(1000000 + x, 1000000 + y);
    await page.mouse.click(plan.box.x + p.x, plan.box.y + p.y);
  };
  /** The L and its constraints' part of the plan. */
  const planBlue = () => bluePixels(page, plan.at(1000000, 1000000), plan.at(1000060, 1000050));
  await type(page, 'AUTOCONSTRAIN', 'Select objects or [Settings]:');
  await click(25, 20);
  await click(40, 30);
  await type(page, '', 'Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText('applied to 2 objects', { timeout: 15_000 });
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(25, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(25, 10);
  await expect(prompt(page)).toHaveText('Dimension text <d1=30.0000>:');
  await type(page, 'width=30', 'Command:');
  await expect.poll(planBlue, { timeout: 15_000 }).toBeGreaterThan(100);
  await shot('1-constrained-in-plan.png');

  // -BLOCK ELL: the L and its constraints go into the block; the plan shows none of them.
  await type(page, '-BLOCK', /^Enter block name/);
  await type(page, 'ELL', /^Specify insertion base point/);
  await type(page, '1000000,1000000', /^Select objects/);
  await click(25, 20);
  await click(40, 30);
  await type(page, '', 'Command:');
  await expect(log).not.toContainText('constraints removed');
  await expect.poll(planBlue, { timeout: 15_000 }).toBe(0);

  await enterCommand(page, 'PARAMETERS');
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(palette).toBeVisible();
  const rows = palette.getByRole('table', { name: 'Parameters' }).locator('tbody tr[data-name]');
  await expect(rows).toHaveCount(0);
  await shot('2-block-made-nothing-shown.png');

  // -BEDIT ELL: the block's bars, its dimensional constraint and width's row.
  await enterCommand(page, '-BEDIT');
  await type(page, 'ELL', 'Command:');
  const bar = page.getByRole('toolbar', { name: 'Block Editor' });
  await expect(bar).toContainText('Block Editor: ELL');
  await expect(page.locator('canvas[data-active="true"][aria-label="Block Editor"]')).toBeVisible();
  await expect(rows).toHaveCount(1, { timeout: 15_000 });
  await expect(palette.getByRole('textbox', { name: 'Name of width' })).toHaveValue('width');
  await expect(rows.first()).toContainText('30.0000');

  // The block keeps its objects where they were drawn: a window round them and d1.
  await enterCommand(page, 'Z');
  await expect(prompt(page)).toHaveText(/^Specify corner of window/);
  await type(page, '999990,1000000', 'Specify opposite corner:');
  await type(page, '#1000070,1000050', 'Command:');
  await expectDrawn(page);
  const editor = await viewOf(page);
  const at = (x: number, y: number) => editor.at(1000000 + x, 1000000 + y);
  // The foot's bar, just under its middle; the dimensional constraint along y = 10.
  const footBar = () => {
    const p = at(25, 20);
    return bluePixels(page, { x: p.x - 40, y: p.y + 3 }, { x: p.x + 40, y: p.y + 40 });
  };
  const dimension = () => bluePixels(page, at(12, 8), at(38, 13));
  await expect.poll(footBar, { timeout: 15_000 }).toBeGreaterThan(10);
  await expect.poll(dimension).toBeGreaterThan(10);
  await shot('3-block-editor-shows-constraints.png');

  // BCLOSE (nothing to save): the plan again, its constraints and width's row gone.
  await enterCommand(page, 'BCLOSE');
  await expect(bar).toBeHidden();
  await expect(page.locator('canvas[data-active="true"][aria-label="Block Editor"]')).toHaveCount(
    0,
  );
  await expect(rows).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(planBlue, { timeout: 15_000 }).toBe(0);
  await shot('4-after-bclose.png');
});
