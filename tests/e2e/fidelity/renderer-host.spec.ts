// M1-12 acceptance: the RendererHost main-thread fallback renders identically to the render
// worker. Both draw the same drawing side by side; their screenshots must match pixel for pixel,
// on a dark and a light canvas (ACI 7 follows the background), before and after an edit.
import { expect, test } from '@playwright/test';
import { startRenderHarness } from '../render-harness/server';

let harness: Awaited<ReturnType<typeof startRenderHarness>>;

test.beforeAll(async () => {
  harness = await startRenderHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the main-thread fallback matches the worker pixel for pixel (${theme})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(harness.url);
    await expect(page).toHaveTitle('ready', { timeout: 60_000 });

    const res = await page.evaluate(
      (theme) =>
        window.setup({
          drawing: 'sample',
          theme,
          modes: ['worker', 'main'],
          width: 400,
          height: 260,
        }),
      theme,
    );
    // Chromium can transfer canvases, so this really compares the two paths.
    expect(res.modes).toEqual({ worker: 'worker', main: 'main' });
    // The drawing is on screen, not a blank canvas matching a blank canvas.
    expect(res.ink).toBeGreaterThan(2000);

    const worker = page.locator('#worker');
    const main = page.locator('#main');
    expect(Buffer.compare(await worker.screenshot(), await main.screenshot())).toBe(0);

    const inkAfter = await page.evaluate(() => window.edit());
    expect(inkAfter).not.toBe(res.ink);
    expect(Buffer.compare(await worker.screenshot(), await main.screenshot())).toBe(0);
    expect(errors).toEqual([]);
  });
}
