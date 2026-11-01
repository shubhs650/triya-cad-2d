import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  boxContains,
  boxesOverlap,
  boxOf,
  curveBounds,
  domain,
  EMPTY_BOX,
  flatten,
  pointAt,
  unionBox,
  type Arc,
  type BoundedCurve,
  type Box,
  type Curve,
  type Ellipse,
  type Vec2,
} from '../../src/geom/index';
import { boundedCurve, sizeOf, TOL } from './arbitraries';

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe('flatten', () => {
  it('keeps the curve within the requested deviation of the chords', () => {
    fc.assert(
      fc.property(boundedCurve, fc.double({ min: 1e-3, max: 1, noNaN: true }), (c, rel) => {
        const dev = rel * 1e-2 * sizeOf(c);
        const { points, params } = flatten(c, dev);
        expect(points.length).toBe(params.length);
        expect(points.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < params.length; i++) {
          expect(params[i]!).toBeGreaterThanOrEqual(params[i - 1]!);
          // Check the true curve between consecutive samples against their chord.
          for (const f of [0.25, 0.5, 0.75]) {
            const t = params[i - 1]! + f * (params[i]! - params[i - 1]!);
            expect(distToSegment(pointAt(c, t), points[i - 1]!, points[i]!)).toBeLessThanOrEqual(
              dev * 1.001 + 1e-9 * sizeOf(c),
            );
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('samples start and end of the domain, and the polyline vertices', () => {
    const p = flatten(
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 3, y: 0, bulge: 0 },
          { x: 3, y: 3, bulge: 0 },
        ],
      },
      0.01,
    );
    expect(p.params).toEqual([0, 1, 2]);
    expect(p.points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it('skips empty knot spans and keeps the corner of a repeated interior knot', () => {
    // Degree 2 with knot 1 repeated twice: C0 at the control point (2, 2).
    const s: Curve = {
      kind: 'SPLINE',
      degree: 2,
      knots: [0, 0, 0, 1, 1, 2, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 0 },
      ],
    };
    const f = flatten(s, 1e-3);
    expect(f.params).toContain(1);
    expect(f.points[f.params.indexOf(1)]).toEqual({ x: 2, y: 2 });
  });

  it('uses fewer chords for a looser deviation', () => {
    const c: Curve = { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 10 };
    expect(flatten(c, 0.001).points.length).toBeGreaterThan(flatten(c, 0.1).points.length);
  });

  it('refuses unbounded curves and non-positive deviation', () => {
    const ray = {
      kind: 'RAY',
      base: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
    } as unknown as BoundedCurve;
    expect(() => flatten(ray, 0.1)).toThrow(/unbounded/);
    expect(() => flatten({ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, 0)).toThrow(
      /deviation/,
    );
  });

  it('flattens a curve smaller than the deviation to its end points', () => {
    const a: Arc = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 1e-6,
      startAngle: 0,
      endAngle: 1,
    };
    expect(flatten(a, 1).points).toHaveLength(2);
  });
});

describe('boxes', () => {
  it('builds, unions and tests boxes', () => {
    const a = boxOf([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
    ]);
    const b = boxOf([{ x: 3, y: -1 }]);
    expect(a).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 });
    expect(unionBox(a, b)).toEqual({ minX: 0, minY: -1, maxX: 3, maxY: 1 });
    expect(unionBox(EMPTY_BOX, a)).toEqual(a);
    expect(boxOf([])).toEqual(EMPTY_BOX);
    expect(boxContains(a, { x: 2.05, y: 0 }, 0.1)).toBe(true);
    expect(boxContains(a, { x: 2.2, y: 0 }, 0.1)).toBe(false);
    expect(boxesOverlap(a, b, 0)).toBe(false);
    expect(boxesOverlap(a, b, 1)).toBe(true);
    expect(boxesOverlap(EMPTY_BOX, a, 10)).toBe(false);
  });
});

describe('curveBounds', () => {
  const expectBox = (actual: Box, expected: Box, eps = 1e-12): void => {
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const)
      expect(actual[k]).toBeCloseTo(expected[k], -Math.log10(eps));
  };

  it('arc bounds include only the axis crossings inside the sweep', () => {
    const a: Arc = {
      kind: 'ARC',
      center: { x: 0, y: 0 },
      radius: 1,
      startAngle: Math.PI / 4,
      endAngle: (3 * Math.PI) / 4,
    };
    expectBox(curveBounds(a, TOL), {
      minX: -Math.SQRT1_2,
      minY: Math.SQRT1_2,
      maxX: Math.SQRT1_2,
      maxY: 1,
    });
    const wrap: Arc = { ...a, startAngle: -0.5, endAngle: 0.5 };
    expectBox(curveBounds(wrap, TOL), {
      minX: Math.cos(0.5),
      minY: -Math.sin(0.5),
      maxX: 1,
      maxY: Math.sin(0.5),
    });
  });

  it('circle and rotated ellipse bounds are exact', () => {
    expectBox(curveBounds({ kind: 'CIRCLE', center: { x: 1, y: 2 }, radius: 3 }, TOL), {
      minX: -2,
      minY: -1,
      maxX: 4,
      maxY: 5,
    });
    const r = Math.PI / 6;
    const e: Ellipse = {
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4 * Math.cos(r), y: 4 * Math.sin(r) },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    // Half-widths of a rotated ellipse: sqrt(a²cos² + b²sin²) and sqrt(a²sin² + b²cos²).
    const hx = Math.sqrt(16 * Math.cos(r) ** 2 + 4 * Math.sin(r) ** 2);
    const hy = Math.sqrt(16 * Math.sin(r) ** 2 + 4 * Math.cos(r) ** 2);
    expectBox(curveBounds(e, TOL), { minX: -hx, minY: -hy, maxX: hx, maxY: hy });
  });

  it('rays and xlines are unbounded in the directions they run', () => {
    expect(
      curveBounds({ kind: 'RAY', base: { x: 1, y: 1 }, direction: { x: 1, y: 0 } }, TOL),
    ).toEqual({
      minX: 1,
      minY: 1,
      maxX: Infinity,
      maxY: 1,
    });
    expect(
      curveBounds({ kind: 'RAY', base: { x: 1, y: 1 }, direction: { x: -1, y: -1 } }, TOL),
    ).toEqual({
      minX: -Infinity,
      minY: -Infinity,
      maxX: 1,
      maxY: 1,
    });
    expect(
      curveBounds({ kind: 'XLINE', base: { x: 1, y: 1 }, direction: { x: 0, y: 2 } }, TOL),
    ).toEqual({
      minX: 1,
      minY: -Infinity,
      maxX: 1,
      maxY: Infinity,
    });
  });

  it('contains every point of the curve and is touched by it', () => {
    fc.assert(
      fc.property(boundedCurve, (c) => {
        const box = curveBounds(c, TOL);
        const eps = 1e-9 * sizeOf(c);
        const d = domain(c);
        let touch = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        // Uniform samples plus the knots, where a low-degree spline can have its corners.
        const ts = Array.from({ length: 2001 }, (_, i) => d.start + (i / 2000) * (d.end - d.start));
        if (c.kind === 'SPLINE') ts.push(...c.knots.filter((u) => u >= d.start && u <= d.end));
        for (const t of ts) {
          const p = pointAt(c, t);
          expect(boxContains(box, p, eps)).toBe(true);
          touch = unionBox(touch, boxOf([p]));
        }
        // Dense sampling gets close to every side (splines are bounded within the flattening tolerance).
        const slack = 2e-3 * sizeOf(c);
        expect(touch.minX - box.minX).toBeLessThan(slack);
        expect(box.maxX - touch.maxX).toBeLessThan(slack);
        expect(touch.minY - box.minY).toBeLessThan(slack);
        expect(box.maxY - touch.maxY).toBeLessThan(slack);
      }),
      { numRuns: 300 },
    );
  });
});
