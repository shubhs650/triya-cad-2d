// M1-24: the fidelity harness (TESTING.md §4). Every public corpus file is opened in the real
// app, as a user opens it, and each space is drawn: model space at its extents (ZOOM E) and each
// layout in the paper view it opens in. The canvas is compared with the file's Triya golden image
// for that space (DEC-047) within the tolerance its corpus.json entry gives.
//
// Golden images live under corpus/public/refs/golden/ (one folder per corpus file, one PNG per
// space). `TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity` writes the missing and differing ones; a PR
// that changes one says why, and its reviewer looks at it. Without the flag a missing golden,
// a golden for a space the file no longer has, or a render outside tolerance fails, naming the
// entities drawn in each differing region by type and handle (M1-106), and the actual, golden
// and diff PNGs are attached to the test (CI uploads them as `fidelity-diffs`).
//
// Each test attaches its per-space results as `triage.json`; the fidelity reporter
// (report.ts) folds them into the entity-level report after the run.
//
// `pnpm test:private` runs this suite on the owner's private corpus (TRIYA_CORPUS=private, the
// manifest in TRIYA_PRIVATE_MANIFEST): golden images then live under corpus/private/refs/golden/,
// gitignored with the drawings.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { loadManifest } from '../../../packages/testkit/src/corpus/manifest';
import { goldenPath } from '../../../packages/testkit/src/fidelity/compare';
import type { FileTriage, SpaceTriage } from '../../../packages/testkit/src/fidelity/triage';
import { activeCanvas } from '../app/page';
import {
  CANVAS,
  VIEWPORT,
  attachPng,
  checkSpace,
  loadApp,
  openDrawing,
  shootSpace,
  spaceTabs,
  test,
} from './harness';
import { corpusDir, manifestPath } from './corpus';

const CORPUS_DIR = corpusDir();
const manifest = loadManifest(manifestPath());
const UPDATE = process.env['TRIYA_UPDATE_GOLDEN'] === '1';

/**
 * Files the app cannot open, with the reason. They have no golden image; the test checks that
 * they still fail to open, so one that starts opening must be given its golden images.
 */
const UNREADABLE: Record<string, string> = {
  'public/third-party/ezdxf/integration_tests/recover02.dxf':
    'a damaged DXF for ezdxf recover mode; acad-ts cannot read it (round-trip read-error)',
};

test.describe.configure({ mode: 'parallel', timeout: 180_000 });
test.use({ viewport: VIEWPORT });

for (const file of manifest.files) {
  test(file.path, async ({ page, app }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await loadApp(page, app.url);
    const { tab, alert } = await openDrawing(page, path.join(CORPUS_DIR, file.path));
    const triage = (spaces: SpaceTriage[], unreadable?: string): Promise<void> => {
      const body: FileTriage = { path: file.path, spaces, ...(unreadable && { unreadable }) };
      return info.attach('triage.json', {
        body: JSON.stringify(body),
        contentType: 'application/json',
      });
    };

    const unreadable = UNREADABLE[file.path];
    if (unreadable !== undefined) {
      await expect(alert, `${file.path} opens now: give it golden images`).toBeVisible();
      await triage([], unreadable);
      return;
    }
    await expect(alert).toHaveCount(0);
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });

    const box = await activeCanvas(page).boundingBox();
    expect([box?.width, box?.height], 'the canvas is pinned to its render size').toEqual([
      CANVAS.width,
      CANVAS.height,
    ]);
    const spaces = await spaceTabs(page).allTextContents();
    const failures: string[] = [];
    const results: SpaceTriage[] = [];
    const expected = new Set<string>();
    for (const [i, space] of spaces.entries()) {
      const shot = await shootSpace(page, i);
      const rel = goldenPath(file.path, space);
      expected.add(path.basename(rel));
      const abs = path.join(CORPUS_DIR, rel);
      const golden = existsSync(abs) ? readFileSync(abs) : undefined;
      const check = await checkSpace(page, space, shot, golden, file.tolerance);
      if (check.triage.pass) {
        results.push(check.triage);
        continue;
      }
      if (UPDATE) {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, shot);
        results.push({ space, pass: true, drawn: check.triage.drawn, regions: [] });
        continue;
      }
      results.push(check.triage);
      // Written to the test's output folder, which CI uploads as `fidelity-diffs` on failure.
      const slug = path.basename(rel, '.png');
      await attachPng(info, `${slug}-actual.png`, shot);
      if (golden) await attachPng(info, `${slug}-golden.png`, golden);
      if (check.comparison?.diffPng)
        await attachPng(info, `${slug}-diff.png`, check.comparison.diffPng);
      failures.push(golden ? `${space}: ${check.failure}` : `${space}: no golden image ${rel}`);
    }
    await triage(results);

    // A golden image for a space the file no longer has.
    const dir = path.join(CORPUS_DIR, path.dirname(goldenPath(file.path, 'Model')));
    const stale = existsSync(dir) ? readdirSync(dir).filter((f) => !expected.has(f)) : [];
    if (UPDATE) for (const f of stale) rmSync(path.join(dir, f));
    else for (const f of stale) failures.push(`stale golden image ${f}`);

    expect(failures, file.path).toEqual([]);
    expect(errors).toEqual([]);
  });
}
