// M3-02 part 2: TRIM's and EXTEND's geometry (`edit/trim.ts`), as AutoCAD 2024 trims and extends
// (AutoCAD 2024 Help, "TRIM (Command)", "EXTEND (Command)", EDGEMODE), including the
// tolerance-sensitive cases of inch drawings: ends a hair off an edge, tiny features far from the
// origin.
import { describe, expect, it } from 'vitest';
import {
  cutParams,
  distance,
  domain,
  edgeCurvesOf,
  extendGeometry,
  pickParam,
  pointAt,
  subGeometry,
  subSpline,
  toleranceForSize,
  trimCurveOf,
  trimGeometry,
  type Curve,
  type EntityGeometry,
  type LwPolylineGeometry,
  type Spline,
  type Vec2,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];

const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

/** Trims `g` at the point picked with `edges` as cutting edges (EDGEMODE `extend`). */
function trim(
  g: EntityGeometry,
  edges: readonly EntityGeometry[],
  pick: Vec2,
  extend = false,
  t = tol,
): EntityGeometry[] | undefined {
  const c = trimCurveOf(g)!;
  const curves = edges.flatMap((e) => edgeCurvesOf(e, extend));
  return trimGeometry(g, c, cutParams(c, curves, t), pickParam(c, pick, t), t);
}

function extend(
  g: EntityGeometry,
  edges: readonly EntityGeometry[],
  pick: Vec2,
  edgeExtend = false,
  t = tol,
): EntityGeometry | undefined {
  const c = trimCurveOf(g)!;
  const curves = edges.flatMap((e) => edgeCurvesOf(e, edgeExtend));
  return extendGeometry(g, c, curves, pickParam(c, pick, t), t);
}

const ends = (g: EntityGeometry | undefined) => {
  const c = trimCurveOf(g!)!;
  const d = domain(c);
  return [...pt(pointAt(c, d.start)), ...pt(pointAt(c, d.end))];
};

