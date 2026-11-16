// M3-02 part 5: PEDIT's geometry (`edit/pedit.ts`), as AutoCAD 2024 edits polylines (AutoCAD
// Help, "PEDIT (Command)", "2D Polyline Selection (PEDIT)"), including inch-drawing tolerance
// cases.
import { describe, expect, it } from 'vitest';
import {
  breakVertices,
  bulgeArc,
  closePolyline,
  curveFit,
  decurvePolyline,
  editVertices,
  fitPolyline,
  fuzzyJoin,
  insertVertex,
  polylineFrom,
  splineFit,
  splineFitPoints,
  straightenVertices,
  toleranceForSize,
  widthPolyline,
  withEditVertices,
  type EditablePolyline,
  type LwPolylineGeometry,
  type PolylineGeometry,
  type PolylineVertex,
  type Vec2,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const v = (x: number, y: number, bulge = 0): PolylineVertex => ({ x, y, bulge });
const lw = (vertices: PolylineVertex[], closed = false, extra = {}): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  vertices,
  closed,
  ...extra,
});

describe('turning objects into polylines', () => {
  it('makes a line a two-vertex polyline and an arc one bulged segment', () => {
    const l = polylineFrom({
      kind: 'LINE',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 },
      elevation: 2,
    });
    expect(l).toEqual(lw([v(0, 0), v(5, 0)], false, { elevation: 2 }));
    const a = polylineFrom({
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
    })!;
    expect(a.vertices.map(pt)).toEqual([
      [2, 0],
      [0, 2],
    ]);
    expect(r6(a.vertices[0]!.bulge)).toBe(r6(Math.tan(Math.PI / 8)));
    expect(polylineFrom({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 })).toBeUndefined();
  });

  it('samples a spline at the precision asked for, per knot span', () => {
    const s = {
      kind: 'SPLINE' as const,
      degree: 3,
      knots: [0, 0, 0, 0, 1, 2, 2, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 0 },
        { x: 6, y: 0 },
      ],
      closed: false,
      periodic: false,
    };
    const p = polylineFrom(s, 3)!;
    // Two knot spans, four segments each.
    expect(p.vertices).toHaveLength(9);
    expect(pt(p.vertices[0]!)).toEqual([0, 0]);
    expect(pt(p.vertices[8]!)).toEqual([6, 0]);
    expect(polylineFrom(s, 0)!.vertices).toHaveLength(3);
  });
});

describe('Fit', () => {
  it('passes a pair of arcs through every vertex, tangent where they meet', () => {
    const vs = [v(0, 0), v(10, 10), v(20, 0), v(30, 10)];
    const out = curveFit(vs, false, tol);
    // Each of 3 spans gains an extra vertex: 4 + 3.
    expect(out).toHaveLength(7);
    expect([0, 2, 4, 6].map((i) => pt(out[i]!))).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ]);
    // Tangent continuity at every inner vertex: the arc arriving and the arc leaving share it.
    for (let i = 1; i < out.length - 1; i++) {
      const a = bulgeArc(out[i - 1]!, out[i]!, out[i - 1]!.bulge);
      const b = bulgeArc(out[i]!, out[i + 1]!, out[i]!.bulge);
      const arrive = a.startAngle + a.sweep + Math.sign(a.sweep) * (Math.PI / 2);
      const leave = b.startAngle + Math.sign(b.sweep) * (Math.PI / 2);
      expect(Math.abs(Math.sin(arrive - leave))).toBeLessThan(1e-9);
      expect(Math.cos(arrive - leave)).toBeGreaterThan(0);
    }
    expect(out.at(-1)!.bulge).toBe(0);
  });

  it('uses a tangent given at a vertex and leaves straight runs straight', () => {
    const out = curveFit([v(0, 0), v(10, 0), v(20, 0)], false, tol);
    expect(out.every((x) => x.bulge === 0)).toBe(true);
    // The tangent is the vertex's own (Edit vertex Tangent, saved as VERTEX 50, M3-16).
    const turned = curveFit([{ ...v(0, 0), tangent: Math.PI / 2 }, v(10, 0)], false, tol);
    // The original vertex keeps its tangent; the extra one Fit adds has none.
    expect(turned.map((x) => x.tangent)).toEqual([Math.PI / 2, undefined, undefined]);
    // Leaving straight up: the first arc turns right towards (10, 0).
    expect(turned[0]!.bulge).toBeLessThan(0);
  });

  it('makes a heavyweight curve-fit polyline that Decurve takes back to its vertices', () => {
    const g = lw([v(0, 0), v(10, 10), v(20, 0)], false, { constantWidth: 0.5, elevation: 3 });
    const fit = fitPolyline(g, tol);
    expect(fit.kind).toBe('POLYLINE');
    expect(fit.fit).toBe('curve');
    expect(fit.elevation).toBe(3);
    expect(fit.vertices).toHaveLength(5);
    expect(fit.vertices[0]!.startWidth).toBe(0.5);
    const back = decurvePolyline(fit);
    expect(back.kind).toBe('POLYLINE');
    expect((back as PolylineGeometry).fit).toBeUndefined();
    expect(back.vertices.map(pt)).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    expect(back.vertices.every((x) => x.bulge === 0)).toBe(true);
    expect(back.vertices[0]).toMatchObject({ startWidth: 0.5, endWidth: 0.5 });
    // A closed one gains an extra vertex on its closing span too.
    const closed = fitPolyline(lw([v(0, 0), v(10, 0), v(5, 8)], true), tol);
    expect(closed.vertices).toHaveLength(6);
    expect(decurvePolyline(closed).vertices).toHaveLength(3);
  });
});

