// M5-07 part 7: a named view's layer snapshot, on clockwise_arcs_hatch.dxf. New View's "Save
// layer snapshot with view" (checked to start with) keeps the layers with the view, hidden from
// the Layer States Manager; Set Current and OK restore them with the view; Update Layers saves
// them again; the Layer snapshot row says Yes or No and its No takes the snapshot off.
import path from 'node:path';
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

const prompt = (page: Page) => page.getByTestId('command-prompt');
const manager = (page: Page) => page.getByRole('dialog', { name: 'View Manager' });
const newView = (page: Page) => page.getByRole('dialog', { name: 'New View / Shot Properties' });
const props = (page: Page) => manager(page).getByRole('table', { name: 'View properties' });
const item = (page: Page, name: string) =>
  manager(page).getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name, exact: true });

async function openManager(page: Page): Promise<void> {
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'VIEW');
  await expect(manager(page)).toBeVisible();
}

async function closeManager(page: Page, button: 'OK' | 'Cancel'): Promise<void> {
  await manager(page).getByRole('button', { name: button, exact: true }).click();
  await expect(manager(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
}

/** Saves the view shown as `name` with New..., the snapshot check box set to `layers`. */
async function saveView(page: Page, name: string, layers: boolean): Promise<void> {
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await expect(newView(page)).toBeVisible();
  const box = newView(page).getByRole('checkbox', { name: 'Save layer snapshot with view' });
  // Checked to start with, as in AutoCAD.
  await expect(box).toBeChecked();
  if (!layers) await box.uncheck();
  await newView(page).getByLabel('View name').fill(name);
  await newView(page).getByRole('button', { name: 'OK' }).click();
  await expect(newView(page)).toBeHidden();
  await expect(item(page, name)).toHaveAttribute('aria-selected', 'true');
}

test('a view keeps its layer snapshot and restores it with the view', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  const on: Locator = palette.getByRole('button', { name: 'On HATCH' });
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  const snapshot = props(page).getByRole('combobox', { name: 'Layer snapshot' });

  // HATCH on, saved with the view; a second view saved without a snapshot.
  await openManager(page);
  await saveView(page, 'Hatch shown', true);
  await expect(snapshot).toHaveValue('Yes');
  await saveView(page, 'No layers', false);
  await expect(snapshot).toHaveValue('No');
  await closeManager(page, 'Cancel');

  // The Layer States Manager does not list a view's snapshot.
  await enterCommand(page, 'LAS');
  const states = page.getByRole('dialog', { name: 'Layer States Manager' });
  await expect(states.getByRole('table', { name: 'Layer states' })).toContainText(
    'No layer states saved',
  );
  await states.getByRole('button', { name: 'Close' }).click();
  await expect(states).toBeHidden();

  // HATCH turned off, then the view set current: HATCH is on again.
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'false');
  await openManager(page);
  await item(page, 'Hatch shown').click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await closeManager(page, 'OK');
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('1-restored-with-view.png') });

  // A view without a snapshot leaves the layers as they are.
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'false');
  await openManager(page);
  await item(page, 'No layers').click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await closeManager(page, 'OK');
  await expect(on).toHaveAttribute('aria-pressed', 'false');

  // Update Layers saves HATCH off with the view; restored after turning it on, it is off again.
  await openManager(page);
  await item(page, 'Hatch shown').click();
  await manager(page).getByRole('button', { name: 'Update Layers' }).click();
  await closeManager(page, 'Cancel');
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await openManager(page);
  await item(page, 'Hatch shown').click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await closeManager(page, 'OK');
  await expect(on).toHaveAttribute('aria-pressed', 'false');

  // The Layer snapshot row's No takes it off: restoring the view leaves HATCH on.
  await openManager(page);
  await item(page, 'Hatch shown').click();
  await expect(snapshot).toHaveValue('Yes');
  await snapshot.selectOption('No');
  await expect(snapshot).toHaveValue('No');
  await page.screenshot({ path: test.info().outputPath('2-layer-snapshot-row.png') });
  await closeManager(page, 'Cancel');
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await openManager(page);
  await item(page, 'Hatch shown').click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await closeManager(page, 'OK');
  await expect(on).toHaveAttribute('aria-pressed', 'true');
});
