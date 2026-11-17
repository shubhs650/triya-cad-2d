// M4-23 part 2: fields in table cells, from the app. The cell editor inserts a field (Ctrl+F
// opens the Field dialog) as the MTEXT editor does, and the table draws the field's value; a
// double click on the cell opens the editor on it with the field shown by its value, and the
// field's right-click menu has Edit Field…, Update Field and Convert Field to Text; the field is
// shaded grey on screen until FIELDDISPLAY is 0 (M4-32). The codes,
// their evaluation and UPDATEFIELD/FIELDEVAL/REGEN are unit-tested in packages/engine
// (test/commands/table-fields.test.ts) and the DXF save in packages/testkit
// (src/export/table-fields.test.ts); this checks the app carries them end to end.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, TableGeometry } from '@triya/engine';
import { activeCanvas, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;
const YEAR = '\\AcVar Date \\f "yyyy"';
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The tables made in this test: each text cell's text and field codes. */
const cells = (page: Page) =>
  page.evaluate(() => {
    const all = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) all.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) all.set(u.after.handle, u.after);
    }
    return [...all.values()]
      .filter((e) => e.geom.kind === 'ACAD_TABLE')
      .map((e) =>
        (e.geom as TableGeometry).cells.map((r) =>
          r.map((c) => [c.text, (c.field?.children ?? []).map((k) => k.code)]),
        ),
      );
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('a table cell holds a field: inserted in the cell editor, updated from its menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const box = (await activeCanvas(page).boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor below the canvas, where Dynamic Input does not take them.
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -2), 'Specify opposite corner:');
  await type(page, p(6, 1), 'Command:');
  const year = await page.evaluate(() => `${new Date().getFullYear()}`);

  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '2', 'Enter number of rows or [Auto] <1>:');
  await type(page, '1', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  // The cell editor opens in the title cell, with Insert Field.
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
  await expect(reopened).toBeFocused();
  await shot('1-field-in-cell-editor.png');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await cells(page))[0]?.[0]?.[0]).toEqual([`Rev ${year}`, [YEAR]]);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.waitForTimeout(300);
  await shot('2-table-with-field.png');

  // A double click on the title opens the editor on the field; its menu updates it.
  const view = await viewOf(page);
  const title = view.at(O + 1.25, O - 0.2267);
  await page.mouse.dblclick(box.x + title.x, box.y + title.y);
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
  await shot('3-cell-field-menu.png');
  await menu.getByRole('menuitem', { name: 'Update Field' }).click();
  const updated = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(updated.locator('.mtext-field')).toHaveText(year);
  await expect(updated).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' B');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await cells(page))[0]?.[0]?.[0])
    .toEqual([`Rev ${year} B`, [YEAR]]);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.waitForTimeout(300);
  await shot('4-after.png');

  // FIELDDISPLAY shades the cell's field (M4-32): 0 takes the grey background away, 1 brings it
  // back. The shading's place and its leaving plots out are unit-tested in packages/render
  // (test/table-fields.test.ts).
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const shaded = await canvas.screenshot();
  await type(page, 'FIELDDISPLAY', 'Enter new value for FIELDDISPLAY <1>:');
  await type(page, '0', 'Command:');
  await page.mouse.move(box.x + 10, box.y + 10);
  await expect.poll(async () => (await canvas.screenshot()).equals(shaded)).toBe(false);
  await expectDrawn(page, { timeout: 15_000 });
  await shot('5-fielddisplay-0.png');
  await type(page, 'FIELDDISPLAY', 'Enter new value for FIELDDISPLAY <0>:');
  await type(page, '1', 'Command:');
  await page.mouse.move(box.x + 10, box.y + 10);
  await expect.poll(async () => (await canvas.screenshot()).equals(shaded)).toBe(true);
});
