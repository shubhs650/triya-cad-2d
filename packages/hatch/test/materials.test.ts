// The bundled material and architectural patterns (M4-12): `assets/patterns/triya-materials.pat`,
// made from motifs (strokes and dots repeated on a tile lattice). These tests draw each pattern
// with the same code a HATCH draws with and check, independently of how the .pat lines were
// worked out, that what is drawn is the motif and nothing else, once per tile.
//
//   TRIYA_UPDATE_PATTERNS=1 npx vitest run packages/hatch/test/materials.test.ts
// rewrites the asset from the motifs after a change to them.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HatchLoop } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  MATERIAL_MOTIFS,
  bundledPatterns,
  hatchPattern,
  materialPatternNames,
  motifLines,
  parsePat,
  patternLines,
  type Motif,
} from '../src/index';
import { TRIYA_MATERIALS_PAT } from '../src/materials';

const ASSET = fileURLToPath(
  new URL('../../../assets/patterns/triya-materials.pat', import.meta.url),
);

const box = (x0: number, y0: number, x1: number, y1: number): HatchLoop => ({
  flags: 3,
  polyline: {
    closed: true,
    vertices: [
      { x: x0, y: y0, bulge: 0 },
      { x: x1, y: y0, bulge: 0 },
      { x: x1, y: y1, bulge: 0 },
      { x: x0, y: y1, bulge: 0 },
    ],
  },
});

/** A point moved into the lattice's cell at the origin: x in [0, width), y in [0, height). */
function home(m: Motif, x: number, y: number): [number, number] {
  const { width: w, height: h, shift = 0 } = m.tile;
  const row = Math.floor(y / h + 1e-5);
  const yy = y - row * h;
  const xx = x - row * shift;
  const col = Math.floor(xx / w + 1e-5);
  return [xx - col * w, yy];
}
const key = (...v: number[]) => v.map((n) => (Math.round(n * 1e3) / 1e3 + 0).toFixed(3)).join(',');

/** A stroke as a key: its start moved home, the stroke's other end moved with it. */
function strokeKey(m: Motif, x0: number, y0: number, x1: number, y1: number): string {
  // The same stroke drawn either way round is the same stroke.
  if (x1 < x0 - 1e-9 || (Math.abs(x1 - x0) <= 1e-9 && y1 < y0)) [x0, y0, x1, y1] = [x1, y1, x0, y0];
  const [hx, hy] = home(m, x0, y0);
  return key(hx, hy, hx + x1 - x0, hy + y1 - y0);
}

/** How long a stroke's line runs before the motif repeats on it (its lattice period). */
const continuous = (m: Motif, s: readonly number[]) => {
  const line = motifLines({ ...m, strokes: [s as [number, number, number, number]], dots: [] })[0]!;
  return line.dashes.length === 0;
};

