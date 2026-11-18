// M5-03 part 2: BATTMAN's Block Attribute Manager in the app, on the title-block test drawing
// (packages/testkit/fixtures/attributes/title-block.dxf): the dialog lists TITLE-BLOCK's
// attribute definitions and its one reference; Move Up, Edit... (Edit Attribute's Attribute and
// Text Options tabs), Remove and Settings... (Block Attribute Settings' columns) wait for Apply,
// which changes the definitions and, with "Apply changes to existing references", the
// reference; Cancel drops what was not applied. The command is unit-tested in
// packages/engine/test/commands/battman.test.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { AttdefGeometry, ChangeSet, InsertGeometry } from '@triya/engine';
import { enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
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

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * What the session changed: the ATTDEFs changed (tag → prompt, height) and removed, and the
 * reference's attributes as the last change left them (tag → height, in order). A definition
 * moved in the block is removed and added back under its own handle.
 */
const changed = (page: Page) =>
  page.evaluate(() => {
    const defs: Record<string, [string, number]> = {};
    const removed: string[] = [];
    let attributes: Record<string, number> | undefined;
    const def = (g: AttdefGeometry) => (defs[g.tag] = [g.prompt, g.height]);
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const added = new Set((cs.entities?.added ?? []).map((a) => a.entity.handle));
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'ATTDEF') def(a.entity.geom as AttdefGeometry);
      }
      for (const u of cs.entities?.updated ?? []) {
        const g = u.after.geom;
        if (g.kind === 'ATTDEF') def(g as AttdefGeometry);
        if (g.kind === 'INSERT') {
          attributes = Object.fromEntries(
            (g as InsertGeometry).attributes.map((a) => [a.tag, a.height]),
          );
        }
      }
      for (const r of cs.entities?.removed ?? []) {
        if (r.entity.geom.kind === 'ATTDEF' && !added.has(r.entity.handle)) {
          removed.push((r.entity.geom as AttdefGeometry).tag);
        }
      }
    }
    return { defs, removed, attributes };
  });

