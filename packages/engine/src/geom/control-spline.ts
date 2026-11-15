// Splines drawn by their control vertices (M3-01 part 5): SPLINE's CV method, and SPLINE
// Object's conversion of a spline-fit polyline, whose frame is the control polygon of the same
// kind of curve (PEDIT Spline, quadratic or cubic).
//
// AutoCAD does not document the knots of a CV spline. A uniform B-spline is what its CV
// method shows (each vertex pulls the curve equally) and what a spline-fit polyline is, so the
// knots are 0, 1, 2, …: clamped at both ends for an open curve, which then starts and ends on
// its first and last vertex; unclamped with the first `degree` vertices repeated at the end for
// a closed one, which is periodic (C2 all round, as AutoCAD's Close makes it, "SPLINE
// (Command)": "By default, closed splines are periodic"). With fewer vertices than the degree
// needs, the degree drops to what they carry (two vertices draw a straight line), as AutoCAD's
// preview does while the vertices are being placed.

import type { Spline } from './curves';
import type { Vec2 } from './types';

/**
 * The uniform B-spline of `degree` (at most) on the control polygon `points`, closed and
 * periodic when `closed`; undefined with fewer than two vertices (three when closed).
 */
export function controlSpline(
  points: readonly Vec2[],
  degree: number,
  closed: boolean,
): Spline | undefined {
  const n = points.length;
  if (n < (closed ? 3 : 2)) return undefined;
  const p = Math.max(1, Math.min(Math.trunc(degree), n - 1));
  if (closed) {
    // Turned so the curve's start (and seam) lies about the first vertex: a cubic's starts
    // at (P[n−1] + 4·P[0] + P[1]) / 6.
    const shift = Math.floor(p / 2);
    const ring = [...points.slice(n - shift), ...points.slice(0, n - shift)];
    const controlPoints = [...ring, ...ring.slice(0, p)];
    const knots = Array.from({ length: controlPoints.length + p + 1 }, (_, i) => i);
    return { kind: 'SPLINE', degree: p, knots, controlPoints };
  }
  const inner = n - p - 1;
  const knots = [
    ...Array<number>(p + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => i + 1),
    ...Array<number>(p + 1).fill(inner + 1),
  ];
  return { kind: 'SPLINE', degree: p, knots, controlPoints: [...points] };
}
