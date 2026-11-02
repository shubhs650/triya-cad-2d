// M1-42: the generated benchmark drawings read back with the counts PRD §12 states, and the
// same geometry every run (the DWG bytes differ only by the save timestamps and ids).
import { Line } from '@node-projects/acad-ts';
import { readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  BENCH_100K,
  BENCH_GA,
  benchCounts,
  benchDocument,
  benchDwg,
  type BenchSpec,
} from './drawing.ts';

describe('generated benchmark drawings (M1-42, DEC-045)', () => {
  it('splits the entity mix exactly', () => {
    const c = benchCounts(BENCH_100K);
    expect(c).toEqual({
      LINE: 40_000,
      LWPOLYLINE: 15_000,
      CIRCLE: 10_000,
      ARC: 10_000,
      INSERT: 10_000,
      TEXT: 10_000,
      MTEXT: 5_000,
    });
    expect(Object.values(benchCounts(BENCH_GA)).reduce((a, b) => a + b)).toBe(25_000);
  });

  it('draws the same geometry every run', () => {
    const ends = () =>
      [...benchDocument(BENCH_GA).entities!]
        .filter((e): e is Line => e instanceof Line)
        .slice(0, 500)
        .map((l) => [l.startPoint.x, l.startPoint.y, l.endPoint.x, l.endPoint.y]);
    expect(ends()).toEqual(ends());
  });

  const check = (spec: BenchSpec) => () => {
    const bytes = benchDwg(spec);
    const doc = readCadDocument(bytes);
    const types = new Map<string, number>();
    for (const e of doc.entities ?? []) {
      const t = e.objectName;
      types.set(t, (types.get(t) ?? 0) + 1);
    }
    expect(Object.fromEntries(types)).toEqual(benchCounts(spec));
    const blocks = [...(doc.blockRecords ?? [])].filter((b) => b.name.startsWith('BENCH_SYMBOL_'));
    expect(blocks).toHaveLength(spec.blocks);
    const layouts = [...(doc.layouts ?? [])].filter((l) => l.name !== 'Model');
    expect(layouts).toHaveLength(spec.layouts);
    for (const l of layouts) expect([...(l.associatedBlock?.entities ?? [])]).toHaveLength(4);
    console.log(`${spec.name}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  };

  it('bench-ga: 25k entities, 30 blocks, 2 layouts', check(BENCH_GA));
  it('bench-100k: 100k entities, 50 blocks, 5 layouts', check(BENCH_100K), 120_000);
});
