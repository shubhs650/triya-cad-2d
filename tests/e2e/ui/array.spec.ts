// M3-03: ARRAYRECT, ARRAYPOLAR and ARRAYPATH from the app's command line. Each array is made at
// once and remade as an option changes it, and Enter keeps it; the app's bus, canvas and
// engine worker carry the copies end to end. The prompts and every item's place are
// unit-tested in packages/engine/test/commands/array.test.ts and test/edit/array.test.ts.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function answer(page: Page, text: string, next: string | RegExp): Promise<void> {
  await enterCommand(page, text);
  await expect(prompt(page)).toHaveText(next);
}

/** The start points of the lines this test added, as the change sets left them, sorted. */
const lineStarts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()]
      .flatMap((e) =>
        e.geom.kind === 'LINE'
          ? [[Math.round(e.geom.start.x * 1e4) / 1e4, Math.round(e.geom.start.y * 1e4) / 1e4]]
          : [],
      )
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  });

/** Zooms to a clear patch right of the drawing's hatch (its fill hides white strokes). */
async function clearOfHatch(page: Page): Promise<void> {
  await answer(page, 'ZOOM', /^Specify corner of window/);
  await answer(page, 'W', /^Specify first corner/);
  await answer(page, '-222,550', /^Specify opposite corner/);
  await answer(page, '-183,602', 'Command:');
}

async function stroke(page: Page): Promise<void> {
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-216,580', 'Specify next point or [Undo]:');
  await answer(page, '-214,582', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
}

/** The INSERTs this test added (the array objects and their items), as the change sets left them. */
const insertBlocks = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].flatMap((e) =>
      e.geom.kind === 'INSERT' ? [{ owner: e.owner, block: e.geom.block }] : [],
    );
  });

/** The INSERTs this test added (the array objects), as the change sets left them. */
const inserts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].filter((e) => e.geom.kind === 'INSERT').map((e) => e.owner);
  });

const EDIT_RECT =
  'Select grip to edit array or [ASsociative/Base point/COUnt/Spacing/COLumns/Rows/eXit] <eXit>:';
const EDIT_POLAR =
  'Select grip to edit array or [ASsociative/Base point/Items/Angle between/Fill angle/ROWs/ROTate items/eXit] <eXit>:';
const ARRAYEDIT_RECT =
  'Enter an option [Source/REPlace/Base point/Rows/Columns/RESet/eXit] <eXit>:';
const EDIT_PATH =
  'Select grip to edit array or [ASsociative/Method/Base point/Tangent direction/Items/Rows/Align items/eXit] <eXit>:';

