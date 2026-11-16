// M3-02 part 4: BREAK's, LENGTHEN's, REVERSE's, JOIN's and EXPLODE's geometry (`edit/break.ts`,
// `edit/join.ts`, `edit/explode.ts`), as AutoCAD 2024 breaks, lengthens, reverses, joins and
// explodes (AutoCAD Help, "BREAK (Command)", "LENGTHEN (Command)", "REVERSE (Command)",
// "JOIN (Command)", "EXPLODE (Command)"), including tolerance-sensitive cases of inch drawings.
import { describe, expect, it } from 'vitest';
import {
  breakCurveOf,
  breakGeometry,
  closestPoint,
  curveLength,
  domain,
  joinObjects,
  lengthenGeometry,
  lengthTo,
  measureLength,
  movesEnd,
  pointAt,
  reverseGeometry,
  toleranceForSize,
  type BoundedCurve,
  type Curve,
  type EntityGeometry,
  type EntityId,
  type Vec2,
  type PolylineGeometry,
} from '../../src/index';

const tol = toleranceForSize(100);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];

const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
const arc = (x: number, y: number, r: number, a0: number, a1: number): EntityGeometry => ({
  kind: 'ARC',
  center: { x, y },
  radius: r,
  startAngle: (a0 * Math.PI) / 180,
  endAngle: (a1 * Math.PI) / 180,
});
const deg = (a: number) => r6((a * 180) / Math.PI);

/** The ends of a bounded geometry's curve. */
function ends(g: EntityGeometry): number[][] {
  const c = breakCurveOf(g) as Curve;
  const d = domain(c);
  return [pt(pointAt(c, d.start)), pt(pointAt(c, d.end))];
}

function broken(g: EntityGeometry, p1: Vec2, p2: Vec2, t = tol) {
  const c = breakCurveOf(g)!;
  return breakGeometry(g, c, closestPoint(c, p1, t).t, closestPoint(c, p2, t).t, t);
}

describe('BREAK', () => {
  it('removes the part of a line between the points, projecting points off it', () => {
    const out = broken(line(0, 0, 10, 0), { x: 3, y: 1 }, { x: 7, y: -1 }) as EntityGeometry[];
    expect(out.map(ends)).toEqual([
      [
        [0, 0],
        [3, 0],
      ],
      [
        [7, 0],
        [10, 0],
      ],
    ]);
    // A second point past the end breaks that end off.
    const end = broken(line(0, 0, 10, 0), { x: 6, y: 0 }, { x: 15, y: 0 }) as EntityGeometry[];
    expect(end.map(ends)).toEqual([
      [
        [0, 0],
        [6, 0],
      ],
    ]);
  });

  it('splits at one point (BREAKATPOINT, @), and leaves a point at an end alone', () => {
    const out = broken(line(0, 0, 10, 0), { x: 4, y: 0 }, { x: 4, y: 0 }) as EntityGeometry[];
    expect(out.map(ends)).toEqual([
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [10, 0],
      ],
    ]);
    const g = line(0, 0, 10, 0);
    expect(broken(g, { x: 10, y: 0 }, { x: 10, y: 0 })).toEqual([g]);
  });

  it('turns a circle into an arc, removing counterclockwise from the first to the second point', () => {
    const c: EntityGeometry = { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 };
    const out = broken(c, { x: 5, y: 0 }, { x: 0, y: 5 }) as EntityGeometry[];
    expect(out).toHaveLength(1);
    const a = out[0] as { kind: string; startAngle: number; endAngle: number };
    expect(a.kind).toBe('ARC');
    // What is left runs from the second point (90°) round to the first (0°).
    expect([deg(a.startAngle), deg(a.endAngle)]).toEqual([90, 0]);
    // The other way round removes the other three quarters.
    const back = broken(c, { x: 0, y: 5 }, { x: 5, y: 0 }) as EntityGeometry[];
    const b = back[0] as { startAngle: number; endAngle: number };
    expect([deg(b.startAngle), deg(b.endAngle)]).toEqual([0, 90]);
    expect(broken(c, { x: 5, y: 0 }, { x: 5, y: 0 })).toBe('full circle');
  });

  it('opens a closed polyline its own way round, and will not break it at a single point', () => {
    const square: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
    };
    const out = broken(square, { x: 5, y: 0 }, { x: 10, y: 5 }) as EntityGeometry[];
    const g = out[0] as unknown as { closed: boolean; vertices: Vec2[] };
    expect(g.closed).toBe(false);
    expect(g.vertices.map(pt)).toEqual([
      [10, 5],
      [10, 10],
      [0, 10],
      [0, 0],
      [5, 0],
    ]);
    expect(broken(square, { x: 5, y: 0 }, { x: 5, y: 0 })).toBe('closed at a point');
  });

  it('breaks an xline into two rays and refuses to leave nothing', () => {
    const x: EntityGeometry = { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const out = broken(x, { x: -1, y: 0 }, { x: 1, y: 0 }) as EntityGeometry[];
    expect(out.map((g) => g.kind)).toEqual(['RAY', 'RAY']);
    expect(broken(line(0, 0, 10, 0), { x: -1, y: 0 }, { x: 11, y: 0 })).toBe('nothing left');
  });
});

