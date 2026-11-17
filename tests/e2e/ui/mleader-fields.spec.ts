// M4-23: fields in multileaders, from the app. MLEADER's In-Place Text Editor inserts a field
// (Ctrl+F opens the Field dialog) as MTEXT's does; a double click on the multileader opens the
// editor on it with the field shown by its value, and the field's right-click menu has Update
// Field (AutoCAD 2024 Help, "To Update a Field Manually": "In the In-Place Text Editor, select
// the field you want to update, right-click, and click Update Field"), which opens the editor
// again with the field evaluated now. The codes and their evaluation are unit-tested in
// packages/engine (test/commands/mleader-fields.test.ts) and the DXF save in packages/testkit
// (src/export/fields-new.test.ts); this checks the app carries them end to end.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MultiLeaderGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The multileaders this test made, as the change sets last left them: text and field codes. */
const leaders = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
    }
    return [...out.values()]
      .filter((e) => e.type === 'MULTILEADER')
      .map((e) => {
        const t = (e.geom as MultiLeaderGeometry).text;
        return [t?.content, (t?.field?.children ?? []).map((c) => c.code)];
      });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const YEAR = '\\AcVar Date \\f "yyyy"';

test('a multileader holds a field: inserted in MLEADER, updated from the editor’s menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  // An empty part of the plan, 160 × 100 units across; the Standard style's text is 4 high.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const year = await page.evaluate(() => `${new Date().getFullYear()}`);

  await type(page, 'MLD', /^Specify leader arrowhead location or/);
  await type(page, '1000020,1000020', 'Specify leader landing location:');
  await type(page, '1000040,1000060', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Rev ');
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Date format:').fill('yyyy');
  await expect(dialog.getByLabel('Preview')).toHaveText(year);
  await dialog.getByRole('button', { name: 'OK' }).click();
  const reopened = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(reopened.locator('.mtext-field')).toHaveText(year);
  await page.screenshot({ path: test.info().outputPath('1-field-in-mleader-editor.png') });
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => leaders(page)).toEqual([[`Rev ${year}`, [YEAR]]]);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.screenshot({ path: test.info().outputPath('2-multileader-with-field.png') });

  // A double click opens the editor on the field; its menu updates it.
  const word = at(58, 59);
  await page.mouse.dblclick(word.x, word.y);
  await expect(prompt(page)).toHaveText('Enter text:');
  const editing = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editing.locator('.mtext-field')).toHaveText(year);
  await editing.locator('.mtext-field').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Field' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Edit Field…',
    'Update Field',
    'Convert Field to Text',
  ]);
  await page.screenshot({ path: test.info().outputPath('3-update-field-menu.png') });
  await menu.getByRole('menuitem', { name: 'Update Field' }).click();
  // The editor opens again on the same text, the field in place.
  const updated = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(updated.locator('.mtext-field')).toHaveText(year);
  await expect(updated).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' B');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Select an annotation object or [Undo/Mode]:');
  await type(page, '', 'Command:');
  await expect.poll(() => leaders(page)).toEqual([[`Rev ${year} B`, [YEAR]]]);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
