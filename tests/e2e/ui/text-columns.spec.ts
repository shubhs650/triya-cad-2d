// M2-07 part 3: MTEXT columns and the ruler in the in-place editor. The Columns menu sets
// static or dynamic columns and Column Settings their sizes; Alt+Enter breaks the column; the
// ruler's markers and tab stops become the paragraph's `\p` values. M2-26: dynamic columns of
// Manual Height, each column's height dragged at its bottom edge, and columns set right to left
// (a drawing's reversed flow, DXF 74). The engine side (MTEXT's
// Columns option, TEXTEDIT) is unit-tested in packages/engine (test/commands/text.test.ts,
// textedit.test.ts), the ruler's codes in packages/text (test/mtext/ruler.test.ts), and saving
// on every corpus file in packages/testkit (export/export-mtext-columns.corpus.test.ts).
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { activeCanvas, DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The MTEXTs added in this test. */
const mtexts = (page: Page) =>
  page.evaluate(() => {
    const out: MTextGeometry[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'MTEXT') out.push(a.entity.geom as MTextGeometry);
      }
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Opens the test drawing on an empty part of its plan and starts an MTEXT 120 units wide. */
async function startMText(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000020', 'Enter text:');
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Text Formatting' });

test('the Columns menu sets static columns and Alt+Enter breaks the column', async ({ page }) => {
  test.setTimeout(90_000);
  await startMText(page);
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('Beta');
  await toolbar(page).getByRole('button', { name: 'Columns' }).click();
  const menu = page.getByRole('menu', { name: 'Columns' });
  await expect(menu.getByRole('menuitemradio', { name: 'No Columns' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: 'Static Columns: 2' }).click();
  await expect(menu).toHaveCount(0);
  // The paragraph after the column break starts the second column.
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  const second = editor.locator('.mtext-para').nth(1);
  await expect(second).toHaveCSS('break-before', 'column');
  // The editor shows the columns: the second starts within the box, past the first's width.
  const outer = (await editor.boundingBox())!;
  const [a, b] = [
    (await editor.locator('.mtext-para').first().boundingBox())!,
    (await second.boundingBox())!,
  ];
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(b.x + b.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  expect(g!.contents).toBe('Alpha\\NBeta');
  // Two columns split the 120-unit box with AutoCAD's gutter, five text heights.
  expect(g!.columns).toMatchObject({ type: 1, count: 2, width: 53.75, gutter: 12.5 });
  expect(g!.width).toBe(53.75);
});

test('Column Settings sets dynamic columns, counted as the text flows', async ({ page }) => {
  test.setTimeout(90_000);
  await startMText(page);
  for (const word of ['one', 'two', 'three', 'four', 'five']) {
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('six');
  await toolbar(page).getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column Settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Column Settings' });
  await dialog.getByRole('radio', { name: 'Dynamic Columns' }).check();
  await dialog.getByRole('spinbutton', { name: 'Height' }).fill('10');
  await dialog.getByRole('spinbutton', { name: 'Column' }).fill('30');
  await dialog.getByRole('spinbutton', { name: 'Gutter' }).fill('5');
  await expect(dialog.getByRole('spinbutton', { name: 'Number' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  // Six lines 5/3 heights apart in columns 10 high: three columns of two lines.
  expect(g!.columns).toMatchObject({ type: 2, width: 30, gutter: 5, autoHeight: true });
  expect(g!.columns!.count).toBe(3);
  expect(g!.definedHeight).toBe(10);
});

test('the ruler sets the paragraph indent and adds tab stops', async ({ page }) => {
  test.setTimeout(90_000);
  await startMText(page);
  await page.keyboard.type('Item');
  const ruler = page.getByRole('slider', { name: 'Ruler' });
  const box = (await ruler.boundingBox())!;
  // The ruler is as wide as the 120-unit box; the text is 2.5 units high.
  const unit = ((box.width - 2) / 120) * 2.5;
  const at = (heights: number) => box.x + 1 + heights * unit;
  // A click adds a tab stop; the bottom marker at 0 is the paragraph indent.
  await page.mouse.click(at(8), box.y + box.height / 2);
  await expect(ruler).toHaveAttribute('aria-valuetext', 'First line 0, left 0, right 0, tabs 8');
  await page.mouse.move(at(0), box.y + box.height - 3);
  await page.mouse.down();
  await page.mouse.move(at(1), box.y + box.height - 3);
  await page.mouse.move(at(2), box.y + box.height - 3);
  await page.mouse.up();
  // The first line stays where it was: its indent is relative to the paragraph's.
  await expect(ruler).toHaveAttribute('aria-valuetext', 'First line -2, left 2, right 0, tabs 8');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor.locator('.mtext-para').first()).toHaveCSS('padding-left', /^[1-9]/);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  expect(g!.contents).toBe('\\pi-2,l2,t8;Item');
});

/** The editor's column height handles, AutoCAD's grips at each column's bottom (M2-26). */
const heightHandle = (page: Page, n: number) =>
  page.getByRole('slider', { name: `Column ${n} height` });

/** A handle dragged `units` up (negative: down), at `scale` CSS px per unit. */
async function dragUp(page: Page, n: number, units: number, scale: number): Promise<void> {
  const h = (await heightHandle(page, n).boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - (units * scale) / 2);
  await page.mouse.move(x, y - units * scale);
  await page.mouse.up();
}

test("Manual Height: each dynamic column's height is dragged in the editor", async ({ page }) => {
  test.setTimeout(90_000);
  await startMText(page);
  for (const word of ['one', 'two', 'three', 'four', 'five']) {
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('six');
  await toolbar(page).getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('menuitem', { name: 'Column Settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Column Settings' });
  await dialog.getByRole('radio', { name: 'Dynamic Columns' }).check();
  await dialog.getByRole('spinbutton', { name: 'Height' }).fill('10');
  await dialog.getByRole('spinbutton', { name: 'Column' }).fill('30');
  await dialog.getByRole('spinbutton', { name: 'Gutter' }).fill('5');
  await dialog.getByRole('radio', { name: 'Manual Height' }).check();
  // Manual heights are each column's own, dragged in the editor: the one height goes.
  await expect(dialog.getByRole('spinbutton', { name: 'Height' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);

  // Two lines a column (a line is two text heights in the editor): three columns 10 high.
  for (const n of [1, 2, 3])
    await expect(heightHandle(page, n)).toHaveAttribute('aria-valuenow', '10');
  await expect(heightHandle(page, 4)).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  const para = (i: number) => editor.locator('.mtext-para').nth(i);
  // The second column shortened to one line: "four" moves on to the third.
  const box = (await editor.boundingBox())!;
  const scale = (box.width - 2 - 4) / 30;
  await dragUp(page, 2, 4, scale);
  await expect(heightHandle(page, 4)).toHaveCount(1);
  const height2 = Number(await heightHandle(page, 2).getAttribute('aria-valuenow'));
  expect(height2).toBeGreaterThan(5);
  expect(height2).toBeLessThan(7.5);
  const [three, four] = [(await para(2).boundingBox())!, (await para(3).boundingBox())!];
  expect(four.x).toBeGreaterThan(three.x + three.width);
  await page.screenshot({ path: 'test-results/text-columns/manual-heights.png' });

  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  // The renderer's lines are 5/3 heights apart: two, one, two and one line, as in the editor.
  expect(g!.columns).toMatchObject({ type: 2, count: 4, width: 30, gutter: 5, autoHeight: false });
  expect(g!.columns!.heights).toEqual([10, height2, 10, 10]);
  expect(g!.definedHeight).toBe(10);
});

/**
 * An AC1032 drawing holding one MTEXT of dynamic columns 30 wide, 5 apart, 10, 5 and 10 high
 * (manual), set right to left (DXF 74), at (20, 80): the R2018 embedded object as the DXF
 * reference describes it, column heights as its repeated 46s.
 */
function reversedColumns(): string {
  return [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032'],
    ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
    ...['0', 'LINE', '5', '100', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine'],
    ...['10', '0', '20', '0', '30', '0', '11', '160', '21', '0', '31', '0'],
    ...['0', 'MTEXT', '5', '101', '100', 'AcDbEntity', '8', '0', '100', 'AcDbMText'],
    ...['10', '20', '20', '80', '30', '0', '40', '2.5', '41', '30', '46', '10', '71', '1'],
    ...['1', 'one\\Ptwo\\Pthree\\Pfour\\Pfive', '101', 'Embedded Object', '70', '1'],
    ...['10', '1', '20', '0', '30', '0', '11', '20', '21', '80', '31', '0'],
    ...['40', '30', '41', '10', '42', '100', '43', '10', '71', '2', '72', '3', '44', '30'],
    ...['45', '5', '73', '0', '74', '1', '46', '10', '46', '5', '46', '10'],
    ...['0', 'ENDSEC', '0', 'EOF', ''],
  ].join('\r\n');
}

test('columns set right to left open in the editor that way, and stay so', async ({ page }) => {
  test.setTimeout(90_000);
  const file = test.info().outputPath('reversed-columns.dxf');
  writeFileSync(file, reversedColumns());
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, 'reversed-columns.dxf');
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '0,0', 'Specify opposite corner:');
  await type(page, '160,100', 'Command:');
  const canvas = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(canvas.width / 160, canvas.height / 100);
  // The first column is the rightmost: x 90 to 120; "one" on its first line.
  const one = {
    x: canvas.x + canvas.width / 2 + (93 - 80) * k,
    y: canvas.y + canvas.height / 2 - (79 - 50) * k,
  };
  await page.mouse.dblclick(one.x, one.y);
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  const para = async (i: number) => (await editor.locator('.mtext-para').nth(i).boundingBox())!;
  // one, two | three | four, five: from right to left, as the renderer draws them.
  const [p1, p3, p4] = [await para(0), await para(2), await para(3)];
  expect(p3.x + p3.width).toBeLessThan(p1.x);
  expect(p4.x + p4.width).toBeLessThan(p3.x);
  expect(Math.abs(p1.x - (one.x - 3 * k))).toBeLessThan(2 * k);
  await expect(heightHandle(page, 2)).toHaveAttribute('aria-valuenow', '5');
  await page.screenshot({ path: 'test-results/text-columns/reversed-flow.png' });
  // Closed unchanged: the MTEXT stays as the drawing has it.
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText(/^Select an annotation object/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  const updated = await page.evaluate(
    () =>
      (window as unknown as Dev).triyaDev.changes().flatMap((cs) => cs.entities?.updated ?? [])
        .length,
  );
  expect(updated).toBe(0);
});
