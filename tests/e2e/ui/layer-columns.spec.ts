// M5-05 part 3: the Layer Properties Manager's columns and sorting, and its search on 200 layers.
// The drawing is the generated bench-layers (DEC-045: benchmarks are synthetic): layers 0 and
// BENCH-00 to BENCH-199, coloured red, yellow, green, cyan, blue, magenta and white in turn.
// - A click on a column header sorts the layers by it, a second click reverses it.
// - A right-click on a header shows or hides a column; the columns and the sort are the user's,
//   kept across a reload; Restore All Columns to Defaults brings every column back.
// - Customize Layer Columns orders and hides columns, from the keyboard.
// - Acceptance: the search filters the 200 layers in under 100 ms.
// M5-05 part 5: the header menu's Maximize/Optimize items and Freeze Column, a header dragged to
// move its column, its edge dragged to size it.
import { readFileSync, writeFileSync } from 'node:fs';
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

  // Shift+F10 on a header opens its menu; Customize... is the seventh item from the last (the
  // four Maximize/Optimize items, Freeze Column and Restore All Columns to Defaults follow it).
  await header(palette, 'Name').getByRole('button').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Layer columns' });
  await expect(menu.getByRole('menuitemcheckbox').first()).toBeFocused();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Customize...' })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Customize Layer Columns' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Name' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Name' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Description up three places (past Plot Style, M6-07), before Lineweight; Linetype cleared
  // with Space.
  await dialog.getByRole('checkbox', { name: 'Description' }).focus();
  for (let i = 0; i < 2; i++) {
    await dialog.getByRole('button', { name: 'Move Up' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Description' })).toBeFocused();
  }
  await dialog.getByRole('button', { name: 'Move Up' }).click();
  // Move Up gives the moved column the focus back once the list re-renders: wait for that
  // before focusing Linetype, or the late refocus takes the Space (seen in CI on #506).
  await expect(dialog.getByRole('checkbox', { name: 'Description' })).toBeFocused();
  await dialog.getByRole('checkbox', { name: 'Linetype', exact: true }).focus();
  await expect(dialog.getByRole('checkbox', { name: 'Linetype', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('checkbox', { name: 'Linetype', exact: true })).not.toBeChecked();
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
      'Plot Style',
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
    // The palette's own measurement is awaited without querying the page meanwhile: a locator's
    // role query runs on the page's thread, and polling one right after typing put the test's
    // own work between the typing and the frame measured (M5-05 part 5: 104–122 ms on CI with
    // the app's own filter at 30–60 ms).
    await palette.evaluate((p) => {
      p.removeAttribute('data-last-filter-ms');
      (window as { filtered?: Promise<string> }).filtered = new Promise((resolve) => {
        const seen = new MutationObserver(() => {
          const ms = p.getAttribute('data-last-filter-ms');
          if (!ms) return;
          seen.disconnect();
          resolve(ms);
        });
        seen.observe(p, { attributes: true, attributeFilter: ['data-last-filter-ms'] });
      });
    });
    await type();
    times.push(
      Number(await page.evaluate(() => (window as { filtered?: Promise<string> }).filtered)),
    );
    await expect(rows).toHaveCount(count);
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

// M5-13: clearing the search showed the 91 rows it hid by building and laying out every one of
// their cells again (2,800 layout objects, 103–106 ms on loaded CI runners). A row the search
// hides now keeps its layout, so showing it again lays out the rows, not their cells. Layout
// objects are counted, not milliseconds, so the test does not depend on the runner's load; the
// times are logged for the roadmap's acceptance (restore under 60 ms in CI).
test('shows the rows a search hid without laying out their cells again (M5-13)', async ({
  page,
  browser,
}) => {
  const palette = await openLayers(page);
  const rows = table(palette).getByRole('rowheader');
  await expect(rows).toHaveCount(201);
  const before = await table(palette).ariaSnapshot();
  const search = palette.getByRole('searchbox', { name: 'Search for layer' });
  const laidOut: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    await search.fill('bench-1');
    await expect(rows).toHaveCount(110);
    await palette.evaluate((p) => {
      p.removeAttribute('data-last-filter-ms');
      (window as { filtered?: Promise<string> }).filtered = new Promise((resolve) => {
        const seen = new MutationObserver(() => {
          const ms = p.getAttribute('data-last-filter-ms');
          if (!ms) return;
          seen.disconnect();
          resolve(ms);
        });
        seen.observe(p, { attributes: true, attributeFilter: ['data-last-filter-ms'] });
      });
    });
    const trace = test.info().outputPath(`restore-${i}.json`);
    await browser.startTracing(page, { path: trace, categories: ['devtools.timeline'] });
    await search.fill('');
    times.push(
      Number(await page.evaluate(() => (window as { filtered?: Promise<string> }).filtered)),
    );
    await browser.stopTracing();
    // Every layout pass from the typing to the frame drawn (the forced one and the frame's own).
    const events = (
      JSON.parse(readFileSync(trace, 'utf8')) as {
        traceEvents: { name: string; args?: { beginData?: { dirtyObjects?: number } } }[];
      }
    ).traceEvents;
    laidOut.push(
      events
        .filter((e) => e.name === 'Layout')
        .reduce((sum, e) => sum + (e.args?.beginData?.dirtyObjects ?? 0), 0),
    );
    await expect(rows).toHaveCount(201);
  }
  test.info().annotations.push({ type: 'restore ms', description: times.join(', ') });
  console.log(
    `M5-13 restore on 200 layers: ${times.join(', ')} ms; laid out ${laidOut.join(', ')}`,
  );
  // The 80 rows shown again and the list around them: fewer than one object per layer.
  for (const n of laidOut) expect(n).toBeLessThan(201);
  // What a screen reader is given is the list as it was before the search.
  expect(await table(palette).ariaSnapshot()).toBe(before);
});

/** A header's left edge and width on the page. */
const box = async (palette: Locator, name: string) => {
  const b = await header(palette, name).boundingBox();
  if (!b) throw new Error(`no ${name} header`);
  return b;
};

test('sizes, freezes and moves columns from their headers (M5-05 part 5)', async ({ page }) => {
  const palette = await openLayers(page);
  const wrap = palette.locator('.layer-table-wrap');
  const menuItem = async (column: string, item: string) => {
    await header(palette, column).click({ button: 'right' });
    await page
      .getByRole('menu', { name: 'Layer columns' })
      .getByRole('menuitem', { name: item })
      .click();
  };
  // Every name shows whole in the column (nothing cut with an ellipsis).
  const namesWhole = () =>
    table(palette)
      .getByRole('rowheader')
      .evaluateAll((cells) => cells.every((c) => c.scrollWidth <= c.clientWidth));

  // Optimize Column fits Name to BENCH-199, narrower than its default.
  const before = await box(palette, 'Name');
  await menuItem('Name', 'Optimize Column');
  await expect.poll(async () => (await box(palette, 'Name')).width).toBeLessThan(before.width - 40);
  expect(await namesWhole()).toBe(true);

  // A drag on Color's right edge widens it by 40 px; a reload keeps the width.
  const color = await box(palette, 'Color');
  const grip = header(palette, 'Color').locator('.layer-col-grip');
  await grip.scrollIntoViewIfNeeded();
  const g = await grip.boundingBox();
  await page.mouse.move(g!.x + g!.width / 2, g!.y + g!.height / 2);
  await page.mouse.down();
  await page.mouse.move(g!.x + g!.width / 2 + 20, g!.y + 5, { steps: 3 });
  await page.mouse.move(g!.x + g!.width / 2 + 40, g!.y + 5, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await box(palette, 'Color')).width))
    .toBe(Math.round(color.width + 40));
  // Sizing is not sorting.
  await expect(header(palette, 'Name')).toHaveAttribute('aria-sort', 'ascending');

  // Dragging the Lock header onto On's moves Lock before On, without sorting by Lock. The filter
  // tree (M5-07 part 5) is collapsed so that both headers are in view; the list keeps it so.
  await palette.getByRole('button', { name: 'Collapse Layer Filter tree' }).click();
  await expect(palette.getByRole('tree', { name: 'Layer filters' })).toBeHidden();
  await wrap.evaluate((w) => (w.scrollLeft = 0));
  const lock = await box(palette, 'Lock');
  const on = await box(palette, 'On');
  await page.mouse.move(lock.x + lock.width / 2, lock.y + lock.height / 2);
  await page.mouse.down();
  await page.mouse.move(lock.x + lock.width / 2 - 20, lock.y + lock.height / 2, { steps: 4 });
  await page.mouse.move(on.x + 8, on.y + on.height / 2, { steps: 8 });
  await expect(header(palette, 'On')).toHaveAttribute('data-drop', 'before');
  await page.screenshot({ path: test.info().outputPath('1-dragging-lock.png') });
  await page.mouse.up();
  const titles = (p: Locator) => table(p).getByRole('columnheader').allTextContents();
  const moved = [
    'Status',
    'Name▲',
    'Lock',
    'On',
    'Freeze',
    'Plot',
    'Color',
    'Linetype',
    'Lineweight',
    'Transparency',
    'Plot Style',
    'Description',
  ];
  await expect.poll(() => titles(palette)).toEqual(moved);
  await expect(header(palette, 'Lock')).not.toHaveAttribute('aria-sort');
  await expect(header(palette, 'On')).not.toHaveAttribute('data-drop');

  // Freeze Column on Name: Status and Name stay put while the list scrolls sideways.
  await menuItem('Name', 'Freeze Column');
  await wrap.evaluate((w) => (w.scrollLeft = 0));
  const name0 = await box(palette, 'Name');
  const freeze0 = await box(palette, 'Freeze');
  await wrap.evaluate((w) => (w.scrollLeft = 150));
  await expect.poll(async () => (await box(palette, 'Freeze')).x).toBeLessThan(freeze0.x - 100);
  expect((await box(palette, 'Name')).x).toBeCloseTo(name0.x, 0);
  expect((await box(palette, 'Status')).x).toBeCloseTo(
    name0.x - (await box(palette, 'Status')).width,
    0,
  );
  await page.screenshot({ path: test.info().outputPath('2-frozen-name.png') });

  // The widths, the order and the frozen column are the user's: a reload keeps them.
  await page.reload();
  const again = await openLayers(page, false);
  const wrapAgain = again.locator('.layer-table-wrap');
  await expect
    .poll(async () => Math.round((await box(again, 'Color')).width))
    .toBe(Math.round(color.width + 40));
  await expect.poll(() => titles(again)).toEqual(moved);
  const nameAgain = await box(again, 'Name');
  await wrapAgain.evaluate((w) => (w.scrollLeft = 150));
  await expect.poll(async () => (await box(again, 'Name')).x).toBeCloseTo(nameAgain.x, 0);

  // Unfreeze Column: Name scrolls with the rest.
  await wrapAgain.evaluate((w) => (w.scrollLeft = 0));
  await header(again, 'Color').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unfreeze Column' }).click();
  await wrapAgain.evaluate((w) => (w.scrollLeft = 150));
  await expect.poll(async () => (await box(again, 'Name')).x).toBeLessThan(nameAgain.x - 100);
  await wrapAgain.evaluate((w) => (w.scrollLeft = 0));

  // Maximize Column with Name the only column shown: Name fills the list's width.
  await header(again, 'Name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Customize...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Layer Columns' });
  await dialog.getByRole('button', { name: 'Clear All' }).click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(table(again).getByRole('columnheader')).toHaveCount(1);
  await header(again, 'Name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Maximize Column' }).click();
  const room = await wrapAgain.evaluate((w) => w.clientWidth);
  await expect.poll(async () => Math.round((await box(again, 'Name')).width)).toBe(room);

  // Optimize All Columns, back with every column: each fits its contents and header.
  await header(again, 'Name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Restore All Columns to Defaults' }).click();
  await expect(table(again).getByRole('columnheader')).toHaveCount(12);
  await header(again, 'Name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Optimize All Columns' }).click();
  await expect
    .poll(() =>
      table(again).evaluate((t) =>
        [...t.querySelectorAll<HTMLElement>('th, td')].every((c) => c.scrollWidth <= c.clientWidth),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('3-optimized.png') });
});
