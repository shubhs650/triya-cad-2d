// M5-05 part 3: the Layer Properties Manager's columns and sorting, and its search on 200 layers.
// The drawing is the generated bench-layers (DEC-045: benchmarks are synthetic): layers 0 and
// BENCH-00 to BENCH-199, coloured red, yellow, green, cyan, blue, magenta and white in turn.
// - A click on a column header sorts the layers by it, a second click reverses it.
// - A right-click on a header shows or hides a column; the columns and the sort are the user's,
//   kept across a reload; Restore All Columns to Defaults brings every column back.
// - Customize Layer Columns orders and hides columns, from the keyboard.
// - Acceptance: the search filters the 200 layers in under 100 ms.
import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BENCH_LAYERS, benchDwg } from '../../../packages/testkit/src/bench/drawing';
import { expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

/** The acceptance: the manager filters a 200-layer drawing in under 100 ms. */
const FILTER_MS = 100;

let app: { url: string; close(): Promise<void> };
let file: string;
test.beforeAll(async () => {
  app = await startApp();
  file = test.info().outputPath('bench-layers.dwg');
  writeFileSync(file, benchDwg(BENCH_LAYERS));
});
test.afterAll(async () => {
  await app.close();
});

async function openLayers(page: Page, goto = true): Promise<Locator> {
  if (goto) await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, 'bench-layers.dwg');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  return palette;
}

const table = (palette: Locator) => palette.getByRole('table', { name: 'Layers of the drawing' });
const header = (palette: Locator, name: string) =>
  table(palette).getByRole('columnheader', { name, exact: true });
const firstNames = async (palette: Locator, n: number) =>
  (await table(palette).getByRole('rowheader').allTextContents()).slice(0, n);

test('sorts by a column’s header and keeps the columns the user chose (M5-05)', async ({
  page,
}) => {
  const palette = await openLayers(page);
  await expect(header(palette, 'Name')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => firstNames(palette, 3)).toEqual(['0', 'BENCH-00', 'BENCH-01']);

  await header(palette, 'Name').getByRole('button').click();
  await expect(header(palette, 'Name')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => firstNames(palette, 2)).toEqual(['BENCH-199', 'BENCH-198']);

  // By colour: ACI 1 (red) first, every seventh layer, by name among themselves.
  await header(palette, 'Color').getByRole('button').click();
  await expect(header(palette, 'Color')).toHaveAttribute('aria-sort', 'ascending');
  await expect(header(palette, 'Name')).not.toHaveAttribute('aria-sort');
  await expect.poll(() => firstNames(palette, 3)).toEqual(['BENCH-00', 'BENCH-07', 'BENCH-14']);

  // Hide Lineweight from the header's menu.
  await header(palette, 'Lineweight').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Layer columns' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Name' })).toHaveCount(0);
  const lineweight = menu.getByRole('menuitemcheckbox', { name: 'Lineweight' });
  await expect(lineweight).toHaveAttribute('aria-checked', 'true');
  await lineweight.click();
  await expect(menu).toBeHidden();
  await expect(header(palette, 'Lineweight')).toHaveCount(0);
  await expect(palette.getByRole('button', { name: 'Lineweight BENCH-00' })).toHaveCount(0);

  // The columns and the sort are the user's: a reload keeps them.
  await page.reload();
  const again = await openLayers(page, false);
  await expect(header(again, 'Lineweight')).toHaveCount(0);
  await expect(header(again, 'Color')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(() => firstNames(again, 1)).toEqual(['BENCH-00']);

  await header(again, 'Color').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Restore All Columns to Defaults' }).click();
  await expect(header(again, 'Lineweight')).toBeVisible();
  // Restoring the columns leaves the sort as it was.
  await expect(header(again, 'Color')).toHaveAttribute('aria-sort', 'ascending');
});

test('Customize Layer Columns orders and hides columns from the keyboard (M5-05)', async ({
  page,
}) => {
  const palette = await openLayers(page);
  const titles = () => table(palette).getByRole('columnheader').allTextContents();
  await expect.poll(titles).toContain('Linetype');

  // Shift+F10 on a header opens its menu; Customize... is the item before the last.
  await header(palette, 'Name').getByRole('button').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Layer columns' });
  await expect(menu.getByRole('menuitemcheckbox').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Customize...' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Customize Layer Columns' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Name' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Name' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Description up two places, before Lineweight; Linetype cleared with Space.
  await dialog.getByRole('checkbox', { name: 'Description' }).focus();
  await dialog.getByRole('button', { name: 'Move Up' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Description' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Move Up' }).click();
  await dialog.getByRole('checkbox', { name: 'Linetype' }).focus();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('checkbox', { name: 'Linetype' })).not.toBeChecked();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await expect
    .poll(titles)
    .toEqual([
      'Status',
      'Name▲',
      'On',
      'Freeze',
      'Lock',
      'Plot',
      'Color',
      'Description',
      'Lineweight',
      'Transparency',
    ]);

  // Esc leaves the columns as they were.
  await header(palette, 'Color').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Customize...' }).click();
  await dialog.getByRole('button', { name: 'Select All' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(header(palette, 'Linetype')).toHaveCount(0);
});

test('filters 200 layers in under 100 ms (M5-05 acceptance)', async ({ page }) => {
  const palette = await openLayers(page);
  const rows = table(palette).getByRole('rowheader');
  await expect(rows).toHaveCount(201);
  const search = palette.getByRole('searchbox', { name: 'Search for layer' });
  const times: number[] = [];
  const filtered = async (type: () => Promise<void>, count: number) => {
    await palette.evaluate((p) => p.removeAttribute('data-last-filter-ms'));
    await type();
    await expect(rows).toHaveCount(count);
    await expect(palette).toHaveAttribute('data-last-filter-ms', /\d/);
    times.push(Number(await palette.getAttribute('data-last-filter-ms')));
  };
  // BENCH-10 to 19 and BENCH-100 to 199 (the first ten are BENCH-00 to 09).
  await filtered(() => search.fill('bench-1'), 110);
  // Typed on: BENCH-19 and BENCH-190 to 199.
  await filtered(() => search.press('9'), 11);
  await filtered(() => search.press('Backspace'), 110);
  await filtered(() => search.fill(''), 201);
  test.info().annotations.push({ type: 'filter ms', description: times.join(', ') });
  console.log(`M5-05 filter on 200 layers: ${times.join(', ')} ms`);
  for (const t of times) expect(t).toBeLessThan(FILTER_MS);
});
