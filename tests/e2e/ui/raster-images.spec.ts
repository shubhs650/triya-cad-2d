// M1-19 part 3: raster images from the files the user drops. The thread-authored drawing
// (packages/testkit/src/raster/fixture.ts) shows checker.png (A, transparency on; C faded, with
// an inverted clip; F through an unloaded definition), bars.bmp (B, turned, brightened, clipped
// by a triangle), scan.tif (D, bitonal in red) and a file never supplied (E). A file dropped
// before the drawing opens is used once it does; one dropped after shows at once. Dropped
// images join the session's files and never open as drawings. An image whose file is missing
// shows the file name in its frame until the file comes (M1-109); an unloaded one, its frame.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  colourAt,
  expectShown,
  lightPixels,
  openWithDrop,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/raster');
const DXF = path.join(FIXTURES, 'raster-images.dxf');
const file = (name: string) => path.join(FIXTURES, name);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const nav = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Navigation' }).getByRole('button', { name, exact: true });

type Rgb = readonly number[];
const isRed = ([r, g, b]: Rgb) => r! > 200 && g! < 60 && b! < 60;
const isBlue = ([r, g, b]: Rgb) => b! > 200 && r! < 60 && g! < 60;
const isYellow = ([r, g, b]: Rgb) => r! > 200 && g! > 200 && b! < 60;
/** The dark model canvas, #212830 (UI_SPEC.md §6). */
const isCanvas = ([r, g, b]: Rgb) =>
  Math.abs(r! - 0x21) + Math.abs(g! - 0x28) + Math.abs(b! - 0x30) < 24;

test('draws images from dropped BMP, PNG and TIFF files, whenever they arrive', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  // checker.png before the drawing: kept for it, not opened as a drawing.
  await openWithDrop(page, file('checker.png'));
  await openWithPicker(page, DXF);
  await expectShown(page, 'raster-images.dxf');
  await nav(page, 'Zoom Extents').click();
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const poll = (x: number, y: number, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colour(x, y)), { timeout: 30_000 }).toBe(true);

  // A: red and blue quadrants; the clear one shows the canvas (transparency on).
  await poll(1, 3, isRed);
  await poll(1, 1, isBlue);
  expect(isCanvas(await colour(3, 1))).toBe(true);
  // C: faded towards the canvas, and its middle cut out by the inverted clip.
  const faded = await colour(0.25, 9.75);
  expect(faded[0]! > faded[1]! + 40 && faded[0]! < 180).toBe(true);
  expect(isCanvas(await colour(1.75, 8.25))).toBe(true);

  // B and D wait for their files.
  const u = { x: 0.75 * Math.cos(Math.PI / 6), y: 0.75 * Math.sin(Math.PI / 6) };
  const w = { x: -u.y, y: u.x };
  // bars.bmp pixel (2, 2), yellow: bitmap point (2.5, 2.5) is u·2.5 + v·(4 − 2.5).
  const bar = { x: 6 + u.x * 2.5 + w.x * 1.5, y: u.y * 2.5 + w.y * 1.5 };
  // scan.tif pixel (7, 3), on the X.
  const ink = { x: 6 + 7.5 * 0.25, y: 6 + 4.5 * 0.25 };
  expect(isYellow(await colour(bar.x, bar.y))).toBe(false);
  expect(isRed(await colour(ink.x, ink.y))).toBe(false);

  await openWithDrop(page, file('bars.bmp'));
  await openWithDrop(page, file('scan.tif'));
  await poll(bar.x, bar.y, isYellow);
  // Bitonal: the X in the image's colour, the rest clear.
  await poll(ink.x, ink.y, isRed);
  expect(isCanvas(await colour(6 + 0.5 * 0.25, 6 + 3.5 * 0.25))).toBe(true);

  // F's definition is saved unloaded: only its frame, though checker.png is here.
  expect(isCanvas(await colour(13, 9))).toBe(true);
  // No dropped image opened as a drawing, and nothing failed.
  await expect(page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab')).toHaveCount(
    1,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows a missing image’s file name in its frame until its file is dropped', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'raster-images.dxf');
  await nav(page, 'Zoom Extents').click();
  const v = await viewOf(page);
  // White pixels inside an image's frame, inset a quarter unit from it: the name's glyphs.
  const named = (x0: number, y0: number, x1: number, y1: number) =>
    lightPixels(page, v.at(x0 + 0.25, y0 + 0.25), v.at(x1 - 0.25, y1 - 0.25));
  const poll = (f: () => Promise<number>, ok: (n: number) => boolean) =>
    expect.poll(async () => ok(await f()), { timeout: 30_000 }).toBe(true);
  const imageA = () => named(0, 0, 4, 4);
  const imageE = () => named(12, 0, 16, 3);
  const imageF = () => named(12, 6, 16, 10);

  // Nothing dropped: A and E show their file names, F (unloaded) its frame alone.
  await poll(imageA, (n) => n > 20);
  await poll(imageE, (n) => n > 20);
  expect(await imageF()).toBe(0);

  // checker.png arrives: A shows it and no name; E's file never comes.
  await openWithDrop(page, file('checker.png'));
  await poll(imageA, (n) => n === 0);
  expect(await imageE()).toBeGreaterThan(20);
  expect(await imageF()).toBe(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
