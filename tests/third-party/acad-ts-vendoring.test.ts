// Guards for the vendored acad-ts snapshot (DEC-033, third_party/acad-ts/PATCHES.md).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const vendored = path.join(root, 'third_party/acad-ts');
const patchDir = path.join(root, 'third_party/acad-ts-patches');
const patchesMd = readFileSync(path.join(vendored, 'PATCHES.md'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    // dist/ is the local build output (gitignored), not vendored content.
    if (e.name === 'dist' || e.name === 'node_modules') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const patchFiles = readdirSync(patchDir)
  .filter((f) => f.endsWith('.patch'))
  .sort();

describe('third_party/acad-ts vendoring', () => {
  it('contains no Autodesk-format asset files (CLAUDE.md: no Autodesk assets)', () => {
    const forbidden = /\.(shx|shp|pat|lin|ctb|stb|dwt|pdf)$/i;
    expect(walk(vendored).filter((f) => forbidden.test(f))).toEqual([]);
  });

  it('vendors only the paths PATCHES.md lists (plus PATCHES.md itself)', () => {
    const top = readdirSync(vendored).filter((n) => n !== 'dist' && n !== 'node_modules');
    expect(top.sort()).toEqual(
      ['LICENSE', 'PATCHES.md', 'README.md', 'package.json', 'src', 'tsconfig.json'].sort(),
    );
  });

  it('records a full 40-hex pinned upstream commit', () => {
    expect(patchesMd).toMatch(/Pinned commit \| `[0-9a-f]{40}`/);
  });

  it('documents every patch file in PATCHES.md, in order', () => {
    expect(patchFiles.length).toBeGreaterThan(0);
    for (const [i, file] of patchFiles.entries()) {
      expect(file.startsWith(String(i + 1).padStart(4, '0') + '-')).toBe(true);
      expect(patchesMd).toContain(`third_party/acad-ts-patches/${file}`);
    }
  });

  // Later patches may change lines an earlier one touched (0020 edits the header flag word 0004
  // decodes), so a patch is checked against the tree as it was right after it: undo the patches
  // newest first on a copy of the sources, each of which must reverse-apply cleanly.
  const unwound = mkdtempSync(path.join(tmpdir(), 'acad-ts-unwind-'));
  cpSync(path.join(vendored, 'src'), path.join(unwound, 'src'), { recursive: true });
  afterAll(() => rmSync(unwound, { recursive: true, force: true }));

  it.each([...patchFiles].reverse())('has %s applied to the vendored tree', (file) => {
    // A patch that reverse-applies cleanly is present in the tree as written.
    expect(() =>
      execFileSync('git', ['apply', '--reverse', path.join(patchDir, file)], {
        cwd: unwound,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
