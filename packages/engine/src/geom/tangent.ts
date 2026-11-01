// Tangent directions and tangent points from an external point (osnap TAN, CIRCLE TTR seeds).

import { boxOf } from './bounds';
import type { Curve } from './curves';
import { derivativeAt } from './eval';
import { bisect } from './numeric';
import {
  flattenPiece,
  pieceEval,
  piecesOf,
  toCurveParam,
  type EllipticPiece,
  type Piece,
} from './pieces';
import type { Tolerance } from './tolerance';
import { angleWithin } from './angle';
import { add, angleOf, cross, dot, length, normalize, scale, sub } from './vec';
import type { Vec2 } from './types';

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const dd = dot(d, d);
  const f = dd === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / dd));
  return length(sub(p, add(a, scale(d, f))));
}

/** Unit tangent in the direction of increasing parameter. */
export function tangentAt(c: Curve, t: number): Vec2 {
  return normalize(derivativeAt(c, t));
}

export interface TangentPoint {
  readonly point: Vec2;
  readonly t: number;
}

/** Angles of the two tangent points from q to the circle of radius r about the origin. */
function circleTangentAngles(q: Vec2, r: number, linTol: number): number[] {
  const d = length(q);
  if (d <= r + linTol) return [];
  const a = angleOf(q);
  const b = Math.acos(r / d);
  return [a - b, a + b];
}

function sweptParam(a0: number, sweep: number, theta: number, tol: Tolerance): number | undefined {
  const lo = sweep >= 0 ? a0 : a0 + sweep;
  const t = angleWithin(theta, lo, Math.abs(sweep), tol);
  return t === undefined ? undefined : (t - a0) / sweep;
}

function unitFrame(e: EllipticPiece, v: Vec2): Vec2 {
  const det = cross(e.A, e.B);
  return { x: cross(v, e.B) / det, y: cross(e.A, v) / det };
}

function onPiece(pc: Piece, p: Vec2, tol: Tolerance): number[] {
  switch (pc.kind) {
    case 'linear':
      return [];
    case 'circular':
      return circleTangentAngles(sub(p, pc.c), pc.r, tol.linear)
        .map((th) => sweptParam(pc.a0, pc.sweep, th, tol))
        .filter((s): s is number => s !== undefined);
    case 'elliptic':
      // Tangency survives affine maps: solve against the unit circle in the ellipse's frame.
      return circleTangentAngles(unitFrame(pc, sub(p, pc.c)), 1, tol.linear / length(pc.B))
        .map((u) => sweptParam(pc.u0, pc.sweep, u, tol))
        .filter((s): s is number => s !== undefined);
    case 'spline': {
      // Roots of g(u) = (S(u) − p) × S'(u), bracketed by sign changes between samples.
      const g = (u: number): number => {
        const [q, d] = pieceEval(pc, u);
        return cross(sub(q, p), d);
      };
      const b = boxOf(pc.spline.controlPoints);
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      const { s, points } = flattenPiece(pc, Math.max(tol.linear, 1e-4 * size));
      const out: number[] = [];
      for (let i = 1; i < s.length; i++) {
        // The two tangent points from a p close to a flat stretch are about as far apart as p
        // is from the curve, so sub-sample each chord finely enough not to hide a pair of
        // roots inside one interval.
        const a = points[i - 1]!;
        const b = points[i]!;
        const near = distanceToSegment(p, a, b);
        const n = Math.min(256, Math.max(4, Math.ceil((4 * length(sub(b, a))) / near)));
        for (let k = 0; k < n; k++) {
          const lo = s[i - 1]! + ((s[i]! - s[i - 1]!) * k) / n;
          const hi = s[i - 1]! + ((s[i]! - s[i - 1]!) * (k + 1)) / n;
          const glo = g(lo);
          const ghi = g(hi);
          if (glo === 0) out.push(lo);
          else if (glo < 0 !== ghi < 0) out.push(bisect(g, lo, hi));
        }
      }
      return out.filter((u) => {
        const [q, d] = pieceEval(pc, u);
        const len = length(d);
        // A root at p itself (p on the curve) is not a tangent point from outside; nor is a
        // sign change across a corner (degree-1 knot) or a cusp, where S' jumps or vanishes:
        // keep only roots where p lies on the tangent line within tolerance.
        return (
          length(sub(q, p)) > tol.linear &&
          len > 0 &&
          Math.abs(cross(sub(q, p), d)) <= tol.linear * len
        );
      });
    }
  }
}

/** Points where a line from `p` touches the curve tangentially (TAN osnap from a point). */
export function tangentPointsFrom(c: Curve, p: Vec2, tol: Tolerance): TangentPoint[] {
  const out: TangentPoint[] = [];
  for (const pc of piecesOf(c)) {
    for (const s of onPiece(pc, p, tol)) {
      const point = pieceEval(pc, s)[0];
      if (out.some((o) => length(sub(o.point, point)) <= tol.linear)) continue;
      out.push({ point, t: toCurveParam(pc, s) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
