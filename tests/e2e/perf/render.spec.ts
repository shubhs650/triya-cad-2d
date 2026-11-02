// Renderer budgets on synthetic 100k-entity drawings (TESTING.md §5; benchmarks are synthetic
// by DEC-045). The drawings are built in the page, so this measures the render side only:
// building the render replica, its index and tessellation, the first full frame (T2), and
// continuous pan/zoom (T3), in the render worker as the app runs it.
import { expect, test, type Page } from '@playwright/test';
import { startRenderHarness } from '../render-harness/server';

/** PRD §12 T2 (3 s) plus TESTING.md §5's 20 % runner margin. */
const T2_FIRST_FRAME_MS = 3000 * 1.2;
/** PRD §12 T3 (60 fps pan/zoom) less TESTING.md §5's 20 % runner margin. */
const T3_MIN_FPS = 60 * 0.8;

let harness: Awaited<ReturnType<typeof startRenderHarness>>;

test.beforeAll(async () => {
  harness = await startRenderHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

/** Loads the page and draws a tiny drawing once: Vite's first module transforms are not render time. */
async function warmUp(page: Page): Promise<void> {
  await page.goto(harness.url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });
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
}

test('T2 and T3: 100k synthetic entities in the render worker', async ({ page }, info) => {
  test.setTimeout(120_000);
  await warmUp(page);
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

  // M1-44: all 100k entities are in view, as at ZOOM Extents.
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
  expect(pan.fps).toBeGreaterThanOrEqual(T3_MIN_FPS);
});

test('T3: pan/zoom on the generated bench-100k drawing in the render worker', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await warmUp(page);
  const res = await page.evaluate(() =>
    window.setup({
      drawing: 'bench-100k',
      theme: 'dark',
      modes: ['worker'],
      width: 1280,
      height: 720,
    }),
  );
  expect(res.modes).toEqual({ worker: 'worker' });
  const pan = await page.evaluate(() => window.panZoom('worker', 5000));
  info.annotations.push(
    { type: 'bench-100k first frame (ms)', description: res.firstFrameMs['worker']!.toFixed(0) },
    { type: 'bench-100k pan/zoom (fps)', description: pan.fps.toFixed(1) },
    { type: 'bench-100k slowest frame (ms)', description: pan.maxFrameMs.toFixed(0) },
  );
  console.log(
    `render perf, bench-100k: first frame ${res.firstFrameMs['worker']!.toFixed(0)} ms; ` +
      `pan/zoom ${pan.fps.toFixed(1)} fps, slowest frame ${pan.maxFrameMs.toFixed(0)} ms`,
  );
  expect(pan.fps).toBeGreaterThanOrEqual(T3_MIN_FPS);
});
