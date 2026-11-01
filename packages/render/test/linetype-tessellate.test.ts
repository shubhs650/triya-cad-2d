// Linetypes at tessellate time (M1-13 part 3): a paint with a linetype turns an entity's stroke
// into explicit dashes and dots in world units, fitted the AutoCAD way by `dashPath`, and keeps
// the exact continuous path for the level-of-detail rule and for picking in the gaps.
import type { EntityGeometry, PolylineVertex } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_A,
  PATH_L,
  PATH_M,
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
const paint = (p: LinePattern, scale = 1): Paint => ({
  color: '#ff0000',
  linetype: { pattern: p, scale },
});
const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
type PathPrimitive = Extract<RenderPrimitive, { readonly path: readonly number[] }>;
const only = (prims: RenderPrimitive[]): PathPrimitive => {
  expect(prims).toHaveLength(1);
  const p = prims[0]!;
  if (p.kind !== 'stroke') throw new Error(`expected a stroke, got ${p.kind}`);
  return p;
};

/** The pen-down runs of a path of moves and lines. */
function runs(path: readonly number[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  for (let i = 0; i < path.length; i += 3) {
    const op = path[i];
    if (op !== PATH_M && op !== PATH_L) throw new Error(`unexpected path command ${op}`);
    if (op === PATH_M) out.push([]);
    out[out.length - 1]!.push({ x: path[i + 1]!, y: path[i + 2]! });
  }
  return out;
}
const runLength = (r: readonly { x: number; y: number }[]): number =>
  r.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - r[i]!.x, p.y - r[i]!.y), 0);

