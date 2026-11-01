// Renderer budgets on a synthetic 100k-entity drawing (TESTING.md §5), until the owner's
// bench-100k.dwg lands (M1-26). The drawing is built in the page, so this measures the render
// side of T2 only: building the render replica, its index and tessellation, and the first
// full frame, in the render worker as the app runs it.
import { expect, test } from '@playwright/test';
import { startRenderHarness } from '../render-harness/server';

/** PRD §12 T2 (3 s) plus TESTING.md §5's 20 % runner margin. */
const T2_FIRST_FRAME_MS = 3000 * 1.2;

let harness: Awaited<ReturnType<typeof startRenderHarness>>;

test.beforeAll(async () => {
  harness = await startRenderHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

test('T2: first full frame of 100k entities in the render worker', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto(harness.url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });
  // Warm-up: Vite's first transform of the worker and engine modules is not render time.
  await page.evaluate(() =>
    window.setup({
      drawing: 'synthetic',
      count: 100,
      theme: 'dark',
      modes: ['worker'],
      width: 64,
      height: 64,
    }),
  );
  await page.reload();
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });

  const res = await page.evaluate(() =>
    window.setup({
      drawing: 'synthetic',
      count: 100_000,
      theme: 'dark',
      modes: ['worker'],
      width: 1280,
      height: 720,
    }),
  );
  expect(res.modes).toEqual({ worker: 'worker' });
  const firstFrame = res.firstFrameMs['worker']!;

  // T3 is reported, not yet enforced: M1-44 owns reaching 60 fps (see ROADMAP.md).
  const pan = await page.evaluate(() => window.panZoom('worker', 5000));
  info.annotations.push(
    { type: 'T2 first frame (ms)', description: firstFrame.toFixed(0) },
    { type: 'T3 pan/zoom (fps)', description: pan.fps.toFixed(1) },
    { type: 'T3 slowest frame (ms)', description: pan.maxFrameMs.toFixed(0) },
  );
  console.log(
    `render perf, 100k entities: first frame ${firstFrame.toFixed(0)} ms; ` +
      `pan/zoom ${pan.fps.toFixed(1)} fps, slowest frame ${pan.maxFrameMs.toFixed(0)} ms`,
  );
  expect(firstFrame).toBeLessThan(T2_FIRST_FRAME_MS);
  expect(pan.frames).toBeGreaterThan(0);
});
