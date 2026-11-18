// M5-03 part 4: Insert Field in the attribute dialogs, in the app, on the title-block test
// drawing (packages/testkit/fixtures/attributes/title-block.dxf): EATTEDIT's Value (Ctrl+F),
// BATTMAN Edit Attribute's Default and ATTDEF's Default (their Insert Field buttons) open the
// Field dialog, and each comes back showing the field made by its value, which the attribute,
// definition or new definition then holds; a double click on the field opens it for Edit
// Field. The engine side is unit-tested in packages/engine/test/commands/attribute-fields.test.ts
// and the save in packages/testkit/src/attributes/attribute-fields.test.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { AttdefGeometry, ChangeSet, DrawingField, InsertGeometry } from '@triya/engine';
import { activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FILE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * What the session last made of each attribute (`ATTRIB tag`) and definition (`ATTDEF tag`): its
 * value and its fields' codes.
 */
const fields = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, [string, string[]]> = {};
    const codes = (f: DrawingField | undefined) => (f?.children ?? []).map((c) => c.code);
    const note = (g: unknown) => {
      const x = g as AttdefGeometry | InsertGeometry;
      if (x.kind === 'ATTDEF') out[`ATTDEF ${x.tag}`] = [x.value, codes(x.field)];
      if (x.kind === 'INSERT') {
        for (const a of x.attributes) out[`ATTRIB ${a.tag}`] = [a.value, codes(a.field)];
      }
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) note(a.entity.geom);
      for (const u of cs.entities?.updated ?? []) note(u.after.geom);
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Today as the Field dialog's first Date format, `M/d/yyyy`, shows it. */
const today = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  });

const DATE = '\\AcVar Date \\f "M/d/yyyy"';
const YEAR = '\\AcVar Date \\f "yyyy"';

test('Insert Field puts fields in EATTEDIT, BATTMAN and ATTDEF values', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '225,5', 'Specify opposite corner:');
  await type(page, '415,75', 'Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  // ZOOM Window fits 190 × 70 units about (320, 40) into the canvas; the title block's frame
  // line under the title fields is at (330, 44).
  const k = Math.min(box.width / 190, box.height / 70);
  const date = await today(page);
  const fieldDialog = page.getByRole('dialog', { name: 'Field' });

  // EATTEDIT: DWG_NO's value gets the date after "No. ", Ctrl+F where the caret is.
  await page.mouse.dblclick(box.x + box.width / 2 + 10 * k, box.y + box.height / 2 - 4 * k);
  const eattedit = page.getByRole('dialog', { name: 'Enhanced Attribute Editor' });
  await expect(eattedit).toBeVisible();
  await eattedit
    .getByRole('listbox', { name: 'Attributes' })
    .getByRole('option')
    .filter({
      hasText: 'DWG_NO',
    })
    .click();
  const value = eattedit.getByRole('textbox', { name: 'Value:' });
  await value.fill('No. ');
  await value.press('End');
  await value.press('Control+f');
  await expect(fieldDialog).toBeVisible();
  await expect(fieldDialog.getByLabel('Date format:')).toHaveValue('M/d/yyyy');
  await shot(page, '1-eattedit-field-dialog');
  await fieldDialog.getByRole('button', { name: 'OK' }).click();
  await expect(eattedit).toBeVisible();
  await expect(eattedit.getByTestId('eattedit-tag')).toHaveText('DWG_NO');
  await expect(value).toHaveValue(`No. ${date}`);
  await expect.poll(() => fields(page)).toMatchObject({ 'ATTRIB DWG_NO': [`No. ${date}`, [DATE]] });
  // The field is one atom: a double click on it opens it for Edit Field (as yyyy here).
  await value.evaluate((el: HTMLInputElement) => el.setSelectionRange(5, 5));
  await value.dispatchEvent('dblclick');
  await expect(fieldDialog).toBeVisible();
  await fieldDialog.getByLabel('Date format:').fill('yyyy');
  await fieldDialog.getByRole('button', { name: 'OK' }).click();
  const year = String(new Date().getFullYear());
  await expect(value).toHaveValue(`No. ${year}`);
  await shot(page, '2-eattedit-with-field');
  await eattedit.getByRole('button', { name: 'OK' }).click();
  await expect(eattedit).toBeHidden();
  await expect.poll(() => fields(page)).toMatchObject({ 'ATTRIB DWG_NO': [`No. ${year}`, [YEAR]] });

  // BATTMAN: Edit Attribute's Insert Field on SCALE's default, the manager kept meanwhile.
  await enterCommand(page, 'BATTMAN');
  const manager = page.getByRole('dialog', { name: 'Block Attribute Manager' });
  await expect(manager).toBeVisible();
  const rows = manager.getByRole('listbox', { name: 'Attribute definitions' }).getByRole('option');
  await rows.filter({ hasText: 'SCALE' }).first().dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Attribute' });
  await edit.getByLabel('Prompt:').fill('Plot date');
  await edit.getByRole('textbox', { name: 'Default:' }).fill('');
  await edit.getByRole('button', { name: 'Insert Field' }).click();
  await expect(fieldDialog).toBeVisible();
  await fieldDialog.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('Prompt:')).toHaveValue('Plot date');
  await expect(edit.getByRole('textbox', { name: 'Default:' })).toHaveValue(date);
  await shot(page, '3-battman-edit-attribute-field');
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(rows.filter({ hasText: 'SCALE' }).first().locator('td').nth(2)).toHaveText(date);
  await manager.getByRole('button', { name: 'OK' }).click();
  await expect(manager).toBeHidden();
  await expect.poll(() => fields(page)).toMatchObject({ 'ATTDEF SCALE': [date, [DATE]] });

  // ATTDEF: "Issued " and the date, from the Default's Insert Field button.
  await enterCommand(page, 'ATTDEF');
  const attdef = page.getByRole('dialog', { name: 'Attribute Definition' });
  await expect(attdef).toBeVisible();
  await attdef.getByLabel('Tag:').fill('ISSUED');
  await attdef.getByLabel('Prompt:').fill('Issued');
  await attdef.getByLabel('Default:').fill('Issued ');
  await attdef.getByLabel('Default:').press('End');
  await attdef.getByRole('button', { name: 'Insert Field' }).click();
  await expect(fieldDialog).toBeVisible();
  await fieldDialog.getByRole('button', { name: 'OK' }).click();
  await expect(attdef).toBeVisible();
  await expect(attdef.getByLabel('Tag:')).toHaveValue('ISSUED');
  await expect(attdef.getByLabel('Default:')).toHaveValue(`Issued ${date}`);
  await shot(page, '4-attdef-default-field');
  await attdef.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Specify start point:');
  await type(page, '240,60', 'Command:');
  await expect
    .poll(() => fields(page))
    .toMatchObject({ 'ATTDEF ISSUED': [`Issued ${date}`, [DATE]] });
  await shot(page, '5-attdef-made');
});
