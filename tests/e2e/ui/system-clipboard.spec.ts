// M2-32 part 5: the system clipboard. COPYCLIP's objects reach another Triya window (two pages
// of one browser, as two windows of the installed app) and other apps get a picture of them;
// another app's text pastes as multiline text, and its picture as a raster image that the saved
// drawing reopens with (M2-54: the PNG is kept on this device). The
// format, the paste's order of preference and the picture's plot are unit-tested in
// apps/web/test/system-clipboard.test.ts and packages/engine/test; this checks the browser's
// clipboard carries them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DWG, DXF, colourAt, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

// The user allowed the app to read the clipboard (the browser asks once).
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const FORMAT = 'web application/x-triya-clipboard';

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The objects the showing drawing's edits added. */
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.entities?.added ?? [])
      .map((a) => a.entity),
  );

const prompt = (page: Page) => page.getByTestId('command-prompt');
const log = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The system clipboard's first item: its types, and its PNG's size and dark pixels. */
const systemClipboard = (page: Page) =>
  page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (!item) return undefined;
    const picture = item.types.includes('image/png')
      ? await createImageBitmap(await item.getType('image/png')).then((bitmap) => {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i]! + data[i + 1]! + data[i + 2]! < 600) dark++;
          return {
            width: bitmap.width,
            height: bitmap.height,
            dark,
            corner: [...data.slice(0, 4)],
          };
        })
      : undefined;
    return { types: [...item.types].sort(), picture };
  });

test('objects copied in one Triya window paste in another, and other apps get a picture', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page.keyboard.press('Control+c');
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');

  // Triya's own format beside a picture: the objects in black on white, the longer side 1024
  // pixels inside an 8-pixel margin.
  await expect
    .poll(async () => (await systemClipboard(page))?.types, { timeout: 15_000 })
    .toEqual(['image/png', FORMAT].sort());
  const { picture } = (await systemClipboard(page))!;
  expect(Math.max(picture!.width, picture!.height)).toBe(1024 + 16);
  expect(picture!.corner).toEqual([255, 255, 255, 255]);
  expect(picture!.dark).toBeGreaterThan(100);

  // Another window: its own drawing, Ctrl+V.
  const other = await context.newPage();
  await other.goto(app.url);
  await openWithPicker(other, DWG);
  await expectShown(other, path.basename(DWG));
  await other.keyboard.press('Control+v');
  await expect(prompt(other)).toHaveText('Specify insertion point:');
  await type(other, '0,0', 'Command:');
  await expect.poll(async () => (await added(other)).map((e) => e.type)).toEqual(['HATCH']);
  // Objects from another window come from another drawing: PASTEORIG takes them.
  await type(other, 'PASTEORIG', 'Command:');
  await expect
    .poll(async () => (await added(other)).map((e) => e.type))
    .toEqual(['HATCH', 'HATCH']);

  // In the window they came from, they are its own drawing's still.
  await page.bringToFront();
  await type(page, 'PASTEORIG', 'Command:');
  await expect(log(page)).toContainText(
    'PASTEORIG pastes objects copied from another drawing only.',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(other.getByRole('alert')).toHaveCount(0);
});

test("another app's text pastes as multiline text", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  await page.evaluate(() =>
    navigator.clipboard.writeText('GENERAL NOTES\r\n1. Dims in mm {typ}\r\n'),
  );
  await page.keyboard.press('Control+v');
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, '10,20', 'Command:');
  await expect.poll(async () => (await added(page)).map((e) => e.type)).toEqual(['MTEXT']);
  const [mtext] = await added(page);
  expect(mtext!.geom).toMatchObject({
    kind: 'MTEXT',
    contents: 'GENERAL NOTES\\P1. Dims in mm \\{typ\\}',
    position: { x: 10, y: 20 },
    attachment: 1,
  });

  await expect(page.getByRole('alert')).toHaveCount(0);
});

type Rgb = readonly number[];
const isRed = ([r, g, b]: Rgb) => r! > 200 && g! < 60 && b! < 60;
const isBlue = ([r, g, b]: Rgb) => b! > 200 && r! < 60 && g! < 60;

/** Zooms to the window between the image's corners, with a margin, at the command line. */
async function zoomTo(page: Page, image: { x: number; y: number; w: number; h: number }) {
  const m = image.w / 4;
  await type(page, 'ZOOM', /Specify corner of window/);
  await type(page, `${image.x - m},${image.y - m}`, /Specify opposite corner/);
  await type(page, `${image.x + image.w + m},${image.y + image.h + m}`, 'Command:');
}

/** Polls the canvas until (x, y) in world units is `ok`. */
async function expectColour(page: Page, x: number, y: number, ok: (c: Rgb) => boolean) {
  await expect
    .poll(async () => ok(await colourAt(page, (await viewOf(page)).at(x, y))), { timeout: 30_000 })
    .toBe(true);
}

test("another app's picture pastes as an image, and the saved drawing reopens with it", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // A screenshot-like PNG from another app: 96 × 48 pixels, its left half red, its right blue.
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(96, 48);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(48, 0, 48, 48);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await page.keyboard.press('Control+v');
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, '1000,1000', 'Command:');
  await expect.poll(async () => (await added(page)).map((e) => e.type)).toEqual(['IMAGE']);
  const [pasted] = await added(page);
  const g = pasted!.geom as {
    position: { x: number; y: number };
    u: { x: number };
    v: { y: number };
    size: { x: number; y: number };
  };
  expect(g.position).toEqual({ x: 1000, y: 1000 });
  expect(g.size).toEqual({ x: 96, y: 48 });
  // 96 pixels an inch (the PNG states no resolution): one inch wide, in the drawing's units.
  const image = { x: 1000, y: 1000, w: g.u.x * 96, h: g.v.y * 48 };
  expect(image.w).toBeCloseTo(image.h * 2, 9);

  await zoomTo(page, image);
  await expectColour(page, image.x + image.w / 4, image.y + image.h / 2, isRed);
  await expectColour(page, image.x + (3 * image.w) / 4, image.y + image.h / 2, isBlue);
  await page.screenshot({ path: test.info().outputPath('1-picture-pasted.png') });
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Saved (a download: no File System Access), then opened in another window of the app, as on
  // a later visit: the drawing names the picture's file, which this device keeps.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const d = await download;
  const saved = test.info().outputPath(d.suggestedFilename());
  await d.saveAs(saved);

  const later = await context.newPage();
  await later.goto(app.url);
  await openWithPicker(later, saved);
  await expectShown(later, path.basename(saved));
  await zoomTo(later, image);
  await expectColour(later, image.x + image.w / 4, image.y + image.h / 2, isRed);
  await expectColour(later, image.x + (3 * image.w) / 4, image.y + image.h / 2, isBlue);
  await later.screenshot({ path: test.info().outputPath('2-saved-drawing-reopened.png') });
  await expect(later.getByRole('alert')).toHaveCount(0);
});
