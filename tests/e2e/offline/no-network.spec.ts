// Privacy (PRD G6, §8): after the app loads it makes no network request of its own. Every
// request the page or its workers make while starting, opening a DWG and a DXF, zooming and
// panning must go to the app's own origin (or be a blob:/data: URL); anything else is
// blocked here and fails the test. Service-worker update checks and the user-confirmed error
// report (the only allowed exceptions) do not exist yet (M2-19, M10).
import { expect, test } from '@playwright/test';
import { DWG, DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('opens and navigates drawings without leaving the origin', async ({ context, page }) => {
  test.setTimeout(90_000);
  const origin = new URL(app.url).origin;
  const foreign: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`)) return route.continue();
    foreign.push(url);
    return route.abort('blockedbyclient');
  });
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`${origin}/`) && !/^(blob|data):/.test(url)) foreign.push(url);
  });

  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3, { steps: 3 });
  await page.mouse.up({ button: 'middle' });

  expect([...new Set(foreign)]).toEqual([]);
});
