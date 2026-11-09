// M2-07 part 3: MTEXT columns and the ruler in the in-place editor. The Columns menu sets
// static or dynamic columns and Column Settings their sizes; Alt+Enter breaks the column; the
// ruler's markers and tab stops become the paragraph's `\p` values. The engine side (MTEXT's
// Columns option, TEXTEDIT) is unit-tested in packages/engine (test/commands/text.test.ts,
// textedit.test.ts), the ruler's codes in packages/text (test/mtext/ruler.test.ts), and saving
// on every corpus file in packages/testkit (export/export-mtext-columns.corpus.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { DXF, expectShown, openWithPicker } from '../app/page';
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
  await expect(editor.locator('.mtext-para').nth(1)).toHaveCSS('break-before', 'column');
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
  await expect(ruler).toHaveAttribute('aria-valuetext', 'First line 0, left 0, tabs 8');
  await page.mouse.move(at(0), box.y + box.height - 3);
  await page.mouse.down();
  await page.mouse.move(at(1), box.y + box.height - 3);
  await page.mouse.move(at(2), box.y + box.height - 3);
  await page.mouse.up();
  // The first line stays where it was: its indent is relative to the paragraph's.
  await expect(ruler).toHaveAttribute('aria-valuetext', 'First line -2, left 2, tabs 8');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor.locator('.mtext-para').first()).toHaveCSS('padding-left', /^[1-9]/);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  expect(g!.contents).toBe('\\pi-2,l2,t8;Item');
});
