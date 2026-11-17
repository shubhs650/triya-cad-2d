// M4-16 part 5: rows and cells on cell styles of their own. Insert Table's Set cell styles puts
// a new table's first rows on the cell styles chosen (its preview showing them), and the Table
// Cell menu's Cell Style puts the cells selected on Title, Header or Data; rows are inserted and
// deleted beside the title and header rows too, each keeping its cell style. The engine's rules
// and the save are unit- and corpus-tested in packages/engine and packages/testkit.
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

/** The table made in this test: its rows' heights and cell styles, its cells' own. */
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
      rows: g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4),
      rowStyles: g.rowStyles ?? null,
      own: g.cells.map((r) => r.map((c) => c.cellStyle ?? '-')),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('Set cell styles, Cell Style and title rows inserted', async ({ page }) => {
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

  // Insert Table: the first row a header row, the second and the rest data rows.
  await page.keyboard.type('TABLE');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert Table' });
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole('combobox', { name: 'First row cell style:' });
  const second = dialog.getByRole('combobox', { name: 'Second row cell style:' });
  const others = dialog.getByRole('combobox', { name: 'All other row cell styles:' });
  await expect(first).toHaveValue('title');
  await expect(second).toHaveValue('header');
  await expect(others).toHaveValue('data');
  const preview = dialog.getByRole('img', { name: 'Preview' });
  await expect(preview.locator('text')).toHaveText([
    'Title',
    'Header',
    'Data',
    'Data',
    'Data',
    'Data',
  ]);
  await dialog.getByRole('textbox', { name: 'Columns:' }).fill('4');
  await dialog.getByRole('textbox', { name: 'Data rows:' }).fill('3');
  await first.selectOption('header');
  await second.selectOption('data');
  await expect(preview.locator('text').first()).toHaveText('Header');
  await shot('1-set-cell-styles.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, p(0, 0), 'Enter text:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page))?.rowStyles)
    .toEqual(['header', 'data', 'data', 'data', 'data']);
  expect((await made(page))!.rows).toEqual([0.36, 0.36, 0.36, 0.36, 0.36]);

  const view = await viewOf(page);
  /** The centre of cell (row i, column j): 2.5 wide columns, rows 0.36 high from the top. */
  const cell = (i: number, j: number, rows = [0.36, 0.36, 0.36, 0.36, 0.36, 0.36]) => {
    const top = rows.slice(0, i).reduce((a, b) => a + b, 0);
    const s = view.at(O + 1.25 + 2.5 * j, O - top - rows[i]! / 2);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const menu = page.getByRole('menu', { name: 'Table cell options' });

  // A title row inserted above the header row: Insert Rows Above, then Cell Style Title on it.
  await page.mouse.click(cell(0, 0).x, cell(0, 0).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await page.mouse.click(cell(0, 0).x, cell(0, 0).y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Insert Rows Above' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Insert Rows Above' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page))?.rowStyles)
    .toEqual(['header', 'header', 'data', 'data', 'data', 'data']);
  await page.mouse.click(cell(0, 0).x, cell(0, 0).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(0, 3).x, cell(0, 3).y);
  await page.keyboard.up('Shift');
  await page.mouse.click(cell(0, 3).x, cell(0, 3).y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Cell Style' }).click();
  await expect(prompt(page)).toHaveText('Enter cell style [Title/Header/Data/ByRow] <ByRow>:');
  await type(page, 'T', 'Command:');
  await expect
    .poll(async () => (await made(page))?.rowStyles)
    .toEqual(['title', 'header', 'data', 'data', 'data', 'data']);
  // One data cell on the Header cell style of its own.
  const rows = (await made(page))!.rows;
  const c = cell(3, 1, rows);
  await page.mouse.click(c.x, c.y);
  await type(page, 'CS', 'Enter cell style [Title/Header/Data/ByRow] <ByRow>:');
  await type(page, 'H', 'Command:');
  await expect.poll(async () => (await made(page))?.own[3]).toEqual(['-', 'header', '-', '-']);
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(300);
  await shot('2-title-row-inserted-and-cell-styled.png');
});
