// M1-50: the user's .pat files. A hatch saved without its pattern lines (a custom pattern the
// drawing only names) draws nothing until the user adds a .pat that defines it, by dropping it
// on the window or picking it in Settings; the file stays on the device across a reload, and
// removing it in Settings takes the lines away again.
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectDrawn, expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/**
 * A LINE along the bottom (so the drawing is never blank) and a HATCH over (10,10)–(90,90)
 * naming the custom pattern MY_GRID with no pattern lines stored (DXF 78 = 0).
 */
const DRAWING = [
  ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015'],
  ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
  ...['0', 'LINE', '5', '100', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine'],
  ...['10', '0', '20', '0', '30', '0', '11', '100', '21', '0', '31', '0'],
  ...['0', 'HATCH', '5', '101', '100', 'AcDbEntity', '8', '0', '100', 'AcDbHatch'],
  ...['10', '0', '20', '0', '30', '0', '210', '0', '220', '0', '230', '1'],
  ...['2', 'MY_GRID', '70', '0', '71', '0', '91', '1', '92', '3', '72', '0', '73', '1', '93', '4'],
  ...[
    '10',
    '10',
    '20',
    '10',
    '10',
    '90',
    '20',
    '10',
    '10',
    '90',
    '20',
    '90',
    '10',
    '10',
    '20',
    '90',
  ],
  ...['97', '0', '75', '0', '76', '2', '52', '0', '41', '1', '77', '0', '78', '0', '98', '0'],
  ...['0', 'ENDSEC', '0', 'EOF', ''],
].join('\r\n');

/** MY_GRID: lines 5 apart both ways, 16 each across the hatch. */
const GRID = '*MY_GRID, a test grid\n0, 0,0, 0,5\n90, 0,0, 0,5\n';
/**
 * Pixels the grid adds at least: 32 lines about 600 px long. The canvas screenshot also holds
 * the line and the navigation bar over the canvas, hence a margin rather than a ratio.
 */
const GRID_INK = 10_000;

function files() {
  const dxf = test.info().outputPath('custom-hatch.dxf');
  const pat = test.info().outputPath('my-grid.pat');
  const bad = test.info().outputPath('notes.pat');
  writeFileSync(dxf, DRAWING);
  writeFileSync(pat, GRID);
  writeFileSync(bad, 'not a pattern\n');
  return { dxf, pat, bad };
}

/**
 * Opens the drawing and returns its ink once its first frame is drawn (M2-61): read any
 * earlier and the baseline is the empty canvas, without the drawing's line.
 */
async function openDrawing(page: Page, dxf: string): Promise<number> {
  await openWithPicker(page, dxf);
  await expectShown(page, 'custom-hatch.dxf');
  await expectDrawn(page, { timeout: 15_000 });
  return ink(page);
}

test('a dropped .pat draws a hatch saved without lines, and stays after a reload', async ({
  page,
}) => {
  const { dxf, pat } = files();
  await page.goto(app.url);
  const bare = await openDrawing(page, dxf);

  await openWithDrop(page, pat);
  await expect(page.getByRole('status')).toHaveText(
    /Added 1 hatch pattern from my-grid\.pat: MY_GRID\./,
  );
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(bare + GRID_INK);

  // Kept on the device: a new visit draws the grid as soon as the drawing opens. Opened once
  // (M2-61): this used to poll `openDrawing`, whose first read always came before the grid's
  // frame, so every run opened a second copy (a third on a busy machine), and which copy the
  // last check read, and when, varied.
  await page.reload();
  await openWithPicker(page, dxf);
  await expectShown(page, 'custom-hatch.dxf');
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(bare + GRID_INK);
  await expect(page.getByRole('tab', { name: 'custom-hatch.dxf' })).toHaveCount(1);

  // Removing the file in Settings takes the lines away.
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('list', { name: 'Pattern files' })).toContainText('my-grid.pat');
  await settings.getByRole('button', { name: 'Remove my-grid.pat' }).click();
  await expect(settings.getByText('No pattern files added.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeLessThan(bare + GRID_INK / 4);
});

test('Settings adds .pat files with its picker and refuses one without patterns', async ({
  page,
}) => {
  const { dxf, pat, bad } = files();
  await page.goto(app.url);
  const bare = await openDrawing(page, dxf);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('No pattern files added.')).toBeVisible();

  const pick = async (file: string) => {
    const chooser = page.waitForEvent('filechooser');
    await settings.getByRole('button', { name: 'Add pattern files…' }).click();
    await (await chooser).setFiles(file);
  };
  await pick(bad);
  await expect(page.getByRole('alert')).toHaveText(/notes\.pat holds no hatch pattern/);
  await pick(pat);
  await expect(settings.getByRole('list', { name: 'Pattern files' })).toContainText('MY_GRID');

  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(bare + GRID_INK);
});