describe('dashed strokes', () => {
  it('dashes a line with half the first dash plus half the leftover at each end', () => {
    // 10 units hold 13 periods of 0.75 with 0.25 over: each end dash is 0.25 + 0.125.
    const p = only(tessellate(line(0, 0, 10, 0), paint(DASHED)));
    const r = runs(p.path);
    expect(r).toHaveLength(14);
    expect(r[0]![0]!.x).toBeCloseTo(0, 12);
    expect(r[0]!.at(-1)!.x).toBeCloseTo(0.375, 12);
    expect(r[1]![0]!.x).toBeCloseTo(0.625, 12);
    expect(r.at(-1)![0]!.x).toBeCloseTo(9.625, 12);
    expect(r.at(-1)!.at(-1)!.x).toBeCloseTo(10, 12);
    expect(p.continuous).toEqual([PATH_M, 0, 0, PATH_L, 10, 0]);
    expect(p.patternLength).toBeCloseTo(0.75, 12);
    expect(p.color).toBe('#ff0000');
  });

  it('multiplies the pattern by the linetype scale', () => {
    // Scale 2: periods of 1.5, six in 9 units with 1 over, so the end dashes are 1 long.
    const p = only(tessellate(line(0, 0, 10, 0), paint(DASHED, 2)));
    const r = runs(p.path);
    expect(r).toHaveLength(7);
    expect(r[0]!.at(-1)!.x).toBeCloseTo(1, 12);
    expect(r.at(-1)![0]!.x).toBeCloseTo(9, 12);
    expect(p.patternLength).toBeCloseTo(1.5, 12);
  });

  it('draws a path shorter than one pattern as the continuous stroke', () => {
    expect(tessellate(line(0, 0, 0.5, 0), paint(DASHED))).toEqual(
      tessellate(line(0, 0, 0.5, 0), { color: '#ff0000' }),
    );
  });

  it('draws dots as zero-length segments, so the round cap shows the lineweight', () => {
    const p = only(tessellate(line(0, 0, 10, 0), paint(pattern(0.5, -0.25, 0, -0.25))));
    const dots = runs(p.path).filter((r) => runLength(r) === 0);
    expect(dots).toHaveLength(10);
    expect(dots.every((d) => d.length === 2)).toBe(true);
  });

  it('keeps a continuous linetype as the plain stroke', () => {
    expect(tessellate(line(0, 0, 10, 0), paint(pattern()))).toEqual(
      tessellate(line(0, 0, 10, 0), { color: '#ff0000' }),
    );
  });

  it('dashes a circle along the circle, closed at its start point', () => {
    const p = only(
      tessellate({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 }, paint(DASHED)),
    );
    const r = runs(p.path);
    for (const pt of r.flat()) expect(Math.abs(Math.hypot(pt.x, pt.y) - 5)).toBeLessThan(5e-4);
    // The end and start half dashes join into one dash through the start point (5, 0).
    const through = r.filter((run) => run.slice(1, -1).some((q) => q.x === 5 && q.y === 0));
    expect(through).toHaveLength(1);
    // 41 periods fit; the 0.67 left over lengthens the joined dash.
    const L = 2 * Math.PI * 5;
    const N = Math.floor(L / 0.75);
    const inked = r.reduce((s, run) => s + runLength(run), 0);
    expect(inked).toBeCloseTo(N * 0.5 + (L - N * 0.75), 2);
    expect(r).toHaveLength(N);
    expect(p.continuous?.[3]).toBe(PATH_A);
  });

  it('dashes an arc and an ellipse along their length', () => {
    const arc = only(
      tessellate(
        { kind: 'ARC', center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 },
        paint(DASHED),
      ),
    );
    const ra = runs(arc.path);
    expect(ra[0]![0]!.x).toBeCloseTo(10, 9);
    expect(ra[0]![0]!.y).toBeCloseTo(0, 9);
    expect(ra.at(-1)!.at(-1)!.x).toBeCloseTo(0, 9);
    expect(ra.at(-1)!.at(-1)!.y).toBeCloseTo(10, 9);
    for (const pt of ra.flat()) expect(Math.abs(Math.hypot(pt.x, pt.y) - 10)).toBeLessThan(1e-3);
    const ellipse = only(
      tessellate(
        {
          kind: 'ELLIPSE',
          center: { x: 0, y: 0 },
          majorAxis: { x: 10, y: 0 },
          ratio: 0.5,
          startParam: 0,
          endParam: 2 * Math.PI,
        },
        paint(DASHED),
      ),
    );
    for (const pt of runs(ellipse.path).flat())
      expect(Math.abs((pt.x / 10) ** 2 + (pt.y / 5) ** 2 - 1)).toBeLessThan(1e-3);
  });

  it('fits each polyline segment on its own with PLINEGEN off, and runs on through vertices with it on', () => {
    const v = (x: number, y: number, bulge = 0): PolylineVertex => ({ x, y, bulge });
    const geom = (plinegen: boolean): EntityGeometry => ({
      kind: 'LWPOLYLINE',
      vertices: [v(0, 0), v(10, 0), v(10, 10)],
      closed: false,
      plinegen,
    });
    const corner = (q: { x: number; y: number }) =>
      Math.abs(q.x - 10) < 1e-12 && Math.abs(q.y) < 1e-12;
    const off = runs(only(tessellate(geom(false), paint(DASHED))).path);
    // Off: "start and end with a dash at each vertex".
    expect(off.some((r) => corner(r.at(-1)!))).toBe(true);
    expect(off.some((r) => corner(r[0]!))).toBe(true);
    // On: 20 units, phase 0, so the corner at 10 falls inside the dash from 9.75 to 10.25.
    const on = runs(only(tessellate(geom(true), paint(DASHED))).path);
    expect(on.some((r) => r.slice(1, -1).some(corner))).toBe(true);
    expect(on.some((r) => corner(r[0]!) || corner(r.at(-1)!))).toBe(false);
  });

  it('dashes bulge segments along the arc', () => {
    const p = only(
      tessellate(
        {
          kind: 'LWPOLYLINE',
          vertices: [
            { x: -10, y: 0, bulge: 1 },
            { x: 10, y: 0, bulge: 0 },
          ],
          closed: false,
        },
        paint(DASHED),
      ),
    );
    for (const pt of runs(p.path).flat())
      expect(Math.abs(Math.hypot(pt.x, pt.y) - 10)).toBeLessThan(1e-3);
  });

  it('dashes each visible 3DFACE edge on its own', () => {
    const p = only(
      tessellate(
        {
          kind: '3DFACE',
          corners: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          hiddenEdges: 0b1010,
        },
        paint(DASHED),
      ),
    );
    // Bits 1 and 3 hide the second and fourth edges; the first and third show, 14 dashes each.
    expect(runs(p.path)).toHaveLength(28);
  });

  it('leaves fills, points and infinite lines as they are', () => {
    const solid: EntityGeometry = {
      kind: 'SOLID',
      corners: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    };
    const xline: EntityGeometry = {
      kind: 'XLINE',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    };
    const point: EntityGeometry = { kind: 'POINT', position: { x: 1, y: 2 } };
    for (const g of [solid, xline, point])
      expect(tessellate(g, paint(DASHED))).toEqual(tessellate(g, { color: '#ff0000' }));
  });

  it('draws a pattern too dense to hold as the continuous stroke', () => {
    // A million periods on one line: our cap (AutoCAD documents none) keeps the cache bounded.
    expect(tessellate(line(0, 0, 750_000, 0), paint(DASHED))).toEqual(
      tessellate(line(0, 0, 750_000, 0), { color: '#ff0000' }),
    );
  });

  it('carries the lineweight onto the dashes', () => {
    const p = only(
      tessellate(line(0, 0, 10, 0), { ...paint(DASHED), lineweight: 0.5, color: 'foreground' }),
    );
    expect(p).toMatchObject({ color: 'foreground', lineweight: 0.5 });
  });
});
