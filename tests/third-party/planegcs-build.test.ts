// Guards for the PlaneGCS snapshot and its WASM build (M9-01, third_party/planegcs/README.md).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const planegcs = path.join(root, 'third_party/planegcs');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Files under `dir`, leaving out build.sh's download cache (`.cache/`, gitignored). */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === '.cache') return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('third_party/planegcs', () => {
  it('src/ and LICENSE are byte-identical to the FreeCAD snapshot (local changes are patches)', () => {
    const manifest = readFileSync(path.join(planegcs, 'UPSTREAM.sha256'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/) as [string, string]);
    const listed = manifest.map(([, f]) => f).sort();
    const present = [
      ...readdirSync(path.join(planegcs, 'src')).map((f) => `src/${f}`),
      'LICENSE',
    ].sort();
    expect(present).toEqual(listed);
    for (const [hash, f] of manifest) expect(sha256(path.join(planegcs, f)), f).toBe(hash);
  });

  it('every patch applies to the snapshot in order', () => {
    const work = mkdtempSync(path.join(tmpdir(), 'planegcs-'));
    try {
      cpSync(path.join(planegcs, 'src'), work, { recursive: true });
      const patches = readdirSync(path.join(planegcs, 'patches'))
        .filter((f) => f.endsWith('.patch'))
        .sort();
      expect(patches.length).toBeGreaterThan(0);
      for (const p of patches) {
        execFileSync('patch', ['-s', '-d', work, '-p1', '-i', path.join(planegcs, 'patches', p)]);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('ships no Boost or Eigen code: the stand-in headers are Triya’s own (DEC-080)', () => {
    for (const f of walk(path.join(planegcs, 'shim'))) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/^\/\/ Triya stand-in/);
    }
    expect(walk(planegcs).filter((f) => /eigen/i.test(path.relative(planegcs, f)))).toEqual([]);
  });

  it('the committed module matches its inputs (run `pnpm planegcs:build` after changing them)', () => {
    // Exits 1, failing the test, when a source, patch, stand-in, binding or build.sh changed
    // without a rebuild, or the built files changed without their inputs.
    execFileSync('node', [path.join(root, 'scripts/planegcs-stamp.mjs'), '--check'], {
      stdio: 'pipe',
    });
  });
});
