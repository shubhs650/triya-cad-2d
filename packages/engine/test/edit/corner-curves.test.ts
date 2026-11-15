// M3-12 part 5: FILLET's geometry (edit/corner.ts) on ellipses, elliptical arcs, splines and the
// arc segments of 2D polylines, and an open polyline closed by filleting its first and last
// segments (AutoCAD 2024 Help, "FILLET (Command)": "A round or fillet can be created between two
// objects of the same or different object types: 2D polylines, arcs, circles, ellipses,
// elliptical arcs, lines, rays, splines, and xlines"; "About Fillets and Rounds": "Filleting the
// start and end segments of an open polyline results in a closed polyline"). Includes
// tolerance-sensitive cases on an inch drawing.
import { describe, expect, it } from 'vitest';
import {
  closestPoint,
  cornerEdit,
  cutLeg,
  derivativeAt,
  endPoint,
  filletCorner,
  legOf,
  offsetCurveOf,
  pointAt,
  samePolylineCorner,
  sharpCorner,
  startPoint,
  toleranceForSize,
  type Corner,
  type EntityGeometry,
  type Leg,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];
const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
const ellipse = (
  cx: number,
  cy: number,
  major: number,
  ratio: number,
  startParam = 0,
  endParam = 2 * Math.PI,
): EntityGeometry => ({
  kind: 'ELLIPSE',
  center: { x: cx, y: cy },
  majorAxis: { x: major, y: 0 },
  ratio,
  startParam,
  endParam,
});
/** A cubic spline through control points (clamped, uniform). */
const spline = (cps: [number, number][]): EntityGeometry => {
  const n = cps.length;
  const inner = Array.from({ length: n - 4 }, (_, i) => (i + 1) / (n - 3));
  return {
    kind: 'SPLINE',
    degree: 3,
    knots: [0, 0, 0, 0, ...inner, 1, 1, 1, 1],
    controlPoints: cps.map(([x, y]) => ({ x, y })),
    closed: false,
    periodic: false,
  } as EntityGeometry;
};
const leg = (g: EntityGeometry, x: number, y: number, t = tol): Leg => legOf(g, { x, y }, t)!;
const corner = (c: ReturnType<typeof filletCorner>): Corner => {
  if (typeof c === 'string') throw new Error(c);
  return c;
};
const lwpoly = (pts: [number, number, number?][], closed = false): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed,
  vertices: pts.map(([x, y, bulge]) => ({ x, y, bulge: bulge ?? 0 })),
});
const verts = (g: EntityGeometry | null | undefined) =>
  (g as unknown as { vertices: { x: number; y: number; bulge: number }[] }).vertices.map((v) => [
    r6(v.x),
    r6(v.y),
    r6(v.bulge),
  ]);

/** The fillet arc is tangent to `g` at `t`: `t` is on it, square to the radius there. */
function expectTangent(g: EntityGeometry, c: Corner, t: { x: number; y: number }) {
  const curve = offsetCurveOf(g)!;
  const near = closestPoint(curve, t, tol);
  expect(near.distance).toBeLessThan(1e-6);
  const arc = c.piece!.geom as { center: { x: number; y: number }; radius: number };
  const d = derivativeAt(curve, near.t);
  const v = { x: t.x - arc.center.x, y: t.y - arc.center.y };
  expect(Math.hypot(v.x, v.y)).toBeCloseTo(arc.radius, 9);
  const cos = (d.x * v.x + d.y * v.y) / (Math.hypot(d.x, d.y) * Math.hypot(v.x, v.y));
  expect(Math.abs(cos)).toBeLessThan(1e-6);
}

