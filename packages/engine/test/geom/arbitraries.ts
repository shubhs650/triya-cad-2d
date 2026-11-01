// fast-check generators for kernel curves at drafting scales, plus shared assertions.
import fc from 'fast-check';
import { expect } from 'vitest';
import {
  domain,
  pointAt,
  toleranceForSize,
  type Arc,
  type BoundedCurve,
  type Circle,
  type Curve,
  type Ellipse,
  type Line,
  type Polyline,
  type Spline,
  type Vec2,
} from '../../src/geom/index';

export const TOL = toleranceForSize(1000);

const coord = fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true });
const angle = fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true });

export const point: fc.Arbitrary<Vec2> = fc.record({ x: coord, y: coord });
export const radius = fc.double({ min: 0.01, max: 500, noNaN: true });

/** Two points at least `min` apart. */
export const distinctPoints = (min = 0.01): fc.Arbitrary<[Vec2, Vec2]> =>
  fc.tuple(point, point).filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > min);

export const line: fc.Arbitrary<Line> = distinctPoints().map(([start, end]) => ({
  kind: 'LINE',
  start,
  end,
}));

export const circle: fc.Arbitrary<Circle> = fc
  .record({ center: point, radius })
  .map((c) => ({ kind: 'CIRCLE', ...c }));

export const arc: fc.Arbitrary<Arc> = fc
  .record({
    center: point,
    radius,
    startAngle: angle,
    sweep: fc.double({ min: 0.01, max: 2 * Math.PI - 0.01, noNaN: true }),
  })
  .map(({ center, radius, startAngle, sweep }) => ({
    kind: 'ARC',
    center,
    radius,
    startAngle,
    endAngle: startAngle + sweep,
  }));

export const ellipse: fc.Arbitrary<Ellipse> = fc
  .record({
    center: point,
    a: radius,
    rot: angle,
    ratio: fc.double({ min: 0.05, max: 1, noNaN: true }),
    startParam: angle,
    sweep: fc.double({ min: 0.01, max: 2 * Math.PI, noNaN: true }),
  })
  .map(({ center, a, rot, ratio, startParam, sweep }) => ({
    kind: 'ELLIPSE',
    center,
    majorAxis: { x: a * Math.cos(rot), y: a * Math.sin(rot) },
    ratio,
    startParam,
    endParam: startParam + sweep,
  }));

const bulge = fc.oneof(
  fc.constant(0),
  fc.double({ min: -3, max: 3, noNaN: true }).filter((b) => Math.abs(b) > 0.01),
);

export const polyline: fc.Arbitrary<Polyline> = fc
  .record({
    pts: fc.array(fc.record({ x: coord, y: coord, bulge }), { minLength: 2, maxLength: 7 }),
    closed: fc.boolean(),
  })
  .filter(({ pts, closed }) => {
    // Consecutive vertices must differ, or the segment has no direction.
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) return false;
    }
    return true;
  })
  .map(({ pts, closed }) => ({ kind: 'LWPOLYLINE', vertices: pts, closed }));

export const spline: fc.Arbitrary<Spline> = fc
  .record({
    degree: fc.integer({ min: 1, max: 3 }),
    extra: fc.integer({ min: 0, max: 4 }),
    rational: fc.boolean(),
    seed: fc.array(fc.double({ min: 0.05, max: 1, noNaN: true }), { minLength: 8, maxLength: 8 }),
    pts: fc.array(point, { minLength: 8, maxLength: 8 }),
    w: fc.array(fc.double({ min: 0.2, max: 5, noNaN: true }), { minLength: 8, maxLength: 8 }),
  })
  .map(({ degree, extra, rational, seed, pts, w }) => {
    const n = degree + 1 + extra;
    // Clamped knot vector with random (non-uniform) interior spacing.
    const interior: number[] = [];
    let acc = 0;
    for (let i = 0; i < n - degree - 1; i++) interior.push((acc += seed[i]!));
    const end = acc + seed[7]!;
    const knots = [
      ...Array<number>(degree + 1).fill(0),
      ...interior,
      ...Array<number>(degree + 1).fill(end),
    ];
    const s: Spline = { kind: 'SPLINE', degree, knots, controlPoints: pts.slice(0, n) };
    return rational ? { ...s, weights: w.slice(0, n) } : s;
  });

export const boundedCurve: fc.Arbitrary<BoundedCurve> = fc.oneof(
  line,
  circle,
  arc,
  ellipse,
  polyline,
  spline,
);

/** Point at normalised parameter s ∈ [0, 1] of a bounded curve. */
export function at(c: Curve, s: number): Vec2 {
  const d = domain(c);
  return pointAt(c, d.start + s * (d.end - d.start));
}

export function expectNear(actual: Vec2, expected: Vec2, eps = 1e-7): void {
  const d = Math.hypot(actual.x - expected.x, actual.y - expected.y);
  if (!(d <= eps)) {
    expect.fail(
      `expected (${actual.x}, ${actual.y}) within ${eps} of (${expected.x}, ${expected.y}); off by ${d}`,
    );
  }
}

/** Scale of a curve's coordinates, for relative tolerances in assertions. */
export function sizeOf(c: Curve): number {
  const pts: Vec2[] = [];
  switch (c.kind) {
    case 'LINE':
      pts.push(c.start, c.end);
      break;
    case 'RAY':
    case 'XLINE':
      pts.push(c.base);
      break;
    case 'CIRCLE':
    case 'ARC':
      pts.push(c.center);
      return Math.max(Math.abs(c.center.x), Math.abs(c.center.y)) + c.radius + 1;
    case 'ELLIPSE':
      return (
        Math.max(Math.abs(c.center.x), Math.abs(c.center.y)) +
        Math.hypot(c.majorAxis.x, c.majorAxis.y) +
        1
      );
    case 'LWPOLYLINE':
      pts.push(...c.vertices);
      break;
    case 'SPLINE':
      pts.push(...c.controlPoints);
      break;
  }
  return Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
}
