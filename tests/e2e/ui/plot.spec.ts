// M2-17: the Plot dialog. Ctrl+P (or PLOT at the command line) opens it on the space shown; OK
// plots that space to a one-page PDF that downloads. The roadmap's acceptance: an A1 plot through
// a CTB is written in under 2 s. The PDF is read back with pdf.js in Node: its page is the paper
// chosen, it is labelled with the space, and it draws the drawing's paths.
//
// Part 2: the partial preview, the Window plot area (picked at PLOT's prompts with the dialog
// hidden, the other settings kept) and PUBLISH (every sheet into one PDF). The SVG and PNG
// plotters (M2-18) write the same plot as an SVG with the drawing's layers and as a PNG.
// Part 3: Esc at the window's corners reopens the dialog as it was; a layout opens on its page
// setup's plot style table and plot options; the drafter's own tables are listed.
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { decodePng } from '../../../packages/testkit/src/fidelity/compare';
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
import { CORPUS, startApp } from '../app/server';

const VIEWPORTS = path.join(CORPUS, 'ezdxf/examples_dxf/viewports.dxf');
const MONOCHROME_CTB = path.join(
  import.meta.dirname,
  '../../../assets/plotstyles/triya-monochrome.ctb',
);

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
  // The partial preview: Display fitted on the page setup's ANSI A landscape (part 4).
  const preview = d.getByRole('img', { name: /^Plot area / });
  await expect(preview).toHaveAttribute('aria-label', /on paper 279\.4 × 215\.9 mm$/);
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

test('Esc at the window’s corners brings the dialog back as it was (part 3)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const canvas = activeCanvas(page);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('Paper size').selectOption('ISO A3');
  await d.getByLabel('What to plot').selectOption('window');
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify first corner:');
  await canvas.press('Escape');
  // Back with the plot area it had (no window was picked) and the paper chosen.
  await expect(d).toBeVisible();
  await expect(d.getByLabel('What to plot')).toHaveValue('display');
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A3');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Specify first corner: *Cancel*',
  );
  // Esc after the first corner too.
  await d.getByLabel('What to plot').selectOption('window');
  await expect(prompt(page)).toHaveText('Specify first corner:');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await canvas.press('Escape');
  await expect(d).toBeVisible();
  await expect(d.getByLabel('What to plot')).toHaveValue('display');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});

test('a layout opens on its page setup’s plot style table and options; your own CTB is listed (part 3)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  // viewports.dxf's Layout1 names acad.ctb, with "Plot with plot styles", "Plot object
  // lineweights" and "Plot paperspace last" (DXF 70 = 672).
  await openWithPicker(page, VIEWPORTS);
  await expectShown(page, path.basename(VIEWPORTS));
  // A table of the drafter's own, dropped on the window (kept by Settings, M2-20 part 2).
  const ctb = test.info().outputPath('Office-Pens.ctb');
  copyFileSync(MONOCHROME_CTB, ctb);
  await openWithDrop(page, ctb);
  await expect(
    page.locator('.banner', { hasText: 'Added color-dependent plot style table Office-Pens.ctb.' }),
  ).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Layout1');
  const table = d.getByLabel('Plot style table');
  // AutoCAD's acad.ctb is answered by Triya's table of that meaning.
  await expect(table).toHaveValue('triya-default.ctb');
  await expect(d.getByLabel('Plot with plot styles')).toBeChecked();
  await expect(d.getByLabel('Plot paperspace last')).toBeChecked();
  await expect(d.getByLabel('Scale lineweights')).not.toBeChecked();
  await expect(table.getByRole('option')).toHaveText([
    'None',
    'triya-default.ctb',
    'triya-monochrome.ctb',
    'triya-grayscale.ctb',
    'Office-Pens.ctb',
  ]);
  await table.selectOption('Office-Pens.ctb');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(d).toBeHidden();
  const pdf = await readPdf(download);
  expect(pdf.labels).toEqual(['Layout1']);
  expect(pdf.paths).toBeGreaterThan(0);
});

