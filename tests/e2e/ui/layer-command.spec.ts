// M5-18: LAYER (LA) opens the Layer Properties Manager and LAYERCLOSE closes it; -LAYER's Make
// makes a layer at the command line, which the palette lists as current at once.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const OPTIONS =
  'Enter an option [?/Make/Set/New/Rename/ON/OFF/Color/Ltype/LWeight/TRansparency/Plot/Freeze/Thaw/LOck/Unlock/stAte/Description/rEconcile/Xref]:';

test('LA opens the Layer Properties Manager, -LAYER Make adds a layer, LAYERCLOSE closes it', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeHidden();

  await enterCommand(page, 'LA');
  await expect(palette).toBeVisible();
  await expect(prompt(page)).toHaveText('Command:');

  await enterCommand(page, '-LAYER');
  await expect(prompt(page)).toHaveText(OPTIONS);
  await enterCommand(page, 'M');
  await expect(prompt(page)).toHaveText(
    /^Enter name for new layer \(becomes the current layer\) <.*>:$/,
  );
  await enterCommand(page, 'M5-18-STAIRS');
  await expect(prompt(page)).toHaveText(OPTIONS);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Command:');
  const row = palette
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'M5-18-STAIRS', exact: true }) });
  await expect(row).toHaveAttribute('data-current', 'true');

  await enterCommand(page, 'LAYERCLOSE');
  await expect(palette).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});

// M5-18 part 3: -LAYER stAte EXport downloads `<name>.las` and keeps it with the layer state
// files Settings lists; Import finds it there by name and brings the state back.
test('-LAYER stAte EXport downloads a .las and Import reads it back by name', async ({ page }) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const STATE = 'Enter an option [?/Save/Restore/Edit/Name/Delete/Import/EXport]:';

  await enterCommand(page, '-LAYER');
  await enterCommand(page, 'A');
  await expect(prompt(page)).toHaveText(STATE);
  await enterCommand(page, 'S');
  await enterCommand(page, 'M5-18-PLAN');
  await expect(prompt(page)).toHaveText(/^Enter states to change \[/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText(STATE);
  await enterCommand(page, 'EX');
  await enterCommand(page, 'M5-18-PLAN');
  await expect(prompt(page)).toHaveText('Enter file name <M5-18-PLAN.las>:');
  const downloading = page.waitForEvent('download');
  await enterCommand(page, '');
  expect((await downloading).suggestedFilename()).toBe('M5-18-PLAN.las');
  await expect(log).toContainText('Layer state "M5-18-PLAN" exported to M5-18-PLAN.las.');
  await expect(prompt(page)).toHaveText(STATE);

  await enterCommand(page, 'D');
  await enterCommand(page, 'M5-18-PLAN');
  await expect(prompt(page)).toHaveText(STATE);
  await enterCommand(page, 'I');
  await expect(prompt(page)).toHaveText('Enter file name to import:');
  await enterCommand(page, 'm5-18-plan');
  await expect(log).toContainText('Layer state "M5-18-PLAN" imported.');
  await expect(prompt(page)).toHaveText(STATE);
  await enterCommand(page, '');
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Command:');

  // Settings lists the file EXport kept.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('list', { name: 'Layer state files' })).toContainText(
    'M5-18-PLAN.las',
  );
});
