// M5-11: Design-Center-lite, the cross-drawing insert test. With the title block drawing and a
// second drawing open, DC opens DesignCenter on the drawing shown; the title block drawing's
// layer BORDER is added with Add Layer(s) (a second add is ignored as a duplicate), its block
// TITLE-BLOCK dragged onto the canvas is inserted where it was dropped (its attributes at their
// defaults, ATTREQ 0), and U takes the insert and the block's definition back in one step. A
// drawing file dropped on the palette is listed without opening. The engine side is unit-tested
// in packages/engine/test/edit/design-center.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertGeometry } from '@triya/engine';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DXF,
  activeCanvas,
  enterCommand,
  expectInputsRead,
  expectShown,
  openWithPicker,
  worldAt,
} from '../app/page';
import { startApp } from '../app/server';

const TITLE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const log = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** What the drawing shown has had added since it opened: layers, blocks and references. */
const added = (page: Page) =>
  page.evaluate(() => {
    const layers = new Set<string>();
    const blocks = new Map<string, string>();
    const inserts = new Map<string, { block: string; x: number; y: number }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const l of cs.tables?.layers?.added ?? []) layers.add(l.name);
      for (const l of cs.tables?.layers?.removed ?? []) layers.delete(l.name);
      for (const r of cs.tables?.blockRecords?.added ?? []) blocks.set(r.handle, r.name);
      for (const r of cs.tables?.blockRecords?.removed ?? []) blocks.delete(r.handle);
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind !== 'INSERT') continue;
        const g = a.entity.geom as InsertGeometry;
        inserts.set(a.entity.handle, { block: g.block, x: g.position.x, y: g.position.y });
      }
      for (const r of cs.entities?.removed ?? []) inserts.delete(r.entity.handle);
    }
    return {
      layers: [...layers],
      blocks: [...blocks.values()],
      inserts: [...inserts.values()].map((i) => ({ ...i, block: blocks.get(i.block) ?? i.block })),
    };
  });

test('DesignCenter adds another open drawing’s layer and inserts its block where it is dropped', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, TITLE);
  await expectShown(page, path.basename(TITLE));
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  await enterCommand(page, 'DC');
  const dc = page.getByRole('complementary', { name: 'DesignCenter' });
  await expect(dc).toBeVisible();
  const tree = dc.getByRole('tree', { name: 'Open drawings and loaded files' });
  // The drawing shown starts open in the tree; the title block drawing opens with a click.
  await tree.getByRole('button', { name: 'title-block.dxf' }).click();
  const titleNode = tree
    .getByRole('treeitem')
    .filter({ has: page.getByRole('button', { name: 'title-block.dxf' }) });
  await titleNode.getByRole('button', { name: 'Layers (2)' }).click();
  const layers = dc.getByRole('listbox', { name: 'Layers' });
  await layers.getByRole('option', { name: 'BORDER' }).click();
  await expect(layers.getByRole('option', { name: 'BORDER' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dc.getByRole('button', { name: 'Add Layer(s)' }).click();
  await expect(log(page)).toContainText('Layer(s) added: BORDER.');
  await expectInputsRead(page);
  // A second add is a duplicate: ignored, the drawing's own layer kept.
  await layers.getByRole('option', { name: 'BORDER' }).dblclick();
  await expect(log(page)).toContainText('Duplicate definitions ignored: layer BORDER.');
  expect((await added(page)).layers).toEqual(['BORDER']);

  // The attributes take their defaults (ATTREQ 0), as INSERT places them.
  await enterCommand(page, 'ATTREQ');
  await expect(prompt(page)).toHaveText('Enter new value for ATTREQ <1>:');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await titleNode.getByRole('button', { name: 'Blocks (1)' }).click();
  const block = dc.getByRole('listbox', { name: 'Blocks' }).getByRole('option', {
    name: 'TITLE-BLOCK',
  });
  await shot(page, '1-design-center-blocks');
  const target = { x: 300, y: 220 };
  const at = await worldAt(page, target.x, target.y);
  await block.dragTo(activeCanvas(page), { targetPosition: target });
  // The prompt reads "Command:" before the drop too, so wait for the insert itself: reading
  // the changes once the prompt matched raced the engine's answer (CI, 2026-11-18).
  await expect.poll(async () => (await added(page)).inserts).toHaveLength(1);
  await expect(prompt(page)).toHaveText('Command:');
  const after = await added(page);
  expect(after.blocks).toContain('TITLE-BLOCK');
  expect(after.inserts).toHaveLength(1);
  const placed = after.inserts[0]!;
  expect(placed.block).toBe('TITLE-BLOCK');
  // Within a pixel or two of where the drop was, in drawing units.
  const view = await worldAt(page, target.x + 1, target.y);
  const pixel = Math.abs(view.x - at.x);
  expect(Math.abs(placed.x - at.x)).toBeLessThanOrEqual(2 * pixel + 1e-9);
  expect(Math.abs(placed.y - at.y)).toBeLessThanOrEqual(2 * pixel + 1e-9);
  await shot(page, '2-title-block-dropped');

  // One ADCENTER step: U takes the reference and the block's definition back.
  await enterCommand(page, 'U');
  await expect(log(page)).toContainText('ADCENTER');
  await expect.poll(async () => (await added(page)).inserts).toHaveLength(0);
  expect((await added(page)).blocks).not.toContain('TITLE-BLOCK');
});

test('a drawing file dropped on DesignCenter is listed there, not opened; Ctrl+2 toggles it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page.getByRole('button', { name: 'DesignCenter' }).click();
  const dc = page.getByRole('complementary', { name: 'DesignCenter' });
  await expect(dc).toBeVisible();
  await dc.getByLabel('Drawing files to load').setInputFiles(TITLE);
  const tree = dc.getByRole('tree', { name: 'Open drawings and loaded files' });
  await tree.getByRole('button', { name: 'title-block.dxf' }).click();
  await expect(tree.getByRole('button', { name: 'Blocks (1)' })).toBeVisible();
  // Not opened in a tab.
  await expect(page.getByRole('tab', { name: /title-block/ })).toHaveCount(0);
  await page.keyboard.press('Control+2');
  await expect(dc).toBeHidden();
  await page.keyboard.press('Control+2');
  await expect(dc).toBeVisible();
});
