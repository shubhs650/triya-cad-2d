// M5-01 part 3: INSERT's Insert dialog in the app. The title block drawing's one block is offered
// with its preview, units and factor; OK with the insertion point given in the dialog and ATTDIA
// 1 asks the attribute values in the Edit Attributes dialog and places the reference with them;
// the dialog opens again on the settings it closed with, and Repeat Placement places a
// reference at each point picked until Esc. The command is unit-tested in
// packages/engine/test/commands/insert-dialog.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertGeometry } from '@triya/engine';
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

/** The references this test placed: position, scale and their attributes' values by tag. */
const placed = (page: Page) =>
  page.evaluate(() => {
    const out: { x: number; y: number; scale: number; values: Record<string, string> }[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind !== 'INSERT') continue;
        const g = a.entity.geom as InsertGeometry;
        out.push({
          x: g.position.x,
          y: g.position.y,
          scale: g.scale.x,
          values: Object.fromEntries(g.attributes.map((t) => [t.tag, t.value])),
        });
      }
    }
    return out;
  });

const ZOOM =
  'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:';

test('the Insert dialog places the block, asking its attribute values in Edit Attributes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'ZOOM');
  await expect(prompt(page)).toHaveText(ZOOM);
  await type(page, '200,-170', 'Specify opposite corner:');
  await type(page, '440,80', 'Command:');
  await enterCommand(page, 'ATTDIA');
  await expect(prompt(page)).toHaveText('Enter new value for ATTDIA <0>:');
  await type(page, '1', 'Command:');

  await enterCommand(page, 'INSERT');
  const dialog = page.getByRole('dialog', { name: 'Insert' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name:')).toHaveValue('TITLE-BLOCK');
  await expect(dialog.getByTestId('insert-unit')).toHaveText('Unitless');
  await expect(dialog.getByTestId('insert-factor')).toHaveText('1');
  // The preview draws the block.
  await expect(dialog.getByTestId('insert-preview')).toHaveAttribute('data-drawn', /block/);
  const point = dialog.getByRole('group', { name: 'Insertion point' });
  await point.getByRole('checkbox', { name: 'Specify On-screen' }).uncheck();
  await point.getByLabel('X:').fill('225');
  await point.getByLabel('Y:').fill('-80');
  const scale = dialog.getByRole('group', { name: 'Scale' });
  await scale.getByRole('checkbox', { name: 'Uniform Scale' }).check();
  await expect(scale.getByLabel('Y:')).toBeDisabled();
  await scale.getByLabel('X:').fill('0.5');
  // Repeat Placement needs the insertion point on screen.
  await expect(dialog.getByRole('checkbox', { name: 'Repeat Placement' })).toBeDisabled();
  await shot(page, '1-insert-dialog');

  await dialog.getByRole('button', { name: 'OK' }).click();
  const values = page.getByRole('dialog', { name: 'Edit Attributes' });
  await expect(values).toBeVisible();
  await expect(values).toContainText('TITLE-BLOCK');
  await values.getByLabel('Drawing title').fill('Pump skid layout');
  await shot(page, '2-edit-attributes');
  await values.getByRole('button', { name: 'OK' }).click();
  await expect(values).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await placed(page)).map((r) => [r.x, r.y, r.scale, r.values['TITLE']]))
    .toEqual([[225, -80, 0.5, 'Pump skid layout']]);
  await shot(page, '3-placed');

  // The dialog opens on the settings it closed with; Repeat Placement places until Esc.
  await enterCommand(page, 'INSERT');
  await expect(dialog).toBeVisible();
  await expect(point.getByLabel('X:')).toHaveValue('225');
  await expect(scale.getByLabel('X:')).toHaveValue('0.5');
  await point.getByRole('checkbox', { name: 'Specify On-screen' }).check();
  await dialog.getByRole('checkbox', { name: 'Repeat Placement' }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText(/^Specify insertion point or/);
  for (const at of ['330,-80', '225,-130']) {
    await type(page, at, 'Edit Attributes:');
    await values.getByRole('button', { name: 'OK' }).click();
    await expect(prompt(page)).toHaveText(/^Specify insertion point or/);
  }
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await placed(page)).map((r) => [r.x, r.y]))
    .toEqual([
      [225, -80],
      [330, -80],
      [225, -130],
    ]);
  await shot(page, '4-repeat-placement');
});
