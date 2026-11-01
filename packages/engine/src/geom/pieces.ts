// Curves decomposed into the pieces the algorithms work on: linear, circular, elliptic or
// spline. A polyline is one piece per segment. Each piece has a local parameter s and maps
// back to the curve's own parameter as t = t0 + tk·s.

import type { Curve, Spline } from './curves';
import { arcSweep, ellipseAxes, ellipseSweep, polylineSegment, polylineSegmentCount } from './eval';
import { arcSteps, flatten } from './flatten';
import { splineDerivatives, splineDomain } from './nurbs';
import { add, fromAngle, length, normalize, scale, sub } from './vec';
import type { Vec2 } from './types';
import { TAU } from './angle';

interface PieceBase {
  /** Local parameter range. */
  readonly s0: number;
  readonly s1: number;
  /** Curve parameter t = t0 + tk·s. */
  readonly t0: number;
  readonly tk: number;
}

/** p + s·d. */
export interface LinearPiece extends PieceBase {
  readonly kind: 'linear';
  readonly p: Vec2;
  readonly d: Vec2;
}

/** c + r·(cos θ, sin θ), θ = a0 + s·sweep, s ∈ [0, 1]; sweep is signed (< 0 is clockwise). */
export interface CircularPiece extends PieceBase {
  readonly kind: 'circular';
  readonly c: Vec2;
  readonly r: number;
  readonly a0: number;
  readonly sweep: number;
}

/** c + A cos u + B sin u, u = u0 + s·sweep, s ∈ [0, 1]; B is CCW of A. */
export interface EllipticPiece extends PieceBase {
  readonly kind: 'elliptic';
  readonly c: Vec2;
  readonly A: Vec2;
  readonly B: Vec2;
  readonly u0: number;
  readonly sweep: number;
}

/** The spline itself, s = t. */
export interface SplinePiece extends PieceBase {
  readonly kind: 'spline';
  readonly spline: Spline;
}

export type Piece = LinearPiece | CircularPiece | EllipticPiece | SplinePiece;

export function piecesOf(c: Curve): Piece[] {
  switch (c.kind) {
    case 'LINE':
      return [{ kind: 'linear', p: c.start, d: sub(c.end, c.start), s0: 0, s1: 1, t0: 0, tk: 1 }];
    case 'RAY':
    case 'XLINE':
      return [
        {
          kind: 'linear',
          p: c.base,
          d: normalize(c.direction),
          s0: c.kind === 'RAY' ? 0 : -Infinity,
          s1: Infinity,
          t0: 0,
          tk: 1,
        },
      ];
    case 'CIRCLE':
      return [
        {
          kind: 'circular',
          c: c.center,
          r: c.radius,
          a0: 0,
          sweep: TAU,
          s0: 0,
          s1: 1,
          t0: 0,
          tk: TAU,
        },
      ];
    case 'ARC': {
      const sweep = arcSweep(c);
      return [
        {
          kind: 'circular',
          c: c.center,
          r: c.radius,
          a0: c.startAngle,
          sweep,
          s0: 0,
          s1: 1,
          t0: c.startAngle,
          tk: sweep,
        },
      ];
    }
    case 'ELLIPSE': {
      const { major, minor } = ellipseAxes(c);
      const sweep = ellipseSweep(c);
      return [
        {
          kind: 'elliptic',
          c: c.center,
          A: major,
          B: minor,
          u0: c.startParam,
          sweep,
          s0: 0,
          s1: 1,
          t0: c.startParam,
          tk: sweep,
        },
      ];
    }
    case 'LWPOLYLINE': {
      const out: Piece[] = [];
      for (let i = 0; i < polylineSegmentCount(c); i++) {
        const seg = polylineSegment(c, i);
        if ('line' in seg) {
          out.push({
            kind: 'linear',
            p: seg.line.a,
            d: sub(seg.line.b, seg.line.a),
            s0: 0,
            s1: 1,
            t0: i,
            tk: 1,
          });
        } else {
          const { center, radius, startAngle, sweep } = seg.arc;
          out.push({
            kind: 'circular',
            c: center,
            r: radius,
            a0: startAngle,
            sweep,
            s0: 0,
            s1: 1,
            t0: i,
            tk: 1,
          });
        }
      }
      return out;
    }
    case 'SPLINE': {
      const d = splineDomain(c);
      return [{ kind: 'spline', spline: c, s0: d.start, s1: d.end, t0: 0, tk: 1 }];
    }
  }
}

/** Point, first and second derivative with respect to s. */
export function pieceEval(pc: Piece, s: number): [Vec2, Vec2, Vec2] {
  switch (pc.kind) {
    case 'linear':
      return [add(pc.p, scale(pc.d, s)), pc.d, { x: 0, y: 0 }];
    case 'circular': {
      const th = pc.a0 + s * pc.sweep;
      const k = pc.sweep;
      return [
        add(pc.c, fromAngle(th, pc.r)),
        fromAngle(th + Math.PI / 2, pc.r * k),
        fromAngle(th + Math.PI, pc.r * k * k),
      ];
    }
    case 'elliptic': {
      const u = pc.u0 + s * pc.sweep;
      const k = pc.sweep;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const rel = add(scale(pc.A, cu), scale(pc.B, su));
      return [add(pc.c, rel), scale(add(scale(pc.A, -su), scale(pc.B, cu)), k), scale(rel, -k * k)];
    }
    case 'spline': {
      const [p, d1, d2] = splineDerivatives(pc.spline, s, 2);
      return [p!, d1!, d2!];
    }
  }
}

export const piecePoint = (pc: Piece, s: number): Vec2 => pieceEval(pc, s)[0];

/** Samples of a bounded piece whose chords stay within `dev` (linear pieces must be finite). */
export function flattenPiece(pc: Piece, dev: number): { s: number[]; points: Vec2[] } {
  let n: number;
  switch (pc.kind) {
    case 'linear':
      n = 1;
      break;
    case 'circular':
      n = arcSteps(pc.r, pc.sweep, dev);
      break;
    case 'elliptic':
      n = arcSteps(Math.max(length(pc.A), length(pc.B)), pc.sweep, dev);
      break;
    case 'spline': {
      const f = flatten(pc.spline, dev);
      return { s: f.params, points: f.points };
    }
  }
  const s: number[] = [];
  const points: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const sk = k === n ? pc.s1 : pc.s0 + ((pc.s1 - pc.s0) * k) / n;
    s.push(sk);
    points.push(piecePoint(pc, sk));
  }
  return { s, points };
}

/** Curve parameter of local parameter s. */
export const toCurveParam = (pc: Piece, s: number): number => pc.t0 + pc.tk * s;
