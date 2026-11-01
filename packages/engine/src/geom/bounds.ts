// Axis-aligned bounding boxes. Exact for analytic curves; splines are bounded from their
// flattening, padded by its deviation so the box always contains the curve.

import { angleWithin } from './angle';
import type { Curve, Spline } from './curves';
import { arcSweep, ellipseAxes, ellipseSweep, explodePolyline, pointAt } from './eval';
import { flatten } from './flatten';
import { splinePoint } from './nurbs';
import { argmin } from './numeric';
import type { Tolerance } from './tolerance';
import { normalize } from './vec';
import type { Vec2 } from './types';

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The empty box: union identity, overlaps nothing. */
export const EMPTY_BOX: Box = Object.freeze({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export function boxOf(points: readonly Vec2[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const unionBox = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

export const boxContains = (b: Box, p: Vec2, pad: number): boolean =>
  p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad;

export const boxesOverlap = (a: Box, b: Box, pad: number): boolean =>
  a.minX - pad <= b.maxX &&
  b.minX - pad <= a.maxX &&
  a.minY - pad <= b.maxY &&
  b.minY - pad <= a.maxY;

const pad = (b: Box, d: number): Box => ({
  minX: b.minX - d,
  minY: b.minY - d,
  maxX: b.maxX + d,
  maxY: b.maxY + d,
});

/**
 * Spline bounds: flatten coarsely, then polish every local extremum of the samples with a
 * golden-section search on the true curve, so the box is exact to rounding rather than to the
 * flattening deviation.
 */
function splineBounds(c: Spline, tol: Tolerance): Box {
  const hull = boxOf(c.controlPoints);
  const size = Math.max(hull.maxX - hull.minX, hull.maxY - hull.minY, tol.linear);
  const { points, params } = flatten(c, size * 1e-4);
  const coords: ((p: Vec2) => number)[] = [(p) => p.x, (p) => p.y, (p) => -p.x, (p) => -p.y];
  const ext = coords.map((g) => {
    let best = Infinity;
    const last = points.length - 1;
    for (let i = 0; i <= last; i++) {
      // A local minimum of the samples, the ends included: the true one is next to it.
      const v = g(points[i]!);
      if ((i === 0 || v <= g(points[i - 1]!)) && (i === last || v <= g(points[i + 1]!))) {
        const lo = params[Math.max(0, i - 1)]!;
        const hi = params[Math.min(last, i + 1)]!;
        best = Math.min(best, v, argmin((u) => g(splinePoint(c, u)), lo, hi).fx);
      }
    }
    return best;
  });
  return pad({ minX: ext[0]!, minY: ext[1]!, maxX: -ext[2]!, maxY: -ext[3]! }, tol.linear);
}

/** Endpoints plus the extremal parameters that fall inside the sweep. */
function sweptBox(c: Curve, start: number, sweep: number, extrema: number[], tol: Tolerance): Box {
  const pts = [pointAt(c, start), pointAt(c, start + sweep)];
  for (const t of extrema) {
    for (const k of [0, Math.PI]) {
      const u = angleWithin(t + k, start, sweep, tol);
      if (u !== undefined) pts.push(pointAt(c, u));
    }
  }
  return boxOf(pts);
}

function lineSpan(base: number, dir: number, tol: Tolerance, ray: boolean): [number, number] {
  if (Math.abs(dir) <= tol.angular) return [base, base];
  if (!ray) return [-Infinity, Infinity];
  return dir > 0 ? [base, Infinity] : [-Infinity, base];
}

export function curveBounds(c: Curve, tol: Tolerance): Box {
  switch (c.kind) {
    case 'LINE':
      return boxOf([c.start, c.end]);
    case 'RAY':
    case 'XLINE': {
      const u = normalize(c.direction);
      const [minX, maxX] = lineSpan(c.base.x, u.x, tol, c.kind === 'RAY');
      const [minY, maxY] = lineSpan(c.base.y, u.y, tol, c.kind === 'RAY');
      return { minX, minY, maxX, maxY };
    }
    case 'CIRCLE':
      return {
        minX: c.center.x - c.radius,
        minY: c.center.y - c.radius,
        maxX: c.center.x + c.radius,
        maxY: c.center.y + c.radius,
      };
    case 'ARC':
      return sweptBox(c, c.startAngle, arcSweep(c), [0, Math.PI / 2], tol);
    case 'ELLIPSE': {
      // x(u) = cx + Mx cos u + mx sin u is extremal where tan u = mx / Mx (and likewise y).
      const { major, minor } = ellipseAxes(c);
      const extrema = [Math.atan2(minor.x, major.x), Math.atan2(minor.y, major.y)];
      return sweptBox(c, c.startParam, ellipseSweep(c), extrema, tol);
    }
    case 'LWPOLYLINE':
      return explodePolyline(c).reduce((b, s) => unionBox(b, curveBounds(s, tol)), EMPTY_BOX);
    case 'SPLINE':
      return splineBounds(c, tol);
  }
}
