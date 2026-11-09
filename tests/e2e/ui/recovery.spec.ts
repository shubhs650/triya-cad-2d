// M2-14: crash recovery and recent drawings in the app. A drawing with unsaved changes is
// written to IndexedDB within 5 s of its last edit (PRD T5), never to its file; a tab killed
// with it unsaved leaves the snapshot, which the next launch offers ("Recover unsaved
// drawing?"). Another tab that is still open holds its session's lock, so its drawings are not
// offered. Recent drawings keep their file handles in IndexedDB: the test hands the app real
// handles to files in the origin-private file system, which Chromium can store and reopen.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { activeCanvas, expectShown, openWithPicker, serve } from '../app/page';
import { CORPUS, startApp } from '../app/server';

// Each test opens drawings in several pages and waits for the 5 s autosave.
test.describe.configure({ timeout: 90_000 });

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** An AC1032 ASCII DXF with no LINE of its own. */
const DXF32 = path.join(CORPUS, 'ezdxf/examples_dxf/hatches_1.dxf');
const NAME = path.basename(DXF32);

const prompt = (page: Page) => page.getByTestId('command-prompt');
const tab = (page: Page) => page.locator('.doc-tab', { hasText: NAME });
const offers = (page: Page) => page.getByTestId('recovery-offer');

/** Draws a line with the command line, which leaves the drawing with unsaved changes. */
async function drawLine(page: Page): Promise<void> {
  await activeCanvas(page).hover();
  const steps: [string, string | RegExp][] = [
    ['LINE', 'Specify first point:'],
    ['0,0', /^Specify next point/],
    ['@40<30', /^Specify next point/],
    ['', 'Command:'],
  ];
  for (const [text, next] of steps) {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveText(next);
  }
  await expect(tab(page)).toHaveAttribute('data-dirty', 'true');
}

/** The snapshots in the page's IndexedDB: name and unsaved edits of each. */
function snapshots(page: Page): Promise<{ name: string; edits: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('triya-recovery', 1);
        r.onupgradeneeded = () => {
          for (const s of ['drawings', 'logs', 'sources'])
            r.result.createObjectStore(s, { keyPath: 'key' });
        };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const all = r.result.transaction('drawings').objectStore('drawings').getAll();
          all.onsuccess = () => {
            r.result.close();
            resolve(
              (all.result as { name: string; edits: number }[]).map(({ name, edits }) => ({
                name,
                edits,
              })),
            );
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

/**
 * Kills the page's renderer process, as a crash or ending the tab in the browser's task manager
 * does: no unload handler runs. The page is the only one left in this worker's browser, so its
 * renderers are all the page's (its workers run there too).
 */
async function kill(browser: Browser, page: Page): Promise<void> {
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as {
    processInfo: { type: string; id: number }[];
  };
  await cdp.detach();
  for (const p of processInfo) if (p.type === 'renderer') process.kill(p.id, 'SIGKILL');
  await page.waitForEvent('crash', { timeout: 5_000 }).catch(() => undefined);
  await page.close().catch(() => undefined);
}

/** A save picker that keeps what the app writes, so the test can count the lines saved. */
async function fakeSavePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const written: Record<string, string> = {};
    Object.assign(window, {
      __written: written,
      showSaveFilePicker: (o: { suggestedName: string }) =>
        Promise.resolve({
          kind: 'file',
          name: o.suggestedName,
          getFile: () => Promise.resolve(new File([], o.suggestedName)),
          createWritable: () => {
            const parts: Blob[] = [];
            return Promise.resolve({
              write: (b: Blob) => Promise.resolve(void parts.push(b)),
              close: async () => {
                written[o.suggestedName] = await new Blob(parts).text();
              },
            });
          },
        }),
    });
  });
}

const lineCount = (text: string) => text.match(/\r?\n\s*0\r?\nLINE\r?\n/g)?.length ?? 0;

