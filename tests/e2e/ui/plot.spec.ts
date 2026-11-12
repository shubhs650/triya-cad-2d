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
// Part 5: -PLOT asks for the plot at the command line and plots it without the dialog.
// Part 6: named page setups (page-setups.dxf, authored by packages/testkit/src/page-setups) in
// the Plot dialog, -PLOT and PUBLISH, which publishes the sheets of every open drawing and its log.
// M2-39: the SVG and PNG plotters draw a PDF underlay's page as the PDF plot does.
// M2-41: while the dialog is up, the prompt line and Dynamic Input show no prompt (the click that
// focuses the canvas starts a selection window whose corner prompt Ctrl+P leaves behind).
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { compareImages, decodePng } from '../../../packages/testkit/src/fidelity/compare';
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
import { rasterisePdf } from '../app/pdf-raster';
import { CORPUS, startApp } from '../app/server';
import { unzip } from '../app/zip';

const VIEWPORTS = path.join(CORPUS, 'ezdxf/examples_dxf/viewports.dxf');
const PAGE_SETUPS = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/page-setups/page-setups.dxf',
);
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

// M2-39: the PNG plot shows the underlays' pages as the PDF plot does (pdf.js draws the PDF over
// the same sheet at the PNG's pixels), and the SVG carries each page as an image.
test('SVG and PNG plots draw a PDF underlay’s page as the PDF plot does', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const fixtures = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
  await page.goto(app.url);
  await openWithPicker(page, path.join(fixtures, 'pdf-underlay.dxf'));
  await expectShown(page, 'pdf-underlay.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(50);
  const bare = await ink(page);
  await openWithDrop(page, path.join(fixtures, 'pdf-underlay.pdf'));
  await expectShown(page, 'pdf-underlay.dxf');
  // The pages drawn on screen, so the session knows their size (the extents take it in).
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(bare + 1000);
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  const d = dialog(page);
  const plot = async (device: 'pdf' | 'svg' | 'png') => {
    await page.keyboard.press('Control+p');
    await d.getByLabel('Name').selectOption(device);
    await d.getByLabel('Paper size').selectOption('ISO A4');
    await d.getByLabel('What to plot').selectOption('extents');
    if (device === 'png') {
      await d.getByLabel('Background').selectOption('white');
      await d.getByLabel('Resolution').selectOption('96');
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      d.getByRole('button', { name: 'OK' }).click(),
    ]);
    await expect(d).toBeHidden();
    return download;
  };
  const pdf = await plot('pdf');
  const svg = readFileSync((await (await plot('svg')).path())!, 'utf8');
  // Both underlays' pages, each a PNG image in the SVG.
  expect(
    svg.match(
      /<image width="\d+" height="\d+" preserveAspectRatio="none" transform="matrix\([^)]*\)" xlink:href="data:image\/png;base64,/g,
    ),
  ).toHaveLength(2);
  const png = decodePng(new Uint8Array(readFileSync((await (await plot('png')).path())!)));
  expect([png.width, png.height]).toEqual([1123, 794]);
  const shown = await rasterisePdf(context, pdf, [0, 0, 297, 210], png);
  const c = compareImages(png, shown, { pixelMismatch: 2, ssim: 0.95 });
  if (c.diffPng)
    await info.attach('diff.png', { body: Buffer.from(c.diffPng), contentType: 'image/png' });
  expect(c.reason ?? '', `mismatch ${c.mismatchPct} %, SSIM ${c.ssim}`).toBe('');
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** No prompt shows while the dialog is up (M2-41): neither the prompt line nor Dynamic Input. */
async function expectNoPrompt(page: Page) {
  await expect(prompt(page)).toHaveText('');
  await expect(page.getByTestId('dyn')).toBeHidden();
}

test('Window< hides the dialog, takes two corners and plots that window', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const canvas = activeCanvas(page);
  await canvas.click({ position: { x: 5, y: 5 } });
  // The click on nothing started a selection window (M2-41's stale prompt came from it).
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expectNoPrompt(page);
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
  await expectNoPrompt(page);
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
  await expectNoPrompt(page);
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
  // Not the "Specify opposite corner:" the Esc answered (M2-41).
  await expectNoPrompt(page);
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

test('-PLOT plots at the command line without the dialog (part 5)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const input = page.getByLabel('Command', { exact: true });
  const prompt = page.getByTestId('command-prompt');
  const type = async (text: string) => {
    await input.fill(text);
    await input.press('Enter');
  };

  // Every default: the space shown, its page setup, the PDF plotter, the file named after it.
  await type('-PLOT');
  await expect(prompt).toHaveText('Detailed plot configuration? [Yes/No] <No>:');
  await type('');
  await expect(prompt).toHaveText('Enter a layout name or [?] <Model>:');
  await type('?');
  await type('');
  await expect(prompt).toHaveText('Enter a page setup name <>:');
  await type('');
  await type('svg');
  await expect(prompt).toHaveText('Enter file name <sample_AC1018-Model.svg>:');
  await type('');
  await type('');
  const [svg] = await Promise.all([page.waitForEvent('download'), type('')]);
  expect(svg.suggestedFilename()).toBe('sample_AC1018-Model.svg');
  await expect(dialog(page)).toBeHidden();
  const svgText = readFileSync((await svg.path())!, 'utf8');
  expect(svgText).toContain('<svg');

  // The detailed configuration of a layout not shown, saved into its page setup.
  await type('-PLOT');
  await type('Y');
  await type('?');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('MyLayout');
  await type('Layout1');
  await expect(prompt).toHaveText(/^Enter an output device name or \[\?\] <Triya PDF/);
  for (const answer of ['', '', '', '', '', '']) await type(answer);
  await expect(prompt).toHaveText(
    'Enter plot scale (Plotted Inches=Drawing Units) or [Fit] <1=1>:',
  );
  await type('');
  await type('');
  await type('');
  await expect(prompt).toHaveText(/^Enter plot style table name \(enter \. for none\) or \[\?\] </);
  await type('triya-monochrome.ctb');
  for (const answer of ['', '', '', '']) await type(answer);
  await expect(prompt).toHaveText('Enter file name <sample_AC1018-Layout1.pdf>:');
  await type('Sheet A');
  await type('Y');
  const [pdf] = await Promise.all([page.waitForEvent('download'), type('')]);
  expect(pdf.suggestedFilename()).toBe('Sheet A.pdf');
  const read = await readPdf(pdf);
  expect(read.labels).toEqual(['Layout1']);
  expect(read.paths).toBeGreaterThan(10);
  // Saved into Layout1's page setup, as Apply to Layout would.
  type Dev = { triyaDev: { layouts(): { name: string; plot?: { styleSheet?: string } }[] } };
  const layout1 = await page.evaluate(
    () => (window as unknown as Dev).triyaDev.layouts().find((l) => l.name === 'Layout1')!.plot!,
  );
  expect(layout1.styleSheet).toBe('triya-monochrome.ctb');
  await expect(page.locator('.doc-tab[data-active="true"]')).toHaveAttribute('data-dirty', 'true');
  await expect(dialog(page)).toBeHidden();
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

// M2-39 part 4: Publish to PNG writes a file a sheet, downloaded as one ZIP.
test('PUBLISH to PNG writes a PNG a sheet into one ZIP (M2-39 part 4)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const spaces = (await tabs.allTextContents()).map((s) => s.trim());
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PUBLISH');
  await input.press('Enter');
  const d = page.getByRole('dialog', { name: 'Publish' });
  const to = d.getByLabel('Publish to');
  await expect(to).toHaveValue('pdf');
  await expect(to.locator('option')).toHaveText(['PDF', 'SVG', 'PNG']);
  await to.selectOption('png');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Publish' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(download.suggestedFilename()).toBe('sample_AC1018.zip');
  const files = unzip(new Uint8Array(readFileSync((await download.path())!)));
  expect(files.map((f) => f.name)).toEqual(spaces.map((s) => `sample_AC1018-${s}.png`));
  for (const f of files) {
    const png = decodePng(f.bytes);
    expect(png.width * png.height).toBeGreaterThan(100_000);
    let inked = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i]! < 128 && png.data[i + 3] === 255) inked++;
    }
    expect(inked, f.name).toBeGreaterThan(500);
  }
});

