// The SVG plot writer against the PDF writer (M2-18): each page of the plot sheet written as SVG
// (packages/testkit/src/pdf/sheet.ts `sheetSvgs`, kept equal to the committed files by
// sheet.test.ts) drawn by Chromium at 96 dpi must match the reviewed golden image of the same
// page of the PDF (pdf.spec.ts), at the new-file tolerance: the two writers plot the same items
// the same way. Page 8's PDF underlays plot their pages' content in a PDF only (an SVG plot draws
// their clip boundary, a leftover on the roadmap), so it is compared with its own golden image.
// Each SVG is also checked for Inkscape layers named after the drawing's layers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { compareImages, decodePng } from '../../../packages/testkit/src/fidelity/compare';
import { attachPng } from './harness';
import { isPrivateRun } from './corpus';

const ROOT = path.join(import.meta.dirname, '../../..');
const SVG_DIR = path.join(ROOT, 'packages/testkit/fixtures/pdf/svg');
const PDF_GOLDEN = path.join(ROOT, 'packages/testkit/fixtures/pdf/golden');
const UPDATE = process.env['TRIYA_UPDATE_GOLDEN'] === '1';
/** TESTING.md §4: a new file's tolerance. */
const TOLERANCE = { pixelMismatch: 2, ssim: 0.95 };
/** Device pixels per point: 96 dpi, as pdf.spec.ts draws the PDF. */
const SCALE = 96 / 72;
const ORIGIN = 'http://svg.test';
const PAGES = 8;
/** The page compared with its own golden image (see the header). */
const OWN_GOLDEN = new Set([8]);

const PAGE = `<!doctype html><meta charset="utf-8"><title>svg</title>
<script>
  window.renderSvg = async (name, scale) => {
    const text = await (await fetch('${ORIGIN}/' + name)).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error(name + ': ' + err.textContent);
    const root = doc.documentElement;
    const NS = 'http://www.inkscape.org/namespaces/inkscape';
    const layers = [...root.children]
      .filter((e) => e.localName === 'g' && e.getAttributeNS(NS, 'groupmode') === 'layer')
      .map((e) => e.getAttributeNS(NS, 'label'));
    const [, , w, h] = root.getAttribute('viewBox').split(' ').map(Number);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { png: canvas.toDataURL('image/png'), layers, width: root.getAttribute('width') };
  };
  document.title = 'ready';
</script>`;

test('the plot sheet as SVG draws as the PDF does, with the drawing layers as Inkscape layers', async ({
  page,
}, info) => {
  test.skip(isPrivateRun(), 'fixtures are public');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: PAGE });
    if (/^page-\d+\.svg$/.test(name))
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: readFileSync(path.join(SVG_DIR, name)),
      });
    return route.abort();
  });
  await page.goto(`${ORIGIN}/index.html`);
  await expect(page).toHaveTitle('ready');

  const failures: string[] = [];
  for (let n = 1; n <= PAGES; n++) {
    const out = await page.evaluate(
      ([name, scale]) =>
        (
          window as unknown as {
            renderSvg(
              n: string,
              s: number,
            ): Promise<{ png: string; layers: string[]; width: string }>;
          }
        ).renderSvg(name, scale),
      [`page-${n}.svg`, SCALE] as const,
    );
    expect(out.width).toBe('297mm');
    // Every page draws on at least one Inkscape layer named after a drawing layer.
    expect(out.layers.length, `page ${n} layers`).toBeGreaterThan(0);
    const shot = Buffer.from(out.png.slice(out.png.indexOf(',') + 1), 'base64');
    const own = OWN_GOLDEN.has(n);
    const abs = own
      ? path.join(SVG_DIR, 'golden', `page-${n}.png`)
      : path.join(PDF_GOLDEN, `page-${n}.png`);
    const golden = existsSync(abs) ? readFileSync(abs) : undefined;
    const check = golden ? compareImages(decodePng(shot), decodePng(golden), TOLERANCE) : undefined;
    if (check?.pass) continue;
    if (UPDATE && own) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, shot);
      continue;
    }
    await attachPng(info, `page-${n}-svg.png`, shot);
    if (golden) await attachPng(info, `page-${n}-golden.png`, golden);
    if (check?.diffPng) await attachPng(info, `page-${n}-diff.png`, check.diffPng);
    failures.push(golden ? `page ${n}: ${check!.reason}` : `page ${n}: no golden ${abs}`);
  }
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
