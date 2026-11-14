// T8 (PRD §12, FR-F10; ARCHITECTURE.md §14): the installed app works with no connection. On the
// production build, the first visit installs the service worker, which caches the app and then
// pdf.js until the title bar says "Ready offline"; with the server gone and the browser offline
// a reload still starts the app, which opens a DWG and a DXF, draws a PDF underlay (pdf.js from
// the cache) and keeps a dropped .pat, without a request leaving the page. M2-33 adds the rest
// of a working session offline: font and CTB drops, an edit, a save and a PDF plot. A new
// version is offered, never loaded behind the user's back, and the app passes Chromium's
// installability check.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { buildShapes } from '../../../packages/text/test/shx/builder';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import {
  DWG,
  DXF,
  activeCanvas,
  expectShown,
  ink,
  inkWeight,
  openWithDrop,
  openWithPicker,
} from '../app/page';
import { CORPUS } from '../app/server';
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
  // A dropped hatch pattern file is kept on the device (M1-50).
  const pat = test.info().outputPath('my-grid.pat');
  writeFileSync(pat, '*MY_GRID, a test grid\n0, 0,0, 0,5\n90, 0,0, 0,5\n');
  await openWithDrop(page, pat);
  await expect(page.locator('.banner[role="status"]')).toHaveText(
    /Added 1 hatch pattern from my-grid\.pat: MY_GRID\./,
  );

  expect([...new Set(foreign)]).toEqual([]);
});

/** The ink weight the dropped TrueType font's filled .notdef boxes add over the stand-in. */
const FILLED = 400_000;
const FONT_DRAWING = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_text_box_in_hole.dxf');
const MONOCHROME_CTB = path.join(
  import.meta.dirname,
  '../../../assets/plotstyles/triya-monochrome.ctb',
);

/** Zoom Extents, then the ink weight once two looks agree (the frame draws in a worker). */
async function settledWeight(page: Page): Promise<number> {
  await page
    .getByRole('toolbar', { name: 'Navigation' })
    .getByRole('button', { name: 'Zoom Extents', exact: true })
    .click();
  let last = -1;
  let now = await inkWeight(page);
  while (now !== last) {
    last = now;
    await page.waitForTimeout(250);
    now = await inkWeight(page);
  }
  return now;
}

/** LINEs in a DXF's ENTITIES and BLOCKS sections. */
const linesIn = (dxf: string): number => dxf.match(/\r?\n\s*0\r?\nLINE\r?\n/g)?.length ?? 0;

