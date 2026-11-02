// M1-66: linetypes on wide polylines. AutoCAD dashes a wide segment along its centre line and
// draws each dash as that piece of the segment's tapered outline, so the gaps of a wide
// polyline fall exactly where the same polyline drawn thin has them.
import { wideSegments, type EntityGeometry, type PolylineVertex, type Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  tessellate,
  type LinePattern,
  type Paint,
  type RenderPrimitive,
} from '../src/index';

const pattern = (...lengths: number[]): LinePattern => ({
  name: 'TEST',
  description: '',
  elements: lengths.map((length) => ({ length })),
});
const DASHED = pattern(0.5, -0.25);
const DASHDOT = pattern(0.5, -0.25, 0, -0.25);
const paint = (p: LinePattern, scale = 1): Paint => ({
  color: '#ff0000',
  linetype: { pattern: p, scale },
});
const PLAIN: Paint = { color: '#ff0000' };

const v = (x: number, y: number, bulge = 0): PolylineVertex => ({ x, y, bulge });
const poly = (
  vertices: PolylineVertex[],
  opts: { closed?: boolean; plinegen?: boolean; width?: number } = {},
): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed: opts.closed ?? false,
  ...(opts.plinegen === undefined ? {} : { plinegen: opts.plinegen }),
  ...(opts.width === undefined ? {} : { constantWidth: opts.width }),
  vertices,
});

type PathPrimitive = Extract<RenderPrimitive, { readonly path: readonly number[] }>;
const paths = (prims: RenderPrimitive[], kind: 'fill' | 'stroke'): PathPrimitive[] =>
  prims.filter((p): p is PathPrimitive => p.kind === kind);

/** The subpaths of a path of moves, lines and closes. */
function subpaths(path: readonly number[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (let i = 0; i < path.length;) {
    const op = path[i];
    if (op === PATH_Z) {
      i += 1;
      continue;
    }
    if (op !== PATH_M && op !== PATH_L) throw new Error(`unexpected path command ${op}`);
    if (op === PATH_M) out.push([]);
    out[out.length - 1]!.push({ x: path[i + 1]!, y: path[i + 2]! });
    i += 3;
  }
  return out;
}

/** How many subpaths of a path of moves, lines and closes are closed. */
function closes(path: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < path.length;) {
    if (path[i] === PATH_Z) {
      n++;
      i += 1;
    } else i += 3;
  }
  return n;
}

function inside(poly: readonly Vec2[], p: Vec2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const runDist = (run: readonly Vec2[], p: Vec2): number =>
  run.length === 1
    ? Math.hypot(p.x - run[0]!.x, p.y - run[0]!.y)
    : run.slice(1).reduce((m, q, i) => Math.min(m, segDist(p, run[i]!, q)), Infinity);

/** Points every `step` along a polyline's flattened centre line. */
function samples(g: EntityGeometry, step: number): Vec2[] {
  if (g.kind !== 'LWPOLYLINE') throw new Error('LWPOLYLINE only');
  const centre = wideSegments(
    g.vertices.map((p) => ({ ...p, startWidth: 0, endWidth: 0 })),
    g.closed,
  ).map((x) => x.centre);
  const out: Vec2[] = [];
  for (const run of centre)
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 0; k < n; k++)
        out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  return out;
}

/**
 * The acceptance check: along the centre line, a point is inside a filled dash exactly where
 * the thin polyline with the same linetype has a dash (skipping points at a dash end).
 */
