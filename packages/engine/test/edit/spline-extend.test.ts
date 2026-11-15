// M3-12 part 2: splines in EXTEND, LENGTHEN and JOIN, and rays in EXTEND (`edit/trim.ts`,
// `edit/break.ts`, `edit/join.ts`), as AutoCAD 2024 does them (AutoCAD Help, "About Modifying
// Splines": "Extending a spline lengthens it by adding a linear portion that is tangent to the
// end of the spline (C1 continuity)"; "JOIN (Command)": a source spline takes any linear or
// curved object, and joining several at once makes a spline of splines and elliptical arcs and
// whatever meets them), including tolerance-sensitive cases of inch drawings.
import { describe, expect, it } from 'vitest';
import {
  breakCurveOf,
  closestPoint,
  curveLength,
  domain,
  edgeCurvesOf,
  extendGeometry,
  joinObjects,
  lengthenGeometry,
  lengthTo,
  pickParam,
  pointAt,
  splineDerivative,
  toleranceForSize,
  trimCurveOf,
  type BoundedCurve,
  type Curve,
  type EntityGeometry,
  type EntityId,
  type Spline,
  type SplineGeometry,
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

/** A cubic Bézier from (0,0) to (8,2): it leaves (0,0) towards (2,4) and ends going (1,-1). */
const cubic: SplineGeometry = {
  kind: 'SPLINE',
  degree: 3,
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
  controlPoints: [
    { x: 0, y: 0 },
    { x: 2, y: 4 },
    { x: 6, y: 4 },
    { x: 8, y: 2 },
  ],
  fitPoints: [
    { x: 0, y: 0 },
    { x: 8, y: 2 },
  ],
  closed: false,
  periodic: false,
};

/** The same curve by its control vertices alone. */
const { fitPoints: _fit, ...bare } = cubic;

const curveOf = (g: EntityGeometry) => trimCurveOf(g)!;
const ends = (g: EntityGeometry) => {
  const c = curveOf(g);
  const d = domain(c);
  return [...pt(pointAt(c, d.start)), ...pt(pointAt(c, d.end))];
};
const onCurve = (g: EntityGeometry, p: Vec2) => closestPoint(curveOf(g), p, tol).distance;
const unit = (v: Vec2) => {
  const l = Math.hypot(v.x, v.y);
  return [r6(v.x / l), r6(v.y / l)];
};

function extend(g: EntityGeometry, edges: readonly EntityGeometry[], pick: Vec2, t = tol) {
  const c = curveOf(g);
  const curves = edges.flatMap((e) => edgeCurvesOf(e, false));
  return extendGeometry(g, c, curves, pickParam(c, pick, t), t);
}

describe('EXTEND of splines and rays', () => {
  const floor = line(-10, -1, 20, -1);

  it('carries a spline’s end on in a straight line, tangent to it, to the edge', () => {
    const out = extend(cubic, [floor], { x: 7.9, y: 2.1 }) as SplineGeometry;
    expect(out.kind).toBe('SPLINE');
    // Going (1,-1) from (8,2) the edge y = -1 is met at (11,-1).
    expect(ends(out)).toEqual([0, 0, 11, -1]);
    // The added part is straight and the original part keeps its shape.
    expect(onCurve(out, { x: 9.5, y: 0.5 })).toBeLessThan(1e-9);
    const c = curveOf(cubic);
    for (const t of [0.1, 0.5, 0.9]) expect(onCurve(out, pointAt(c, t))).toBeLessThan(1e-9);
    // Tangent at the join (C1): the derivative either side of (8,2) points the same way.
    const s = curveOf(out) as Spline;
    const at = closestPoint(s, { x: 8, y: 2 }, tol).t;
    const r4 = (v: Vec2) => [v.x, v.y].map((x) => Math.round(x * 1e4) / 1e4 + 0);
    expect(r4(splineDerivative(s, at - 1e-9))).toEqual(r4(splineDerivative(s, at + 1e-9)));
    expect(unit(splineDerivative(s, at + 1e-9))).toEqual(unit({ x: 1, y: -1 }));
    // The fit points no longer describe it: AutoCAD keeps control vertices only.
    expect(out.fitPoints).toBeUndefined();
    expect(out).toMatchObject({ degree: 3, closed: false, periodic: false });
  });

  it('carries a spline’s start back along its tangent when the pick is nearer the start', () => {
    const out = extend(cubic, [floor], { x: 0.2, y: 0.5 }) as SplineGeometry;
    // Back from (0,0) against (2,4): y = -1 at (-0.5,-1).
    expect(ends(out)).toEqual([-0.5, -1, 8, 2]);
    expect(onCurve(out, { x: -0.25, y: -0.5 })).toBeLessThan(1e-9);
  });

  it('extends a rational spline (a quarter circle) along its end tangent', () => {
    const w = Math.SQRT1_2;
    const quarter: SplineGeometry = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      weights: [1, w, 1],
      closed: false,
      periodic: false,
    };
    const out = extend(quarter, [line(-5, -5, -5, 5)], { x: 0.1, y: 1 }) as SplineGeometry;
    expect(ends(out)).toEqual([1, 0, -5, 1]);
    expect(onCurve(out, { x: w, y: w })).toBeLessThan(1e-9);
    expect(onCurve(out, { x: -2, y: 1 })).toBeLessThan(1e-9);
  });

  it('leaves along the curve’s limit direction where its end control vertices coincide', () => {
    const doubled: SplineGeometry = {
      ...bare,
      controlPoints: [
        { x: 0, y: 0 },
        { x: 2, y: 4 },
        { x: 8, y: 2 },
        { x: 8, y: 2 },
      ],
    };
    // C' is 0 at (8,2); the curve arrives from (2,4), going (3,-1): y = -1 at (17,-1).
    const out = extend(doubled, [floor], { x: 7.9, y: 2 }) as SplineGeometry;
    expect(ends(out)).toEqual([0, 0, 17, -1]);
    expect(onCurve(out, { x: 11, y: 1 })).toBeLessThan(1e-9);
  });

  it('does not extend a spline that meets no edge, or a closed one', () => {
    expect(extend(cubic, [line(-10, 10, 20, 10)], { x: 7.9, y: 2.1 })).toBeUndefined();
    const closed: SplineGeometry = {
      ...bare,
      controlPoints: [...cubic.controlPoints.slice(0, 3), { x: 0, y: 0 }],
      closed: true,
    };
    expect(extend(closed, [floor], { x: 1, y: 1 })).toBeUndefined();
  });

  it('moves a ray’s base back to the nearest edge behind it', () => {
    const ray: EntityGeometry = { kind: 'RAY', base: { x: 5, y: 0 }, direction: { x: 1, y: 0 } };
    const out = extend(ray, [line(2, -5, 2, 5), line(-3, -5, -3, 5)], { x: 9, y: 0 });
    expect(out).toEqual({ kind: 'RAY', base: { x: 2, y: 0 }, direction: { x: 1, y: 0 } });
    // An edge ahead of the base is no boundary for it.
    expect(extend(ray, [line(8, -5, 8, 5)], { x: 9, y: 0 })).toBeUndefined();
  });

  it('extends a spline of an inch drawing far from the origin to an edge a hair away', () => {
    const t = toleranceForSize(1e5);
    const far = (x: number, y: number) => ({ x: 52_000 + x / 64, y: 37_000 + y / 64 });
    const s: SplineGeometry = {
      ...bare,
      controlPoints: cubic.controlPoints.map((p) => far(p.x, p.y)),
    };
    const end = far(8, 2);
    const edgeX = end.x + 1 / 512;
    const out = extend(s, [line(edgeX, 36_000, edgeX, 38_000)], end, t) as SplineGeometry;
    const c = curveOf(out);
    const p = pointAt(c, domain(c).end);
    expect(Math.abs(p.x - edgeX)).toBeLessThan(1e-9);
    expect(Math.abs(p.y - (end.y - 1 / 512))).toBeLessThan(1e-9);
  });
});