describe('the bundled material patterns', () => {
  it('ships assets/patterns/triya-materials.pat as the motifs make it', () => {
    if (process.env.TRIYA_UPDATE_PATTERNS) writeFileSync(ASSET, TRIYA_MATERIALS_PAT, 'latin1');
    expect(TRIYA_MATERIALS_PAT).toBe(readFileSync(ASSET, 'latin1'));
    const f = parsePat(TRIYA_MATERIALS_PAT);
    expect(f.errors).toEqual([]);
    // No line over AutoCAD's 80 characters.
    expect(f.warnings).toEqual([]);
    expect(f.patterns.map((p) => p.name)).toEqual(MATERIAL_MOTIFS.map((m) => m.name));
    expect(materialPatternNames()).toEqual(MATERIAL_MOTIFS.map((m) => m.name));
  });

  it('covers the materials the roadmap names, in the bundled library', () => {
    const names = bundledPatterns().names();
    for (const n of [
      'TRIYA_CONCRETE',
      'TRIYA_EARTH',
      'TRIYA_INSULATION',
      'TRIYA_STEEL',
      'TRIYA_PLASTIC',
      'TRIYA_WOOD',
      'TRIYA_GRAVEL',
    ])
      expect(names).toContain(n);
    // The ISO set is still there, ahead of them.
    expect(names.indexOf('TRIYA_LINES45')).toBeLessThan(names.indexOf('TRIYA_CONCRETE'));
    for (const m of MATERIAL_MOTIFS) {
      expect(m.name).toMatch(/^TRIYA_[A-Z_]+$/);
      expect(m.comment.length).toBeGreaterThan(0);
    }
  });

  for (const m of MATERIAL_MOTIFS) {
    it(`${m.name} draws its motif, once in every tile`, () => {
      const p = parsePat(TRIYA_MATERIALS_PAT).patterns.find((q) => q.name === m.name)!;
      const { width: w, height: h } = m.tile;
      // Six tiles each way; strokes within a margin of the box edge may be cut, so skip them.
      const size = 6 * Math.max(w, h);
      // Off the lattice lines, so no copy ends on the margin.
      const margin = Math.max(w, h) * 1.5 + 0.1234 * Math.min(w, h);
      const out = hatchPattern({
        loops: [box(0, 0, size, size)],
        patternLines: patternLines(p, { angle: 0, scale: 1 }),
        style: 0,
      });
      if (out.kind !== 'lines') throw new Error(out.kind);
      const inside = (x: number, y: number) =>
        x > margin && x < size - margin && y > margin && y < size - margin;

      // How many copies of each stroke and dot lie wholly inside: one per lattice cell.
      const shift = m.tile.shift ?? 0;
      const copies = (points: readonly number[]) => {
        let n = 0;
        for (let j = -2; j * h < size + h; j++)
          for (let i = -Math.ceil((j * shift) / w) - 2; i * w + j * shift < size + w; i++) {
            const dx = i * w + j * shift;
            const dy = j * h;
            let all = true;
            for (let q = 0; q < points.length; q += 2)
              all &&= inside(points[q]! + dx, points[q + 1]! + dy);
            if (all) n++;
          }
        return n;
      };
      const strokes = (m.strokes ?? []).filter((s) => !continuous(m, s));
      const expected = new Map<string, { want: number; got: number }>();
      for (const [x0, y0, x1, y1] of strokes)
        expected.set(strokeKey(m, x0, y0, x1, y1), { want: copies([x0, y0, x1, y1]), got: 0 });
      for (const [x, y] of m.dots ?? [])
        expected.set(key(...home(m, x, y)), { want: copies([x, y]), got: 0 });

      const strays: string[] = [];
      for (const f of out.families) {
        const s = f.segments;
        for (let i = 0; i < s.length; i += 4) {
          const [x0, y0, x1, y1] = [s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!];
          if (!inside(x0, y0) || !inside(x1, y1)) continue;
          const k = strokeKey(m, x0, y0, x1, y1);
          // A continuous line runs through the whole box, so it never lands here.
          if (expected.has(k)) expected.get(k)!.got++;
          else strays.push(k);
        }
        for (let i = 0; i < f.dots.length; i += 2) {
          const [x, y] = [f.dots[i]!, f.dots[i + 1]!];
          if (!inside(x, y)) continue;
          const k = key(...home(m, x, y));
          if (expected.has(k)) expected.get(k)!.got++;
          else strays.push(k);
        }
      }
      expect(strays).toEqual([]);
      // Every stroke and dot of the motif is drawn once in every cell.
      for (const [k, { want, got }] of expected) {
        expect(want, k).toBeGreaterThan(0);
        expect(got, k).toBe(want);
      }
      // And the continuous lines are there, one family each.
      const lines = (m.strokes ?? []).filter((s) => continuous(m, s));
      expect(p.lines.filter((l) => l.dashes.length === 0)).toHaveLength(lines.length);
    });
  }
});

describe('motifLines', () => {
  const tile = { width: 10, height: 10 };
  const base = { name: 'T', description: '', comment: ['test'], tile };

  it('makes a dash that repeats on the lattice along its own line', () => {
    // A 45° stroke 2√2 long on a 10 mm square lattice: its line meets the next lattice point
    // after 10√2, and the next line of the family is 10/√2 across and 10/√2 along.
    const [l] = motifLines({ ...base, strokes: [[1, 1, 3, 3]] });
    expect(l!.angle).toBeCloseTo(45, 12);
    expect([l!.origin.x, l!.origin.y]).toEqual([1, 1]);
    expect(l!.delta.x).toBeCloseTo(Math.SQRT1_2 * 10, 12);
    expect(l!.delta.y).toBeCloseTo(Math.SQRT1_2 * 10, 12);
    expect(l!.dashes[0]).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(l!.dashes[1]).toBeCloseTo(-8 * Math.SQRT2, 12);
  });

  it('draws a stroke given end first from its start, and a dot as a zero dash', () => {
    const [a, d] = motifLines({ ...base, strokes: [[3, 1, 1, 1]], dots: [[5, 5]] });
    expect([a!.angle, a!.origin.x, a!.origin.y, ...a!.dashes]).toEqual([0, 1, 1, 2, -8]);
    expect([d!.angle, d!.origin.x, d!.origin.y, d!.delta.x, d!.delta.y]).toEqual([0, 5, 5, 0, 10]);
    expect(d!.dashes).toEqual([0, -10]);
  });

  it('makes a stroke as long as its repeat a continuous line', () => {
    const [l] = motifLines({ ...base, strokes: [[0, 0, 10, 0]] });
    expect(l!.dashes).toEqual([]);
  });

  it('follows staggered rows', () => {
    // Rows 10 up and 5 along: the vertical stroke's line repeats every two rows (0, 20).
    const [l] = motifLines({ ...base, tile: { ...tile, shift: 5 }, strokes: [[0, 0, 0, 10]] });
    expect(l!.angle).toBeCloseTo(90, 12);
    expect(l!.dashes[0]).toBeCloseTo(10, 12);
    expect(l!.dashes[1]).toBeCloseTo(-10, 12);
    // The next line is 5 across (to the left of travel) and 10 along.
    expect(Math.abs(l!.delta.y)).toBeCloseTo(5, 12);
  });

  it('rejects a stroke off the lattice directions or longer than its repeat', () => {
    expect(() => motifLines({ ...base, strokes: [[0, 0, 1, Math.PI / 7]] })).toThrow(/direction/);
    expect(() => motifLines({ ...base, strokes: [[0, 0, 12, 0]] })).toThrow(/longer/);
  });
});
