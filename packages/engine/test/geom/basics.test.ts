import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  add,
  angleOf,
  angleWithin,
  ccwSweep,
  cross,
  distance,
  dot,
  fromAngle,
  length,
  lerp,
  midpoint,
  neg,
  normalize,
  normalizeAngle,
  perp,
  pointsEqual,
  RELATIVE_EPSILON,
  rotate,
  rotateAbout,
  scale,
  sub,
  TAU,
  toleranceForSize,
  toleranceFromExtents,
  vec2,
} from '../../src/geom/index';
import { expectNear, point } from './arbitraries';

describe('vectors', () => {
  it('does the basic algebra', () => {
    const a = vec2(3, 4);
    const b = vec2(-1, 2);
    expect(add(a, b)).toEqual({ x: 2, y: 6 });
    expect(sub(a, b)).toEqual({ x: 4, y: 2 });
    expect(scale(a, 2)).toEqual({ x: 6, y: 8 });
    expect(neg(a)).toEqual({ x: -3, y: -4 });
    expect(dot(a, b)).toBe(5);
    expect(cross(a, b)).toBe(10);
    expect(length(a)).toBe(5);
    expect(distance(a, b)).toBeCloseTo(Math.hypot(4, 2), 12);
    expect(perp(a)).toEqual({ x: -4, y: 3 });
    expect(lerp(a, b, 0.5)).toEqual({ x: 1, y: 3 });
    expect(midpoint(a, b)).toEqual({ x: 1, y: 3 });
    expectNear(normalize(a), { x: 0.6, y: 0.8 }, 1e-15);
  });

  it('refuses to normalise a zero vector', () => {
    expect(() => normalize(vec2(0, 0))).toThrow(/zero-length/);
  });

  it('measures angles in [0, 2π) counter-clockwise from +X', () => {
    expect(angleOf(vec2(1, 0))).toBe(0);
    expect(angleOf(vec2(0, 1))).toBeCloseTo(Math.PI / 2, 15);
    expect(angleOf(vec2(-1, 0))).toBeCloseTo(Math.PI, 15);
    expect(angleOf(vec2(0, -1))).toBeCloseTo((3 * Math.PI) / 2, 15);
    expectNear(fromAngle(Math.PI / 2, 2), { x: 0, y: 2 }, 1e-15);
    expectNear(rotate(vec2(1, 0), Math.PI / 2), { x: 0, y: 1 }, 1e-15);
    expectNear(rotateAbout(vec2(2, 1), vec2(1, 1), Math.PI), { x: 0, y: 1 }, 1e-15);
  });

  it('compares points within a tolerance', () => {
    const tol = toleranceForSize(1);
    expect(pointsEqual(vec2(1, 1), vec2(1 + 1e-12, 1), tol)).toBe(true);
    expect(pointsEqual(vec2(1, 1), vec2(1 + 1e-6, 1), tol)).toBe(false);
  });

  it('rotation preserves length and cross/dot obey the identities', () => {
    fc.assert(
      fc.property(point, point, fc.double({ min: -10, max: 10, noNaN: true }), (a, b, t) => {
        expect(length(rotate(a, t))).toBeCloseTo(length(a), 9);
        expect(dot(a, perp(b))).toBeCloseTo(-cross(a, b), 6);
      }),
    );
  });
});

describe('angles', () => {
  it.each([
    [0, 0],
    [TAU, 0],
    [-Math.PI / 2, (3 * Math.PI) / 2],
    [5 * Math.PI, Math.PI],
    [-1e-18, 0],
  ])('normalizeAngle(%f) = %f', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected, 12);
    expect(normalizeAngle(input)).toBeGreaterThanOrEqual(0);
    expect(normalizeAngle(input)).toBeLessThan(TAU);
  });

  it('measures CCW sweeps, with equal angles meaning a full turn', () => {
    // DXF ARC 0°→360° (and ELLIPSE 0→2π) is a full curve; there are no zero-length arcs.
    expect(ccwSweep(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 15);
    expect(ccwSweep(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2, 15);
    expect(ccwSweep(0, TAU)).toBe(TAU);
    expect(ccwSweep(1, 1)).toBe(TAU);
  });

  it('finds an angle inside a sweep and returns it unwrapped', () => {
    const tol = toleranceForSize(1);
    expect(angleWithin(Math.PI / 4, 0, Math.PI / 2, tol)).toBeCloseTo(Math.PI / 4, 15);
    expect(angleWithin(Math.PI / 4 - TAU, 0, Math.PI / 2, tol)).toBeCloseTo(Math.PI / 4, 15);
    expect(angleWithin(0.1, 3, 4, tol)).toBeCloseTo(0.1 + TAU, 15);
    expect(angleWithin(Math.PI, 0, Math.PI / 2, tol)).toBeUndefined();
    // Endpoints are inside within the angular tolerance, on both sides of the wrap.
    expect(angleWithin(-1e-12, 0, 1, tol)).toBe(0);
    expect(angleWithin(1 + 1e-12, 0, 1, tol)).toBe(1);
    expect(angleWithin(TAU - 1e-12, 0, 1, tol)).toBe(0);
  });
});

describe('tolerance model', () => {
  it('scales the linear epsilon with the drawing extents', () => {
    const small = toleranceFromExtents(vec2(0, 0), vec2(10, 5));
    const big = toleranceFromExtents(vec2(-2e5, 0), vec2(1e3, 3e5));
    expect(small.linear).toBe(10 * RELATIVE_EPSILON);
    expect(big.linear).toBe(3e5 * RELATIVE_EPSILON);
    expect(small.angular).toBe(RELATIVE_EPSILON);
  });

  it('counts distance from the origin, where float precision is lost', () => {
    // A 1-unit drawing placed at 1e6 has only ~1e-10 relative precision at its coordinates.
    expect(toleranceFromExtents(vec2(1e6, 1e6), vec2(1e6 + 1, 1e6 + 1)).linear).toBeCloseTo(
      (1e6 + 1) * RELATIVE_EPSILON,
      18,
    );
  });

  it('falls back to unit size for empty or tiny drawings', () => {
    // AutoCAD writes $EXTMIN = 1e20, $EXTMAX = -1e20 for an empty drawing.
    expect(toleranceFromExtents(vec2(1e20, 1e20), vec2(-1e20, -1e20)).linear).toBe(
      RELATIVE_EPSILON,
    );
    expect(toleranceFromExtents(vec2(0, 0), vec2(0.001, 0.001)).linear).toBe(RELATIVE_EPSILON);
    expect(toleranceFromExtents(vec2(NaN, 0), vec2(1, 1)).linear).toBe(RELATIVE_EPSILON);
    expect(toleranceForSize(-5).linear).toBe(RELATIVE_EPSILON);
  });
});
