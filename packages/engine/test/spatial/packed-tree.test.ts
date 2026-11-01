// The static packed R-tree under each block's index (M1-07): every query must return exactly
// the live items whose boxes overlap the query box, the same as a linear scan.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boxesOverlap, type Box } from '../../src/index';
import { PackedRTree } from '../../src/spatial/packed-tree';

const boxArb = fc
  .tuple(
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.double({ min: -1000, max: 1000, noNaN: true }),
    fc.double({ min: 0, max: 200, noNaN: true }),
    fc.double({ min: 0, max: 200, noNaN: true }),
  )
  .map(([x, y, w, h]): Box => ({ minX: x, minY: y, maxX: x + w, maxY: y + h }));

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

function scan(items: { id: number; box: Box }[], q: Box, dead: Set<number>): number[] {
  return sorted(
    items.filter((it) => !dead.has(it.id) && boxesOverlap(it.box, q, 0)).map((it) => it.id),
  );
}

describe('PackedRTree', () => {
  it('answers like a linear scan, including after items are killed', () => {
    fc.assert(
      fc.property(
        fc.array(boxArb, { maxLength: 400 }),
        fc.array(boxArb, { minLength: 1, maxLength: 10 }),
        fc.array(fc.nat(), { maxLength: 50 }),
        fc.integer({ min: 2, max: 20 }),
        (boxes, queries, kills, nodeSize) => {
          const items = boxes.map((box, i) => ({ id: i + 1, box }));
          const tree = PackedRTree.build(items, nodeSize);
          const dead = new Set<number>();
          for (const k of kills) {
            if (items.length === 0) break;
            const id = (k % items.length) + 1;
            expect(tree.kill(id)).toBe(!dead.has(id));
            dead.add(id);
          }
          expect(tree.deadCount).toBe(dead.size);
          for (const q of queries) {
            const out: number[] = [];
            tree.search(q, out);
            expect(sorted(out)).toEqual(scan(items, q, dead));
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('returns whole subtrees for a query covering everything', () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      box: {
        minX: i % 100,
        minY: Math.floor(i / 100),
        maxX: (i % 100) + 0.5,
        maxY: Math.floor(i / 100) + 0.5,
      },
    }));
    const tree = PackedRTree.build(items);
    const out: number[] = [];
    tree.search({ minX: -1, minY: -1, maxX: 1000, maxY: 1000 }, out);
    expect(out.length).toBe(5000);
    tree.kill(17);
    out.length = 0;
    tree.search({ minX: -1, minY: -1, maxX: 1000, maxY: 1000 }, out);
    expect(out.length).toBe(4999);
    expect(out).not.toContain(17);
  });

  it('handles empty trees, unknown ids and degenerate (all equal) boxes', () => {
    const empty = PackedRTree.build([]);
    const out: number[] = [];
    empty.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, out);
    expect(out).toEqual([]);
    expect(empty.kill(3)).toBe(false);
    const same = PackedRTree.build(
      Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        box: { minX: 2, minY: 2, maxX: 2, maxY: 2 },
      })),
    );
    same.search({ minX: 2, minY: 2, maxX: 2, maxY: 2 }, out);
    expect(out.length).toBe(50);
    expect(same.size).toBe(50);
  });
});
