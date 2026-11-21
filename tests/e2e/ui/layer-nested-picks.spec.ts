// M5-06 part 5: the layer tools' picks of objects nested in a block, through the canvas. A line
// drawn on HATCH is made into a block (-BLOCK) and inserted on Defpoints. LAYOFF's Block
// selection Block (the default) turns off the reference's layer, Defpoints; Entity turns off the
// layer of the line picked inside it, HATCH, which only the canvas can say it hit.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DOCKED_PALETTES,
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

// The palettes dock beside the drawing area (M7-03; narrower windows slide them over it).
test.use({ viewport: DOCKED_PALETTES });

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('LAYOFF turns off the layer of a block, or of the object picked in it', async ({ page }) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const click = async (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  const on = (layer: string) => palette.getByRole('button', { name: `On ${layer}`, exact: true });

  // An empty part of the plan, running object snaps off: a line on HATCH...
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, 'HATCH', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await click(0.2, 0.5);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await click(0.7, 0.5);
  await type(page, '', 'Command:');

  // ...made into the block NESTED and inserted where it was, on Defpoints.
  await type(page, '-BLOCK', 'Enter block name or [?]:');
  await type(page, 'NESTED', 'Specify insertion base point:');
  await type(page, '1000000,1000000', 'Select objects:');
  await click(0.45, 0.5);
  await type(page, '', 'Command:');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, 'Defpoints', 'Command:');
  await type(page, '-INSERT', /^Enter block name or \[\?\]/);
  await type(page, 'NESTED', 'Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
  await type(page, '1000000,1000000', /^Enter X scale factor/);
  await type(page, '', /^Enter Y scale factor/);
  await type(page, '', /^Specify rotation angle/);
  await type(page, '', 'Command:');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, '0', 'Command:');
  await shot('1-block-on-defpoints.png');

  // Block (the default): the reference's layer.
  await type(page, 'LAYOFF', 'Select an object on the layer to be turned off or [Settings/Undo]:');
  await click(0.45, 0.5);
  await expect(on('Defpoints')).toHaveAttribute('aria-pressed', 'false');
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'true');
  await shot('2-block-mode-defpoints-off.png');
  await type(page, '', 'Command:');
  await type(page, 'LAYON', 'Command:');

  // Entity: the canvas says the pick hit the line inside the block, on HATCH.
  await type(page, 'LAYOFF', 'Select an object on the layer to be turned off or [Settings/Undo]:');
  await type(page, 'S', 'Enter setting type for [Viewports/Block selection]:');
  await type(page, 'B', 'Enter Block Selection nesting level [Block/Entity/None] <Block>:');
  await type(page, 'E', 'Select an object on the layer to be turned off or [Settings/Undo]:');
  await click(0.45, 0.5);
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'false');
  await expect(on('Defpoints')).toHaveAttribute('aria-pressed', 'true');
  await shot('3-entity-mode-hatch-off.png');
  await type(page, '', 'Command:');
});