function expectGapsMatchThin(g: EntityGeometry, p: LinePattern): void {
  if (g.kind !== 'LWPOLYLINE') throw new Error('LWPOLYLINE only');
  const { constantWidth: _, ...thin } = g;
  const thinRuns = subpaths(paths(tessellate(thin, paint(p)), 'stroke')[0]!.path);
  const ends = thinRuns.flatMap((r) => [r[0]!, r.at(-1)!]);
  const wide = paths(tessellate(g, paint(p)), 'fill');
  expect(wide).toHaveLength(1);
  const pieces = subpaths(wide[0]!.path);
  let checked = 0;
  for (const s of samples(g, 0.01)) {
    if (ends.some((e) => Math.hypot(e.x - s.x, e.y - s.y) < 1e-3)) continue;
    const onThin = thinRuns.some((r) => runDist(r, s) < 1e-6);
    const onWide = pieces.some((q) => inside(q, s));
    expect(onWide, `at ${s.x.toFixed(3)},${s.y.toFixed(3)}`).toBe(onThin);
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
}

describe('dashed wide polylines', () => {
  it('draw each dash as a piece of the segment outline, square across', () => {
    const g = poly([v(0, 0), v(10, 0)], { width: 1 });
    const prims = tessellate(g, paint(DASHED));
    expect(prims).toHaveLength(1);
    const f = paths(prims, 'fill')[0]!;
    const pieces = subpaths(f.path);
    // As a thin line: 13 periods with 0.25 over, so 14 dashes, the end ones 0.375 long.
    expect(pieces).toHaveLength(14);
    const xs = pieces[0]!.map((p) => p.x);
    const ys = pieces[0]!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 12);
    expect(Math.max(...xs)).toBeCloseTo(0.375, 12);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 12);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 12);
  });

  it('keep the whole outline for picking and for patterns under a pixel', () => {
    const g = poly([v(0, 0), v(10, 0)], { width: 1 });
    const f = paths(tessellate(g, paint(DASHED)), 'fill')[0]!;
    const plain = paths(tessellate(g, PLAIN), 'fill')[0]!;
    expect(f.continuous).toEqual(plain.path);
    expect(f.patternLength).toBeCloseTo(0.75, 12);
  });

  it('put the gaps where the thin polyline has them, along lines', () => {
    expectGapsMatchThin(poly([v(0, 0), v(10, 0), v(10, 7)], { width: 1 }), DASHED);
  });

  it('put the gaps where the thin polyline has them, with PLINEGEN on through vertices', () => {
    expectGapsMatchThin(
      poly([v(0, 0), v(3.1, 0), v(3.1, 2.3), v(6, 4)], { width: 0.6, plinegen: true }),
      DASHED,
    );
  });

  it('put the gaps where the thin polyline has them, on bulge arcs and closed', () => {
    expectGapsMatchThin(
      poly([v(0, 0, 0.5), v(8, 0), v(8, 5, -0.3), v(0, 5)], { width: 0.4, closed: true }),
      DASHED,
    );
    expectGapsMatchThin(
      poly([v(0, 0, 0.5), v(8, 0), v(8, 5, -0.3), v(0, 5)], {
        width: 0.4,
        closed: true,
        plinegen: true,
      }),
      DASHED,
    );
  });

  it('taper each dash with the segment', () => {
    const g: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [{ ...v(0, 0), startWidth: 0, endWidth: 2 }, v(3, 0)],
    };
    const pieces = subpaths(paths(tessellate(g, paint(DASHED)), 'fill')[0]!.path);
    // L = 3: four periods, no leftover; the last dash runs 2.75 → 3, where the width is 2.
    const last = pieces.at(-1)!;
    expect(Math.max(...last.map((p) => p.y))).toBeCloseTo(1, 12);
    expect(Math.min(...last.map((p) => p.x))).toBeCloseTo(2.75, 12);
    const h = (2.75 / 3) * 1;
    expect(last.some((p) => Math.abs(p.y - h) < 1e-12)).toBe(true);
  });

  it('draw a dot as a cut across the width', () => {
    const g = poly([v(0, 0), v(10, 0)], { width: 1 });
    const prims = tessellate(g, paint(DASHDOT));
    const s = paths(prims, 'stroke');
    expect(s).toHaveLength(1);
    const cuts = subpaths(s[0]!.path);
    expect(cuts.length).toBeGreaterThan(5);
    for (const c of cuts) {
      expect(c).toHaveLength(2);
      expect(c[0]!.x).toBeCloseTo(c[1]!.x, 12);
      expect(Math.abs(c[0]!.y - c[1]!.y)).toBeCloseTo(1, 12);
    }
  });

  it('dash zero-width segments of a wide polyline as the thin line', () => {
    const g: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [{ ...v(0, 0), startWidth: 1, endWidth: 1 }, v(10, 0), v(20, 0)],
    };
    const prims = tessellate(g, paint(DASHED));
    expect(subpaths(paths(prims, 'fill')[0]!.path)).toHaveLength(14);
    const s = paths(prims, 'stroke')[0]!;
    const runs = subpaths(s.path);
    expect(runs).toHaveLength(14);
    for (const r of runs) for (const p of r) expect(p.x).toBeGreaterThanOrEqual(10 - 1e-12);
    expect(subpaths(s.continuous!)).toEqual([[v(10, 0), v(20, 0)].map(({ x, y }) => ({ x, y }))]);
  });

  it('outline each dash with FILLMODE off', () => {
    const g = poly([v(0, 0), v(10, 0)], { width: 1 });
    const prims = tessellate(g, paint(DASHED), { fill: false });
    expect(paths(prims, 'fill')).toEqual([]);
    const s = paths(prims, 'stroke')[0]!;
    expect(subpaths(s.path)).toHaveLength(14);
    expect(closes(s.path)).toBe(14);
    expect(s.continuous).toEqual(paths(tessellate(g, PLAIN, { fill: false }), 'stroke')[0]!.path);
  });

  it('draw continuous when the polyline is shorter than one pattern', () => {
    const g = poly([v(0, 0), v(0.5, 0)], { width: 1 });
    expect(tessellate(g, paint(DASHED))).toEqual(tessellate(g, PLAIN));
  });
});