describe('LENGTHEN', () => {
  const lengthen = (g: EntityGeometry, atEnd: boolean, to: number) =>
    lengthenGeometry(g, breakCurveOf(g)!, atEnd, to, tol);

  it('measures lines and arcs, an arc with its included angle', () => {
    expect(measureLength(breakCurveOf(line(0, 0, 3, 4))!)).toEqual({ length: 5 });
    const m = measureLength(breakCurveOf(arc(0, 0, 2, 0, 90))!)!;
    expect([r6(m.length), deg(m.angle!)]).toEqual([r6(Math.PI), 90]);
  });

  it('moves the end nearer the pick of a line, either way', () => {
    const g = line(0, 0, 10, 0);
    const c = breakCurveOf(g) as BoundedCurve;
    expect(movesEnd(c, 0.8)).toBe(true);
    expect(movesEnd(c, 0.2)).toBe(false);
    expect(ends(lengthen(g, true, 12) as EntityGeometry)).toEqual([
      [0, 0],
      [12, 0],
    ]);
    expect(ends(lengthen(g, false, 4) as EntityGeometry)).toEqual([
      [6, 0],
      [10, 0],
    ]);
    expect(lengthen(g, true, 0)).toBe('invalid');
    expect(lengthen(g, true, -2)).toBe('invalid');
  });

  it('turns an arc on round its circle, but not to a full circle', () => {
    const a = lengthen(arc(0, 0, 2, 0, 90), true, Math.PI * 2) as { endAngle: number };
    expect(deg(a.endAngle)).toBe(180);
    const s = lengthen(arc(0, 0, 2, 0, 90), false, Math.PI * 2) as { startAngle: number };
    expect(deg(s.startAngle)).toBe(270);
    expect(lengthen(arc(0, 0, 2, 0, 90), true, 4 * Math.PI)).toBe('too long');
  });

  it("carries a polyline's end segment on, straight or round, and cuts it short", () => {
    const p: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: Math.tan(Math.PI / 8) },
        { x: 15, y: 5, bulge: 0 },
      ],
    };
    const total = 10 + (Math.PI / 2) * 5;
    // 5 more round the quarter circle about (10, 5).
    const longer = lengthen(p, true, total + (5 * Math.PI) / 2) as unknown as {
      vertices: { x: number; y: number; bulge: number }[];
    };
    expect(pt(longer.vertices[2]!)).toEqual([10, 10]);
    expect(r6(longer.vertices[1]!.bulge)).toBe(r6(Math.tan(Math.PI / 4)));
    // Its start goes back along the first segment.
    const back = lengthen(p, false, total + 2) as unknown as { vertices: Vec2[] };
    expect(pt(back.vertices[0]!)).toEqual([-2, 0]);
    // Cut to 6 from the end: what is left is part of the first segment.
    const short = lengthen(p, true, 6) as unknown as { vertices: Vec2[] };
    expect(short.vertices.map(pt)).toEqual([
      [0, 0],
      [6, 0],
    ]);
  });

  it('grows an elliptical arc round its ellipse by length, and splines along their end', () => {
    const e: EntityGeometry = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: Math.PI / 2,
    };
    const c = breakCurveOf(e) as BoundedCurve;
    const quarter = curveLength(c);
    const half = lengthen(e, true, 2 * quarter) as { endParam: number };
    expect(r6(half.endParam)).toBe(r6(Math.PI));
    const back = lengthen(e, false, 2 * quarter) as { startParam: number };
    expect(r6(back.startParam)).toBe(r6(1.5 * Math.PI));
    expect(lengthen(e, true, 5 * quarter)).toBe('too long');
    const s: EntityGeometry = {
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
      periodic: false,
    };
    expect(ends(lengthen(s, true, 12) as EntityGeometry)).toEqual([
      [0, 0],
      [12, 0],
    ]);
    expect(ends(lengthen(s, true, 4) as EntityGeometry)).toEqual([
      [0, 0],
      [4, 0],
    ]);
    const closed: EntityGeometry = { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 };
    expect(lengthen(closed, true, 1)).toBe('closed');
  });

  it('measures a dragged end along the line or round the arc (DYnamic)', () => {
    const l = breakCurveOf(line(0, 0, 10, 0))!;
    expect(lengthTo(l, true, { x: 13, y: 4 }, tol)).toBe(13);
    expect(lengthTo(l, false, { x: 4, y: 1 }, tol)).toBe(6);
    expect(lengthTo(l, true, { x: -1, y: 0 }, tol)).toBeUndefined();
    const a = breakCurveOf(arc(0, 0, 2, 0, 90))!;
    expect(r6(lengthTo(a, true, { x: -5, y: 0 }, tol)!)).toBe(r6(2 * Math.PI));
    expect(r6(lengthTo(a, false, { x: 0, y: -1 }, tol)!)).toBe(r6(2 * Math.PI));
  });
});

