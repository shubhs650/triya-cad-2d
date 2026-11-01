// 2D affine transforms and their action on curves.
//
// Matrix2D uses the canvas/SVG convention: x' = a·x + c·y + e, y' = b·x + d·y + f.

import { normalizeAngle, TAU } from './angle';
import type { Curve, Ellipse } from './curves';
import { arcSweep, ellipseAxes, ellipseSweep } from './eval';
import type { Tolerance } from './tolerance';
import { add, angleOf, cross, dot, length, normalize, scale, sub } from './vec';
import type { Vec2 } from './types';

export interface Matrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix2D = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const translation = (dx: number, dy: number): Matrix2D => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: dx,
  f: dy,
});

/** `n` after `m`. */
function then(m: Matrix2D, n: Matrix2D): Matrix2D {
  return {
    a: n.a * m.a + n.c * m.b,
    b: n.b * m.a + n.d * m.b,
    c: n.a * m.c + n.c * m.d,
    d: n.b * m.c + n.d * m.d,
    e: n.a * m.e + n.c * m.f + n.e,
    f: n.b * m.e + n.d * m.f + n.f,
  };
}

/** Applies the matrices left to right: compose(A, B) maps p to B(A(p)). */
export function compose(...ms: Matrix2D[]): Matrix2D {
  return ms.reduce(then, IDENTITY);
}

const about = (m: Matrix2D, p: Vec2 | undefined): Matrix2D =>
  p ? compose(translation(-p.x, -p.y), m, translation(p.x, p.y)) : m;

export function rotation(theta: number, center?: Vec2): Matrix2D {
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  return about({ a: cs, b: sn, c: -sn, d: cs, e: 0, f: 0 }, center);
}

export function scaling(sx: number, sy = sx, center?: Vec2): Matrix2D {
  return about({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, center);
}

/** Reflection in the line through p1 and p2 (MIRROR). */
export function mirror(p1: Vec2, p2: Vec2): Matrix2D {
  if (p1.x === p2.x && p1.y === p2.y) throw new Error('a mirror line needs two distinct points');
  const u = normalize(sub(p2, p1));
  const cos2 = u.x * u.x - u.y * u.y;
  const sin2 = 2 * u.x * u.y;
  return about({ a: cos2, b: sin2, c: sin2, d: -cos2, e: 0, f: 0 }, p1);
}

export const determinant = (m: Matrix2D): number => m.a * m.d - m.b * m.c;

export function invert(m: Matrix2D): Matrix2D {
  const det = determinant(m);
  if (det === 0 || !Number.isFinite(det)) throw new Error('matrix is singular');
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export const applyPoint = (m: Matrix2D, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});

export const applyVector = (m: Matrix2D, v: Vec2): Vec2 => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
});

/** The uniform scale factor if `m` is a similarity (rotation/mirror + uniform scale + move). */
export function similarityScale(m: Matrix2D, tol: Tolerance): number | undefined {
  const l1 = Math.hypot(m.a, m.b);
  const l2 = Math.hypot(m.c, m.d);
  const orthogonal = Math.abs(m.a * m.c + m.b * m.d) <= tol.angular * l1 * l2;
  const uniform = Math.abs(l1 - l2) <= tol.angular * Math.max(l1, l2);
  return orthogonal && uniform ? l1 : undefined;
}

