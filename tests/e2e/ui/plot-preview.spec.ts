// M2-18 part 2: the plot preview. The Plot dialog's Preview…, PREVIEW (PRE) at the command line
// and the status bar's PREVIEW toggle show the sheet as it will plot in the drawing area, with
// AutoCAD's preview toolbar and shortcut menu; Esc or Enter leaves it. The roadmap's acceptance:
// the preview pixel-matches the PDF rasterised. Each test reads the sheet the preview drew (its
// canvas is the page's own) and draws the PDF its Plot button writes with pdf.js over the same
// paper millimetres at the same pixel size, as a PDF viewer would, then compares the two.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Download, type Page } from '@playwright/test';
import {
  compareImages,
  decodePng,
  type Raster,
} from '../../../packages/testkit/src/fidelity/compare';
import { DWG, activeCanvas, expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const ROOT = path.join(import.meta.dirname, '../../..');
const PDFJS = path.join(ROOT, 'apps/web/node_modules/pdfjs-dist/build');
const UNDERLAY = path.join(ROOT, 'packages/testkit/fixtures/underlay');
/** Pixel for pixel: the preview is pdf.js drawing the same PDF, composited on the white sheet. */
const TOLERANCE = { pixelMismatch: 0.05, ssim: 0.995 };

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Plot - / });
const preview = (page: Page) => page.getByRole('region', { name: /^Plot preview - / });
const sheet = (page: Page) => page.getByTestId('plot-preview-canvas');
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** What the preview drew: its device pixels over the sheet and the millimetres they cover. */
async function previewed(page: Page): Promise<{ raster: Raster; region: number[] }> {
  const canvas = sheet(page);
  await expect(canvas).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  const [x, y, width, height] = (await canvas.getAttribute('data-raster'))!.split(' ').map(Number);
  const region = (await canvas.getAttribute('data-region'))!.split(' ').map(Number);
  const png = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'));
  const all = decodePng(Buffer.from(png.split(',')[1]!, 'base64'));
  const data = new Uint8Array(width! * height! * 4);
  for (let row = 0; row < height!; row++) {
    const from = ((y! + row) * all.width + x!) * 4;
    data.set(all.data.subarray(from, from + width! * 4), row * width! * 4);
  }
  return { raster: { width: width!, height: height!, data }, region };
}

/**
 * The pixels wholly on the sheet: the last column and row are dropped, as the sheet's right and
 * bottom edges usually fall part way through a pixel, which the preview blends with its grey
 * surround while pdf.js, drawing the page on white, has no surround to blend with.
 */
function onSheet(r: Raster): Raster {
  const width = r.width - 1;
  const height = r.height - 1;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++)
    data.set(r.data.subarray(row * r.width * 4, (row * r.width + width) * 4), row * width * 4);
  return { width, height, data };
}

const HARNESS = `<!doctype html><meta charset="utf-8"><title>pdf</title>
<script type="module">
  import * as lib from 'http://pdf.test/pdf.min.mjs';
  lib.GlobalWorkerOptions.workerSrc = 'http://pdf.test/pdf.worker.min.mjs';
  // The paper millimetres [x, y, w, h] from the page's top-left corner as width × height pixels.
  window.rasterise = async (data, region, width, height) => {
    const doc = await lib.getDocument({ data: new Uint8Array(data), useWasm: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const pt = 72 / 25.4;
    const [x, y, w, h] = region;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    const sx = width / (w * pt);
    const sy = height / (h * pt);
    await page.render({
      canvas: null,
      canvasContext: ctx,
      viewport,
      transform: [sx, 0, 0, sy, -x * pt * sx, -y * pt * sy],
      background: '#fff',
    }).promise;
    return canvas.toDataURL('image/png');
  };
  document.title = 'ready';
</script>`;

/** The downloaded PDF drawn by pdf.js over `region` at the preview's pixel size. */
async function rasterisePdf(
  context: BrowserContext,
  d: Download,
  region: number[],
  size: { width: number; height: number },
): Promise<Raster> {
  const bytes = readFileSync((await d.path())!);
  expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.7');
  const page = await context.newPage();
  await page.route('http://pdf.test/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: HARNESS });
    return route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(path.join(PDFJS, name)),
    });
  });
  await page.goto('http://pdf.test/index.html');
  await expect(page).toHaveTitle('ready');
  const png = await page.evaluate(
    ([data, r, w, h]) =>
      (
        window as unknown as {
          rasterise(
            d: readonly number[],
            r: readonly number[],
            w: number,
            h: number,
          ): Promise<string>;
        }
      ).rasterise(data, r, w, h),
    [[...bytes], region, size.width, size.height] as const,
  );
  await page.close();
  return decodePng(Buffer.from(png.split(',')[1]!, 'base64'));
}