describe('fillet of ellipses', () => {
  it('fillets a line and a circle-shaped ellipse as it would the circle', () => {
    // Ellipse of radius 5 round the origin, line y = 6.5: the r 1 fillet's centre is at
    // y = 5.5, 6 from the origin, so x = ±√(36 − 30.25).
    const x = Math.sqrt(36 - 30.25);
    const a = leg(line(-10, 6.5, 10, 6.5), 8, 6.5);
    const b = leg(ellipse(0, 0, 5, 1), 4, 3);
    const c = corner(filletCorner(a, b, 1, tol));
    expect(c.piece!.geom).toMatchObject({ kind: 'ARC', radius: 1 });
    expect(pt((c.piece!.geom as { center: { x: number; y: number } }).center)).toEqual([
      r6(x),
      5.5,
    ]);
    expect(pt(c.t1)).toEqual([r6(x), 6.5]);
    expect(pt(c.t2)).toEqual([r6((x * 5) / 6), r6((5.5 * 5) / 6)]);
    // The whole ellipse is left whole, as a circle is; the line keeps the picked side.
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second?: EntityGeometry };
    expect(e.second).toBeUndefined();
    expect(pt((e.first as { start: { x: number; y: number } }).start)).toEqual([r6(x), 6.5]);
    expect(e.first).toMatchObject({ end: { x: 10, y: 6.5 } });
  });

  it('fillets a line and a true ellipse with an arc tangent to both, on the picked side', () => {
    // Ellipse semi-axes 10 and 5; line y = 7, above it. Fillets left and right: the right one.
    const g = ellipse(0, 0, 10, 0.5);
    const a = leg(line(-20, 7, 20, 7), 15, 7);
    const b = leg(g, 7, 3.5);
    const c = corner(filletCorner(a, b, 2, tol));
    const arc = c.piece!.geom as { center: { x: number; y: number }; radius: number };
    expect(arc.radius).toBe(2);
    expect(r6(arc.center.y)).toBe(5);
    expect(arc.center.x).toBeGreaterThan(0);
    expectTangent(g, c, c.t2);
    expect(r6(c.t1.y)).toBe(7);
    // The other side picked: the left fillet, its mirror image.
    const left = corner(filletCorner(leg(line(-20, 7, 20, 7), -15, 7), leg(g, -7, 3.5), 2, tol));
    expect(r6((left.piece!.geom as { center: { x: number } }).center.x)).toBe(r6(-arc.center.x));
  });

  it('trims an elliptical arc to the fillet, and carries one on round its ellipse', () => {
    // The upper half of the ellipse (params 0 to π), filleted with a line across its right end.
    const g = ellipse(0, 0, 10, 0.5, 0, Math.PI);
    const a = leg(g, -6, 4);
    const b = leg(line(8, -5, 8, 10), 8, 8);
    const c = corner(filletCorner(a, b, 1, tol));
    expectTangent(g, c, c.t1);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    // The arc's start moved to the tangent point; its end (the far, picked side) stays.
    const first = e.first as { startParam: number; endParam: number };
    expect(first.endParam).toBe(Math.PI);
    expect(first.startParam).toBeGreaterThan(0);
    expect(first.startParam).toBeLessThan(Math.PI / 2);
    expect(pt(pointAt(offsetCurveOf(e.first)!, first.startParam))).toEqual(pt(c.t1));
    // Line x = 9.9 below the arc's start at (10, 0): the arc goes on round (back) to it.
    const lower = leg(line(9.9, -10, 9.9, -1), 9.9, -5);
    const sharp = corner(sharpCorner(a, lower, tol));
    const s = cutLeg(g, sharp.t1, sharp.k1, tol) as { startParam: number; endParam: number };
    expect(s.startParam).toBeGreaterThan(Math.PI);
    expect(s.endParam).toBe(Math.PI);
  });

  it('refuses an elliptical arc that would have to go the long way round', () => {
    const g = ellipse(0, 0, 10, 0.5, 0, Math.PI / 2);
    // A cut at param 3π/2 (0, −5) made the arc's end: π on from its end, π/2 back from its start.
    const t = pointAt(offsetCurveOf(ellipse(0, 0, 10, 0.5))!, (3 * Math.PI) / 2);
    expect(cutLeg(g, t, { x: -1, y: 0 }, tol)).toBeUndefined();
    // Made its start instead, it is carried back a quarter turn.
    expect(cutLeg(g, t, { x: 1, y: 0 }, tol)).toMatchObject({ endParam: Math.PI / 2 });
  });

  it('fillets an ellipse a million units from the origin as near it', () => {
    // The same ellipse and line at the origin and at (1e6, 1e6), at a tight tolerance.
    const at = (o: number) => {
      const g = ellipse(o + 40, o + 50, 20, 0.5);
      const a = leg(g, o + 52, o + 58);
      const b = leg(line(o + 10, o + 65, o + 70, o + 65), o + 60, o + 65);
      return { g, c: corner(filletCorner(a, b, 3, tol)) };
    };
    const near = at(0);
    const far = at(1e6);
    expectTangent(far.g, far.c, far.c.t1);
    expect(far.c.t1.x - 1e6).toBeCloseTo(near.c.t1.x, 6);
    expect(far.c.t2.x - 1e6).toBeCloseTo(near.c.t2.x, 6);
  });

  it('fillets two ellipses outside each other', () => {
    const g1 = ellipse(0, 0, 4, 0.5);
    const g2 = ellipse(12, 0, 4, 0.5);
    const c = corner(filletCorner(leg(g1, 3, 1.3), leg(g2, 9, 1.3), 3, tol));
    expectTangent(g1, c, c.t1);
    expectTangent(g2, c, c.t2);
    expect((c.piece!.geom as { center: { y: number } }).center.y).toBeGreaterThan(0);
  });
});