// Part 4: the dialog opens on the whole page setup, and Apply to Layout writes it back.
test('model space opens on its page setup, and Apply to Layout saves the settings into it (part 4)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  // The sample's Model page setup: ANSI A in inches, landscape, Display, fitted, not centred.
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  await expect(d.getByLabel('Paper size')).toHaveValue('ANSI A');
  await expect(d.getByRole('radio', { name: 'Landscape' })).toBeChecked();
  await expect(d.getByLabel('What to plot')).toHaveValue('display');
  await expect(d.getByLabel('Fit to paper')).toBeChecked();
  await expect(d.getByLabel('Center the plot')).not.toBeChecked();
  await expect(d.getByLabel('inches =')).toBeDisabled();

  // A3 portrait, the extents at 1:2 (1 inch = 2 units in the page setup's inches), centred.
  await d.getByLabel('Paper size').selectOption('ISO A3');
  await d.getByRole('radio', { name: 'Portrait' }).check();
  await d.getByLabel('What to plot').selectOption('extents');
  await d.getByLabel('Fit to paper').uncheck();
  await d.getByLabel('Scale', { exact: true }).selectOption('1:2');
  await d.getByLabel('Center the plot').check();
  await d.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await d.getByRole('button', { name: 'Apply to Layout' }).click();
  await expect(d.getByRole('status')).toHaveText('Applied to the Model page setup.');
  // The drawing has a change to save.
  await expect(page.locator('.doc-tab[data-active="true"]')).toHaveAttribute('data-dirty', 'true');
  type Dev = { triyaDev: { layouts(): { name: string; plot?: Record<string, unknown> }[] } };
  const model = await page.evaluate(
    () => (window as unknown as Dev).triyaDev.layouts().find((l) => l.name === 'Model')!.plot!,
  );
  expect(model).toMatchObject({
    paperSize: 'ISO_full_bleed_A3_(297.00_x_420.00_MM)',
    paperWidth: 297,
    paperHeight: 420,
    rotation: 0,
    plotType: 1,
    scale: { numerator: 1, denominator: 2 },
    styleSheet: 'triya-monochrome.ctb',
  });
  expect((model.flags as number) & (16 | 4)).toBe(4);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();

  // PLOT again opens on the page setup as applied.
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A3');
  await expect(d.getByRole('radio', { name: 'Portrait' })).toBeChecked();
  await expect(d.getByLabel('What to plot')).toHaveValue('extents');
  await expect(d.getByLabel('Fit to paper')).not.toBeChecked();
  await expect(d.getByLabel('Scale', { exact: true })).toHaveValue('1:2');
  await expect(d.getByLabel('Center the plot')).toBeChecked();
  await expect(d.getByLabel('Plot style table')).toHaveValue('triya-monochrome.ctb');
  await d.getByRole('button', { name: 'Cancel' }).click();

  // U undoes it, as one step.
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('U');
  await input.press('Enter');
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  await expect(d.getByLabel('Paper size')).toHaveValue('ANSI A');
  await expect(d.getByLabel('Fit to paper')).toBeChecked();
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

// M2-18: the Triya SVG and Triya PNG plotters plot the same parts as the PDF one.
test('plots model space to an SVG with the drawing layers and to a PNG at a resolution', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByLabel('Name')).toHaveValue('pdf');
  await expect(d.getByLabel('Resolution')).toHaveCount(0);
  await d.getByLabel('Paper size').selectOption('ISO A4');
  await d.getByLabel('What to plot').selectOption('extents');

  await d.getByLabel('Name').selectOption('svg');
  await expect(d.getByLabel('Background')).toHaveValue('none');
  await expect(d.getByLabel('Resolution')).toHaveCount(0);
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(svgDownload.suggestedFilename()).toBe('sample_AC1018-Model.svg');
  const svg = readFileSync((await svgDownload.path())!, 'utf8');
  expect(svg).toContain('width="297mm" height="210mm"');
  const labels = new Set(
    [...svg.matchAll(/inkscape:groupmode="layer" inkscape:label="([^"]*)"/g)].map((m) => m[1]),
  );
  expect(labels.size).toBeGreaterThan(1);
  // The browser reads it as an SVG document with those layers at its top level.
  const layers = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return -1;
    return [...doc.documentElement.children].filter((e) => e.localName === 'g').length;
  }, svg);
  expect(layers).toBeGreaterThanOrEqual(labels.size);

  await page.keyboard.press('Control+p');
  await d.getByLabel('Paper size').selectOption('ISO A4');
  await d.getByLabel('What to plot').selectOption('extents');
  await d.getByLabel('Name').selectOption('png');
  await expect(d.getByLabel('Background')).toHaveValue('white');
  await d.getByLabel('Resolution').selectOption('96');
  await expect(d.getByLabel('Image size')).toHaveText('1123 × 794 pixels');
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  expect(pngDownload.suggestedFilename()).toBe('sample_AC1018-Model.png');
  const png = decodePng(new Uint8Array(readFileSync((await pngDownload.path())!)));
  expect([png.width, png.height]).toEqual([1123, 794]);
  let white = 0;
  let inked = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] === 255 && png.data[i + 1] === 255 && png.data[i + 2] === 255) white++;
    else if (png.data[i + 3] === 255) inked++;
  }
  // A white sheet with the drawing on it.
  expect(white).toBeGreaterThan(png.width * png.height * 0.5);
  expect(inked).toBeGreaterThan(1000);
});
