// M5-04 part 9: PDFCLIP and PDFADJUST at the command line, on the PDF underlay test drawing
// (packages/testkit/src/underlay/fixture.ts, unitless: a unit is the page's inch; page 1 at the
// origin, its red square at 1–3 in and its 2 × 2 raster at 5–7 by 1–3 in), its PDF dropped:
// PDFCLIP clips page 1 to the red square, OFF shows the page whole and ON clips it again,
// PDFADJUST fades it and turns it monochrome, Delete brings the whole page back, and U takes each
// back. The engine side is unit-tested in packages/engine/test/commands/pdf-underlay-commands
// .test.ts and the save in packages/testkit/src/underlay/pdf-clip.test.ts. SHOTS=<dir> saves the
// PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { colourAt, expectShown, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');
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
/** The dark model canvas, #212830 (UI_SPEC.md §6). */
const isCanvas = ([r, g, b]: Rgb) =>
  Math.abs(r! - 0x21) + Math.abs(g! - 0x28) + Math.abs(b! - 0x30) < 24;
/** A grey: its channels within a few levels of each other. */
const isGrey = ([r, g, b]: Rgb) => Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 12;

const CLIP_OPTIONS = 'Enter PDF clipping option [ON/OFF/Delete/New boundary] <New boundary>:';

test('PDFCLIP clips a page, OFF and ON toggle it, PDFADJUST fades it and turns it grey', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'pdf-underlay.dxf');
  await openWithDrop(page, PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '-1,-1', 'Specify opposite corner:');
  await type(page, '10,12', 'Command:');
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const poll = (x: number, y: number, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colour(x, y)), { timeout: 30_000 }).toBe(true);
  /** A click on the canvas at world (x, y). */
  const click = async (x: number, y: number) => {
    const p = v.at(x, y);
    await page.mouse.click(v.box.x + p.x, v.box.y + p.y);
  };
  /** Page 1's raster at 5–7 by 1–3 in: green, yellow, magenta and cyan, none of them grey. */
  const raster = { x: 5.5, y: 1.5 };

  await poll(2, 2, isRed);
  await poll(raster.x, raster.y, (c) => !isGrey(c) && !isCanvas(c));
  await shot(page, '1-before');

  // PDFCLIP New boundary, Rectangular: the red square only. Unclipped, page 1 is picked by its
  // page's outline (its size read from the PDF).
  await type(page, 'PDFCLIP', 'Select PDF to clip:');
  await click(0, 6);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(
    page,
    '',
    'Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:',
  );
  await type(page, '', 'Specify first corner:');
  await type(page, '0.5,0.5', 'Specify opposite corner:');
  await type(page, '3.5,3.5', 'Command:');
  await poll(raster.x, raster.y, isCanvas);
  expect(isRed(await colour(2, 2))).toBe(true);
  await shot(page, '2-clipped');

  // OFF shows the whole page again; ON clips it. The clipped page is picked by its boundary.
  await type(page, 'PDFCLIP', 'Select PDF to clip:');
  await click(0.5, 2);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(page, 'OFF', 'Command:');
  await poll(raster.x, raster.y, (c) => !isCanvas(c));
  await type(page, 'PDFCLIP', 'Select PDF to clip:');
  await click(0, 6);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(page, 'ON', 'Command:');
  await poll(raster.x, raster.y, isCanvas);

  // PDFADJUST Fade 60: the red fades towards the canvas; Monochrome: it turns grey.
  await type(page, 'PDFADJUST', 'Select PDF underlay:');
  await click(0.5, 2);
  await type(
    page,
    '',
    'Enter PDF underlay option [Fade/Contrast/Monochrome/AdjustColorForBackground] <Fade>:',
  );
  await type(page, '', 'Enter fade value (0-80) <0>:');
  await type(page, '60', 'Command:');
  await poll(2, 2, (c) => !isRed(c) && c[0]! > c[1]! + 20);
  await shot(page, '3-faded');
  await type(page, 'PDFADJUST', 'Select PDF underlay:');
  await click(0.5, 2);
  await type(page, '', /^Enter PDF underlay option/);
  await type(page, 'M', 'Enter monochrome setting [Yes/No] <No>:');
  await type(page, 'Y', 'Command:');
  await poll(2, 2, (c) => isGrey(c) && !isCanvas(c));
  await shot(page, '4-monochrome');

  // Delete: the whole page again, still grey; U takes Delete back.
  await type(page, 'PDFCLIP', 'Select PDF to clip:');
  await click(0.5, 2);
  await expect(prompt(page)).toHaveText(CLIP_OPTIONS);
  await park(page);
  await type(page, 'D', 'Command:');
  await poll(raster.x, raster.y, (c) => isGrey(c) && !isCanvas(c));
  await shot(page, '5-clip-deleted');
  await type(page, 'U', 'Command:');
  await poll(raster.x, raster.y, isCanvas);

  // U takes back monochrome, the fade, ON, OFF and the clip.
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await poll(2, 2, isRed);
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await poll(raster.x, raster.y, (c) => !isGrey(c) && !isCanvas(c));
  await expect(page.getByRole('alert')).toHaveCount(0);
});
