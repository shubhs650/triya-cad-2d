// M6-02 part 11: VPORTS opens the Viewports dialog (AutoCAD 2024 Help, "Viewports Dialog Box").
// New Viewports arranges model space's tiled viewports from Standard viewports and saves the
// arrangement under its New name; Named Viewports shows the current name, renames and deletes
// through the list's shortcut menu (and F2), and restores the configuration picked. In a layout
// OK asks for the area of the new layout viewports. The drawing is written here: one `*Active`
// VPORT looking at two circles, as the tiled viewports spec writes it.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const VPORT = [
  ...['0', 'VPORT', '5', '2E', '330', '8', '100', 'AcDbSymbolTableRecord'],
  ...['100', 'AcDbViewportTableRecord', '2', '*Active', '70', '0'],
  ...['10', '0', '20', '0', '11', '1', '21', '1'],
  ...['12', '50', '22', '0', '13', '0', '23', '0', '14', '1', '24', '1'],
  ...['15', '1', '25', '1', '16', '0', '26', '0', '36', '1', '17', '0', '27', '0', '37', '0'],
  ...['40', '40', '41', '2', '42', '50', '43', '0', '44', '0', '50', '0', '51', '0'],
  ...['71', '0', '72', '1000', '73', '1', '74', '3', '75', '0', '76', '0', '77', '0', '78', '0'],
];

const circle = (handle: string, x: number, r: number) => [
  ...['0', 'CIRCLE', '5', handle, '100', 'AcDbEntity', '8', '0', '100', 'AcDbCircle'],
  ...['10', `${x}`, '20', '0', '30', '0', '40', `${r}`],
];

const DRAWING = [
  ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015'],
  ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC'],
  ...['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'VPORT', '5', '8', '330', '0'],
  ...['100', 'AcDbSymbolTable', '70', '1'],
  ...VPORT,
  ...['0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
  ...circle('100', 0, 5),
  ...circle('101', 100, 10),
  ...['0', 'ENDSEC', '0', 'EOF'],
].join('\n');

/** The model canvases of the drawing, current or not. */
const tiles = (page: Page) => page.locator('canvas[aria-label^="Model"]');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Viewports' });

/** With TRIYA_SCREENSHOTS set, a picture for the PR (M6-02 part 11). */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test.describe('the Viewports dialog', () => {
  test.describe.configure({ timeout: 90_000 });

  test('arranges, names, renames and restores model viewports', async ({ page }) => {
    const file = test.info().outputPath('one-viewport.dxf');
    writeFileSync(file, DRAWING);
    await page.goto(app.url);
    await openWithPicker(page, file);
    await expectShown(page, 'one-viewport.dxf');
    await expect(tiles(page)).toHaveCount(1);

    // New Viewports: Three: Right under the name Trio; the preview shows the arrangement.
    await enterCommand(page, 'VPORTS');
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole('tab', { name: 'New Viewports' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await d.getByLabel('Standard viewports:').selectOption('Three: Right');
    const preview = d.getByTestId('viewports-preview');
    await expect(preview.getByRole('button')).toHaveCount(3);
    await d.getByLabel('New name:').fill('Trio');
    await shot(page, '1-new-viewports');
    await d.getByRole('button', { name: 'OK' }).click();
    await expect(d).toBeHidden();
    await expect(tiles(page)).toHaveCount(3);
    // The large one, on the right, is current.
    const boxes = await Promise.all(
      [0, 1, 2].map(async (i) => (await tiles(page).nth(i).boundingBox())!),
    );
    await expect(tiles(page).nth(0)).toHaveAttribute('data-active', 'true');
    expect(boxes[0]!.x).toBeGreaterThan(boxes[1]!.x);
    expect(boxes[0]!.height).toBeGreaterThan(boxes[1]!.height * 1.5);
    await shot(page, '2-three-right');

    // Named Viewports: Trio is current; renamed with the shortcut menu.
    await enterCommand(page, 'VPORTS');
    await d.getByRole('tab', { name: 'Named Viewports' }).click();
    await expect(d.getByTestId('viewports-current')).toHaveText('Trio');
    const list = d.getByRole('listbox', { name: 'Named viewports:' });
    await list.getByRole('option', { name: 'Trio' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await d.getByLabel('New name').fill('Three up');
    await d.getByLabel('New name').press('Enter');
    await expect(list.getByRole('option', { name: 'Three up' })).toBeVisible();
    await expect(d.getByTestId('viewports-preview').locator('.viewports-tile')).toHaveCount(3);
    await shot(page, '3-named-viewports');
    await d.getByRole('button', { name: 'OK' }).click();
    await expect(d).toBeHidden();

    // Single, then the named one restored by a double click.
    await enterCommand(page, 'VPORTS');
    await d.getByLabel('Standard viewports:').selectOption('Single');
    await d.getByRole('button', { name: 'OK' }).click();
    await expect(tiles(page)).toHaveCount(1);
    await enterCommand(page, 'VPORTS');
    await d.getByRole('tab', { name: 'Named Viewports' }).click();
    await expect(d.getByTestId('viewports-current')).toHaveText('*Active');
    await list.getByRole('option', { name: 'Three up' }).dblclick();
    await expect(d).toBeHidden();
    await expect(tiles(page)).toHaveCount(3);

    // Esc changes nothing; F2 and Delete work from the keyboard, done only at OK.
    await enterCommand(page, 'VPORTS');
    await d.getByRole('tab', { name: 'Named Viewports' }).click();
    await list.focus();
    await list.press('Delete');
    await expect(list.getByRole('option')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await enterCommand(page, 'VPORTS');
    await d.getByRole('tab', { name: 'Named Viewports' }).click();
    await expect(list.getByRole('option', { name: 'Three up' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await expect(tiles(page)).toHaveCount(3);
  });

  test('makes layout viewports in the area picked after OK', async ({ page }) => {
    // self-authored/viewport-overrides.dxf has a Layout1 (with four viewports of its own).
    const file = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');
    await page.goto(app.url);
    await openWithPicker(page, file);
    await expectShown(page, path.basename(file));
    await page
      .getByRole('tablist', { name: 'Model and layouts' })
      .getByRole('tab', { name: 'Layout1' })
      .click();
    await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
    await enterCommand(page, 'VPORTS');
    const d = dialog(page);
    await expect(d.getByLabel('New name:')).toBeDisabled();
    await d.getByLabel('Standard viewports:').selectOption('Two: Vertical');
    await d.getByLabel('Viewport Spacing:').fill('5');
    await shot(page, '4-layout-new-viewports');
    await d.getByRole('button', { name: 'OK' }).click();
    await expect(d).toBeHidden();
    await expect(page.getByTestId('command-prompt')).toContainText('Specify first corner or');
    await enterCommand(page, '20,20');
    await enterCommand(page, '220,150');
    await expectInputsRead(page);
    await expectDrawn(page, { timeout: 15_000 });
    await shot(page, '5-layout-viewports');
    // One VPORTS step, which U takes back.
    await enterCommand(page, 'U');
    await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('VPORTS');
  });
});
