// M0-03 acceptance: acad-ts DwgReader runs inside a Web Worker in a Vite dev build.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// Drawings are authored with acad-ts in Node (same fixtures as the packages/io unit tests).
import { ACadVersion, sampleDwg } from '../../../packages/io/test/fixtures';
import { startHarness } from './harness';

let harness: Awaited<ReturnType<typeof startHarness>>;
let url: string;

test.beforeAll(async () => {
  harness = await startHarness();
  url = harness.url;
});

test.afterAll(async () => {
  await harness?.close();
});

/** Serves `bytes` to the page at `url + name`. */
async function serve(page: Page, name: string, bytes: Uint8Array): Promise<string> {
  await page.route(`**/${name}`, (route) => route.fulfill({ body: Buffer.from(bytes) }));
  return url + name;
}

test('DwgReader parses a DWG inside a module Web Worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });

  for (const version of [ACadVersion.AC1018, ACadVersion.AC1032]) {
    const file = await serve(page, `sample-${version}.dwg`, sampleDwg(version));
    const res = await page.evaluate((f) => window.load(f), file);

    expect(res).toMatchObject({
      ok: true,
      summary: { format: 'dwg', version: ACadVersion[version], modelSpaceEntities: { LINE: 1 } },
      mainThreadHasAcadTs: false,
      workersCreated: 1,
      workersTerminated: 1,
    });
  }
  expect(errors).toEqual([]);
});

test('DwgReader parses a real AutoCAD 2018 corpus file inside the worker', async ({ page }) => {
  const file = path.join(
    import.meta.dirname,
    '../../../corpus/public/third-party/acadsharp/sample_AC1032.dwg',
  );
  await page.goto(url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });

  const served = await serve(page, 'sample_AC1032.dwg', readFileSync(file));
  const res = await page.evaluate((f) => window.load(f), served);

  expect(res.ok, res.error).toBe(true);
  expect(res.summary?.version).toBe('AC1032');
  expect(res.summary?.layers).toContain('0');
  expect(Object.keys(res.summary?.modelSpaceEntities ?? {}).length).toBeGreaterThan(0);
});
