// M5-04 part 2: the References palette's Bind… and its Bind Xrefs dialog, on the thread-authored
// xref set (packages/testkit/src/xref/fixture.ts): xref-parent.dxf attaches the title block
// xref-child-tb.dxf and overlays it, and the title block attaches xref-grandchild.dxf. Binding
// draws the same and the drawing has unsaved changes. SHOTS=<dir> saves the PR's screenshots.
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

const ALL_LOADED = [
  'xref-child-tb | Loaded',
  'xref-grandchild | Loaded',
  'xref-stamp | Loaded',
  'xref-child-ovl | Loaded',
  'xref-grandchild | Loaded',
  'xref-stamp | Loaded',
];

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
  await expect.poll(() => statuses(page)).toEqual(ALL_LOADED);
  await page.waitForTimeout(500);
  return ink(page);
}

/** The drawing's tab, which says when it has unsaved changes. */
const tab = (page: Page) => page.locator('.doc-tab[data-active="true"]');

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

test('binds an xref from the palette with the Bind Xrefs dialog, and U unbinds it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const full = await loadedParent(page);
  // Nested xrefs and images are not bound by themselves.
  await row(page, 'xref-grandchild').click();
  await expect(button(page, 'Bind…')).toBeDisabled();
  await row(page, 'xref-child-tb').click();
  await button(page, 'Bind…').click();
  const dialog = page.getByRole('dialog', { name: 'Bind Xrefs' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Bind', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Bind', exact: true })).toBeFocused();
  await shot(page, '1-bind-dialog');
  // Esc is Cancel: nothing changes.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tab(page)).toHaveAttribute('data-dirty', 'false');

  await button(page, 'Bind…').click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'What was done' })).toHaveText(
    'Xref "xref-child-tb" has been bound.',
  );
  // The title block is the drawing's now: it is no reference, and draws as it did. Its stamp is
  // the drawing's own image.
  await expect
    .poll(() => statuses(page))
    .toEqual(['xref-child-ovl | Loaded', 'xref-stamp | Loaded', 'xref-stamp | Loaded']);
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(full - 300);
  await expect(tab(page)).toHaveAttribute('data-dirty', 'true');
  await shot(page, '2-bound');
  // -XREF lists the one xref left.
  await enterCommand(page, '-XREF');
  await enterCommand(page, '?');
  await enterCommand(page, '');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Total Xref(s): 1',
  );
  // Its layers are the drawing's, named as Bind names them.
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  await expect(
    page.getByRole('grid', { name: 'Layers of the drawing' }).getByText('xref-child-tb$0$TB-FRAME'),
  ).toBeVisible();
  await shot(page, '3-bound-layers');

  await enterCommand(page, 'U');
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'References' })
    .click();
  await expect.poll(() => statuses(page)).toEqual(ALL_LOADED);
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(full - 300);
});

test('binds as Insert, the dialog kept by keyboard', async ({ page }) => {
  test.setTimeout(120_000);
  const full = await loadedParent(page);
  await row(page, 'xref-child-ovl').click();
  await button(page, 'Bind…').click();
  const dialog = page.getByRole('dialog', { name: 'Bind Xrefs' });
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('radio', { name: 'Insert' })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => statuses(page))
    .toEqual(['xref-child-tb | Loaded', 'xref-stamp | Loaded', 'xref-stamp | Loaded']);
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(full - 300);
  await shot(page, '4-bound-as-insert');
});