test('Preview… shows the plot as its PDF rasterises, and its Plot button plots', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  await d.getByLabel('What to plot').selectOption('extents');
  await d.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await d.getByRole('button', { name: 'Preview…' }).click();
  await expect(preview(page)).toBeVisible();
  await expect(d).toBeHidden();

  const shown = await previewed(page);
  // Zoom Original: the whole A4 sheet (297 × 210 mm) on screen.
  expect(shown.region[0]).toBeCloseTo(0, 1);
  expect(shown.region[1]).toBeCloseTo(0, 1);
  expect(shown.region[2]).toBeGreaterThanOrEqual(297 - 0.5);
  expect(shown.region[3]).toBeGreaterThanOrEqual(210 - 0.5);
  await info.attach('preview.png', {
    body: await sheet(page).screenshot(),
    contentType: 'image/png',
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    preview(page).getByRole('button', { name: 'Plot', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('sample_AC1018-Model.pdf');
  // Plotting from the preview closes it and the dialog, and PLOT is over.
  await expect(preview(page)).toBeHidden();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  const pdf = await rasterisePdf(context, download, shown.region, shown.raster);
  const c = compareImages(onSheet(shown.raster), onSheet(pdf), TOLERANCE);
  expect(c.reason ?? '', `mismatch ${c.mismatchPct} %, SSIM ${c.ssim}`).toBe('');
  expect(c.pass).toBe(true);
});

test('closing the preview goes back to the Plot dialog with its settings', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const d = dialog(page);
  await d.getByLabel('Paper size').selectOption('ISO A3');
  await d.getByRole('button', { name: 'Preview…' }).click();
  await expect(sheet(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await preview(page).getByRole('button', { name: 'Close Preview Window' }).click();
  await expect(preview(page)).toBeHidden();
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Paper size')).toHaveValue('ISO A3');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});

test('PREVIEW shows a PDF underlay’s page as plotted; zoom, pan, the menu, Esc and the toggle', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, path.join(UNDERLAY, 'pdf-underlay.dxf'));
  await expectShown(page, 'pdf-underlay.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(50);
  await openWithDrop(page, path.join(UNDERLAY, 'pdf-underlay.pdf'));
  await expectShown(page, 'pdf-underlay.dxf');

  const input = page.getByLabel('Command', { exact: true });
  await input.fill('PRE');
  await input.press('Enter');
  await expect(preview(page)).toBeVisible();
  await expect(
    page.getByText('Press ESC or ENTER to exit, or right-click to display shortcut menu.').first(),
  ).toBeVisible();
  const toggle = page.getByRole('button', { name: 'PREVIEW', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const first = await previewed(page);
  const drawn = Number(await sheet(page).getAttribute('data-drawn'));

  // The wheel zooms about the cursor: the sheet is drawn again, sharper, for less of the paper.
  const box = (await sheet(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await sheet(page).getAttribute('data-drawn')))
    .toBeGreaterThan(drawn);
  await expect(sheet(page)).toHaveAttribute('data-state', 'ready');
  const zoomed = (await sheet(page).getAttribute('data-region'))!.split(' ').map(Number);
  expect(zoomed[2]!).toBeLessThan(first.region[2]! / 1.8);

  // Pan drags the sheet.
  await preview(page).getByRole('button', { name: 'Pan', exact: true }).click();
  await expect(sheet(page)).toHaveAttribute('data-mode', 'pan');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 250, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sheet(page).getAttribute('data-region'))!.split(' ').map(Number)[0])
    .toBeLessThan(zoomed[0]! - 1);

  // The shortcut menu's Zoom Original brings back the whole sheet as first drawn.
  await sheet(page).click({ button: 'right', position: { x: 100, y: 100 } });
  const menu = page.getByRole('menu', { name: 'Preview shortcut menu' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Exit', 'Plot', 'Zoom Original']);
  await expect(menu.getByRole('menuitemradio', { name: 'Pan' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitem', { name: 'Zoom Original' }).click();
  await expect(menu).toBeHidden();
  await expect(sheet(page)).toHaveAttribute('data-region', first.region.join(' '));
  const again = await previewed(page);
  // The underlay's own page content, as the PDF plots it (an SVG plot draws only its boundary).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    preview(page).getByRole('button', { name: 'Plot', exact: true }).click(),
  ]);
  const pdf = await rasterisePdf(context, download, again.region, again.raster);
  const c = compareImages(onSheet(again.raster), onSheet(pdf), TOLERANCE);
  expect(c.reason ?? '', `mismatch ${c.mismatchPct} %, SSIM ${c.ssim}`).toBe('');
  await expect(preview(page)).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // The status bar toggle previews again; Esc closes the menu, then the preview.
  await toggle.click();
  await expect(preview(page)).toBeVisible();
  await expect(sheet(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await sheet(page).click({ button: 'right', position: { x: 100, y: 100 } });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  // Enter leaves it too, and the toggle closes what it opened.
  await toggle.click();
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(preview(page)).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(preview(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});
