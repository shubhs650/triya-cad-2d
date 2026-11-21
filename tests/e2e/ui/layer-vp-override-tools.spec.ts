// M6-02 part 12: the Layer Properties Manager's tools for viewport overrides, on
// viewport-overrides.dxf (self-authored; Layout1 with four viewports, WALLS red, PIPING blue).
// With the top-left viewport made current (a double click): VP Color overrides WALLS there and
// the filter tree shows Viewport Overrides, which lists WALLS alone; right-clicking the VP Color
// cell offers Remove VP Color Overrides For, whose Selected Layers - Current Viewport Only puts
// WALLS back to red and takes the node away. The Layer States Manager saves PIPING's VP Freeze
// in that viewport (Space: Layout) and Restore sets it there again; Apply properties as viewport
// overrides is offered. A model view saved on the Model tab is set current in the viewport from
// the View Manager, and its layer snapshot, updated there, brings PIPING's VP Freeze back.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
  viewOf,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const views = (page: Page) => page.getByRole('dialog', { name: 'View Manager' });
const states = (page: Page) => page.getByRole('dialog', { name: 'Layer States Manager' });

async function openViews(page: Page): Promise<void> {
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'VIEW');
  await expect(views(page)).toBeVisible();
}

async function closeViews(page: Page, button: 'OK' | 'Cancel'): Promise<void> {
  await views(page).getByRole('button', { name: button, exact: true }).click();
  await expect(views(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
}

test('viewport override tools in the layout viewport made current (M6-02 part 12)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  const table = palette.getByRole('table', { name: 'Layers of the drawing' });
  const row = (name: string) =>
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
  const tree = palette.getByRole('tree', { name: 'Layer filters' });
  const node = (name: string) => tree.getByRole('treeitem', { name, exact: true });

  // A model view saved on the Model tab, with a layer snapshot.
  await expectDrawn(page, { timeout: 15_000 });
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'E');
  await expectInputsRead(page);
  await openViews(page);
  await views(page).getByRole('button', { name: 'New...' }).click();
  const newView = page.getByRole('dialog', { name: 'New View / Shot Properties' });
  await newView.getByLabel('View name').fill('Plan');
  await newView.getByRole('button', { name: 'OK' }).click();
  await expect(newView).toBeHidden();
  await closeViews(page, 'Cancel');

  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  // In paper space Remove Viewport Overrides For offers All Viewports only.
  await row('WALLS').getByRole('rowheader').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Layer list' });
  await menu.getByRole('menuitem', { name: 'Remove Viewport Overrides For' }).click();
  await expect(
    menu.getByRole('menuitem', { name: 'All Layers - Current Viewport Only' }),
  ).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'All Layers - All Viewports' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The top-left viewport made current.
  const view = await viewOf(page);
  const centre = view.at(105, 212);
  await page.mouse.dblclick(view.box.x + centre.x, view.box.y + centre.y);
  await expect(activeCanvas(page)).not.toHaveAttribute('data-viewport', '');
  await expect(node('Viewport Overrides')).toHaveCount(0);

  // VP Color green on WALLS: the Viewport Overrides node lists WALLS alone.
  const vpColor = palette.getByRole('button', { name: 'VP Color WALLS' });
  await vpColor.click();
  const color = page.getByRole('dialog', { name: 'Select Color' });
  await color.getByRole('gridcell', { name: 'Index color 3', exact: true }).click();
  await color.getByRole('button', { name: 'OK' }).click();
  await expect(vpColor).toHaveText('green');
  await node('Viewport Overrides').click();
  await expect(table.getByRole('rowheader')).toHaveText(['WALLS']);
  await shot('1-viewport-overrides-node.png');

  // Right-click the overridden cell: Remove VP Color Overrides For, in this viewport only.
  await row('WALLS').locator('td.vpColor').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Remove VP Color Overrides For' }).click();
  await shot('2-remove-vp-color-overrides.png');
  await menu.getByRole('menuitem', { name: 'Selected Layers - Current Viewport Only' }).click();
  await expect(menu).toHaveCount(0);
  await expect(node('Viewport Overrides')).toHaveCount(0);
  await expect(node('All')).toHaveAttribute('aria-selected', 'true');
  await expect(vpColor).toHaveText('red');
  await expect(row('WALLS').locator('td.vpColor')).not.toHaveClass(/vp-overridden/);

  // Layer states: PIPING frozen in this viewport, saved, thawed, restored.
  const vpFreeze = palette.getByRole('button', { name: 'VP Freeze PIPING' });
  await vpFreeze.click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'true');
  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await expect(states(page)).toBeVisible();
  await expect(
    states(page).getByRole('checkbox', { name: 'Apply properties as viewport overrides' }),
  ).toBeEnabled();
  await states(page).getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'New Layer State to Save' });
  await create.getByLabel('New layer state name:').fill('Piping hidden');
  await create.getByRole('button', { name: 'OK' }).click();
  await expect(create).toBeHidden();
  const stateRow = states(page)
    .getByRole('table', { name: 'Layer states' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Piping hidden' }) });
  await expect(stateRow.getByRole('cell').first()).toHaveText('Layout');
  await states(page).getByRole('button', { name: 'Close' }).click();
  await vpFreeze.click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'false');
  await palette.getByRole('button', { name: 'Layer States Manager' }).click();
  await stateRow.click();
  await states(page).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(states(page)).toBeHidden();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'true');

  // The model view's snapshot updated here keeps PIPING frozen in this viewport; set current
  // after thawing it, the view comes back in the viewport with PIPING frozen again.
  const item = (name: string) =>
    views(page).getByRole('tree', { name: 'Views' }).getByRole('treeitem', { name, exact: true });
  await openViews(page);
  await item('Plan').click();
  await views(page).getByRole('button', { name: 'Update Layers' }).click();
  await closeViews(page, 'Cancel');
  await vpFreeze.click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'false');
  await openViews(page);
  await item('Plan').click();
  await expect(views(page).getByRole('button', { name: 'Set Current' })).toBeEnabled();
  await views(page).getByRole('button', { name: 'Set Current' }).click();
  await closeViews(page, 'OK');
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'true');
  await shot('3-view-restored-in-viewport.png');
});