describe('Spline', () => {
  it('fits a cubic B-spline through the ends of an open frame, the frame kept', () => {
    const g = lw([v(0, 0), v(10, 10), v(20, 0), v(30, 10)]);
    const s = splineFit(g, 6, 8);
    expect(s.kind).toBe('POLYLINE');
    expect(s.fit).toBe('cubic');
    expect(s.frame!.map(pt)).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ]);
    // 8 segments per frame segment.
    expect(s.vertices).toHaveLength(25);
    expect(pt(s.vertices[0]!)).toEqual([0, 0]);
    expect(pt(s.vertices[24]!)).toEqual([30, 10]);
    // The curve does not pass through the inner frame points.
    expect(s.vertices.some((x) => r6(x.x) === 10 && r6(x.y) === 10)).toBe(false);
    expect(splineFit(g, 5, 4).fit).toBe('quadratic');
    // Decurve gives the frame back.
    expect(decurvePolyline(s).vertices.map(pt)).toEqual(s.frame!.map(pt));
  });

  it('runs periodically round a closed frame, symmetric for a square', () => {
    const pts = splineFitPoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      true,
      3,
      4,
    );
    expect(pts).toHaveLength(16);
    const c = { x: 5, y: 5 };
    const radii = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    expect(r6(radii[0]!)).toBe(r6(radii[4]!));
    expect(r6(radii[1]!)).toBe(r6(radii[5]!));
  });

  it('keeps a uniform width as the default and tapers another', () => {
    const uniform = splineFit(lw([v(0, 0), v(5, 5), v(10, 0)], false, { constantWidth: 1 }), 6, 4);
    expect(uniform.startWidth).toBe(1);
    expect(uniform.vertices[0]).toMatchObject({ startWidth: 1, endWidth: 1 });
    const tapered = splineFit(
      lw([
        { ...v(0, 0), startWidth: 0, endWidth: 1 },
        { ...v(5, 5), startWidth: 1, endWidth: 2 },
        v(10, 0),
      ]),
      6,
      4,
    );
    expect(tapered.vertices[0]).toEqual({ x: 0, y: 0, bulge: 0, endWidth: 0.25 });
    expect(r6(tapered.vertices[7]!.endWidth!)).toBe(2);
  });

  it('refits to a moved frame vertex and to a closed frame', () => {
    const s = splineFit(lw([v(0, 0), v(10, 10), v(20, 0)]), 6, 4);
    const frame = editVertices(s);
    expect(frame.map(pt)).toEqual([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    const moved = withEditVertices(s, insertVertex(frame, 0, { x: 5, y: 0 }), 4);
    expect((moved as PolylineGeometry).frame).toHaveLength(4);
    const closed = closePolyline(s, true, { type: 6, segs: 4 }, tol) as PolylineGeometry;
    expect(closed.closed).toBe(true);
    expect(closed.fit).toBe('cubic');
    expect(closed.vertices).toHaveLength(12);
  });
});