describe('LENGTHEN of splines', () => {
  const lengthen = (g: EntityGeometry, atEnd: boolean, to: number) =>
    lengthenGeometry(g, breakCurveOf(g)!, atEnd, to, tol);

  it('grows a spline at the end picked by a straight tangent piece', () => {
    const c = breakCurveOf(cubic) as BoundedCurve;
    const l = curveLength(c);
    const grown = lengthen(cubic, true, l + Math.SQRT2) as SplineGeometry;
    expect(grown.kind).toBe('SPLINE');
    expect(ends(grown)).toEqual([0, 0, 9, 1]);
    expect(r6(curveLength(breakCurveOf(grown) as BoundedCurve))).toBe(r6(l + Math.SQRT2));
    const back = lengthen(cubic, false, l + Math.hypot(1, 2)) as SplineGeometry;
    expect(ends(back)).toEqual([-1, -2, 8, 2]);
    // Shorter still cuts it.
    const straight: SplineGeometry = {
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
    expect(ends(lengthen(straight, true, 12) as EntityGeometry)).toEqual([0, 0, 12, 0]);
    expect(ends(lengthen(straight, false, 12) as EntityGeometry)).toEqual([-2, 0, 10, 0]);
    expect(ends(lengthen(straight, true, 4) as EntityGeometry)).toEqual([0, 0, 4, 0]);
  });

  it('measures DYnamic lengths past a spline’s moving end along its tangent', () => {
    const c = breakCurveOf(cubic) as Curve;
    const l = curveLength(c as BoundedCurve);
    expect(r6(lengthTo(c, true, { x: 9, y: 1 }, tol)!)).toBe(r6(l + Math.SQRT2));
    expect(r6(lengthTo(c, false, { x: -1, y: -2 }, tol)!)).toBe(r6(l + Math.hypot(1, 2)));
    // On the curve it is still the length up to the point.
    expect(r6(lengthTo(c, true, { x: 8, y: 2 }, tol)!)).toBe(r6(l));
  });
});

describe('JOIN of splines', () => {
  const join = (gs: EntityGeometry[], source?: number) =>
    joinObjects(
      gs.map((geom, i) => ({ id: (i + 1) as unknown as EntityId, geom })),
      source as EntityId | undefined,
      tol,
    );
  const arcFrom = (x: number, y: number, r: number, a0: number, a1: number): EntityGeometry => ({
    kind: 'ARC',
    center: { x, y },
    radius: r,
    startAngle: (a0 * Math.PI) / 180,
    endAngle: (a1 * Math.PI) / 180,
  });

  it('joins lines, arcs and splines meeting a source spline into one spline', () => {
    const r = join(
      [
        line(20, 20, 30, 20), // touches nothing
        cubic,
        line(8, 2, 12, 2), // at the spline's end
        arcFrom(-1, 0, 1, 0, 180), // its start, run the other way
      ],
      2,
    );
    expect(r.joined).toHaveLength(1);
    const j = r.joined[0]!;
    expect(j).toMatchObject({ keep: 2, made: 'spline' });
    expect([...j.parts].sort()).toEqual([2, 3, 4]);
    expect(r.discarded).toBe(1);
    expect(ends(j.geom)).toEqual([-2, 0, 12, 2]);
    expect(j.geom).toMatchObject({ kind: 'SPLINE', closed: false, periodic: false });
    expect(onCurve(j.geom, { x: -1, y: 1 })).toBeLessThan(1e-9);
    expect(onCurve(j.geom, { x: 10, y: 2 })).toBeLessThan(1e-9);
    expect((j.geom as SplineGeometry).fitPoints).toBeUndefined();
  });

  it('makes one spline of several objects at once when a spline or elliptical arc is among them', () => {
    const quarterEllipse: EntityGeometry = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: Math.PI / 2,
    };
    // An elliptical arc from (4,0) to (0,2), a line on from (0,2), and two lines chained apart.
    const r = join([line(0, 2, -3, 2), quarterEllipse, line(50, 0, 60, 0), line(60, 0, 60, 10)]);
    expect(r.joined).toHaveLength(2);
    const spline = r.joined.find((j) => j.made === 'spline')!;
    // The first object keeps itself; the result is a spline all the same.
    expect(spline.keep).toBe(1);
    expect(spline.geom.kind).toBe('SPLINE');
    // It runs the elliptical arc's way, the seed of the chain.
    expect(ends(spline.geom)).toEqual([4, 0, -3, 2]);
    const at = { x: 4 * Math.cos(Math.PI / 4), y: 2 * Math.sin(Math.PI / 4) };
    expect(onCurve(spline.geom, at)).toBeLessThan(1e-9);
    expect(r.joined.find((j) => j.made === 'polyline')).toBeDefined();
    expect(r.discarded).toBe(0);
  });

  it('lets a spline keep itself, takes in a chained polyline, and closes when it comes round', () => {
    const r = join([line(0, 0, -2, -2), line(-2, -2, 8, -2), cubic, line(8, -2, 8, 2)]);
    expect(r.joined).toHaveLength(1);
    const j = r.joined[0]!;
    expect(j).toMatchObject({ keep: 3, made: 'spline' });
    expect([...j.parts].sort()).toEqual([1, 2, 3, 4]);
    expect(j.geom).toMatchObject({ kind: 'SPLINE', closed: true });
  });

  it('leaves splines to themselves for line, arc and polyline sources, and off-plan pieces out', () => {
    expect(join([line(8, 2, 12, 2), cubic], 1).joined).toHaveLength(0);
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 8, y: 2, bulge: 0 },
        { x: 12, y: 2, bulge: 0 },
      ],
    };
    expect(join([pl, cubic], 1).joined).toHaveLength(0);
    const raised: EntityGeometry = { ...line(8, 2, 12, 2), elevation: 3 } as EntityGeometry;
    const r = join([cubic, raised], 1);
    expect(r.joined).toHaveLength(0);
    expect(r.discarded).toBe(2);
    // Two splines end to end join; a closed spline does not.
    const next: SplineGeometry = {
      ...bare,
      controlPoints: cubic.controlPoints.map((p) => ({ x: p.x + 8, y: p.y + 2 })),
    };
    expect(ends(join([cubic, next]).joined[0]!.geom)).toEqual([0, 0, 16, 4]);
  });

  it('joins a spline of an inch drawing to a line ending a hair off it', () => {
    const t = toleranceForSize(1e5);
    const far = (x: number, y: number) => ({ x: 52_000 + x / 64, y: 37_000 + y / 64 });
    const s: SplineGeometry = {
      ...bare,
      controlPoints: cubic.controlPoints.map((p) => far(p.x, p.y)),
    };
    const end = far(8, 2);
    const near: EntityGeometry = {
      kind: 'LINE',
      start: { x: end.x + 1e-7, y: end.y },
      end: far(12, 2),
    };
    const gap: EntityGeometry = { kind: 'LINE', start: far(8.5, 2), end: far(12, 2) };
    const parts = (g: EntityGeometry) => [
      { id: 1 as unknown as EntityId, geom: s as EntityGeometry },
      { id: 2 as unknown as EntityId, geom: g },
    ];
    expect(joinObjects(parts(near), 1 as unknown as EntityId, t).joined).toHaveLength(1);
    expect(joinObjects(parts(gap), 1 as unknown as EntityId, t).joined).toHaveLength(0);
  });
});
