// M5-08 part 1: LINETYPE's Linetype Manager and the Load or Reload Linetypes dialog, and the
// Layer Properties Manager's Select Linetype Load.... clockwise_arcs_hatch.dxf (extents ±100,
// Standard text style) has ByLayer, ByBlock and Continuous only.
// - Load... reads the bundled triya-utilities.lin (TRIYA_GAS, a text linetype) and a .lin file
//   picked from disk (kept with the user's files); Current, Show details and the Global scale
//   factor; OK is one LINETYPE step, and a line drawn then is in TRIYA_GAS.
// - Delete refuses Continuous (in use) and takes a linetype just loaded.
// - Select Linetype's Load... loads TRIYA_WATER, chosen for the layer.
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const manager = (page: Page) => page.getByRole('dialog', { name: 'Linetype Manager' });
const loader = (page: Page) => page.getByRole('dialog', { name: 'Load or Reload Linetypes' });
const option = (page: Page, dialog: 'manager' | 'loader', name: string) =>
  (dialog === 'manager' ? manager(page) : loader(page))
    .getByRole('listbox')
    .getByRole('option')
    .filter({ has: page.getByText(name, { exact: true }) });

const PIPES = '*PIPE,Pipe __ . __ . __\nA,6,-2,0,-2\n*PIPE2,Pipe dashes\nA,3,-1\n';

test('loads linetypes, sets the current one and the scales, and deletes (M5-08)', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await enterCommand(page, 'LT');
  await expect(manager(page)).toBeVisible();
  const names = manager(page).getByRole('listbox').getByRole('option').locator('span:first-child');
  await expect(names).toHaveText(['ByLayer', 'ByBlock', 'Continuous']);
  await expect(manager(page)).toContainText('Current Linetype: ByLayer');

  // Load... the bundled utility linetypes: TRIYA_GAS.
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await expect(loader(page)).toBeVisible();
  const file = loader(page).getByLabel('File', { exact: true });
  await expect(file).toHaveValue('triya-iso.lin');
  await expect(loader(page).getByRole('listbox').getByRole('option')).toHaveCount(14);
  await file.selectOption('triya-utilities.lin');
  await option(page, 'loader', 'TRIYA_GAS').click();
  await expect(option(page, 'loader', 'TRIYA_GAS')).toHaveAttribute('aria-selected', 'true');
  await shot('1-load-or-reload-linetypes.png');
  await loader(page).getByRole('button', { name: 'OK' }).click();
  await expect(loader(page)).toBeHidden();
  await expect(option(page, 'manager', 'TRIYA_GAS')).toBeVisible();

  // Load... from a .lin file picked from disk: kept, listed as the user's, both linetypes.
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await loader(page)
    .getByLabel('Linetype file to load')
    .setInputFiles({ name: 'pipes.lin', mimeType: 'text/plain', buffer: Buffer.from(PIPES) });
  await expect(loader(page).getByLabel('File', { exact: true })).toHaveValue('pipes.lin');
  await expect(loader(page).getByRole('listbox').getByRole('option')).toHaveCount(2);
  await loader(page).getByRole('button', { name: 'Select All' }).click();
  await loader(page).getByRole('button', { name: 'OK' }).click();
  await expect(names).toHaveText([
    'ByLayer',
    'ByBlock',
    'Continuous',
    'PIPE',
    'PIPE2',
    'TRIYA_GAS',
  ]);

  // Loading PIPE again asks whether to reload it.
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await loader(page).getByLabel('File', { exact: true }).selectOption('pipes.lin');
  await option(page, 'loader', 'PIPE').click();
  await loader(page).getByRole('button', { name: 'OK' }).click();
  const reload = loader(page).getByRole('alertdialog', { name: 'Reload Linetype' });
  await expect(reload).toContainText('The linetype "PIPE" is already loaded.');
  await reload.getByRole('button', { name: 'Keep the loaded linetype' }).click();
  await expect(loader(page)).toBeHidden();

  // Delete: Continuous is in use; PIPE2, just loaded, goes.
  await option(page, 'manager', 'Continuous').click();
  await manager(page).getByRole('button', { name: 'Delete' }).click();
  await expect(manager(page).getByRole('alert')).toContainText('Continuous cannot be deleted');
  await option(page, 'manager', 'PIPE2').click();
  await manager(page).getByRole('button', { name: 'Delete' }).click();
  await expect(option(page, 'manager', 'PIPE2')).toHaveCount(0);

  // Current and the details.
  await option(page, 'manager', 'TRIYA_GAS').click();
  await manager(page).getByRole('button', { name: 'Current' }).click();
  await expect(manager(page)).toContainText('Current Linetype: TRIYA_GAS');
  await manager(page).getByRole('button', { name: 'Show details' }).click();
  await expect(manager(page).getByLabel('Name')).toHaveValue('TRIYA_GAS');
  await expect(manager(page).getByLabel('Use paper space units for scaling')).toBeChecked();
  await manager(page).getByLabel('Global scale factor').fill('4');
  await shot('2-linetype-manager.png');
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();

  // A line drawn now is in TRIYA_GAS; the manager opens on what OK made.
  await enterCommand(page, 'CECOLOR');
  await enterCommand(page, '1');
  await enterCommand(page, 'LINE');
  await enterCommand(page, '-290,-40');
  await enterCommand(page, '330,-40');
  await enterCommand(page, '');
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'E');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');
  // The zoomed view is drawn on the next frames; the screenshot is for the PR only.
  await page.waitForTimeout(500);
  await shot('3-gas-line-drawn.png');
  await enterCommand(page, 'LINETYPE');
  await expect(manager(page)).toContainText('Current Linetype: TRIYA_GAS');
  await expect(names).toHaveText(['ByLayer', 'ByBlock', 'Continuous', 'PIPE', 'TRIYA_GAS']);
  await manager(page).getByRole('button', { name: 'Show details' }).click();
  await expect(manager(page).getByLabel('Global scale factor')).toHaveValue('4');
  await manager(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(manager(page)).toBeHidden();

  // The Layer Properties Manager's Select Linetype loads one too.
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await palette.getByRole('button', { name: 'Linetype HATCH' }).click();
  const select = page.getByRole('dialog', { name: 'Select Linetype' });
  await select.getByRole('button', { name: 'Load...' }).click();
  await loader(page).getByLabel('File', { exact: true }).selectOption('triya-utilities.lin');
  await option(page, 'loader', 'TRIYA_WATER').click();
  await loader(page).getByRole('button', { name: 'OK' }).click();
  const water = select.getByRole('listbox').getByRole('option').filter({ hasText: 'TRIYA_WATER' });
  await expect(water).toHaveAttribute('aria-selected', 'true');
  await shot('4-select-linetype-loaded.png');
  await select.getByRole('button', { name: 'OK' }).click();
  await expect(palette.getByRole('button', { name: 'Linetype HATCH' })).toHaveText('TRIYA_WATER');
});

