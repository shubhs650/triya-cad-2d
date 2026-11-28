// M8-03: the library palette's insert scenarios. LIB opens the palette; a search finds the weld
// neck flange, Class 300 NPS 6 is picked, the preview draws it and Insert attaches it to the
// cursor: a click inserts it at scale 1, its block drawn in the drawing's millimetres (the
// flange's 12.5 in. outside diameter is 317.5 mm), one INSERT step that U takes back with the
// block; it is then listed under Recent. A saddle sized in an inch drawing is kept as a
// favourite, which in millimetres is drawn the same size (60 in. is 1524 mm), survives a reload
// and is inserted from Favorites. The catalogue and the engine side are unit-tested in
// packages/library/test/catalogue.test.ts and packages/engine/test/commands/library.test.ts.
// M8-03 part 2: a drafter's own symbol file (valves.dxf, in inches) dropped on the palette is
// kept in My Library, its blocks listed, found by the search, previewed and inserted into a
// millimetre drawing at INSERT's 25.4 conversion; a folder made with New Folder... takes a drop
// of its own, a folder removed goes, and the folders survive a reload (the origin-private file
// system). The folder store is unit-tested in apps/web/test/user-library.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, CircleGeometry, InsertGeometry } from '@triya/engine';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCKED_PALETTES,
  DXF,
  activeCanvas,
  dropFiles,
  enterCommand,
  expectInputsRead,
  expectShown,
  gridOff,
  openWithPicker,
  worldAt,
} from '../app/page';
import { blocking, checkA11y } from '../app/a11y';
import { startApp } from '../app/server';

const VALVES = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/library/valves.dxf', import.meta.url),
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const log = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });
const palette = (page: Page) => page.getByRole('complementary', { name: 'Library' });

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The references the drawing shown has had added since it opened, and their blocks' circles. */
const inserted = (page: Page) =>
  page.evaluate(() => {
    const blocks = new Map<string, string>();
    const radii = new Map<string, number[]>();
    const inserts = new Map<string, { block: string; x: number; y: number; scale: number }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const r of cs.tables?.blockRecords?.added ?? []) blocks.set(r.handle, r.name);
      for (const r of cs.tables?.blockRecords?.removed ?? []) blocks.delete(r.handle);
      for (const a of cs.entities?.added ?? []) {
        const g = a.entity.geom;
        if (g.kind === 'CIRCLE') {
          const owner = a.entity.owner;
          radii.set(owner, [...(radii.get(owner) ?? []), (g as CircleGeometry).radius]);
        }
        if (g.kind !== 'INSERT') continue;
        const i = g as InsertGeometry;
        inserts.set(a.entity.handle, {
          block: i.block,
          x: i.position.x,
          y: i.position.y,
          scale: i.scale.x,
        });
      }
      for (const r of cs.entities?.removed ?? []) inserts.delete(r.entity.handle);
    }
    return [...inserts.values()].map((i) => ({
      ...i,
      name: blocks.get(i.block) ?? i.block,
      largest: Math.max(0, ...(radii.get(i.block) ?? [])),
      blocks: [...blocks.values()],
    }));
  });

/** Sets INSUNITS at the command line. */
async function insunits(page: Page, value: number): Promise<void> {
  await enterCommand(page, 'INSUNITS');
  await expect(prompt(page)).toHaveText(/^Enter new value for INSUNITS/);
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
}

async function open(page: Page): Promise<void> {
  // Docked, the palette is beside the canvas, not over it.
  await page.setViewportSize(DOCKED_PALETTES);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
}

/** Insert, then a click on the canvas at `target` (pixels); the reference placed. */
async function insertAt(page: Page, target: { x: number; y: number }) {
  await palette(page).getByRole('button', { name: 'Insert' }).click();
  await expect(prompt(page)).toHaveText(/^Specify insertion point/);
  const at = await worldAt(page, target.x, target.y);
  await activeCanvas(page).click({ position: target });
  await expect(prompt(page)).toHaveText('Command:');
  return at;
}

