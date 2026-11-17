// M4-10 part 4: Edit Field and fields in TEXT's line editor, from the app. A double click on a
// field in the MTEXT editor opens the Field dialog on it (AutoCAD 2024 Help, "To Edit a Field":
// "In the In-Place Text Editor, double-click the field to display the Field dialog box") and the
// editor opens again with the field as the dialog left it; its right-click menu also converts it
// to text. TEXT's line editor takes Ctrl+F too, and shows and edits a field as one atom. The
// codes are unit-tested in packages/engine (test/commands/field.test.ts) and the line editor's
// edits in apps/web/test/text-editor.test.ts; this checks the editors carry them end to end.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry, TextGeometry } from '@triya/engine';
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

/** The texts added in this test: their kind, what they show and their fields' codes. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out: [string, string, string[]][] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        const g = a.entity.geom as MTextGeometry | TextGeometry;
        if (g.kind === 'MTEXT' || g.kind === 'TEXT')
          out.push([
            g.kind,
            g.kind === 'MTEXT' ? g.contents : g.value,
            (g.field?.children ?? []).map((c) => c.code),
          ]);
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
  await page.mouse.move(300, 450);
}

const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
      year: `${d.getFullYear()}`,
    };
  });

test('a double click on a field in the MTEXT editor edits it; its menu converts one to text', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page);
  const { date, year } = await today(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000060',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '@120,-40', 'Enter text:');
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
  await page.keyboard.type('Issued ');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await dialog.getByRole('button', { name: 'OK' }).click();
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor.locator('.mtext-field')).toHaveText(date);

  // Edit Field: the dialog opens on the field's own date picture.
  await editor.locator('.mtext-field').dblclick();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Field names:')).toHaveValue('1');
  await expect(dialog.getByLabel('Date format:')).toHaveValue('M/d/yyyy');
  await dialog.getByLabel('Date format:').fill('yyyy');
  await expect(dialog.getByLabel('Preview')).toHaveText(year);
  await page.screenshot({ path: test.info().outputPath('1-edit-field-dialog.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  const reopened = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(reopened.locator('.mtext-field')).toHaveText(year);

  // A second field, converted to text from its menu.
  await reopened.press('End');
  await page.keyboard.type(' on ');
  await page.keyboard.press('Control+f');
  await dialog.getByRole('button', { name: 'OK' }).click();
  const again = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(again.locator('.mtext-field')).toHaveText([year, date]);
  await again.locator('.mtext-field').nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Field' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Edit Field…',
    'Update Field',
    'Convert Field to Text',
  ]);
  await page.screenshot({ path: test.info().outputPath('2-field-menu.png') });
  await menu.getByRole('menuitem', { name: 'Convert Field to Text' }).click();
  await expect(again.locator('.mtext-field')).toHaveText([year]);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => added(page))
    .toEqual([['MTEXT', `Issued ${year} on ${date}`, ['\\AcVar Date \\f "yyyy"']]]);
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
});

test("TEXT's line editor inserts and edits fields", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  const name = path.basename(DXF, '.dxf');
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000080', /Specify height/);
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  await page.keyboard.type('File: ');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Field category:').selectOption({ label: 'Document' });
  await dialog.getByLabel('Field names:').selectOption({ label: 'Filename' });
  await dialog.getByLabel('Filename only').check();
  await dialog.getByLabel('Display file extension').uncheck();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(line).toHaveValue(`File: ${name}`);
  await expect(line).toBeFocused();
  // Typing goes around the field; a key reaching into it deletes it whole (tested below).
  await page.keyboard.press('End');
  await page.keyboard.type(' A');
  await expect(line).toHaveValue(`File: ${name} A`);
  await page.screenshot({ path: test.info().outputPath('3-text-line-field.png') });

  // Edit Field: a double click on the field opens the dialog on it.
  await line.evaluate((el: HTMLInputElement) => {
    el.setSelectionRange(7, 7);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Filename only')).toBeChecked();
  await expect(dialog.getByLabel('Display file extension')).not.toBeChecked();
  await dialog.getByLabel('Format:').selectOption({ label: 'Uppercase' });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(line).toHaveValue(`File: ${name.toUpperCase()} A`);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Enter text:');

  // The next line: Backspace at a field's end deletes it whole.
  await expect(line).toHaveValue('');
  await expect(line).toBeFocused();
  await page.keyboard.type('X ');
  await expect(line).toHaveValue('X ');
  await page.keyboard.press('Control+f');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(line).toHaveValue(/^X \d+\/\d+\/\d{4}$/);
  await expect(line).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(line).toHaveValue('X ');
  await page.keyboard.press('Enter');
  // The line placed, the next opens empty below; Enter on it ends TEXT.
  await expect(line).toHaveValue('');
  await expect(line).toBeFocused();
  await type(page, '', 'Command:');
  await expect
    .poll(() => added(page))
    .toEqual([
      ['TEXT', `File: ${name.toUpperCase()} A`, ['\\AcVar Filename \\f "%tc1%fn2"']],
      ['TEXT', 'X ', []],
    ]);
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('4-text-with-field.png') });
});