// M5-08 part 2: the Properties palette's Linetype list ends with AutoCAD's "Other...", which
// opens the Linetype Manager; a linetype loaded there from a user's .lin goes to the selection
// at OK (one undo step), and with nothing selected it is made the current linetype.
test('Other... in the Properties palette loads a linetype from a .lin and applies it (M5-08)', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // A frame and a circle to give the linetype (the drawing has one hatch).
  await enterCommand(page, 'RECTANG');
  await enterCommand(page, '-300,-200');
  await enterCommand(page, '300,200');
  await enterCommand(page, 'CIRCLE');
  await enterCommand(page, '0,0');
  await enterCommand(page, '150');
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'W');
  await enterCommand(page, '-330,-230');
  await enterCommand(page, '330,230');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toContainText(
    /^All \(3\)/,
  );
  const linetype = palette.getByRole('combobox', { name: 'Linetype' });
  await expect(linetype.locator('option').last()).toHaveText('Other...');

  await linetype.selectOption({ label: 'Other...' });
  await expect(manager(page)).toBeVisible();
  await expect(manager(page)).toContainText('OK applies the highlighted linetype');
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await loader(page)
    .getByLabel('Linetype file to load')
    .setInputFiles({ name: 'pipes.lin', mimeType: 'text/plain', buffer: Buffer.from(PIPES) });
  await option(page, 'loader', 'PIPE').click();
  await loader(page).getByRole('button', { name: 'OK' }).click();
  await expect(loader(page)).toBeHidden();
  // The linetype just loaded is highlighted, ready for OK.
  await expect(option(page, 'manager', 'PIPE')).toHaveAttribute('aria-selected', 'true');
  await shot('5-other-linetype-manager.png');
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();
  await expect(linetype.locator('option:checked')).toHaveText('PIPE');
  // Unselected, for the PR's screenshot only.
  await activeCanvas(page).hover({ position: { x: 300, y: 300 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot('6-other-applied-to-selection.png');

  // One undo step takes the linetype and the load back.
  await enterCommand(page, 'U');
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  await expect(linetype.locator('option', { hasText: /^PIPE$/ })).toHaveCount(0);

  // With nothing selected, the linetype highlighted is made current (CELTYPE).
  await page.keyboard.press('Escape');
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'No selection',
  );
  await linetype.selectOption({ label: 'Other...' });
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await loader(page).getByLabel('File', { exact: true }).selectOption('triya-utilities.lin');
  await option(page, 'loader', 'TRIYA_WATER').click();
  await loader(page).getByRole('button', { name: 'OK' }).click();
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();
  await expect(linetype.locator('option:checked')).toHaveText('TRIYA_WATER');
  await enterCommand(page, 'CELTYPE');
  await expect(page.getByTestId('command-prompt')).toContainText('TRIYA_WATER');
  await page.keyboard.press('Escape');
});