describe('REVERSE', () => {
  it('runs a polyline the other way, bulges negated and widths swapped', () => {
    const p: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 1, endWidth: 2 },
        { x: 10, y: 0, bulge: 0.5 },
        { x: 20, y: 0, bulge: 0 },
      ],
    };
    const r = reverseGeometry(p) as unknown as { vertices: { x: number; bulge: number }[] };
    expect(r.vertices).toEqual([
      { x: 20, y: 0, bulge: -0.5 },
      { x: 10, y: 0, bulge: 0, startWidth: 2, endWidth: 1 },
      { x: 0, y: 0, bulge: 0 },
    ]);
    // Reversed twice it is itself again.
    expect(reverseGeometry(reverseGeometry(p)!)).toEqual(p);
  });

  // M3-16: a vertex's curve-fit tangent turns round with it; a 3D vertex keeps its height.
  it('turns vertex tangents round and keeps 3D heights', () => {
    const p: EntityGeometry = {
      kind: 'POLYLINE',
      is3d: false,
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, tangent: 0.25 },
        { x: 10, y: 0, bulge: 0 },
        { x: 20, y: 0, bulge: 0, tangent: -3 },
      ],
    };
    const r = reverseGeometry(p) as PolylineGeometry;
    expect(r.vertices.map((v) => v.tangent)).toEqual([-3 + Math.PI, undefined, 0.25 - Math.PI]);
    const three: EntityGeometry = {
      kind: 'POLYLINE',
      is3d: true,
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0, z: 1 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    expect((reverseGeometry(three) as PolylineGeometry).vertices).toEqual([
      { x: 10, y: 0, bulge: 0 },
      { x: 0, y: 0, bulge: 0, z: 1 },
    ]);
  });

  it('keeps the closing segment of a closed polyline with its bulge', () => {
    const p: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0.1 },
        { x: 10, y: 0, bulge: 0.2 },
        { x: 10, y: 10, bulge: 0.3 },
      ],
    };
    const r = reverseGeometry(p) as unknown as {
      vertices: { x: number; y: number; bulge: number }[];
    };
    // The old closing segment (10,10)→(0,0), bulge 0.3, is now (0,0)→(10,10), bulge −0.3.
    expect(r.vertices).toEqual([
      { x: 10, y: 10, bulge: -0.2 },
      { x: 10, y: 0, bulge: -0.1 },
      { x: 0, y: 0, bulge: -0.3 },
    ]);
  });

  it('swaps a line’s ends and reverses a spline’s knots, points and tangents', () => {
    expect(reverseGeometry(line(0, 0, 1, 2))).toEqual(line(1, 2, 0, 0));
    const s: EntityGeometry = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 3, 3, 3],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 0 },
      ],
      weights: [1, 2, 1, 1],
      fitPoints: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      startTangent: { x: 1, y: 1 },
      endTangent: { x: 1, y: -1 },
      closed: false,
      periodic: false,
    };
    const r = reverseGeometry(s) as typeof s & { knots: number[]; weights: number[] };
    expect(r.knots).toEqual([0, 0, 0, 2, 3, 3, 3]);
    expect(r.weights).toEqual([1, 1, 2, 1]);
    expect(r.startTangent).toEqual({ x: -1, y: 1 });
    expect(r.endTangent).toEqual({ x: -1, y: -1 });
    // The same curve: its point a third of the way along is the original's two thirds along.
    const a = breakCurveOf(s)!;
    const b = breakCurveOf(r)!;
    expect(pt(pointAt(b, 1))).toEqual(pt(pointAt(a, 2)));
    expect(reverseGeometry(arc(0, 0, 1, 0, 90))).toBeUndefined();
  });
});

