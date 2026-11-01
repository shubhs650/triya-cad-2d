import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  closestPoint,
  derivativeAt,
  domain,
  explodePolyline,
  intersect,
  offset,
  pointAt,
  sideOf,
  tangentAt,
  tangentPointsFrom,
  type Arc,
  type Curve,
  type Ellipse,
  type Polyline,
  type Spline,
  type Vec2,
} from '../../src/geom/index';
import {
  arc,
  at,
  boundedCurve,
  circle,
  ellipse,
  expectNear,
  line,
  point,
  sizeOf,
  spline,
  TOL,
} from './arbitraries';

const P = (x: number, y: number): Vec2 => ({ x, y });

describe('closestPoint', () => {
  it('projects onto lines, rays and xlines, clamping to their ends', () => {
    const l: Curve = { kind: 'LINE', start: P(0, 0), end: P(4, 0) };
    expect(closestPoint(l, P(1, 3), TOL)).toEqual({ point: P(1, 0), t: 0.25, distance: 3 });
    expect(closestPoint(l, P(-2, 0), TOL).t).toBe(0);
    expect(closestPoint(l, P(9, 0), TOL).t).toBe(1);
    const ray: Curve = { kind: 'RAY', base: P(0, 0), direction: P(0, 2) };
    expect(closestPoint(ray, P(1, -5), TOL).point).toEqual(P(0, 0));
    expect(closestPoint(ray, P(1, 5), TOL).t).toBeCloseTo(5, 12);
    const xl: Curve = { kind: 'XLINE', base: P(0, 0), direction: P(0, 2) };
    expect(closestPoint(xl, P(1, -5), TOL).t).toBeCloseTo(-5, 12);
    const dot: Curve = { kind: 'LINE', start: P(1, 1), end: P(1, 1) };
    expect(closestPoint(dot, P(4, 5), TOL)).toEqual({ point: P(1, 1), t: 0, distance: 5 });
  });

  it('projects radially onto circles and arcs; outside the sweep the nearer end wins', () => {
    const c: Curve = { kind: 'CIRCLE', center: P(0, 0), radius: 2 };
    expectNear(closestPoint(c, P(0, 5), TOL).point, P(0, 2));
    // From the centre every point is closest; the start of the domain is returned.
    expectNear(closestPoint(c, P(0, 0), TOL).point, P(2, 0));
    const a: Arc = {
      kind: 'ARC',
      center: P(0, 0),
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    expectNear(closestPoint(a, P(1, -3), TOL).point, P(2, 0));
    expectNear(closestPoint(a, P(-3, 1), TOL).point, P(0, 2));
    expect(closestPoint(a, P(3, 3), TOL).t).toBeCloseTo(Math.PI / 4, 12);
  });

  it('is never farther than any sampled point of the curve, and lies on it', () => {
    fc.assert(
      fc.property(boundedCurve, point, (c, p) => {
        const cp = closestPoint(c, p, TOL);
        const eps = 1e-6 * sizeOf(c);
        expectNear(pointAt(c, cp.t), cp.point, eps);
        expect(cp.distance).toBeCloseTo(Math.hypot(cp.point.x - p.x, cp.point.y - p.y), 6);
        for (let i = 0; i <= 200; i++) {
          const q = at(c, i / 200);
          expect(cp.distance).toBeLessThanOrEqual(Math.hypot(q.x - p.x, q.y - p.y) + eps);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('tangents', () => {
  it('tangentAt is the unit derivative', () => {
    fc.assert(
      fc.property(boundedCurve, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (c, s) => {
        const d = domain(c);
        const t = d.start + s * (d.end - d.start);
        const u = tangentAt(c, t);
        const der = derivativeAt(c, t);
        expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 12);
        expect(Math.abs(u.x * der.y - u.y * der.x)).toBeLessThan(
          1e-9 * Math.hypot(der.x, der.y) + 1e-12,
        );
        expect(u.x * der.x + u.y * der.y).toBeGreaterThan(0);
      }),
    );
  });

  it('tangent points from a point to a circle (TAN osnap)', () => {
    const c: Curve = { kind: 'CIRCLE', center: P(0, 0), radius: 1 };
    const ts = tangentPointsFrom(c, P(2, 0), TOL);
    expect(ts).toHaveLength(2);
    for (const { point } of ts) expect(point.x).toBeCloseTo(0.5, 12);
    expect(tangentPointsFrom(c, P(0.5, 0), TOL)).toEqual([]);
    expect(tangentPointsFrom(c, P(1, 0), TOL)).toEqual([]);
    const a: Arc = { kind: 'ARC', center: P(0, 0), radius: 1, startAngle: 0, endAngle: Math.PI };
    expect(tangentPointsFrom(a, P(2, 0), TOL)).toHaveLength(1);
    expect(tangentPointsFrom({ kind: 'LINE', start: P(0, 0), end: P(1, 0) }, P(0, 5), TOL)).toEqual(
      [],
    );
    expect(
      tangentPointsFrom({ kind: 'XLINE', base: P(0, 0), direction: P(1, 0) }, P(0, 5), TOL),
    ).toEqual([]);
  });

  it('finds the touching point of a tangent line drawn from outside any curve', () => {
    fc.assert(
      fc.property(
        fc.oneof(circle, arc, ellipse, spline),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        fc.double({ min: 0.5, max: 20, noNaN: true }),
        fc.boolean(),
        (c, s, k, back) => {
          const d = domain(c);
          const t = d.start + s * (d.end - d.start);
          const q = pointAt(c, t);
          const der = derivativeAt(c, t);
          fc.pre(Math.hypot(der.x, der.y) > 1e-9 * sizeOf(c));
          const u = tangentAt(c, t);
          const from = { x: q.x + (back ? -k : k) * u.x, y: q.y + (back ? -k : k) * u.y };
          const found = tangentPointsFrom(c, from, TOL);
          for (const f of found) {
            expectNear(pointAt(c, f.t), f.point, 1e-6 * sizeOf(c));
            const v = tangentAt(c, f.t);
            const w = { x: f.point.x - from.x, y: f.point.y - from.y };
            expect(Math.abs(v.x * w.y - v.y * w.x)).toBeLessThan(
              1e-6 * Math.max(1, Math.hypot(w.x, w.y)),
            );
          }
          // A spline may cross its own tangent line between `from` and q (not convex), but
          // the touching point itself is still found unless the curve is too flat there to
          // tell the tangent from a secant: it must leave the tangent line measurably (κk²/2)
          // by the time it is as far along as `from`. Degree-1 splines are straight.
          const d1 = derivativeAt(c, t);
          const kappa = Math.abs(cross2(d1, second(c, t))) / Math.hypot(d1.x, d1.y) ** 3;
          const curvy =
            c.kind !== 'SPLINE' || (c.degree > 1 && (kappa * k * k) / 2 > 1e-6 * sizeOf(c));
          if (curvy)
            expect(
              found.some((f) => Math.hypot(f.point.x - q.x, f.point.y - q.y) < 1e-6 * sizeOf(c)),
            ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('polyline arcs give tangent points at polyline parameters', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: -1, y: 0, bulge: 0 },
        { x: 1, y: 0, bulge: -1 }, // CW half circle over the top: centre (2, 0), r = 1
        { x: 3, y: 0, bulge: 0 },
      ],
    };
    const ts = tangentPointsFrom(p, P(4, 1), TOL);
    expect(ts).toHaveLength(1);
    expect(ts[0]!.t).toBeCloseTo(1.5, 12);
    expectNear(ts[0]!.point, P(2, 1));
  });
});

const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
function second(c: Curve, t: number): Vec2 {
  const h = 1e-5 * (domain(c).end - domain(c).start);
  const a = derivativeAt(c, t - h);
  const b = derivativeAt(c, t + h);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
}

describe('offset', () => {
  it('offsets lines, rays and xlines to the left for positive distances', () => {
    expect(offset({ kind: 'LINE', start: P(0, 0), end: P(2, 0) }, 1, TOL)).toEqual({
      kind: 'LINE',
      start: P(0, 1),
      end: P(2, 1),
    });
    const ray = offset({ kind: 'RAY', base: P(0, 0), direction: P(0, 3) }, 2, TOL);
    expect(ray).toEqual({ kind: 'RAY', base: P(-2, 0), direction: P(0, 3) });
    expect(offset({ kind: 'XLINE', base: P(0, 0), direction: P(1, 0) }, -1, TOL)).toEqual({
      kind: 'XLINE',
      base: P(0, -1),
      direction: P(1, 0),
    });
  });

  it('offsets circles and arcs inward for positive distances, and collapses them', () => {
    expect(offset({ kind: 'CIRCLE', center: P(0, 0), radius: 3 }, 1, TOL)).toEqual({
      kind: 'CIRCLE',
      center: P(0, 0),
      radius: 2,
    });
    expect(offset({ kind: 'CIRCLE', center: P(0, 0), radius: 3 }, 3, TOL)).toBeUndefined();
    const a = offset(
      { kind: 'ARC', center: P(0, 0), radius: 3, startAngle: 0, endAngle: 1 },
      -1,
      TOL,
    ) as Arc;
    expect(a.radius).toBe(4);
    expect([a.startAngle, a.endAngle]).toEqual([0, 1]);
    expect(
      offset({ kind: 'ARC', center: P(0, 0), radius: 3, startAngle: 0, endAngle: 1 }, 5, TOL),
    ).toBeUndefined();
  });

  it('keeps every point of an offset line, circle or arc at the offset distance', () => {
    fc.assert(
      fc.property(
        fc.oneof(line, circle, arc),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (c, dist) => {
          const o = offset(c, dist, TOL);
          if (!o) {
            expect(c.kind === 'LINE').toBe(false);
            return;
          }
          for (const s of [0, 0.25, 0.5, 1]) {
            const q = at(o, s);
            const carrier: Curve =
              c.kind === 'ARC' ? { kind: 'CIRCLE', center: c.center, radius: c.radius } : c;
            expect(closestPoint(carrier, q, TOL).distance).toBeCloseTo(Math.abs(dist), 6);
          }
        },
      ),
    );
  });

  it('offsets a rectangle outward with extended corners (OFFSETGAPTYPE 0)', () => {
    const rect: Polyline = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 4, y: 0, bulge: 0 },
        { x: 4, y: 2, bulge: 0 },
        { x: 0, y: 2, bulge: 0 },
      ],
    };
    // CCW rectangle: left is inside, so a negative distance goes outside.
    const out = offset(rect, -1, TOL) as Polyline;
    expect(out.closed).toBe(true);
    const r = (v: { x: number; y: number }) => [
      Math.round(v.x * 1e9) / 1e9 + 0,
      Math.round(v.y * 1e9) / 1e9 + 0,
    ];
    expect(out.vertices.map(r)).toEqual([
      [-1, -1],
      [5, -1],
      [5, 3],
      [-1, 3],
    ]);
    const inner = offset(rect, 0.5, TOL) as Polyline;
    expect(inner.vertices.map(r)).toEqual([
      [0.5, 0.5],
      [3.5, 0.5],
      [3.5, 1.5],
      [0.5, 1.5],
    ]);
  });

  it('offsets an open slot (lines and tangent arcs) keeping bulges and tangency', () => {
    const slot: Polyline = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 4, y: 0, bulge: 1 },
        { x: 4, y: 2, bulge: 0 },
        { x: 0, y: 2, bulge: 1 },
      ],
    };
    const out = offset(slot, -0.5, TOL) as Polyline;
    expect(out.vertices).toHaveLength(4);
    const r = (v: { x: number; y: number }) => [
      Math.round(v.x * 1e9) / 1e9 + 0,
      Math.round(v.y * 1e9) / 1e9 + 0,
    ];
    expect(out.vertices.map(r)).toEqual([
      [0, -0.5],
      [4, -0.5],
      [4, 2.5],
      [0, 2.5],
    ]);
    expect(out.vertices.map((v) => v.bulge)).toEqual(
      [0, 1, 0, 1].map((b) => expect.closeTo(b, 12)),
    );
  });

  it('joins non-tangent arcs and lines at their extended intersection, open ends offset in place', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: 0.4 },
        { x: 4, y: 0, bulge: 0 },
        { x: 4, y: 3, bulge: 0 },
      ],
    };
    for (const dist of [0.3, -0.3]) {
      const o = offset(p, dist, TOL) as Polyline;
      expect(o.vertices).toHaveLength(4);
      const src = explodePolyline(p);
      const pieces = explodePolyline(o);
      pieces.forEach((piece, i) => {
        // Each offset piece lies on the offset carrier of its source piece.
        const mid = pointAt(piece, (domain(piece).start + domain(piece).end) / 2);
        const s = src[i]!;
        const carrier: Curve =
          s.kind === 'ARC'
            ? { kind: 'CIRCLE', center: s.center, radius: s.radius }
            : {
                kind: 'XLINE',
                base: s.start,
                direction: { x: s.end.x - s.start.x, y: s.end.y - s.start.y },
              };
        expect(closestPoint(carrier, mid, TOL).distance).toBeCloseTo(0.3, 9);
      });
      expectNear(o.vertices[0]!, P(0, dist), 1e-12);
      expectNear(o.vertices[3]!, P(4 - dist, 3), 1e-12);
    }
  });

  it('drops a polyline arc that collapses and joins its neighbours', () => {
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: Math.tan(Math.PI / 8) }, // quarter circle r=2, CCW about (2, 2)
        { x: 4, y: 2, bulge: 0 },
        { x: 4, y: 4, bulge: 0 },
      ],
    };
    const o = offset(p, 2.5, TOL) as Polyline;
    expect(o.vertices).toHaveLength(3);
    expect(o.vertices.every((v) => v.bulge === 0)).toBe(true);
  });

  it('approximates ellipse and spline offsets with polylines at the offset distance', () => {
    fc.assert(
      fc.property(fc.oneof(ellipse, spline), (c) => {
        const size = sizeOf(c);
        const dist = 1e-3 * size;
        const o = offset(c, dist, TOL);
        if (!o) return;
        expect(o.kind).toBe('LWPOLYLINE');
        const poly = o as Polyline;
        for (const v of poly.vertices) {
          // Within the approximation deviation, or nearer where the curve bends tighter than dist.
          expect(closestPoint(c, v, TOL).distance).toBeLessThanOrEqual(
            Math.abs(dist) * 1.01 + 1e-6 * size,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('handles a spline cusp (coincident control points) without failing', () => {
    // Degree 2 with a doubled middle control point: S'(0.5) = 0, a sharp corner at (1, 1).
    const cusp: Spline = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 0.5, 1, 1, 1],
      controlPoints: [P(0, 0), P(1, 1), P(1, 1), P(2, 0)],
    };
    expect(Math.hypot(derivativeAt(cusp, 0.5).x, derivativeAt(cusp, 0.5).y)).toBe(0);
    const o = offset(cusp, 0.1, TOL) as Polyline;
    for (const v of o.vertices) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
      expect(closestPoint(cusp, v, TOL).distance).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expectNear(closestPoint(cusp, P(1, 3), TOL).point, P(1, 1));
    // The corner is not a tangent point, even seen along one of its legs.
    for (const tp of tangentPointsFrom(cusp, P(3, 3), TOL)) {
      expect(Math.hypot(tp.point.x - 1, tp.point.y - 1)).toBeGreaterThan(1e-3);
    }
    expect(() => tangentAt(cusp, 0.5)).toThrow(/zero-length/);
    // A line through the corner itself, and one across both legs.
    const through = intersect(cusp, { kind: 'LINE', start: P(1, 0), end: P(1, 2) }, TOL);
    expect(through).toHaveLength(1);
    expectNear(through[0]!.point, P(1, 1));
    const across = intersect(cusp, { kind: 'LINE', start: P(0, 0.5), end: P(2, 0.5) }, TOL);
    expect(across).toHaveLength(2);
  });

  it('bridges a gap with a straight segment where offset carriers do not meet', () => {
    // A line, then a CW half circle that doubles back over it: offset to the right, the
    // line drops to y = −0.5 while the arc shrinks to r = 0.5 about (2, 1); they never meet.
    const p: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: -1 },
        { x: 2, y: 2, bulge: 0 },
      ],
    };
    const o = offset(p, -0.5, TOL) as Polyline;
    const r = (v: { x: number; y: number }) => [
      Math.round(v.x * 1e9) / 1e9 + 0,
      Math.round(v.y * 1e9) / 1e9 + 0,
    ];
    expect(o.vertices.map(r)).toEqual([
      [0, -0.5],
      [2, -0.5],
      [2, 0.5],
      [2, 1.5],
    ]);
    expect(o.vertices.map((v) => v.bulge)).toEqual([0, 0, expect.closeTo(-1, 12), 0]);
    // Every segment collapsing leaves nothing.
    const tiny: Polyline = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 1 },
        { x: 1, y: 0, bulge: 0 },
      ],
    };
    expect(offset(tiny, 1, TOL)).toBeUndefined();
  });

  it('sideOf tells which side of the travel direction a point is on', () => {
    const l: Curve = { kind: 'LINE', start: P(0, 0), end: P(4, 0) };
    expect(sideOf(l, 0.5, P(2, 1), TOL)).toBe(1);
    expect(sideOf(l, 0.5, P(2, -1), TOL)).toBe(-1);
    expect(sideOf(l, 0.5, P(3, 0), TOL)).toBe(0);
    // CCW circle: the centre is on the left, so a positive offset shrinks it.
    const c: Curve = { kind: 'CIRCLE', center: P(0, 0), radius: 2 };
    expect(sideOf(c, 1, P(0, 0), TOL)).toBe(1);
  });

  it('offsetting by zero returns the curve itself', () => {
    const e: Ellipse = {
      kind: 'ELLIPSE',
      center: P(0, 0),
      majorAxis: P(2, 0),
      ratio: 0.5,
      startParam: 0,
      endParam: 1,
    };
    expect(offset(e, 0, TOL)).toBe(e);
  });
});
