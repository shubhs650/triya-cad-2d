// M5-04 part 7: XBIND's Xbind dialog on the thread-authored xref set
// (packages/testkit/src/xref/fixture.ts): xref-parent.dxf attaches the title block
// xref-child-tb.dxf, which attaches xref-grandchild.dxf. The tree is walked by keyboard and by
// mouse, definitions are added and removed, and OK binds them as `xref$0$name` layers and blocks
// the Layers palette lists; U takes them back. SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
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

/** The parent with the title block and its grandchild loaded. */
async function loadedParent(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, path.join(FIXTURES, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(500);
  const border = await ink(page);
  await openWithDrop(page, path.join(FIXTURES, 'xref-child-tb.dxf'));
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(border + 3000);
  await openWithDrop(page, path.join(FIXTURES, 'xref-grandchild.dxf'));
  // The grandchild's load has reached the drawing once its GC layer has come in (it brings the
  // child's too). A fixed wait raced it on CI: the canvas draws a load before the drawing's
  // engine has it, and XBIND opened without the grandchild.
  await expect
    .poll(() => page.evaluate(loadedLayers), { timeout: 30_000 })
    .toContain('xref-grandchild|GC');
}

/** The layers the drawing's loads and edits have added so far. */
function loadedLayers(): string[] {
  type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };
  return (window as unknown as Dev).triyaDev
    .changes()
    .flatMap((cs) => (cs.tables?.layers?.added ?? []).map((l) => l.name));
}

const layerRow = (page: Page, name: string) =>
  page.getByRole('grid', { name: 'Layers of the drawing' }).getByText(name, { exact: true });

test('binds definitions chosen in the Xbind tree; U takes them back', async ({ page }) => {
  test.setTimeout(120_000);
  await loadedParent(page);
  const tab = page.locator('.doc-tab[data-active="true"]');
  await expect(tab).toHaveAttribute('data-dirty', 'false');

  await enterCommand(page, 'XBIND');
  const dialog = page.getByRole('dialog', { name: 'Xbind' });
  await expect(dialog).toBeVisible();
  const tree = dialog.getByRole('tree', { name: 'Xrefs' });
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  const list = dialog.getByRole('listbox', { name: 'Definitions to Bind' });
  // The xrefs, closed, the first one focused.
  await expect(tree.getByRole('treeitem')).toHaveText([
    '+xref-child-ovl',
    '+xref-child-tb',
    '+xref-grandchild',
  ]);
  await expect(item('xref-child-ovl')).toBeFocused();

  // By keyboard: down to the title block, open it, into Block, open it, add LOGO with Enter.
  await page.keyboard.press('ArrowDown');
  await expect(item('xref-child-tb')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(item('xref-child-tb')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(item('Block').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(item('xref-child-tb|LOGO')).toBeFocused();
  await page.keyboard.press('Enter');
  // Enter added it (OK is the button's): it left the tree for the list.
  await expect(dialog).toBeVisible();
  await expect(list.getByRole('option')).toHaveText(['xref-child-tb|LOGO']);
  await expect(item('xref-child-tb|LOGO')).toHaveCount(0);

  // By mouse: open Layer with a double-click, add two layers, remove one again.
  await item('Layer').first().dblclick();
  await item('xref-child-tb|TB-FRAME').click();
  await dialog.getByRole('button', { name: 'Add ->' }).click();
  await item('xref-child-tb|TB-LINES').click();
  await dialog.getByRole('button', { name: 'Add ->' }).click();
  await expect(list.getByRole('option')).toHaveText([
    'xref-child-tb|LOGO',
    'xref-child-tb|TB-FRAME',
    'xref-child-tb|TB-LINES',
  ]);
  await list.getByRole('option', { name: 'xref-child-tb|TB-FRAME' }).click();
  await dialog.getByRole('button', { name: '<- Remove' }).click();
  await expect(list.getByRole('option')).toHaveText([
    'xref-child-tb|LOGO',
    'xref-child-tb|TB-LINES',
  ]);
  await expect(item('xref-child-tb|TB-FRAME')).toBeVisible();
  await shot(page, '1-xbind-dialog');

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText('Block "xref-child-tb|LOGO" bound as "xref-child-tb$0$LOGO".');
  await expect(log).toContainText(
    'Layer "xref-child-tb|TB-LINES" bound as "xref-child-tb$0$TB-LINES".',
  );
  await expect(tab).toHaveAttribute('data-dirty', 'true');

  // The bound layers are the drawing's own; the xref keeps its own.
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  await expect(layerRow(page, 'xref-child-tb$0$TB-LINES')).toBeVisible();
  // LOGO's own objects are on layer 0: its reference's layer is not LOGO's to bind.
  await expect(layerRow(page, 'xref-child-tb$0$TB-LOGO')).toHaveCount(0);
  await expect(layerRow(page, 'xref-child-tb|TB-LINES')).toBeVisible();
  await expect(layerRow(page, 'xref-child-tb$0$TB-FRAME')).toHaveCount(0);
  await shot(page, '2-bound-layers');

  await enterCommand(page, 'U');
  await expect(layerRow(page, 'xref-child-tb$0$TB-LINES')).toHaveCount(0);
  await expect(layerRow(page, 'xref-child-tb|TB-LINES')).toBeVisible();
});

test('Esc cancels the Xbind dialog, binding nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await loadedParent(page);
  await enterCommand(page, 'XB');
  const dialog = page.getByRole('dialog', { name: 'Xbind' });
  const tree = dialog.getByRole('tree', { name: 'Xrefs' });
  await expect(tree.getByRole('treeitem').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('listbox', { name: 'Definitions to Bind' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.doc-tab[data-active="true"]')).toHaveAttribute('data-dirty', 'false');
});
