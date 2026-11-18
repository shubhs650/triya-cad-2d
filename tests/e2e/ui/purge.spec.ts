// M5-09 part 1: -PURGE at the command line on sample_AC1032_ascii.dxf, which has layers,
// linetypes and blocks nothing uses. LAyers, Enter for every name, No to verifying: the unused
// layers go with AutoCAD's "Deleting layer" lines and a count, and a second run finds none.
// M5-09 part 2: PURGE's Purge dialog on the same drawing: a layer checked and purged, the one
// unused block with Confirm Purge, an item in use's Possible Reasons and Details, and Select Objects.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

test('-PURGE removes the layers nothing uses, and finds none left on a second run (M5-09)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await enterCommand(page, '-PURGE');
  await expect(prompt(page)).toContainText('Enter type of unused objects to purge [Blocks/');
  await enterCommand(page, 'LA');
  await expect(prompt(page)).toHaveText('Enter name(s) to purge <*>:');
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Verify each name to be purged? [Yes/No] <Yes>:');
  await enterCommand(page, 'N');
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('F2');
  const full = page.getByRole('dialog', { name: 'Command history' });
  await expect(full).toContainText('Deleting layer "');
  await expect(full).toContainText(/\d+ layers? deleted\./);
  await shot('1-purge-layers.png');
  await page.keyboard.press('F2');
  await expect(full).toBeHidden();

  // Nothing is left to purge on a second run.
  await enterCommand(page, '-PURGE');
  await enterCommand(page, 'LA');
  await enterCommand(page, '');
  await enterCommand(page, 'N');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'No unreferenced layers found.',
  );
});

test('the Purge dialog purges checked items, confirms each, and finds what is in use (M5-09)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await enterCommand(page, 'PURGE');
  const purge = page.getByRole('dialog', { name: 'Purge', exact: true });
  await expect(purge).toBeVisible();
  await expect(purge.getByRole('tab', { name: 'Purgeable Items', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const tree = purge.getByRole('tree', { name: 'Named Items Not Used' });
  const layers = tree.getByRole('treeitem', { name: /^Layers \(\d+\)$/ });
  await expect(layers).toBeVisible();
  const before = Number(/\((\d+)\)/.exec((await layers.textContent()) ?? '')![1]);
  expect(before).toBeGreaterThan(1);
  await layers.dblclick();
  const first = tree.locator('[role="treeitem"][aria-level="3"]').first();
  const name = (await first.textContent())!.trim();
  await first.getByRole('checkbox').check();
  await purge.getByRole('checkbox', { name: 'Confirm each item to be purged' }).uncheck();
  await shot('1-purge-dialog-checked.png');
  await purge.getByRole('button', { name: 'Purge Checked Items' }).click();
  await expect(purge.getByRole('status')).toHaveText('1 item purged.');
  await expect(tree.getByRole('treeitem', { name: `Layers (${before - 1})` })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name, exact: true })).toHaveCount(0);
  await shot('2-purged.png');

  // Confirm Purge for a block, checked by its type's box.
  await purge.getByRole('checkbox', { name: 'Confirm each item to be purged' }).check();
  const blocks = tree.getByRole('treeitem', { name: 'Blocks (1)' });
  await blocks.getByRole('checkbox').check();
  await purge.getByRole('button', { name: 'Purge Checked Items' }).click();
  const confirm = page.getByRole('dialog', { name: 'Purge - Confirm Purge' });
  await expect(confirm).toContainText(/Purge block ".+"\?/);
  await shot('3-confirm-purge.png');
  await confirm.getByRole('button', { name: 'Purge this item' }).click();
  await expect(purge.getByRole('status')).toHaveText('1 item purged.');
  await expect(tree.getByRole('treeitem', { name: 'Blocks (0)' })).toBeVisible();

  // Find Non-Purgeable Items: why Layer1 stays, and the objects on it.
  await purge.getByRole('tab', { name: 'Find Non-Purgeable Items' }).click();
  const inUse = purge.getByRole('tree', { name: 'Named Items In Use' });
  await inUse.getByRole('treeitem', { name: /^Layers \(\d+\)$/ }).dblclick();
  await inUse.getByRole('treeitem', { name: '0', exact: true }).click();
  await expect(purge.getByTestId('purge-reasons')).toContainText(
    '0 is a default layer and cannot be purged.',
  );
  await inUse.getByRole('treeitem', { name: 'Layer1', exact: true }).click();
  await expect(purge.getByTestId('purge-reasons')).toContainText('in the drawing use it.');
  await expect(purge.getByTestId('purge-details')).toContainText(/Objects\d+ \(Model: \d+/);
  await shot('4-non-purgeable-details.png');
  await purge.getByRole('button', { name: 'Select Objects' }).click();
  await expect(purge).toBeHidden();
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    /\d+ found\./,
  );
  await shot('5-select-objects.png');
});
