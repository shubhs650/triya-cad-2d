// M5-08 part 5:
// - LWUNITS 0 lists lineweights in inches in the Properties palette's Lineweight list (Quick
//   Properties shows the same rows) and in the Layer Properties Manager's Lineweight column and
//   Lineweight dialog, as AutoCAD 2024's Help says ("LWUNITS": "Controls whether lineweight
//   units are displayed in inches or millimeters").
// - Upright (U=) text in a complex linetype is drawn upright: TRIYA_GAS on lines drawn left to
//   right, right to left, down and up reads left to right and bottom to top on all of them
//   (screenshot; the geometry is unit tested in packages/render).
// clockwise_arcs_hatch.dxf has a Standard text style and Default lineweights on its layers.
import { expect, test } from '@playwright/test';
import { DXF, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('LWUNITS lists lineweights in inches; upright linetype text reads upright (M5-08)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await expectDrawn(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  // TRIYA_GAS (bundled, "GAS" upright in a gap) loaded and made current with -LINETYPE.
  await enterCommand(page, '-LINETYPE');
  await enterCommand(page, 'L');
  await enterCommand(page, 'TRIYA_GAS');
  await enterCommand(page, 'triya-utilities.lin');
  await enterCommand(page, 'S');
  await enterCommand(page, 'TRIYA_GAS');
  await enterCommand(page, '');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');
  await enterCommand(page, 'CECOLOR');
  await enterCommand(page, '1');
  for (const [a, b] of [
    ['0,400', '#120,400'], // left to right
    ['120,370', '#0,370'], // right to left
    ['160,440', '#160,320'], // down
    ['190,320', '#190,440'], // up
  ]) {
    await enterCommand(page, 'LINE');
    await enterCommand(page, a!);
    await enterCommand(page, b!);
    await enterCommand(page, '');
  }
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'W');
  await enterCommand(page, '-20,300');
  await enterCommand(page, '#220,460');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');
  await expectDrawn(page);
  await page.mouse.move(400, 500);
  await shot('1-upright-gas-text.png');

  // Properties with nothing selected: the current lineweight's list, in millimetres...
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  const weight = palette.getByRole('table', { name: 'General' }).getByRole('combobox', {
    name: 'Lineweight',
  });
  await expect(weight.locator('option', { hasText: '0.30 mm' })).toHaveCount(1);
  // ...and in inches once LWUNITS is 0.
  await enterCommand(page, 'LWUNITS');
  await enterCommand(page, '0');
  await expect(weight.locator('option', { hasText: '0.30 mm' })).toHaveCount(0);
  await expect(weight.locator('option', { hasText: '0.012"' })).toHaveCount(1);
  await weight.selectOption({ label: '0.020"' });
  await expect(weight).toHaveValue('50');
  await expect(weight.locator('option:checked')).toHaveText('0.020"');
  await shot('2-properties-lineweight-inches.png');
  await page.keyboard.press('Control+1');

  // The Layer Properties Manager: its Lineweight dialog and column in inches too.
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const layers = page.getByRole('complementary', { name: 'Layers' });
  await expect(layers).toBeVisible();
  await layers.getByRole('button', { name: 'Lineweight 0' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lineweight' });
  await expect(dialog.getByText('Original: Default')).toBeVisible();
  await dialog.getByRole('listbox', { name: 'Lineweights' }).selectOption('0.031"');
  await expect(dialog.getByText('New: 0.031"')).toBeVisible();
  await shot('3-layer-lineweight-dialog-inches.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(layers.getByRole('button', { name: 'Lineweight 0' })).toHaveText('0.031"');

  // LWUNITS 1: millimetres again, in the column at once.
  await enterCommand(page, 'LWUNITS');
  await enterCommand(page, '1');
  await expect(layers.getByRole('button', { name: 'Lineweight 0' })).toHaveText('0.80 mm');
  await shot('4-layer-column-millimetres.png');
});
