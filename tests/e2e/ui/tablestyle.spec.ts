// M4-05 part 5: TABLESTYLE's Table Style dialog in the app, on the acadsharp AC1032 sample (one
// table style, Standard, imperial, kept current by CTABLESTYLE). A schedule is made with -TABLE
// and typed in its cells; TS opens the dialog on Standard with its preview. New... makes
// "Schedule" from Standard (Create New Table Style, then New Table Style: the Data cell style
// filled yellow, its text 0.25 high, red borders all round), Set Current makes it current, and
// Modify... gives Standard a cyan title row: the schedule, drawn in Standard, is drawn again in
// it at once. The shortcut menu's Delete refuses Standard. Insert Table's launcher opens the
// dialog and comes back to Insert Table on the style made current there (pedit.spec.ts checks Property
// Settings offers Table). What each action writes is unit-tested in packages/engine/test/commands/tablestyle.test.ts
// and saved on every corpus file in packages/testkit/src/tables/table-style-manager.corpus.test.ts.
//
// M4-16 part 4: New Table Style's Select table to start from hides the dialogs, asks "Select a
// table:" and opens New Table Style again on the formatting of the table picked (a cyan title).
//
// M4-16 part 8: Modify Table Style's Borders tab gives the Data cell style's outside borders the
// linetype ACAD_ISO02W100 as double lines 0.05 apart; the table drawn in Standard is drawn again
// with them, and the dialog opens again on them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, TableGeometry } from '@triya/engine';
import path from 'node:path';
import { activeCanvas, enterCommand, expectShown, openWithPicker, viewOf } from '../app/page';
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
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.addStyleTag({ content: '.nav-bar { display: none !important; }' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The made table: its row heights and how many SOLIDs (cell fills) its block holds. */
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
    const inside = [...all.values()].filter((x) => x.owner === g.block);
    return {
      rows: g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4),
      solids: inside.filter((x) => x.geom.kind === 'SOLID').length,
    };
  });

