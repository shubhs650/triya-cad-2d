import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit, command and round-trip tests run in plain Node (docs/TESTING.md §1).
// `*.test.ts` is Vitest; `*.spec.ts` under tests/e2e is Playwright.
export default defineConfig({
  resolve: {
    alias: [
      {
        // Same mapping as tsconfig.base.json `paths`: packages are consumed from source.
        find: /^@triya\/([a-z-]+)$/,
        replacement: fileURLToPath(new URL('./packages/$1/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'packages/*/{src,test}/**/*.test.ts',
      'apps/*/{src,test}/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    testTimeout: 30_000,
    // Coverage gates (`pnpm test` runs with --coverage). M1-02 requires >= 95 % branch coverage
    // of the geometry kernel; add a glob here when another package's task sets a gate. M2-01 gates
    // the command engine (prompt bus, parser) at 90 %.
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/geom/**/*.ts', 'packages/engine/src/commands/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'test-reports/coverage',
      thresholds: {
        'packages/engine/src/geom/**/*.ts': {
          branches: 95,
          lines: 95,
          functions: 95,
          statements: 95,
        },
        'packages/engine/src/commands/**/*.ts': {
          branches: 90,
          lines: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