describe('TRIM geometry', () => {
  const v3 = line(3, -5, 3, 5);
  const v7 = line(7, -5, 7, 5);

  it('cuts a line between the edges either side of the pick, or from an edge to its end', () => {
    const l = line(0, 0, 10, 0);
    expect(trim(l, [v3, v7], { x: 5, y: 0 })!.map(ends)).toEqual([
      [0, 0, 3, 0],
      [7, 0, 10, 0],
    ]);
    expect(trim(l, [v3, v7], { x: 9, y: 0 })!.map(ends)).toEqual([[0, 0, 7, 0]]);
    expect(trim(l, [v3, v7], { x: 1, y: 0 })!.map(ends)).toEqual([[3, 0, 10, 0]]);
    // No edge crosses it: nothing to trim.
    expect(trim(l, [line(20, -5, 20, 5)], { x: 5, y: 0 })).toBeUndefined();
  });

  it('does not cut a line where it only ends on an edge', () => {
    // A T: the line ends on v3, so the pick trims it back to v7 only.
    const l = line(3, 0, 10, 0);
    expect(trim(l, [v3, v7], { x: 9, y: 0 })!.map(ends)).toEqual([[3, 0, 7, 0]]);
    expect(trim(l, [v3, v7], { x: 5, y: 0 })!.map(ends)).toEqual([[7, 0, 10, 0]]);
    expect(trim(line(3, 0, 7, 0), [v3, v7], { x: 5, y: 0 })).toBeUndefined();
  });

  it('leaves a circle as the arc beyond the edges, and a full ellipse as an elliptical arc', () => {
    const circle: EntityGeometry = { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 };
    const x0 = line(0, -10, 0, 10);
    const [arc] = trim(circle, [x0], { x: 5, y: 0 })!;
    expect(arc).toMatchObject({ kind: 'ARC', center: { x: 0, y: 0 }, radius: 5 });
    const a = arc as { startAngle: number; endAngle: number };
    expect([r6(a.startAngle), r6(a.endAngle)]).toEqual([r6(Math.PI / 2), r6((3 * Math.PI) / 2)]);
    // Cut once only: a closed curve keeps its shape.
    expect(trim(circle, [line(0, 0, 0, 10)], { x: 5, y: 0 })).toBeUndefined();
    const ellipse: EntityGeometry = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    const [e] = trim(ellipse, [x0], { x: -10, y: 0 })!;
    expect(e).toMatchObject({ kind: 'ELLIPSE', majorAxis: { x: 10, y: 0 }, ratio: 0.5 });
    expect(ends(e)).toEqual([0, -5, 0, 5]);
  });

  it('cuts an arc and keeps its elevation', () => {
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      elevation: 2,
    };
    const out = trim(arc, [line(0, 0, 0, 10)], { x: 4, y: 3 })!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'ARC', elevation: 2 });
    expect(ends(out[0])).toEqual([0, 5, -5, 0]);
  });

  it('cuts xlines into rays and rays into a line and a ray', () => {
    const xl: EntityGeometry = { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const out = trim(xl, [v3, v7], { x: 5, y: 0 })!;
    expect(out).toEqual([
      { kind: 'RAY', base: { x: 3, y: 0 }, direction: { x: -1, y: 0 } },
      { kind: 'RAY', base: { x: 7, y: 0 }, direction: { x: 1, y: 0 } },
    ]);
    const ray: EntityGeometry = { kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 2, y: 0 } };
    const parts = trim(ray, [v3, v7], { x: 5, y: 0 })!;
    expect(parts.map((p) => p.kind)).toEqual(['LINE', 'RAY']);
    expect(ends(parts[0])).toEqual([0, 0, 3, 0]);
    expect(trim(ray, [v3, v7], { x: 9, y: 0 })!.map(ends)).toEqual([[0, 0, 7, 0]]);
  });

  it('cuts an open polyline through its segments, arcs and widths', () => {
    // (0,0)-(10,0) straight, then a half circle bulging down from (10,0) to (10,10), widths 0→2.
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 0, endWidth: 2 },
        { x: 10, y: 0, bulge: 1, startWidth: 2, endWidth: 2 },
        { x: 10, y: 10, bulge: 0 },
      ],
    };
    const out = trim(pl, [line(5, -5, 5, 5), line(10, 5, 20, 5)], { x: 12, y: 1 })!;
    expect(out).toHaveLength(2);
    const [a, b] = out as LwPolylineGeometry[];
    expect(a!.vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)])).toEqual([
      [0, 0, 0],
      [5, 0, 0],
    ]);
    expect(a!.vertices[0]).toMatchObject({ startWidth: 0, endWidth: 1 });
    // What is left of the half circle is its upper quarter, from (15,5) to (10,10).
    expect(b!.vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)])).toEqual([
      [15, 5, r6(Math.tan(Math.PI / 8))],
      [10, 10, 0],
    ]);
  });

  it('opens a closed polyline at the edges, going round', () => {
    const square: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      constantWidth: 0.5,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
    };
    const out = trim(square, [line(5, -5, 5, 15)], { x: 7, y: 0 })!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'LWPOLYLINE', closed: false, constantWidth: 0.5 });
    const vs = (out[0] as LwPolylineGeometry).vertices.map(pt);
    expect(vs).toEqual([
      [5, 10],
      [0, 10],
      [0, 0],
      [5, 0],
    ]);
  });

  it('cuts a spline into exact NURBS pieces, and opens a closed one going round', () => {
    const s: Spline = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 0, 0, 0, 1, 2, 2, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 2, y: 5 },
        { x: 5, y: -5 },
        { x: 8, y: 5 },
        { x: 10, y: 0 },
      ],
    };
    const part = subSpline(s, 0.4, 1.7)!;
    expect(part.knots.slice(0, 4)).toEqual([0.4, 0.4, 0.4, 0.4]);
    for (let i = 0; i <= 10; i++) {
      const u = 0.4 + (1.3 * i) / 10;
      expect(distance(pointAt(part, u), pointAt(s, u))).toBeLessThan(1e-9);
    }
    // Rational: weights carried through.
    const r: Spline = { ...s, weights: [1, 2, 0.5, 1, 1] };
    const rp = subSpline(r, 0.3, 1.2)!;
    expect(rp.weights).toBeDefined();
    for (let i = 0; i <= 10; i++) {
      const u = 0.3 + (0.9 * i) / 10;
      expect(distance(pointAt(rp, u), pointAt(r, u))).toBeLessThan(1e-9);
    }
    // A closed periodic cubic (unclamped knots, wrapped control points), cut twice by x = 0.
    const ring: EntityGeometry = {
      kind: 'SPLINE',
      degree: 3,
      knots: [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7],
      controlPoints: [
        { x: 5, y: 0 },
        { x: 0, y: 5 },
        { x: -5, y: 0 },
        { x: 0, y: -5 },
        { x: 5, y: 0 },
        { x: 0, y: 5 },
        { x: -5, y: 0 },
      ],
      closed: true,
      periodic: true,
    };
    const c = trimCurveOf(ring)!;
    const out = trim(ring, [line(0, -10, 0, 10)], { x: -5, y: 0 })!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'SPLINE', closed: false, periodic: false });
    const left = trimCurveOf(out[0]!)!;
    const d = domain(left);
    // What is left is the right half: its ends on x = 0 and its middle the original's x > 0.
    expect(Math.abs(pointAt(left, d.start).x)).toBeLessThan(1e-9);
    expect(Math.abs(pointAt(left, d.end).x)).toBeLessThan(1e-9);
    for (let i = 1; i < 10; i++) {
      const p = pointAt(left, d.start + ((d.end - d.start) * i) / 10);
      expect(p.x).toBeGreaterThan(0);
      const back = pointAt(c, pickParam(c, p, tol));
      expect(distance(back, p)).toBeLessThan(1e-7);
    }
  });

  it('cuts at implied edges with EDGEMODE Extend', () => {
    const l = line(0, 0, 10, 0);
    // A short line that stops short of `l`, and an arc whose circle crosses it.
    const short = line(3, 2, 3, 5);
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 8, y: 0 },
      radius: 1,
      startAngle: Math.PI / 4,
      endAngle: (3 * Math.PI) / 4,
    };
    expect(trim(l, [short, arc], { x: 5, y: 0 })).toBeUndefined();
    expect(trim(l, [short, arc], { x: 5, y: 0 }, true)!.map(ends)).toEqual([
      [0, 0, 3, 0],
      [7, 0, 10, 0],
    ]);
  });

  it('leaves a part no longer than the tolerance as nothing', () => {
    const l = line(0, 0, 10, 0);
    expect(subGeometry(l, trimCurveOf(l)!, 0.5, 0.5, tol)).toBeUndefined();
  });
});