describe('JOIN', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1) as unknown as EntityId[];
  const join = (gs: EntityGeometry[], source?: number, t = tol) =>
    joinObjects(
      gs.map((geom, i) => ({ id: ids(gs.length)[i]!, geom })),
      source as EntityId | undefined,
      t,
    );

  it('joins collinear lines over their gaps into one line', () => {
    const r = join([line(0, 0, 2, 0), line(5, 0, 8, 0), line(3, 1, 4, 1)]);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 1, parts: [1, 2], made: 'line' });
    expect(ends(r.joined[0]!.geom)).toEqual([
      [0, 0],
      [8, 0],
    ]);
    expect(r.discarded).toBe(1);
  });

  it('joins arcs of one circle counterclockwise, leaving out the largest gap, or a circle', () => {
    const r = join([arc(0, 0, 1, 0, 90), arc(0, 0, 1, 100, 170)]);
    const a = r.joined[0]!.geom as { startAngle: number; endAngle: number };
    expect(r.joined[0]!.made).toBe('arc');
    expect([deg(a.startAngle), deg(a.endAngle)]).toEqual([0, 170]);
    const whole = join([arc(0, 0, 1, 0, 180), arc(0, 0, 1, 180, 360)]);
    expect(whole.joined[0]!.made).toBe('circle');
    expect(whole.joined[0]!.geom.kind).toBe('CIRCLE');
    // From a source arc: counterclockwise from it, leaving the gap just before it.
    const src = join([arc(0, 0, 1, 100, 170), arc(0, 0, 1, 0, 90)], 1);
    const s = src.joined[0]!.geom as { startAngle: number; endAngle: number };
    expect([deg(s.startAngle), deg(s.endAngle)]).toEqual([100, 90]);
  });

  it('chains lines, arcs and polylines end to end into a polyline, closing it', () => {
    const r = join([
      line(0, 0, 10, 0),
      arc(10, 5, 5, 270, 90),
      line(0, 10, 10, 10),
      line(0, 10, 0, 0),
    ]);
    expect(r.joined).toHaveLength(1);
    const j = r.joined[0]!;
    expect(j.made).toBe('polyline');
    const p = j.geom as {
      kind: string;
      closed: boolean;
      vertices: { x: number; y: number; bulge: number }[];
    };
    expect(p.kind).toBe('LWPOLYLINE');
    expect(p.closed).toBe(true);
    expect(p.vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)])).toEqual([
      [0, 0, 0],
      [10, 0, 1],
      [10, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('keeps the source polyline, its widths, and reverses pieces that run the other way', () => {
    const poly: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      constantWidth: 0.5,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
      ],
    };
    const r = join([line(20, 0, 10, 0), poly, line(50, 50, 60, 60)], 2);
    expect(r.joined).toHaveLength(1);
    expect(r.joined[0]).toMatchObject({ keep: 2, parts: [2, 1] });
    const p = r.joined[0]!.geom as unknown as { constantWidth?: number; vertices: object[] };
    expect(p.constantWidth).toBeUndefined();
    expect(p.vertices).toEqual([
      { x: 0, y: 0, bulge: 0, startWidth: 0.5, endWidth: 0.5 },
      { x: 10, y: 0, bulge: 0 },
      { x: 20, y: 0, bulge: 0 },
    ]);
    expect(r.discarded).toBe(1);
  });

  it('takes only collinear lines to a source line, and discards what cannot join', () => {
    const r = join([line(0, 0, 10, 0), line(10, 0, 10, 10), line(12, 0, 15, 0)], 1);
    expect(r.joined[0]).toMatchObject({ parts: [1, 3], made: 'line' });
    expect(r.discarded).toBe(1);
    const none = join([{ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, line(0, 0, 1, 1)]);
    expect(none).toEqual({ joined: [], discarded: 2 });
  });

  it('joins elliptical arcs of one ellipse, into the ellipse when whole', () => {
    const e = (a0: number, a1: number): EntityGeometry => ({
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: a0,
      endParam: a1,
    });
    const r = join([e(0, Math.PI), e(Math.PI, 1.5 * Math.PI)]);
    const g = r.joined[0]!.geom as { startParam: number; endParam: number };
    expect([r6(g.startParam), r6(g.endParam)]).toEqual([0, r6(1.5 * Math.PI)]);
    const whole = join([e(0, Math.PI), e(Math.PI, 2 * Math.PI - 1e-12)]);
    expect(whole.joined[0]!.geom).toMatchObject({ startParam: 0, endParam: 2 * Math.PI });
  });
});

