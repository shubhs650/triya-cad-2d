// M5-07 part 2: the Layer States Manager, opened from the Layer Properties Manager's Layer States
// Manager button and by LAYERSTATE (LAS) at the command line. clockwise_arcs_hatch.dxf has layers
// 0 and HATCH, and no layer states.
// - New... saves a state (Same as DWG: Yes), which turning HATCH off makes No; Restore turns it
//   back on, closes the dialog, and the Layer Properties Manager names the state restored.
// - Export... downloads `<name>.las`; Import... reads it back, asking to overwrite a state of the
//   same name; Rename (F2) and Delete; More Restore Options' Layer properties to restore are the
//   selected state's own.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DXF, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function openLayers(page: Page): Promise<Locator> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  return palette;
}

const manager = (page: Page) => page.getByRole('dialog', { name: 'Layer States Manager' });
const states = (page: Page) => manager(page).getByRole('table', { name: 'Layer states' });
const stateRow = (page: Page, name: string) =>
  states(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

test('saves, restores, exports and imports layer states (M5-07)', async ({ page }) => {
  const palette = await openLayers(page);
  const layerState = palette.getByRole('status', { name: 'Layer state' });
  await expect(layerState).toHaveText('Unsaved Layer State');

  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await expect(manager(page)).toBeVisible();
  await expect(states(page)).toContainText('No layer states saved');
  await expect(manager(page).getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();

  // New...: a state of every layer as it is.
  await manager(page).getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'New Layer State to Save' });
  await create.getByLabel('New layer state name:').fill('All on');
  await create.getByLabel('Description').fill('Every layer shown');
  await create.getByRole('button', { name: 'OK' }).click();
  await expect(create).toBeHidden();
  await expect(stateRow(page, 'All on').getByRole('cell')).toHaveText([
    'Model',
    'Yes',
    'Every layer shown',
  ]);
  await expect(stateRow(page, 'All on')).toHaveAttribute('aria-selected', 'true');
  await manager(page).getByRole('button', { name: 'Close' }).click();
  await expect(manager(page)).toBeHidden();

  // HATCH turned off: the drawing is no longer as the state has it.
  const on = palette.getByRole('button', { name: 'On HATCH' });
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'false');

  await enterCommand(page, 'LAS');
  await expect(manager(page)).toBeVisible();
  await expect(stateRow(page, 'All on').getByRole('cell').nth(1)).toHaveText('No');
  await manager(page).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(manager(page)).toBeHidden();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await expect(layerState).toHaveText('All on');

  // Export... the state as All on.las.
  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await expect(stateRow(page, 'All on').getByRole('cell').nth(1)).toHaveText('Yes');
  const downloading = page.waitForEvent('download');
  await manager(page).getByRole('button', { name: 'Export...' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('All on.las');
  const file = test.info().outputPath('All on.las');
  await download.saveAs(file);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('LAYERSTATEDICTIONARY');
  expect(text).toMatch(/\s+8\r\nHATCH\r\n/);

  // Rename it in place (F2), then import the file: no clash, so it comes in as All on again.
  await stateRow(page, 'All on').click();
  await page.keyboard.press('F2');
  const name = manager(page).getByRole('textbox', { name: 'Name of All on' });
  await expect(name).toBeFocused();
  await name.fill('Mine');
  await name.press('Enter');
  await expect(stateRow(page, 'Mine')).toBeVisible();
  const importer = manager(page).getByLabel('Layer state file to import');
  await importer.setInputFiles(file);
  await expect(stateRow(page, 'All on')).toBeVisible();
  await expect(manager(page).getByRole('status')).toHaveText('Layer state imported: All on.');

  // Importing it again asks to overwrite it.
  await importer.setInputFiles(file);
  const overwrite = manager(page).getByRole('alertdialog', { name: 'Layer State - Overwrite' });
  await expect(overwrite).toContainText('The layer state "All on" already exists.');
  await overwrite.getByRole('button', { name: 'Yes' }).click();
  await expect(overwrite).toBeHidden();
  await expect(states(page).getByRole('rowheader')).toHaveText(['All on', 'Mine']);

  // Layer properties to restore are the selected state's own.
  await stateRow(page, 'Mine').click();
  await manager(page).getByRole('button', { name: 'More Restore Options' }).click();
  const color = manager(page).getByRole('checkbox', { name: 'Color', exact: true });
  await expect(color).toBeChecked();
  await color.click();
  await expect(color).not.toBeChecked();
  await stateRow(page, 'All on').click();
  await expect(color).toBeChecked();
  await stateRow(page, 'Mine').click();
  await expect(color).not.toBeChecked();
  await manager(page).getByRole('button', { name: 'Clear All' }).click();
  await expect(manager(page).getByRole('checkbox', { name: 'On/Off' })).not.toBeChecked();

  // Delete, from the keyboard.
  await stateRow(page, 'Mine').press('Delete');
  await expect(states(page).getByRole('rowheader')).toHaveText(['All on']);
  await page.keyboard.press('Escape');
  await expect(manager(page)).toBeHidden();
});
