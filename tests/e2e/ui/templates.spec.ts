// M5-10: new drawings from the bundled templates. The start screen's New drawing opens the
// default template (Triya ISO (mm)) as Drawing1.dxf in one click; NEW opens the Select Template
// dialog (arrow keys and Enter, or a double click), whose "Use as the default template" makes
// the title bar's New (QNEW) open that template next. Each new drawing has its template's layouts,
// each a sheet with its border, title block and revision table, and is untitled (DWGTITLED 0).
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectDrawn, expectShown } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const layoutTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Select Template' });
const shots = process.env['TRIYA_SCREENSHOTS'];

test.describe('new drawings from templates', () => {
  test.describe.configure({ timeout: 120_000 });

  test('New drawing, NEW and QNEW open the templates as untitled drawings', async ({ page }) => {
    await page.goto(app.url);
    const start = page.getByTestId('start');
    await expect(start.getByRole('button', { name: 'New drawing' })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/1-start-screen.png` });
    await start.getByRole('button', { name: 'New drawing' }).click();
    await expectShown(page, 'Drawing1.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'A4', 'A3', 'A2', 'A1', 'A0']);
    await enterCommand(page, 'DWGTITLED');
    const log = page.getByRole('log', { name: 'Recent command lines' });
    await expect(log).toContainText('DWGTITLED = 0 (read only)');
    await enterCommand(page, 'DWGNAME');
    await expect(log).toContainText('DWGNAME = "Drawing1.dxf" (read only)');

    await layoutTabs(page).filter({ hasText: 'A3' }).click();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    await expectDrawn(page, { timeout: 15_000 });
    if (shots) await page.screenshot({ path: `${shots}/2-iso-a3-sheet.png` });

    // NEW: the dialog opens on the default template; ArrowDown picks ANSI, Enter opens it.
    await enterCommand(page, 'NEW');
    await expect(dialog(page)).toBeVisible();
    const list = dialog(page).getByRole('listbox', { name: 'Templates' });
    await expect(list.getByRole('option', { selected: true })).toContainText('Triya ISO (mm)');
    await expect(dialog(page).getByRole('checkbox')).toBeChecked();
    await list.press('ArrowDown');
    await expect(list.getByRole('option', { selected: true })).toContainText('Triya ANSI (inch)');
    await expect(dialog(page).getByTestId('template-description')).toContainText('Inches');
    await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
    // It becomes the default template.
    await dialog(page).getByRole('checkbox').check();
    if (shots) await dialog(page).screenshot({ path: `${shots}/3-select-template.png` });
    await list.press('Enter');
    await expect(dialog(page)).toBeHidden();
    await expectShown(page, 'Drawing2.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'A', 'B', 'C', 'D', 'E']);
    await layoutTabs(page).filter({ hasText: 'B' }).click();
    await expectDrawn(page, { timeout: 15_000 });
    if (shots) await page.screenshot({ path: `${shots}/4-ansi-b-sheet.png` });

    // The title bar's New is QNEW: the default template, now ANSI.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expectShown(page, 'Drawing3.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'A', 'B', 'C', 'D', 'E']);

    // Cancel opens nothing.
    await enterCommand(page, 'NEW');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab')).toHaveCount(
      3,
    );
  });
});
