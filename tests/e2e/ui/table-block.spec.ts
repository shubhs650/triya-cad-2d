// M4-16 part 1: a block in a table cell. The Table Cell menu's Insert Block... and TINSERT open
// the Insert a Block in a Table Cell dialog (Name, Scale with AutoFit, Rotation angle, Overall
// cell alignment); OK puts the block in the cell, drawn in the table's `*T` block. On an empty
// part of the acadsharp AC1032 sample, whose `my_block` is offered. The command, the drawing and
// the save are unit- and corpus-tested in packages/engine and packages/testkit.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, InsertGeometry, TableGeometry } from '@triya/engine';
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

/** The table made in this test: each cell's block or text, its row heights, its block's inserts. */
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
      cells: g.cells.map((r) =>
        r.map((c) => (c.type === 'block' ? { fit: c.autoFit, scale: c.blockScale } : c.text)),
      ),
      rows: g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4),
      inserts: [...all.values()]
        .filter((x) => x.owner === g.block && x.geom.kind === 'INSERT')
        .map((x) => Math.round((x.geom as InsertGeometry).scale.x * 1e4) / 1e4),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('Insert Block... and TINSERT put a block in a table cell', async ({ page }) => {
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
  await type(page, p(-1, -4), 'Specify opposite corner:');
  await type(page, p(11, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '3', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  for (const [k, text] of ['VALVES', 'Mark', 'Symbol', 'Size'].entries()) {
    if (k > 0) await page.keyboard.press('Tab');
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.cells[1]).toEqual(['Mark', 'Symbol', 'Size']);

  const view = await viewOf(page);
  // The centre of cell (row i, column j): 2.5 wide columns, a 0.4533 title, 0.36 rows.
  const cell = (i: number, j: number) => {
    const y = i === 0 ? -0.2267 : i === 1 ? -0.6333 : -0.9933 - 0.36 * (i - 2);
    const s = view.at(O + 1.25 + 2.5 * j, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await page.waitForTimeout(300);
  await shot('1-before.png');

  // The cell menu's Insert Block... on cell (2, 1): AutoFit, as the dialog opens.
  await page.mouse.click(cell(2, 1).x, cell(2, 1).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await page.mouse.click(cell(2, 1).x, cell(2, 1).y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Table cell options' });
  await menu.getByRole('menuitem', { name: 'Insert Block...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert a Block in a Table Cell' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name:').selectOption({ label: 'my_block' });
  await expect(dialog.getByLabel('AutoFit')).toBeChecked();
  await expect(dialog.getByLabel('Scale:')).toBeDisabled();
  await dialog.getByLabel('Overall cell alignment:').selectOption({ label: 'Middle Center' });
  await shot('2-insert-block-dialog.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page))?.cells[2]?.[1])
    .toEqual({ fit: true, scale: expect.any(Number) });
  await expect.poll(async () => (await made(page))?.inserts.length).toBe(1);

  // TINSERT on cell (3, 1) at a scale of its own: the row grows to hold the block.
  const rows = (await made(page))!.rows;
  await type(page, 'TINSERT', 'Pick a table cell:');
  await page.mouse.click(cell(3, 1).x, cell(3, 1).y);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name:').selectOption({ label: 'my_block' });
  await dialog.getByLabel('AutoFit').uncheck();
  await dialog.getByLabel('Scale:').fill('0');
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  await dialog.getByLabel('Scale:').fill('0.02');
  await shot('3-tinsert-scale.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page))?.cells[3]?.[1])
    .toEqual({ fit: false, scale: 0.02 });
  await expect.poll(async () => (await made(page))?.inserts.length).toBe(2);
  const after = (await made(page))!.rows;
  expect(after[3]).toBeGreaterThan(rows[3]!);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await page.waitForTimeout(300);
  await shot('4-blocks-in-cells.png');
});