/** An ellipse under a general affine map (also used for circles and arcs that stop being circular). */
function transformEllipse(e: Ellipse, m: Matrix2D): Ellipse {
  const { major, minor } = ellipseAxes(e);
  const sweep = ellipseSweep(e);
  // The image is c' + p cos u + q sin u with conjugate semi-diameters p, q. Its squared
  // radius (p² + q²)/2 + ((p² − q²)/2)·cos 2u + p·q·sin 2u peaks at 2u0 = atan2(2p·q, p² − q²),
  // so X(u0) is the major semi-axis and X(u0 + π/2) the minor one.
  const p = applyVector(m, major);
  const q = applyVector(m, minor);
  const u0 = 0.5 * Math.atan2(2 * dot(p, q), dot(p, p) - dot(q, q));
  const at = (u: number): Vec2 => add(scale(p, Math.cos(u)), scale(q, Math.sin(u)));
  const A = at(u0);
  const Q = at(u0 + Math.PI / 2);
  // p cos u + q sin u = A cos(u − u0) + Q sin(u − u0). If Q is CCW of A the parameter just
  // shifts; otherwise (a mirror) it runs backwards, v = u0 − u, and the ends swap.
  const forward = cross(A, Q) > 0;
  const start = forward ? e.startParam - u0 : u0 - (e.startParam + sweep);
  return {
    kind: 'ELLIPSE',
    center: applyPoint(m, e.center),
    majorAxis: A,
    ratio: Math.min(1, length(Q) / length(A)),
    startParam: start,
    endParam: start + sweep,
  };
}

/**
 * The image of a curve under `m`. Kinds are kept where the geometry allows; circles and arcs
 * become ellipses under non-uniform scale (as AutoCAD does when exploding a non-uniformly
 * scaled block). A polyline with arcs cannot be scaled non-uniformly and throws.
 */
export function transformCurve(c: Curve, m: Matrix2D, tol: Tolerance): Curve {
  const det = determinant(m);
  if (det === 0 || !Number.isFinite(det)) throw new Error('cannot transform by a singular matrix');
  const s = similarityScale(m, tol);
  switch (c.kind) {
    case 'LINE':
      return { kind: 'LINE', start: applyPoint(m, c.start), end: applyPoint(m, c.end) };
    case 'RAY':
    case 'XLINE':
      return { kind: c.kind, base: applyPoint(m, c.base), direction: applyVector(m, c.direction) };
    case 'CIRCLE':
      if (s !== undefined)
        return { kind: 'CIRCLE', center: applyPoint(m, c.center), radius: c.radius * s };
      return transformEllipse(
        {
          kind: 'ELLIPSE',
          center: c.center,
          majorAxis: { x: c.radius, y: 0 },
          ratio: 1,
          startParam: 0,
          endParam: TAU,
        },
        m,
      );
    case 'ARC': {
      const sweep = arcSweep(c);
      if (s === undefined) {
        return transformEllipse(
          {
            kind: 'ELLIPSE',
            center: c.center,
            majorAxis: { x: c.radius, y: 0 },
            ratio: 1,
            startParam: c.startAngle,
            endParam: c.startAngle + sweep,
          },
          m,
        );
      }
      // A rotation adds φ to every angle; a reflection maps θ to φ − θ and reverses the arc.
      const phi = angleOf(applyVector(m, { x: 1, y: 0 }));
      const start = det > 0 ? c.startAngle + phi : phi - (c.startAngle + sweep);
      return {
        kind: 'ARC',
        center: applyPoint(m, c.center),
        radius: c.radius * s,
        startAngle: normalizeAngle(start),
        endAngle: normalizeAngle(start) + sweep,
      };
    }
    case 'ELLIPSE':
      return transformEllipse(c, m);
    case 'LWPOLYLINE':
      if (s === undefined && c.vertices.some((v) => v.bulge !== 0)) {
        throw new Error('a non-uniform transform of a polyline with arcs is not a polyline');
      }
      return {
        kind: 'LWPOLYLINE',
        closed: c.closed,
        vertices: c.vertices.map((v) => {
          const q = applyPoint(m, v);
          return { x: q.x, y: q.y, bulge: det < 0 && v.bulge !== 0 ? -v.bulge : v.bulge };
        }),
      };
    case 'SPLINE': {
      const out = {
        kind: 'SPLINE' as const,
        degree: c.degree,
        knots: c.knots,
        controlPoints: c.controlPoints.map((p) => applyPoint(m, p)),
      };
      return c.weights ? { ...out, weights: c.weights } : out;
    }
  }
}