test('the Block Attribute Manager edits, orders and removes definitions', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await expectDrawn(page, { timeout: 15_000 });
  await expect(prompt(page)).toHaveText('Command:');

  await enterCommand(page, 'BATTMAN');
  const dialog = page.getByRole('dialog', { name: 'Block Attribute Manager' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Block:')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('Block:').locator('option:checked')).toHaveText('TITLE-BLOCK');
  await expect(dialog.getByRole('columnheader')).toHaveText(['Tag', 'Prompt', 'Default', 'Modes']);
  const list = dialog.getByRole('listbox', { name: 'Attribute definitions' });
  const rows = list.getByRole('option');
  const tags = async () => (await rows.locator('td:first-child').allTextContents()).slice(0, 4);
  expect(await tags()).toEqual(['TITLE', 'DWG_NO', 'SCALE', 'DRAWN']);
  // The multiline NOTES and the constant COMPANY show their modes.
  await expect(rows.filter({ hasText: 'NOTES' }).locator('td').nth(3)).toHaveText(/M/);
  await expect(rows.filter({ hasText: 'COMPANY' }).locator('td').nth(3)).toHaveText(/C/);
  await expect(dialog.getByTestId('battman-found')).toHaveText(
    /Found in drawing: 1\s*Found in model space: 1/,
  );
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await shot(page, '1-block-attribute-manager');

  // SCALE moved up above DWG_NO.
  await rows.filter({ hasText: 'SCALE' }).first().click();
  await dialog.getByRole('button', { name: 'Move Up' }).click();
  expect(await tags()).toEqual(['TITLE', 'SCALE', 'DWG_NO', 'DRAWN']);
  // A constant definition does not move.
  await rows.filter({ hasText: 'COMPANY' }).click();
  await expect(dialog.getByRole('button', { name: 'Move Up' })).toBeDisabled();

  // TITLE edited: its prompt, and a height of 6 on Text Options.
  await rows.filter({ hasText: 'TITLE' }).first().dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Attribute' });
  await expect(edit).toBeVisible();
  await expect(edit.getByTestId('battman-active-block')).toHaveText('TITLE-BLOCK');
  await expect(edit.getByLabel('Constant')).toBeDisabled();
  await edit.getByLabel('Prompt:').fill('Drawing title');
  // A tag with a space is refused.
  await edit.getByLabel('Tag:').fill('THE TITLE');
  await expect(edit.getByRole('alert')).toHaveText('A tag cannot contain spaces.');
  await expect(edit.getByRole('button', { name: 'OK' })).toBeDisabled();
  await edit.getByLabel('Tag:').fill('title');
  await shot(page, '2-edit-attribute');
  await edit.getByRole('tab', { name: 'Text Options' }).click();
  await edit.getByLabel('Height:').fill('6');
  await shot(page, '3-edit-attribute-text-options');
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await expect(rows.first().locator('td').nth(1)).toHaveText('Drawing title');

  // Block Attribute Settings: Height and Layer listed too.
  await dialog.getByRole('button', { name: 'Settings...' }).click();
  const settings = page.getByRole('dialog', { name: 'Block Attribute Settings' });
  await expect(settings.getByLabel('Tag', { exact: true })).toBeDisabled();
  await expect(settings.getByLabel('Apply changes to existing references')).toBeChecked();
  await settings.getByLabel('Height', { exact: true }).check();
  await settings.getByLabel('Layer', { exact: true }).check();
  await shot(page, '4-block-attribute-settings');
  await settings.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.getByRole('columnheader')).toHaveText([
    'Tag',
    'Prompt',
    'Default',
    'Modes',
    'Height',
    'Layer',
  ]);
  await expect(rows.first().locator('td').nth(4)).toHaveText('6.0000');

  // REV3_BY removed; Apply changes the definitions and the reference.
  await rows.filter({ hasText: 'REV3_BY' }).click();
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(rows.filter({ hasText: 'REV3_BY' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(await tags()).toEqual(['TITLE', 'SCALE', 'DWG_NO', 'DRAWN']);
  await shot(page, '5-applied');
  const after = await changed(page);
  expect(after.defs['TITLE']).toEqual(['Drawing title', 6]);
  expect(after.removed).toEqual(['REV3_BY']);
  expect(after.attributes?.['TITLE']).toBe(6);
  expect(after.attributes && 'REV3_BY' in after.attributes).toBe(false);
  expect(Object.keys(after.attributes ?? {}).slice(0, 3)).toEqual(['TITLE', 'SCALE', 'DWG_NO']);

  // Cancel drops what was not applied: DRAWN removed, then cancelled.
  await rows.filter({ hasText: 'DRAWN' }).click();
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  expect((await changed(page)).removed).toEqual(['REV3_BY']);
  await shot(page, '6-after');

  // The settings stay for the next BATTMAN; the whole session is one undo step.
  await enterCommand(page, 'BATTMAN');
  await expect(dialog.getByRole('columnheader')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// M5-03 part 3: Edit Attribute's "Auto preview changes": on (as AutoCAD starts), a change shows
// on the reference at once, before OK; Cancel takes it back; off, nothing shows until Apply;
// greyed while "Apply changes to existing references" is off.
test("Edit Attribute's Auto preview changes shows changes on the reference at once", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await expectDrawn(page, { timeout: 15_000 });
  await expect(prompt(page)).toHaveText('Command:');
  /** TITLE's height on the reference, as the last change left it (the file's when none did). */
  const titleHeight = async () => (await changed(page)).attributes?.['TITLE'];
  await shot(page, '7-before-preview');

  await enterCommand(page, 'BATTMAN');
  const dialog = page.getByRole('dialog', { name: 'Block Attribute Manager' });
  const rows = dialog.getByRole('listbox', { name: 'Attribute definitions' }).getByRole('option');
  await rows.filter({ hasText: 'TITLE' }).first().dblclick();
  const edit = page.getByRole('dialog', { name: 'Edit Attribute' });
  const auto = edit.getByLabel('Auto preview changes');
  await expect(auto).toBeChecked();
  await edit.getByRole('tab', { name: 'Text Options' }).click();
  await edit.getByLabel('Height:').fill('12');
  // The reference shows it while the dialog is still open.
  await expect.poll(titleHeight).toBe(12);
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('Height:')).toHaveValue('12');
  await shot(page, '8-auto-preview');
  // Cancel takes it back.
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toBeHidden();
  await expect.poll(titleHeight).not.toBe(12);
  const original = await titleHeight();

  // Off: nothing shows until Apply.
  await rows.filter({ hasText: 'TITLE' }).first().dblclick();
  await auto.uncheck();
  await edit.getByRole('tab', { name: 'Text Options' }).click();
  await edit.getByLabel('Height:').fill('9');
  await edit.getByRole('button', { name: 'OK' }).click();
  expect(await titleHeight()).toBe(original);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(titleHeight).toBe(9);

  // Greyed without "Apply changes to existing references".
  await dialog.getByRole('button', { name: 'Settings...' }).click();
  const settings = page.getByRole('dialog', { name: 'Block Attribute Settings' });
  await settings.getByLabel('Apply changes to existing references').uncheck();
  await settings.getByRole('button', { name: 'OK' }).click();
  await rows.filter({ hasText: 'TITLE' }).first().dblclick();
  await expect(auto).toBeDisabled();
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '9-after-apply');
});
