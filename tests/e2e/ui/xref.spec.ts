// M1-21: external references found by dropping their files. The thread-authored set
// (packages/testkit/src/xref/fixture.ts): xref-parent.dxf draws an A3 border and attaches
// xref-child-tb.dxf, a title block, at (230, 10), and overlays the same file at (20, 150); the
// title block attaches xref-grandchild.dxf, a square with its diagonals. Before their files are
// supplied the references draw nothing. Dropping the title block loads it into both references
// (the drawing does not open in a tab of its own) and brings its layers in as
// `xref-child-tb|…`; dropping the grandchild then loads the nested reference. The set's golden
// image is shot by tests/e2e/fidelity/fixtures.spec.ts; references.spec.ts covers the palette,
// folders and kept handles.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('loads xrefs whose files are dropped, nested ones too', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, path.join(FIXTURES, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  const tabs = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');
  await expect(tabs).toHaveCount(1);
  // The border alone.
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(500);
  await page.waitForTimeout(500);
  const border = await ink(page);

  await openWithDrop(page, path.join(FIXTURES, 'xref-child-tb.dxf'));
  // Two title blocks (frames, dividers and logos), thin lines on a large sheet.
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(border + 3000);
  await page.waitForTimeout(500);
  const child = await ink(page);
  await expect(tabs).toHaveCount(1);
  await expectShown(page, 'xref-parent.dxf');

  // The nested grandchild, in both title blocks.
  await openWithDrop(page, path.join(FIXTURES, 'xref-grandchild.dxf'));
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(child + 500);
  await expect(tabs).toHaveCount(1);

  // The xrefs' layers are listed as xref-dependent ones.
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const rows = page
    .getByRole('complementary', { name: 'Layers' })
    .getByRole('table', { name: 'Layers of the drawing' });
  for (const name of ['xref-child-tb|TB-FRAME', 'xref-child-ovl|TB-LOGO', 'xref-grandchild|GC'])
    await expect(rows.getByRole('rowheader', { name, exact: true })).toBeVisible();

  // A drawing no xref waits for opens as usual.
  await openWithDrop(page, path.join(FIXTURES, 'xref-grandchild.dxf'));
  await expect(tabs).toHaveCount(2);
});
