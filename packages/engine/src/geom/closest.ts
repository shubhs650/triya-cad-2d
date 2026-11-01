// Closest point on a curve (osnap NEA and PER seeds, PICK distance, TRIM/BREAK picks).
//
// Lines and circular pieces are exact. Ellipses and splines are flattened and searched by
// branch and bound: chords nearest the point first, each polished by golden-section search on
// the true curve, skipping chords that cannot beat the best distance found so far.

import { angleWithin } from './angle';
import { boxOf } from './bounds';
import type { Curve } from './curves';
import { argmin } from './numeric';
import { flattenPiece, pieceEval, piecesOf, toCurveParam, type Piece } from './pieces';
import type { Tolerance } from './tolerance';
import { add, angleOf, distance, dot, length, scale, sub } from './vec';
import type { Vec2 } from './types';

export interface ClosestPoint {
  readonly point: Vec2;
  /** Parameter on the curve. */
  readonly t: number;
  readonly distance: number;
}

type Local = { s: number; point: Vec2; d: number };

const at = (pc: Piece, s: number, p: Vec2): Local => {
  const point = pieceEval(pc, s)[0];
  return { s, point, d: distance(point, p) };
};

function closestOnPiece(pc: Piece, p: Vec2, tol: Tolerance): Local {
  switch (pc.kind) {
    case 'linear': {
      const dd = dot(pc.d, pc.d);
      const s = dd === 0 ? 0 : dot(sub(p, pc.p), pc.d) / dd;
      return at(pc, Math.min(pc.s1, Math.max(pc.s0, s)), p);
    }
    case 'circular': {
      const rel = sub(p, pc.c);
      if (length(rel) > 0) {
        const lo = pc.sweep >= 0 ? pc.a0 : pc.a0 + pc.sweep;
        const th = angleWithin(angleOf(rel), lo, Math.abs(pc.sweep), tol);
        if (th !== undefined) return at(pc, (th - pc.a0) / pc.sweep, p);
      }
      // Outside the sweep (or at the centre): the nearer end.
      const s0 = at(pc, 0, p);
      const s1 = at(pc, 1, p);
      return s1.d < s0.d ? s1 : s0;
    }
    case 'elliptic':
    case 'spline': {
      // Sample relative to the piece's own extent (not its distance from the origin).
      const b = boxOf(flattenPiece(pc, Infinity).points);
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      const dev = Math.max(tol.linear, 1e-4 * size);
      const { s, points } = flattenPiece(pc, dev);
      // Branch and bound over the chords: the curve stays within dev of each chord, so a chord
      // farther than the best distance so far (plus a margin) cannot hold the minimum. Chords
      // are searched nearest first, each by golden section on the true curve.
      const spans = s.slice(1).map((s1, k) => ({
        lo: s[k]!,
        hi: s1,
        bound: distanceToSegment(p, points[k]!, points[k + 1]!) - 2 * dev,
      }));
      spans.sort((x, y) => x.bound - y.bound);
      let best = at(pc, s[0]!, p);
      for (const span of spans) {
        if (span.bound >= best.d) break;
        const m = argmin((u) => distance(pieceEval(pc, u)[0], p), span.lo, span.hi);
        if (m.fx < best.d) best = at(pc, m.x, p);
      }
      return best;
    }
  }
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const dd = dot(d, d);
  const f = dd === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / dd));
  return length(sub(p, add(a, scale(d, f))));
}

export function closestPoint(c: Curve, p: Vec2, tol: Tolerance): ClosestPoint {
  let best: ClosestPoint | undefined;
  for (const pc of piecesOf(c)) {
    const l = closestOnPiece(pc, p, tol);
    if (!best || l.d < best.distance)
      best = { point: l.point, t: toCurveParam(pc, l.s), distance: l.d };
  }
  if (!best) throw new Error(`${c.kind} has no geometry`);
  return best;
}
