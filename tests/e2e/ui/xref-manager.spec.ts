// M5-04 part 1: the References palette's Reload, Unload and Detach, and -XREF, on the
// thread-authored xref set (packages/testkit/src/xref/fixture.ts): xref-parent.dxf attaches the
// title block xref-child-tb.dxf and overlays it, and the title block attaches xref-grandchild.dxf.
// SHOTS=<dir> saves the screenshots the PR shows.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** The palette's rows as name and status. */
async function statuses(page: Page): Promise<string[]> {
  const table = page.getByRole('table', { name: 'References of the drawing' });
  return table
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => `${tr.children[0]!.textContent} | ${tr.children[1]!.textContent}`),
    );
}

/** The parent with every xref loaded, the References palette open. Returns the full ink. */
async function loadedParent(page: Page): Promise<number> {
  await page.goto(app.url);
  await openWithPicker(page, path.join(FIXTURES, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(500);
  const border = await ink(page);
  await openWithDrop(page, path.join(FIXTURES, 'xref-child-tb.dxf'));
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(border + 3000);
  await openWithDrop(page, path.join(FIXTURES, 'xref-grandchild.dxf'));
  await openWithDrop(page, path.join(FIXTURES, 'xref-stamp.png'));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'References' })
    .click();
  await expect
    .poll(() => statuses(page))
    .toEqual([
      'xref-child-tb | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
      'xref-child-ovl | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
    ]);
  await page.waitForTimeout(500);
  return ink(page);
}

