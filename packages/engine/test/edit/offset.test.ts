// M3-02 part 1: OFFSET's geometry (`edit/offset.ts`): the objects an offset makes, as AutoCAD
// 2024's OFFSET makes them, on top of the kernel's `offset` (M1-02). The roadmap asks for the
// self-intersecting loops of an inward polyline offset to be cut out and for ellipse and spline
// offsets to be SPLINEs, and for tolerance-sensitive cases on inch drawings.
import { describe, expect, it } from 'vitest';
import {
  closestPoint,
  offsetPolylineTraced,
  pointAt,
  domain,
  toleranceForSize,
  type Curve,
  type Polyline,
  type Spline,
} from '../../src/geom/index';
import { offsetCurveOf, offsetGeometry, offsetSide } from '../../src/edit/offset';
import { polylineArea, polylineLength } from '../../src/properties/measure';
import type {
  EntityGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  SplineGeometry,
} from '../../src/model/types';

const TOL = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pts = (g: { vertices: readonly { x: number; y: number }[] }) =>
  g.vertices.map((v) => [r6(v.x), r6(v.y)]);

const lw = (closed: boolean, ...v: [number, number, number?][]): LwPolylineGeometry => ({
  kind: 'LWPOLYLINE',
  closed,
  vertices: v.map(([x, y, bulge]) => ({ x, y, bulge: bulge ?? 0 })),
});

/**
 * Every point sampled along `g` is `d` from `source`, to `eps`; with `atLeast`, at least `d`
 * (past a concave corner of the source a polyline's offset is farther from the corner).
 */
function expectAtDistance(g: Curve, source: Curve, d: number, eps: number, atLeast = false): void {
  const dm = domain(g);
  for (let i = 0; i <= 200; i++) {
    const p = pointAt(g, dm.start + ((dm.end - dm.start) * i) / 200);
    const e = closestPoint(source, p, TOL).distance - d;
    if (atLeast) expect(e).toBeGreaterThan(-eps);
    else expect(Math.abs(e)).toBeLessThan(eps);
  }
}

// A U: 10 wide and 8 tall, a notch 6 wide down from the top to 4, leaving legs 2 wide.
const U: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 8],
  [8, 8],
  [8, 4],
  [2, 4],
  [2, 8],
  [0, 8],
];

describe('offsetCurveOf', () => {
  it('takes curves, 2D polylines and refuses the rest', () => {
    const line: EntityGeometry = { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
    expect(offsetCurveOf(line)).toBe(line);
    const heavy: PolylineGeometry = {
      kind: 'POLYLINE',
      is3d: false,
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 0, y: 0, bulge: 1 },
        { x: 4, y: 0, bulge: 0 },
      ],
    };
    // The repeated vertex is dropped and its bulge kept for the segment after it.
    expect(offsetCurveOf(heavy)).toEqual({
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 1 },
        { x: 4, y: 0, bulge: 0 },
      ],
    });
    expect(offsetCurveOf({ ...heavy, is3d: true })).toBeUndefined();
    expect(offsetCurveOf(lw(false, [1, 1], [1, 1]))).toBeUndefined();
    expect(
      offsetCurveOf({ kind: 'POINT', position: { x: 0, y: 0 } } as EntityGeometry),
    ).toBeUndefined();
    // A closed polyline whose last vertex repeats its first closes on the first.
    const sq = offsetCurveOf(lw(true, [0, 0], [1, 0], [1, 1], [0, 0])) as Polyline;
    expect(sq.vertices).toHaveLength(3);
  });
});

