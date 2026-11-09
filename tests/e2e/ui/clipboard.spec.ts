// M2-14 part 2: objects copied in one open drawing and pasted into another, through the app's
// shared Clipboard, as a drafter does it: Ctrl+C in the drawing copied from, a click on the
// other drawing's tab, Ctrl+V and an insertion point typed at the prompt; then PASTEORIG.
// The commands' prompts and the paste's records, blocks and handles are unit-tested in
// packages/engine/test; this checks that the app carries the Clipboard between drawings.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DWG, DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The objects the showing drawing's edits added, by type, in order. */
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.entities?.added ?? [])
      .map((a) => a.entity.type),
  );

const prompt = (page: Page) => page.getByTestId('command-prompt');
const docTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Ctrl+C in one drawing and Ctrl+V in another pastes the objects there', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));

  // Nothing copied yet.
  await type(page, 'PASTECLIP', 'Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText('The Clipboard holds no objects to paste.');

  await docTabs(page).first().click();
  await expectShown(page, path.basename(DXF));
  await page.keyboard.press('Control+c');
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');
  // Copying changes nothing in the drawing copied from.
  expect(await added(page)).toEqual([]);

  await docTabs(page).nth(1).click();
  await expectShown(page, path.basename(DWG));
  await page.keyboard.press('Control+v');
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, '0,0', 'Command:');
  await expect.poll(() => added(page)).toEqual(['HATCH']);

  // PASTEORIG: at the objects' own coordinates, from another drawing only.
  await type(page, 'PASTEORIG', 'Command:');
  await expect.poll(() => added(page)).toEqual(['HATCH', 'HATCH']);
  await docTabs(page).first().click();
  await expectShown(page, path.basename(DXF));
  await type(page, 'PASTEORIG', 'Command:');
  await expect(log).toContainText('PASTEORIG pastes objects copied from another drawing only.');
  expect(await added(page)).toEqual([]);
});
