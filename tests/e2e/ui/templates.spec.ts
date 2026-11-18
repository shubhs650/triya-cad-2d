// M5-10: new drawings from the bundled templates. The start screen's New drawing opens the
// default template (Triya ISO (mm)) as Drawing1.dxf in one click; NEW opens the Select Template
// dialog (arrow keys and Enter, or a double click), whose "Use as the default template" makes
// the title bar's New (QNEW) open that template next. Each new drawing has its template's layouts,
// each a sheet with its border, title block and revision table, and is untitled (DWGTITLED 0).
//
// Part 2: a .dxf added in Settings > Templates is opened to check it, kept on this device and
// listed in the dialog after the bundled templates; the Open button's arrow opens a drawing with
// no template, Imperial or Metric, by mouse or keyboard.
import { copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// M5-14: "Open with no template" failed twice in CI on 2026-11-18: the third NEW, typed while
// DIMSTYLE's dialog was still closing after Escape, went to the dialog (enterCommand now waits for
// it to close). A failure keeps its trace, which the ui shard uploads with test-results/.
// (`use({ trace })` must be top-level: in a describe group it forces a new worker.)
test.use({ trace: 'retain-on-failure' });

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

const ANSI = fileURLToPath(new URL('../../../assets/templates/triya-ansi.dxf', import.meta.url));

test.describe('the user templates folder and Open with no template (M5-10 part 2)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a template added in Settings is listed and opened; Open with no template', async ({
    page,
  }) => {
    const shop = test.info().outputPath('Shop B.dxf');
    copyFileSync(ANSI, shop);
    const notes = test.info().outputPath('notes.dxf');
    writeFileSync(notes, 'not a drawing');
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await settings.getByRole('heading', { name: 'Templates' }).scrollIntoViewIfNeeded();
    await expect(settings.getByText('No templates added.')).toBeVisible();
    await page.getByTestId('template-picker').setInputFiles([notes]);
    await expect(settings.getByRole('alert')).toHaveText('notes.dxf is not a DXF file.');
    await page.getByTestId('template-picker').setInputFiles([shop]);
    const listed = settings.getByRole('list', { name: 'Template files' });
    await expect(listed).toContainText('Shop B.dxf');
    await expect(listed).toContainText('AutoCAD 2018 DXF, imperial, inches');
    await expect(settings.getByRole('status')).toHaveText(
      'Added template Shop B.dxf (AutoCAD 2018 DXF, imperial, inches).',
    );
    if (shots) await settings.screenshot({ path: `${shots}/5-settings-templates.png` });
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    // Kept on this device: a reload lists it in the dialog after the bundled templates.
    await page.reload();
    await expect(
      page.getByTestId('start').getByRole('button', { name: 'Templates…' }),
    ).toBeVisible();
    await page.getByTestId('start').getByRole('button', { name: 'Templates…' }).click();
    const list = dialog(page).getByRole('listbox', { name: 'Templates' });
    await expect(list.getByRole('option')).toHaveText([
      /Triya ISO \(mm\)/,
      /Triya ANSI \(inch\)/,
      /Shop B/,
    ]);
    await list.getByRole('option', { name: /Shop B/ }).click();
    await expect(dialog(page).getByTestId('template-description')).toHaveText(
      'Your template, kept on this device: AutoCAD 2018 DXF, imperial, inches.',
    );
    if (shots) await dialog(page).screenshot({ path: `${shots}/6-select-template-user.png` });
    await list.getByRole('option', { name: /Shop B/ }).dblclick();
    await expect(dialog(page)).toBeHidden();
    await expectShown(page, 'Drawing1.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'A', 'B', 'C', 'D', 'E']);

    // Open's arrow: Escape closes the menu only; Metric by mouse.
    await enterCommand(page, 'NEW');
    const arrow = dialog(page).getByRole('button', { name: 'Open options' });
    await arrow.click();
    const menu = dialog(page).getByRole('menu', { name: 'Open options' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Open',
      'Open with no template - Imperial',
      'Open with no template - Metric',
    ]);
    await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeFocused();
    if (shots) await dialog(page).screenshot({ path: `${shots}/7-open-with-no-template.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await expect(arrow).toBeFocused();
    await arrow.click();
    await menu.getByRole('menuitem', { name: 'Open with no template - Metric' }).click();
    await expect(dialog(page)).toBeHidden();
    await expectShown(page, 'Drawing2.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'Layout1', 'Layout2']);
    await enterCommand(page, 'MEASUREMENT');
    await expect(page.getByTestId('command-prompt')).toHaveText(
      'Enter new value for MEASUREMENT <1>:',
    );
    await page.keyboard.press('Escape');
    await enterCommand(page, 'DIMSTYLE');
    await expect(page.getByTestId('dimstyle-current')).toHaveText('ISO-25');
    await page.keyboard.press('Escape');

    // Imperial by keyboard: ArrowDown on the arrow opens the menu, then down to Imperial.
    await enterCommand(page, 'NEW');
    await dialog(page).getByRole('button', { name: 'Open options' }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(
      dialog(page).getByRole('menuitem', { name: 'Open with no template - Imperial' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expectShown(page, 'Drawing3.dxf');
    await expect(layoutTabs(page)).toHaveText(['Model', 'Layout1', 'Layout2']);
    await enterCommand(page, 'MEASUREMENT');
    await expect(page.getByTestId('command-prompt')).toHaveText(
      'Enter new value for MEASUREMENT <0>:',
    );
    await page.keyboard.press('Escape');
    await layoutTabs(page).filter({ hasText: 'Layout1' }).click();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    await expectDrawn(page, { timeout: 15_000 });
    if (shots) await page.screenshot({ path: `${shots}/8-no-template-imperial-layout1.png` });

    // Removing the template takes it off the list.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Remove Shop B.dxf' }).click();
    await expect(settings.getByText('No templates added.')).toBeVisible();
  });
});
