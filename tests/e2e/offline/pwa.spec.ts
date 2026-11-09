// T8 (PRD §12, FR-F10; ARCHITECTURE.md §14): the installed app works with no connection. On the
// production build, the first visit installs the service worker, which caches the app and then
// pdf.js until the title bar says "Ready offline"; with the server gone and the browser offline
// a reload still starts the app, which opens a DWG and a DXF and draws a PDF underlay (pdf.js
// from the cache) without a request leaving the page. A new version is offered, never loaded
// behind the user's back, and the app passes Chromium's installability check.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DWG, DXF, expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { DIST, serveBuild, type StaticApp } from '../app/static';

const UNDERLAYS = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');

let app: StaticApp;
test.beforeEach(async () => {
  app = await serveBuild();
});
test.afterEach(async () => {
  await app.close();
});

/** Every request the pages and their workers make that does not go to the app's origin. */
function foreignRequests(context: BrowserContext): string[] {
  const origin = new URL(app.url).origin;
  const foreign: string[] = [];
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`${origin}/`) && !/^(blob|data):/.test(url)) foreign.push(url);
  });
  return foreign;
}

async function readyOffline(page: Page): Promise<void> {
  await expect(page.getByTestId('offline-status')).toHaveText('Ready offline', {
    timeout: 60_000,
  });
}

test('starts, opens drawings and draws a PDF underlay with no connection', async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const foreign = foreignRequests(context);
  await page.goto(app.url);
  await readyOffline(page);
  // The first visit never opened a PDF, yet pdf.js is cached: the warm-up fetched it.
  expect(app.served.filter((p) => /^\/assets\/pdf[.-]/.test(p)).length).toBeGreaterThan(0);

  await app.close();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-status')).toHaveText('Working offline');

  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await openWithPicker(page, path.join(UNDERLAYS, 'pdf-underlay.dxf'));
  await expectShown(page, 'pdf-underlay.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(50);
  // ZOOM Extents and one Zoom Out bring both pages into view (as tests/e2e/ui/pdf-underlay).
  const nav = page.getByRole('toolbar', { name: 'Navigation' });
  await nav.getByRole('button', { name: 'Zoom Extents', exact: true }).click();
  await nav.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await page.waitForTimeout(500);
  const before = await ink(page);
  // The PDF the underlays name (M1-20's fixture): pdf.js, from the cache, draws its pages.
  await openWithDrop(page, path.join(UNDERLAYS, 'pdf-underlay.pdf'));
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(before + 1000);

  expect([...new Set(foreign)]).toEqual([]);
});

test('offers a new version and reloads only when the user takes it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await readyOffline(page);
  const first = await page.evaluate(() => caches.keys());
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));

  // The next build: a different file list gives the worker a new cache name.
  const sw = readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  const next = sw.replace(/"version":"[0-9a-z]+"/, '"version":"nextbuild"');
  expect(next).not.toBe(sw);
  app.override('/sw.js', next);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));

  const banner = page.getByRole('region', { name: 'New version' });
  await expect(banner).toContainText('A new version of Triya CAD 2D is ready', {
    timeout: 60_000,
  });
  // Nothing reloaded by itself.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);

  await Promise.all([
    page.waitForEvent('load'),
    banner.getByRole('button', { name: 'Reload' }).click(),
  ]);
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(
    undefined,
  );
  await readyOffline(page);
  // The new version's cache replaced the old one.
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['triya-offline-nextbuild']);
  expect(first).not.toEqual(['triya-offline-nextbuild']);
  await expect(banner).toHaveCount(0);
});

test('is installable, and offers Install when the browser would install it', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(app.url);
  await readyOffline(page);
  // Chromium's own installability check (what Lighthouse's "installable" audit asked).
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);

  await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
  // The browser's beforeinstallprompt, as Chromium fires it for an installable site.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt(): Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = () => {
      (window as unknown as { prompted: number }).prompted = 1;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(e);
  });
  await page.getByRole('button', { name: 'Install' }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
});
