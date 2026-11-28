// M10-02: the ezdxf audit sweep keeps every AC1032 DXF save the suites make through
// `saveAc1032Dxf`, not only the gate's named saves (`writeAuditSave`), for
// scripts/dxf-audit/sweep.py. A save is kept once by its content and lists each test that made it.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepSweepSave, sweepDir } from './saves.ts';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'triya-sweep-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the DXF audit sweep (M10-02)', () => {
  it('is off unless TRIYA_DXF_SWEEP_DIR names a directory', () => {
    expect(sweepDir({})).toBeUndefined();
    expect(sweepDir({ TRIYA_DXF_SWEEP_DIR: '' })).toBeUndefined();
    expect(sweepDir({ TRIYA_DXF_SWEEP_DIR: '/x' })).toBe('/x');
  });

  it('keeps a save once by its content and lists every test that made it', () => {
    const dir = tempDir();
    keepSweepSave(bytes('  0\nEOF\n'), { file: 'packages/a.test.ts', name: 'a > one' }, dir);
    keepSweepSave(bytes('  0\nEOF\n'), { file: 'packages/b.test.ts', name: 'b > two' }, dir);
    keepSweepSave(bytes('  0\nEOF\n\n'), { file: 'packages/a.test.ts', name: 'a > three' }, dir);
    const saves = readdirSync(dir).filter((n) => n.endsWith('.dxf'));
    expect(saves).toHaveLength(2);
    const first = saves.find((n) => readFileSync(join(dir, n), 'utf8') === '  0\nEOF\n')!;
    expect(first).toMatch(/^[0-9a-f]{40}\.dxf$/);
    const tests = readFileSync(join(dir, first.replace(/\.dxf$/, '.tests.txt')), 'utf8')
      .trim()
      .split('\n');
    expect(tests).toEqual(['packages/a.test.ts\ta > one', 'packages/b.test.ts\tb > two']);
  });

  it('writes nothing when the sweep is off', () => {
    const dir = tempDir();
    vi.stubEnv('TRIYA_DXF_SWEEP_DIR', '');
    keepSweepSave(bytes('x'), { file: 'f', name: 'n' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('is fed by saveAc1032Dxf, naming the test file from the repository root', async () => {
    const dir = tempDir();
    vi.stubEnv('TRIYA_DXF_SWEEP_DIR', dir);
    const { saveAc1032Dxf } = await import('./saves.ts');
    const { readCadDocument, documentInit } = await import('@triya/io');
    const { DocumentModel } = await import('@triya/engine');
    const path = new URL(
      '../../../../corpus/public/third-party/ezdxf/examples_dxf/colors.dxf',
      import.meta.url,
    );
    const source = new Uint8Array(readFileSync(path));
    const model = DocumentModel.create(documentInit(readCadDocument(source)));
    const saved = saveAc1032Dxf(readCadDocument(source), model);
    const saves = readdirSync(dir).filter((n) => n.endsWith('.dxf'));
    expect(saves).toHaveLength(1);
    expect(new Uint8Array(readFileSync(join(dir, saves[0]!)))).toEqual(saved);
    const tests = readFileSync(join(dir, saves[0]!.replace(/\.dxf$/, '.tests.txt')), 'utf8');
    expect(tests).toBe(
      'packages/testkit/src/dxf-audit/sweep.test.ts\tthe DXF audit sweep (M10-02) > ' +
        'is fed by saveAc1032Dxf, naming the test file from the repository root\n',
    );
  });
});
