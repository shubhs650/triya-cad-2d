// M1-67: each open drawing's document lives in its own engine worker, started when the drawing
// opens and ended when its tab closes. (The edits it applies reach the canvas through M1-23's
// layer toggles; the session and replica staying in step is tested in Node.)
import path from 'node:path';
import { expect, test, type Worker } from '@playwright/test';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('a drawing runs in its own engine worker until its tab closes', async ({ page }) => {
  const engines: Worker[] = [];
  page.on('worker', (w) => {
    if (w.url().includes('engine/worker')) engines.push(w);
  });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect.poll(() => engines.length).toBe(1);

  const closed = new Promise<void>((resolve) => engines[0]!.on('close', () => resolve()));
  await page.getByRole('button', { name: `Close ${path.basename(DXF)}` }).click();
  await closed;
});
