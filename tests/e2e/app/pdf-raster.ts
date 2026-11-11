// A downloaded PDF plot drawn by pdf.js, as a PDF viewer would draw it (M2-18 part 2; shared with
// M2-39's SVG and PNG plot checks): over paper millimetres from the page's top-left corner, at a
// pixel size, on white, in a second page of the test's browser context that loads pdf.js from
// apps/web's own copy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type BrowserContext, type Download } from '@playwright/test';
import { decodePng, type Raster } from '../../../packages/testkit/src/fidelity/compare';

const ROOT = path.join(import.meta.dirname, '../../..');
const PDFJS = path.join(ROOT, 'apps/web/node_modules/pdfjs-dist/build');

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

/** The downloaded PDF drawn by pdf.js over `region` (mm) at `size` pixels. */
export async function rasterisePdf(
  context: BrowserContext,
  d: Download,
  region: readonly number[],
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
