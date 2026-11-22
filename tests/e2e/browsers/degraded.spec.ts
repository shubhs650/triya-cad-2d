// M7-09: Firefox and Safari's degraded mode (PRD §8, DEC-023), on Playwright's Firefox and WebKit
// against the production build, as those browsers' users get it. The roadmap's acceptance: open,
// edit, download-save, PDF; and the first-run compatibility notice (browser-support.ts), which
// names what the browser does differently and stays away once dismissed.
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  openWithPicker,
} from '../app/page';
import { serveBuild, type StaticApp } from '../app/static';

let app: StaticApp;
test.beforeAll(async () => {
  app = await serveBuild();
});
test.afterAll(async () => {
  await app.close();
});

/** Screenshots for the PR when TRIYA_SHOTS names a folder. */
async function shot(page: Page, browser: string, name: string) {
  const dir = process.env['TRIYA_SHOTS'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${browser}-${name}`), animations: 'disabled' });
}

const notice = (page: Page) => page.getByRole('region', { name: 'Browser compatibility' });
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Dismisses the first-run notice, which the drawing specs below do not look at. */
async function dismissNotice(page: Page) {
  await notice(page).getByRole('button', { name: 'OK' }).click();
  await expect(notice(page)).toHaveCount(0);
}

/** The DXF's $ACADVER and its LINEs' start and end points (groups 10/20 and 11/21). */
function dxfFacts(text: string) {
  const pairs = text.split(/\r?\n/).map((l) => l.trim());
  const lines: number[][] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (pairs[i] !== '0' || pairs[i + 1] !== 'LINE') continue;
    const at: Record<string, number> = {};
    for (let j = i + 2; j + 1 < pairs.length && pairs[j] !== '0'; j += 2)
      at[pairs[j]!] = Number(pairs[j + 1]);
    lines.push([at['10']!, at['20']!, at['11']!, at['21']!]);
  }
  return { version: /\$ACADVER\r?\n\s*1\r?\n(\w+)/.exec(text)?.[1], lines };
}

test('the first-run notice names what this browser does differently, until it is dismissed', async ({
  page,
  browserName,
}) => {
  await page.goto(app.url);
  const n = notice(page);
  await expect(n).toBeVisible();
  await expect(n).toContainText('Chrome or Edge');
  await expect(n.getByRole('listitem')).toHaveText([
    /download the drawing as a DXF file/,
    /Folders you drop for references/,
    /system clipboard/,
    /not by double-clicking/,
  ]);
  await shot(page, browserName, '1-first-run-notice.png');
  // A notice, not a dialog: it takes no focus.
  await expect(n.getByRole('button', { name: 'OK' })).not.toBeFocused();
  await n.getByRole('button', { name: 'OK' }).click();
  await expect(n).toHaveCount(0);
  // Dismissed for good: it is kept in the settings, and the next visit does not show it.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            const r = indexedDB.open('triya-settings', 1);
            r.onsuccess = () => {
              const get = r.result
                .transaction('settings')
                .objectStore('settings')
                .get('preferences');
              get.onsuccess = () =>
                resolve((get.result as { browserNoticeSeen?: boolean })?.browserNoticeSeen);
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(n).toHaveCount(0);
});

test('opens a drawing, edits it and saves it as a download', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await dismissNotice(page);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).hover();
  await enterCommand(page, 'LINE');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await enterCommand(page, '0,0');
  await expect(prompt(page)).toHaveText(/^Specify next point/);
  await enterCommand(page, '100,50');
  await expect(prompt(page)).toHaveText(/^Specify next point/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Command:');
  const tab = page.locator('.doc-tab[data-active="true"]');
  await expect(tab).toHaveAttribute('data-dirty', 'true');
  await expectDrawn(page);
  await shot(page, browserName, '2-edited.png');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  // A DWG is never written over (DEC-047): the download is a DXF of the same name.
  const dxf = path.basename(DWG).replace(/\.dwg$/, '.dxf');
  expect(download.suggestedFilename()).toBe(dxf);
  const file = test.info().outputPath(dxf);
  await download.saveAs(file);
  const saved = dxfFacts(readFileSync(file, 'latin1'));
  expect(saved.version).toBe('AC1032');
  expect(saved.lines).toContainEqual([0, 0, 100, 50]);
  await expectShown(page, dxf);
  await expect(tab).toHaveAttribute('data-dirty', 'false');
  await expectDrawn(page);
  await shot(page, browserName, '3-saved-as-download.png');
});

async function readPdf(d: Download) {
  const bytes = new Uint8Array(readFileSync((await d.path())!));
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
  return pdfSummary(bytes);
}

test('plots the drawing to a PDF that downloads', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await dismissNotice(page);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+p');
  const d = page.getByRole('dialog', { name: /^Plot/ });
  await expect(d).toBeVisible();
  await d.getByLabel('Paper size').selectOption('ISO A3');
  await d.getByLabel('What to plot').selectOption('extents');
  await shot(page, browserName, '4-plot-dialog.png');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(download.suggestedFilename()).toBe('sample_AC1018-Model.pdf');
  const pdf = await readPdf(download);
  expect(pdf.pages).toBe(1);
  expect(Math.max(pdf.width, pdf.height)).toBeCloseTo(420, 0);
  expect(pdf.paths).toBeGreaterThan(10);
});
