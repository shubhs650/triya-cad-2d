// M2-14 part 2: objects copied in one open drawing and pasted into another, through the app's
// shared Clipboard, as a drafter does it: Ctrl+C in the drawing copied from, a click on the
// other drawing's tab, Ctrl+V and an insertion point typed at the prompt; then PASTEORIG.
// The commands' prompts and the paste's records, blocks and handles are unit-tested in
// packages/engine/test; this checks that the app carries the Clipboard between drawings.
//
// M2-32 part 2: images and PDF underlays pasted into another drawing bring their definitions
// and show the files the user supplied, as they do in the drawing they came from.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DWG, DXF, colourAt, expectShown, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The objects the showing drawing's edits added, by type, in order. */
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.entities?.added ?? [])
      .map((a) => a.entity.type),
  );

const prompt = (page: Page) => page.getByTestId('command-prompt');
const docTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Ctrl+C in one drawing and Ctrl+V in another pastes the objects there', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));

  // Nothing copied yet.
  await type(page, 'PASTECLIP', 'Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText('The Clipboard holds no objects to paste.');

  await docTabs(page).first().click();
  await expectShown(page, path.basename(DXF));
  await page.keyboard.press('Control+c');
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');
  // Copying changes nothing in the drawing copied from.
  expect(await added(page)).toEqual([]);

  await docTabs(page).nth(1).click();
  await expectShown(page, path.basename(DWG));
  await page.keyboard.press('Control+v');
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, '0,0', 'Command:');
  await expect.poll(() => added(page)).toEqual(['HATCH']);

  // PASTEORIG: at the objects' own coordinates, from another drawing only.
  await type(page, 'PASTEORIG', 'Command:');
  await expect.poll(() => added(page)).toEqual(['HATCH', 'HATCH']);
  await docTabs(page).first().click();
  await expectShown(page, path.basename(DXF));
  await type(page, 'PASTEORIG', 'Command:');
  await expect(log).toContainText('PASTEORIG pastes objects copied from another drawing only.');
  expect(await added(page)).toEqual([]);
});

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures');
const RASTER = path.join(FIXTURES, 'raster/raster-images.dxf');
const UNDERLAY = path.join(FIXTURES, 'underlay/pdf-underlay.dxf');

/** The definitions the showing drawing's edits added, as `TYPE name`. */
const definitionsAdded = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.objects?.added ?? [])
      .map((o) => `${o.type} ${(o as { name?: string }).name}`)
      .sort(),
  );

type Rgb = readonly number[];
const isRed = ([r, g, b]: Rgb) => r! > 200 && g! < 60 && b! < 60;
const isBlue = ([r, g, b]: Rgb) => b! > 200 && r! < 60 && g! < 60;

/** COPYBASE from (0, 0) of everything in the showing drawing. */
async function copyAll(page: Page): Promise<void> {
  await type(page, 'COPYBASE', 'Specify base point:');
  await type(page, '0,0', 'Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');
}

/** PASTECLIP at (100, 0), then ZOOM Window on what landed there. */
async function pasteAt100(page: Page): Promise<void> {
  await type(page, 'PASTECLIP', 'Specify insertion point:');
  await type(page, '100,0', 'Command:');
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '99,-1', 'Specify opposite corner:');
  await type(page, '117,11', 'Command:');
}

test('images and PDF underlays pasted into another drawing bring their definitions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  // The files the drawings show, supplied this session.
  await openWithDrop(page, [
    path.join(FIXTURES, 'raster/checker.png'),
    path.join(FIXTURES, 'underlay/pdf-underlay.pdf'),
  ]);
  await openWithPicker(page, RASTER);
  await expectShown(page, 'raster-images.dxf');
  await openWithPicker(page, UNDERLAY);
  await expectShown(page, 'pdf-underlay.dxf');
  const poll = (p: { x: number; y: number }, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colourAt(page, p)), { timeout: 30_000 }).toBe(true);

  // The underlays into the drawing of images: page 1's red square at (2, 2) lands at (102, 2).
  await copyAll(page);
  await docTabs(page).first().click();
  await expectShown(page, 'raster-images.dxf');
  await pasteAt100(page);
  expect(await definitionsAdded(page)).toEqual([
    'PDFDEFINITION pdf-underlay - 1',
    'PDFDEFINITION pdf-underlay - 2',
  ]);
  let v = await viewOf(page);
  await poll(v.at(102, 2), isRed);

  // The images into the drawing of underlays: image A (checker.png) at 100..104 × 0..4,
  // red over blue, as in the drawing it came from.
  await copyAll(page);
  await docTabs(page).nth(1).click();
  await expectShown(page, 'pdf-underlay.dxf');
  await pasteAt100(page);
  expect((await definitionsAdded(page)).filter((d) => d.startsWith('IMAGEDEF'))).not.toEqual([]);
  v = await viewOf(page);
  await poll(v.at(101, 3), isRed);
  await poll(v.at(101, 1), isBlue);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
