import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  compareToHandleBaseline,
  declaredHandles,
  documentHandles,
  handleCoverage,
  toHandleBaseline,
  type HandleCoverage,
} from './handle-coverage.ts';

const corpus = (path: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );
const ascii = (pairs: [number, string][]): Uint8Array =>
  new TextEncoder().encode(pairs.map(([c, v]) => `${String(c).padStart(3)}\n${v}\n`).join(''));

describe('declaredHandles', () => {
  it('reads 5 and 105 from ASCII DXF, outside HEADER and CLASSES, with the record type', () => {
    const bytes = ascii([
      [0, 'SECTION'],
      [2, 'HEADER'],
      [9, '$HANDSEED'],
      [5, 'FFFF'],
      [0, 'ENDSEC'],
      [0, 'SECTION'],
      [2, 'TABLES'],
      [0, 'TABLE'],
      [2, 'DIMSTYLE'],
      [5, 'A'],
      [0, 'DIMSTYLE'],
      [105, '1B'],
      [2, 'STANDARD'],
      // R12 and later: DIMSTYLE group 5 is DIMBLK (a block name), never a handle.
      [5, 'DOT'],
      [0, 'ENDTAB'],
      [0, 'ENDSEC'],
      [0, 'SECTION'],
      [2, 'ENTITIES'],
      [0, 'LINE'],
      [5, '2c'],
      [0, 'TEXT'],
      [5, 'not-hex'],
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ]);
    const declared = declaredHandles(bytes);
    expect(declared.source).toBe('dxf-ascii');
    expect([...declared.handles]).toEqual([
      [0xa, 'TABLE'],
      [0x1b, 'DIMSTYLE'],
      [0x2c, 'LINE'],
    ]);
  });

  it('reads binary DXF (R12 one-byte and R13+ two-byte group codes) like its ASCII twin', () => {
    // The twins were saved separately, so their handle values differ; their objects do not.
    const tally = (m: Map<number, string>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const t of m.values()) out[t] = (out[t] ?? 0) + 1;
      return out;
    };
    for (const v of ['AC1009', 'AC1015']) {
      const bin = declaredHandles(corpus(`third-party/acadsharp/sample_${v}_binary.dxf`));
      const txt = declaredHandles(corpus(`third-party/acadsharp/sample_${v}_ascii.dxf`));
      expect(bin.source, v).toBe('dxf-binary');
      expect(bin.handles.size, v).toBeGreaterThan(1000);
      expect(tally(bin.handles), v).toEqual(tally(txt.handles));
    }
  });

  it('reads the DWG handle map and names each object by its record type', () => {
    const bytes = corpus('third-party/acadsharp/sample_AC1032.dwg');
    const declared = declaredHandles(bytes, readCadDocument(bytes).classes);
    expect(declared.source).toBe('dwg-handle-map');
    expect(declared.handles.size).toBeGreaterThan(500);
    const types = new Set(declared.handles.values());
    expect(types).toContain('LINE');
    expect(types).toContain('DICTIONARY');
    expect(types).toContain('BLOCKVISIBILITYPARAMETER'); // a DXF class, named from CLASSES
    expect(types).not.toContain('?');
  });

  it('refuses a stream it cannot scan instead of reporting zero handles', () => {
    expect(() => declaredHandles(new Uint8Array([1, 2, 3]))).toThrow(/cannot list/);
  });
});

describe('documentHandles', () => {
  it('includes vertices, attributes and their SEQENDs, which acad-ts keeps inside the owner', () => {
    const bytes = corpus('third-party/ezdxf/examples_dxf/multi_insert_with_attribs.dxf');
    const have = documentHandles(readCadDocument(bytes));
    // POLYLINE 31: VERTEX 33–36, SEQEND 32. INSERT 3B: ATTRIB 3D–3F, SEQEND 3C.
    for (const h of [0x31, 0x32, 0x33, 0x36, 0x3b, 0x3c, 0x3d, 0x3f]) expect(have).toContain(h);
  });
});

describe('handleCoverage', () => {
  const declared = new Map([
    [1, 'LINE'],
    [2, 'VISUALSTYLE'],
    [3, 'XRECORD'],
    [4, 'DICTIONARY'],
  ]);

  it('reports each declared handle missing after the save, and where it went missing', () => {
    const cov = handleCoverage(declared, new Set([1, 2, 4]), new Set([1, 4, 99]));
    expect(cov.declared).toBe(4);
    expect(cov.lost).toEqual([
      { handle: '2', type: 'VISUALSTYLE', stage: 'save' },
      { handle: '3', type: 'XRECORD', stage: 'read' },
    ]);
  });

  it('is empty when every declared handle comes back', () => {
    expect(handleCoverage(declared, new Set([1, 2, 3, 4]), new Set([1, 2, 3, 4])).lost).toEqual([]);
  });
});

describe('handle-coverage ratchet', () => {
  const cov = (lost: [string, string][]): HandleCoverage => ({
    source: 'dxf-ascii',
    declared: 10,
    lost: lost.map(([handle, type]) => ({ handle, type, stage: 'save' })),
  });
  const baseline = toHandleBaseline([
    {
      path: 'a.dxf',
      coverage: cov([
        ['2', 'VISUALSTYLE'],
        ['3', 'VISUALSTYLE'],
        ['A', 'XRECORD'],
      ]),
    },
    { path: 'b.dxf', coverage: cov([]) },
    { path: 'c.dxf', unscanned: 'read-error' },
  ]);

  it('records lost handles per file grouped by type, and why a file was not scanned', () => {
    expect(baseline.files).toEqual({
      'a.dxf': { declared: 10, lost: { VISUALSTYLE: '2 3', XRECORD: 'A' } },
      'b.dxf': { declared: 10, lost: {} },
      'c.dxf': { unscanned: 'read-error' },
    });
  });

  it('fails on a newly lost handle even when the count stays the same', () => {
    const cmp = compareToHandleBaseline(
      [
        {
          path: 'a.dxf',
          coverage: cov([
            ['2', 'VISUALSTYLE'],
            ['3', 'VISUALSTYLE'],
            ['B', 'XRECORD'],
          ]),
        },
        { path: 'b.dxf', coverage: cov([['5', 'LINE']]) },
        { path: 'c.dxf', unscanned: 'read-error' },
      ],
      baseline,
    );
    expect(cmp.regressions).toEqual(['a.dxf: B XRECORD', 'b.dxf: 5 LINE']);
    expect(cmp.improvements).toEqual(['a.dxf: A XRECORD']);
  });

  it('fails when a scanned file stops being scanned, and on files it does not know', () => {
    const cmp = compareToHandleBaseline(
      [
        { path: 'a.dxf', unscanned: 'write-error' },
        { path: 'b.dxf', coverage: cov([]) },
        { path: 'c.dxf', coverage: cov([]) },
        { path: 'd.dxf', coverage: cov([]) },
      ],
      baseline,
    );
    expect(cmp.regressions).toEqual(['a.dxf: no longer scanned (write-error)']);
    expect(cmp.improvements).toEqual(['c.dxf: now scanned']);
    expect(cmp.added).toEqual(['d.dxf']);
  });
});