describe('fillet of splines', () => {
  const wave = spline([
    [0, 0],
    [5, 6],
    [10, -2],
    [15, 4],
    [20, 0],
  ]);

  it('fillets a spline and a line, the spline cut at the tangent point', () => {
    const g = wave;
    const a = leg(g, 2, 2.5);
    const b = leg(line(-5, 4, 8, 4), 1, 4);
    const c = corner(filletCorner(a, b, 1, tol));
    expectTangent(g, c, c.t1);
    expect(r6(c.t2.y)).toBe(4);
    // Left of the spline's peak, where both were picked.
    expect(c.t1.x).toBeLessThan(4);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    // The part of the spline toward the pick is kept: from its start to the tangent point.
    expect(e.first.kind).toBe('SPLINE');
    const kept = offsetCurveOf(e.first)!;
    expect(pt(startPoint(kept))).toEqual([0, 0]);
    expect(pt(endPoint(kept))).toEqual(pt(c.t1));
    expect(e.second).toMatchObject({ start: { x: -5, y: 4 } });
  });

  it('makes a sharp corner of a spline and a line where they cross', () => {
    const a = leg(wave, 18, 1.5);
    const b = leg(line(17, -3, 17, 8), 17, 6);
    const c = corner(sharpCorner(a, b, tol));
    expect(r6(c.t1.x)).toBe(17);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: EntityGeometry };
    const kept = offsetCurveOf(e.first)!;
    expect(pt(endPoint(kept))).toEqual([20, 0]);
    expect(pt(startPoint(kept))).toEqual(pt(c.t1));
    expect(e.second).toMatchObject({ end: { x: 17, y: 8 } });
  });

  it('does not extend a spline: a fillet past its end is not possible', () => {
    // Line x = 25 lies beyond the spline's end at (20, 0).
    const a = leg(wave, 19, 0.5);
    const b = leg(line(25, -10, 25, 10), 25, -5);
    expect(filletCorner(a, b, 1, tol)).toBe('no-fillet');
  });

  it('leaves a closed spline whole', () => {
    // A closed (end = start) cubic loop.
    const loop = spline([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    const a = leg(loop, 7, 2);
    const b = leg(line(-5, -3, 20, -3), 7, -3);
    const c = corner(filletCorner(a, b, 2, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first?: EntityGeometry; second: EntityGeometry };
    expect(e.first).toBeUndefined();
    expect(e.second.kind).toBe('LINE');
  });

  it('fillets a spline at the scale of an inch drawing far from the origin', () => {
    const big = toleranceForSize(200000);
    const shift = (g: EntityGeometry): EntityGeometry => {
      const s = g as unknown as { controlPoints: { x: number; y: number }[] };
      return {
        ...g,
        controlPoints: s.controlPoints.map((p) => ({ x: p.x + 1e5, y: p.y + 5e4 })),
      } as EntityGeometry;
    };
    const g = shift(wave);
    const a = leg(g, 1e5 + 2, 5e4 + 2.5, big);
    const b = leg(line(1e5 - 5, 5e4 + 4, 1e5 + 8, 5e4 + 4), 1e5 + 1, 5e4 + 4, big);
    const c = corner(filletCorner(a, b, 0.5, big));
    const arc = c.piece!.geom as { center: { x: number; y: number }; radius: number };
    expect(arc.radius).toBe(0.5);
    expect(closestPoint(offsetCurveOf(g)!, arc.center, big).distance).toBeCloseTo(0.5, 6);
    expect(arc.center.y).toBeCloseTo(5e4 + 3.5, 6);
  });
});

describe('fillet of polyline arc segments', () => {
  it('fillets a line to a polyline’s end arc segment, joining it with the arc cut short', () => {
    // A polyline (0,0)-(10,0) then a CCW half circle round (10,5) to (10,10); a line along y = 12.
    const p = lwpoly([
      [0, 0],
      [10, 0, 1],
      [10, 10],
    ]);
    const a = leg(p, 15, 5); // the arc segment
    const b = leg(line(0, 12, 20, 12), 3, 12);
    const c = corner(filletCorner(a, b, 1, tol));
    // Centre at distance 6 from (10,5) on y = 11.
    const x = 10 + Math.sqrt(36 - 36);
    expect(pt((c.piece!.geom as { center: { x: number; y: number } }).center)).toEqual([r6(x), 11]);
  });

  it('cuts an end arc segment short and gives it the bulge of what is left', () => {
    // The arc from (10,0) CCW round (10,5) to (10,10), filleted with the line y = 9 at its right.
    const p = lwpoly([
      [0, 0],
      [10, 0, 1],
      [10, 10],
    ]);
    const a = leg(p, 15, 5);
    const b = leg(line(0, 9, 20, 9), 17, 9);
    const c = corner(filletCorner(a, b, 1, tol));
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: null };
    expect(e.second).toBeNull();
    const v = verts(e.first);
    // (0,0), (10,0) with the shortened arc's bulge, the tangent point with the fillet's, then
    // the line's far end.
    expect(v).toHaveLength(5);
    expect(v[0]).toEqual([0, 0, 0]);
    expect(v[1]!.slice(0, 2)).toEqual([10, 0]);
    expect(v[1]![2]).toBeGreaterThan(0);
    expect(v[1]![2]).toBeLessThan(1);
    expect(pt({ x: v[2]![0]!, y: v[2]![1]! })).toEqual(pt(c.t1));
    expect(v[3]!.slice(0, 2)).toEqual(pt(c.t2));
    expect(v[4]).toEqual([20, 9, 0]);
    // Centre (10 + √27, 8), 6 from the arc's centre: the arc now ends at 30°, a 120° sweep.
    expect(v[1]![2]).toBe(r6(Math.tan(Math.PI / 6)));
    // The arc's end is on its circle.
    expect(Math.hypot(v[2]![0]! - 10, v[2]![1]! - 5)).toBeCloseTo(5, 5);
  });

  it('carries an end arc segment on round its circle to a line beyond it', () => {
    // A CCW quarter circle from (0,0) round (0,5) to (5,5), and the line y = 9 above it: radius 0.
    const p = lwpoly([
      [-5, 0],
      [0, 0, Math.tan(Math.PI / 8)],
      [5, 5],
    ]);
    const a = leg(p, 4.5, 3);
    const b = leg(line(-5, 9, 10, 9), 9, 9);
    const c = corner(sharpCorner(a, b, tol));
    // The arc's circle (centre (0,5), r 5) meets y = 9 at x = 3: going on CCW from (5,5).
    expect(pt(c.t1)).toEqual([3, 9]);
    const e = cornerEdit(a, b, c, true, tol) as { first: EntityGeometry; second: null };
    const v = verts(e.first);
    expect(v[1]!.slice(0, 2)).toEqual([0, 0]);
    // The arc now sweeps from −90° to atan2(4, 3): tan(sweep/4).
    expect(v[1]![2]).toBe(r6(Math.tan((Math.PI / 2 + Math.atan2(4, 3)) / 4)));
    expect(v[2]).toEqual([3, 9, 0]);
    expect(v[3]).toEqual([10, 9, 0]);
  });

  it('fillets an arc segment and the line segment next to it inside the polyline', () => {
    // (0,10)-(0,0) then an arc bulging out to (10,0): bulge −0.4 (CW).
    const p = lwpoly([
      [0, 10],
      [0, 0, -0.4],
      [10, 0],
    ]);
    const a = leg(p, 0, 6);
    const b = leg(p, 5, -1.9);
    const c = corner(filletCorner(a, b, 1, tol));
    const g = samePolylineCorner(a, b, c, tol);
    if (typeof g === 'string') throw new Error(g);
    const v = verts(g);
    expect(v).toHaveLength(4);
    expect(v[0]).toEqual([0, 10, 0]);
    expect(pt({ x: v[1]![0]!, y: v[1]![1]! })).toEqual(pt(c.t1));
    expect(v[1]![2]).toBe(r6(c.piece!.bulge));
    expect(pt({ x: v[2]![0]!, y: v[2]![1]! })).toEqual(pt(c.t2));
    // The rest of the arc still turns CW, less than before.
    expect(v[2]![2]).toBeLessThan(0);
    expect(v[2]![2]).toBeGreaterThan(-0.4);
    expect(v[3]).toEqual([10, 0, 0]);
  });
});

describe('closing an open polyline', () => {
  const u = lwpoly([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 2],
  ]);

  it('fillets its first and last segments into a closed polyline', () => {
    const a = leg(u, 5, 0);
    const b = leg(u, 0, 6);
    const c = corner(filletCorner(a, b, 1, tol));
    const g = samePolylineCorner(a, b, c, tol);
    if (typeof g === 'string') throw new Error(g);
    expect(g).toMatchObject({ closed: true });
    // From (1,0) round the polyline to (0,1), the fillet closing it.
    expect(verts(g)).toEqual([
      [1, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 1, r6(Math.tan(Math.PI / 8))],
    ]);
  });

  it('closes it with a sharp corner, picked either way round', () => {
    const a = leg(u, 0, 6);
    const b = leg(u, 5, 0);
    const c = corner(sharpCorner(a, b, tol));
    const g = samePolylineCorner(a, b, c, tol);
    if (typeof g === 'string') throw new Error(g);
    expect(g).toMatchObject({ closed: true });
    expect(verts(g)).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('says the radius is too large when an end segment is too short for it', () => {
    const a = leg(u, 5, 0);
    const b = leg(u, 0, 6);
    expect(samePolylineCorner(a, b, corner(filletCorner(a, b, 11, tol)), tol)).toBe('too-large');
  });
});
