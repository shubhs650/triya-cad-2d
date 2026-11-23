// PlaneGCS in the browser (M9-01): the solver module loads only when first asked for, and a
// 50-constraint sketch solves in under 20 ms (PRD FR-X3; the Node half of the acceptance is
// packages/constraints/test/planegcs.test.ts). The page is the render harness's
// constraints.html, which imports @triya/constraints from source as the app does.
import { expect, test } from '@playwright/test';
import { startRenderHarness } from '../render-harness/server';

/** M9-01's acceptance: a 50-constraint sketch solves in < 20 ms. */
const SOLVE_50_MS = 20;

let harness: Awaited<ReturnType<typeof startRenderHarness>>;

test.beforeAll(async () => {
  harness = await startRenderHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

test('PlaneGCS loads lazily and solves a 50-constraint sketch in < 20 ms', async ({
  page,
}, info) => {
  const solverRequests: string[] = [];
  page.on('request', (r) => {
    // In dev, the page's `planegcs.wasm?url` import is a module that only holds the URL
    // (`?import&url`): that is not the solver.
    if (/planegcs\.(mjs|wasm)(?!\?import)/.test(r.url())) solverRequests.push(r.url());
  });
  await page.goto(`${harness.url}constraints.html`);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });
  // The page is up and nothing of the solver has been fetched.
  expect(solverRequests).toEqual([]);

  const res = await page.evaluate(() => window.solveFifty(5));
  expect(solverRequests.some((u) => u.includes('planegcs.mjs'))).toBe(true);
  expect(solverRequests.some((u) => u.includes('planegcs.wasm'))).toBe(true);

  expect(res.statuses).toEqual([0, 0, 0, 0, 0]);
  expect(res.constraints).toBeGreaterThanOrEqual(50);
  expect(res.dofs).toBe(0);
  expect(res.conflicting).toEqual([]);
  // Best of five, after a warm-up run: one slow run on a busy CI runner is scheduling noise.
  const best = Math.min(...res.solveMs);
  info.annotations.push({
    type: 'perf',
    description: `PlaneGCS 50 constraints: load ${res.loadMs.toFixed(1)} ms, solve best ${best.toFixed(2)} ms (runs ${res.solveMs.map((t) => t.toFixed(2)).join(', ')})`,
  });
  console.log(info.annotations.at(-1)?.description);
  expect(best).toBeLessThan(SOLVE_50_MS);
});
