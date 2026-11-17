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
