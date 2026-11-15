// M3-01 part 4: the ELLIPSE, XLINE and DONUT constructions on their own.
import { describe, expect, it } from 'vitest';
import {
  angleFromAxis,
  bisector,
  donutOf,
  ellipseOf,
  firstAxisAngle,
  offsetXline,
  otherFromRotation,
  parameterAtAngle,
  pointAt,
  toleranceForSize,
  xlineThrough,
  TAU,
} from '../../src/index';

const tol = toleranceForSize(10);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

describe('ellipseOf', () => {
  const axes = { center: { x: 0, y: 0 }, axis: { x: 4, y: 0 }, other: 2 };

  it('is the whole ellipse by default, the first axis major when longer', () => {
    expect(ellipseOf(axes, tol)).toEqual({
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: TAU,
    });
  });

  it('turns the major axis and shifts the parameters when the other axis is longer', () => {
    const e = ellipseOf({ ...axes, other: 8 }, tol, 0, Math.PI / 2)!;
    expect(e.ratio).toBe(0.5);
    expect([r6(e.majorAxis.x), r6(e.majorAxis.y)]).toEqual([0, 8]);
    // First-axis parameter 0 is (4, 0); π/2 is (0, 8).
    const s = pointAt(e, e.startParam);
    const t = pointAt(e, e.endParam);
    expect([r6(s.x), r6(s.y), r6(t.x), r6(t.y)]).toEqual([4, 0, 0, 8]);
  });

  it('wraps an arc past the first axis, and meets itself as a whole ellipse', () => {
    const e = ellipseOf(axes, tol, 1.5 * Math.PI, 2.5 * Math.PI)!;
    expect(r6(e.startParam)).toBe(r6(1.5 * Math.PI));
    expect(r6(e.endParam)).toBe(r6(0.5 * Math.PI));
    expect(ellipseOf(axes, tol, 1, 1 + TAU)).toMatchObject({ startParam: 0, endParam: TAU });
  });

  it('has none for a degenerate axis', () => {
    expect(ellipseOf({ ...axes, other: 0 }, tol)).toBeUndefined();
    expect(ellipseOf({ ...axes, axis: { x: 0, y: 0 } }, tol)).toBeUndefined();
  });
});

describe('ellipse angles', () => {
  const axes = { center: { x: 1, y: 1 }, axis: { x: 0, y: 3 }, other: 1 };

  it('counts from the first axis', () => {
    expect(firstAxisAngle(axes)).toBe(Math.PI / 2);
    expect(r6(angleFromAxis(axes, { x: 0, y: 1 }))).toBe(r6(Math.PI / 2));
  });

  it('meets the ellipse along the ray (quadrants kept)', () => {
    expect(r6(parameterAtAngle(axes, 0))).toBe(0);
    expect(r6(parameterAtAngle(axes, Math.PI))).toBe(r6(Math.PI));
    // tan u = (a / b) tan θ: at 45°, u = atan(3).
    expect(r6(parameterAtAngle(axes, Math.PI / 4))).toBe(r6(Math.atan(3)));
  });

  it('Rotation: cos of the angle either way, none past 89.4°', () => {
    expect(r6(otherFromRotation({ x: 4, y: 0 }, Math.PI / 3)!)).toBe(2);
    expect(r6(otherFromRotation({ x: 4, y: 0 }, (2 * Math.PI) / 3)!)).toBe(2);
    expect(otherFromRotation({ x: 4, y: 0 }, (89.4 * Math.PI) / 180)).toBeGreaterThan(0);
    expect(otherFromRotation({ x: 4, y: 0 }, (89.5 * Math.PI) / 180)).toBeUndefined();
  });
});

describe('xlines', () => {
  it('through a point along a direction, normalised; none along nothing', () => {
    expect(xlineThrough({ x: 1, y: 2 }, { x: 0, y: 5 }, tol)).toEqual({
      kind: 'XLINE',
      base: { x: 1, y: 2 },
      direction: { x: 0, y: 1 },
    });
    expect(xlineThrough({ x: 1, y: 2 }, { x: 0, y: 0 }, tol)).toBeUndefined();
  });

  it('bisects the angle, square to opposite rays, none on the vertex', () => {
    const b = bisector({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 5 }, tol)!;
    expect([r6(b.direction.x), r6(b.direction.y)]).toEqual([r6(Math.SQRT1_2), r6(Math.SQRT1_2)]);
    const o = bisector({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, tol)!;
    expect([r6(o.direction.x), r6(o.direction.y)]).toEqual([0, 1]);
    expect(bisector({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, tol)).toBeUndefined();
  });

  it('offsets to the side picked, or through it; none from a pick on the line', () => {
    const line = { point: { x: 0, y: 0 }, direction: { x: 3, y: 0 } };
    expect(offsetXline(line, { x: 9, y: -1 }, 2, tol)).toEqual({
      kind: 'XLINE',
      base: { x: 0, y: -2 },
      direction: { x: 1, y: 0 },
    });
    expect(offsetXline(line, { x: 9, y: -1 }, undefined, tol)).toMatchObject({
      base: { x: 9, y: -1 },
    });
    expect(offsetXline(line, { x: 5, y: 0 }, 2, tol)).toBeUndefined();
  });
});

describe('donutOf', () => {
  it('takes the diameters either way round', () => {
    expect(donutOf({ x: 0, y: 0 }, 4, 2)).toEqual(donutOf({ x: 0, y: 0 }, 2, 4));
    expect(donutOf({ x: 0, y: 0 }, 2, 4)).toEqual({
      vertices: [
        { x: -1.5, y: 0, bulge: 1 },
        { x: 1.5, y: 0, bulge: 1 },
      ],
      width: 1,
    });
  });
});