describe('Width, Close and Edit vertex', () => {
  it('gives every segment one width', () => {
    const g = lw([{ ...v(0, 0), startWidth: 1, endWidth: 2 }, v(5, 0)]);
    expect(widthPolyline(g, 0.25)).toEqual(lw([v(0, 0), v(5, 0)], false, { constantWidth: 0.25 }));
    const heavy: PolylineGeometry = {
      kind: 'POLYLINE',
      vertices: [v(0, 0), v(5, 0)],
      closed: false,
      is3d: false,
      startWidth: 1,
      endWidth: 2,
    };
    expect(widthPolyline(heavy, 2).vertices[0]).toMatchObject({ startWidth: 2, endWidth: 2 });
    expect(widthPolyline(heavy, 0)).toEqual({
      ...heavy,
      startWidth: undefined,
      endWidth: undefined,
    });
    expect(closePolyline(g, true, { type: 6, segs: 8 }, tol).closed).toBe(true);
  });

  it('straightens the vertices between two and one arc segment', () => {
    const vs = [v(0, 0, 0.5), v(5, 0, 0.3), v(10, 0), v(15, 0)];
    expect(straightenVertices(vs, 0, 2)!.map(pt)).toEqual([
      [0, 0],
      [10, 0],
      [15, 0],
    ]);
    expect(straightenVertices(vs, 1, 1)![1]!.bulge).toBe(0);
    expect(straightenVertices(vs, 2, 2)).toBeUndefined();
  });

  it('breaks an open polyline into two, one, or not at all', () => {
    const vs = [v(0, 0), v(1, 0), v(2, 0), v(3, 0)];
    expect((breakVertices(vs, false, 1, 2) as PolylineVertex[][]).map((p) => p.map(pt))).toEqual([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [2, 0],
        [3, 0],
      ],
    ]);
    expect((breakVertices(vs, false, 0, 2) as PolylineVertex[][]).map((p) => p.length)).toEqual([
      2,
    ]);
    expect((breakVertices(vs, false, 2, 2) as PolylineVertex[][]).map((p) => p.length)).toEqual([
      3, 2,
    ]);
    expect(breakVertices(vs, false, 0, 0)).toBe('at an end');
    expect(breakVertices(vs, false, 0, 3)).toBe('both ends');
    // A closed one opens: from the later vertex round to the earlier.
    const ring = breakVertices(vs, true, 1, 2) as PolylineVertex[][];
    expect(ring[0]!.map(pt)).toEqual([
      [2, 0],
      [3, 0],
      [0, 0],
      [1, 0],
    ]);
    expect((breakVertices(vs, true, 1, 1) as PolylineVertex[][])[0]).toHaveLength(5);
  });
});

describe('Multiple Join with a fuzz distance', () => {
  const part = (id: number, vertices: PolylineVertex[]) => ({
    id,
    geom: lw(vertices) as EditablePolyline,
  });

  it('extends straight ends to where they meet, or adds a segment', () => {
    const parts = [part(1, [v(0, 0), v(9, 0)]), part(2, [v(10, 1), v(10, 10)])];
    const ext = fuzzyJoin(parts, 2, 'Extend', tol);
    expect(ext).toHaveLength(1);
    expect(ext[0]!.keep).toBe(1);
    expect(ext[0]!.geom.vertices.map(pt)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const add = fuzzyJoin(parts, 2, 'Add', tol);
    expect(add[0]!.geom.vertices.map(pt)).toEqual([
      [0, 0],
      [9, 0],
      [10, 1],
      [10, 10],
    ]);
    expect(add[0]!.added).toBe(2);
    // Too far apart: nothing joins.
    expect(fuzzyJoin(parts, 1, 'Both', tol)).toEqual([]);
  });

  it('adds where parallel ends cannot be extended, with Both; Extend leaves them', () => {
    const parts = [part(1, [v(0, 0), v(5, 0)]), part(2, [v(6, 0.5), v(10, 0.5)])];
    expect(fuzzyJoin(parts, 2, 'Extend', tol)).toEqual([]);
    expect(fuzzyJoin(parts, 2, 'Both', tol)[0]!.geom.vertices).toHaveLength(4);
  });

  it('joins ends that touch, reversing as needed, and closes a ring (inch drawing)', () => {
    // 1/64" apart in a drawing a few feet across: within the fuzz, not within tolerance.
    const inch = toleranceForSize(48);
    const parts = [
      part(1, [v(0, 0), v(24, 0)]),
      part(2, [v(24, 24), v(24, 0)]),
      part(3, [v(24, 24), v(0, 24), v(0, 1 / 64)]),
    ];
    const out = fuzzyJoin(parts, 1 / 32, 'Both', inch);
    expect(out).toHaveLength(1);
    expect(out[0]!.parts).toEqual([1, 2, 3]);
    expect(out[0]!.geom.vertices.map(pt)).toEqual([
      [0, 0],
      [24, 0],
      [24, 24],
      [0, 24],
      [0, r6(1 / 64)],
    ]);
    // Exactly touching ends close the polyline.
    const ring = fuzzyJoin(
      [part(1, [v(0, 0), v(24, 0), v(24, 24)]), part(2, [v(24, 24), v(0, 24), v(0, 0)])],
      0,
      'Extend',
      inch,
    );
    expect(ring[0]!.geom.closed).toBe(true);
    expect(ring[0]!.geom.vertices).toHaveLength(4);
  });
});
