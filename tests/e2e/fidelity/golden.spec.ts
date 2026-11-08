// M1-24: the fidelity harness (TESTING.md §4). Every public corpus file is opened in the real
// app, as a user opens it, and each space is drawn: model space at its extents (ZOOM E) and each
// layout in the paper view it opens in. The canvas is compared with the file's Triya golden image
// for that space (DEC-047) within the tolerance its corpus.json entry gives.
//
// Golden images live under corpus/public/refs/golden/ (one folder per corpus file, one PNG per
// space). `TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity` writes the missing and differing ones; a PR
// that changes one says why, and its reviewer looks at it. Without the flag a missing golden,
// a golden for a space the file no longer has, or a render outside tolerance fails, and the
// actual, golden and diff PNGs are attached to the test (CI uploads them as `fidelity-diffs`).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadManifest } from '../../../packages/testkit/src/corpus/manifest';
import {
  compareImages,
  decodePng,
  goldenPath,
  type Comparison,
} from '../../../packages/testkit/src/fidelity/compare';
import { activeCanvas, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const CORPUS_DIR = path.join(import.meta.dirname, '../../../corpus');
const manifest = loadManifest(path.join(CORPUS_DIR, 'corpus.json'));
const UPDATE = process.env['TRIYA_UPDATE_GOLDEN'] === '1';

/**
 * Files the app cannot open, with the reason. They have no golden image; the test checks that
 * they still fail to open, so one that starts opening must be given its golden images.
 */
const UNREADABLE: Record<string, string> = {
  'public/third-party/ezdxf/integration_tests/recover02.dxf':
    'a damaged DXF for ezdxf recover mode; acad-ts cannot read it (round-trip read-error)',
};

/** The window every render is taken in: the canvas size follows from the app's chrome. */
const VIEWPORT = { width: 1000, height: 700 };

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app?.close();
});

test.describe.configure({ mode: 'parallel', timeout: 180_000 });
test.use({ viewport: VIEWPORT });

const tabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
const zoomExtents = (page: Page) =>
  page
    .getByRole('toolbar', { name: 'Navigation' })
    .getByRole('button', { name: 'Zoom Extents', exact: true });

/** Chrome drawn over the canvas (the navigation bar), hidden from the shots: its text is set in
 * the system UI font, which differs between machines. */
const HIDE_CHROME = '.nav-bar { visibility: hidden !important; }';

/**
 * The canvas once it has stopped changing. Fonts, patterns and images are fetched and decoded
 * after the first frame, and text is measured once its font is in, so this waits for the network
 * to go quiet and then for three shots 300 ms apart to be the same bytes.
 */
async function settled(page: Page): Promise<Buffer> {
  await page.waitForLoadState('networkidle');
  const shot = () => activeCanvas(page).screenshot({ animations: 'disabled', style: HIDE_CHROME });
  let last = await shot();
  let same = 0;
  const deadline = Date.now() + 60_000;
  while (same < 2) {
    await page.waitForTimeout(300);
    const next = await shot();
    same = Buffer.compare(next, last) === 0 ? same + 1 : 0;
    if (Date.now() > deadline) throw new Error('the canvas did not settle within 60 s');
    last = next;
  }
  return last;
}

for (const file of manifest.files) {
  test(file.path, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(app.url);
    await openWithPicker(page, path.join(CORPUS_DIR, file.path));
    const name = path.basename(file.path);
    const tab = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab', { name });
    const alert = page.getByRole('alert');
    await expect(tab.or(alert).first()).toBeVisible({ timeout: 60_000 });

    const unreadable = UNREADABLE[file.path];
    if (unreadable !== undefined) {
      await expect(alert, `${file.path} opens now: give it golden images`).toBeVisible();
      return;
    }
    await expect(alert).toHaveCount(0);
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });

    const spaces = await tabs(page).allTextContents();
    const failures: string[] = [];
    const expected = new Set<string>();
    for (const [i, space] of spaces.entries()) {
      await tabs(page).nth(i).click();
      await expect(tabs(page).nth(i)).toHaveAttribute('aria-selected', 'true');
      // ZOOM E only once the drawing has settled: text extents need their fonts.
      let shot = await settled(page);
      if (i === 0) {
        await zoomExtents(page).click();
        shot = await settled(page);
      }
      const rel = goldenPath(file.path, space);
      expected.add(path.basename(rel));
      const abs = path.join(CORPUS_DIR, rel);
      const result: Comparison | undefined = existsSync(abs)
        ? compareImages(decodePng(shot), decodePng(readFileSync(abs)), file.tolerance)
        : undefined;
      if (result?.pass) continue;
      if (UPDATE) {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, shot);
        continue;
      }
      // Written to the test's output folder, which CI uploads as `fidelity-diffs` on failure.
      const slug = path.basename(rel, '.png');
      const save = async (kind: string, body: Uint8Array) => {
        const out = info.outputPath(`${slug}-${kind}.png`);
        writeFileSync(out, body);
        await info.attach(`${slug}-${kind}.png`, { path: out, contentType: 'image/png' });
      };
      await save('actual', shot);
      if (!result) {
        failures.push(`${space}: no golden image ${rel}`);
        continue;
      }
      await save('golden', readFileSync(abs));
      if (result.diffPng) await save('diff', result.diffPng);
      const where = result.regions
        .slice(0, 8)
        .map((r) => `${r.width}×${r.height}@${r.x},${r.y}`)
        .join(' ');
      failures.push(`${space}: ${result.reason} (differs at ${where})`);
    }

    // A golden image for a space the file no longer has.
    const dir = path.join(CORPUS_DIR, path.dirname(goldenPath(file.path, 'Model')));
    const stale = existsSync(dir) ? readdirSync(dir).filter((f) => !expected.has(f)) : [];
    if (UPDATE) for (const f of stale) rmSync(path.join(dir, f));
    else for (const f of stale) failures.push(`stale golden image ${f}`);

    expect(failures, file.path).toEqual([]);
    expect(errors).toEqual([]);
  });
}
