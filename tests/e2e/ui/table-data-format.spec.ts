// M4-16 part 2: a table cell's data format. The Table Cell menu's Data Format... opens the Table
// Cell Format dialog (Data type, Preview, Format, Precision, Symbol and Append symbol, the date
// format and its Examples); OK gives every cell selected the type, numbers typed there shown in
// its format, and what is typed later is read by it. On an empty part of the acadsharp AC1032
// sample. Part 3: Additional Format... (a thousands separator) and a point's X, Y and Z boxes.
// The formats, the command and the save are unit- and corpus-tested in packages/engine and
// packages/testkit.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, TableGeometry } from '@triya/engine';
import { activeCanvas, expectShown, openWithPicker, viewOf } from '../app/page';
import { CORPUS, startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The table made in this test: each cell's text, and its value's format string. */
const made = (page: Page) =>
  page.evaluate(() => {
    const all = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) all.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) all.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) all.delete(r.entity.handle);
    }
    const t = [...all.values()].find((e) => e.geom.kind === 'ACAD_TABLE');
    if (!t) return undefined;
    const g = t.geom as TableGeometry;
    return {
      cells: g.cells.map((r) => r.map((c) => c.text)),
      formats: g.cells.map((r) => r.map((c) => c.valueFormat ?? '')),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('Data Format... gives the cells selected a data type', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(9, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '3', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  const texts = ['PUMPS', 'Mark', 'Flow', 'Cost', 'P1', '12.5', '1200', 'P2', '8', '950.5', 'P3'];
  for (const [k, text] of texts.entries()) {
    if (k > 0) await page.keyboard.press('Tab');
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.cells[3]).toEqual(['P2', '8', '950.5']);

  const view = await viewOf(page);
  // The centre of cell (row i, column j): 2.5 wide columns, a 0.4533 title, 0.36 rows.
  const cell = (i: number, j: number) => {
    const y = i === 0 ? -0.2267 : i === 1 ? -0.6333 : -0.9933 - 0.36 * (i - 2);
    const s = view.at(O + 1.25 + 2.5 * j, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const away = async () => {
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
    await page.waitForTimeout(300);
  };
  await away();
  await shot('1-before.png');

  // The Cost column's data cells: Currency, the preview showing the first cell.
  await page.mouse.click(cell(2, 2).x, cell(2, 2).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(4, 2).x, cell(4, 2).y);
  await page.keyboard.up('Shift');
  await page.mouse.click(cell(3, 2).x, cell(3, 2).y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Table cell options' });
  await menu.getByRole('menuitem', { name: 'Data Format...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Table Cell Format' });
  /**
   * Waits for the Table Cell Format dialog's OK to end TABLECELL. The dialog is modal and stays
   * open until the engine's reply closes it, which comes after the change the `made` polls see:
   * a click or double click sent before then reaches an inert page, or a command that is ending
   * (CI run 44441148463 lost the double click into the empty Currency cell, 'Command:' for 5 s).
   */
  const closed = async () => {
    await expect(dialog).toBeHidden();
    await expect(prompt(page)).toHaveText('Command:');
  };
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Data type:')).toHaveValue('4');
  await expect(dialog.getByLabel('Preview')).toHaveText('1200');
  await dialog.getByLabel('Data type:').selectOption({ label: 'Currency' });
  await expect(dialog.getByLabel('Preview')).toHaveText('$1200.00');
  await dialog.getByLabel('Symbol:').selectOption('€');
  await dialog.getByLabel('Append symbol').check();
  await expect(dialog.getByLabel('Preview')).toHaveText('1200.00€');
  await dialog.getByLabel('Symbol:').selectOption('$');
  await dialog.getByLabel('Append symbol').uncheck();
  await shot('2-table-cell-format.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page))?.cells.map((r) => r[2]))
    .toEqual(['', 'Cost', '$1200.00', '$950.50', '']);

  // The Flow column: Decimal Number with one place; Cancel first changes nothing.
  await page.mouse.click(cell(2, 1).x, cell(2, 1).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(3, 1).x, cell(3, 1).y);
  await page.keyboard.up('Shift');
  await page.keyboard.type('DF');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.click(cell(2, 1).x, cell(2, 1).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(3, 1).x, cell(3, 1).y);
  await page.keyboard.up('Shift');
  await page.keyboard.type('DF');
  await page.keyboard.press('Enter');
  await dialog.getByLabel('Data type:').selectOption({ label: 'Decimal Number' });
  await dialog.getByLabel('Format:').selectOption({ label: 'Decimal' });
  await dialog.getByLabel('Precision:').selectOption({ label: '0.0' });
  await expect(dialog.getByLabel('Preview')).toHaveText('12.5');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await closed();
  await expect
    .poll(async () => (await made(page))?.cells.map((r) => r[1]))
    .toEqual(['', 'Flow', '12.5', '8.0', '']);
  expect((await made(page))!.formats[3]![1]).toBe('%lu2%pr1');

  // The header: Text in upper case, which the preview shows.
  await page.mouse.click(cell(1, 0).x, cell(1, 0).y);
  await page.keyboard.type('DF');
  await page.keyboard.press('Enter');
  await dialog.getByLabel('Data type:').selectOption({ label: 'Text' });
  await dialog.getByLabel('Format:').selectOption({ label: 'Uppercase' });
  await expect(dialog.getByLabel('Preview')).toHaveText('MARK');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await closed();
  await expect.poll(async () => (await made(page))?.formats[1]?.[0]).toBe('%tc1');

  // A number typed into the empty Currency cell is shown in its format.
  await page.mouse.dblclick(cell(4, 2).x, cell(4, 2).y);
  await expect(prompt(page)).toHaveText('Enter text:');
  await page.keyboard.type('75');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.cells[4]?.[2]).toBe('$75.00');
  await away();
  await shot('3-formatted.png');

  // M4-16 part 3: Additional Format... on the Cost column, a thousands separator.
  await page.mouse.click(cell(2, 2).x, cell(2, 2).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(4, 2).x, cell(4, 2).y);
  await page.keyboard.up('Shift');
  await page.keyboard.type('DF');
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Data type:')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Additional Format...' }).click();
  const more = page.getByRole('dialog', { name: 'Additional Format' });
  await expect(more).toBeVisible();
  await expect(more.getByLabel('Current value')).toHaveText('$1200.00');
  // Currency's symbol is its prefix: the Additional text is not offered.
  await expect(more.getByLabel('Prefix:')).toBeDisabled();
  await expect(more.getByLabel('0 Feet')).toBeDisabled();
  await more.getByLabel('Thousands:').selectOption({ label: ', (comma)' });
  await expect(more.getByLabel('Current value')).toHaveText('$1,200.00');
  await more.getByLabel('Trailing').check();
  await expect(more.getByLabel('Current value')).toHaveText('$1,200');
  await more.getByLabel('Trailing').uncheck();
  await more.getByLabel('Conversion factor:').fill('0');
  await expect(more.getByRole('alert')).toBeVisible();
  await expect(more.getByRole('button', { name: 'OK' })).toBeDisabled();
  await more.getByLabel('Conversion factor:').fill('1');
  await shot('4-additional-format.png');
  await more.getByRole('button', { name: 'OK' }).click();
  await expect(more).toBeHidden();
  await expect(dialog.getByLabel('Preview')).toHaveText('$1,200.00');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await closed();
  await expect
    .poll(async () => (await made(page))?.cells.map((r) => r[2]))
    .toEqual(['', 'Cost', '$1,200.00', '$950.50', '$75.00']);
  expect((await made(page))!.formats[2]![2]).toBe('%lu2%pr2%ps[$,]%th44');

  // A Point in the empty Flow cell showing X and Y only.
  await page.mouse.click(cell(4, 1).x, cell(4, 1).y);
  await page.keyboard.type('DF');
  await page.keyboard.press('Enter');
  await dialog.getByLabel('Data type:').selectOption({ label: 'Point' });
  await dialog.getByLabel('Format:').selectOption({ label: 'Decimal' });
  await dialog.getByLabel('Precision:').selectOption({ label: '0.0' });
  await expect(dialog.getByLabel('Preview')).toHaveText('1234.5, 100.0, 0.0');
  await dialog.getByLabel('Z', { exact: true }).uncheck();
  await expect(dialog.getByLabel('Preview')).toHaveText('1234.5, 100.0');
  await dialog.getByLabel('Y', { exact: true }).uncheck();
  // One coordinate at least stays shown.
  await expect(dialog.getByLabel('X', { exact: true })).toBeDisabled();
  await dialog.getByLabel('Y', { exact: true }).check();
  await shot('5-point-coordinates.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await closed();
  await page.mouse.dblclick(cell(4, 1).x, cell(4, 1).y);
  await expect(prompt(page)).toHaveText('Enter text:');
  await page.keyboard.type('3,4,5');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.cells[4]?.[1]).toBe('3.0, 4.0');
  expect((await made(page))!.formats[4]![1]).toBe('%lu2%pr1%pt3');
  await away();
  await shot('6-after.png');
});