test('a killed tab leaves its unsaved drawing, which the next launch recovers', async ({
  browser,
  context,
}) => {
  const first = await context.newPage();
  await first.goto(app.url);
  await openWithPicker(first, DXF32);
  await expectShown(first, NAME);
  await drawLine(first);
  const edited = Date.now();
  await drawLine(first);
  // Written within 5 s of the last edit (PRD T5), with both edits unsaved.
  await expect
    .poll(() => snapshots(first), { timeout: 10_000 })
    .toEqual([{ name: NAME, edits: 2 }]);
  expect(Date.now() - edited).toBeLessThan(12_000);
  await kill(browser, first);

  const next = await context.newPage();
  await fakeSavePicker(next);
  await next.goto(app.url);
  await expect(offers(next)).toHaveCount(1);
  await expect(offers(next)).toContainText(`Recover unsaved drawing? ${NAME}, 2 changes not saved`);
  await next.screenshot({ path: test.info().outputPath('1-recovery-offered.png') });
  await offers(next).getByRole('button', { name: 'Recover' }).click();
  await expectShown(next, NAME);
  await expect(offers(next)).toHaveCount(0);
  await expect(tab(next)).toHaveAttribute('data-dirty', 'true');
  await next.mouse.move(400, 400);
  await next.waitForTimeout(2000);
  await next.screenshot({ path: test.info().outputPath('2-recovered.png') });
  // The recovered drawing's own snapshot replaces the old one.
  await expect.poll(() => snapshots(next)).toEqual([{ name: NAME, edits: 2 }]);

  // It has no file handle: Save goes to Save As, and the DXF holds both lines.
  await next.keyboard.press('Control+s');
  await expect(tab(next)).toHaveAttribute('data-dirty', 'false');
  const written = await next.evaluate(
    () => (window as unknown as { __written: Record<string, string> }).__written,
  );
  expect(lineCount(written[NAME]!)).toBe(2);
  // Saved, nothing is left to recover.
  await expect.poll(() => snapshots(next)).toEqual([]);
});

test('a tab that is still open keeps its drawings; Discard throws one away', async ({
  browser,
  context,
}) => {
  const first = await context.newPage();
  await first.goto(app.url);
  await openWithPicker(first, DXF32);
  await expectShown(first, NAME);
  await drawLine(first);
  await expect.poll(() => snapshots(first), { timeout: 10_000 }).toHaveLength(1);

  // A second window of the app while the first lives: nothing to recover.
  const second = await context.newPage();
  await second.goto(app.url);
  await expect(second.getByTestId('start')).toBeVisible();
  await second.waitForTimeout(500);
  await expect(offers(second)).toHaveCount(0);
  await second.close();

  await kill(browser, first);
  const next = await context.newPage();
  await next.goto(app.url);
  await expect(offers(next)).toHaveCount(1);
  await offers(next).getByRole('button', { name: 'Discard' }).click();
  await expect(offers(next)).toHaveCount(0);
  await expect.poll(() => snapshots(next)).toEqual([]);
  await next.reload();
  await expect(next.getByTestId('start')).toBeVisible();
  await next.waitForTimeout(500);
  await expect(offers(next)).toHaveCount(0);
});

test('drawings opened through a file handle are listed as recent and reopen from it', async ({
  playwright,
  launchOptions,
}) => {
  // A profile on disk, as a user's is: a test context is off the record, and its Chromium
  // closes a page that reads a kept origin-private handle back from IndexedDB (references.spec).
  const profile = mkdtempSync(path.join(tmpdir(), 'triya-recent-'));
  const context = await playwright.chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.addInitScript(() => {
      // The open picker hands out a real handle to a file in the origin-private file system.
      Object.assign(window, {
        showOpenFilePicker: async () => {
          const root = await navigator.storage.getDirectory();
          const name = (window as unknown as { __next: string }).__next;
          return [await root.getFileHandle(name)];
        },
      });
    });
    await page.goto(app.url);
    await expect(page.getByRole('region', { name: 'Recent drawings' })).toHaveCount(0);
    const url = await serve(page, DXF32);
    await page.evaluate(
      async ({ url, name }) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const root = await navigator.storage.getDirectory();
        const w = await (await root.getFileHandle(name, { create: true })).createWritable();
        await w.write(bytes);
        await w.close();
        (window as unknown as { __next: string }).__next = name;
      },
      { url, name: NAME },
    );
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expectShown(page, NAME);
    await page.getByRole('button', { name: `Close ${NAME}` }).click();
    await expect(tab(page)).toHaveCount(0);

    // The list outlives the page.
    await page.reload();
    const recent = page.getByRole('region', { name: 'Recent drawings' });
    await expect(recent.getByRole('button', { name: NAME })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('3-recent-drawings.png') });
    await recent.getByRole('button', { name: NAME }).click();
    await expectShown(page, NAME);

    // The Ctrl+K palette lists it too (UI_SPEC §5).
    await page.getByRole('button', { name: `Close ${NAME}` }).click();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await page.keyboard.type('recent');
    await expect(palette.getByRole('option').first()).toContainText(`Open recent: ${NAME}`);
    await page.screenshot({ path: test.info().outputPath('4-palette-recent.png') });
    await page.keyboard.press('Enter');
    await expectShown(page, NAME);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
