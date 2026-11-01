import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  domain,
  intersect,
  pointAt,
  rotation,
  transformCurve,
  type Curve,
  type Intersection,
  type Polyline,
  type Vec2,
} from '../../src/geom/index';
import { at, boundedCurve, expectNear, sizeOf, TOL } from './arbitraries';

const L = (x1: number, y1: number, x2: number, y2: number): Curve => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
const C = (x: number, y: number, r: number): Curve => ({
  kind: 'CIRCLE',
  center: { x, y },
  radius: r,
});
const pts = (xs: Intersection[]): Vec2[] => xs.map((i) => i.point);

describe('intersect: analytic pairs', () => {
  it('crossing lines meet once, parallel and disjoint lines do not', () => {
    const [i] = intersect(L(0, 0, 2, 2), L(0, 2, 2, 0), TOL);
    expectNear(i!.point, { x: 1, y: 1 });
    expect(i!.ta).toBeCloseTo(0.5, 12);
    expect(i!.tb).toBeCloseTo(0.5, 12);
    expect(intersect(L(0, 0, 1, 0), L(0, 1, 1, 1), TOL)).toEqual([]);
    expect(intersect(L(0, 0, 1, 0), L(0, 0, 2, 0), TOL)).toEqual([]); // collinear overlap: no point
    expect(intersect(L(0, 0, 1, 1), L(3, 0, 2, 1), TOL)).toEqual([]); // carriers meet at (1.5, 1.5)
  });

  it('counts a shared endpoint within tolerance', () => {
    const xs = intersect(L(0, 0, 1, 0), L(1 + 1e-12, 0, 1, 1), TOL);
    expect(xs).toHaveLength(1);
    expectNear(xs[0]!.point, { x: 1, y: 0 }, 1e-9);
    expect(xs[0]!.ta).toBe(1);
  });

  it('rays and xlines extend to infinity in their directions only', () => {
    const ray: Curve = { kind: 'RAY', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    const xl: Curve = { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
    expect(intersect(ray, L(5, -1, 5, 1), TOL)).toHaveLength(1);
    expect(intersect(ray, L(-5, -1, -5, 1), TOL)).toHaveLength(0);
    const [x] = intersect(xl, L(-5, -1, -5, 1), TOL);
    expect(x!.ta).toBeCloseTo(-5, 12);
    expect(intersect(xl, C(0, 10, 2), TOL)).toHaveLength(0);
  });

  it('line and circle: secant, tangent, miss', () => {
    expect(pts(intersect(L(-5, 0, 5, 0), C(0, 0, 2), TOL)).map((p) => Math.round(p.x))).toEqual([
      -2, 2,
    ]);
    const tangent = intersect(L(-5, 2, 5, 2), C(0, 0, 2), TOL);
    expect(tangent).toHaveLength(1);
    expectNear(tangent[0]!.point, { x: 0, y: 2 });
    expect(intersect(L(-5, 3, 5, 3), C(0, 0, 2), TOL)).toEqual([]);
  });

  it('line and arc keeps only points on the arc', () => {
    const arc: Curve = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI,
    };
    const xs = intersect(L(0, -5, 0, 5), arc, TOL);
    expect(xs).toHaveLength(1);
    expectNear(xs[0]!.point, { x: 0, y: 2 });
    expect(xs[0]!.tb).toBeCloseTo(Math.PI / 2, 12);
  });

  it('circle and circle: two, tangent outside, tangent inside, none, concentric', () => {
    const two = intersect(C(0, 0, 2), C(2, 0, 2), TOL);
    expect(two).toHaveLength(2);
    for (const i of two) expect(i.point.x).toBeCloseTo(1, 12);
    expectNear(intersect(C(0, 0, 1), C(3, 0, 2), TOL).map((i) => i.point)[0]!, { x: 1, y: 0 });
    expect(intersect(C(0, 0, 1), C(3, 0, 2), TOL)).toHaveLength(1);
    expect(intersect(C(0, 0, 3), C(1, 0, 2), TOL)).toHaveLength(1);
    expect(intersect(C(0, 0, 1), C(5, 0, 1), TOL)).toEqual([]);
    expect(intersect(C(0, 0, 3), C(0.5, 0, 1), TOL)).toEqual([]);
    expect(intersect(C(0, 0, 1), C(0, 0, 1), TOL)).toEqual([]);
  });

  it('line and ellipse via the unit-circle frame', () => {
    const e: Curve = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    const xs = intersect(L(-10, 1, 10, 1), e, TOL);
    expect(xs).toHaveLength(2);
    for (const i of xs) {
      expect(i.point.x ** 2 / 16 + i.point.y ** 2 / 4).toBeCloseTo(1, 12);
      expectNear(pointAt(e, i.tb), i.point, 1e-9);
    }
    expect(intersect(L(-10, 2, 10, 2), e, TOL)).toHaveLength(1);
    expect(intersect(e, L(-10, 3, 10, 3), TOL)).toEqual([]);
  });

  it('reports each crossing at a shared polyline vertex once, sorted along the first curve', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: 0 },
        { x: 2, y: 2, bulge: 0 },
      ],
    };
    const xs = intersect(p, L(1, -1, 3, 1), TOL);
    expect(xs).toHaveLength(1);
    expect(xs[0]!.ta).toBeCloseTo(1, 12);
    const ys = intersect(L(1, -1, 1, 3), { ...p, closed: true }, TOL);
    expect(ys.map((i) => Math.round(i.point.y * 1e9) / 1e9)).toEqual([0, 1]);
    expect(ys[0]!.ta).toBeLessThan(ys[1]!.ta);
  });
});

