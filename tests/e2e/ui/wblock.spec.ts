// M5-01 part 4: WBLOCK's Write Block dialog and INSERT's Browse... in the app. The title block
// drawing's block is written as a new drawing file (Source Block, the file named after the block,
// Insert units Millimeters), which downloads as an AC1032 DXF; that file is then picked with the
// Insert dialog's Browse..., which names the block after it, shows its path and units, and OK
// makes the block of it and places it. The commands are unit-tested in
// packages/engine/test/commands/wblock.test.ts, the files on the corpus in
// packages/testkit/src/export/wblock.corpus.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertGeometry } from '@triya/engine';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FILE = fileURLToPath(
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

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The blocks this test made, by name, and the references it placed: block, position, scale. */
const made = (page: Page) =>
  page.evaluate(() => {
    const blocks = new Map<string, string>();
    const refs: { block: string; x: number; y: number; scale: number }[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const b of cs.blocks?.added ?? []) blocks.set(b.handle, b.name);
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind !== 'INSERT') continue;
        const g = a.entity.geom as InsertGeometry;
        refs.push({ block: g.block, x: g.position.x, y: g.position.y, scale: g.scale.x });
      }
    }
    return refs.map((r) => ({ ...r, block: blocks.get(r.block) ?? r.block }));
  });

const ZOOM =
  'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:';

test('WBLOCK writes the block as a new drawing, which Browse... inserts as a block', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'ZOOM');
  await expect(prompt(page)).toHaveText(ZOOM);
  await type(page, '200,-170', 'Specify opposite corner:');
  await type(page, '440,80', 'Command:');
  // The block's attribute values are their defaults: no prompts while it is placed.
  await enterCommand(page, 'ATTREQ');
  await type(page, '0', 'Command:');

  await enterCommand(page, 'WBLOCK');
  const dialog = page.getByRole('dialog', { name: 'Write Block' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Objects', exact: true })).toBeChecked();
  await expect(dialog.getByLabel('File name and path:')).toHaveValue('new block.dxf');
  await expect(dialog.getByTestId('write-block-count')).toHaveText('No objects selected');
  await dialog.getByRole('radio', { name: 'Block', exact: true }).check();
  await expect(dialog.getByRole('combobox', { name: 'Block', exact: true })).toHaveValue(
    'TITLE-BLOCK',
  );
  // Picking a block names the file after it; Base point and Objects are the Objects source's.
  await expect(dialog.getByLabel('File name and path:')).toHaveValue('TITLE-BLOCK.dxf');
  await expect(dialog.getByRole('button', { name: 'Pick point' })).toBeDisabled();
  await dialog.getByLabel('File name and path:').fill('title frame');
  await dialog.getByLabel('Insert units:').selectOption({ label: 'Millimeters' });
  await shot(page, '1-write-block');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(dialog).toBeHidden();
  expect(download.suggestedFilename()).toBe('title frame.dxf');
  const written = info.outputPath('title frame.dxf');
  await download.saveAs(written);
  const dxf = readFileSync(written, 'latin1');
  expect(dxf).toMatch(/\$ACADVER\s+1\s+AC1032/);
  expect(dxf).toMatch(/\$INSUNITS\s+70\s+4/);
  expect(dxf).toContain('ATTDEF');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Wrote title frame.dxf.',
  );

  // INSERT's Browse...: the file is the block, named after it.
  await enterCommand(page, 'INSERT');
  const insert = page.getByRole('dialog', { name: 'Insert' });
  await expect(insert).toBeVisible();
  await expect(insert.getByLabel('Name:')).toHaveValue('TITLE-BLOCK');
  await insert.getByLabel('Drawing file to insert').setInputFiles(written);
  await expect(insert.getByLabel('Name:')).toHaveValue('title frame');
  await expect(insert.getByTestId('insert-path')).toHaveText('title frame.dxf');
  await expect(insert.getByTestId('insert-unit')).toHaveText('Millimeters');
  await expect(insert.getByTestId('insert-factor')).toHaveText('1');
  const point = insert.getByRole('group', { name: 'Insertion point' });
  await point.getByRole('checkbox', { name: 'Specify On-screen' }).uncheck();
  await point.getByLabel('X:').fill('330');
  await point.getByLabel('Y:').fill('-80');
  await shot(page, '2-insert-browsed');
  await insert.getByRole('button', { name: 'OK' }).click();
  await expect(insert).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page)).map((r) => [r.block, r.x, r.y, r.scale]))
    .toEqual([['title frame', 330, -80, 1]]);
  await shot(page, '3-inserted');

  // The same file again: OK asks before redefining the block, Do not redefine inserts it as is.
  await enterCommand(page, 'INSERT');
  await expect(insert).toBeVisible();
  // The dialog opens on the block inserted last, which the file read names again.
  await expect(insert.getByLabel('Name:')).toHaveValue('title frame');
  await expect(insert.getByTestId('insert-path')).toHaveText('');
  await insert.getByLabel('Drawing file to insert').setInputFiles(written);
  await expect(insert.getByTestId('insert-path')).toHaveText('title frame.dxf');
  await point.getByLabel('Y:').fill('-130');
  await insert.getByRole('button', { name: 'OK' }).click();
  const ask = page.getByRole('dialog', { name: 'Block - Redefine Block' });
  await expect(ask).toContainText('“title frame” is already defined');
  await shot(page, '4-redefine');
  await ask.getByRole('button', { name: 'Do not redefine' }).click();
  await expect(insert).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await made(page)).map((r) => [r.block, r.x, r.y]))
    .toEqual([
      ['title frame', 330, -80],
      ['title frame', 330, -130],
    ]);
});
