// M4-10 part 2: FIELD's Field dialog and the MTEXT editor's Insert Field from the app. FIELD opens
// the dialog (Field category, Field names, the field's format, Preview, Field expression); OK
// asks for the start point and places an MTEXT showing the field's value. In the MTEXT editor,
// Ctrl+F opens the same dialog and the field comes back into the editor where the caret was,
// shown by its value. The codes, evaluation and save are unit-tested in packages/engine
// (test/edit/field-codes.test.ts, test/commands/field.test.ts) and packages/testkit
// (src/export/fields-new.test.ts); this checks the dialog and the editor carry them end to end.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The MTEXTs added in this test: their contents and their fields' codes. */
const mtexts = (page: Page) =>
  page.evaluate(() => {
    const out: [string, string[]][] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        const g = a.entity.geom as MTextGeometry;
        if (g.kind === 'MTEXT')
          out.push([g.contents, (g.field?.children ?? []).map((c) => c.code)]);
      }
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  // Away from the navigation bar, whose menu opens on hover.
  await page.mouse.move(300, 450);
}

/** Today as the date picture `M/d/yyyy` writes it. */
const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  });

test('FIELD places an MTEXT showing the field made in the Field dialog', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await page.keyboard.type('FIELD');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Field category:').selectOption({ label: 'Document' });
  await dialog.getByLabel('Field names:').selectOption({ label: 'Filename' });
  await dialog.getByLabel('Format:').selectOption({ label: 'Uppercase' });
  await dialog.getByLabel('Filename only').check();
  await expect(dialog.getByLabel('Preview')).toHaveText(path.basename(DXF).toUpperCase());
  await expect(dialog.getByLabel('Field expression:')).toHaveValue(
    '%<\\AcVar Filename \\f "%tc1%fn6">%',
  );
  await dialog.getByLabel('Display file extension').uncheck();
  await expect(dialog.getByLabel('Preview')).toHaveText(path.basename(DXF, '.dxf').toUpperCase());
  await page.screenshot({ path: test.info().outputPath('1-field-dialog.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Specify start point or [Height/Justify]:');
  await type(page, 'H', /Specify height/);
  await type(page, '8', 'Specify start point or [Height/Justify]:');
  await type(page, '1000020,1000080', 'Command:');
  await expect
    .poll(() => mtexts(page))
    .toEqual([[path.basename(DXF, '.dxf').toUpperCase(), ['\\AcVar Filename \\f "%tc1%fn2"']]]);
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-field-placed.png') });
});

test('Insert Field (Ctrl+F) puts a field into the MTEXT editor', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000060',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  // Dynamic Input takes the opposite corner as relative to the first.
  await type(page, '@120,-40', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Drawn ');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await expect(dialog).toBeVisible();
  // The dialog opens on Date, with its Examples.
  await expect(dialog.getByLabel('Field names:')).toHaveValue('1');
  await expect(dialog.getByLabel('Date format:')).toHaveValue('M/d/yyyy');
  const date = await today(page);
  await expect(dialog.getByLabel('Preview')).toHaveText(date);
  await dialog.getByRole('button', { name: 'OK' }).click();
  // The editor opens again with the field where the caret was, shown by its value.
  const reopened = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(reopened.locator('.mtext-field')).toHaveText(date);
  await page.screenshot({ path: test.info().outputPath('3-editor-with-field.png') });
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => mtexts(page))
    .toEqual([[`Drawn ${date}`, ['\\AcVar Date \\f "M/d/yyyy"']]]);
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('4-mtext-with-field.png') });
});
