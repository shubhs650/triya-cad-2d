// M2-39 part 2: EXPORTPDF opens Save As PDF (Export: Display/Extents/Window in model space,
// Current layout/All layouts in a layout) and EXPORT (EXP) opens Export Data, whose Files of type
// picks a PDF, SVG or PNG plot or a DXF of the whole drawing. Window hides the dialog for the
// corners, as PLOT's Window< does. The DXF holds the drawing's unsaved changes and leaves the
// drawing's own file as it was.
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

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function readPdf(d: Download) {
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
  return pdfSummary(bytes);
}

async function command(page: Page, text: string): Promise<void> {
  const input = page.getByLabel('Command', { exact: true });
  await input.fill(text);
  await input.press('Enter');
}

test('EXPORTPDF exports a window of model space with its page setup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const canvas = activeCanvas(page);
  await canvas.click({ position: { x: 5, y: 5 } });
  await command(page, 'EXPORTPDF');
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  await expect(d).toBeVisible();
  // Save As PDF has no Files of type: it is a PDF.
  await expect(d.getByLabel('Files of type')).toHaveCount(0);
  await expect(d.getByLabel('File name')).toHaveValue('sample_AC1018-Model.pdf');
  const area = d.getByLabel('Export');
  await expect(area).toHaveValue('display');
  await expect(area.locator('option')).toHaveText(['Display', 'Extents', 'Window']);
  // Window goes straight to the corners, the dialog hidden; then it is back with the window.
  await area.selectOption('window');
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify first corner:');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Export')).toHaveValue('window');
  await expect(d.getByRole('button', { name: 'Window<' })).toBeVisible();
  await d.getByLabel('File name').fill('window');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(d).toBeHidden();
  // The type's extension is added to a name typed without one.
  expect(download.suggestedFilename()).toBe('window.pdf');
  const pdf = await readPdf(download);
  expect(pdf.pages).toBe(1);
  // The Model page setup's paper: ANSI A landscape.
  expect(pdf.width).toBeCloseTo(279.4, 1);
  expect(pdf.height).toBeCloseTo(215.9, 1);
  expect(pdf.labels).toEqual(['Model']);
  expect(pdf.paths).toBeGreaterThan(0);
  await expect(prompt(page)).toHaveText('Command:');
});

test('EXPORTPDF on a layout exports all layouts into one PDF', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const layouts = (await tabs.allTextContents()).slice(1).map((t) => t.trim());
  await tabs.nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await expect.poll(() => paperPixels(page), { timeout: 15_000 }).toBeGreaterThan(50_000);
  await command(page, 'EXPORTPDF');
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  const area = d.getByLabel('Export');
  await expect(area).toHaveValue('current');
  await expect(area.locator('option')).toHaveText(['Current layout', 'All layouts']);
  await expect(d.getByLabel('File name')).toHaveValue(`sample_AC1018-${layouts[0]}.pdf`);
  await area.selectOption('all');
  await expect(d.getByLabel('File name')).toHaveValue('sample_AC1018.pdf');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(download.suggestedFilename()).toBe('sample_AC1018.pdf');
  const pdf = await readPdf(download);
  expect(pdf.pages).toBe(layouts.length);
  expect(pdf.labels).toEqual(layouts);
});

test('EXP exports an SVG plot, and a DXF with the unsaved changes, by file type', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await command(page, 'EXP');
  const d = page.getByRole('dialog', { name: 'Export Data' });
  await expect(d).toBeVisible();
  const type = d.getByLabel('Files of type');
  await expect(type).toHaveValue('pdf');
  await expect(type.locator('option')).toHaveText([
    'PDF (*.pdf)',
    'SVG (*.svg)',
    'PNG (*.png)',
    'AutoCAD 2018 DXF (*.dxf)',
  ]);
  await type.selectOption('svg');
  await expect(d.getByLabel('File name')).toHaveValue('sample_AC1018-Model.svg');
  await d.getByLabel('Export').selectOption('extents');
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(svgDownload.suggestedFilename()).toBe('sample_AC1018-Model.svg');
  const svg = readFileSync((await svgDownload.path())!, 'utf8');
  expect(svg).toContain('inkscape:groupmode="layer"');

  // An unsaved change, then the drawing as a DXF: the change is in it, the drawing keeps its
  // own (DWG) file and its unsaved change.
  await command(page, 'LINE');
  await command(page, '0,0');
  await command(page, '12345.678,0');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await command(page, 'EXPORT');
  await expect(d).toBeVisible();
  await d.getByLabel('Files of type').selectOption('dxf');
  await expect(d.getByLabel('File name')).toHaveValue('sample_AC1018.dxf');
  // A DXF is the whole drawing: there is no area to export.
  await expect(d.getByLabel('Export')).toHaveCount(0);
  const [dxfDownload] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(dxfDownload.suggestedFilename()).toBe('sample_AC1018.dxf');
  const dxf = readFileSync((await dxfDownload.path())!, 'utf8');
  expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1032/);
  expect(dxf).toMatch(/\n\s*11\r?\n12345\.678/);
  await expectShown(page, path.basename(DWG));
  await expect(page.locator('.doc-tab[data-active="true"]')).toHaveAttribute('data-dirty', 'true');
});
