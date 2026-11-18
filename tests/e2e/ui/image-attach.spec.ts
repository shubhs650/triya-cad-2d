// M5-04 part 5: IMAGEATTACH and its Attach Image dialog, on the raster image test drawing
// (packages/testkit/src/raster/fixture.ts, unitless; checker.png dropped so image A shows): the
// dialog opens on Browse..., the file picked shows its preview and, with Show Details, its
// Image Information; OK with Scale 4 asks the insertion point and the new image draws there at
// once (red top-left quadrant, green top-right); U takes it back. The References palette's
// Attach Image... opens the same dialog. The engine side is unit-tested in
// packages/engine/test/commands/image-attach.test.ts and the save in
// packages/testkit/src/raster/image-attach.test.ts. SHOTS=<dir> saves the PR's screenshots.
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
const isGreen = ([r, g, b]: Rgb) => g! > 200 && r! < 60 && b! < 60;
/** The dark model canvas, #212830 (UI_SPEC.md §6). */
const isCanvas = ([r, g, b]: Rgb) =>
  Math.abs(r! - 0x21) + Math.abs(g! - 0x28) + Math.abs(b! - 0x30) < 24;

test('IMAGEATTACH attaches a picked file through the Attach Image dialog', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithDrop(page, path.join(FIXTURES, 'checker.png'));
  await openWithPicker(page, DXF);
  await expectShown(page, 'raster-images.dxf');
  // The drawing's extents and the space right of them, where the image goes.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'W', /^Specify first corner/);
  await type(page, '-2,-8', /^Specify opposite corner/);
  await type(page, '30,22', 'Command:');
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const poll = (x: number, y: number, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colour(x, y)), { timeout: 30_000 }).toBe(true);
  await poll(1, 3, isRed);
  await poll(21, 3, isCanvas);

  await page.keyboard.type('IAT');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attach Image' });
  await expect(dialog).toBeVisible();
  // The drawing's images are listed; OK waits for one, Browse... picks a file.
  const name = dialog.getByLabel('Name:');
  await expect(name.locator('option')).toHaveText([
    'bars',
    'checker',
    'checker-unloaded',
    'scan',
    'site-photo',
  ]);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse...' }).click();
  await (await chooser).setFiles(path.join(FIXTURES, 'checker.png'));
  await expect(name).toHaveValue('checker');
  await expect(dialog.getByTestId('image-attach-path')).toHaveText('checker.png');
  await expect(dialog.getByLabel('Path type:')).toHaveValue('none');
  await expect(dialog.getByRole('img', { name: 'Preview of checker.png' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Show Details' }).click();
  await expect(dialog.getByTestId('image-attach-px')).toHaveText('8, Height: 8');
  await expect(dialog.getByTestId('image-attach-unit')).toHaveText('Unitless');
  await expect(dialog.getByTestId('image-attach-size')).toHaveText('1, Height: 1');
  // Scale 4 typed; the insertion point on screen.
  const scale = dialog.getByRole('group', { name: 'Scale' });
  await scale.getByLabel('Specify on-screen').uncheck();
  await scale.getByLabel('Scale:').fill('4');
  await shot(page, '1-attach-image-dialog');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify insertion point <0,0>:');
  await park(page);
  await type(page, '20,0', 'Command:');

  // checker.png 4 units square at 20,0: red top left, green top right.
  await poll(21, 3, isRed);
  await poll(23, 3, isGreen);
  await shot(page, '2-attached');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // One undo step.
  await type(page, 'U', 'Command:');
  await poll(21, 3, isCanvas);

  // The References palette's Attach Image... opens the dialog too.
  await type(page, 'XREF', 'Command:');
  await shot(page, '3-references-attach-image');
  await page.getByRole('button', { name: 'Attach Image...' }).click();
  await expect(dialog).toBeVisible();
  await expect(name.locator('option')).toHaveCount(5);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});
