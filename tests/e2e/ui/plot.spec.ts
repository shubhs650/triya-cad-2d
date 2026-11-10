// M2-17: the Plot dialog. Ctrl+P (or PLOT at the command line) opens it on the space shown; OK
// plots that space to a one-page PDF that downloads. The roadmap's acceptance: an A1 plot through
// a CTB is written in under 2 s. The PDF is read back with pdf.js in Node: its page is the paper
// chosen, it is labelled with the space, and it draws the drawing's paths.
//
// Part 2: the partial preview, the Window plot area (picked at PLOT's prompts with the dialog
// hidden, the other settings kept) and PUBLISH (every sheet into one PDF).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import {
  DWG,
  activeCanvas,
  expectShown,
  ink,
  openWithDrop,
  openWithPicker,
  paperPixels,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Plot - / });

/** The downloaded PDF, as pdf.js reads it. */
async function readPdf(d: Download) {
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
  return pdfSummary(bytes);
}

test('Ctrl+P plots model space on A1 through a CTB in under 2 s', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  // AutoCAD's defaults for model space: Display, fitted and centred.
  await expect(d.getByLabel('What to plot')).toHaveValue('display');
  await expect(d.getByLabel('Fit to paper')).toBeChecked();
  await d.getByLabel('Paper size').selectOption('ISO A1');
  await d.getByLabel('What to plot').selectOption('extents');
  await d.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await d.getByRole('radio', { name: 'Landscape' }).check();

  const started = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(2000);
  await expect(d).toBeHidden();
  expect(download.suggestedFilename()).toBe('sample_AC1018-Model.pdf');
  const pdf = await readPdf(download);
  expect(pdf.pages).toBe(1);
  expect(pdf.width).toBeCloseTo(841, 2);
  expect(pdf.height).toBeCloseTo(594, 2);
  expect(pdf.labels).toEqual(['Model']);
  expect(pdf.paths).toBeGreaterThan(10);
});

test('PLOT on a layout plots its sheet on the paper of its page setup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await expect.poll(() => paperPixels(page), { timeout: 15_000 }).toBeGreaterThan(50_000);
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PLOT');
  await input.press('Enter');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Layout1');
  await expect(d.getByLabel('What to plot')).toHaveValue('layout');
  await expect(d.getByLabel('Fit to paper')).not.toBeChecked();
  // The sample's page setup is in inches at 1:1.
  await expect(d.getByLabel('Scale', { exact: true })).toHaveValue('1:1');
  await expect(d.getByLabel('inches =')).toHaveValue('1');
  const paper = await d.getByLabel('Paper size').locator('option:checked').textContent();
  expect(paper).toMatch(/^Layout paper \(/);
  const [w, h] = paper!.match(/[\d.]+/g)!.map(Number);
  // Cancel closes without plotting; Esc too.
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await input.fill('PRINT');
  await input.press('Enter');
  await expect(d).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  const pdf = await readPdf(download);
  expect(pdf.width).toBeCloseTo(w!, 0);
  expect(pdf.height).toBeCloseTo(h!, 0);
  expect(pdf.labels).toEqual(['Layout1']);
  expect(pdf.paths).toBeGreaterThan(10);
});

// M2-16 part 5: a PDF underlay plots its page's own content from the file the user dropped.
test('a PDF underlay plots its page as vectors and text once its file is supplied', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixtures = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
  await page.goto(app.url);
  await openWithPicker(page, path.join(fixtures, 'pdf-underlay.dxf'));
  await expectShown(page, 'pdf-underlay.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(50);
  await openWithDrop(page, path.join(fixtures, 'pdf-underlay.pdf'));
  await expectShown(page, 'pdf-underlay.dxf');
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  await d.getByLabel('What to plot').selectOption('extents');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  const pdf = await readPdf(download);
  // Both underlays' pages are forms; page 1's Helvetica text is still text.
  expect(pdf.forms).toBe(2);
  expect(pdf.text).toContain('TRIYA');
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

test('Window< hides the dialog, takes two corners and plots that window', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const canvas = activeCanvas(page);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d).toBeVisible();
  // The partial preview: Display fitted and centred on A4 landscape, on the paper.
  const preview = d.getByRole('img', { name: /^Plot area / });
  await expect(preview).toHaveAttribute('aria-label', /on paper 297 × 210 mm$/);
  await d.getByLabel('Paper size').selectOption('ISO A3');
  await expect(preview).toHaveAttribute('aria-label', /on paper 420 × 297 mm$/);
  // Window with none picked yet goes straight to the corners, as in AutoCAD.
  await d.getByLabel('What to plot').selectOption('window');
  await expect(d).toBeHidden();
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Specify window for printing',
  );
  await expect(prompt(page)).toHaveText('Specify first corner:');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await expect(d).toBeVisible();
  // Back with the window and the paper chosen before.
  await expect(d.getByLabel('What to plot')).toHaveValue('window');
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A3');
  await expect(d.getByRole('button', { name: 'Window<' })).toBeVisible();
  // Not to scale off the paper: the preview marks it.
  await d.getByLabel('Fit to paper').uncheck();
  await d.getByLabel('Scale', { exact: true }).selectOption('10:1');
  await expect(preview).toHaveAttribute('data-off-paper', 'true');
  await d.getByLabel('Fit to paper').check();
  await expect(preview).toHaveAttribute('data-off-paper', 'false');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(d).toBeHidden();
  const pdf = await readPdf(download);
  expect(pdf.width).toBeCloseTo(420, 2);
  expect(pdf.height).toBeCloseTo(297, 2);
  expect(pdf.paths).toBeGreaterThan(0);
  // PLOT is over once the dialog closes.
  await expect(prompt(page)).toHaveText('Command:');
});

test('PUBLISH writes every sheet of the drawing into one PDF', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const spaces = await tabs.allTextContents();
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PUBLISH');
  await input.press('Enter');
  const d = page.getByRole('dialog', { name: 'Publish' });
  await expect(d).toBeVisible();
  const rows = d.getByRole('table', { name: 'Sheets to publish' }).getByRole('checkbox');
  await expect(rows).toHaveCount(spaces.length);
  await expect(rows.first()).toHaveAccessibleName('sample_AC1018-Model');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Publish' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(download.suggestedFilename()).toBe('sample_AC1018.pdf');
  const pdf = await readPdf(download);
  expect(pdf.pages).toBe(spaces.length);
  expect(pdf.labels).toEqual(spaces.map((s) => s.trim()));
});
