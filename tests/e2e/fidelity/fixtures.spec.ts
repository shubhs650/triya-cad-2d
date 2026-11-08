// Golden images of the thread-authored test drawings whose content lives in files beside them
// (DEC-047, M1-24's harness): the raster image drawing (M1-19) with its bitmaps. (The PDF
// underlay drawing joins once ZOOM Extents takes in an unclipped page, whose size only its PDF
// gives: today its golden image would crop page 1, see M1-20.) The corpus suite (golden.spec.ts)
// opens a drawing alone, so these open theirs and then drop the files on the window, as a user
// supplies them, and shoot each space once it settles. Golden images live in a `golden/` folder beside each
// fixture; `TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity` writes the missing and differing ones.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { spaceSlug } from '../../../packages/testkit/src/fidelity/compare';
import { openWithDrop } from '../app/page';
import { startApp } from '../app/server';
import {
  VIEWPORT,
  attachPng,
  checkSpace,
  loadApp,
  openDrawing,
  shootSpace,
  spaceTabs,
} from './harness';
import { isPrivateRun } from './corpus';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures');
const UPDATE = process.env['TRIYA_UPDATE_GOLDEN'] === '1';
/** TESTING.md §4: a new file's tolerance. */
const TOLERANCE = { pixelMismatch: 2, ssim: 0.95 };

const SETS: { readonly drawing: string; readonly files: readonly string[] }[] = [
  {
    drawing: 'raster/raster-images.dxf',
    files: ['raster/checker.png', 'raster/bars.bmp', 'raster/scan.tif'],
  },
];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app?.close();
});

test.describe.configure({ mode: 'parallel', timeout: 180_000 });
test.use({ viewport: VIEWPORT });

for (const set of SETS) {
  test(set.drawing, async ({ page }, info) => {
    // The owner's private corpus run (`pnpm test:private`) is about their drawings only.
    test.skip(isPrivateRun(), 'fixtures are public');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await loadApp(page, app.url);
    const { tab, alert } = await openDrawing(page, path.join(FIXTURES, set.drawing));
    await expect(alert).toHaveCount(0);
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
    for (const f of set.files) await openWithDrop(page, path.join(FIXTURES, f));

    const dir = path.join(FIXTURES, path.dirname(set.drawing), 'golden');
    const failures: string[] = [];
    const expected = new Set<string>();
    const spaces = await spaceTabs(page).allTextContents();
    for (const [i, space] of spaces.entries()) {
      const shot = await shootSpace(page, i);
      const name = `${spaceSlug(space)}.png`;
      expected.add(name);
      const abs = path.join(dir, name);
      const golden = existsSync(abs) ? readFileSync(abs) : undefined;
      const check = await checkSpace(page, space, shot, golden, TOLERANCE);
      if (check.triage.pass) continue;
      if (UPDATE) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(abs, shot);
        continue;
      }
      const slug = path.basename(name, '.png');
      await attachPng(info, `${slug}-actual.png`, shot);
      if (golden) await attachPng(info, `${slug}-golden.png`, golden);
      if (check.comparison?.diffPng)
        await attachPng(info, `${slug}-diff.png`, check.comparison.diffPng);
      failures.push(golden ? `${space}: ${check.failure}` : `${space}: no golden image ${abs}`);
    }
    const stale = existsSync(dir) ? readdirSync(dir).filter((f) => !expected.has(f)) : [];
    if (UPDATE) for (const f of stale) rmSync(path.join(dir, f));
    else for (const f of stale) failures.push(`stale golden image ${f}`);

    expect(failures, set.drawing).toEqual([]);
    expect(errors).toEqual([]);
  });
}
