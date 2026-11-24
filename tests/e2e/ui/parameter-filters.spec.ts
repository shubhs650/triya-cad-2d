// M9-03 part 12: the Parameters Manager's filter tree and column sorting. A line gets DCALIGNED's
// `width=60`; the palette's New makes two user parameters, `gap` = 5 and `half` = width/2. The
// Value and Name headers sort the rows within each group, up and then down; » expands the filter
// tree, whose All Used in Expressions shows width and half, and Invert filter gap alone. New Group
// Filter makes Group Filter1, named Spans in place; width is dragged onto it and gap added from its
// row's shortcut menu, width removed again; F2 renames the group and U puts the name back. The
// save holds the group (DEC-086) and the drawing opened again shows it. The edits are unit-tested
// in packages/engine/test/commands/parameters.test.ts, the records in
// packages/io/test/export-parameter-groups.test.ts and the filters and sorting in
// apps/web/test/parameters.test.ts; this checks the palette, the drag and the worker.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The names of the rows `group` shows, in order. */
const namesIn = (group: Locator) =>
  group
    .locator('tr[data-name]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-name')));

test('the filter tree narrows the parameters to a group filter, and the headers sort them', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan and a line 60 long, held by width=60.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000020,1000040', 'Specify next point or [Undo]:');
  await type(page, '1000080,1000040', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });
  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 40);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, 'width=60', 'Command:');

  await type(page, 'PARAMETERS', 'Command:');
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(palette).toBeVisible();
  const table = palette.getByRole('table', { name: 'Parameters' });
  const dims = table.getByRole('rowgroup', { name: 'Dimensional Constraint Parameters' });
  const users = table.getByRole('rowgroup', { name: 'User Parameters' });

  // Two user parameters: gap = 5, half = width/2 (30).
  for (const [name, expression] of [
    ['gap', '5'],
    ['half', 'width/2'],
  ] as const) {
    await palette.getByRole('button', { name: 'New User Parameter' }).click();
    await expect(palette.getByRole('textbox', { name: 'Name of user1' })).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    const cell = palette.getByRole('textbox', { name: `Expression of ${name}` });
    await cell.fill(expression);
    await cell.press('Enter');
  }
  await expect(users.locator('tr[data-name="half"]')).toContainText('30.0000');
  await expect.poll(() => namesIn(users)).toEqual(['gap', 'half']);

  // Value, down: half (30) before gap (5), within User Parameters; width stays in its group.
  const value = table.getByRole('columnheader', { name: 'Value' });
  await value.getByRole('button').click();
  await expect(value).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => namesIn(users)).toEqual(['gap', 'half']);
  await value.getByRole('button').click();
  await expect(value).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => namesIn(users)).toEqual(['half', 'gap']);
  await expect.poll(() => namesIn(dims)).toEqual(['width']);
  await shot('1-sorted-by-value-down.png');
  const name = table.getByRole('columnheader', { name: 'Name' });
  await name.getByRole('button').click();
  await expect(name).toHaveAttribute('aria-sort', 'ascending');
  await expect(value).not.toHaveAttribute('aria-sort', /./);
  await expect.poll(() => namesIn(users)).toEqual(['gap', 'half']);

  // » expands the tree: All Used in Expressions shows width and half; inverted, gap.
  await palette.getByRole('button', { name: 'Expand filter tree' }).click();
  const tree = palette.getByRole('tree', { name: 'Parameter filters' });
  await expect(tree.getByRole('treeitem')).toHaveText(['▾All', 'All Used in Expressions']);
  await tree.getByRole('treeitem', { name: 'All Used in Expressions' }).click();
  await expect.poll(() => namesIn(table)).toEqual(['width', 'half']);
  const invert = palette.getByRole('checkbox', { name: 'Invert filter' });
  await invert.check();
  await expect.poll(() => namesIn(table)).toEqual(['gap']);
  await shot('2-used-in-expressions-inverted.png');
  await invert.uncheck();

  // New Group Filter: Group Filter1, named in place, chosen and empty.
  await palette.getByRole('button', { name: 'New Group Filter' }).click();
  const rename = tree.getByRole('textbox', { name: 'Name of filter Group Filter1' });
  await expect(rename).toBeFocused();
  await page.keyboard.type('Spans');
  await page.keyboard.press('Enter');
  const spans = tree.getByRole('treeitem', { name: 'Spans' });
  await expect(spans).toHaveAttribute('aria-selected', 'true');
  await expect(palette).toContainText('No parameter is in this filter.');

  // width dragged onto it from All; gap added from its row's shortcut menu.
  await tree.getByRole('treeitem', { name: 'All', exact: true }).click();
  await table.locator('tr[data-name="width"] td').nth(2).dragTo(spans);
  await table.locator('tr[data-name="gap"] td').nth(2).click({ button: 'right' });
  const rowMenu = page.getByRole('menu', { name: 'Parameter gap' });
  await rowMenu.getByRole('menuitem', { name: 'Add to Spans' }).click();
  await expect(rowMenu).toBeHidden();
  await spans.click();
  await expect.poll(() => namesIn(table)).toEqual(['width', 'gap']);
  await shot('3-group-filter.png');

  // Removed from the group in it; the parameter stays in the drawing.
  await table.locator('tr[data-name="width"] td').nth(2).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Parameter width' })
    .getByRole('menuitem', { name: 'Remove from Spans' })
    .click();
  await expect.poll(() => namesIn(table)).toEqual(['gap']);

  // F2 renames it; U puts the name back.
  await spans.focus();
  await page.keyboard.press('F2');
  await expect(tree.getByRole('textbox', { name: 'Name of filter Spans' })).toBeFocused();
  await page.keyboard.type('Gaps');
  await page.keyboard.press('Enter');
  await expect(tree.getByRole('treeitem', { name: 'Gaps' })).toBeVisible();
  await page.locator('#command-input').click();
  await type(page, 'U', 'Command:');
  await expect(spans).toBeVisible();

  // Saved (downloaded, as without File System Access): the group's record names gap's.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await activeCanvas(page).focus();
  const saving = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = test.info().outputPath('grouped.dxf');
  await (await saving).saveAs(file);
  const text = readFileSync(file, 'utf8');
  expect(text).toMatch(/\r?\n {2}1\r?\ngroup\r?\n300\r?\nSpans\r?\n331\r?\n/);

  // Opened again: the tree has Spans, holding gap.
  await openWithPicker(page, file);
  await expectShown(page, 'grouped.dxf');
  await expect(palette.getByRole('table', { name: 'Parameters' })).toBeVisible();
  await tree.getByRole('treeitem', { name: 'Spans' }).click();
  await expect.poll(() => namesIn(table)).toEqual(['gap']);
  await shot('4-reopened.png');
});
