import { defineConfig, devices } from '@playwright/test';

// Browser test suites (docs/TESTING.md §1). Each `pnpm test:<suite>` runs one project.
// Suites start empty and pass with no tests until their roadmap tasks add specs:
// fidelity → M1-24, perf → M1-22/M1-12, offline → first apps/web task, ui → M1-22.
// The app web server is wired in by M1-22 once apps/web has a build.
const suite = (name: string) => ({
  name,
  testDir: `./tests/e2e/${name}`,
  testMatch: '**/*.spec.ts',
  use: { ...devices['Desktop Chrome'] },
});

export default defineConfig({
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  projects: [suite('fidelity'), suite('offline'), suite('ui'), suite('perf')],
});
