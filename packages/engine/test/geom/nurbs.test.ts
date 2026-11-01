import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  basisFunctions,
  findSpan,
  splineDerivative,
  splineDomain,
  splinePoint,
  validateSpline,
  type Spline,
  type Vec2,
} from '../../src/geom/index';
import { expectNear, spline } from './arbitraries';

const bezier = (pts: Vec2[]): Spline => ({
  kind: 'SPLINE',
  degree: pts.length - 1,
  knots: [...Array<number>(pts.length).fill(0), ...Array<number>(pts.length).fill(1)],
  controlPoints: pts,
});

function bernstein(pts: Vec2[], t: number): Vec2 {
  const n = pts.length - 1;
  let x = 0;
  let y = 0;
  const choose = (k: number): number => {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  };
  pts.forEach((p, i) => {
    const b = choose(i) * t ** i * (1 - t) ** (n - i);
    x += b * p.x;
    y += b * p.y;
  });
  return { x, y };
}

describe('NURBS evaluation', () => {
  it('finds knot spans, including the last knot', () => {
    const U = [0, 0, 0, 1, 2, 3, 3, 3];
    expect(findSpan(4, 2, 0, U)).toBe(2);
    expect(findSpan(4, 2, 0.5, U)).toBe(2);
    expect(findSpan(4, 2, 1, U)).toBe(3);
    expect(findSpan(4, 2, 2.5, U)).toBe(4);
    expect(findSpan(4, 2, 3, U)).toBe(4);
  });

  it('basis functions are a partition of unity', () => {
    const U = [0, 0, 0, 1, 2, 3, 3, 3];
    for (const u of [0, 0.3, 1, 1.7, 3]) {
      const span = findSpan(4, 2, u, U);
      const N = basisFunctions(span, u, 2, U, 0)[0]!;
      expect(N.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
    }
  });

  it('second derivatives of the basis sum to zero and match finite differences', () => {
    const U = [0, 0, 0, 0, 1, 2, 2, 2, 2];
    const p = 3;
    for (const u of [0.3, 1, 1.6]) {
      const span = findSpan(4, p, u, U);
      const d = basisFunctions(span, u, p, U, 2);
      expect(d[1]!.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
      expect(d[2]!.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
      const h = 1e-5;
      const lo = basisFunctions(span, u - h, p, U, 1);
      const hi = basisFunctions(span, u + h, p, U, 1);
      for (let j = 0; j <= p; j++) {
        expect((hi[1]![j]! - lo[1]![j]!) / (2 * h)).toBeCloseTo(d[2]![j]!, 4);
      }
    }
  });

  it('degree-1 spline is the control polygon', () => {
    const s: Spline = {
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ],
    };
    expectNear(splinePoint(s, 0.5), { x: 2, y: 0 });
    expectNear(splinePoint(s, 1.5), { x: 4, y: 1 });
    expectNear(splineDerivative(s, 1.5), { x: 0, y: 2 });
  });

  it('a clamped single-span spline is a Bézier curve', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: -1 },
    ];
    for (const t of [0, 0.25, 0.5, 0.9, 1])
      expectNear(splinePoint(bezier(pts), t), bernstein(pts, t), 1e-12);
  });

  it('the rational quadratic quarter circle lies exactly on the circle', () => {
    const s: Spline = {
      ...bezier([
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
      weights: [1, Math.SQRT1_2, 1],
    };
    for (const t of [0, 0.1, 0.5, 0.77, 1]) {
      const p = splinePoint(s, t);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 14);
    }
    // The tangent is perpendicular to the radius.
    const p = splinePoint(s, 0.3);
    const d = splineDerivative(s, 0.3);
    expect(p.x * d.x + p.y * d.y).toBeCloseTo(0, 12);
  });

  it('weights of 1 give the same curve as no weights', () => {
    fc.assert(
      fc.property(spline, fc.double({ min: 0, max: 1, noNaN: true }), (s, f) => {
        const plain: Spline = {
          kind: 'SPLINE',
          degree: s.degree,
          knots: s.knots,
          controlPoints: s.controlPoints,
        };
        const unit: Spline = { ...plain, weights: s.controlPoints.map(() => 1) };
        const d = splineDomain(s);
        const u = d.start + f * (d.end - d.start);
        expectNear(splinePoint(unit, u), splinePoint(plain, u), 1e-9);
        expectNear(splineDerivative(unit, u), splineDerivative(plain, u), 1e-6);
      }),
    );
  });

  it('a clamped spline interpolates its first and last control points', () => {
    fc.assert(
      fc.property(spline, (s) => {
        const d = splineDomain(s);
        expectNear(splinePoint(s, d.start), s.controlPoints[0]!, 1e-9);
        expectNear(splinePoint(s, d.end), s.controlPoints.at(-1)!, 1e-9);
      }),
    );
  });

  it('every point lies in the convex hull of the control points (bounding box check)', () => {
    fc.assert(
      fc.property(spline, fc.double({ min: 0, max: 1, noNaN: true }), (s, f) => {
        const d = splineDomain(s);
        const p = splinePoint(s, d.start + f * (d.end - d.start));
        const xs = s.controlPoints.map((c) => c.x);
        const ys = s.controlPoints.map((c) => c.y);
        expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
        expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
        expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
      }),
    );
  });

  it('evaluates unclamped (closed/periodic) knot vectors over [knots[p], knots[n]]', () => {
    // AutoCAD writes closed splines with uniform unclamped knots and wrapped control points.
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const s: Spline = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      controlPoints: pts,
    };
    expect(splineDomain(s)).toEqual({ start: 3, end: 7 });
    expectNear(splinePoint(s, 3), splinePoint(s, 7), 1e-12);
    expectNear(splineDerivative(s, 3), splineDerivative(s, 7), 1e-12);
  });

  it('rejects malformed splines', () => {
    const ok = bezier([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(() => validateSpline(ok)).not.toThrow();
    expect(() => validateSpline({ ...ok, degree: 0 })).toThrow(/degree/);
    expect(() => validateSpline({ ...ok, knots: [0, 0, 1] })).toThrow(/knots/);
    expect(() => validateSpline({ ...ok, knots: [0, 1, 0, 1] })).toThrow(/non-decreasing/);
    expect(() => validateSpline({ ...ok, weights: [1] })).toThrow(/weights/);
    expect(() => validateSpline({ ...ok, weights: [1, 0] })).toThrow(/positive/);
    expect(() => validateSpline({ ...ok, knots: [0, 0, 0, 0] })).toThrow(/empty domain/);
  });
});
