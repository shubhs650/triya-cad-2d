// M4-16 part 6: table cells locked. The Table Cell menu's Locking locks the content, the format or
// both of the cells selected; the menu then greys what the lock protects, and a double click on a
// cell whose content is locked says so instead of opening the editor. The engine's rules and the
// save are unit- and corpus-tested in packages/engine, packages/io and packages/testkit.
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

/** The table made in this test: its rows' heights, its cells' texts and locks. */
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
      texts: g.cells.map((r) => r.map((c) => c.text)),
      locks: g.cells.map((r) => r.map((c) => c.locked ?? '-')),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('Locking locks cells; the menu greys what a lock protects', async ({ page }) => {
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
  await type(page, p(6, 1), 'Command:');

  // A table of two columns and two data rows, typed in.
  await page.keyboard.type('TABLE');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert Table' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Columns:' }).fill('2');
  await dialog.getByRole('textbox', { name: 'Data rows:' }).fill('2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, p(0, 0), 'Enter text:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const texts = ['VALVES', 'Tag', 'Size', 'V1', 'DN50'];
  for (const [k, text] of texts.entries()) {
    await page.keyboard.type(text);
    if (k === texts.length - 1) break;
    await page.keyboard.press('Tab');
    await expect(log.getByText(`Enter text: ${text}`, { exact: true }).first()).toBeVisible();
    await expect(prompt(page)).toHaveText('Enter text:');
  }
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.texts[2]).toEqual(['V1', 'DN50']);

  const view = await viewOf(page);
  const rows = (await made(page))!.rows;
  /** The centre of cell (row i, column j): 2.5 wide columns, rows from the top. */
  const cell = (i: number, j: number) => {
    const top = rows.slice(0, i).reduce((a, b) => a + b, 0);
    const s = view.at(O + 1.25 + 2.5 * j, O - top - rows[i]! / 2);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const menu = page.getByRole('menu', { name: 'Table cell options' });

  // The header row locked in content and format, from the cell menu.
  await page.mouse.click(cell(1, 0).x, cell(1, 0).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await page.keyboard.down('Shift');
  await page.mouse.click(cell(1, 1).x, cell(1, 1).y);
  await page.keyboard.up('Shift');
  await page.mouse.click(cell(1, 1).x, cell(1, 1).y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Locking' }).click();
  await expect(prompt(page)).toHaveText(
    'Enter cell locking [Unlocked/Content/Format/Both] <Unlocked>:',
  );
  await type(page, 'B', 'Command:');
  await expect.poll(async () => (await made(page))?.locks[1]).toEqual(['both', 'both']);

  // Its menu greys editing and formatting; Locking stays.
  await page.mouse.click(cell(1, 0).x, cell(1, 0).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await page.mouse.click(cell(1, 0).x, cell(1, 0).y, { button: 'right' });
  await expect(menu).toBeVisible();
  for (const name of ['Edit Text', 'Insert Block...', 'Background Fill', 'Cell Style']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  }
  await expect(menu.getByRole('menuitem', { name: 'Locking' })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Insert Rows Below' })).toBeEnabled();
  await shot('1-locked-header-menu.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // A double click on a locked cell says so and opens no editor.
  await page.mouse.dblclick(cell(1, 1).x, cell(1, 1).y);
  await expect(log.getByText('The cell’s content is locked.').first()).toBeVisible();
  await expect(prompt(page)).toHaveText('Command:');
  expect((await made(page))!.texts[1]).toEqual(['Tag', 'Size']);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.9);
  await page.waitForTimeout(300);
  await shot('2-double-click-refused.png');
});
