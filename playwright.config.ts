import { defineConfig, devices } from '@playwright/test';

// Browser test suites (docs/TESTING.md §1). Each `pnpm test:<suite>` runs one project.
// Suites pass with no tests until their roadmap tasks add specs (fidelity → M1-24).
// io (M0-03) proves the @triya/io worker in a real browser; it starts its own Vite dev server.
// ui and offline (M1-22) drive the app: each spec file starts apps/web's Vite dev server
// (tests/e2e/app/server.ts) on a free port, so suites and workers never share one.
// The suites that drive the app get the ribbon's 70 px (M7-01) on top of Desktop Chrome's
// 1280 × 720, so the drawing area keeps the size their pixel and ink measures were set at.
const APP_SUITES = new Set(['ui', 'offline', 'perf']);
const suite = (name: string) => ({
  name,
  testDir: `./tests/e2e/${name}`,
  testMatch: '**/*.spec.ts',
  use: {
    ...devices['Desktop Chrome'],
    ...(APP_SUITES.has(name) && { viewport: { width: 1280, height: 790 } }),
  },
});

export default defineConfig({
  // Pre-bundles the dev servers' dependencies before any worker starts one (M2-67).
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  // The fidelity reporter writes the entity-level report after a golden-image run (M1-106).
  reporter: [
    ['list'],
    ...(process.env['CI'] ? [['html', { open: 'never' }] as const] : []),
    ['./tests/e2e/fidelity/report.ts'],
    // Per-file durations for CI's balanced UI shards (DEC-075); writes only with TRIYA_PW_TIMINGS.
    ['./tests/e2e/timings-reporter.ts'],
  ],
  outputDir: 'test-results',
  projects: [suite('fidelity'), suite('offline'), suite('ui'), suite('perf'), suite('io')],
});
