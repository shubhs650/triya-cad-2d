// M2-35 part 4: the Properties palette's "Select Color..." opens AutoCAD's Select Color dialog
// (AutoCAD 2024 Help, "Select Color Dialog Box"). On the acadsharp AC1032 sample, one of whose
// circles uses a colour-book colour (RAL CLASSIC$RAL 1006), the drafter gives every
// circle a colour from each tab, then types one in the Color field; with nothing selected the
// dialog sets the current colour, index colours only. The colour parsing and the sheet's books
// are unit-tested (apps/web/test/select-color.test.ts, packages/engine/test/properties).
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.resolve('corpus/public/third-party/acadsharp/sample_AC1032_ascii.dxf');

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function open(page: Page) {
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  return palette;
}

test('gives the selected circles a colour from each tab of Select Color', async ({ page }) => {
  test.setTimeout(120_000);
  const palette = await open(page);
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/^All \(\d+\)/);
  const circles = await objects.locator('option', { hasText: /^Circle \(\d+\)$/ }).textContent();
  await objects.selectOption({ label: circles! });
  const color = palette.getByRole('combobox', { name: 'Color' });
  const dialog = page.getByRole('dialog', { name: 'Select Color' });
  const field = dialog.getByRole('textbox', { name: 'Color' });
  const tab = (name: string) => dialog.getByRole('tab', { name });

  // Color Books: the books the drawing uses, each with the colours of it the drawing uses.
  await color.selectOption({ label: 'Select Color...' });
  await expect(dialog).toBeVisible();
  // The circles' colours differ: the dialog opens on Index Color with nothing chosen.
  await expect(tab('Index Color')).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveValue('');
  await tab('Color Books').click();
  const book = dialog.getByRole('combobox', { name: 'Color book:' });
  // A circle's RAL CLASSIC$RAL 1006 and its layer Layer_color_book's DIC COLOR GUIDE(R)$DIC 7
  // (LAYER 430, read since M2-35 part 19), the books in name order.
  await expect(book.locator('option')).toHaveText(['DIC COLOR GUIDE(R)', 'RAL CLASSIC']);
  await expect(dialog.getByRole('list', { name: 'Colors' }).getByRole('button')).toHaveText([
    /^DIC 7RGB 252,193,135$/,
  ]);
  await book.selectOption('RAL CLASSIC');
  await dialog.getByRole('button', { name: /RAL 1006/ }).click();
  await expect(field).toHaveValue('RAL CLASSIC$RAL 1006');
  await page.screenshot({ path: test.info().outputPath('1-color-books.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(color).toHaveValue(/^rgb:\d+,\d+,\d+;RAL CLASSIC;RAL 1006$/);
  await expect(color.locator('option:checked')).toHaveText('RAL CLASSIC$RAL 1006');

  // Index Color: it opens on the book's tab, as the colour is a book's; a swatch reads its index.
  await color.selectOption({ label: 'Select Color...' });
  await expect(tab('Color Books')).toHaveAttribute('aria-selected', 'true');
  await tab('Index Color').click();
  const swatch = dialog.getByRole('gridcell', { name: 'Index color 142', exact: true });
  await swatch.hover();
  await expect(dialog.getByTestId('aci-info')).toHaveText(
    /^Index color: 142\s+Red, Green, Blue: \d+,\d+,\d+$/,
  );
  await swatch.click();
  await expect(field).toHaveValue('142');
  await page.screenshot({ path: test.info().outputPath('2-index-color.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(color).toHaveValue('aci:142');

  // The keyboard: the chosen swatch is the grid's tab stop and the arrow keys move from it.
  await color.selectOption({ label: 'Select Color...' });
  await expect(swatch).toHaveAttribute('aria-selected', 'true');
  await swatch.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(field).toHaveValue('152');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(color).toHaveValue('aci:142');

  // True Color, by RGB.
  await color.selectOption({ label: 'Select Color...' });
  await tab('True Color').click();
  await dialog.getByRole('combobox', { name: 'Color model:' }).selectOption('RGB');
  for (const [name, v] of [
    ['Red:', '12'],
    ['Green:', '34'],
    ['Blue:', '56'],
  ] as const) {
    await dialog.getByRole('spinbutton', { name }).fill(v);
  }
  await expect(field).toHaveValue('12,34,56');
  await expect(dialog.getByText('True color stored as RGB: 12,34,56')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('3-true-color.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(color).toHaveValue('rgb:12,34,56');

  // The Color field: a name, Enter for OK; what is not a colour is refused in the dialog.
  await color.selectOption({ label: 'Select Color...' });
  await expect(tab('True Color')).toHaveAttribute('aria-selected', 'true');
  await field.fill('purple');
  await field.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('Invalid color.');
  await expect(dialog).toBeVisible();
  await field.fill('blue');
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(color).toHaveValue('aci:5');

  // Each colour was one undo step.
  await activeCanvas(page).hover();
  await page.keyboard.type('U');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  // U leaves nothing selected; the circles, picked again, have the true colour back.
  await expect(objects).toHaveText('No selection');
  await page.keyboard.press('Control+a');
  await objects.selectOption({ label: circles! });
  await expect(color).toHaveValue('rgb:12,34,56');
});

test('sets the current colour with Select Color, index colours only', async ({ page }) => {
  test.setTimeout(120_000);
  const palette = await open(page);
  const color = palette.getByRole('combobox', { name: 'Color' });
  const dialog = page.getByRole('dialog', { name: 'Select Color' });
  const field = dialog.getByRole('textbox', { name: 'Color' });
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'No selection',
  );
  await color.selectOption({ label: 'Select Color...' });
  await expect(dialog).toBeVisible();
  // CECOLOR holds no true colour in DXF: only Index Color is offered.
  await expect(dialog.getByRole('tab', { name: 'True Color' })).toBeDisabled();
  await expect(dialog.getByRole('tab', { name: 'Color Books' })).toBeDisabled();
  await field.fill('1,2,3');
  await field.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText(
    'The current color takes an index color only.',
  );
  await dialog.getByRole('button', { name: 'ByBlock' }).click();
  await expect(field).toHaveValue('ByBlock');
  await dialog.getByRole('gridcell', { name: 'Index color 30', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('4-current-color.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(color).toHaveValue('aci:30');
  await expect(color.locator('option:checked')).toHaveText('Color 30');
});
