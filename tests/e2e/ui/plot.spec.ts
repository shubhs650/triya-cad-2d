// M2-17: the Plot dialog. Ctrl+P (or PLOT at the command line) opens it on the space shown; OK
// plots that space to a one-page PDF that downloads. The roadmap's acceptance: an A1 plot through
// a CTB is written in under 2 s. The PDF is read back with pdf.js in Node: its page is the paper
// chosen, it is labelled with the space, and it draws the drawing's paths.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { DWG, activeCanvas, expectShown, openWithPicker, paperPixels } from '../app/page';
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
