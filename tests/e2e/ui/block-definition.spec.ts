// M5-01 part 2: BLOCK's Block Definition dialog in the app. Pick point and Select objects close
// the dialog for the pick and open it again with the point and the count; OK with Convert to
// block makes the block, with its Behavior and Description, and puts a reference where the
// objects were. Picking the block's name again shows its settings; OK with no objects asks
// before making an empty block, then before redefining it, and Cancel leaves everything as it
// was. The command is unit-tested in packages/engine/test/commands/block-dialog.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertGeometry } from '@triya/engine';
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

/** The blocks this test made (name, description) and the references to them. */
const made = (page: Page) =>
  page.evaluate(() => {
    const blocks = new Map<string, { handle: string; name: string; description?: string }>();
    const scalable = new Map<string, boolean>();
    const refs = new Map<string, InsertGeometry>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const b of cs.blocks?.added ?? []) blocks.set(b.handle, b);
      for (const u of cs.blocks?.updated ?? []) blocks.set(u.after.handle, u.after);
      for (const r of cs.tables?.blockRecords?.added ?? []) scalable.set(r.handle, r.scalable);
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'INSERT') refs.set(a.entity.handle, a.entity.geom);
      }
      for (const r of cs.entities?.removed ?? []) refs.delete(r.entity.handle);
    }
    return {
      blocks: [...blocks.values()].map((b) => ({
        name: b.name,
        description: b.description,
        scalable: scalable.get(b.handle),
      })),
      refs: [...refs.values()].map((g) => ({
        block: blocks.get(g.block)?.name,
        x: g.position.x,
        y: g.position.y,
      })),
    };
  });

test('the Block Definition dialog makes a block of the objects and converts them', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // A window frame and its pane, away from the drawing.
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-10, -10), 'Specify opposite corner:');
  await type(page, p(50, 30), 'Command:');
  await enterCommand(page, 'RECTANG');
  await expect(prompt(page)).toHaveText(/^Specify first corner point/);
  await type(page, p(0, 0), /^Specify other corner point/);
  await type(page, p(40, 20), 'Command:');
  await enterCommand(page, 'CIRCLE');
  await expect(prompt(page)).toHaveText(/^Specify center point for circle/);
  await type(page, p(20, 10), /^Specify radius of circle/);
  await type(page, '5', 'Command:');

  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await shot(page, '0-before');

  await enterCommand(page, 'BLOCK');
  const dialog = page.getByRole('dialog', { name: 'Block Definition' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('block-definition-count')).toHaveText('No objects selected');
  await expect(dialog.getByRole('radio', { name: 'Convert to block' })).toBeChecked();
  await dialog.getByLabel('Name:').fill('WINDOW');
  await dialog.getByLabel('Description').fill('Casement window');
  await dialog.getByRole('checkbox', { name: 'Scale uniformly' }).check();

  // Pick point closes it for the point.
  await dialog.getByRole('button', { name: 'Pick point' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify insertion base point:');
  await type(page, p(0, 0), 'Block Definition:');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('X:')).toHaveValue(String(O));
  await expect(dialog.getByLabel('Name:')).toHaveValue('WINDOW');

  // Select objects closes it for a crossing window round both.
  await dialog.getByRole('button', { name: 'Select objects' }).click();
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, p(-1, -1), 'Specify opposite corner:');
  await type(page, p(41, 21), 'Select objects:');
  await type(page, '', 'Block Definition:');
  await expect(dialog.getByTestId('block-definition-count')).toHaveText('2 objects selected');
  await expect(dialog.getByLabel('Description')).toHaveValue('Casement window');
  await shot(page, '1-block-definition');

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => made(page))
    .toEqual({
      blocks: [{ name: 'WINDOW', description: 'Casement window', scalable: false }],
      refs: [{ block: 'WINDOW', x: O, y: O }],
    });
  // One click on the frame selects the whole reference: one grip, at its insertion point.
  const view = await viewOf(page);
  const edge = view.at(O + 20, O + 20);
  await page.mouse.move(box.x + edge.x, box.y + edge.y);
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + edge.x, box.y + edge.y);
  await page.waitForTimeout(500);
  await shot(page, '2-converted-reference-selected');
  await page.keyboard.press('Escape');

  // The name again shows the block's settings; OK with nothing selected asks twice.
  await enterCommand(page, 'BLOCK');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name:').fill('window');
  await expect(dialog.getByRole('checkbox', { name: 'Scale uniformly' })).toBeChecked();
  await expect(dialog.getByLabel('Description')).toHaveValue('Casement window');
  await dialog.getByRole('button', { name: 'OK' }).click();
  const empty = page.getByRole('dialog', { name: 'Block - Empty Block' });
  await expect(empty).toBeVisible();
  await empty.getByRole('button', { name: 'Make an empty block' }).click();
  const redefine = page.getByRole('dialog', { name: 'Block - Redefine Block' });
  await expect(redefine).toContainText('“WINDOW” is already defined');
  await shot(page, '3-redefine-asked');
  await redefine.getByRole('button', { name: 'Do not redefine' }).click();
  await expect(redefine).toBeHidden();
  await expect(dialog).toBeVisible();
  // Esc is Cancel: nothing changes.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  expect((await made(page)).blocks).toHaveLength(1);
});
