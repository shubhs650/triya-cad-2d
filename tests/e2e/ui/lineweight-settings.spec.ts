// M5-08 part 3: LWEIGHT's Lineweight Settings. clockwise_arcs_hatch.dxf has
// Default lineweights on its layers and opens with LWDISPLAY off and CELWEIGHT ByLayer; the test
// draws red lines on layer 0 first (their lineweight ByLayer, so Default), and zooms to them.
// - the list offers ByLayer, ByBlock, Default and the lineweights, in millimetres or inches;
// - Apply & Close makes the lineweight chosen current (one LWEIGHT step), keeps LWUNITS and
//   LWDEFAULT, turns LWT on, and the canvas draws Default at the new LWDEFAULT, wider again at a
//   larger Adjust Display Scale;
// - Cancel changes nothing; -LWEIGHT reports in the units chosen.
import { expect, test, type Page } from '@playwright/test';
import {
  DXF,
  enterCommand,
  expectDrawn,
  expectShown,
  inkWeight,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Lineweight Settings' });
const options = (page: Page) => dialog(page).getByRole('listbox').getByRole('option');
const option = (page: Page, name: string) =>
  options(page).filter({ has: page.getByText(name, { exact: true }) });
const lwt = (page: Page) =>
  page.getByRole('contentinfo').getByRole('button', { name: 'LWT', exact: true });
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

test('Lineweight Settings sets the current lineweight, LWUNITS, LWDEFAULT and LWT (M5-08)', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'clockwise_arcs_hatch.dxf');
  await expectDrawn(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await expect(lwt(page)).toHaveAttribute('aria-pressed', 'false');
  await enterCommand(page, 'CECOLOR');
  await enterCommand(page, '1');
  for (const [a, b] of [
    ['-290,-40', '330,-40'],
    ['-290,-120', '330,-120'],
    ['-290,40', '330,40'],
  ]) {
    await enterCommand(page, 'LINE');
    await enterCommand(page, a!);
    await enterCommand(page, b!);
    await enterCommand(page, '');
  }
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'E');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');
  await expectDrawn(page);
  const thin = await inkWeight(page);

  // Cancel changes nothing.
  await enterCommand(page, 'LW');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeHidden();

  await enterCommand(page, 'LWEIGHT');
  await expect(options(page)).toHaveCount(27);
  await expect(options(page).first()).toHaveText('ByLayer');
  await expect(option(page, 'ByLayer')).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'Default (0.25 mm)')).toBeVisible();
  await expect(dialog(page)).toContainText('Current Lineweight: ByLayer');
  await expect(dialog(page).getByLabel('Millimeters (mm)')).toBeChecked();
  await expect(dialog(page).getByLabel('Display Lineweight')).not.toBeChecked();

  // The arrow keys move through the list; a click picks.
  await dialog(page).getByRole('listbox').focus();
  await page.keyboard.press('ArrowDown');
  await expect(option(page, 'ByBlock')).toHaveAttribute('aria-selected', 'true');
  await option(page, '0.50 mm').click();
  await expect(dialog(page)).toContainText('Current Lineweight: 0.50 mm');

  // Inches, Display Lineweight, Default 2.11 mm.
  await dialog(page).getByLabel('Inches (in)').check();
  await expect(option(page, '0.020"')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog(page)).toContainText('Current Lineweight: 0.020"');
  await dialog(page).getByLabel('Display Lineweight').check();
  await dialog(page).getByLabel('Default', { exact: true }).selectOption({ label: '0.083"' });
  await expect(option(page, 'Default (0.083")')).toBeVisible();
  await shot('1-lineweight-settings.png');
  await dialog(page).getByRole('button', { name: 'Apply & Close' }).click();
  await expect(dialog(page)).toBeHidden();

  // LWT is on and Default draws at 2.11 mm.
  await expect(lwt(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => inkWeight(page)).toBeGreaterThan(thin * 1.1);
  const wide = await inkWeight(page);
  await shot('2-default-at-2.11-mm.png');

  // -LWEIGHT reports the current lineweight in inches; SETVAR shows the user's LWDEFAULT.
  await enterCommand(page, '-LWEIGHT');
  await expect(history(page)).toContainText('Current lineweight: 0.020"');
  await page.keyboard.press('Escape');
  await enterCommand(page, 'LWDEFAULT');
  await expect(page.getByTestId('command-prompt')).toContainText('<211>');
  await page.keyboard.press('Escape');

  // A larger display scale draws Model-tab lines wider still.
  await enterCommand(page, 'LWEIGHT');
  await expect(option(page, '0.020"')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog(page).getByLabel('Inches (in)')).toBeChecked();
  await dialog(page).getByLabel('Adjust Display Scale').fill('2');
  await dialog(page).getByRole('button', { name: 'Apply & Close' }).click();
  await expect.poll(() => inkWeight(page)).toBeGreaterThan(wide * 1.1);
  await shot('3-display-scale-2.png');

  // The lineweight change is one LWEIGHT undo step.
  await enterCommand(page, 'U');
  await expect(history(page)).toContainText('LWEIGHT');
});