const row = (page: Page, name: string) =>
  page
    .getByRole('table', { name: 'References of the drawing' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
    .first();
const button = (page: Page, name: string) =>
  page
    .getByRole('toolbar', { name: 'Selected references' })
    .getByRole('button', { name, exact: true });

test('unloads and reloads an xref from the References palette', async ({ page }) => {
  test.setTimeout(120_000);
  const full = await loadedParent(page);
  await shot(page, '1-loaded');

  // Nothing selected: nothing to do.
  await expect(button(page, 'Unload')).toBeDisabled();
  await row(page, 'xref-child-tb').click();
  await expect(row(page, 'xref-child-tb')).toHaveAttribute('aria-selected', 'true');
  await button(page, 'Unload').click();
  await expect
    .poll(() => statuses(page))
    .toEqual([
      'xref-child-tb | Unloaded',
      'xref-child-ovl | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
    ]);
  await expect(page.getByRole('list', { name: 'What was done' })).toHaveText(
    'Xref "xref-child-tb" has been unloaded.',
  );
  // The title block at the bottom right draws nothing now.
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeLessThan(full - 1500);
  // An unloaded xref is not one "not found".
  await expect(page.getByRole('button', { name: /references? not found/ })).toHaveCount(0);
  await shot(page, '2-unloaded');

  // A nested xref cannot be unloaded, only reloaded.
  await row(page, 'xref-grandchild').click();
  await expect(button(page, 'Unload')).toBeDisabled();
  await expect(button(page, 'Detach')).toBeDisabled();
  await expect(button(page, 'Reload')).toBeEnabled();

  await row(page, 'xref-child-tb').click();
  await button(page, 'Reload').click();
  await expect
    .poll(() => statuses(page), { timeout: 30_000 })
    .toEqual([
      'xref-child-tb | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
      'xref-child-ovl | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
    ]);
  await expect(page.getByRole('list', { name: 'What was done' })).toHaveText(
    'Xref "xref-child-tb" has been reloaded.',
  );
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(full - 300);
  // Unload and Reload change what the drawing shows, not the drawing.
  await expectShown(page, 'xref-parent.dxf');
});

test('detaches an xref from the palette, and U brings it back', async ({ page }) => {
  test.setTimeout(120_000);
  const full = await loadedParent(page);
  await row(page, 'xref-child-ovl').click();
  await button(page, 'Detach').click();
  await expect
    .poll(() => statuses(page))
    .toEqual(['xref-child-tb | Loaded', 'xref-grandchild | Loaded', 'xref-stamp | Loaded']);
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeLessThan(full - 500);
  await shot(page, '3-detached');
  await enterCommand(page, 'U');
  await expect.poll(() => statuses(page)).toContain('xref-child-ovl | Loaded');
});

/** The details pane's value of `label`. */
const detail = (page: Page, label: string) =>
  page
    .getByRole('region', { name: 'Details' })
    .locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

test('Reload All References reloads every file; Details says where each was found', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loadedParent(page);
  const references = page.getByRole('complementary', { name: 'References' });

  // M5-04 part 14: the details pane of the one reference selected.
  await row(page, 'xref-child-tb').click();
  await expect(detail(page, 'Reference Name')).toHaveText('xref-child-tb');
  await expect(detail(page, 'Status')).toHaveText('Loaded');
  await expect(detail(page, 'Type')).toHaveText('Attach');
  await expect(detail(page, 'Saved Path').getByRole('textbox')).toHaveValue('.\\xref-child-tb.dxf');
  // Dropped alone, a file is found at its name: the browser tells of no folder.
  await expect(detail(page, 'Found At')).toHaveText('xref-child-tb.dxf');
  await expect(detail(page, 'Size')).toHaveText(/^\d[\d,]* KB$/);
  await expect(detail(page, 'Date')).not.toHaveText('—');
  await row(page, 'xref-stamp').click();
  await expect(detail(page, 'Type')).toHaveText('Image');
  await expect(detail(page, 'Found At')).toHaveText('xref-stamp.png');
  await expect(detail(page, 'Size')).toHaveText('1 KB');
  // Several selected: no details.
  await row(page, 'xref-child-tb').click({ modifiers: ['Control'] });
  await expect(references.getByRole('region', { name: 'Details' })).toHaveCount(0);

  // Unloaded on purpose, an xref stays unloaded.
  await row(page, 'xref-child-ovl').click();
  await button(page, 'Unload').click();
  await expect.poll(() => statuses(page)).toContain('xref-child-ovl | Unloaded');
  await references.getByRole('button', { name: 'Reload All References' }).click();
  await expect(page.getByRole('list', { name: 'What was done' }).getByRole('listitem')).toHaveText(
    ['Xref "xref-child-tb" has been reloaded.', 'Image "xref-stamp.png" has been reloaded.'],
    { timeout: 30_000 },
  );
  await expect
    .poll(() => statuses(page), { timeout: 30_000 })
    .toEqual([
      'xref-child-tb | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
      'xref-child-ovl | Unloaded',
    ]);
  await row(page, 'xref-child-tb').click();
  await expect(detail(page, 'Found At')).toHaveText('xref-child-tb.dxf');
  await shot(page, '5-reload-all-details');
});

test("Open opens a reference's file: an image in a browser tab, an xref in a drawing tab", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loadedParent(page);
  // Not found or not selected: nothing to open.
  await expect(button(page, 'Open')).toBeDisabled();

  await row(page, 'xref-stamp').click();
  const popup = page.waitForEvent('popup');
  await button(page, 'Open').click();
  expect((await popup).url()).toMatch(/^blob:/);

  // A nested xref's drawing opens in a tab of its own, and Open again shows that tab.
  await row(page, 'xref-grandchild').click();
  await button(page, 'Open').click();
  await expectShown(page, 'xref-grandchild.dxf');
  await page
    .getByRole('tablist', { name: 'Open drawings' })
    .getByRole('tab', { name: 'xref-parent.dxf' })
    .click();
  await expectShown(page, 'xref-parent.dxf');
  await row(page, 'xref-grandchild').click();
  await button(page, 'Open').click();
  await expectShown(page, 'xref-grandchild.dxf');
  await expect(
    page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab', { name: /grandchild/ }),
  ).toHaveCount(1);
  await shot(page, '6-open-xref');
});

