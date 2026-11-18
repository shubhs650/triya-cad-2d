// M5-07 part 3: Edit Layer State, opened by the Layer States Manager's Edit... (AutoCAD 2024 Help,
// "Edit Layer State Dialog Box"). clockwise_arcs_hatch.dxf has layers 0, Defpoints and HATCH, and
// no layer states; a state of them is saved, then layer Notes made.
// - Edit... lists 0, Defpoints and HATCH with their settings; Cancel keeps the state as it was.
// - "Add layers to layer state" offers Notes only (Select Layers to Add to Layer State); "Remove
//   layers from layer state" takes 0 out; HATCH's On and Lineweight change; OK saves them, Same
//   as DWG becomes No, and Restore turns HATCH off in the Layer Properties Manager.
import { expect, test, type Page } from '@playwright/test';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const manager = (page: Page) => page.getByRole('dialog', { name: 'Layer States Manager' });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit Layer State' });
const stateRow = (page: Page, name: string) =>
  manager(page)
    .getByRole('table', { name: 'Layer states' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) });
const layersOf = (page: Page) =>
  editor(page).getByRole('table', { name: 'Layers in layer state' }).getByRole('rowheader');
const editRow = (page: Page, name: string) =>
  editor(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) });

test('edits the layers a layer state names (M5-07 part 3)', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();

  // A state of every layer, then a layer it does not name.
  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await manager(page).getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'New Layer State to Save' });
  await create.getByLabel('New layer state name:').fill('Plan');
  await create.getByRole('button', { name: 'OK' }).click();
  await expect(stateRow(page, 'Plan')).toHaveAttribute('aria-selected', 'true');
  await manager(page).getByRole('button', { name: 'Close' }).click();
  await expect(manager(page)).toBeHidden();
  await palette.getByRole('button', { name: 'New Layer' }).click();
  const name = palette.getByRole('textbox', { name: 'Name of Layer1' });
  await expect(name).toBeFocused();
  await page.keyboard.type('Notes');
  await page.keyboard.press('Enter');
  await expect(palette.getByRole('rowheader', { name: 'Notes', exact: true })).toBeVisible();

  // Edit... lists the state's layers; Cancel keeps it.
  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await manager(page).getByRole('button', { name: 'Edit...' }).click();
  await expect(editor(page)).toBeVisible();
  await expect(layersOf(page)).toHaveText(['0', 'Defpoints', 'HATCH']);
  const hatchOn = editor(page).getByRole('button', { name: 'On HATCH' });
  await expect(hatchOn).toHaveAttribute('aria-pressed', 'true');
  await shot('1-edit-layer-state.png');
  await hatchOn.click();
  await expect(hatchOn).toHaveAttribute('aria-pressed', 'false');
  await editor(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page)).toBeHidden();
  await manager(page).getByRole('button', { name: 'Edit...' }).click();
  await expect(hatchOn).toHaveAttribute('aria-pressed', 'true');

  // Add layers to layer state: Notes, the one layer the state does not name.
  await editor(page).getByRole('button', { name: 'Add layers to layer state' }).click();
  const adding = page.getByRole('dialog', { name: 'Select Layers to Add to Layer State' });
  const list = adding.getByRole('listbox', { name: 'Layers' });
  await expect(list.getByRole('option')).toHaveText(['Notes']);
  await list.selectOption('Notes');
  await shot('2-select-layers-to-add.png');
  await adding.getByRole('button', { name: 'OK' }).click();
  await expect(adding).toBeHidden();
  await expect(layersOf(page)).toHaveText(['0', 'Defpoints', 'HATCH', 'Notes']);
  await expect(
    editor(page).getByRole('button', { name: 'Add layers to layer state' }),
  ).toBeDisabled();

  // Remove 0; HATCH off, at 0.50 mm.
  await editRow(page, '0').getByRole('rowheader').click();
  await expect(editRow(page, '0')).toHaveAttribute('aria-selected', 'true');
  await editor(page).getByRole('button', { name: 'Remove layers from layer state' }).click();
  await expect(layersOf(page)).toHaveText(['Defpoints', 'HATCH', 'Notes']);
  await hatchOn.click();
  await editor(page).getByRole('button', { name: 'Lineweight HATCH' }).click();
  const weights = page.getByRole('dialog', { name: 'Lineweight' });
  await weights.getByRole('listbox', { name: 'Lineweights' }).selectOption('50');
  await weights.getByRole('button', { name: 'OK' }).click();
  await expect(weights).toBeHidden();
  await expect(editor(page).getByRole('button', { name: 'Lineweight HATCH' })).toHaveText(
    '0.50 mm',
  );
  await shot('3-edited.png');
  await editor(page).getByRole('button', { name: 'OK' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(manager(page).getByRole('status')).toHaveText('Layer state "Plan" edited.');
  await expect(stateRow(page, 'Plan').getByRole('cell').nth(1)).toHaveText('No');

  // Saved: Edit... shows it again; Restore turns HATCH off.
  await manager(page).getByRole('button', { name: 'Edit...' }).click();
  await expect(layersOf(page)).toHaveText(['Defpoints', 'HATCH', 'Notes']);
  await expect(hatchOn).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();
  await expect(manager(page)).toBeVisible();
  await manager(page).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(manager(page)).toBeHidden();
  await expect(palette.getByRole('button', { name: 'On HATCH' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(palette.locator('.layer-state-current span')).toHaveText('Plan');
  await shot('4-restored.png');
});
