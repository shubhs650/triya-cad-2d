// M5-04 part 4: the image commands at the command line, on the raster image test drawing
// (packages/testkit/src/raster/fixture.ts; checker.png dropped so image A, red, green, blue and
// clear quadrants, shows): IMAGECLIP clips A to its red quadrant, OFF shows it whole and ON clips
// it again, IMAGEADJUST fades it, IMAGEFRAME 0 hides the frames, and U takes each back. The
// engine side is unit-tested in packages/engine/test/commands/image-commands.test.ts and the save
// in packages/testkit/src/raster/image-commands.test.ts. SHOTS=<dir> saves the PR's screenshots.
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

const CLIP_OPTIONS = 'Enter image clipping option [ON/OFF/Delete/New boundary] <New>:';

test('IMAGECLIP clips an image, OFF and ON toggle it, IMAGEADJUST fades it, IMAGEFRAME hides frames', async ({
  page,
}) => {
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
  /** A click on the canvas at world (x, y). */
  const click = async (x: number, y: number) => {
    const p = v.at(x, y);
    await page.mouse.click(v.box.x + p.x, v.box.y + p.y);
  };

  // Image A: checker.png at 0,0, 4 units square, red top left and green top right.
  await poll(1, 3, isRed);
  await poll(3, 3, isGreen);
  await shot(page, '1-before');

  // IMAGECLIP New boundary, Rectangular: the red quadrant only.
  await type(page, 'IMAGECLIP', 'Select image to clip:');
  await click(0, 1);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(
    page,
    '',
    'Specify clipping boundary or select invert option [Select polyline/Polygonal/Rectangular/Invert clip] <Rectangular>:',
  );
  await type(page, '', 'Specify first corner:');
  await type(page, '0,2', 'Specify opposite corner:');
  await type(page, '2,4', 'Command:');
  await poll(3, 3, isCanvas);
  expect(isRed(await colour(1, 3))).toBe(true);
  await shot(page, '2-clipped');

  // OFF shows the whole image again; ON clips it.
  await type(page, 'IMAGECLIP', 'Select image to clip:');
  await click(0, 3);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(page, 'OFF', 'Command:');
  await poll(3, 3, isGreen);
  await type(page, 'ICL', 'Select image to clip:');
  await click(0, 3);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(page, 'ON', 'Command:');
  await poll(3, 3, isCanvas);

  // -IMAGEADJUST Fade 80: the red fades towards the canvas (IMAGEADJUST's dialog: image-adjust.spec.ts).
  await type(page, '-IMAGEADJUST', 'Select image(s):');
  await click(0, 3);
  await type(page, '', 'Enter image adjust option [Contrast/Fade/Brightness] <Brightness>:');
  await type(page, 'F', 'Enter fade value (0-100) <0>:');
  await type(page, '80', 'Command:');
  await poll(1, 3, (c) => !isRed(c) && c[0]! > c[1]! + 20);
  await shot(page, '3-faded');

  // IMAGEFRAME 0: no frames; U brings them back.
  await type(page, 'IMAGEFRAME', 'Enter new value for IMAGEFRAME <1>:');
  await type(page, '0', 'Command:');
  await shot(page, '4-no-frames');
  await type(page, 'IMAGEFRAME', 'Enter new value for IMAGEFRAME <0>:');
  await type(page, '', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'IMAGEFRAME', 'Enter new value for IMAGEFRAME <1>:');
  await page.keyboard.press('Escape');

  // U takes back the fade, then ON, OFF and the clip.
  await type(page, 'U', 'Command:');
  await poll(1, 3, isRed);
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await poll(3, 3, isGreen);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
