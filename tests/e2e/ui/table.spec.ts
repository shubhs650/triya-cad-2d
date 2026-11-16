// M4-05 part 4: cells selected by dragging across them, filled, aligned and given borders from
// the right-click menu, and a column grip dragged.
// M4-05 part 3: a click inside a table cell selects it, Shift+click the cells up to another, and
// the right-click menu (AutoCAD's cell shortcut menu) merges cells, inserts rows and deletes
// columns.
// M4-05 part 2: TABLE's Insert Table dialog, the table dragged to its insertion point and the
// nozzle schedule typed in the cell editor that opens in its title cell, Tab moving from cell
// to cell.
// M4-05 part 1: -TABLE in the app, on an empty part of the acadsharp AC1032 sample (its Standard
// table style, imperial). Four columns and three data rows are inserted at a typed point: the
// table is drawn from the `*T` block the table engine wrote for it, a title row merged across, a
// header row and the data rows. The command's prompts, the engine's drawing and the save are
// unit- and corpus-tested in packages/engine and packages/testkit.
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

/** The tables made in this test, with the kinds of what their block holds. */
const tables = (page: Page) =>
  page.evaluate(() => {
    const all = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) all.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) all.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) all.delete(r.entity.handle);
    }
    return [...all.values()]
      .filter((e) => e.geom.kind === 'ACAD_TABLE')
      .map((e) => {
        const g = e.geom as TableGeometry;
        const inside = [...all.values()].filter((x) => x.owner === g.block);
        return {
          columns: g.columnWidths,
          rows: g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4),
          texts: g.cells.map((r) => r.map((c) => c.text)),
          spans: g.cells.map((r) =>
            r.map((c) => (c.merged ? '^' : `${c.rowSpan}x${c.columnSpan}`)),
          ),
          block: inside.map((x) => x.geom.kind).filter((k) => k === 'LINE').length,
          formats: g.cells.map((r) => r.map((c) => c.format)),
        };
      });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('-TABLE inserts a table the table engine draws', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor below the canvas, where Dynamic Input does not take them.
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(11, 1), 'Command:');
  await shot('1-before.png');

  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '4', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  // The cell editor opens in the title cell; Esc leaves it and keeps the table.
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => tables(page))
    .toEqual([
      expect.objectContaining({
        columns: [2.5, 2.5, 2.5, 2.5],
        rows: [0.4533, 0.36, 0.36, 0.36, 0.36],
        // Six row lines, five column lines and the Defpoints line.
        block: 6 + 5 + 1,
      }),
    ]);
  await page.waitForTimeout(300);
  await shot('2-after.png');
});

test('TABLE opens Insert Table, drags the table and types its cells', async ({ page }) => {
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
  await type(page, p(11, 1), 'Command:');

  await page.keyboard.type('TB');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert Table' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Table style' })).toHaveValue('Standard');
  await expect(dialog.getByRole('radio', { name: 'Start from empty table' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Specify insertion point' })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'Columns:' }).fill('3');
  await dialog.getByRole('textbox', { name: 'Data rows:' }).fill('2');
  // Specify window makes one of each pair Auto.
  await dialog.getByRole('radio', { name: 'Specify window' }).check();
  await expect(dialog.getByRole('textbox', { name: 'Column width:' })).toHaveValue('Auto');
  await expect(dialog.getByRole('textbox', { name: 'Data rows:' })).toHaveValue('Auto');
  await shot('1-insert-table-dialog.png');
  await dialog.getByRole('radio', { name: 'Specify insertion point' }).check();
  await expect(dialog.getByRole('textbox', { name: 'Data rows:' })).toHaveValue('2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify insertion point:');

  // The table follows the cursor until it is placed.
  const at = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.25 };
  await page.mouse.move(at.x - 40, at.y - 30);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('2-dragging-table.png');
  await page.mouse.click(at.x, at.y);
  await expect(prompt(page)).toHaveText('Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  const cells = ['NOZZLE SCHEDULE', 'Mark', 'Size', 'Service', 'N1', '2"', 'Inlet', 'N2'];
  const log = page.getByRole('log', { name: 'Recent command lines' });
  /** Leaves a cell with `key`, then waits for the editor to open in the next. */
  const leave = async (key: string, typed: string, n: number) => {
    await page.keyboard.press(key);
    await expect(log.getByText(`Enter text: ${typed}`, { exact: true })).toHaveCount(n);
    await expect(prompt(page)).toHaveText('Enter text:');
    // The editor of the cell left stays up, its typing ended, until the next cell's opens in
    // its place: every cell moved to here is empty, the one left is not.
    await expect(editor).toHaveText('');
    await expect(editor).toBeFocused();
  };
  for (const [k, text] of cells.entries()) {
    await page.keyboard.type(text);
    if (k === 4) await shot('3-typing-in-cells.png');
    if (k < cells.length - 1) await leave('Tab', text, 1);
  }
  // Right at the end of the text moves on as Tab does.
  await leave('ArrowRight', 'N2', 1);
  await page.keyboard.type('3"');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await tables(page))[0]?.texts)
    .toEqual([
      ['NOZZLE SCHEDULE', '', ''],
      ['Mark', 'Size', 'Service'],
      ['N1', '2"', 'Inlet'],
      ['N2', '3"', ''],
    ]);
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(300);
  await shot('4-schedule-typed.png');
});