test('the Table Style dialog makes, modifies and sets table styles', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(9, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '3', 'Enter number of rows or [Auto] <1>:');
  await type(page, '2', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  const cells = ['PARTS', 'Mark', 'Qty', 'Part', 'P1', '4', 'Bolt', 'P2', '8', 'Nut'];
  for (const [k, text] of cells.entries()) {
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('');
    await page.keyboard.type(text);
    if (k < cells.length - 1) {
      await page.keyboard.press('Tab');
      await expect(prompt(page)).toHaveText('Enter text:');
    }
  }
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.solids).toBe(0);
  const before = (await made(page))!;
  await shot(page, '1-before');

  await enterCommand(page, 'TS');
  const dialog = page.getByRole('dialog', { name: 'Table Style' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('tablestyle-current')).toHaveText('Standard');
  const list = dialog.getByRole('listbox', { name: 'Styles:' });
  await expect(list.getByRole('option')).toHaveText([/Standard/]);
  await expect(dialog.getByRole('img', { name: 'Preview of Standard' })).toBeVisible();
  await shot(page, '2-table-style-dialog');

  // New...: Create New Table Style, then New Table Style.
  await dialog.getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Table Style' });
  await expect(create.getByLabel('Start With:')).toHaveValue('Standard');
  await create.getByLabel('New Style Name:').fill('Schedule');
  await create.getByRole('button', { name: 'Continue' }).click();
  const editorDialog = page.getByRole('dialog', { name: 'New Table Style: Schedule' });
  await expect(editorDialog).toBeVisible();
  await expect(editorDialog.getByLabel('Cell styles')).toHaveValue('data');
  await editorDialog.getByLabel('Fill color:').selectOption({ label: 'Yellow' });
  await editorDialog.getByRole('tab', { name: 'Text' }).click();
  await editorDialog.getByLabel('Text height:').fill('0.25');
  await editorDialog.getByRole('tab', { name: 'Borders' }).click();
  await editorDialog.getByLabel('Color:').selectOption({ label: 'Red' });
  await editorDialog.getByRole('button', { name: 'All Borders' }).click();
  await shot(page, '3-new-table-style');
  await editorDialog.getByRole('button', { name: 'OK' }).click();
  await expect(editorDialog).toBeHidden();
  await expect(list.getByRole('option')).toHaveText(['Schedule', /Standard/]);
  await expect(list.getByRole('option', { name: 'Schedule' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog.getByRole('button', { name: 'Set Current' }).click();
  await expect(dialog.getByTestId('tablestyle-current')).toHaveText('Schedule');

  // Modify... Standard: a cyan title row; the schedule drawn in it changes at once.
  await list.getByRole('option', { name: /Standard/ }).click();
  await dialog.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify Table Style: Standard' });
  await modify.getByLabel('Cell styles').selectOption('title');
  await modify.getByLabel('Fill color:').selectOption({ label: 'Cyan' });
  await modify.getByRole('button', { name: 'OK' }).click();
  await expect(modify).toBeHidden();
  await expect.poll(async () => (await made(page))?.solids).toBe(1);
  expect((await made(page))!.rows).toEqual(before.rows);

  // The shortcut menu's Delete refuses Standard.
  await list.getByRole('option', { name: /Standard/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Standard cannot be deleted.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '4-after-modify');

  // Insert Table's launcher opens the dialog and comes back on the style made current there.
  await enterCommand(page, 'TABLE');
  const insert = page.getByRole('dialog', { name: 'Insert Table' });
  await expect(insert.getByLabel('Table style', { exact: true })).toHaveValue('Schedule');
  await insert.getByRole('button', { name: 'Launch the Table Style dialog' }).click();
  await expect(dialog).toBeVisible();
  await list.getByRole('option', { name: /Standard/ }).click();
  await dialog.getByRole('button', { name: 'Set Current' }).click();
  await expect(dialog.getByTestId('tablestyle-current')).toHaveText('Standard');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(insert).toBeVisible();
  await expect(insert.getByLabel('Table style', { exact: true })).toHaveValue('Standard');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});

test('Select table to start from gives a new style the table’s formatting', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(9, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '3', 'Enter number of rows or [Auto] <1>:');
  await type(page, '2', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  await page.keyboard.type('FITTINGS');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await made(page))?.solids).toBe(0);

  // The title cell filled cyan through the cell menu's Background Fill.
  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const s = view.at(O + x, O + y);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  await page.mouse.click(at(3.75, -0.2267).x, at(3.75, -0.2267).y);
  await expect(prompt(page)).toHaveText(/^Enter a table cell option/);
  await type(page, 'BA', 'Enter background fill color [None] <None>:');
  await type(page, '4', 'Command:');
  await expect.poll(async () => (await made(page))?.solids).toBe(1);
  await page.mouse.move(box.x + 20, box.y + box.height + 60);

  await enterCommand(page, 'TS');
  const dialog = page.getByRole('dialog', { name: 'Table Style' });
  await dialog.getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Table Style' });
  await create.getByLabel('New Style Name:').fill('Fittings');
  await create.getByRole('button', { name: 'Continue' }).click();
  let editor = page.getByRole('dialog', { name: 'New Table Style: Fittings' });
  await expect(editor.getByRole('button', { name: 'Remove Table' })).toBeDisabled();
  await editor.getByLabel('Cell styles').selectOption('title');
  await expect(editor.getByLabel('Fill color:')).toHaveValue('none');
  await shot(page, '5-new-table-style-before-start');
  await editor.getByRole('button', { name: 'Select table to start from' }).click();
  await expect(prompt(page)).toHaveText('Select a table:');
  await expect(dialog).toBeHidden();
  // The table's left edge picks it.
  await page.mouse.click(at(0, -0.8).x, at(0, -0.8).y);
  editor = page.getByRole('dialog', { name: 'New Table Style: Fittings' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Cell styles').selectOption('title');
  await expect(editor.getByLabel('Fill color:')).toHaveValue('aci:4');
  await shot(page, '6-new-table-style-from-table');
  await editor.getByRole('button', { name: 'OK' }).click();
  await expect(editor).toBeHidden();
  const list = dialog.getByRole('listbox', { name: 'Styles:' });
  await expect(list.getByRole('option')).toHaveText(['Fittings', /Standard/]);
  await shot(page, '7-style-made-from-table');

  // Esc at "Select a table:" comes back on the settings as they were.
  await dialog.getByRole('button', { name: 'Modify...' }).click();
  editor = page.getByRole('dialog', { name: 'Modify Table Style: Fittings' });
  await editor.getByLabel('Cell styles').selectOption('title');
  await editor.getByLabel('Fill color:').selectOption({ label: 'Red' });
  await editor.getByRole('button', { name: 'Select table to start from' }).click();
  await expect(prompt(page)).toHaveText('Select a table:');
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Cell styles').selectOption('title');
  await expect(editor.getByLabel('Fill color:')).toHaveValue('aci:1');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(prompt(page)).toHaveText('Command:');
});

test('the Borders tab draws a style’s borders in a linetype and double', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(9, 1), 'Command:');
  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '3', 'Enter number of rows or [Auto] <1>:');
  await type(page, '2', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('PARTS');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  // A linetype scale that shows ACAD_ISO02W100's dashes across the cells.
  await page.keyboard.type('LTSCALE');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(/^Enter new value for LTSCALE/);
  await type(page, '0.02', 'Command:');
  await shot(page, 'part8-1-before');

  /** The made table's block lines in a linetype of their own, and the handle of the linetype. */
  const dashed = () =>
    page.evaluate(() => {
      const all = new Map<string, Entity>();
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const a of cs.entities?.added ?? []) all.set(a.entity.handle, a.entity);
        for (const u of cs.entities?.updated ?? []) all.set(u.after.handle, u.after);
        for (const r of cs.entities?.removed ?? []) all.delete(r.entity.handle);
      }
      const t = [...all.values()].find((e) => e.geom.kind === 'ACAD_TABLE');
      const block = (t?.geom as TableGeometry | undefined)?.block;
      const lines = [...all.values()].filter(
        // Not the Defpoints line (ByLayer).
        (x) =>
          x.owner === block &&
          x.geom.kind === 'LINE' &&
          x.linetype !== 'ByBlock' &&
          x.linetype !== 'ByLayer',
      );
      return { count: lines.length, linetypes: [...new Set(lines.map((x) => x.linetype))] };
    });
  expect((await dashed()).count).toBe(0);

  await enterCommand(page, 'TS');
  const dialog = page.getByRole('dialog', { name: 'Table Style' });
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole('listbox', { name: 'Styles:' });
  await list.getByRole('option', { name: /Standard/ }).click();
  await dialog.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify Table Style: Standard' });
  await expect(modify.getByLabel('Cell styles')).toHaveValue('data');
  await modify.getByRole('tab', { name: 'Borders' }).click();
  const spacing = modify.getByLabel('Spacing:');
  await expect(spacing).toBeDisabled();
  await expect(spacing).toHaveValue('0.045');
  await modify.getByLabel('Linetype:').selectOption({ label: 'ACAD_ISO02W100' });
  await modify.getByLabel('Double line').check();
  await spacing.fill('0.05');
  await modify.getByLabel('Color:').selectOption({ label: 'Blue' });
  await modify.getByRole('button', { name: 'Outside Borders' }).click();
  await shot(page, 'part8-2-borders-tab');
  await modify.getByRole('button', { name: 'OK' }).click();
  await expect(modify).toBeHidden();
  // The two data rows' outline, each line with a second one inside it: 4 sides by 2 lines, the
  // sides across the rows a line per row.
  await expect.poll(async () => (await dashed()).count).toBeGreaterThanOrEqual(8);
  const { count, linetypes } = await dashed();
  expect(count % 2).toBe(0);
  expect(linetypes).toHaveLength(1);

  // Modify again shows them on the Borders tab.
  await dialog.getByRole('button', { name: 'Modify...' }).click();
  await modify.getByRole('tab', { name: 'Borders' }).click();
  await expect(modify.getByLabel('Linetype:')).toHaveValue(linetypes[0]!);
  await expect(modify.getByLabel('Double line')).toBeChecked();
  await expect(spacing).toHaveValue('0.05');
  await modify.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.9);
  await shot(page, 'part8-3-after');
});
