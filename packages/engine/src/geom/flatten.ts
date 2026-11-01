// Flattening: a curve as a polyline whose chords stay within `maxDeviation` of the curve.
// Used for bounds of splines, numeric intersection candidates, and render tessellation.

import type { BoundedCurve, Spline } from './curves';
import {
  arcSweep,
  domain,
  ellipseSweep,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
} from './eval';
import { splinePoint } from './nurbs';
import { distance, length } from './vec';
import type { Vec2 } from './types';

export interface Flattened {
  readonly points: Vec2[];
  /** Curve parameter of each point, non-decreasing. */
  readonly params: number[];
}

/**
 * Chords needed so a circular arc of radius r and sweep θ deviates at most `dev` from them:
 * the sagitta of a chord spanning φ ≤ π is r(1 − cos(φ/2)). No chord spans more than a half
 * turn, where that formula stops bounding the distance to the chord.
 */
export function arcSteps(r: number, sweep: number, dev: number): number {
  const step = dev >= r ? Math.PI : Math.min(Math.PI, 2 * Math.acos(1 - dev / r));
  return Math.max(1, Math.ceil(Math.abs(sweep) / step));
}

function uniform(c: BoundedCurve, t0: number, t1: number, n: number, out: Flattened): void {
  for (let k = 1; k <= n; k++) {
    const t = k === n ? t1 : t0 + ((t1 - t0) * k) / n;
    out.params.push(t);
    out.points.push(pointAt(c, t));
  }
}

function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const MAX_DEPTH = 40;

function refineSpline(
  s: Spline,
  u0: number,
  p0: Vec2,
  u1: number,
  p1: Vec2,
  dev: number,
  depth: number,
  out: Flattened,
): void {
  const flat =
    depth >= MAX_DEPTH ||
    [0.25, 0.5, 0.75].every(
      (f) => distanceToChord(splinePoint(s, u0 + f * (u1 - u0)), p0, p1) <= dev,
    );
  if (flat) {
    out.params.push(u1);
    out.points.push(p1);
    return;
  }
  const um = (u0 + u1) / 2;
  const pm = splinePoint(s, um);
  refineSpline(s, u0, p0, um, pm, dev, depth + 1, out);
  refineSpline(s, um, pm, u1, p1, dev, depth + 1, out);
}

export function flatten(c: BoundedCurve, maxDeviation: number): Flattened {
  if (!(maxDeviation > 0))
    throw new Error(`flatten deviation must be positive, got ${maxDeviation}`);
  if ((c.kind as string) === 'RAY' || (c.kind as string) === 'XLINE') {
    throw new Error(`${c.kind} is unbounded and cannot be flattened`);
  }
  const d = domain(c);
  const out: Flattened = { points: [pointAt(c, d.start)], params: [d.start] };
  switch (c.kind) {
    case 'LINE':
      uniform(c, 0, 1, 1, out);
      break;
    case 'CIRCLE':
      uniform(c, d.start, d.end, arcSteps(c.radius, d.end - d.start, maxDeviation), out);
      break;
    case 'ARC':
      uniform(c, d.start, d.end, arcSteps(c.radius, arcSweep(c), maxDeviation), out);
      break;
    case 'ELLIPSE':
      // An ellipse is an affine image of a circle whose largest stretch is the major radius,
      // so the circle's chord count for that radius bounds the deviation.
      uniform(c, d.start, d.end, arcSteps(length(c.majorAxis), ellipseSweep(c), maxDeviation), out);
      break;
    case 'LWPOLYLINE':
      for (let i = 0; i < polylineSegmentCount(c); i++) {
        const seg = polylineSegment(c, i);
        const n = 'line' in seg ? 1 : arcSteps(seg.arc.radius, seg.arc.sweep, maxDeviation);
        uniform(c, i, i + 1, n, out);
      }
      break;
    case 'SPLINE': {
      // Start each knot span with degree+1 pieces so an S-shaped span, whose midpoint can sit
      // on its chord, is still subdivided.
      const U = c.knots;
      for (let i = c.degree; i < c.controlPoints.length; i++) {
        if (U[i + 1]! <= U[i]!) continue;
        const pieces = c.degree + 1;
        for (let k = 0; k < pieces; k++) {
          const u0 = U[i]! + ((U[i + 1]! - U[i]!) * k) / pieces;
          const u1 =
            k === pieces - 1 ? U[i + 1]! : U[i]! + ((U[i + 1]! - U[i]!) * (k + 1)) / pieces;
          refineSpline(c, u0, out.points.at(-1)!, u1, splinePoint(c, u1), maxDeviation, 0, out);
        }
      }
      break;
    }
  }
  return out;
}
