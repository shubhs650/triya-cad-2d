// Proves that engine-side packages reject browser globals at lint time
// (CLAUDE.md "No DOM in the engine"; .claude/rules/engine-no-dom.md).
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: root });

const NO_DOM = [
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
const DOM_OK = ['packages/render', 'packages/ui', 'apps/web'];
const GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'fetch'];

async function restrictedGlobalErrors(file: string, code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-globals').length;
}

describe('no DOM in engine-side packages', () => {
  it.each(NO_DOM.flatMap((pkg) => GLOBALS.map((g) => ({ pkg, g }))))(
    '$g in packages/$pkg is a lint error',
    async ({ pkg, g }) => {
      const code = `export const leak = ${g};\n`;
      expect(await restrictedGlobalErrors(`packages/${pkg}/src/leak.ts`, code)).toBe(1);
    },
  );

  it.each(DOM_OK)('browser globals are allowed in %s', async (dir) => {
    const code = `export const ok = [window, document, navigator];\n`;
    expect(await restrictedGlobalErrors(`${dir}/src/ok.ts`, code)).toBe(0);
  });

  it('the engine package loads in plain Node', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    await expect(import('@triya/engine')).resolves.toBeDefined();
  });
});