describe('inch drawings: tolerance-sensitive cases', () => {
  // A site plan in inches far from the origin: the drawing's tolerance is about 1.3e-7".
  const X = 123456.0625;
  const t = toleranceForSize(130000);

  it('joins ends a hair apart, and leaves ends a real gap apart', () => {
    const near = joinObjects(
      [
        { id: 1 as unknown as EntityId, geom: line(X, 0, X + 10, 0) },
        { id: 2 as unknown as EntityId, geom: line(X + 10 + 1e-9, 0, X + 10, 5) },
      ],
      undefined,
      t,
    );
    expect(near.joined[0]?.made).toBe('polyline');
    const gap = joinObjects(
      [
        { id: 1 as unknown as EntityId, geom: line(X, 0, X + 10, 0) },
        { id: 2 as unknown as EntityId, geom: line(X + 10 + 1e-4, 0, X + 10, 5) },
      ],
      undefined,
      t,
    );
    expect(gap.joined).toEqual([]);
  });

  it('breaks a 1/64" arc exactly where asked', () => {
    const r = 1 / 128;
    const g: EntityGeometry = { kind: 'CIRCLE', center: { x: X, y: X }, radius: r };
    const out = broken(g, { x: X + r, y: X }, { x: X, y: X + r }, t) as EntityGeometry[];
    const c = breakCurveOf(out[0]!)!;
    const d = domain(c);
    expect(Math.abs(pointAt(c, d.start).x - X)).toBeLessThan(t.linear);
    expect(Math.abs(pointAt(c, d.end).x - (X + r))).toBeLessThan(t.linear);
  });

  it('lengthens a far line by a sixty-fourth exactly', () => {
    const g = line(X, X, X + 3, X + 4);
    const out = lengthenGeometry(g, breakCurveOf(g)!, true, 5 + 1 / 64, t) as { end: Vec2 };
    expect(Math.abs(Math.hypot(out.end.x - X, out.end.y - X) - (5 + 1 / 64))).toBeLessThan(
      t.linear,
    );
  });
});
