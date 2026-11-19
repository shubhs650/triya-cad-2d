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
  'Enter an option [?/Make/Set/New/Rename/ON/OFF/Color/Ltype/LWeight/TRansparency/Plot/Freeze/Thaw/LOck/Unlock/stAte/Description/Xref]:';

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