describe('intersect: properties over all curve pairs', () => {
  const onBoth = (a: Curve, b: Curve, xs: Intersection[]): void => {
    const eps = 1e-6 * Math.max(sizeOf(a), sizeOf(b));
    for (const x of xs) {
      expectNear(pointAt(a, x.ta), x.point, eps);
      expectNear(pointAt(b, x.tb), x.point, eps);
    }
  };
  const finds = (xs: Intersection[], p: Vec2, eps: number): boolean =>
    xs.some((x) => Math.hypot(x.point.x - p.x, x.point.y - p.y) < eps);

  it('rays and xlines against a spline are clipped to its box first', () => {
    const sp: Curve = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 0 },
      ],
    }; // a parabola arch peaking at (1, 1)
    const xl: Curve = { kind: 'XLINE', base: { x: -50, y: 0.5 }, direction: { x: 1, y: 0 } };
    const xs = intersect(xl, sp, TOL);
    expect(xs).toHaveLength(2);
    for (const x of xs) expect(x.point.y).toBeCloseTo(0.5, 9);
    const up: Curve = { kind: 'RAY', base: { x: 1, y: 0 }, direction: { x: 0, y: 1 } };
    expectNear(intersect(up, sp, TOL)[0]!.point, { x: 1, y: 1 });
    // Pointing away from the spline's box: nothing to clip, nothing found.
    const away: Curve = { kind: 'RAY', base: { x: 1, y: 5 }, direction: { x: 0, y: 1 } };
    expect(intersect(away, sp, TOL)).toEqual([]);
  });

  it('a secant through two points of any curve finds both points', () => {
    fc.assert(
      fc.property(
        boundedCurve,
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        (c, s1, s2) => {
          const p1 = at(c, s1);
          const p2 = at(c, s2);
          const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          fc.pre(len > 1e-3 * sizeOf(c));
          // Overshoot both ends so the points are interior to the line.
          const ux = (p2.x - p1.x) / len;
          const uy = (p2.y - p1.y) / len;
          const line = L(p1.x - ux, p1.y - uy, p2.x + ux, p2.y + uy);
          const xs = intersect(c, line, TOL);
          onBoth(c, line, xs);
          const eps = 1e-6 * sizeOf(c);
          expect(finds(xs, p1, eps) || grazes(c, s1, { x: ux, y: uy })).toBe(true);
          expect(finds(xs, p2, eps) || grazes(c, s2, { x: ux, y: uy })).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('a copy rotated about one of its points intersects the original there', () => {
    fc.assert(
      fc.property(
        boundedCurve,
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.double({ min: 0.3, max: 2.8, noNaN: true }),
        (c, s, theta) => {
          const p = at(c, s);
          const b = transformCurve(c, rotation(theta, p), TOL);
          const xs = intersect(c, b, TOL);
          onBoth(c, b, xs);
          expect(finds(xs, p, 1e-6 * sizeOf(c))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a circle through a point of any curve finds that point', () => {
    fc.assert(
      fc.property(
        boundedCurve,
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.record({
          x: fc.double({ min: -50, max: 50, noNaN: true }),
          y: fc.double({ min: -50, max: 50, noNaN: true }),
        }),
        (c, s, off) => {
          const p = at(c, s);
          const r = Math.hypot(off.x, off.y);
          fc.pre(r > 1);
          const circle = C(p.x + off.x, p.y + off.y, r);
          const xs = intersect(circle, c, TOL);
          onBoth(circle, c, xs);
          expect(finds(xs, p, 1e-6 * sizeOf(c)) || grazes(c, s, { x: -off.y, y: off.x })).toBe(
            true,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

/**
 * True when the curve runs within ~3° of `dir` at normalised parameter s: a test line or
 * circle that only grazes (or overlaps) the curve there has no transversal crossing to find.
 */
function grazes(c: Curve, s: number, dir: Vec2): boolean {
  const d = domain(c);
  const t = d.start + s * (d.end - d.start);
  const h = 1e-6 * (d.end - d.start);
  const a = pointAt(c, t - h);
  const b = pointAt(c, t + h);
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const sin = Math.abs(tx * dir.y - ty * dir.x) / (Math.hypot(tx, ty) * Math.hypot(dir.x, dir.y));
  return !(sin >= 0.05);
}