describe('offsetSide', () => {
  it('measures the distance and side of a through point', () => {
    const line: Curve = { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    expect(offsetSide(line, { x: 3, y: 2 }, TOL)).toEqual({ distance: 2, side: 1 });
    expect(offsetSide(line, { x: 3, y: -2 }, TOL)).toEqual({ distance: 2, side: -1 });
    expect(offsetSide(line, { x: 3, y: 0 }, TOL)).toEqual({ distance: 0, side: 0 });
  });
});

describe('offsetGeometry', () => {
  it('offsets lines, arcs, circles, rays and xlines as themselves, keeping elevation', () => {
    const line: EntityGeometry = {
      kind: 'LINE',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      elevation: 5,
      thickness: 2,
    };
    expect(offsetGeometry(line, 1, TOL)).toEqual([
      { kind: 'LINE', start: { x: 0, y: 1 }, end: { x: 10, y: 1 }, elevation: 5, thickness: 2 },
    ]);
    const circle: EntityGeometry = { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 3 };
    expect(offsetGeometry(circle, -2, TOL)).toEqual([{ ...circle, radius: 5 }]);
    // Shrunk to nothing: no object.
    expect(offsetGeometry(circle, 3, TOL)).toEqual([]);
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 3,
      startAngle: 0,
      endAngle: 1,
    };
    expect(offsetGeometry(arc, 1, TOL)).toEqual([{ ...arc, radius: 2 }]);
    const ray: EntityGeometry = { kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    expect(offsetGeometry(ray, 2, TOL)).toEqual([{ ...ray, base: { x: 0, y: 2 } }]);
    expect(
      offsetGeometry({ kind: 'POINT', position: { x: 0, y: 0 } } as EntityGeometry, 1, TOL),
    ).toEqual([]);
    expect(
      offsetGeometry(
        { kind: 'POLYLINE', is3d: true, closed: false, vertices: [] } as PolylineGeometry,
        1,
        TOL,
      ),
    ).toEqual([]);
  });

  it('offsets a rectangle outward with its corners extended, keeping constant width', () => {
    const rect: LwPolylineGeometry = {
      ...lw(true, [0, 0], [10, 0], [10, 5], [0, 5]),
      constantWidth: 0.5,
      elevation: 3,
    };
    const [o] = offsetGeometry(rect, -1, TOL) as LwPolylineGeometry[];
    expect(pts(o!)).toEqual([
      [-1, -1],
      [11, -1],
      [11, 6],
      [-1, 6],
    ]);
    expect(o).toMatchObject({ closed: true, constantWidth: 0.5, elevation: 3 });
  });

  it('cuts out the loops an inward offset of a U with thin legs makes', () => {
    // Offset 1.5 inward, each 2 wide leg's two offsets pass each other and cross the offsets
    // of the notch's bottom and the top: the loops are cut out and what is left is the band
    // across the bottom, everything at least 1.5 from every edge: 7 by 1.
    const u = lw(true, ...U);
    expect(polylineArea(u)).toBe(56);
    const raw = offsetPolylineTraced(u, 1.5, TOL)!;
    expect(raw.polyline.vertices).toHaveLength(8);
    const out = offsetGeometry(u, 1.5, TOL) as LwPolylineGeometry[];
    expect(out).toHaveLength(1);
    const [o] = out;
    expect(o!.closed).toBe(true);
    expect(pts(o!).sort()).toEqual(
      [
        [1.5, 1.5],
        [8.5, 1.5],
        [8.5, 2.5],
        [1.5, 2.5],
      ].sort(),
    );
    expect(r6(polylineArea(o!))).toBe(7);
    expectAtDistance(o!, u, 1.5, 1e-9, true);
    // Offset 0.5 the legs stay: one polyline, the raw offset itself.
    const [thin] = offsetGeometry(u, 0.5, TOL) as LwPolylineGeometry[];
    expect(thin!.vertices).toHaveLength(8);
    // Offset outward nothing crosses.
    expect(offsetGeometry(u, -1, TOL)).toHaveLength(1);
  });

  it('splits an inward offset of a dumbbell into two polylines', () => {
    // Two 6×6 squares joined by a 1 wide bridge: offset 1 inward, the bridge vanishes and two
    // squares of 4×4 remain.
    const dumbbell = lw(
      true,
      [0, 0],
      [6, 0],
      [6, 2.5],
      [10, 2.5],
      [10, 0],
      [16, 0],
      [16, 6],
      [10, 6],
      [10, 3.5],
      [6, 3.5],
      [6, 6],
      [0, 6],
    );
    const out = offsetGeometry(dumbbell, 1, TOL) as LwPolylineGeometry[];
    expect(out).toHaveLength(2);
    const areas = out.map((o) => r6(polylineArea(o))).sort((a, b) => a - b);
    expect(areas).toEqual([16, 16]);
    for (const o of out) {
      expect(o.closed).toBe(true);
      // Each a square of four vertices: the pieces along one edge are one segment again.
      expect(o.vertices).toHaveLength(4);
      expectAtDistance(o, dumbbell, 1, 1e-9, true);
    }
  });

  it('cuts the loop out of an open polyline offset into a tight zig-zag', () => {
    // A narrow V: down and back up, 1 apart at the top. Offset 1 inside the V, the two offset
    // legs cross; the loop past the crossing is cut out and one open polyline is left.
    const v = lw(false, [0, 10], [1, 0], [2, 10]);
    const out = offsetGeometry(v, 0.4, TOL) as LwPolylineGeometry[];
    expect(out).toHaveLength(1);
    expect(out[0]!.closed).toBe(false);
    expectAtDistance(out[0]!, v, 0.4, 1e-9);
    // Outward nothing crosses and the polyline is the raw offset.
    const outward = offsetGeometry(v, -0.4, TOL) as LwPolylineGeometry[];
    expect(outward).toHaveLength(1);
    expect(outward[0]!.vertices).toHaveLength(3);
  });

  it('keeps each segment its widths, a cut segment its widths along it', () => {
    const tapered: LwPolylineGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 1, endWidth: 2 },
        { x: 10, y: 0, bulge: 0, startWidth: 0.5, endWidth: 0.5 },
        { x: 10, y: 10, bulge: 0 },
      ],
    };
    const [o] = offsetGeometry(tapered, 1, TOL) as LwPolylineGeometry[];
    expect(o!.vertices.map((v) => [v.startWidth, v.endWidth])).toEqual([
      [1, 2],
      [0.5, 0.5],
      [undefined, undefined],
    ]);
    // The U's bottom edge tapers 0 to 1, the notch's bottom 2 to 4. Offset 1.5 the bottom
    // stays whole and keeps its widths; the notch's bottom offset, 9 long from x 9.5 to 0.5, is
    // cut at x 8.5 and 1.5 and keeps the widths it had there.
    const u: LwPolylineGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: U.map(([x, y], i) => ({
        x,
        y,
        bulge: 0,
        ...(i === 0 && { startWidth: 0, endWidth: 1 }),
        ...(i === 4 && { startWidth: 2, endWidth: 4 }),
      })),
    };
    const [cut] = offsetGeometry(u, 1.5, TOL) as LwPolylineGeometry[];
    const at = (x: number, y: number) => cut!.vertices.find((p) => r6(p.x) === x && r6(p.y) === y)!;
    expect([at(1.5, 1.5).startWidth, at(1.5, 1.5).endWidth]).toEqual([0, 1]);
    expect(at(8.5, 1.5)).not.toHaveProperty('startWidth');
    expect(at(8.5, 2.5).startWidth).toBeCloseTo(2 + 2 / 9, 12);
    expect(at(8.5, 2.5).endWidth).toBeCloseTo(2 + 16 / 9, 12);
  });

  it('offsets a 2D POLYLINE as a POLYLINE, a fitted one as the curve it draws', () => {
    const heavy: PolylineGeometry = {
      kind: 'POLYLINE',
      is3d: false,
      closed: false,
      fit: 'curve',
      frame: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      startWidth: 0.25,
      endWidth: 0.25,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    const [o] = offsetGeometry(heavy, 2, TOL) as PolylineGeometry[];
    expect(o).not.toHaveProperty('fit');
    expect(o).not.toHaveProperty('frame');
    expect(o).toMatchObject({ kind: 'POLYLINE', is3d: false, closed: false });
    expect(pts(o!)).toEqual([
      [0, 2],
      [10, 2],
    ]);
    expect(o!.vertices[0]).toMatchObject({ startWidth: 0.25, endWidth: 0.25 });
  });

  it('keeps a slot (lines and arcs) a closed polyline with arcs on both sides', () => {
    const slot = lw(true, [0, 0, 0], [10, 0, 1], [10, 4, 0], [0, 4, 1]);
    for (const d of [-1, 1, 1.9]) {
      const out = offsetGeometry(slot, d, TOL) as LwPolylineGeometry[];
      expect(out).toHaveLength(1);
      expectAtDistance(out[0]!, slot, Math.abs(d), 1e-9);
    }
    // Offset 2.5 inward, more than half its width: the arcs collapse and the legs pass each
    // other without crossing, every piece closer than 2.5 to the slot. Nothing is made.
    expect(offsetGeometry(slot, 2.5, TOL)).toEqual([]);
    expect(polylineLength(slot)).toBeCloseTo(20 + 4 * Math.PI, 12);
  });

  it('offsets an ellipse and a spline as SPLINEs within 1e-6 of their size', () => {
    const ellipse: EntityGeometry = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    for (const d of [-1, 1]) {
      const [s] = offsetGeometry(ellipse, d, TOL) as SplineGeometry[];
      expect(s).toMatchObject({ kind: 'SPLINE', degree: 3, closed: true, periodic: false });
      expectAtDistance(s as Spline, ellipse as Curve, 1, 2e-5);
    }
    const half = { ...ellipse, endParam: Math.PI };
    const [h] = offsetGeometry(half, -2, TOL) as SplineGeometry[];
    expect(h!.closed).toBe(false);
    expectAtDistance(h as Spline, half as Curve, 2, 2e-5);
    const spline: SplineGeometry = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 3, y: 6 },
        { x: 7, y: -6 },
        { x: 10, y: 0 },
      ],
      closed: false,
      periodic: false,
      normal: { x: 0, y: 0, z: 1 },
    };
    const [o] = offsetGeometry(spline, 0.5, TOL) as SplineGeometry[];
    expect(o).toMatchObject({ kind: 'SPLINE', closed: false, normal: { x: 0, y: 0, z: 1 } });
    expectAtDistance(o as Spline, spline, 0.5, 2e-5);
  });

  it('works to the drawing tolerance on an inch drawing far from the origin', () => {
    // An architectural plan 2 miles out (126720") with a 1/64" offset: the drawing's tolerance
    // there is 1.3e-5", still 1/1000 of the offset, and the offset stays exact.
    const tol = toleranceForSize(130000);
    const x0 = 126720;
    const room = lw(true, [x0, x0], [x0 + 144, x0], [x0 + 144, x0 + 120], [x0, x0 + 120]);
    const [o] = offsetGeometry(room, -1 / 64, tol) as LwPolylineGeometry[];
    expect(o!.vertices[0]!.x).toBeCloseTo(x0 - 1 / 64, 9);
    expect(o!.vertices[2]!.y).toBeCloseTo(x0 + 120 + 1 / 64, 9);
    // A notch 1/32" wide, offset 1/64" inward: the legs meet exactly; nothing crosses back.
    const notch = lw(
      true,
      [x0, x0],
      [x0 + 1, x0],
      [x0 + 1, x0 + 1],
      [x0 + 0.5 + 1 / 64, x0 + 1],
      [x0 + 0.5 + 1 / 64, x0 + 0.5],
      [x0 + 0.5 - 1 / 64, x0 + 0.5],
      [x0 + 0.5 - 1 / 64, x0 + 1],
      [x0, x0 + 1],
    );
    const out = offsetGeometry(notch, 1 / 64, tol) as LwPolylineGeometry[];
    expect(out.length).toBeGreaterThan(0);
    for (const g of out) {
      for (const v of g.vertices) {
        expect(closestPoint(notch, v, tol).distance).toBeGreaterThan(1 / 64 - 1e-7);
      }
    }
  });
});

describe('offsetPolylineTraced', () => {
  it('says which source segment each offset segment came from, −1 for a bridge', () => {
    // A line, then a CW half circle doubling back: offset right, the carriers do not meet.
    const p: Polyline = lw(false, [0, 0], [2, 0, -1], [2, 2]);
    expect(offsetPolylineTraced(p, -0.5, TOL)!.from).toEqual([0, -1, 1]);
    // A collapsed arc segment is dropped and not traced.
    const q: Polyline = lw(false, [0, 0, 1], [1, 0], [5, 0]);
    expect(offsetPolylineTraced(q, 1, TOL)!.from).toEqual([1]);
  });
});