// M2-39 part 4: a PNG over 64 million pixels is drawn and written in bands of rows. A3 at
// 600 dpi (69.6 Mpx, five bands) inks the same places as A3 at 150 dpi, a quarter of it: every
// band in its place, none blank, no seam.
test('a PNG over 64 million pixels plots in bands, inking where the plot at 150 dpi does (M2-39 part 4)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  const plotPng = async (dpi: string, size: string) => {
    await page.keyboard.press('Control+p');
    const d = dialog(page);
    await d.getByLabel('Paper size').selectOption('ISO A3');
    await d.getByLabel('What to plot').selectOption('extents');
    await d.getByLabel('Center the plot').check();
    await d.getByLabel('Name').selectOption('png');
    await d.getByLabel('Resolution').selectOption(dpi);
    await expect(d.getByLabel('Image size')).toHaveText(size);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      d.getByRole('button', { name: 'OK' }).click(),
    ]);
    await expect(d).toBeHidden({ timeout: 60_000 });
    return decodePng(new Uint8Array(readFileSync((await download.path())!)));
  };
  const big = await plotPng('600', '9921 × 7016 pixels');
  expect([big.width, big.height]).toEqual([9921, 7016]);
  const small = await plotPng('150', '2480 × 1754 pixels');
  // Ink in each 4 × 4 block of the big plot against ink in the small plot's pixel, give or
  // take a pixel (thin lines antialias differently at the two resolutions).
  const inked = (r: { data: Uint8Array }, i: number) =>
    r.data[i * 4 + 3]! > 0 && r.data[i * 4]! + r.data[i * 4 + 1]! + r.data[i * 4 + 2]! < 600;
  const w = small.width;
  const h = small.height;
  const blocks = new Uint8Array(w * h);
  for (let y = 0; y < big.height; y++) {
    for (let x = 0; x < big.width; x++) {
      if (inked(big, y * big.width + x))
        blocks[Math.min(h - 1, y >> 2) * w + Math.min(w - 1, x >> 2)] = 1;
    }
  }
  const near = (m: (i: number) => boolean, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m(yy * w + xx)) return true;
      }
    }
    return false;
  };
  let bigInk = 0;
  let bigMissed = 0;
  let smallInk = 0;
  let smallMissed = 0;
  // Ink per band of the big plot's rows (16 million pixels a band: 1612 rows), and the bands the
  // small plot's ink falls in.
  const bandOf = (y: number) => Math.floor((y * 4) / Math.floor(16_000_000 / big.width));
  const bandInk = new Map<number, number>();
  const smallBands = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (blocks[y * w + x]) {
        bigInk++;
        bandInk.set(bandOf(y), (bandInk.get(bandOf(y)) ?? 0) + 1);
        if (!near((i) => inked(small, i), x, y)) bigMissed++;
      }
      if (inked(small, y * w + x)) {
        smallInk++;
        smallBands.add(bandOf(y));
        if (!near((i) => blocks[i] === 1, x, y)) smallMissed++;
      }
    }
  }
  expect(bigInk).toBeGreaterThan(5_000);
  expect(smallInk).toBeGreaterThan(5_000);
  expect(bigMissed / bigInk).toBeLessThan(0.02);
  expect(smallMissed / smallInk).toBeLessThan(0.02);
  // Ink in every band the drawing crosses, which is more than one.
  expect([...bandInk.keys()].sort()).toEqual([...smallBands].sort());
  expect(smallBands.size).toBeGreaterThanOrEqual(3);
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