// M5-08 part 4: -LINETYPE Create writes a new linetype into one of the user's .lin files
// (custom.lin by default), which Load then loads; the Linetype Manager's Details rename and
// describe it (a taken name refused at OK, Continuous's name read only), and the renamed
// linetype made current is what a line drawn then takes.
test('-LINETYPE Create writes a .lin; Details rename and describe a linetype (M5-08)', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const prompt = page.getByTestId('command-prompt');

  await enterCommand(page, '-LINETYPE');
  await expect(prompt).toContainText('Enter an option [?/Create/Load/Set]');
  await enterCommand(page, 'C');
  await enterCommand(page, 'FENCE');
  await expect(prompt).toContainText('Enter name of linetype file <custom.lin>');
  await enterCommand(page, '');
  await expect(prompt).toContainText('Descriptive text');
  await enterCommand(page, 'Fence ----x----x----');
  await expect(log).toContainText('Enter linetype pattern (on next line):');
  await expect(prompt).toContainText('A,');
  await enterCommand(page, '12,-3,0,-3');
  await expect(log).toContainText('New linetype definition saved to file custom.lin.');
  await shot('7-linetype-create.png');
  // Load it from the file just written.
  await enterCommand(page, 'L');
  await enterCommand(page, 'FENCE');
  await enterCommand(page, 'custom');
  await expect(log).toContainText('Linetype FENCE loaded.');
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveText('Command:');

  await enterCommand(page, 'LT');
  await expect(option(page, 'manager', 'FENCE')).toBeVisible();
  await manager(page).getByRole('button', { name: 'Show details' }).click();
  const name = manager(page).getByLabel('Name');
  const description = manager(page).getByLabel('Description');
  // Continuous keeps its name; its description may change.
  await option(page, 'manager', 'Continuous').click();
  await expect(name).toHaveAttribute('readonly', '');
  await expect(description).not.toHaveAttribute('readonly', '');
  await option(page, 'manager', 'ByLayer').click();
  await expect(description).toHaveAttribute('readonly', '');

  await option(page, 'manager', 'FENCE').click();
  await expect(description).toHaveValue('Fence ----x----x----');
  await name.fill('continuous');
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page).getByRole('alert')).toHaveText(
    'A linetype named continuous already exists.',
  );
  await name.fill('SITE_FENCE');
  await description.fill('Site fence ----x----');
  await manager(page).getByRole('button', { name: 'Current' }).click();
  await expect(manager(page)).toContainText('Current Linetype: SITE_FENCE');
  await expect(option(page, 'manager', 'SITE_FENCE')).toContainText('Site fence ----x----');
  await shot('8-details-rename.png');
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();

  // A line drawn now is in SITE_FENCE.
  await enterCommand(page, 'CECOLOR');
  await enterCommand(page, '1');
  await enterCommand(page, 'LINE');
  await enterCommand(page, '-290,-40');
  await enterCommand(page, '330,-40');
  await enterCommand(page, '');
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'E');
  await expect(prompt).toHaveText('Command:');
  await enterCommand(page, 'CELTYPE');
  await expect(prompt).toContainText('SITE_FENCE');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot('9-site-fence-line.png');

  // The manager opens on the renamed linetype; the loader lists custom.lin with the user's files.
  await enterCommand(page, 'LT');
  await expect(option(page, 'manager', 'SITE_FENCE')).toContainText('Site fence ----x----');
  await expect(option(page, 'manager', 'FENCE')).toHaveCount(0);
  await manager(page).getByRole('button', { name: 'Load...' }).click();
  await loader(page).getByLabel('File', { exact: true }).selectOption('custom.lin');
  await expect(option(page, 'loader', 'FENCE')).toBeVisible();
  await loader(page).getByRole('button', { name: 'Cancel' }).click();
  await manager(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(manager(page)).toBeHidden();
});