test('finds a flange, previews it and inserts it at scale 1 in the drawing’s units', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  await insunits(page, 4);
  await enterCommand(page, 'LIB');
  const lib = palette(page);
  await expect(lib).toBeVisible();
  await expect(lib.getByTestId('library-units')).toHaveText(
    'Drawn in millimetres, inserted at scale 1.',
  );
  await lib.getByRole('searchbox', { name: 'Search library' }).fill('weld neck');
  const items = lib.getByRole('listbox', { name: 'Library items' });
  await expect(items.getByRole('option')).toHaveCount(1);
  await items.getByRole('option', { name: /Weld neck flange/ }).click();
  const item = lib.getByRole('region', { name: 'Weld neck flange' });
  await item.getByLabel('Class').selectOption('300');
  await item.getByLabel('NPS').selectOption('6');
  await expect(lib.getByTestId('library-block-name')).toHaveText('ASME_B16.5_WN_CL300_NPS6_FRONT');
  await expect(lib.getByTestId('library-preview')).toHaveAttribute('data-drawn', /library/);
  await shot(page, '1-weld-neck-flange');
  // The palette with an item's form open passes the accessibility checks (M7-10).
  expect(blocking(await checkA11y(page))).toEqual([]);

  const target = { x: 260, y: 240 };
  const at = await insertAt(page, target);
  await expect.poll(async () => (await inserted(page)).length).toBe(1);
  const [ref] = await inserted(page);
  expect(ref!.name).toBe('ASME_B16.5_WN_CL300_NPS6_FRONT');
  expect(ref!.scale).toBe(1);
  // The flange's outside diameter, 12.5 in., in millimetres.
  expect(ref!.largest).toBeCloseTo(317.5 / 2, 6);
  const view = await worldAt(page, target.x + 1, target.y);
  const pixel = Math.abs(view.x - at.x);
  expect(Math.abs(ref!.x - at.x)).toBeLessThanOrEqual(2 * pixel + 1e-9);
  expect(Math.abs(ref!.y - at.y)).toBeLessThanOrEqual(2 * pixel + 1e-9);
  await expect(log(page)).toContainText('Block(s) added: ASME_B16.5_WN_CL300_NPS6_FRONT.');
  await shot(page, '2-flange-inserted');

  // Listed under Recent once the search is cleared.
  await lib.getByRole('searchbox', { name: 'Search library' }).fill('');
  await expect(lib.getByRole('region', { name: 'Recent' })).toContainText(
    'ASME_B16.5_WN_CL300_NPS6_FRONT',
  );

  // One INSERT step: U takes the reference and the block back.
  await expectInputsRead(page);
  await enterCommand(page, 'U');
  await expect(log(page)).toContainText('INSERT');
  await expect.poll(async () => (await inserted(page)).length).toBe(0);
});