test('ARRAYRECT, ARRAYPOLAR and ARRAYPATH copy objects in rows, round a centre and along a path', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await clearOfHatch(page);
  // Separate objects (ARRAYASSOCIATIVITY 0); associative arrays are the test below.
  await answer(page, 'ARRAYASSOCIATIVITY', 'Enter new value for ARRAYASSOCIATIVITY <1>:');
  await answer(page, '0', 'Command:');

  // A short diagonal stroke, the object the rectangular array copies.
  await stroke(page);
  await shot('1-before.png');

  await answer(page, 'ARRAYRECT', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', EDIT_RECT);
  await expect(log).toContainText('Type = Rectangular  Associative = No');
  // 4 columns by 3 rows, at 1.5 × the stroke's 2 × 2 extents.
  await expect.poll(() => lineStarts(page).then((l) => l.length)).toBe(12);
  await answer(page, 'COU', 'Enter number of columns <4>:');
  await answer(page, '5', 'Enter number of rows <3>:');
  await answer(page, '2', EDIT_RECT);
  await expect.poll(() => lineStarts(page).then((l) => l.length)).toBe(10);
  await shot('2-rectangular.png');
  await answer(page, '', 'Command:');
  const rect = await lineStarts(page);
  expect(rect).toContainEqual([-216, 580]);
  expect(rect).toContainEqual([-204, 583]);

  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-192,592', 'Specify next point or [Undo]:');
  await answer(page, '-189,592', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYPOLAR', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', 'Specify center point of array or [Base point]:');
  await answer(page, '-197,592', EDIT_POLAR);
  await answer(page, 'I', 'Enter number of items in array <6>:');
  await answer(page, '8', EDIT_POLAR);
  await shot('3-polar.png');
  await answer(page, '', 'Command:');
  await expect.poll(() => lineStarts(page).then((l) => l.length)).toBe(10 + 8);

  // A path below the rows, and a tick at its start: 5 ticks divide it evenly.
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-216,562', 'Specify next point or [Undo]:');
  await answer(page, '-188,562', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-216,557', 'Specify next point or [Undo]:');
  await answer(page, '-215,559', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYPATH', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', 'Select path curve:');
  await answer(page, '-210,562', EDIT_PATH);
  await answer(page, 'M', 'Enter path method [Divide/Measure] <Measure>:');
  await answer(page, 'D', EDIT_PATH);
  await answer(page, 'I', /^Enter number of items along path <\d+>:$/);
  await answer(page, '5', EDIT_PATH);
  await shot('4-path.png');
  await answer(page, '', 'Command:');
  const all = await lineStarts(page);
  for (const x of [-216, -209, -202, -195, -188]) expect(all).toContainEqual([x, 557]);
});

test('ARRAYRECT makes one associative array object, which ARRAYEDIT changes (M3-11)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await clearOfHatch(page);
  await stroke(page);

  await answer(page, 'ARRAYRECT', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', EDIT_RECT);
  await expect(log).toContainText('Type = Rectangular  Associative = Yes');
  await answer(page, '', 'Command:');
  // The stroke and its copies are one array object: an INSERT in model space (its item INSERTs
  // are in its own block).
  await expect.poll(() => inserts(page).then((o) => o.length)).toBeGreaterThan(1);
  const spaces = await inserts(page);
  const space = spaces.find((o) => spaces.filter((x) => x === o).length === 1)!;
  expect(spaces.filter((o) => o !== space)).toHaveLength(12);
  await shot('5-associative.png');

  await answer(page, 'ARRAYEDIT', 'Select array:');
  await answer(page, 'L', ARRAYEDIT_RECT);
  await answer(page, 'C', 'Enter number of columns <4>:');
  await answer(page, '5', /^Specify the distance between columns or \[Total\]/);
  await answer(page, '', ARRAYEDIT_RECT);
  await answer(page, 'R', 'Enter the number of rows <3>:');
  await answer(page, '2', /^Specify the distance between rows or \[Total\]/);
  await answer(page, '', ARRAYEDIT_RECT);
  await expect.poll(() => inserts(page).then((o) => o.filter((x) => x !== space).length)).toBe(10);
  await shot('6-arrayedit.png');
  await answer(page, '', 'Command:');
});

test('ARRAYEDIT edits an item’s source objects until ARRAYCLOSE, and REPlace swaps items (M3-11 part 2)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await clearOfHatch(page);
  await stroke(page);
  await answer(page, 'ARRAYRECT', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', EDIT_RECT);
  await answer(page, '', 'Command:');
  await shot('7-array.png');

  // Source: the item in column 3, row 2 (its stroke's centre is -209,584) opens for editing; a
  // line drawn beside it joins every item.
  await answer(page, 'ARRAYEDIT', 'Select array:');
  await answer(page, 'L', ARRAYEDIT_RECT);
  await answer(page, 'S', 'Select item in array:');
  await answer(page, '-209,584', 'Command:');
  await expect(log).toContainText(
    'Edit the item, then save or discard the changes with ARRAYCLOSE.',
  );
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-210,583', 'Specify next point or [Undo]:');
  await answer(page, '-208,583', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await shot('8-source-editing.png');
  await answer(page, 'ARRAYCLOSE', 'Save changes to array [Yes/No] <Yes>:');
  await answer(page, '', 'Command:');
  await shot('9-source-saved.png');

  // REPlace: a short cross-stroke becomes the item in column 2, row 1 and in column 4, row 3.
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '-196,571', 'Specify next point or [Undo]:');
  await answer(page, '-194,569', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYEDIT', 'Select array:');
  await answer(page, 'P', ARRAYEDIT_RECT);
  await answer(page, 'REP', 'Select replacement objects:');
  await answer(page, 'L', 'Select replacement objects:');
  await answer(page, '', 'Select base point of replacement objects <centroid>:');
  await answer(page, '', 'Select an item in array to replace or [Source objects]:');
  await answer(page, '-212,581', 'Select an item in array to replace or [Source objects]:');
  await answer(page, '-206,587', 'Select an item in array to replace or [Source objects]:');
  await answer(page, '', ARRAYEDIT_RECT);
  await answer(page, '', 'Command:');
  // The array INSERT and its 12 items, 2 of them showing the replacement block.
  const items = await insertBlocks(page);
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.block, (counts.get(i.block) ?? 0) + 1);
  expect([...counts.values()].sort((a, b) => a - b)).toEqual([1, 2, 10]);
  await shot('10-replaced.png');
});
