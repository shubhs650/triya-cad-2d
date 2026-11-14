// M2-67: each Playwright run pre-bundles the app's dependencies once, before any worker starts a
// dev server (tests/e2e/global-setup.ts), so no test server optimises them itself. Each spec file
// starts its own server, and on a cold cache several of them optimised at once and raced
// renaming their `deps_temp_*` onto the same `deps` directory (ENOTEMPTY), failing a CI shard
// before its first test. Here a server opens drawings down the app's main paths (a DWG through
// the I/O worker, a DXF with a PDF underlay drawn by pdf.js) and must find every dependency it
// asks for already optimised: no optimiser message in its log, the cache's metadata untouched.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, expectShown, openWithDrop, openWithPicker } from '../app/page';
import { APP_DEPS, startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');

const pdfRenders = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { triyaDev: { pdfRenders(): number } }).triyaDev.pdfRenders(),
  );

test('the dev server starts with its dependencies already optimised and never re-optimises', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const metadata = path.join(APP_DEPS, 'deps', '_metadata.json');
  // Written by the global setup, before this worker's server existed.
  const before = { text: readFileSync(metadata, 'utf8'), mtime: statSync(metadata).mtimeMs };
  const log: string[] = [];
  const app = await startApp({ log: (message) => log.push(message) });
  try {
    await page.goto(app.url);
    await openWithPicker(page, DWG);
    await expectShown(page, path.basename(DWG));
    await openWithPicker(page, path.join(FIXTURES, 'pdf-underlay.dxf'));
    await expectShown(page, 'pdf-underlay.dxf');
    await openWithDrop(page, path.join(FIXTURES, 'pdf-underlay.pdf'));
    await expect.poll(() => pdfRenders(page), { timeout: 30_000 }).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
  // Vite logs "new dependencies optimized", "optimized dependencies changed" and
  // "Re-optimizing dependencies because …" when a server optimises after starting.
  expect(log.filter((message) => /optimiz/i.test(message))).toEqual([]);
  expect(readFileSync(metadata, 'utf8')).toBe(before.text);
  expect(statSync(metadata).mtimeMs).toBe(before.mtime);
});