test('a click selects table cells and the right-click menu edits them', async ({ page }) => {
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
  await type(page, p(11, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '4', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await tables(page)).length).toBe(1);

  const view = await viewOf(page);
  // The centre of cell (row i, column j): 2.5 wide columns, a 0.4533 title, 0.36 rows.
  const cell = (i: number, j: number) => {
    const y = i === 0 ? -0.2267 : i === 1 ? -0.6333 : -0.9933 - 0.36 * (i - 2);
    const s = view.at(O + 1.25 + 2.5 * j, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const options =
    'Enter a table cell option [Text/BAckground/ALignment/BOrders/Height/Above/Below/DeleteRows/Left/Right/DeleteColumns/MergeAll/MergeRows/MergeColumns/Unmerge]:';
  const menu = page.getByRole('menu', { name: 'Table cell options' });
  const choose = async (item: string) => {
    await page.mouse.click(cell(3, 2).x, cell(3, 2).y, { button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: item }).click();
    await expect(prompt(page)).toHaveText('Command:');
  };

  await page.mouse.click(cell(2, 1).x, cell(2, 1).y);
  await expect(prompt(page)).toHaveText(options);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(3, 2).x, cell(3, 2).y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await shot('5-cells-selected.png');
  await page.mouse.click(cell(3, 2).x, cell(3, 2).y, { button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Unmerge' })).toBeDisabled();
  await shot('6-table-cell-menu.png');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await choose('Merge All');
  await expect
    .poll(async () => (await tables(page))[0]?.spans.slice(2, 4))
    .toEqual([
      ['1x1', '2x2', '^', '1x1'],
      ['1x1', '^', '^', '1x1'],
    ]);

  await page.mouse.click(cell(4, 0).x, cell(4, 0).y);
  await expect(prompt(page)).toHaveText(options);
  await choose('Insert Rows Below');
  await expect
    .poll(async () => (await tables(page))[0]?.rows)
    .toEqual([0.4533, 0.36, 0.36, 0.36, 0.36, 0.36]);

  await page.mouse.click(cell(5, 3).x, cell(5, 3).y);
  await expect(prompt(page)).toHaveText(options);
  await choose('Delete Columns');
  await expect.poll(async () => (await tables(page))[0]?.columns).toEqual([2.5, 2.5, 2.5]);
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(300);
  await shot('7-merged-row-inserted-column-deleted.png');
});

test('cells dragged across are formatted from the menu, and a column grip resizes', async ({
  page,
}) => {
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
  await type(page, p(11, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '4', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  await page.keyboard.type('NOZZLES');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await tables(page)).length).toBe(1);

  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const s = view.at(O + x, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  // The centre of cell (row i, column j): 2.5 wide columns, a 0.4533 title, 0.36 rows.
  const cell = (i: number, j: number) =>
    at(1.25 + 2.5 * j, i === 0 ? -0.2267 : i === 1 ? -0.6333 : -0.9933 - 0.36 * (i - 2));
  const options =
    'Enter a table cell option [Text/BAckground/ALignment/BOrders/Height/Above/Below/DeleteRows/Left/Right/DeleteColumns/MergeAll/MergeRows/MergeColumns/Unmerge]:';

  // A press in cell (2, 1) dragged to cell (4, 2) selects the six cells.
  await page.mouse.move(cell(2, 1).x, cell(2, 1).y);
  await page.mouse.down();
  await page.mouse.move(cell(3, 2).x, cell(3, 2).y, { steps: 5 });
  await page.mouse.move(cell(4, 2).x, cell(4, 2).y, { steps: 5 });
  await page.mouse.up();
  await expect(prompt(page)).toHaveText(options);
  await page.waitForTimeout(300);
  await shot('8-cells-dragged-across.png');

  const menu = page.getByRole('menu', { name: 'Table cell options' });
  await page.mouse.click(cell(3, 2).x, cell(3, 2).y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Background Fill' }).click();
  await expect(prompt(page)).toHaveText('Enter background fill color [None] <None>:');
  await type(page, '51', 'Command:');
  const formats = async () =>
    (await tables(page))[0]?.formats.slice(2, 5).map((r) => r.slice(1, 3));
  await expect
    .poll(async () => (await formats())?.flat().map((f) => f?.background))
    .toEqual(Array.from({ length: 6 }, () => ({ kind: 'aci', index: 51 })));

  // Alignment: its own right-click menu.
  await page.mouse.move(cell(2, 1).x, cell(2, 1).y);
  await page.mouse.down();
  await page.mouse.move(cell(4, 2).x, cell(4, 2).y, { steps: 5 });
  await page.mouse.up();
  await expect(prompt(page)).toHaveText(options);
  await type(page, 'AL', 'Enter cell alignment [TL/TC/TR/ML/MC/MR/BL/BC/BR] <TC>:');
  await page.mouse.click(cell(3, 2).x, cell(3, 2).y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Middle Center' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await formats())?.flat().map((f) => f?.alignment))
    .toEqual([5, 5, 5, 5, 5, 5]);

  // Borders: the outside ones red and 0.50 mm.
  await page.mouse.move(cell(2, 1).x, cell(2, 1).y);
  await page.mouse.down();
  await page.mouse.move(cell(4, 2).x, cell(4, 2).y, { steps: 5 });
  await page.mouse.up();
  await expect(prompt(page)).toHaveText(options);
  await type(
    page,
    'BO',
    'Apply the border properties to [All/Outside/Inside/Top/Bottom/Left/Right] <All>:',
  );
  await type(page, 'O', 'Enter border color <BYBLOCK>:');
  await type(page, 'red', 'Enter border lineweight <ByBlock>:');
  await type(page, '0.5', 'Command:');
  await expect
    .poll(async () => (await formats())?.[0]?.[0]?.borders?.top)
    .toEqual({ color: { kind: 'aci', index: 1 }, lineweight: 50 });
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(300);
  await shot('9-cells-filled-aligned-bordered.png');

  // The table picked on its left edge shows its grips; the grip atop the first column line
  // moves that line, the table keeping its width.
  await page.mouse.click(at(0, -1.5).x, at(0, -1.5).y);
  await expect(prompt(page)).toHaveText('Command:');
  await page.waitForTimeout(300);
  await shot('10-table-grips.png');
  await page.mouse.move(at(2.5, 0).x, at(2.5, 0).y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(prompt(page)).toHaveText(/^\*\* STRETCH \*\*|Specify stretch point/);
  await page.mouse.move(at(3.5, 0.3).x, at(3.5, 0.3).y, { steps: 5 });
  await page.waitForTimeout(300);
  await shot('11-column-grip-dragged.png');
  await page.mouse.click(at(3.5, 0.3).x, at(3.5, 0.3).y);
  // The click lands on the nearest pixel to (3.5, 0.3).
  await expect
    .poll(async () => (await tables(page))[0]?.columns.map((w) => Math.round(w * 100) / 100))
    .toEqual([3.5, 1.5, 2.5, 2.5]);
  await page.keyboard.press('Escape');
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(300);
  await shot('12-column-resized.png');
});
