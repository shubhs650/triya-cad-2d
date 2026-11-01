// M1-06 acceptance: a large drawing parses without blocking the main thread. The page measures
// its own timer ticks and how long pointer input waits for its handler while the worker
// parses; the test also times each pointer move's round trip through the browser.
// bench-100k.dwg is owner-provided (M1-26); until it exists, a 100k-entity DWG is generated
// here with acad-ts. It takes acad-ts a few seconds to parse, far longer than the budget.
import { expect, test, type Page } from '@playwright/test';
import { ACadVersion, largeDwg, sampleDwg } from '../../../packages/io/test/fixtures';
import { startHarness } from './harness';

/** RAIL: input handled within 100 ms feels instant. */
const BUDGET_MS = 100;
const ENTITIES = 100_000;
/**
 * A pointer round trip also crosses this test process and the browser process, which share
 * the CPU with other test workers, so it gets a looser bound than the in-page probes. Parsing
 * on the main thread would still hold a round trip for seconds.
 */
const ROUND_TRIP_MS = 250;

let harness: Awaited<ReturnType<typeof startHarness>>;
let big: Buffer;

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  harness = await startHarness();
  big = Buffer.from(largeDwg(ENTITIES));
});

test.afterAll(async () => {
  await harness?.close();
});

/**
 * Opens the harness and loads one tiny drawing first. In this dev build Vite transforms the
 * worker's modules on first request, inside this test process, which stalls the process (not
 * the page) and would show up as slow pointer round trips. A production build has no such step.
 */
async function open(page: Page): Promise<string> {
  await page.route('**/bench-100k.dwg', (route) => route.fulfill({ body: big }));
  await page.route('**/warm-up.dwg', (route) =>
    route.fulfill({ body: Buffer.from(sampleDwg(ACadVersion.AC1032)) }),
  );
  await page.goto(harness.url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });
  expect((await page.evaluate((f) => window.load(f), `${harness.url}warm-up.dwg`)).ok).toBe(true);
  return `${harness.url}bench-100k.dwg`;
}

/** Moves the pointer until `job` settles; returns the slowest move's round trip. */
async function movePointerDuring(page: Page, job: Promise<unknown>): Promise<number> {
  let done = false;
  void job.finally(() => (done = true));
  let slowest = 0;
  for (let i = 0; !done; i++) {
    const t = performance.now();
    // Acknowledged only once the page has dispatched the event.
    await page.mouse.move(100 + (i % 200), 100 + (i % 50));
    slowest = Math.max(slowest, performance.now() - t);
    await page.waitForTimeout(16);
  }
  return slowest;
}

test('the probes see a main-thread stall (control)', async ({ page }) => {
  await open(page);
  const job = page.evaluate(() => window.blockMainThread(600));
  await page.waitForTimeout(150);
  const slowestMove = await movePointerDuring(page, job);
  const res = await job;

  expect(res.maxTickGapMs).toBeGreaterThan(500);
  expect(res.inputEvents).toBeGreaterThan(0);
  expect(res.maxInputDelayMs).toBeGreaterThan(2 * BUDGET_MS);
  expect(slowestMove).toBeGreaterThan(2 * BUDGET_MS);
});

test('a 100k-entity DWG parses in the worker while the page stays responsive', async ({ page }) => {
  const file = await open(page);
  const job = page.evaluate((f) => window.load(f), file);
  const slowestMove = await movePointerDuring(page, job);
  const res = await job;

  expect(res.ok, res.error).toBe(true);
  expect(res.summary?.modelSpaceEntities).toEqual({ LINE: ENTITIES / 2, CIRCLE: ENTITIES / 2 });
  // Long enough that parsing on the main thread could not have hidden from the probes.
  expect(res.durationMs).toBeGreaterThan(5 * BUDGET_MS);
  expect(res.inputEvents).toBeGreaterThan(5);
  expect(res.maxTickGapMs).toBeLessThan(BUDGET_MS);
  expect(res.maxInputDelayMs).toBeLessThan(BUDGET_MS);
  expect(slowestMove).toBeLessThan(ROUND_TRIP_MS);
  expect(res.stages.map((s) => s.stage)).toEqual(['parse', 'summarize', 'done']);
  expect(res.mainThreadHasAcadTs).toBe(false);
  expect([res.workersCreated, res.workersTerminated]).toEqual([1, 1]);
  console.log(
    `M1-06: ${ENTITIES} entities (${(big.length / 1e6).toFixed(1)} MB) parsed in ` +
      `${res.durationMs.toFixed(0)} ms; max tick gap ${res.maxTickGapMs.toFixed(1)} ms, ` +
      `max input delay ${res.maxInputDelayMs.toFixed(1)} ms, ` +
      `slowest pointer round trip ${slowestMove.toFixed(1)} ms`,
  );
});

test('cancelling a load rejects with AbortError and terminates the worker', async ({ page }) => {
  const file = await open(page);
  const res = await page.evaluate((f) => window.load(f, { abortAfterStage: 'parse' }), file);

  expect(res).toMatchObject({
    ok: false,
    error: 'AbortError',
    workersCreated: 1,
    workersTerminated: 1,
  });
  // The job ends at the abort, not when the parse would have finished.
  expect(res.settleAfterAbortMs).toBeLessThan(BUDGET_MS);
  expect(res.stages.map((s) => s.stage)).toEqual(['parse']);
});
