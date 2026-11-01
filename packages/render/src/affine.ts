// 2D affine maps and packed paths carried through them (M1-14), shared by block references
// and text glyphs (M1-41).

import type { Vec2 } from '@triya/engine';
import { PATH_A, PATH_C, PATH_E, PATH_L, PATH_M, PATH_Q, PATH_Z } from './types';

/** x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: Affine, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** `m` after `n`: applying the result is applying `n`, then `m`. */
export function composeAffine(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** How much a transform stretches lengths: the square root of its area scale. */
export const affineScale = (m: Affine): number => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

/**
 * An ellipse arc through a transform, as an exact ellipse arc. The image of
 * P(t) = C + U cos t + V sin t is C' + U' cos t + V' sin t with conjugate half-diameters
 * U' = L·U, V' = L·V; its axes are where |P − C'| is extreme, at
 * tan 2t₀ = 2 U'·V' / (|U'|² − |V'|²).
 */
function ellipseThrough(
  m: Affine,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  a0: number,
  a1: number,
  ccw: number,
): number[] {
  const ux = rx * Math.cos(rot);
  const uy = rx * Math.sin(rot);
  const vx = -ry * Math.sin(rot);
  const vy = ry * Math.cos(rot);
  const Ux = m.a * ux + m.c * uy;
  const Uy = m.b * ux + m.d * uy;
  const Vx = m.a * vx + m.c * vy;
  const Vy = m.b * vx + m.d * vy;
  const t0 = 0.5 * Math.atan2(2 * (Ux * Vx + Uy * Vy), Ux * Ux + Uy * Uy - (Vx * Vx + Vy * Vy));
  const Ax = Ux * Math.cos(t0) + Vx * Math.sin(t0);
  const Ay = Uy * Math.cos(t0) + Vy * Math.sin(t0);
  const Bx = -Ux * Math.sin(t0) + Vx * Math.cos(t0);
  const By = -Uy * Math.sin(t0) + Vy * Math.cos(t0);
  const c = applyAffine(m, { x: cx, y: cy });
  // B is A turned +90° unless the transform mirrors; then the parameter runs backwards.
  const flip = Ax * By - Ay * Bx < 0;
  const p0 = flip ? t0 - a0 : a0 - t0;
  const p1 = flip ? t0 - a1 : a1 - t0;
  return [
    PATH_E,
    c.x,
    c.y,
    Math.hypot(Ax, Ay),
    Math.hypot(Bx, By),
    Math.atan2(Ay, Ax),
    p0,
    p1,
    flip ? 1 - ccw : ccw,
  ];
}

/** Packed path commands through a transform; arcs stay arcs under similarity, else ellipses. */
export function transformPath(path: readonly number[], m: Affine): number[] {
  const out: number[] = [];
  const det = m.a * m.d - m.b * m.c;
  // Rotation and uniform scale (a = d, b = −c) or the same with a mirror (a = −d, b = c).
  const tol = 1e-12 * (Math.abs(m.a) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d));
  const similar =
    det > 0
      ? Math.abs(m.a - m.d) <= tol && Math.abs(m.b + m.c) <= tol
      : Math.abs(m.a + m.d) <= tol && Math.abs(m.b - m.c) <= tol;
  const s = Math.sqrt(Math.abs(det));
  const phi = Math.atan2(m.b, m.a);
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    switch (op) {
      case PATH_M:
      case PATH_L: {
        const p = applyAffine(m, { x: path[i + 1]!, y: path[i + 2]! });
        out.push(op, p.x, p.y);
        i += 3;
        break;
      }
      case PATH_A: {
        const [cx, cy, r, a0, a1, ccw] = [
          path[i + 1]!,
          path[i + 2]!,
          path[i + 3]!,
          path[i + 4]!,
          path[i + 5]!,
          path[i + 6]!,
        ];
        if (similar) {
          const c = applyAffine(m, { x: cx, y: cy });
          // A turn adds φ to every angle; a mirror (reflection, then turn by φ) maps t to φ − t
          // and reverses the direction.
          if (det > 0) out.push(PATH_A, c.x, c.y, r * s, a0 + phi, a1 + phi, ccw);
          else out.push(PATH_A, c.x, c.y, r * s, phi - a0, phi - a1, 1 - ccw);
        } else {
          out.push(...ellipseThrough(m, cx, cy, r, r, 0, a0, a1, ccw));
        }
        i += 7;
        break;
      }
      case PATH_E:
        out.push(
          ...ellipseThrough(
            m,
            path[i + 1]!,
            path[i + 2]!,
            path[i + 3]!,
            path[i + 4]!,
            path[i + 5]!,
            path[i + 6]!,
            path[i + 7]!,
            path[i + 8]!,
          ),
        );
        i += 9;
        break;
      case PATH_Q:
      case PATH_C: {
        // A Bézier's image is the Bézier of its control points' images.
        const n = op === PATH_Q ? 2 : 3;
        out.push(op);
        for (let k = 0; k < n; k++) {
          const p = applyAffine(m, { x: path[i + 1 + 2 * k]!, y: path[i + 2 + 2 * k]! });
          out.push(p.x, p.y);
        }
        i += 1 + 2 * n;
        break;
      }
      case PATH_Z:
        out.push(PATH_Z);
        i += 1;
        break;
      default:
        throw new Error(`bad path command ${op} at ${i}`);
    }
  }
  return out;
}
