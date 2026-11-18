// M5-04 part 10: IMAGEADJUST's Image Adjust dialog on the raster image test drawing
// (packages/testkit/src/raster/fixture.ts; checker.png dropped so image A, red, green, blue and
// clear quadrants, shows). The dialog opens on image A's values with its preview; Fade typed in
// its box and Brightness moved on its slider change the preview; Reset brings back 50, 50 and 0;
// OK fades the image on the canvas as one undo step, and Cancel changes nothing. The engine side
// is unit-tested in packages/engine/test/commands/image-commands.test.ts and the preview in
// apps/web/test/image-adjust.test.ts. SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { colourAt, expectShown, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/raster');
const DXF = path.join(FIXTURES, 'raster-images.dxf');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Off the canvas, so Dynamic Input does not take the next point typed as relative. */
const park = (page: Page) => page.mouse.move(640, 708);

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await park(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

type Rgb = readonly number[];
const isRed = ([r, g, b]: Rgb) => r! > 200 && g! < 60 && b! < 60;

test('IMAGEADJUST opens Image Adjust: values, preview, Reset, OK and Cancel', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithDrop(page, path.join(FIXTURES, 'checker.png'));
  await openWithPicker(page, DXF);
  await expectShown(page, 'raster-images.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const poll = (x: number, y: number, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colour(x, y)), { timeout: 30_000 }).toBe(true);
  const click = async (x: number, y: number) => {
    const p = v.at(x, y);
    await page.mouse.click(v.box.x + p.x, v.box.y + p.y);
  };

  // Image A: checker.png at 0,0, 4 units square, red top left.
  await poll(1, 3, isRed);
  await shot(page, '1-before');

  await type(page, 'IMAGEADJUST', 'Select image(s):');
  await click(0, 3);
  await page.keyboard.press('Enter');
  // One image picked: the dialog opens on its values (the prompt waits on the dialog).
  const dialog = page.getByRole('dialog', { name: 'Image Adjust' });
  await expect(dialog).toBeVisible();
  const brightness = dialog.getByRole('slider', { name: 'Brightness' });
  const fade = dialog.getByRole('textbox', { name: 'Fade value' });
  await expect(brightness).toHaveValue('50');
  await expect(dialog.getByRole('slider', { name: 'Contrast' })).toHaveValue('50');
  await expect(fade).toHaveValue('0');
  const preview = dialog.getByTestId('image-adjust-preview').locator('img');
  await expect(preview).toBeVisible();
  const first = await preview.getAttribute('src');

  // Fade typed in its box moves its slider and changes the preview.
  await fade.fill('40');
  await expect(dialog.getByRole('slider', { name: 'Fade' })).toHaveValue('40');
  await expect.poll(() => preview.getAttribute('src')).not.toBe(first);
  // Brightness on its slider (the keyboard moves a range one step a press).
  await brightness.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(brightness).toHaveValue('55');
  await expect(dialog.getByRole('textbox', { name: 'Brightness value' })).toHaveValue('55');
  await shot(page, '2-image-adjust-dialog');

  // Reset: 50, 50, 0 and the first preview again.
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(brightness).toHaveValue('50');
  await expect(fade).toHaveValue('0');
  await expect.poll(() => preview.getAttribute('src')).toBe(first);

  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Command:');
  expect(isRed(await colour(1, 3))).toBe(true);

  // Fade 80 and OK: the red fades towards the canvas.
  await type(page, 'IAD', 'Select image(s):');
  await click(0, 3);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await fade.fill('80');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Command:');
  await poll(1, 3, (c) => !isRed(c) && c[0]! > c[1]! + 20);
  await shot(page, '3-faded');

  // It reopens on the values OK set, and U takes them back in one step.
  await type(page, 'IMAGEADJUST', 'Select image(s):');
  await click(0, 3);
  await page.keyboard.press('Enter');
  await expect(fade).toHaveValue('80');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'U', 'Command:');
  await poll(1, 3, isRed);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
