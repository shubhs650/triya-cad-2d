// Golden images of the PDF writer's test plot (M2-16, DEC-047): each page of the committed
// plot sheet PDF (packages/testkit/src/pdf/sheet.ts, kept equal to the writer's output by
// sheet.test.ts) drawn by pdf.js in Chromium, as a reader's viewer shows it, must match its
// reviewed golden image beside the fixture. `TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity` writes
// the missing and differing ones. pdf.js comes from the app's own dependency, served from disk.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { compareImages, decodePng } from '../../../packages/testkit/src/fidelity/compare';
import { attachPng } from './harness';
import { isPrivateRun } from './corpus';

const ROOT = path.join(import.meta.dirname, '../../..');
const FIXTURE = path.join(ROOT, 'packages/testkit/fixtures/pdf/plot-sheet.pdf');
const GOLDEN = path.join(ROOT, 'packages/testkit/fixtures/pdf/golden');
const PDFJS = path.join(ROOT, 'apps/web/node_modules/pdfjs-dist/build');
const UPDATE = process.env['TRIYA_UPDATE_GOLDEN'] === '1';
/** TESTING.md §4: a new file's tolerance. */
const TOLERANCE = { pixelMismatch: 2, ssim: 0.95 };
/** Device pixels per PDF point: 96 dpi. */
const SCALE = 96 / 72;
const ORIGIN = 'http://pdf.test';

const PAGE = `<!doctype html><meta charset="utf-8"><title>pdf</title>
<script type="module">
  import * as lib from '${ORIGIN}/pdf.min.mjs';
  lib.GlobalWorkerOptions.workerSrc = '${ORIGIN}/pdf.worker.min.mjs';
  window.renderPages = async (scale) => {
    const data = new Uint8Array(await (await fetch('${ORIGIN}/plot.pdf')).arrayBuffer());
    const doc = await lib.getDocument({ data, useWasm: false, isEvalSupported: false }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: null, canvasContext: ctx, viewport, background: '#fff' }).promise;
      out.push(canvas.toDataURL('image/png'));
    }
    return out;
  };
  document.title = 'ready';
</script>`;

test('the plot sheet PDF matches its golden images, page by page', async ({ page }, info) => {
  test.skip(isPrivateRun(), 'fixtures are public');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: PAGE });
    if (name === 'plot.pdf')
      return route.fulfill({ contentType: 'application/pdf', body: readFileSync(FIXTURE) });
    if (name === 'pdf.min.mjs' || name === 'pdf.worker.min.mjs')
      return route.fulfill({
        contentType: 'text/javascript',
        body: readFileSync(path.join(PDFJS, name)),
      });
    return route.abort();
  });
  await page.goto(`${ORIGIN}/index.html`);
  await expect(page).toHaveTitle('ready');
  const urls = await page.evaluate(
    (scale) =>
      (window as unknown as { renderPages(s: number): Promise<string[]> }).renderPages(scale),
    SCALE,
  );
  expect(urls).toHaveLength(5);

  const failures: string[] = [];
  const expected = new Set<string>();
  for (const [i, url] of urls.entries()) {
    const shot = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    const name = `page-${i + 1}.png`;
    expected.add(name);
    const abs = path.join(GOLDEN, name);
    const golden = existsSync(abs) ? readFileSync(abs) : undefined;
    const check = golden ? compareImages(decodePng(shot), decodePng(golden), TOLERANCE) : undefined;
    if (check?.pass) continue;
    if (UPDATE) {
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(abs, shot);
      continue;
    }
    await attachPng(info, `page-${i + 1}-actual.png`, shot);
    if (golden) await attachPng(info, `page-${i + 1}-golden.png`, golden);
    if (check?.diffPng) await attachPng(info, `page-${i + 1}-diff.png`, check.diffPng);
    failures.push(golden ? `page ${i + 1}: ${check!.reason}` : `page ${i + 1}: no golden ${abs}`);
  }
  const stale = existsSync(GOLDEN) ? readdirSync(GOLDEN).filter((f) => !expected.has(f)) : [];
  if (UPDATE) for (const f of stale) rmSync(path.join(GOLDEN, f));
  else for (const f of stale) failures.push(`stale golden image ${f}`);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
