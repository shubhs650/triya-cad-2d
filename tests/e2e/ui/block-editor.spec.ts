// M5-02 part 1: the Block Editor in the app. BEDIT's Edit Block Definition dialog lists the
// drawing's blocks with a preview; OK shows the block in the Block Editor, whose bar takes the
// layout tabs' place; a circle drawn there joins the definition, so the reference shows it;
// Close Block Editor asks (Block - Changes Not Saved) whether to save: Save keeps the circle,
// Discard takes back a line drawn after. The commands are unit-tested in
// packages/engine/test/commands/block-editor.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const O = 1e6;
const p = (x: number, y: number) => `${O + x},${O + y}`;

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

/** What block DOOR holds now, by entity type, as the engine's edits left it. */
const doorContents = (page: Page) =>
  page.evaluate(() => {
    let door: string | undefined;
    const held = new Map<string, string>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const b of cs.blocks?.added ?? []) if (b.name === 'DOOR') door = b.handle;
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.owner === door) held.set(a.entity.handle, a.entity.geom.kind);
      }
      for (const r of cs.entities?.removed ?? []) held.delete(r.entity.handle);
    }
    return [...held.values()].sort();
  });

const ZOOM =
  'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:';

test('BEDIT edits a block in the Block Editor; BCLOSE saves or discards the edits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);

  // A door frame made a block, and a reference to it beside where it was.
  await enterCommand(page, 'ZOOM');
  await expect(prompt(page)).toHaveText(ZOOM);
  await type(page, p(-10, -10), 'Specify opposite corner:');
  await type(page, p(110, 40), 'Command:');
  await enterCommand(page, 'RECTANG');
  await expect(prompt(page)).toHaveText(/^Specify first corner point/);
  await type(page, p(0, 0), /^Specify other corner point/);
  await type(page, p(40, 20), 'Command:');
  await enterCommand(page, '-BLOCK');
  await type(page, 'DOOR', 'Specify insertion base point:');
  await type(page, p(0, 0), 'Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, p(-1, -1), 'Specify opposite corner:');
  await type(page, p(41, 21), 'Select objects:');
  await type(page, '', 'Command:');
  await enterCommand(page, '-INSERT');
  await type(page, 'DOOR', /^Specify insertion point/);
  await type(page, p(60, 0), /^Enter X scale factor/);
  await type(page, '', /^Enter Y scale factor/);
  await type(page, '', /^Specify rotation angle/);
  await type(page, '', 'Command:');
  await expect.poll(() => doorContents(page)).toEqual(['LWPOLYLINE']);

  await enterCommand(page, 'BEDIT');
  const dialog = page.getByRole('dialog', { name: 'Edit Block Definition' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'DOOR' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByLabel('Block to create or edit')).toHaveValue('DOOR');
  await expect(dialog.getByTestId('bedit-preview')).toHaveAttribute('data-drawn', /block/);
  await shot(page, '1-edit-block-definition');
  // The dialog is keyboard-operable: Enter is OK.
  await dialog.getByRole('listbox', { name: 'Blocks' }).press('Enter');
  await expect(dialog).toBeHidden();

  const bar = page.getByRole('toolbar', { name: 'Block Editor' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Block Editor: DOOR');
  await expect(page.getByRole('tablist', { name: 'Model and layouts' })).toBeHidden();
  await expect(page.locator('canvas[data-active="true"][aria-label="Block Editor"]')).toBeVisible();
  // The block opens at its extents: the frame's middle is the canvas's.
  const shown = (await activeCanvas(page).boundingBox())!;
  await expect
    .poll(async () => {
      const at = await worldAt(page, shown.width / 2, shown.height / 2);
      return [Math.round(at.x - O), Math.round(at.y - O)];
    })
    .toEqual([20, 10]);
  await enterCommand(page, 'CIRCLE');
  await expect(prompt(page)).toHaveText(/^Specify center point for circle/);
  await type(page, p(20, 10), /^Specify radius of circle/);
  await type(page, '5', 'Command:');
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LWPOLYLINE']);
  await shot(page, '2-block-editor');

  await bar.getByRole('button', { name: 'Close Block Editor' }).click();
  const ask = page.getByRole('dialog', { name: 'Block - Changes Not Saved' });
  await expect(ask).toBeVisible();
  await shot(page, '3-changes-not-saved');
  await ask.getByRole('button', { name: 'Save the changes to DOOR' }).click();
  await expect(ask).toBeHidden();
  await expect(bar).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Model and layouts' })).toBeVisible();
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '4-reference-shows-circle');

  // A line drawn after, discarded: the block keeps the circle only.
  await enterCommand(page, '-BEDIT');
  await type(page, 'DOOR', 'Command:');
  await expect(bar).toBeVisible();
  await enterCommand(page, 'LINE');
  await type(page, p(0, 0), /^Specify next point/);
  await type(page, p(40, 20), /^Specify next point/);
  await type(page, '', 'Command:');
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LINE', 'LWPOLYLINE']);
  await enterCommand(page, 'BCLOSE');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard the changes and close the Block Editor' }).click();
  await expect(bar).toBeHidden();
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LWPOLYLINE']);
});

const TITLE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);

/** The last attribute moves ATTSYNC made: how far each reference's first attribute went. */
const syncedBy = (page: Page) =>
  page.evaluate(() => {
    const out: number[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        if (u.after.geom.kind !== 'INSERT' || u.before.geom.kind !== 'INSERT') continue;
        const [a, b] = [u.before.geom.attributes[0], u.after.geom.attributes[0]];
        if (a && b) out.push(Math.round(b.position.y - a.position.y));
      }
    }
    return out;
  });

