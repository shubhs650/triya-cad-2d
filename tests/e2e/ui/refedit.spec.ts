// M5-02 part 3: in-place reference editing in the app. REFEDIT on a block reference opens the
// Reference Edit dialog (Identify Reference and Settings tabs); OK carries the block's objects
// out where the reference draws them, and the Edit Reference bar takes the layout tabs' place; a
// circle drawn joins the working set; Save Changes carries it all back, so every reference shows
// the circle; Discard Changes takes back a line drawn after. The commands are unit-tested in
// packages/engine/test/commands/refedit.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker, viewOf } from '../app/page';
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
      // A move out of the block is a removal from it and an addition elsewhere.
      for (const r of cs.entities?.removed ?? [])
        if (r.entity.owner === door) held.delete(r.entity.handle);
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.owner === door) held.set(a.entity.handle, a.entity.geom.kind);
      }
    }
    return [...held.values()].sort();
  });

const ZOOM =
  'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:';

test('REFEDIT edits a block in place; Save Changes and Discard Changes close the edit', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);

  // A door frame made a block, referenced twice.
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
  for (const x of [0, 60]) {
    await enterCommand(page, '-INSERT');
    await type(page, 'DOOR', /^Specify insertion point/);
    await type(page, p(x, 0), /^Enter X scale factor/);
    await type(page, '', /^Enter Y scale factor/);
    await type(page, '', /^Specify rotation angle/);
    await type(page, '', 'Command:');
  }
  await expect.poll(() => doorContents(page)).toEqual(['LWPOLYLINE']);

  await enterCommand(page, 'REFEDIT');
  await expect(prompt(page)).toHaveText('Select reference:');
  await type(page, p(60, 10), 'Select reference:');
  const dialog = page.getByRole('dialog', { name: 'Reference Edit' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('treeitem', { name: 'DOOR' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByTestId('refedit-preview')).toHaveAttribute('data-drawn', /block/);
  await expect(dialog.getByLabel('Automatically select all nested objects')).toBeChecked();
  await shot(page, '1-reference-edit');
  await dialog.getByRole('tab', { name: 'Settings' }).click();
  await expect(dialog.getByLabel('Lock objects not in working set')).toBeChecked();
  await expect(dialog.getByLabel('Display attribute definitions for editing')).not.toBeChecked();
  await shot(page, '2-reference-edit-settings');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  const bar = page.getByRole('toolbar', { name: 'Edit Reference' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Editing reference: DOOR');
  await expect(page.getByRole('tablist', { name: 'Model and layouts' })).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => doorContents(page)).toEqual([]);
  await enterCommand(page, 'CIRCLE');
  await expect(prompt(page)).toHaveText(/^Specify center point for circle/);
  await type(page, p(80, 10), /^Specify radius of circle/);
  await type(page, '5', 'Command:');
  await shot(page, '3-editing-in-place');

  await bar.getByRole('button', { name: 'Save Changes' }).click();
  await expect(bar).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Model and layouts' })).toBeVisible();
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LWPOLYLINE']);
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '4-both-references-show-circle');

  // A line drawn in a second edit, discarded: the block keeps what it had.
  await enterCommand(page, '-REFEDIT');
  await type(page, p(0, 10), 'Enter object selection method [All/Nested] <All>:');
  await type(page, '', 'Display attribute definitions [Yes/No] <No>:');
  await type(page, '', 'Command:');
  await expect(bar).toBeVisible();
  await enterCommand(page, 'LINE');
  await type(page, p(0, 0), /^Specify next point/);
  await type(page, p(40, 20), /^Specify next point/);
  await type(page, '', 'Command:');
  await bar.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(bar).toBeHidden();
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LWPOLYLINE']);
});

/** How strongly the canvas is inked between CSS pixels `a` and `b` (as `inkWeight`). */
async function weightIn(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const box = (await activeCanvas(page).boundingBox())!;
  const clip = {
    x: box.x + Math.min(a.x, b.x),
    y: box.y + Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // The dark model canvas, #212830 (UI_SPEC.md §6).
    for (let i = 0; i < d.length; i += 4)
      n += Math.abs(d[i]! - 0x21) + Math.abs(d[i + 1]! - 0x28) + Math.abs(d[i + 2]! - 0x30);
    return n;
  }, png);
}

