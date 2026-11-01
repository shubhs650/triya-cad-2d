// ESLint flat config for the whole monorepo. One config, linted from the root, so the
// module-boundary graph below is enforced across every package in a single pass.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Allowed dependency edges, copied from docs/ARCHITECTURE.md §2. Anything not listed is a
 * lint error. Change this table only together with ARCHITECTURE.md and a DECISIONS.md entry.
 * `typesOnly` edges may be used with `import type` only.
 */
export const DEPENDENCY_GRAPH = {
  web: [
    'ui',
    'render',
    'engine',
    'io',
    'text',
    'hatch',
    'dims',
    'constraints',
    'library',
    'compare',
    'pdf',
  ],
  ui: [],
  render: ['engine', 'text', 'hatch', 'dims'],
  io: ['engine', 'text', 'hatch', 'dims', 'pdf'],
  dims: ['engine', 'text'],
  hatch: ['engine'],
  text: [],
  constraints: ['engine'],
  library: ['engine'],
  compare: ['engine'],
  pdf: ['render', 'engine'],
  engine: [],
  // Test-only harness (DEC-032): may reach the file layer and renderer to drive round-trip,
  // fidelity and perf tests. Only test files may import it.
  testkit: ['engine', 'io', 'render', 'text', 'hatch', 'dims', 'pdf'],
};

/** `ui → engine (types only)` in ARCHITECTURE.md §2. */
export const TYPE_ONLY_EDGES = { ui: ['engine'] };

/**
 * Packages that must run in Node and in a Web Worker (CLAUDE.md "No DOM in the engine").
 * Their tsconfig omits the DOM lib; this list adds a lint error on top so the failure is
 * immediate and names the rule.
 */
export const NO_DOM_PACKAGES = [
  'engine',
  'io',
  'text',
  'hatch',
  'dims',
  'constraints',
  'library',
  'compare',
  'pdf',
];

const BROWSER_ONLY_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'requestAnimationFrame',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
].map((name) => ({
  name,
  message:
    'No DOM or browser APIs in engine-side packages (CLAUDE.md). Inject an abstraction such as FontSource, Clock or Storage instead.',
}));

const elementOf = (type) =>
  type === 'web' ? { type, pattern: 'apps/web' } : { type, pattern: `packages/${type}` };

const policies = [
  ...Object.entries(DEPENDENCY_GRAPH).map(([from, to]) => ({
    from: { element: { type: from } },
    allow: { to: { element: { types: { anyOf: [from, ...to] } } } },
  })),
  ...Object.entries(TYPE_ONLY_EDGES).map(([from, to]) => ({
    from: { element: { type: from } },
    allow: {
      to: { element: { types: { anyOf: to } } },
      dependency: { kind: 'type' },
    },
  })),
  // Any test file may use the test harness, wherever it lives.
  {
    from: { file: { categories: { anyOf: ['test'] } } },
    allow: { to: { element: { type: 'testkit' } } },
  },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.turbo/**',
      'third_party/**',
      'corpus/**',
      'test-results/**',
      'test-reports/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Module boundaries (docs/ARCHITECTURE.md §2).
  {
    files: ['apps/*/**/*.{ts,tsx,js,mjs}', 'packages/*/**/*.{ts,tsx,js,mjs}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.base.json' },
      },
      'boundaries/elements': Object.keys(DEPENDENCY_GRAPH).map(elementOf),
      'boundaries/files': [{ category: 'test', pattern: '**/*.{test,spec}.{ts,tsx}' }],
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies }],
    },
  },
  // Engine-side packages run in Node and Web Workers only.
  {
    files: NO_DOM_PACKAGES.map((p) => `packages/${p}/**/*.{ts,tsx,js,mjs}`),
    languageOptions: { globals: { ...globals.es2023 } },
    rules: { 'no-restricted-globals': ['error', ...BROWSER_ONLY_GLOBALS] },
  },
  {
    files: ['apps/web/**', 'packages/render/**', 'packages/ui/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/testkit/**', 'scripts/**', 'tests/**', '*.config.{js,ts,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