/** Whether block `name` exists now, as the engine's edits left it. */
const blockExists = (page: Page, name: string) =>
  page.evaluate((n) => {
    let made = false;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const b of cs.blocks?.added ?? []) if (b.name === n) made = true;
      for (const b of cs.blocks?.removed ?? []) if (b.name === n) made = false;
    }
    return made;
  }, name);

// M5-02 part 2: the Block Definition dialog's "Open in block editor" shows the block it made; a
// new name in Edit Block Definition makes an empty block, which Discard takes away again; and
// ATTSYNC gives the title block's reference the attributes its edited definition now places.
test('Open in block editor, a new block from BEDIT, and ATTSYNC', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, TITLE);
  await expectShown(page, path.basename(TITLE));
  await expect(prompt(page)).toHaveText('Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  const bar = page.getByRole('toolbar', { name: 'Block Editor' });
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // BLOCK with Open in block editor: a circle made block PLATE, shown in the editor.
  await enterCommand(page, 'CIRCLE');
  await expect(prompt(page)).toHaveText(/^Specify center point for circle/);
  await type(page, '-50,0', /^Specify radius of circle/);
  await type(page, '10', 'Command:');
  await enterCommand(page, 'BLOCK');
  const define = page.getByRole('dialog', { name: 'Block Definition' });
  await expect(define).toBeVisible();
  await define.getByLabel('Name:').fill('PLATE');
  await define.getByRole('checkbox', { name: 'Specify On-screen' }).nth(1).check();
  await define.getByRole('checkbox', { name: 'Open in block editor' }).check();
  await shot(page, '5-open-in-block-editor');
  await define.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'L', 'Select objects:');
  await type(page, '', 'Command:');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Block Editor: PLATE');
  // Made before the editor opened: closing asks nothing.
  await bar.getByRole('button', { name: 'Close Block Editor' }).click();
  await expect(bar).toBeHidden();
  expect(await blockExists(page, 'PLATE')).toBe(true);

  // A new name in Edit Block Definition: an empty block, opened; Discard takes it away.
  await enterCommand(page, 'BEDIT');
  const edit = page.getByRole('dialog', { name: 'Edit Block Definition' });
  await expect(edit).toBeVisible();
  await edit.getByLabel('Block to create or edit').fill('BRACKET');
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(bar).toContainText('Block Editor: BRACKET');
  expect(await blockExists(page, 'BRACKET')).toBe(true);
  await enterCommand(page, 'BCLOSE');
  const ask = page.getByRole('dialog', { name: 'Block - Changes Not Saved' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard the changes and close the Block Editor' }).click();
  await expect(bar).toBeHidden();
  expect(await blockExists(page, 'BRACKET')).toBe(false);

  // The title block's contents moved up 30 in the editor: its attributes stay behind until
  // ATTSYNC places them as the definition now does.
  await enterCommand(page, 'ZOOM');
  await type(page, 'E', 'Command:');
  await enterCommand(page, '-BEDIT');
  await type(page, 'TITLE-BLOCK', 'Command:');
  await expect(bar).toBeVisible();
  await enterCommand(page, 'MOVE');
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', /^Specify base point or \[Displacement\]/);
  await type(page, '0,30', /^Specify second point/);
  await type(page, '', 'Command:');
  await enterCommand(page, 'BCLOSE');
  await ask.getByRole('button', { name: 'Save the changes to TITLE-BLOCK' }).click();
  await expect(bar).toBeHidden();
  await enterCommand(page, 'ZOOM');
  await type(page, 'E', 'Command:');
  await shot(page, '6-before-attsync');
  await enterCommand(page, 'ATTSYNC');
  await expect(prompt(page)).toHaveText('Enter an option [?/Name/Select] <Select>:');
  await type(page, 'N', 'Enter name of block to update:');
  await type(page, 'TITLE-BLOCK', 'Command:');
  await expect(log).toContainText('ATTSYNC complete.');
  await expect.poll(() => syncedBy(page)).toEqual([30]);
  await shot(page, '7-after-attsync');
});
