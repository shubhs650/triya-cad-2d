// M3-01 part 5: SPLINE's CV method makes uniform B-splines on the vertices given, clamped to
// the end vertices when open and periodic (C2 through the seam) when closed.
import { describe, expect, it } from 'vitest';
import {
  controlSpline,
  splineDerivatives,
  splineDomain,
  splinePoint,
  validateSpline,
  type Vec2,
} from '../../src/index';

const v = (x: number, y: number): Vec2 => ({ x, y });
const near = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.y).toBeCloseTo(b.y, 12);
};

describe('controlSpline', () => {
  it('is a clamped cubic from the first vertex to the last', () => {
    const P = [v(0, 0), v(1, 2), v(3, 2), v(4, 0)];
    const s = controlSpline(P, 3, false)!;
    validateSpline(s);
    expect(s.degree).toBe(3);
    expect(s.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    const d = splineDomain(s);
    near(splinePoint(s, d.start), P[0]!);
    near(splinePoint(s, d.end), P[3]!);
    // Four vertices of a cubic: the Bézier curve, (P0 + 3P1 + 3P2 + P3) / 8 half way.
    near(splinePoint(s, 0.5), v((0 + 3 + 9 + 4) / 8, (0 + 6 + 6 + 0) / 8));
  });

  it('has uniform interior knots for more vertices, and lowers the degree for fewer', () => {
    const P = [v(0, 0), v(1, 1), v(2, 0), v(3, 1), v(4, 0), v(5, 1)];
    expect(controlSpline(P, 3, false)!.knots).toEqual([0, 0, 0, 0, 1, 2, 3, 3, 3, 3]);
    expect(controlSpline(P, 2, false)!.knots).toEqual([0, 0, 0, 1, 2, 3, 4, 4, 4]);
    // Two vertices draw a line, three a parabola, whatever degree was asked for.
    const line = controlSpline(P.slice(0, 2), 3, false)!;
    expect(line.degree).toBe(1);
    near(splinePoint(line, 0.5), v(0.5, 0.5));
    expect(controlSpline(P.slice(0, 3), 5, false)!.degree).toBe(2);
    expect(controlSpline(P.slice(0, 1), 3, false)).toBeUndefined();
    expect(controlSpline(P.slice(0, 2), 3, true)).toBeUndefined();
  });

  it('closes periodically: the seam is as smooth as the rest', () => {
    const P = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
    const s = controlSpline(P, 3, true)!;
    validateSpline(s);
    expect(s.controlPoints).toHaveLength(7);
    const { start, end } = splineDomain(s);
    near(splinePoint(s, start), splinePoint(s, end));
    const [, d1a, d2a] = splineDerivatives(s, start, 2);
    const [, d1b, d2b] = splineDerivatives(s, end, 2);
    near(d1a!, d1b!);
    near(d2a!, d2b!);
    // A uniform cubic on a square passes (P3 + 4P0 + P1) / 6 at its start.
    near(splinePoint(s, start), v((0 + 0 + 10) / 6, (10 + 0 + 0) / 6));
    // A closed line string (degree 1) runs round the vertices from the first.
    const ring = controlSpline(P, 1, true)!;
    near(splinePoint(ring, splineDomain(ring).start), P[0]!);
    near(splinePoint(ring, splineDomain(ring).start + 1), P[1]!);
  });
});
