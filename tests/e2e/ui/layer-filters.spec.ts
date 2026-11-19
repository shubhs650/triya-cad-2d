// M5-07 part 5: the Layer Properties Manager's filter tree (AutoCAD 2024 Help, "Layer Properties
// Manager", "Layer Filter Properties Dialog Box"). clockwise_arcs_hatch.dxf has layers 0,
// Defpoints and HATCH, and no filter.
// - The tree shows All and All Used Layers; All Used Layers lists the layers objects are on, and
//   Invert filter the others; the line under the list counts them.
// - New Property Filter opens Layer Filter Properties: a name pattern in the definition grid
//   previews its layers, OK makes Properties Filter1 and lists them; Properties... reopens it.
// - New Group Filter makes Group Filter1 named in place; a layer dragged onto it joins it, Remove
//   From Group Filter takes it out; Rename and Delete in the filter menu.
// M5-07 part 6: the filter menu's submenus, by pointer and keyboard: Visibility Off and On and
// Lock on a group's layers, Viewport greyed in model space, Isolate Group turning the other
// layers off, Convert to Group Filter.
// M5-07 part 8: the Xref node. xref-parent.dxf (packages/testkit/src/xref/fixture.ts) attaches
// xref-child-tb.dxf and overlays it as xref-child-ovl, and keeps xref-child-tb|TB-LINES
// (VISRETAIN); the Xref node lists a node for each xref, and dropping the title block's file
// brings its layers, and its nested xref, in.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, expectShown, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const palette = (page: Page) => page.getByRole('complementary', { name: 'Layers' });
const tree = (page: Page) => palette(page).getByRole('tree', { name: 'Layer filters' });
const node = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const listed = (page: Page) =>
  palette(page).getByRole('table', { name: 'Layers of the drawing' }).locator('tbody th');
const count = (page: Page) => palette(page).locator('.layer-filter-count');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Layer Filter Properties' });
const filterMenu = (page: Page) => page.getByRole('menu', { name: 'Layer filter' });

