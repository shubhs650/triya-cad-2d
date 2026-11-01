// M0-03 acceptance: acad-ts DwgReader runs inside a Web Worker in a Vite dev build.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
// Drawings are authored with acad-ts in Node (same fixtures as the packages/io unit tests).
import { ACadVersion, sampleDwg } from '../../../packages/io/test/fixtures';

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({
    root: path.join(import.meta.dirname, 'harness'),
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  url = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
  await server?.close();
});

test('DwgReader parses a DWG inside a module Web Worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });

  for (const version of [ACadVersion.AC1018, ACadVersion.AC1032]) {
    const bytes = Array.from(sampleDwg(version));
    const res = await page.evaluate((b) => window.readInWorker(b), bytes);

    expect(res).toMatchObject({
      ok: true,
      summary: { format: 'dwg', version: ACadVersion[version], modelSpaceEntities: { LINE: 1 } },
      mainThreadHasAcadTs: false,
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

  const res = await page.evaluate((b) => window.readInWorker(b), Array.from(readFileSync(file)));

  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.summary.version).toBe('AC1032');
    expect(res.summary.layers).toContain('0');
    expect(Object.keys(res.summary.modelSpaceEntities).length).toBeGreaterThan(0);
  }
});
