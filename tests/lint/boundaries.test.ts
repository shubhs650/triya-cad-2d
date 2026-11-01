// Proves the module-boundary graph in docs/ARCHITECTURE.md §2 is enforced by `pnpm lint`.
// Each case lints a virtual source file placed inside a package and checks whether the
// boundaries rule reports it. The table mirrors the architecture doc, so a change to either
// without the other fails here.
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

const PACKAGES = [
  'engine',
  'io',
  'render',
  'text',
  'hatch',
  'dims',
  'constraints',
  'library',
  'compare',
  'pdf',
  'ui',
  'testkit',
] as const;
type Element = (typeof PACKAGES)[number] | 'web';

// ARCHITECTURE.md §2, value imports. `ui → engine` is type-only and covered separately.
const ALLOWED: Record<Element, readonly Element[]> = {
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
  testkit: ['engine', 'io', 'render', 'text', 'hatch', 'dims', 'pdf'],
};

const dirOf = (e: Element) => (e === 'web' ? 'apps/web' : `packages/${e}`);

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId?.startsWith('boundaries/'))
    .map((m) => m.message);
}

const valueImport = (to: Element) =>
  `import * as dep from '@triya/${to}';\nexport const used = dep;\n`;

const elements: Element[] = ['web', ...PACKAGES];
const edges = elements.flatMap((from) =>
  elements.filter((to) => to !== from).map((to) => ({ from, to })),
);
const allowed = edges.filter(({ from, to }) => ALLOWED[from].includes(to));
const forbidden = edges.filter(({ from, to }) => !ALLOWED[from].includes(to));

describe('module boundaries (ARCHITECTURE.md §2)', () => {
  it('has a forbidden edge for every direction not in the graph', () => {
    // Guards against the table silently allowing everything.
    expect(forbidden.length).toBeGreaterThan(100);
    expect(forbidden).toContainEqual({ from: 'engine', to: 'render' });
  });

  it.each(forbidden)('$from → $to is a lint error', async ({ from, to }) => {
    const errors = await boundaryErrors(`${dirOf(from)}/src/violation.ts`, valueImport(to));
    expect(errors).toHaveLength(1);
  });

  it.each(allowed)('$from → $to is allowed', async ({ from, to }) => {
    const errors = await boundaryErrors(`${dirOf(from)}/src/ok.ts`, valueImport(to));
    expect(errors).toEqual([]);
  });

  it('ui → engine is allowed for type-only imports', async () => {
    const code = `import type { Placeholder } from '@triya/engine';\nexport type T = Placeholder;\n`;
    expect(await boundaryErrors('packages/ui/src/ok.ts', code)).toEqual([]);
  });

  it('ui → engine value import is a lint error', async () => {
    expect(
      await boundaryErrors('packages/ui/src/violation.ts', valueImport('engine')),
    ).toHaveLength(1);
  });

  it('production code may not import the test harness', async () => {
    expect(
      await boundaryErrors('packages/engine/src/violation.ts', valueImport('testkit')),
    ).toHaveLength(1);
  });

  it('test files anywhere may import the test harness', async () => {
    expect(await boundaryErrors('packages/engine/src/x.test.ts', valueImport('testkit'))).toEqual(
      [],
    );
    expect(await boundaryErrors('packages/io/test/x.test.ts', valueImport('testkit'))).toEqual([]);
  });

  it('relative imports that escape a package are checked too', async () => {
    const code = `import * as r from '../../render/src/index';\nexport const used = r;\n`;
    expect(await boundaryErrors('packages/engine/src/violation.ts', code)).toHaveLength(1);
  });
});