test("Saved Path, Browse and Remove Path change a reference's path and reload it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const full = await loadedParent(page);
  const said = page.getByRole('list', { name: 'What was done' }).getByRole('listitem');
  const savedPath = detail(page, 'Saved Path').getByRole('textbox');

  // M5-04 part 15: the overlay pointed at the grandchild's file, typed in place: it is reloaded
  // from it, its title block and the grandchild it brought gone.
  await row(page, 'xref-child-ovl').click();
  await expect(savedPath).toHaveValue('.\\xref-child-tb.dxf');
  await savedPath.fill('C:\\Sheets\\xref-grandchild.dxf');
  await savedPath.press('Enter');
  await expect(said).toHaveText([
    '"xref-child-ovl" now has the saved path C:\\Sheets\\xref-grandchild.dxf',
  ]);
  await expect
    .poll(() => statuses(page), { timeout: 30_000 })
    .toEqual([
      'xref-child-tb | Loaded',
      'xref-grandchild | Loaded',
      'xref-stamp | Loaded',
      'xref-child-ovl | Loaded',
    ]);
  await expect(savedPath).toHaveValue('C:\\Sheets\\xref-grandchild.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeLessThan(full - 1500);
  await shot(page, '7-saved-path');

  // One undo step: U brings the old path back, with the title block it showed.
  await enterCommand(page, 'U');
  await expect.poll(() => statuses(page), { timeout: 30_000 }).toContain('xref-child-ovl | Loaded');
  await row(page, 'xref-child-ovl').click();
  await expect(savedPath).toHaveValue('.\\xref-child-tb.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(full - 300);

  // Browse... picks the file: its name is the saved path, and the xref loads from it.
  await page
    .getByRole('region', { name: 'Details' })
    .getByLabel('Reference file')
    .setInputFiles(path.join(FIXTURES, 'xref-grandchild.dxf'));
  await expect(said).toHaveText(['"xref-child-ovl" now has the saved path xref-grandchild.dxf']);
  await expect(savedPath).toHaveValue('xref-grandchild.dxf');
  await expect.poll(() => statuses(page), { timeout: 30_000 }).toContain('xref-child-ovl | Loaded');

  // Remove Path keeps the file name alone; Escape in the box puts the saved path back.
  await row(page, 'xref-child-tb').click();
  await savedPath.fill('elsewhere.dxf');
  await savedPath.press('Escape');
  await expect(savedPath).toHaveValue('.\\xref-child-tb.dxf');
  await button(page, 'Remove Path').click();
  await expect(said).toHaveText(['"xref-child-tb" now has the saved path xref-child-tb.dxf']);
  await expect(savedPath).toHaveValue('xref-child-tb.dxf');
  await expect(button(page, 'Remove Path')).toBeDisabled();
  await expect.poll(() => statuses(page), { timeout: 30_000 }).toContain('xref-child-tb | Loaded');
  // A nested reference's path is its xref file's: shown, not edited.
  await row(page, 'xref-stamp').click();
  await expect(detail(page, 'Saved Path')).toHaveText('.\\xref-stamp.png');
  await expect(detail(page, 'Saved Path').getByRole('textbox')).toHaveCount(0);
});

test('-XREF lists, unloads and detaches by name', async ({ page }) => {
  test.setTimeout(120_000);
  await loadedParent(page);
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await enterCommand(page, '-XREF');
  await enterCommand(page, '?');
  await enterCommand(page, '');
  await expect(log).toContainText('Total Xref(s): 3');
  await enterCommand(page, '-XREF');
  await enterCommand(page, 'Unload');
  await enterCommand(page, 'xref-child-tb');
  await expect(log).toContainText('Xref "xref-child-tb" has been unloaded.');
  await expect.poll(() => statuses(page)).toContain('xref-child-tb | Unloaded');
  await enterCommand(page, '-XREF');
  await enterCommand(page, 'Detach');
  await enterCommand(page, 'xref-child-tb');
  await expect.poll(() => statuses(page)).not.toContain('xref-child-tb | Unloaded');
  await shot(page, '4-dash-xref');
});
