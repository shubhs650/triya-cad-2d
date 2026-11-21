// M6-02 part 22: SCALELISTEDIT's Edit Drawing Scales dialog (AutoCAD 2024 Help, "Edit Drawing
// Scales Dialog Box", "Add Scale Dialog Box", "Edit Scale Dialog Box"), opened from the status
// bar's annotation scale menu (Custom...) on the acadsharp AC1032 sample. Its 33 scales list with
// each one's units; 1:1, current and named by the annotative TEXT 3BA, cannot be deleted. Add
// makes Site (1:500), Move Up moves it, Edit renames 1:2 Half, Delete removes 1:4, all with the
// keyboard or the buttons; OK makes the list in one undo step, which the scale menu shows and U
// takes back. Esc changes nothing. The engine and the save are unit-tested
// (scalelistedit.test.ts, scale-list.test.ts, export-scale-list.corpus.test.ts).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectInputsRead, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');

/** With TRIYA_SCREENSHOTS set, a picture for the PR (M6-02 part 22). */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The status bar's annotation scales, as its menu lists them; the menu closed again. */
async function menuScales(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: 'Annotation Scale' }).click();
  const menu = page.getByRole('menu', { name: 'Annotation scales' });
  const names = (await menu.getByRole('menuitemradio').allTextContents()).map((s) =>
    s.replace('✓', '').trim(),
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return names;
}

test('Edit Drawing Scales adds, moves, renames and deletes scales in one undo step', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const before = await menuScales(page);
  expect(before).toHaveLength(33);

  // Custom... at the foot of the annotation scale menu opens the dialog.
  await page.getByRole('button', { name: 'Annotation Scale' }).click();
  await page.getByRole('menuitem', { name: 'Custom...' }).click();
  const d = page.getByRole('dialog', { name: 'Edit Drawing Scales' });
  await expect(d).toBeVisible();
  const list = d.getByRole('listbox', { name: 'Scale List' });
  await expect(list.getByRole('option')).toHaveCount(33);
  const selected = list.locator('[aria-selected="true"]');
  await expect(selected).toHaveText('1:1');
  await expect(d.getByText('1 paper units = 1 drawing units')).toBeVisible();
  // The current scale, which an annotative object uses too, cannot be deleted.
  await expect(d.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(d.getByRole('button', { name: 'Move Up' })).toBeDisabled();
  // The keyboard walks the list.
  await selected.focus();
  await page.keyboard.press('ArrowDown');
  await expect(selected).toHaveText('1:2');
  await expect(d.getByText('1 paper units = 2 drawing units')).toBeVisible();
  await shot(page, '1-edit-drawing-scales');

  // Add...: a name the list has is refused; Site, 1 paper unit to 500 drawing units, joins the end.
  await d.getByRole('button', { name: 'Add...' }).click();
  const add = page.getByRole('dialog', { name: 'Add Scale' });
  await expect(add).toBeVisible();
  await add.getByLabel('Name appearing in scale list').fill('1:2');
  await add.getByLabel('Drawing units').fill('500');
  await add.getByRole('button', { name: 'OK' }).click();
  await expect(add.getByRole('alert')).toHaveText('A scale named "1:2" already exists.');
  await add.getByLabel('Name appearing in scale list').fill('Site');
  await shot(page, '2-add-scale');
  await add.getByRole('button', { name: 'OK' }).click();
  await expect(add).toBeHidden();
  await expect(list.getByRole('option')).toHaveCount(34);
  await expect(selected).toHaveText('Site');
  await expect(d.getByText('1 paper units = 500 drawing units')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Move Down' })).toBeDisabled();
  await d.getByRole('button', { name: 'Move Up' }).click();
  await expect(list.getByRole('option').nth(32)).toHaveText('Site');

  // Edit...: 1:2 renamed Half, its units kept.
  await list.getByRole('option', { name: '1:2', exact: true }).dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Scale' });
  await expect(edit.getByLabel('Drawing units')).toHaveValue('2');
  await edit.getByLabel('Name appearing in scale list').fill('Half');
  await page.keyboard.press('Enter');
  await expect(edit).toBeHidden();
  await expect(selected).toHaveText('Half');

  // Delete: 1:4 by the Delete key.
  await list.getByRole('option', { name: '1:4', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(list.getByRole('option')).toHaveCount(33);
  await expect(list.getByRole('option', { name: '1:4', exact: true })).toHaveCount(0);
  await shot(page, '3-edited-list');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d).toBeHidden();
  await expectInputsRead(page);

  const after = await menuScales(page);
  expect(after).toHaveLength(33);
  expect(after[1]).toBe('Half');
  expect(after.at(-2)).toBe('Site');
  expect(after).not.toContain('1:4');
  await page.getByRole('button', { name: 'Annotation Scale' }).click();
  await page.getByRole('menuitem', { name: 'Custom...' }).scrollIntoViewIfNeeded();
  await shot(page, '4-annotation-scale-menu');
  await page.keyboard.press('Escape');

  // Esc closes the dialog and changes nothing.
  await enterCommand(page, 'SCALELISTEDIT');
  await expect(d).toBeVisible();
  await expect(list.getByRole('option').nth(1)).toHaveText('Half');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expectInputsRead(page);
  expect(await menuScales(page)).toEqual(after);

  // One undo step takes the whole edit back.
  await enterCommand(page, 'U');
  await expectInputsRead(page);
  expect(await menuScales(page)).toEqual(before);
});
