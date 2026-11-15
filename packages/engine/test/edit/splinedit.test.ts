// M3-02 part 6: SPLINEDIT's geometry (`edit/splinedit.ts`), as AutoCAD 2024 edits splines
// (AutoCAD Help, "SPLINEDIT (Command)"), including inch-drawing tolerance cases.
import { describe, expect, it } from 'vitest';
import {
  addControlVertex,
  clampedSpline,
  closeControlFrame,
  controlPositions,
  controlVertices,
  controlWeight,
  deleteControlVertex,
  elevateOrder,
  fitEditOf,
  fitInsertIndex,
  hasFitData,
  joinToSpline,
  kinksOf,
  moveControlVertex,
  nearestIndex,
  pointOnSpline,
  purgeFitData,
  splineCurve,
  splineDomain,
  splinePoint,
  toleranceForSize,
  weightControlVertex,
  withFitData,
  type EntityGeometry,
  type SplineGeometry,
  type Vec2,
} from '../../src/index';
import { splineOf } from '../../src/commands/draw/spline-shape';

const tol = toleranceForSize(100);
const P = (x: number, y: number): Vec2 => ({ x, y });

function fit(points: Vec2[], closed = false): SplineGeometry {
  return splineOf({ method: 'fit', points, knots: 'chord', tolerance: 0, closed })!;
}
function cv(points: Vec2[], degree = 3, closed = false): SplineGeometry {
  return splineOf({ method: 'cv', points, degree, closed })!;
}

/** Points sampled along the curve the spline draws. */
function samples(g: SplineGeometry, n = 41): Vec2[] {
  const c = splineCurve(g)!;
  const { start, end } = splineDomain(c);
  return Array.from({ length: n }, (_, i) => splinePoint(c, start + ((end - start) * i) / (n - 1)));
}

/** Every sample of `a` lies on `b` (within `d`). */
function sameCurve(a: SplineGeometry, b: SplineGeometry, d = 1e-7): boolean {
  return samples(a).every((p) => {
    const q = pointOnSpline(b, p, tol)!;
    return Math.hypot(p.x - q.x, p.y - q.y) <= d;
  });
}

const S = [P(0, 0), P(10, 10), P(20, 0), P(30, 10)];

describe('fit data', () => {
  it('moves, adds and deletes fit points, refitting through them', () => {
    const g = fit(S);
    expect(hasFitData(g)).toBe(true);
    const f = fitEditOf(g, tol);
    expect(f.kinks).toEqual([false, false, false, false]);
    const moved = withFitData(g, { ...f, points: [S[0]!, P(10, 20), S[2]!, S[3]!] })!;
    const on = pointOnSpline(moved, P(10, 20), tol)!;
    expect(Math.hypot(on.x - 10, on.y - 20)).toBeLessThan(1e-9);
    expect(moved.fitPoints).toHaveLength(4);
    const added = withFitData(g, {
      ...f,
      points: [S[0]!, P(5, 8), ...S.slice(1)],
      kinks: [false, false, ...f.kinks.slice(1)],
    })!;
    const q = pointOnSpline(added, P(5, 8), tol)!;
    expect(Math.hypot(q.x - 5, q.y - 8)).toBeLessThan(1e-9);
    // Two points still make a curve, one does not.
    expect(withFitData(g, { ...f, points: S.slice(0, 2), kinks: [false, false] })).toBeDefined();
    expect(withFitData(g, { ...f, points: S.slice(0, 1), kinks: [false] })).toBeUndefined();
  });

  it('keeps a kink as a knot of full multiplicity, found again after a save', () => {
    const g = fit(S);
    const kinked = withFitData(g, { ...fitEditOf(g, tol), kinks: [false, true, false, false] })!;
    const c = splineCurve(kinked)!;
    const u = c.knots.filter((k, i, all) => all.indexOf(k) !== i && k > 0 && k < c.knots.at(-1)!);
    expect(new Set(u).size).toBe(1);
    expect(kinksOf(kinked, tol)).toEqual([false, true, false, false]);
    // The curve still passes through every fit point and has a corner at the kink.
    for (const p of S) {
      const q = pointOnSpline(kinked, p, tol)!;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(1e-9);
    }
    // A kink at either end of an open spline is no kink.
    const ends = withFitData(g, { ...fitEditOf(g, tol), kinks: [true, false, false, true] })!;
    expect(kinksOf(ends, tol)).toEqual([false, false, false, false]);
  });

  it('closes and opens by its fit points, with a kink at the seam kept', () => {
    const g = fit(S);
    const f = fitEditOf(g, tol);
    const closed = withFitData(g, { ...f, closed: true })!;
    expect(closed.closed).toBe(true);
    const c = splineCurve(closed)!;
    const { start, end } = splineDomain(c);
    expect(splinePoint(c, start)).toEqual(splinePoint(c, end));
    expect(kinksOf(closed, tol)).toEqual([false, false, false, false]);
    const corner = withFitData(g, { ...f, closed: true, kinks: [false, false, true, false] })!;
    expect(kinksOf(corner, tol)).toEqual([false, false, true, false]);
    const reopened = withFitData(corner, { ...fitEditOf(corner, tol), closed: false })!;
    expect(reopened.closed).toBe(false);
    // End tangents: kept on an open spline (as unit vectors), dropped by a closed one.
    const tangent = withFitData(g, { ...f, startTangent: P(0, 5), endTangent: P(3, 0) })!;
    expect(tangent.startTangent).toEqual(P(0, 1));
    expect(tangent.endTangent).toEqual(P(1, 0));
    expect(withFitData(g, { ...f, closed: true, endTangent: P(1, 0) })!.endTangent).toBeUndefined();
  });

  it('finds where a point on the curve goes among the fit points', () => {
    const g = fit(S);
    expect(fitInsertIndex(g, P(5, 6), tol)).toBe(1);
    expect(fitInsertIndex(g, P(25, 6), tol)).toBe(3);
    expect(fitInsertIndex(g, P(-1, -1), tol)).toBe(1);
    expect(nearestIndex(S, P(19, 1))).toBe(2);
  });

  it('purges the fit data, keeping the curve', () => {
    const g = fit(S);
    const p = purgeFitData({ ...g, fitTolerance: 0.5, knotParameterization: 'sqrt' });
    expect(hasFitData(p)).toBe(false);
    expect(p).not.toHaveProperty('fitTolerance');
    expect(p.controlPoints).toEqual(g.controlPoints);
    // A spline stored as fit data alone gets the NURBS it draws.
    const bare: SplineGeometry = { ...g, controlPoints: [], knots: [] };
    expect(purgeFitData(bare).controlPoints).toEqual(g.controlPoints);
  });
});