// M5-02 part 5: while a reference is edited in place, what is not in the working set is faded by
// XFADECTL (50 at first; 0 does not fade), and the block's other reference still draws the whole
// definition, though its objects are out of the block, until Save Changes.
test('REFEDIT fades what is not edited; the other reference still draws the block', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const canvas = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(canvas.x + 20, canvas.y + canvas.height + 60);

  await enterCommand(page, 'ZOOM');
  await expect(prompt(page)).toHaveText(ZOOM);
  await type(page, p(-10, -10), 'Specify opposite corner:');
  await type(page, p(110, 40), 'Command:');
  await enterCommand(page, 'RECTANG');
  await expect(prompt(page)).toHaveText(/^Specify first corner point/);
  await type(page, p(0, 0), /^Specify other corner point/);
  await type(page, p(40, 20), 'Command:');
  await enterCommand(page, 'CIRCLE');
  await expect(prompt(page)).toHaveText(/^Specify center point for circle/);
  await type(page, p(20, 10), /^Specify radius of circle/);
  await type(page, '5', 'Command:');
  await enterCommand(page, '-BLOCK');
  await type(page, 'DOOR', 'Specify insertion base point:');
  await type(page, p(0, 0), 'Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, p(-1, -1), 'Specify opposite corner:');
  await type(page, p(41, 21), 'Select objects:');
  await type(page, '', 'Command:');
  for (const x of [0, 60]) {
    await enterCommand(page, '-INSERT');
    await type(page, 'DOOR', /^Specify insertion point/);
    await type(page, p(x, 0), /^Enter X scale factor/);
    await type(page, '', /^Enter Y scale factor/);
    await type(page, '', /^Specify rotation angle/);
    await type(page, '', 'Command:');
  }
  await expect.poll(() => doorContents(page)).toEqual(['CIRCLE', 'LWPOLYLINE']);

  // The two references' areas on screen, and how strongly each is drawn before the edit.
  const view = await viewOf(page);
  const area = (x: number) => [view.at(O + x - 2, O + 22), view.at(O + x + 42, O - 2)] as const;
  const weight = (x: number) => weightIn(page, ...area(x));
  await expect.poll(() => weight(0)).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const other = await weight(0);
  const edited = await weight(60);
  await shot(page, '5-before-edit');

  await enterCommand(page, '-REFEDIT');
  await type(page, p(60, 10), 'Enter object selection method [All/Nested] <All>:');
  await type(page, '', 'Display attribute definitions [Yes/No] <No>:');
  await type(page, '', 'Command:');
  const bar = page.getByRole('toolbar', { name: 'Edit Reference' });
  await expect(bar).toBeVisible();
  await expect.poll(() => doorContents(page)).toEqual([]);
  // The working set, out of the block, in full; the other reference faded but whole.
  await expect.poll(() => weight(0)).toBeLessThan(other * 0.75);
  expect(await weight(0)).toBeGreaterThan(other * 0.3);
  expect(await weight(60)).toBeGreaterThan(edited * 0.9);
  await shot(page, '6-editing-other-reference-faded');

  // XFADECTL 0: nothing fades.
  await enterCommand(page, 'XFADECTL');
  await type(page, '0', 'Command:');
  await expect.poll(() => weight(0)).toBeGreaterThan(other * 0.9);
  await enterCommand(page, 'XFADECTL');
  await type(page, '50', 'Command:');
  await expect.poll(() => weight(0)).toBeLessThan(other * 0.75);

  // An object erased from the working set: the other reference keeps it until Save Changes.
  await enterCommand(page, 'ERASE');
  await type(page, p(85, 10), 'Select objects:');
  await type(page, '', 'Command:');
  expect(await weight(0)).toBeGreaterThan(other * 0.3);
  await bar.getByRole('button', { name: 'Save Changes' }).click();
  await expect(bar).toBeHidden();
  await expect.poll(() => doorContents(page)).toEqual(['LWPOLYLINE']);
  // Saved: both references in full, without the circle.
  await expect.poll(() => weight(0)).toBeGreaterThan(other * 0.5);
  expect(await weight(0)).toBeLessThan(other * 0.95);
  await shot(page, '7-saved-both-without-circle');
});
