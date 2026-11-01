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
  },
});
