// M2-60: Save As PDF's Options... opens the PDF Options dialog (Data: Include layer information,
// Create bookmarks; Font Handling: Convert all text to geometry), and its choices reach the PDF.
// hatch_text_box_in_hole.dxf has an MTEXT ("TEXT" eight times) in the Standard style, whose
// font is arial.ttf: with a dropped TrueType file of that name it is text in an embedded font
// (as pwa.spec.ts plots it), and with text converted to geometry it is outlines and no font.
// Its objects are all on layer 0, so with layer information the PDF has one layer, "0".
// M2-74: "Include hyperlinks" links a line given a hyperlink in the Properties palette.
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  inkWeight,
  openWithDrop,
  openWithPicker,
  enterCommand,
} from '../app/page';
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
  await enterCommand(page, 'EXPORTPDF');
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  await expect(d).toBeVisible();
  // AutoCAD's General Documentation preset: layers, bookmarks and hyperlinks in, text as text.
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'Layers, bookmarks, hyperlinks; text as text',
  );
  await d.getByLabel('Export').selectOption('extents');
  const first = await saveAsPdf(page);
  expect(first.layers).toEqual([{ name: '0', visible: true }]);
  expect(first.bookmarks).toEqual(['Model']);
  expect(first.text).toBe(Array(8).fill('TEXT').join(' '));
  expect(first.fonts).toBe(true);

  await enterCommand(page, 'EXPORTPDF');
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
  await expect(options.getByLabel('Include hyperlinks')).toBeChecked();
  // Cancel (Esc) keeps what was there.
  await layers.uncheck();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  await expect(d).toBeVisible();
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'Layers, bookmarks, hyperlinks; text as text',
  );
  // OK hands the choices to the export.
  await d.getByRole('button', { name: 'Options...' }).click();
  await layers.uncheck();
  await bookmarks.uncheck();
  await geometry.check();
  await page.screenshot({ path: test.info().outputPath('pdf-options-dialog.png') });
  await options.getByRole('button', { name: 'OK' }).click();
  await expect(options).toBeHidden();
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'No layers, no bookmarks, hyperlinks; text as geometry',
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
  await enterCommand(page, 'EXPORTPDF');
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'No layers, no bookmarks, hyperlinks; text as geometry',
  );
  // Esc in Page Setup Override closes it alone too (it closed Save As PDF as well before).
  await d.getByRole('button', { name: 'Page Setup Override...' }).click();
  const override = page.getByRole('dialog', { name: 'Page Setup Override' });
  await expect(override).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(override).toBeHidden();
  await expect(d).toBeVisible();
});

// M2-74: a line with a hyperlink saved as PDF has a link over it with the option on, none off.
test('Save As PDF links a hyperlinked line with Include hyperlinks on, and not with it off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const prompt = page.getByTestId('command-prompt');
  const type = async (text: string, next: string | RegExp) => {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveText(next);
  };
  // A line under the plan's hatch (x -293 to -237, y 537 to 607) nearly as wide as it, so it
  // spans most of the page plotted to extents; the view is zoomed to it to pick it.
  await type('Z', /^Specify corner of window/);
  await type('-300,500', 'Specify opposite corner:');
  await type('-230,540', 'Command:');
  await type('L', 'Specify first point:');
  await type('-290,520', 'Specify next point or [Undo]:');
  await type('-240,520', 'Specify next point or [Undo]:');
  await type('', 'Command:');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await page.keyboard.press('Control+1');
  await expect(objects).toHaveText('No selection');
  await expectDrawn(page, { timeout: 15_000 });
  const docked = (await activeCanvas(page).boundingBox())!;
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(objects).toHaveText('Line (1)');
  const hyperlink = palette.getByRole('textbox', { name: 'Hyperlink' });
  await hyperlink.fill('https://openengtools.com/triya');
  await hyperlink.press('Enter');
  await expect(hyperlink).toHaveValue('https://openengtools.com/triya');

  await enterCommand(page, 'EXPORTPDF');
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  await expect(d).toBeVisible();
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'Layers, bookmarks, hyperlinks; text as text',
  );
  await d.getByLabel('Export').selectOption('extents');
  const on = await saveAsPdf(page);
  expect(on.links).toHaveLength(1);
  expect(on.links[0]!.url).toBe('https://openengtools.com/triya');
  // Over the line: much wider than tall.
  const [x0, y0, x1, y1] = on.links[0]!.rect as [number, number, number, number];
  expect(x1 - x0).toBeGreaterThan(5 * (y1 - y0));

  await enterCommand(page, 'EXPORTPDF');
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Options...' }).click();
  const options = page.getByRole('dialog', { name: 'PDF Options' });
  await options.getByLabel('Include hyperlinks').uncheck();
  await page.screenshot({ path: test.info().outputPath('pdf-options-hyperlinks.png') });
  await options.getByRole('button', { name: 'OK' }).click();
  await expect(d.getByTestId('pdf-options-note')).toHaveText(
    'Layers, bookmarks, no hyperlinks; text as text',
  );
  await d.getByLabel('Export').selectOption('extents');
  const off = await saveAsPdf(page);
  expect(off.links).toEqual([]);
});
