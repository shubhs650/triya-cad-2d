// M4-16 part 10: table breaks. A table's breaking grip, the triangle in the middle of its bottom
// edge, dragged up breaks the table into parts at that height (Table breaks enabled); the
// Properties palette's Table Breaks rows then repeat the title and header rows on each part and
// set the parts' spacing. The engine's rules and the save are unit- and corpus-tested in
// packages/engine, packages/io and packages/testkit.
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

/** The table made in this test: its rows' heights, column widths and break settings. */
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
    return { rows: g.rowHeights, widths: g.columnWidths, breaks: g.breaks };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('the breaking grip breaks a table; Table Breaks rows repeat its labels', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  // Room for the parts to the right of the table, beside the Properties palette.
  await type(page, p(-14, -12), 'Specify opposite corner:');
  await type(page, p(31, 4), 'Command:');

  // A table of two columns and six data rows, its title typed in.
  await page.keyboard.type('TABLE');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert Table' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Columns:' }).fill('2');
  await dialog.getByRole('textbox', { name: 'Data rows:' }).fill('6');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, p(0, 0), 'Enter text:');
  await page.keyboard.type('VALVES');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.rows.length).toBe(8);

  const view = await viewOf(page);
  const { rows, widths } = (await made(page))!;
  const at = (x: number, y: number) => {
    const s = view.at(O + x, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const width = widths.reduce((a, b) => a + b, 0);
  const total = rows.reduce((a, b) => a + b, 0);
  const upTo = (n: number) => rows.slice(0, n).reduce((a, b) => a + b, 0);

  // Picked on its left edge: its grips show, the breaking grip in the middle of its bottom.
  const edge = at(0, -upTo(3) - rows[3]! / 2);
  await page.mouse.click(edge.x, edge.y);
  await off();
  await page.waitForTimeout(300);
  await shot('1-table-grips.png');

  // The breaking grip dragged up to below the fourth row: the table breaks into parts.
  const grip = at(width / 2, -total);
  await page.mouse.click(grip.x, grip.y);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await type(page, `#${p(width / 2, -upTo(4) - 0.01)}`, 'Command:');
  await expect.poll(async () => (await made(page))?.breaks?.enabled).toBe(true);
  await off();
  await page.waitForTimeout(300);
  await shot('2-broken-by-grip.png');

  // Repeat top labels and a spacing of 1 in the Properties palette.
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('table', { name: 'Table Breaks' })).toBeVisible();
  await expect(palette.getByRole('combobox', { name: 'Enabled' })).toHaveValue('yes');
  await palette.getByRole('combobox', { name: 'Repeat top labels' }).selectOption({ label: 'Yes' });
  await expect.poll(async () => (await made(page))?.breaks?.repeatTop).toBe(true);
  const spacing = palette.getByRole('textbox', { name: 'Spacing' });
  await spacing.fill('1');
  await spacing.press('Enter');
  await expect.poll(async () => (await made(page))?.breaks?.spacing).toBe(1);
  expect((await made(page))!.breaks).toMatchObject({
    enabled: true,
    direction: 'right',
    repeatTop: true,
  });
  await off();
  await page.waitForTimeout(300);
  await shot('3-labels-repeated.png');
});