// Part 6: named page setups.
test('the Plot dialog lists the named page setups of the space’s kind and opens on one (part 6)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  const name = d.getByLabel('Page setup', { exact: true });
  await expect(name).toHaveValue('<None>');
  // Model space's own (flag 1024); the layouts' A3 Monochrome is not listed.
  await expect(name.locator('option')).toHaveText(['<None>', 'Model A1 Fit', 'Model ANSI B 1:2']);
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A4');

  await name.selectOption('Model A1 Fit');
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A1');
  await expect(d.getByLabel('What to plot')).toHaveValue('extents');
  await expect(d.getByLabel('Fit to paper')).toBeChecked();
  await expect(d.getByLabel('Center the plot')).toBeChecked();
  // acad.ctb opens on the bundled table of that meaning.
  await expect(d.getByLabel('Plot style table')).toHaveValue('triya-default.ctb');
  await expect(d.getByLabel('Plot style table').locator('option:checked')).not.toContainText(
    'not found',
  );

  await name.selectOption('Model ANSI B 1:2');
  await expect(d.getByLabel('Paper size')).toHaveValue('ANSI B');
  await expect(d.getByLabel('Fit to paper')).not.toBeChecked();
  await expect(d.getByLabel('Scale', { exact: true })).toHaveValue('1:2');
  await expect(d.getByLabel('inches =')).toHaveValue('1');
  await expect(d.getByLabel('units', { exact: true })).toHaveValue('2');
  await expect(d.getByLabel('Plot style table')).toHaveValue('');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  const pdf = await readPdf(download);
  // ANSI B landscape, 17 × 11 inches.
  expect(pdf.width).toBeCloseTo(431.8, 0);
  expect(pdf.height).toBeCloseTo(279.4, 0);
  await expect(d).toBeHidden();

  // It plotted: <Previous plot> is offered now, with those settings.
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  await expect(name.locator('option')).toHaveText([
    '<None>',
    '<Previous plot>',
    'Model A1 Fit',
    'Model ANSI B 1:2',
  ]);
  await name.selectOption('<Previous plot>');
  await expect(d.getByLabel('Paper size')).toHaveValue('ANSI B');
  await d.getByRole('button', { name: 'Cancel' }).click();

  // Layout1 lists the layouts' page setup; Apply to Layout writes it into Layout1's own.
  await page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab').nth(1).click();
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  await expect(d.getByRole('heading')).toHaveText('Plot - Layout1');
  await expect(name.locator('option')).toHaveText(['<None>', 'A3 Monochrome']);
  await name.selectOption('A3 Monochrome');
  await expect(d.getByLabel('Paper size').locator('option:checked')).toHaveText(
    'Layout paper (420 × 297 mm)',
  );
  await expect(d.getByLabel('Plot style table')).toHaveValue('triya-monochrome.ctb');
  await d.getByRole('button', { name: 'Apply to Layout' }).click();
  await expect(d.getByRole('status')).toHaveText(
    'Applied "A3 Monochrome" to the Layout1 page setup.',
  );
  type Dev = { triyaDev: { layouts(): { name: string; plot?: Record<string, unknown> }[] } };
  const layout1 = await page.evaluate(
    () => (window as unknown as Dev).triyaDev.layouts().find((l) => l.name === 'Layout1')!.plot!,
  );
  expect(layout1).toMatchObject({
    paperWidth: 420,
    paperHeight: 297,
    styleSheet: 'monochrome.ctb',
  });
  await d.getByRole('button', { name: 'Cancel' }).click();
});

