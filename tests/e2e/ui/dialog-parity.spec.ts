// M7-04: the dialog parity set's smoke test (UI_SPEC.md §7). Each dialog the roadmap lists opens
// from its command with AutoCAD's title, takes the keyboard focus, and Esc closes it with the
// command line back at `Command:`: OPTIONS, DSETTINGS, the style managers (DIMSTYLE, STYLE,
// TABLESTYLE, MLEADERSTYLE), INSERT, BLOCK, XREF (the References palette, as AutoCAD's External
// References is one), LINETYPE, UNITS, PAGESETUP, PLOT and PUBLISH. Their own specs test what
// each does. The Options dialog gets a closer look: AutoCAD's tabs, moved along with the arrow
// keys, the tab shown last when opened again, and 'OPTIONS inside another command.
// TRIYA_SHOTS=<dir> writes a screenshot of each dialog there.
import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, enterCommand, expectNoModalDialog, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The keyboard focus is inside `dialog`, as a modal dialog's must be. */
async function expectFocusIn(dialog: Locator): Promise<void> {
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
}

/** The parity set's dialogs: the command that opens each, and AutoCAD's title for it. */
const DIALOGS: readonly { command: string; title: string | RegExp }[] = [
  { command: 'OPTIONS', title: 'Options' },
  { command: 'DSETTINGS', title: 'Drafting Settings' },
  { command: 'DIMSTYLE', title: 'Dimension Style Manager' },
  { command: 'STYLE', title: 'Text Style' },
  { command: 'TABLESTYLE', title: 'Table Style' },
  { command: 'MLEADERSTYLE', title: 'Multileader Style Manager' },
  { command: 'INSERT', title: 'Insert' },
  { command: 'BLOCK', title: 'Block Definition' },
  { command: 'LINETYPE', title: 'Linetype Manager' },
  { command: 'UNITS', title: 'Drawing Units' },
  { command: 'PAGESETUP', title: 'Page Setup Manager' },
  { command: 'PLOT', title: 'Plot - Model' },
  { command: 'PUBLISH', title: 'Publish' },
];

test('every dialog of the parity set opens from its command, keeps the focus and closes on Esc', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  for (const { command, title } of DIALOGS) {
    await test.step(command, async () => {
      await enterCommand(page, command);
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expectFocusIn(dialog);
      await shot(page, command.toLowerCase());
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expectNoModalDialog(page);
      await expect(prompt(page)).toHaveText('Command:');
    });
  }

  // XREF opens the References palette, AutoCAD's External References palette.
  await enterCommand(page, 'XREF');
  const references = page.getByRole('complementary', { name: 'References' });
  await expect(references).toBeVisible();
  await shot(page, 'xref');
  await references.getByRole('button', { name: 'Close References' }).click();
  await expect(references).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});

test("the Options dialog has AutoCAD's tabs, moved along with the keyboard, and reopens on the last", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // OP, its alias, opens it on Files the first time.
  await enterCommand(page, 'OP');
  const options = page.getByRole('dialog', { name: 'Options' });
  await expect(options).toBeVisible();
  const tabs = options.getByRole('tablist', { name: 'Options' }).getByRole('tab');
  await expect(tabs).toHaveText([
    'Files',
    'Display',
    'Open and Save',
    'Plot and Publish',
    'System',
    'User Preferences',
    'Drafting',
    'Selection',
  ]);
  const files = options.getByRole('tab', { name: 'Files' });
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(options.getByRole('tabpanel', { name: 'Files' })).toBeVisible();
  await expect(options.getByRole('heading', { name: 'Hatch patterns' })).toBeVisible();
  await shot(page, 'options-files');

  // The tab list is one stop: the arrow keys move along it, wrapping, and Home and End.
  await files.focus();
  await page.keyboard.press('ArrowRight');
  const display = options.getByRole('tab', { name: 'Display' });
  await expect(display).toBeFocused();
  await expect(display).toHaveAttribute('aria-selected', 'true');
  await expect(options.getByLabel('Color theme')).toBeVisible();
  await expect(options.getByRole('heading', { name: 'Hatch patterns' })).toBeHidden();
  await shot(page, 'options-display');
  await page.keyboard.press('ArrowRight');
  await expect(options.getByLabel('Save as')).toBeDisabled();
  await expect(options.getByLabel('Save as')).toHaveValue('AC1032');
  await shot(page, 'options-open-and-save');
  await page.keyboard.press('ArrowRight');
  await expect(
    options.getByRole('radio', { name: 'As each page setup or plot says' }),
  ).toBeChecked();
  await shot(page, 'options-plot-and-publish');
  await page.keyboard.press('ArrowRight');
  await expect(options.getByRole('button', { name: 'Clear all local data…' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(options.getByLabel('Display background of fields (FIELDDISPLAY)')).toBeVisible();
  await shot(page, 'options-user-preferences');
  await page.keyboard.press('ArrowRight');
  await expect(options.getByLabel('AutoSnap marker size')).toBeVisible();
  await shot(page, 'options-drafting');
  await page.keyboard.press('End');
  const selection = options.getByRole('tab', { name: 'Selection' });
  await expect(selection).toBeFocused();
  await expect(options.getByLabel('Pickbox size')).toHaveValue('3');
  await shot(page, 'options-selection');
  await page.keyboard.press('ArrowRight');
  await expect(files).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(selection).toHaveAttribute('aria-selected', 'true');

  // Use Shift to add to selection is PICKADD 0; unchecked it is AutoCAD's initial 2.
  const shift = options.getByLabel('Use Shift to add to selection (PICKADD)');
  await expect(shift).not.toBeChecked();
  await shift.check();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'PICKADD');
  await expect(prompt(page)).toHaveText('Enter new value for PICKADD <0>:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // 'OPTIONS inside LINE opens it on the tab shown last; LINE goes on once it closes.
  await enterCommand(page, 'LINE');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await enterCommand(page, "'OPTIONS");
  await expect(options).toBeVisible();
  await expect(selection).toHaveAttribute('aria-selected', 'true');
  await options.getByRole('button', { name: 'Close' }).click();
  await expect(options).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify first point:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // The title bar's Settings button opens the same dialog.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(options).toBeVisible();
  await expect(selection).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
});
