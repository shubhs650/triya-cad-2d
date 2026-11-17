// M5-06 part 1: the layer tool row's commands on the canvas. Two lines are drawn, one on layer
// 0 and one on HATCH; LAYISO on the first locks HATCH (faded by LAYLOCKFADECTL) and keeps 0
// current, LAYUNISO unlocks it again, and LAYOFF on the second turns HATCH off until LAYON. The
// Layers palette shows each change as the engine made it.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

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

test('LAYISO, LAYUNISO, LAYOFF and LAYON change the layers of the objects picked', async ({
  page,
}) => {
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
  const line = async (y: number) => {
    await type(page, 'L', 'Specify first point:');
    await click(0.2, y);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(0.7, y);
    await type(page, '', 'Command:');
  };
  const lock = (layer: string) =>
    palette.getByRole('button', { name: `Lock ${layer}`, exact: true });
  const on = (layer: string) => palette.getByRole('button', { name: `On ${layer}`, exact: true });
  const current = (layer: string) =>
    palette
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: layer, exact: true }) });

  // An empty part of the plan, running object snaps off: a line on 0, then one on HATCH.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await line(0.35);
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, 'HATCH', 'Command:');
  await line(0.65);
  await expect(current('HATCH')).toHaveAttribute('data-current', 'true');
  await shot('1-before.png');

  // LAYISO on the line on 0: HATCH is locked (and faded), 0 becomes current.
  await type(page, 'LAYISO', 'Select objects on the layer(s) to be isolated or [Settings]:');
  await click(0.45, 0.35);
  await type(page, '', 'Command:');
  await expect(lock('HATCH')).toHaveAttribute('aria-pressed', 'true');
  await expect(lock('0')).toHaveAttribute('aria-pressed', 'false');
  await expect(current('0')).toHaveAttribute('data-current', 'true');
  await shot('2-layiso.png');

  await type(page, 'LAYUNISO', 'Command:');
  await expect(lock('HATCH')).toHaveAttribute('aria-pressed', 'false');
  await expect(lock('Defpoints')).toHaveAttribute('aria-pressed', 'false');

  // LAYOFF on the line on HATCH, until Enter; LAYON turns it back on.
  await type(page, 'LAYOFF', 'Select an object on the layer to be turned off or [Settings/Undo]:');
  await click(0.45, 0.65);
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'false');
  await shot('3-layoff.png');
  await type(page, '', 'Command:');
  await type(page, 'LAYON', 'Command:');
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'true');
});
