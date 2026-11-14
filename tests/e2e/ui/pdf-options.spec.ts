// M2-60: Save As PDF's Options... opens the PDF Options dialog (Data: Include layer information,
// Create bookmarks; Font Handling: Convert all text to geometry), and its choices reach the PDF.
// hatch_text_box_in_hole.dxf has an MTEXT ("TEXT" eight times) in the Standard style, whose
// font is arial.ttf: with a dropped TrueType file of that name it is text in an embedded font
// (as pwa.spec.ts plots it), and with text converted to geometry it is outlines and no font.
// Its objects are all on layer 0, so with layer information the PDF has one layer, "0".
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import { activeCanvas, expectShown, inkWeight, openWithDrop, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DRAWING = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_text_box_in_hole.dxf');
/** The ink weight the filled .notdef boxes add at least over the stroked stand-in. */
const FILLED = 400_000;

/** Zoom Extents, then the ink weight once two looks agree (the frame draws in a worker). */
async function settledWeight(page: Page): Promise<number> {
  await page
    .getByRole('toolbar', { name: 'Navigation' })
    .getByRole('button', { name: 'Zoom Extents', exact: true })
    .click();
  let last = -1;
  let now = await inkWeight(page);
  while (now !== last) {
    last = now;
    await page.waitForTimeout(250);
    now = await inkWeight(page);
  }
  return now;
}

async function command(page: Page, text: string): Promise<void> {
  const input = page.getByLabel('Command', { exact: true });
  // A fill made while the engine still reads the input before replaces that input's text,
  // whose Enter type-ahead holds (M2-71): -PLOT lost a `Y` in CI (#349). Wait for it.
  await expect(page.locator('[data-reading="true"]')).toHaveCount(0);
  await input.fill(text);
  await input.press('Enter');
}

async function readPdf(d: Download) {
  return pdfSummary(new Uint8Array(readFileSync((await d.path())!)));
}

async function saveAsPdf(page: Page) {
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(d).toBeHidden();
  return readPdf(download);
}

test('Save As PDF’s Options choose the PDF’s layers, bookmarks and text', async ({ page }) => {
  test.setTimeout(90_000);
  const font = test.info().outputPath('Arial.TTF');
  writeFileSync(font, fontBytes(testFont()));
  await page.goto(app.url);
  await openWithPicker(page, DRAWING);
  await expectShown(page, 'hatch_text_box_in_hole.dxf');
  const standIn = await settledWeight(page);
  await openWithDrop(page, font);
  await expect(page.getByRole('status')).toHaveText(/Added TrueType font Arial\.TTF\./);
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeGreaterThan(standIn + FILLED);

  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await command(page, 'EXPORTPDF');
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  await expect(d).toBeVisible();
  // AutoCAD's General Documentation preset: layers and bookmarks in, text as text.
  await expect(d.getByTestId('pdf-options-note')).toHaveText('Layers, bookmarks; text as text');
  await d.getByLabel('Export').selectOption('extents');
  const first = await saveAsPdf(page);
  expect(first.layers).toEqual([{ name: '0', visible: true }]);
  expect(first.bookmarks).toEqual(['Model']);
  expect(first.text).toBe(Array(8).fill('TEXT').join(' '));
  expect(first.fonts).toBe(true);

  await command(page, 'EXPORTPDF');
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Options...' }).click();
  const options = page.getByRole('dialog', { name: 'PDF Options' });
  await expect(options).toBeVisible();
  await expect(options.getByRole('group', { name: 'Data' })).toBeVisible();
  const layers = options.getByLabel('Include layer information');
  const bookmarks = options.getByLabel('Create bookmarks');
  const geometry = options.getByLabel('Convert all text to geometry');
  await expect(layers).toBeChecked();
  await expect(bookmarks).toBeChecked();
  await expect(geometry).not.toBeChecked();
  // Cancel (Esc) keeps what was there.
  await layers.uncheck();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  await expect(d).toBeVisible();
  await expect(d.getByTestId('pdf-options-note')).toHaveText('Layers, bookmarks; text as text');
  // OK hands the choices to the export.
  await d.getByRole('button', { name: 'Options...' }).click();
  await layers.uncheck();
  await bookmarks.uncheck();
  await geometry.check();
  await page.screenshot({ path: test.info().outputPath('pdf-options-dialog.png') });
  await options.getByRole('button', { name: 'OK' }).click();
  await expect(options).toBeHidden();
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'No layers, no bookmarks; text as geometry',
  );
  await page.screenshot({ path: test.info().outputPath('save-as-pdf-options.png') });
  await d.getByLabel('Export').selectOption('extents');
  const second = await saveAsPdf(page);
  expect(second.layers).toEqual([]);
  expect(second.bookmarks).toEqual([]);
  expect(second.text).toBe('');
  expect(second.fonts).toBe(false);
  // Same page as before: the outlines are drawn where the text was.
  expect(second.paths).toBeGreaterThan(first.paths);

  // The choices stay for the session.
  await command(page, 'EXPORTPDF');
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'No layers, no bookmarks; text as geometry',
  );
  // Esc in Page Setup Override closes it alone too (it closed Save As PDF as well before).
  await d.getByRole('button', { name: 'Page Setup Override...' }).click();
  const override = page.getByRole('dialog', { name: 'Page Setup Override' });
  await expect(override).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(override).toBeHidden();
  await expect(d).toBeVisible();
});