test('-PLOT plots with a named page setup (part 6)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  const input = page.getByLabel('Command', { exact: true });
  const prompt = page.getByTestId('command-prompt');
  const type = async (text: string) => {
    await input.fill(text);
    await input.press('Enter');
  };
  await type('-PLOT');
  await type('');
  await type('');
  await expect(prompt).toHaveText('Enter a page setup name <>:');
  await type('A3 Monochrome');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Page setup "A3 Monochrome" not found.',
  );
  await type('model a1 fit');
  await expect(prompt).toHaveText(/^Enter an output device name or \[\?\] <Triya PDF/);
  await type('');
  await type('');
  await type('');
  const [download] = await Promise.all([page.waitForEvent('download'), type('')]);
  const pdf = await readPdf(download);
  // ISO A1 landscape, as the page setup says.
  expect(pdf.width).toBeCloseTo(841, 0);
  expect(pdf.height).toBeCloseTo(594, 0);
  expect(pdf.paths).toBeGreaterThan(2);
});

test('PUBLISH takes the sheets of every open drawing, a named page setup each, and writes its log (part 6)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const other = await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab')
    .allTextContents();
  await openWithPicker(page, PAGE_SETUPS);
  await expectShown(page, path.basename(PAGE_SETUPS));
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PUBLISH');
  await input.press('Enter');
  const d = page.getByRole('dialog', { name: 'Publish' });
  const table = d.getByRole('table', { name: 'Sheets to publish' });
  const names = table.getByRole('checkbox');
  await expect(names).toHaveCount(2);

  await d.getByRole('button', { name: 'Load All Open Drawings' }).click();
  const theirs = other.map((s) => `sample_AC1018-${s.trim()}`);
  await expect(names).toHaveCount(2 + other.length);
  const sheetNames = async () =>
    await names.evaluateAll((els) => els.map((e) => e.parentElement!.textContent!.trim()));
  expect(await sheetNames()).toEqual(['page-setups-Model', 'page-setups-Layout1', ...theirs]);

  // Layout1 on the layouts' named page setup; the other drawing's model space moved up one.
  await d.getByLabel('Page setup of page-setups-Layout1').selectOption('A3 Monochrome');
  // A row is selected by a click on its Status cell: one on its name would toggle its check.
  const select = (sheet: string) =>
    table.getByRole('row').filter({ hasText: sheet }).getByRole('cell').last().click();
  await select('sample_AC1018-Model');
  await d.getByRole('button', { name: 'Move Sheet Up' }).click();
  // And one of its layouts removed.
  await select(theirs[1]!);
  await d.getByRole('button', { name: 'Remove Sheets' }).click();
  const order = [
    'page-setups-Model',
    'sample_AC1018-Model',
    'page-setups-Layout1',
    ...theirs.slice(2),
  ];
  expect(await sheetNames()).toEqual(order);
  expect(await names.evaluateAll((els) => els.every((e) => (e as HTMLInputElement).checked))).toBe(
    true,
  );

  await d.getByLabel('Save publish log').check();
  const downloads: Download[] = [];
  page.on('download', (x) => downloads.push(x));
  await d.getByRole('button', { name: 'Publish' }).click();
  await expect(d).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => downloads.length).toBe(2);
  const pdfFile = downloads.find((x) => x.suggestedFilename() === 'page-setups.pdf')!;
  const pdf = await readPdf(pdfFile);
  expect(pdf.pages).toBe(order.length);
  expect(pdf.labels).toEqual(order.map((s) => s.replace(/^(page-setups|sample_AC1018)-/, '')));
  const log = downloads.find((x) => x.suggestedFilename() === 'page-setups.csv')!;
  const rows = readFileSync((await log.path())!, 'utf8')
    .trim()
    .split('\r\n');
  expect(rows[1]).toBe('Drawing,Sheet Name,Layout,Page Setup,Status');
  expect(rows.slice(2)).toEqual(
    order.map((s) => {
      const [drawing, layout] = s.startsWith('page-setups-')
        ? ['page-setups.dxf', s.slice('page-setups-'.length)]
        : ['sample_AC1018.dwg', s.slice('sample_AC1018-'.length)];
      const setup = s === 'page-setups-Layout1' ? 'A3 Monochrome' : '<Default: None>';
      return `${drawing},${s},${layout},${setup},Published`;
    }),
  );
});