describe('EXTEND geometry', () => {
  const wall = line(20, -10, 20, 10);

  it('extends the end of a line nearer the pick to the nearest edge', () => {
    const l = line(0, 0, 10, 0);
    expect(ends(extend(l, [wall, line(15, -1, 15, 1)], { x: 9, y: 0 }))).toEqual([0, 0, 15, 0]);
    expect(ends(extend(l, [line(-4, -1, -4, 1), wall], { x: 1, y: 0 }))).toEqual([-4, 0, 10, 0]);
    // Nothing that way.
    expect(extend(l, [wall], { x: 1, y: 0 })).toBeUndefined();
    // An edge it would only meet if the edge went on: EDGEMODE Extend.
    const short = line(15, 2, 15, 5);
    expect(extend(l, [short], { x: 9, y: 0 })).toBeUndefined();
    expect(ends(extend(l, [short], { x: 9, y: 0 }, true))).toEqual([0, 0, 15, 0]);
  });

  it('extends an arc round its circle, either way, but never closed', () => {
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const xAxis = line(-10, 0, 10, 0);
    // Its end (at 90°) goes on to the x axis at 180°.
    expect(ends(extend(arc, [xAxis], { x: 0.5, y: 5 }))).toEqual([5, 0, -5, 0]);
    // Its start (at 0°, on the axis already) goes back round to 180° the other way.
    expect(ends(extend(arc, [xAxis], { x: 5, y: 0.5 }))).toEqual([-5, 0, 0, 5]);
  });

  it('extends an elliptical arc round its ellipse', () => {
    const e: EntityGeometry = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: Math.PI / 2,
    };
    expect(ends(extend(e, [line(-20, 0, 20, 0)], { x: 1, y: 5 }))).toEqual([10, 0, -10, 0]);
  });

  it("extends a polyline's end segment, straight or curved", () => {
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: Math.tan(Math.PI / 8) },
        { x: 15, y: 5, bulge: 0 },
      ],
    };
    // The end arc (centre (10,5), r 5, from 270° to 360°) goes on round to the top at y = 10.
    const top = line(0, 10, 30, 10);
    const out = extend(pl, [top], { x: 14.9, y: 4 }) as LwPolylineGeometry;
    expect(out.vertices.map(pt)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(r6(out.vertices[1]!.bulge)).toBe(r6(Math.tan(Math.PI / 4)));
    // The start segment goes back along the line to x = -3.
    const back = extend(pl, [line(-3, -5, -3, 5)], { x: 1, y: 0 }) as LwPolylineGeometry;
    expect(pt(back.vertices[0]!)).toEqual([-3, 0]);
    // A closed polyline or a circle cannot be extended.
    expect(
      extend({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, [top], { x: 1, y: 0 }),
    ).toBeUndefined();
  });
});

