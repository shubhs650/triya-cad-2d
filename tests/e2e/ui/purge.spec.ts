// M5-09 part 1: -PURGE at the command line on sample_AC1032_ascii.dxf, which has layers,
// linetypes and blocks nothing uses. LAyers, Enter for every name, No to verifying: the unused
// layers go with AutoCAD's "Deleting layer" lines and a count, and a second run finds none.
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
