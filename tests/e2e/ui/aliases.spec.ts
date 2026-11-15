// M3-10: the user alias file (FR-C4), the acceptance's alias override test in the app. Settings'
// Edit aliases… opens the Edit Aliases dialog, whose acad.pgp text is checked as it is typed; on
// OK `C,*COPY` makes C run COPY in place of CIRCLE at once, in the drawing open, and the file is
// kept on the device: after a reload C still runs COPY, and Ctrl+K's Edit Aliases opens it again.
// A .pgp file can be imported in place of the text. Parsing and the registry's lookup order are
// unit-tested in packages/engine/test/commands/pgp.test.ts.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit Aliases' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
}

test('a user alias overrides a default one, at once and after a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await open(page);
  // The default acad.pgp alias: C is CIRCLE.
  await type(page, 'C', /^Specify center point for circle/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Edit aliases…' }).click();
  await expect(editor(page)).toBeVisible();
  const file = editor(page).getByRole('textbox', { name: 'User aliases (acad.pgp)' });
  await expect(file).toHaveValue(/-- User Defined Command Aliases --/);
  await expect(editor(page)).toContainText('0 aliases');
  await shot('1-edit-aliases-new.png');
  await file.press('ControlOrMeta+End');
  await page.keyboard.type(
    'C,       *COPY\nQQ,      *NOSUCHCMD\nNOTEPAD,START NOTEPAD,1,*File: ,\n',
  );
  await expect(editor(page)).toContainText('2 aliases, 1 in place of default ones');
  const problems = editor(page).getByRole('list', { name: 'Problems' });
  await expect(problems).toContainText('NOSUCHCMD is not a command.');
  await expect(problems).toContainText('External commands cannot run in Triya');
  await shot('2-edit-aliases-checked.png');
  // Esc cancels the dialog only; Settings stays open under it.
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Edit aliases…' }).click();
  await expect(editor(page).getByRole('textbox')).not.toHaveValue(/^C, +\*COPY$/m);
  await editor(page).getByRole('textbox').press('ControlOrMeta+End');
  await page.keyboard.type('C,       *COPY\n');
  await editor(page).getByRole('button', { name: 'OK' }).click();
  await expect(editor(page)).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();

  // C now runs COPY in the drawing already open.
  await type(page, 'C', 'Select objects:');
  await shot('3-c-runs-copy.png');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // Kept on the device: after a reload C still runs COPY, and Ctrl+K opens the file again.
  await page.reload();
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'C', 'Select objects:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.keyboard.type('copy');
  await expect(palette.getByRole('option').first()).toContainText('C, CO, CP');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('edit aliases');
  await page.keyboard.press('Enter');
  await expect(editor(page).getByRole('textbox')).toHaveValue(/^C, {7}\*COPY$/m);

  // Import… reads a .pgp file in place of the text; OK uses it.
  await editor(page)
    .getByTestId('alias-file-picker')
    .setInputFiles({
      name: 'acad.pgp',
      mimeType: 'text/plain',
      buffer: Buffer.from('; imported\r\nZZ, *ZOOM\r\n'),
    });
  await expect(editor(page).getByRole('textbox')).toHaveValue(/^; imported\nZZ, \*ZOOM/);
  await editor(page).getByRole('button', { name: 'OK' }).click();
  await type(page, 'C', /^Specify center point for circle/);
  await page.keyboard.press('Escape');
  await type(page, 'ZZ', /^Specify corner of window/);
  await page.keyboard.press('Escape');
});