describe('control frame', () => {
  const C = [P(0, 0), P(10, 10), P(20, 0), P(30, 10), P(40, 0)];

  it('moves and weights a control vertex, dropping the fit data', () => {
    const g = cv(C);
    expect(controlVertices(g)).toEqual([[0], [1], [2], [3], [4]]);
    const m = moveControlVertex(g, 2, P(20, -10));
    expect(controlPositions(m)[2]).toEqual(P(20, -10));
    const w = weightControlVertex(g, 1, 3);
    expect(controlWeight(w, 1)).toBe(3);
    expect(w.weights).toEqual([1, 3, 1, 1, 1]);
    // Back to 1 everywhere is a plain B-spline again.
    expect(weightControlVertex(w, 1, 1)).not.toHaveProperty('weights');
    const fromFit = moveControlVertex(fit(S), 0, P(-1, 0));
    expect(hasFitData(fromFit)).toBe(false);
  });

  it('moves a periodic spline’s wrapped vertex with its copy', () => {
    const g = cv(C, 3, true);
    expect(g.periodic).toBe(true);
    const vs = controlVertices(g);
    expect(vs).toHaveLength(5);
    expect(vs.filter((x) => x.length === 2)).toHaveLength(3);
    const m = moveControlVertex(g, 0, P(-5, -5));
    const at = vs[0]!;
    expect(m.controlPoints[at[0]!]).toEqual(P(-5, -5));
    expect(m.controlPoints[at[1]!]).toEqual(P(-5, -5));
    const w = weightControlVertex(g, 0, 2);
    expect(at.map((i) => w.weights![i])).toEqual([2, 2]);
  });

  it('adds a vertex where picked without changing the curve', () => {
    const g = cv(C);
    const a = addControlVertex(g, P(20, 3), tol)!;
    expect(a.controlPoints).toHaveLength(6);
    expect(sameCurve(g, a)).toBe(true);
    // Not at an end of the curve.
    expect(addControlVertex(g, P(-5, 0), tol)).toBeUndefined();
    // A periodic spline is clamped at its seam first, the same curve.
    const ring = cv(C, 3, true);
    const r = addControlVertex(ring, P(20, 3), tol)!;
    expect(r.periodic).toBe(false);
    expect(r.closed).toBe(true);
    expect(sameCurve(ring, r)).toBe(true);
  });

  it('deletes a vertex, never below the order', () => {
    const g = cv(C);
    const d = deleteControlVertex(g, 2)!;
    expect(d.controlPoints).toHaveLength(4);
    expect(d.controlPoints).not.toContainEqual(P(20, 0));
    expect(d.knots).toHaveLength(8);
    expect(deleteControlVertex(cv(C.slice(0, 4)), 1)).toBeUndefined();
    // A closed clamped spline's seam vertex goes from both ends.
    const ring = clampedSpline(cv([...C, P(20, 20)], 3, true))!;
    expect(controlVertices(ring)[0]).toHaveLength(2);
    const s = deleteControlVertex(ring, 0)!;
    expect(s.controlPoints[0]).toEqual(s.controlPoints.at(-1));
    expect(s.controlPoints).toHaveLength(ring.controlPoints.length - 1);
  });

  it('elevates the order exactly, rational or not, up to the drawing’s curve', () => {
    const g = cv(C);
    const e = elevateOrder(g, 6)!;
    expect(e.degree).toBe(5);
    expect(sameCurve(g, e, 1e-8)).toBe(true);
    const w = weightControlVertex(g, 2, 4);
    const ew = elevateOrder(w, 5)!;
    expect(ew.weights).toBeDefined();
    expect(sameCurve(w, ew, 1e-8)).toBe(true);
    // The same order or lower leaves it.
    expect(elevateOrder(g, 3)!.degree).toBe(3);
  });

  it('closes a CV spline periodic and opens it again', () => {
    const g = cv(C);
    const c = closeControlFrame(g, true)!;
    expect(c).toMatchObject({ closed: true, periodic: true });
    expect(controlPositions(c)).toEqual(C);
    const o = closeControlFrame(c, false)!;
    expect(o).toMatchObject({ closed: false, periodic: false });
    expect(o.controlPoints).toEqual(C);
    expect(closeControlFrame(cv(C.slice(0, 2), 1), true)).toBeUndefined();
    const w = closeControlFrame(weightControlVertex(g, 1, 2), true)!;
    expect(w.weights).toHaveLength(w.controlPoints.length);
  });
});