test('keeps a favourite, drawn the same size in other units, after a reload', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page);
  await insunits(page, 1);
  await enterCommand(page, 'LIBRARY');
  const lib = palette(page);
  await expect(lib.getByTestId('library-units')).toHaveText(
    'Drawn in inches, inserted at scale 1.',
  );
  await lib.getByRole('searchbox', { name: 'Search library' }).fill('saddle');
  // Keyboard operable: Enter picks the option focused.
  await lib.getByRole('option', { name: 'Saddle support' }).focus();
  await page.keyboard.press('Enter');
  const item = lib.getByRole('region', { name: 'Saddle support' });
  await expect(item.getByLabel('Vessel OD (inches)')).toHaveValue('60');
  await expect(lib.getByTestId('library-block-name')).toHaveText(/^TRIYA_SADDLE_D60_H42_A120_/);
  await item.getByRole('button', { name: '☆ Add to Favorites' }).click();
  await expect(item.getByRole('button', { name: '★ Remove from Favorites' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await lib.getByRole('searchbox', { name: 'Search library' }).fill('');
  const favorites = lib.getByRole('region', { name: 'Favorites' });
  await expect(favorites).toContainText('Saddle support');

  // In millimetres the favourite is drawn the same size.
  await insunits(page, 4);
  await expect(lib.getByTestId('library-units')).toHaveText(
    'Drawn in millimetres, inserted at scale 1.',
  );
  await favorites.getByRole('button', { name: /Saddle support/ }).click();
  await expect(item.getByLabel('Vessel OD (millimetres)')).toHaveValue('1524');
  await expect(lib.getByTestId('library-block-name')).toHaveText(/^TRIYA_SADDLE_D1524_H1066.8_/);
  await shot(page, '3-saddle-favorite');

  // Kept on the device: after a reload the palette lists it still.
  await page.reload();
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await insunits(page, 4);
  // The palettes open before the reload open again.
  await expect(lib).toBeVisible();
  await lib
    .getByRole('region', { name: 'Favorites' })
    .getByRole('button', { name: /Saddle support/ })
    .click();
  await expect(lib.getByTestId('library-block-name')).toHaveText(/^TRIYA_SADDLE_D1524_H1066.8_/);
  await insertAt(page, { x: 300, y: 260 });
  await expect
    .poll(async () => (await inserted(page)).map((r) => r.name))
    .toEqual([expect.stringMatching(/^TRIYA_SADDLE_D1524_H1066.8_/)]);
});

test('keeps drawing files dropped on the palette in folders and inserts their blocks', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await open(page);
  await insunits(page, 4);
  await enterCommand(page, 'LIB');
  const lib = palette(page);
  const search = lib.getByRole('searchbox', { name: 'Search library' });
  const mine = lib.getByRole('region', { name: 'My library folders' });
  await expect(mine).toContainText('Drop drawing files here to keep their blocks in your library.');

  // Dropped on the palette, the file is kept in My Library, not opened.
  await dropFiles(page, lib, VALVES);
  await expect(mine.getByRole('status')).toHaveText('Added valves.dxf to My Library.');
  const valves = mine.getByRole('listbox', { name: 'valves.dxf' });
  await expect(valves.getByRole('option')).toHaveText(['CHECK-VALVE', 'GATE-VALVE']);
  await expect(page.getByRole('tab', { name: /valves/ })).toHaveCount(0);

  // Found by the search, previewed, and inserted converted from its inches.
  await search.fill('gate');
  await expect(valves.getByRole('option')).toHaveText(['GATE-VALVE']);
  await valves.getByRole('option', { name: 'GATE-VALVE' }).click();
  await expect(lib.getByRole('region', { name: 'GATE-VALVE' })).toBeVisible();
  await expect(lib.getByTestId('library-block-name')).toHaveText('valves.dxf in My Library');
  await expect(lib.getByTestId('library-block-units')).toHaveText(
    'Drawn in inches: Insert converts it to the drawing’s units.',
  );
  await expect(lib.getByTestId('library-preview')).toHaveAttribute('data-drawn', /library/);
  await shot(page, '4-user-library-block');
  expect(blocking(await checkA11y(page))).toEqual([]);
  await insertAt(page, { x: 260, y: 240 });
  await expect.poll(async () => (await inserted(page)).length).toBe(1);
  const [ref] = await inserted(page);
  expect(ref!.name).toBe('GATE-VALVE');
  expect(ref!.scale).toBeCloseTo(25.4, 9);
  expect(ref!.largest).toBeCloseTo(0.5, 9);
  await expect(log(page)).toContainText('Block(s) added: GATE-VALVE.');
  await shot(page, '5-user-block-inserted');

  // A folder of the drafter's naming takes a drop of its own.
  await search.fill('');
  await mine.getByRole('button', { name: 'New Folder...' }).click();
  await mine.getByRole('textbox', { name: 'New folder name' }).fill('Piping');
  await page.keyboard.press('Enter');
  const folder = (name: string) =>
    mine.locator('.library-folder', {
      has: page.getByRole('button', { name, exact: true }),
    });
  await expect(mine.getByRole('button', { name: 'Piping', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dropFiles(page, folder('Piping'), VALVES);
  await expect(mine.getByRole('status')).toHaveText('Added valves.dxf to Piping.');
  await expect(folder('Piping').getByRole('option')).toHaveText(['CHECK-VALVE', 'GATE-VALVE']);
  await mine.getByRole('button', { name: 'Remove folder My Library' }).click();
  await expect(mine.getByRole('button', { name: 'My Library', exact: true })).toHaveCount(0);
  await mine.scrollIntoViewIfNeeded();
  await shot(page, '6-user-library-folders');

  // Kept on the device: after a reload the folder and its file are there still.
  await page.reload();
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await insunits(page, 4);
  await expect(lib).toBeVisible();
  await expect(mine.getByRole('button', { name: 'My Library', exact: true })).toHaveCount(0);
  await folder('Piping').getByRole('option', { name: 'CHECK-VALVE' }).click();
  await expect(lib.getByTestId('library-block-name')).toHaveText('valves.dxf in Piping');
  await insertAt(page, { x: 300, y: 260 });
  await expect.poll(async () => (await inserted(page)).length).toBe(1);
  const [check] = await inserted(page);
  expect(check!.name).toBe('CHECK-VALVE');
  expect(check!.scale).toBeCloseTo(25.4, 9);
  expect(check!.largest).toBeCloseTo(0.75, 9);
});