test('lists layers by filter: used, property, group, inverted (M5-07 part 5)', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  await expect(palette(page)).toBeVisible();

  // All, and All Used Layers: the hatch's layer is in use, Defpoints is not.
  await expect(tree(page).getByRole('treeitem')).toHaveText(['▾All', 'All Used Layers']);
  await expect(node(page, 'All')).toHaveAttribute('aria-selected', 'true');
  await expect(count(page)).toHaveText('All: 3 layers displayed of 3 total layers');
  await node(page, 'All Used Layers').click();
  await expect(listed(page)).not.toContainText(['Defpoints']);
  await expect(listed(page)).toContainText(['HATCH']);
  const usedCount = await listed(page).count();
  await palette(page).getByLabel('Invert filter').check();
  await expect(listed(page)).toContainText(['Defpoints']);
  await expect(listed(page)).toHaveCount(3 - usedCount);
  await palette(page).getByLabel('Invert filter').uncheck();

  // New Property Filter: names starting with H.
  await palette(page).getByRole('button', { name: 'New Property Filter' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Filter name:')).toHaveValue('Properties Filter1');
  const preview = dialog(page).getByRole('table', { name: 'Filter preview' }).locator('tbody th');
  await expect(preview).toHaveText(['0', 'Defpoints', 'HATCH']);
  await dialog(page).getByLabel('Name in row 1').fill('H*');
  await expect(preview).toHaveText(['HATCH']);
  // A second row: Defpoints too (rows are OR).
  await dialog(page).getByLabel('Name in row 2').fill('Def*');
  await expect(preview).toHaveText(['Defpoints', 'HATCH']);
  await dialog(page).getByRole('button', { name: 'Delete row 2' }).click();
  await expect(preview).toHaveText(['HATCH']);
  await shot('1-layer-filter-properties.png');
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(node(page, 'Properties Filter1')).toHaveAttribute('aria-selected', 'true');
  await expect(listed(page)).toHaveText(['HATCH']);
  await expect(count(page)).toHaveText('Properties Filter1: 1 layer displayed of 3 total layers');
  await palette(page).getByLabel('Invert filter').check();
  await expect(listed(page)).toHaveText(['0', 'Defpoints']);
  await palette(page).getByLabel('Invert filter').uncheck();

  // Properties... shows the definition; Cancel keeps it.
  await node(page, 'Properties Filter1').click({ button: 'right' });
  await filterMenu(page).getByRole('menuitem', { name: 'Properties...' }).click();
  await expect(dialog(page).getByLabel('Name in row 1')).toHaveValue('H*');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeHidden();

  // New Group Filter, named in place.
  await palette(page).getByRole('button', { name: 'New Group Filter' }).click();
  const rename = tree(page).getByRole('textbox', { name: 'Name of filter Group Filter1' });
  await expect(rename).toBeFocused();
  await page.keyboard.type('Mine');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Mine')).toHaveAttribute('aria-selected', 'true');
  await expect(listed(page)).toHaveCount(0);
  await expect(count(page)).toHaveText('Mine: 0 layers displayed of 3 total layers');

  // A layer dragged from All onto the group joins it.
  await node(page, 'All').click();
  await listed(page).filter({ hasText: 'Defpoints' }).dragTo(node(page, 'Mine'));
  await node(page, 'Mine').click();
  await expect(listed(page)).toHaveText(['Defpoints']);
  await shot('2-group-filter.png');

  // Remove From Group Filter.
  await listed(page).filter({ hasText: 'Defpoints' }).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Layer list' })
    .getByRole('menuitem', { name: 'Remove From Group Filter' })
    .click();
  await expect(listed(page)).toHaveCount(0);

  // Rename and Delete; All is chosen again once the filter shown is gone.
  await node(page, 'Mine').click({ button: 'right' });
  await expect(filterMenu(page).getByRole('menuitem', { name: 'Properties...' })).toBeDisabled();
  await filterMenu(page).getByRole('menuitem', { name: 'Rename' }).click();
  await page.keyboard.type('Empty');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Empty')).toBeVisible();
  await node(page, 'Empty').click({ button: 'right' });
  await filterMenu(page).getByRole('menuitem', { name: 'Delete' }).click();
  await expect(node(page, 'Empty')).toBeHidden();
  await expect(node(page, 'All')).toHaveAttribute('aria-selected', 'true');
  await expect(listed(page)).toHaveCount(3);

  // All cannot be renamed or deleted; a filter is nested in the one right-clicked.
  await node(page, 'Properties Filter1').click({ button: 'right' });
  await expect(filterMenu(page).getByRole('menuitem', { name: 'New Group Filter' })).toBeDisabled();
  await filterMenu(page).getByRole('menuitem', { name: 'New Properties Filter...' }).click();
  await dialog(page).getByLabel('On in row 1', { exact: true }).selectOption('On');
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await expect(node(page, 'Properties Filter2')).toHaveAttribute('aria-level', '3');
  await expect(listed(page)).toHaveText(['HATCH']);
  await node(page, 'All').click({ button: 'right' });
  await expect(filterMenu(page).getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
  await expect(filterMenu(page).getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('the filter menu sets a filter’s layers, isolates them and converts (M5-07 part 6)', async ({
  page,
}) => {
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const toggle = (title: string, layer: string) =>
    palette(page).getByRole('button', { name: `${title} ${layer}`, exact: true });
  const item = (name: string) => filterMenu(page).getByRole('menuitem', { name, exact: true });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  await expect(palette(page)).toBeVisible();

  // A group filter holding HATCH.
  await palette(page).getByRole('button', { name: 'New Group Filter' }).click();
  await expect(
    tree(page).getByRole('textbox', { name: 'Name of filter Group Filter1' }),
  ).toBeFocused();
  await page.keyboard.type('Pair');
  await page.keyboard.press('Enter');
  await node(page, 'All').click();
  await listed(page).filter({ hasText: 'HATCH' }).dragTo(node(page, 'Pair'));
  await node(page, 'Pair').click();
  await expect(listed(page)).toHaveText(['HATCH']);

  // Visibility > Off by pointer: the submenu opens on hover.
  await node(page, 'Pair').click({ button: 'right' });
  await item('Visibility').hover();
  await expect(item('Visibility')).toHaveAttribute('aria-expanded', 'true');
  await expect(
    filterMenu(page).getByRole('menu', { name: 'Visibility' }).getByRole('menuitem'),
  ).toHaveText(['On', 'Off', 'Thawed', 'Frozen']);
  // Viewport needs a layout viewport made current: greyed in model space.
  await expect(item('Viewport')).toBeDisabled();
  await shot('1-visibility-submenu.png');
  await item('Off').click();
  await expect(filterMenu(page)).toBeHidden();
  await expect(toggle('On', 'HATCH')).toHaveAttribute('aria-pressed', 'false');

  // Visibility > On, then Lock > Lock, from the keyboard: ↓ moves, → opens, Enter chooses.
  await node(page, 'Pair').click({ button: 'right' });
  await expect(item('Visibility')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(item('On')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle('On', 'HATCH')).toHaveAttribute('aria-pressed', 'true');
  await node(page, 'Pair').click({ button: 'right' });
  await expect(item('Visibility')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item('Lock')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  // ← closes the submenu, back on its item; → opens it again.
  await page.keyboard.press('ArrowLeft');
  await expect(item('Lock')).toBeFocused();
  await expect(item('Lock')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(
    filterMenu(page).getByRole('menu', { name: 'Lock' }).getByRole('menuitem').first(),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle('Lock', 'HATCH')).toHaveAttribute('aria-pressed', 'true');

  // Isolate Group > All Viewports in model space: the layers not in Pair are turned off.
  await node(page, 'Pair').click({ button: 'right' });
  await item('Isolate Group').hover();
  await expect(item('Active Viewport Only')).toBeEnabled();
  await item('All Viewports').click();
  await node(page, 'All').click();
  await expect(toggle('On', '0')).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle('On', 'Defpoints')).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle('On', 'HATCH')).toHaveAttribute('aria-pressed', 'true');
  await shot('2-isolated.png');

  // Convert to Group Filter: a property filter listing HATCH becomes a group holding it.
  await palette(page).getByRole('button', { name: 'New Property Filter' }).click();
  await dialog(page).getByLabel('Name in row 1').fill('H*');
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await expect(node(page, 'Properties Filter1')).toHaveAttribute('data-filter-type', 'property');
  await node(page, 'Pair').click({ button: 'right' });
  await expect(item('Convert to Group Filter')).toBeDisabled();
  await page.keyboard.press('Escape');
  await node(page, 'Properties Filter1').click({ button: 'right' });
  await item('Convert to Group Filter').click();
  await expect(node(page, 'Properties Filter1')).toHaveAttribute('data-filter-type', 'group');
  await expect(listed(page)).toHaveText(['HATCH']);
});

test('the Xref node lists each xref’s layers and takes the menu’s Visibility (M5-07 part 8)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const fixtures = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');
  const toggle = (title: string, layer: string) =>
    palette(page).getByRole('button', { name: `${title} ${layer}`, exact: true });
  const item = (name: string) => filterMenu(page).getByRole('menuitem', { name, exact: true });
  await page.goto(app.url);
  await openWithPicker(page, path.join(fixtures, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  await expect(palette(page)).toBeVisible();

  // Before the files are found: the two xrefs, and the layer the host keeps of the title block.
  await expect(tree(page).getByRole('treeitem')).toHaveText([
    '▾All',
    'All Used Layers',
    '▾Xref',
    'xref-child-ovl',
    'xref-child-tb',
  ]);
  await node(page, 'xref-child-tb').click();
  await expect(listed(page)).toHaveText(['xref-child-tb|TB-LINES']);

  // The title block's file dropped: its layers, for both references, and its nested xref.
  await openWithDrop(page, path.join(fixtures, 'xref-child-tb.dxf'));
  await expect(node(page, 'xref-grandchild')).toBeVisible({ timeout: 30_000 });
  await expect(listed(page)).toHaveText([
    'xref-child-tb|TB-FRAME',
    'xref-child-tb|TB-LINES',
    'xref-child-tb|TB-LOGO',
  ]);
  await expect(count(page)).toContainText('xref-child-tb: 3 layers displayed of ');
  await node(page, 'Xref').click();
  // Every xref's (the grandchild's file is not found, so it brings none).
  await expect(listed(page)).toHaveText(
    ['ovl', 'tb'].flatMap((x) => ['FRAME', 'LINES', 'LOGO'].map((l) => `xref-child-${x}|TB-${l}`)),
  );
  await palette(page).getByLabel('Invert filter').check();
  await expect(listed(page).filter({ hasText: '|' })).toHaveCount(0);
  await palette(page).getByLabel('Invert filter').uncheck();

  // The menu on an xref's node: no new filters in it; Visibility > Off turns its layers off.
  await node(page, 'xref-child-ovl').click({ button: 'right' });
  await expect(item('New Properties Filter...')).toBeDisabled();
  await expect(item('New Group Filter')).toBeDisabled();
  await expect(item('Rename')).toBeDisabled();
  await item('Visibility').hover();
  await shot('1-xref-node-menu.png');
  await item('Off').click();
  await expect(filterMenu(page)).toBeHidden();
  await expect(toggle('On', 'xref-child-ovl|TB-FRAME')).toHaveAttribute('aria-pressed', 'false');
  await node(page, 'xref-child-tb').click();
  await expect(toggle('On', 'xref-child-tb|TB-FRAME')).toHaveAttribute('aria-pressed', 'true');
  await shot('2-xref-node-layers.png');
});
