// M6-01 part 3: the Page Setup Manager (PAGESETUP and the layout tab menu's Page Setup Manager...)
// on the page setups test drawing (page-setups.dxf, authored by packages/testkit/src/page-setups):
// New from the layout's own page setup on ISO A1, Set Current, Rename (F2), Delete (the shortcut
// menu), Modify with Window< (PAGESETUP asks for the corners at the command line), Import from
// a drawing (a name the drawing has asks to redefine it), and every change saved into the DXF's
// ACAD_PLOTSETTINGS and read back.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const PAGE_SETUPS = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/page-setups/page-setups.dxf',
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const manager = (page: Page) => page.getByRole('dialog', { name: 'Page Setup Manager' });
const list = (page: Page) => manager(page).getByRole('listbox', { name: 'Page setups' });
const rows = (page: Page) => list(page).getByRole('option');

type Dev = { triyaDev: { layouts(): { name: string; plot?: Record<string, unknown> }[] } };
const layout1 = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Dev).triyaDev.layouts().find((l) => l.name === 'Layout1')!.plot!,
  );

async function openLayout1(page: Page): Promise<void> {
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' });
  await tabs.getByRole('tab').nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
}

test('the Page Setup Manager makes, sets current, renames, deletes, modifies and imports page setups, saved with the drawing', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  await openLayout1(page);
  const shot = (name: string) =>
    page.screenshot({ path: test.info().outputPath(`m6-01-part3-${name}.png`) });

  // PAGESETUP on Layout1: its own page setup, then the layouts' named ones.
  await enterCommand(page, 'PAGESETUP');
  const m = manager(page);
  await expect(m.getByText('Current layout:')).toContainText('Layout1');
  await expect(m.getByText('Current page setup:')).toContainText('<None>');
  await expect(rows(page)).toHaveText(['*Layout1*', 'A3 Monochrome']);
  await expect(m.getByRole('group', { name: 'Selected page setup details' })).toContainText(
    '297.00 x 210.00 mm (Landscape)',
  );
  await shot('1-manager');

  // New..., from the layout's own page setup, on ISO A1.
  await m.getByRole('button', { name: 'New...' }).click();
  const n = page.getByRole('dialog', { name: 'New Page Setup' });
  const nameField = n.getByLabel('New page setup name:');
  await expect(nameField).toHaveValue('Setup1');
  // A name the drawing has is refused before the Page Setup dialog opens.
  await nameField.fill('a3 monochrome');
  await n.getByRole('button', { name: 'OK' }).click();
  await expect(n.getByRole('alert')).toHaveText(
    'A page setup named "A3 Monochrome" already exists.',
  );
  await nameField.fill('Plan A1');
  await n.getByLabel('Start with:').selectOption('*own*');
  await shot('2-new-page-setup');
  await n.getByRole('button', { name: 'OK' }).click();
  const setup = page.getByRole('dialog', { name: 'Page Setup - Plan A1' });
  await setup.getByLabel('Paper size').selectOption('ISO A1');
  await shot('3-page-setup-dialog');
  await setup.getByRole('button', { name: 'OK' }).click();
  await expect(setup).toBeHidden();
  await expect(rows(page)).toHaveText(['*Layout1*', 'A3 Monochrome', 'Plan A1']);
  await expect(list(page).getByRole('option', { selected: true })).toHaveText('Plan A1');
  await expect(m.getByRole('group', { name: 'Selected page setup details' })).toContainText(
    '841.00 x 594.00 mm',
  );

  // Set Current: the layout takes its settings and names it.
  await m.getByRole('button', { name: 'Set Current' }).click();
  await expect(m.getByText('Current page setup:')).toContainText('Plan A1');
  await expect(rows(page).first()).toHaveText('*Layout1 (Plan A1)*');
  // ISO A1 as the paper list feeds it (portrait), turned for the landscape sheet.
  expect(await layout1(page)).toMatchObject({
    pageSetupName: 'Plan A1',
    paperWidth: 594,
    paperHeight: 841,
    rotation: 1,
  });

  // F2 renames in place; the shortcut menu deletes.
  await list(page).getByRole('option', { name: 'Plan A1', exact: true }).focus();
  await page.keyboard.press('F2');
  const rename = list(page).getByLabel('Name of Plan A1');
  await rename.fill('Plan A1 final');
  await rename.press('Enter');
  // Layout1 has it applied: by its new name.
  await expect(rows(page)).toHaveText([
    '*Layout1 (Plan A1 final)*',
    'A3 Monochrome',
    'Plan A1 final',
  ]);
  await list(page).getByRole('option', { name: 'A3 Monochrome' }).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Page setup' })
    .getByRole('menuitem', { name: 'Delete' })
    .click();
  await expect(rows(page)).toHaveText(['*Layout1 (Plan A1 final)*', 'Plan A1 final']);

  // Modify... with Window<: PAGESETUP asks for the corners, then the dialogs come back.
  await list(page).getByRole('option', { name: 'Plan A1 final', exact: true }).click();
  await m.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Page Setup - Plan A1 final' });
  await modify.getByLabel('What to plot').selectOption('window');
  await expect(modify).toBeHidden();
  await expect(page.getByTestId('command-prompt')).toContainText('Specify first corner');
  await enterCommand(page, '10,10');
  await enterCommand(page, '200,150');
  await expect(modify).toBeVisible();
  await expect(modify.getByLabel('What to plot')).toHaveValue('window');
  await modify.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await modify.getByRole('button', { name: 'OK' }).click();
  await expect(modify).toBeHidden();
  await expect(m.getByRole('group', { name: 'Selected page setup details' })).toContainText(
    'Window',
  );

  // Import...: the test drawing's page setups; one for model space is listed by Location.
  await m.getByLabel('Drawing to import page setups from').setInputFiles(PAGE_SETUPS);
  const imp = page.getByRole('dialog', { name: 'Import Page Setups' });
  const table = imp.getByRole('table', { name: 'Page setups to import' });
  await expect(table.getByRole('row')).toHaveText([
    'NameLocation',
    'A3 MonochromeLayout',
    'Model A1 FitModel',
    'Model ANSI B 1:2Model',
  ]);
  await imp.getByLabel('A3 Monochrome').check();
  await imp.getByLabel('Model A1 Fit').check();
  await shot('4-import-page-setups');
  await imp.getByRole('button', { name: 'OK' }).click();
  // The drawing has Model A1 Fit: redefine it?
  const ask = m.getByRole('alertdialog', { name: 'Page Setup - Redefine' });
  await expect(ask).toContainText('The page setup "Model A1 Fit" already exists.');
  await ask.getByRole('button', { name: 'No' }).click();
  await expect(m.getByRole('status')).toHaveText('Page setup imported: A3 Monochrome.');
  await expect(rows(page)).toHaveText([
    '*Layout1 (Plan A1 final)*',
    'A3 Monochrome',
    'Plan A1 final',
  ]);
  await shot('5-imported');
  await m.getByRole('button', { name: 'Close' }).click();
  await expect(m).toBeHidden();

  // Saved and opened again: the page setups and the layout's applied one are in the file.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const saved = test.info().outputPath('page-setups-manager.dxf');
  await (await download).saveAs(saved);
  expect(readFileSync(saved, 'latin1')).toMatch(
    /AcDbPlotSettings\r?\n {2}1\r?\nPlan A1 final\r?\n/,
  );
  await openWithPicker(page, saved);
  await expectShown(page, path.basename(saved));
  await openLayout1(page);
  // The layout tab's menu opens the manager too.
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab')
    .nth(1)
    .click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Layout tab' })
    .getByRole('menuitem', { name: 'Page Setup Manager...' })
    .click();
  await expect(m.getByText('Current page setup:')).toContainText('Plan A1 final');
  await expect(rows(page)).toHaveText([
    '*Layout1 (Plan A1 final)*',
    'A3 Monochrome',
    'Plan A1 final',
  ]);
  await list(page).getByRole('option', { name: 'Plan A1 final', exact: true }).click();
  await expect(m.getByRole('group', { name: 'Selected page setup details' })).toContainText(
    'triya-monochrome.ctb',
  );
  await m.getByRole('button', { name: 'Close' }).click();

  // Model space lists the model space page setups.
  await page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab').first().click();
  await expect(page.getByTestId('space')).toHaveText('MODEL');
  await enterCommand(page, 'PAGESETUP');
  await expect(rows(page)).toHaveText(['*Model*', 'Model A1 Fit', 'Model ANSI B 1:2']);
  await m.getByRole('button', { name: 'Close' }).click();
});