describe('join', () => {
  it('chains lines, arcs, polylines and splines on to either end', () => {
    const g = cv([P(0, 0), P(10, 10), P(20, 0)], 2);
    const others: { id: string; geom: EntityGeometry }[] = [
      { id: 'line', geom: { kind: 'LINE', start: P(30, 0), end: P(20, 0) } },
      {
        id: 'arc',
        geom: { kind: 'ARC', center: P(-5, 0), radius: 5, startAngle: 0, endAngle: Math.PI },
      },
      {
        id: 'pline',
        geom: {
          kind: 'LWPOLYLINE',
          vertices: [
            { x: 30, y: 0, bulge: 0 },
            { x: 40, y: 0, bulge: 1 },
            { x: 50, y: 0, bulge: 0 },
          ],
          closed: false,
        },
      },
      { id: 'far', geom: { kind: 'LINE', start: P(100, 0), end: P(110, 0) } },
      { id: 'circle', geom: { kind: 'CIRCLE', center: P(0, 0), radius: 1 } },
    ];
    const r = joinToSpline(g, others, tol)!;
    expect(r.joined.sort()).toEqual(['arc', 'line', 'pline']);
    expect(r.geom.closed).toBe(false);
    const c = splineCurve(r.geom)!;
    const { start, end } = splineDomain(c);
    const a = splinePoint(c, start);
    const b = splinePoint(c, end);
    expect([a, b].map((p) => [Math.round(p.x) + 0, Math.round(p.y) + 0]).sort()).toEqual([
      [-10, 0],
      [50, 0],
    ]);
    // The polyline's half circle (bulge 1) is on the curve.
    const top = pointOnSpline(r.geom, P(45, -6), tol)!;
    expect(Math.hypot(top.x - 45, top.y + 5)).toBeLessThan(1e-6);
    expect(joinToSpline(g, [others[3]!], tol)).toBeUndefined();
    expect(joinToSpline({ ...g, closed: true }, others, tol)).toBeUndefined();
  });

  it('closes a chain that comes round', () => {
    const g = cv([P(0, 0), P(5, 5), P(10, 0)], 2);
    const r = joinToSpline(
      g,
      [{ id: 1, geom: { kind: 'LINE', start: P(10, 0), end: P(0, 0) } }],
      tol,
    )!;
    expect(r.geom.closed).toBe(true);
  });

  it('joins within an inch drawing’s tolerance, not beyond it', () => {
    const big = toleranceForSize(1e5);
    const g = cv([P(1e5, 0), P(1e5 + 10, 10), P(1e5 + 20, 0)], 2);
    const touching = { kind: 'LINE' as const, start: P(1e5 + 20 + 1e-7, 0), end: P(1e5 + 30, 0) };
    const apart = { kind: 'LINE' as const, start: P(1e5 + 20.01, 0), end: P(1e5 + 30, 0) };
    expect(joinToSpline(g, [{ id: 1, geom: touching }], big)?.joined).toEqual([1]);
    expect(joinToSpline(g, [{ id: 1, geom: apart }], big)).toBeUndefined();
  });
});