// M2-33 (T8, TESTING.md §6): the rest of an offline working session. With the server gone and
// the browser offline, dropped font files (TrueType and SHX) and a CTB are kept and used, the
// command line edits the drawing, Save downloads the DXF (no File System Access) and the Plot
// dialog writes a PDF through the dropped CTB, with the dropped font's text in it.
test('drops fonts and a CTB, edits, saves and plots a PDF with no connection', async ({
  context,
  page,
}) => {
  test.setTimeout(150_000);
  const foreign = foreignRequests(context);
  await page.goto(app.url);
  await readyOffline(page);
  await app.close();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-status')).toHaveText('Working offline');

  await openWithPicker(page, FONT_DRAWING);
  await expectShown(page, path.basename(FONT_DRAWING));
  const standIn = await settledWeight(page);

  // A TrueType file named as the drawing's Standard style names its font (arial.ttf): the text
  // fills with it (user-fonts.spec.ts) instead of stroking with the bundled stand-in.
  const ttf = test.info().outputPath('Arial.TTF');
  writeFileSync(ttf, fontBytes(testFont()));
  await openWithDrop(page, ttf);
  await expect(
    page.locator('.banner', { hasText: 'Added TrueType font Arial.TTF.' }),
  ).toBeVisible();
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeGreaterThan(standIn + FILLED);
  // An SHX font, authored here (no Autodesk font is ever used).
  const shx = test.info().outputPath('my-shapes.shx');
  const triangle = [0x01, 0x8, 0x10, 0x8, 0x1c, 0x8, 0x2c, 0x8, 0x18, 0];
  writeFileSync(
    shx,
    buildShapes([{ code: 65, name: 'A', bytes: triangle }], {
      name: 'My shapes',
      above: 8,
      below: 2,
    }),
  );
  await openWithDrop(page, shx);
  await expect(page.locator('.banner', { hasText: 'Added SHX font my-shapes.shx.' })).toBeVisible();
  // A colour-dependent plot style table.
  const ctb = test.info().outputPath('office.ctb');
  copyFileSync(MONOCHROME_CTB, ctb);
  await openWithDrop(page, ctb);
  await expect(
    page.locator('.banner', { hasText: 'Added color-dependent plot style table office.ctb.' }),
  ).toBeVisible();
  // All three are kept on the device.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const fonts = settings.getByRole('list', { name: 'Font files' });
  await expect(fonts).toContainText('Arial.TTF');
  await expect(fonts).toContainText('my-shapes.shx');
  await expect(settings.getByRole('list', { name: 'Plot style tables' })).toContainText(
    'office.ctb',
  );
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // An edit at the command line.
  const prompt = page.getByTestId('command-prompt');
  await activeCanvas(page).hover();
  for (const [text, next] of [
    ['LINE', 'Specify first point:'],
    ['0,0', /^Specify next point/],
    ['@40<30', /^Specify next point/],
    ['', 'Command:'],
  ] as const) {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveText(next);
  }
  const active = page.locator('.doc-tab[data-active="true"]');
  await expect(active).toHaveAttribute('data-dirty', 'true');

  // Save: with no File System Access the DXF downloads (an AC1027 drawing is saved as AC1032).
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  expect(saved.suggestedFilename()).toBe('hatch_text_box_in_hole.dxf');
  const dxf = readFileSync((await saved.path())!, 'latin1');
  expect(/\$ACADVER\r?\n\s*1\r?\n(\w+)/.exec(dxf)?.[1]).toBe('AC1032');
  expect(linesIn(dxf)).toBe(linesIn(readFileSync(FONT_DRAWING, 'latin1')) + 1);
  await expect(active).toHaveAttribute('data-dirty', 'false');

  // PDF export through the Plot dialog and the dropped CTB.
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+p');
  const plot = page.getByRole('dialog', { name: /^Plot - / });
  await expect(plot).toBeVisible();
  await plot.getByLabel('Paper size').selectOption('ISO A3');
  await plot.getByLabel('What to plot').selectOption('extents');
  await plot.getByLabel('Plot style table').selectOption('office.ctb');
  const [plotted] = await Promise.all([
    page.waitForEvent('download'),
    plot.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(plot).toBeHidden();
  expect(plotted.suggestedFilename()).toBe('hatch_text_box_in_hole-Model.pdf');
  const bytes = new Uint8Array(readFileSync((await plotted.path())!));
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
  const pdf = await pdfSummary(bytes);
  expect(pdf.pages).toBe(1);
  expect(pdf.labels).toEqual(['Model']);
  expect(pdf.paths).toBeGreaterThan(0);
  // The MTEXT ("TEXT", eight times) is text set in the dropped font (M2-16 part 3 embeds
  // TrueType text), not the stand-in's strokes, which have no text. The test font has no T, E or
  // X, so every letter shows its .notdef glyph, and each still copies as typed (M2-51).
  expect(pdf.text).toBe(Array(8).fill('TEXT').join(' '));

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
  playwright,
  launchOptions,
}) => {
  test.setTimeout(60_000);
  // A profile on disk: Chromium never installs from an incognito context, which a test's own
  // context is.
  const profile = mkdtempSync(path.join(tmpdir(), 'triya-pwa-'));
  const context = await playwright.chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(app.url);
    await readyOffline(page);
    // Chromium's own installability check (the criteria Lighthouse's "installable" audit used).
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: { errorId: string }[];
    };
    expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
    await offersInstall(page);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

/** The Install button follows the browser's beforeinstallprompt and shows its prompt once. */
async function offersInstall(page: Page): Promise<void> {
  // The browser's beforeinstallprompt, as Chromium fires it for an installable app. Full
  // Chromium fires its own here, but CI's headless shell never does, so the test fires one; it
  // also keeps a press of Install from opening the real installation dialog.
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
  await expect(page.getByRole('button', { name: 'Install' })).toBeVisible();
  await page.getByRole('button', { name: 'Install' }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
  await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
}

test('Clear all local data unregisters the service worker and deletes its caches (M2-20)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await readyOffline(page);
  expect(await page.evaluate(() => caches.keys())).not.toEqual([]);
  // The reload after clearing is a first visit, which would install the worker again: with a
  // worker script that fails to run, what is left afterwards is only what the clearing left.
  app.override('/sw.js', "throw new Error('no worker this time');");
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Clear all local data…' }).click();
  await Promise.all([
    page.waitForEvent('load'),
    settings.getByRole('button', { name: 'Clear and restart' }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
  ).toBe(0);
});
