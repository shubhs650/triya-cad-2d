// The error report (M7-08, PRD §8 G6, TESTING.md §6 "a second test"): the user-confirmed error
// report is the one request the app makes of its own besides the service worker's, and only
// after Send Report. A drawing whose text, names, xdata and file name all hold MARKER strings
// is open when errors are raised whose messages name them; the report shown and the one sent
// hold none of them, Don't Send sends nothing, and no other request leaves the origin.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, enterCommand, expectShown, openOptions, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const REPORT_URL = 'https://report.openengtools.com/';
const NAME = 'MARKER-FILE-error-report.dxf';
const FILE = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/error-report',
  NAME,
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { throwUncaught(m: string): void; rejectUnhandled(m: string): void } };

/** Screenshots for the PR when TRIYA_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env['TRIYA_SHOTS'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), animations: 'disabled' });
}

test('offers the error report, sends it only on Send Report, and it holds no drawing content', async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const origin = new URL(app.url).origin;
  const foreign: string[] = [];
  const sent: string[] = [];
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`${origin}/`)) return route.continue();
    if (url === REPORT_URL && req.method() === 'POST') {
      sent.push(req.postData() ?? '');
      return route.fulfill({
        status: 201,
        headers: { 'access-control-allow-origin': origin, 'content-type': 'application/json' },
        body: '{"ok":true}',
      });
    }
    foreign.push(url);
    return route.abort('blockedbyclient');
  });
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`${origin}/`) && url !== REPORT_URL && !/^(blob|data):/.test(url)) {
      foreign.push(url);
    }
  });

  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, NAME);
  if (process.env['TRIYA_SHOTS']) {
    await enterCommand(page, 'ZOOM');
    await enterCommand(page, 'E');
    const box = (await activeCanvas(page).boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height - 40);
    await page.waitForTimeout(500);
  }
  await shot(page, '1-before-error.png');

  // A careless message quoting the drawing, as `throw new Error(\`... ${layer.name}\`)` makes.
  await page.evaluate(
    (m) => (window as unknown as Dev).triyaDev.throwUncaught(m),
    `Cannot draw MARKER_TEXT_ROOM on layer MARKER_LAYER_WALLS of ${NAME} at 12.5,7.25`,
  );
  const dialog = page.getByRole('dialog', { name: 'Triya CAD 2D Error Report' });
  await expect(dialog).toBeVisible();
  const payload = dialog.getByLabel('Report contents');
  const shown = (await payload.textContent()) ?? '';
  expect(shown).not.toMatch(/MARKER/i);
  expect(shown).not.toContain('12.5');
  const report = JSON.parse(shown) as {
    error: { source: string; name: string; message: string; stack: string[] };
    drawing: { version: string; entities: Record<string, number> };
    browser: { name: string };
  };
  expect(report.error).toMatchObject({ source: 'window', name: 'Error' });
  expect(report.error.message).toMatch(/^Cannot draw … on .* at #,#$/);
  expect(report.error.stack.length).toBeGreaterThan(0);
  expect(report.drawing.version).toBe('AC1032');
  expect(report.drawing.entities['TEXT']).toBeGreaterThan(0);
  expect(report.browser.name).toBe('Chrome');
  // The drawing stays usable: the panel is not modal.
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await shot(page, '2-error-report-offered.png');
  expect(sent).toEqual([]);

  await dialog.getByRole('button', { name: 'Send Report' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Report sent. Thank you.');
  expect(sent).toEqual([shown]);
  await shot(page, '3-error-report-sent.png');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  // An unhandled rejection is offered too; Don't Send sends nothing.
  await page.evaluate(
    (m) => (window as unknown as Dev).triyaDev.rejectUnhandled(m),
    'No xdata MARKER_XDATA_STRING for MARKER_APPID_TAGS',
  );
  await expect(dialog).toBeVisible();
  const second = (await payload.textContent()) ?? '';
  expect(second).not.toMatch(/MARKER/i);
  expect(JSON.parse(second)).toMatchObject({ error: { source: 'promise', name: 'TypeError' } });
  await dialog.getByRole('button', { name: "Don't Send" }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(1);
  expect([...new Set(foreign)]).toEqual([]);
});

test('offers no report while Options > System has the offer turned off', async ({ page }) => {
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, NAME);
  const options = await openOptions(page, 'System');
  const offer = options.getByRole('checkbox', {
    name: 'Offer to send an error report when a problem occurs',
  });
  await expect(offer).toBeChecked();
  await shot(page, '4-options-system-error-reports.png');
  await offer.uncheck();
  await options.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(
    (m) => (window as unknown as Dev).triyaDev.throwUncaught(m),
    'an error nobody is asked about',
  );
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: 'Triya CAD 2D Error Report' })).toHaveCount(0);
});