describe('TRIM and EXTEND on an inch drawing', () => {
  // A plate 1234.5625" from the origin: the drawing's tolerance is about 1.3e-7".
  const X = 1234.5625;
  const t = toleranceForSize(1300);

  it('takes an end a hair off an edge as on it, and a gap beyond the tolerance as a gap', () => {
    const edge = line(X + 1, -1, X + 1, 1);
    const far = line(X + 2, -1, X + 2, 1);
    // Ends 1e-9" short of the edge: on it, so the pick trims nothing there and EXTEND goes on
    // to the next edge.
    const l = line(X, 0, X + 1 - 1e-9, 0);
    expect(trim(l, [edge], { x: X + 0.5, y: 0 }, false, t)).toBeUndefined();
    expect(ends(extend(l, [edge, far], { x: X + 0.9, y: 0 }, false, t))).toEqual([X, 0, X + 2, 0]);
    // Ends 1e-5" past the edge: a real overshoot, trimmed back to the edge.
    const over = line(X, 0, X + 1 + 1e-5, 0);
    const out = trim(over, [edge], { x: X + 1 + 5e-6, y: 0 }, false, t)!;
    expect(out).toHaveLength(1);
    expect(Math.abs((out[0] as { end: Vec2 }).end.x - (X + 1))).toBeLessThan(t.linear);
  });

  it('trims a 1/64" circle exactly at its quarter points', () => {
    const r = 1 / 128;
    const c: EntityGeometry = { kind: 'CIRCLE', center: { x: X, y: X }, radius: r };
    const out = trim(c, [line(X, X - 1, X, X + 1)], { x: X + r, y: X }, false, t)!;
    const g = out[0] as { kind: string; startAngle: number; endAngle: number };
    expect(g.kind).toBe('ARC');
    const cv = trimCurveOf(out[0]!) as Curve;
    const d = domain(cv);
    expect(Math.abs(pointAt(cv, d.start).x - X)).toBeLessThan(t.linear);
    expect(Math.abs(pointAt(cv, d.end).x - X)).toBeLessThan(t.linear);
    expect(pointAt(cv, (d.start + d.end) / 2).x).toBeLessThan(X);
  });
});
