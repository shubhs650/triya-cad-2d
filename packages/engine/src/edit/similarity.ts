// The transforms the core edit commands make (M2-06): MOVE, COPY, ROTATE, SCALE and MIRROR each
// carry objects by a similarity (a move, a turn, a uniform scale or a reflection, or a mix), so
// every object keeps its shape and only its place, direction and size change.
import { normalizeAngle, TAU } from '../geom/angle';
import {
  applyPoint,
  applyVector,
  compose,
  determinant,
  mirror,
  rotation,
  scaling,
  translation,
  type Matrix2D,
} from '../geom/transform';
import type { Vec2 } from '../geom/types';
import { angleOf, fromAngle } from '../geom/vec';

export interface Similarity {
  readonly m: Matrix2D;
  /** The uniform scale factor, > 0. */
  readonly scale: number;
  /** φ: the direction +X is carried to. */
  readonly angle: number;
  /** A reflection (MIRROR): directions are mirrored and turning senses reversed. */
  readonly reflect: boolean;
}

/** `m` as a similarity; throws for a matrix that shears, squashes or collapses. */
export function similarity(m: Matrix2D): Similarity {
  const det = determinant(m);
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  const ok =
    Number.isFinite(det) &&
    det !== 0 &&
    Math.abs(sx - sy) <= 1e-12 * sx &&
    Math.abs(m.a * m.c + m.b * m.d) <= 1e-12 * sx * sy;
  if (!ok) throw new Error('an edit transform must be a similarity');
  return { m, scale: sx, angle: angleOf({ x: m.a, y: m.b }), reflect: det < 0 };
}

export const moveBy = (d: Vec2): Similarity => similarity(translation(d.x, d.y));
export const turnAbout = (base: Vec2, angle: number): Similarity =>
  similarity(rotation(angle, base));
export const scaleAbout = (base: Vec2, k: number): Similarity => similarity(scaling(k, k, base));
export const mirrorIn = (p1: Vec2, p2: Vec2): Similarity => similarity(mirror(p1, p2));
/** `a`, then `b`. */
export const then = (a: Similarity, b: Similarity): Similarity => similarity(compose(a.m, b.m));

export const point = (t: Similarity, p: Vec2): Vec2 => applyPoint(t.m, p);
export const vector = (t: Similarity, v: Vec2): Vec2 => applyVector(t.m, v);

/** A unit direction carried along (scale removed). */
export const direction = (t: Similarity, v: Vec2): Vec2 => {
  const w = applyVector(t.m, v);
  return { x: w.x / t.scale, y: w.y / t.scale };
};

/**
 * An absolute direction angle carried along: turned by φ, or for a reflection mirrored to
 * φ − θ. A pure move or scale leaves it exactly as it was.
 */
export function angle(t: Similarity, theta: number): number {
  if (!t.reflect && t.angle === 0) return theta;
  return normalizeAngle(t.reflect ? t.angle - theta : theta + t.angle);
}

/**
 * How a mirrored frame (text, a table, an image, a block's rotation) is set upright again. A
 * reflection turns a frame at θ into a left-handed one whose x axis runs at φ − θ. Two
 * right-handed frames cover the same place: `x` keeps that x axis reversed (rotation φ − θ + π,
 * the frame's x extent flips: left and right swap) and `y` keeps it (rotation φ − θ, its y extent
 * flips: top and bottom swap). AutoCAD keeps mirrored text readable (MIRRTEXT 0) without
 * documenting which: the one whose direction stays nearer the original reads as the drafter
 * expects (a vertical mirror line swaps left and right, a horizontal one top and bottom); a tie
 * takes the direction that points more to the right, then up.
 */
export function upright(t: Similarity, theta: number): { flip: 'x' | 'y'; rotation: number } {
  const y = normalizeAngle(t.angle - theta);
  const x = normalizeAngle(y + Math.PI);
  const off = (a: number) => {
    const d = Math.abs(normalizeAngle(a - theta));
    return Math.min(d, TAU - d);
  };
  const dx = off(x);
  const dy = off(y);
  if (Math.abs(dx - dy) > 1e-9)
    return dx < dy ? { flip: 'x', rotation: x } : { flip: 'y', rotation: y };
  const ux = fromAngle(x);
  const uy = fromAngle(y);
  const xFirst = ux.x > uy.x + 1e-12 || (Math.abs(ux.x - uy.x) <= 1e-12 && ux.y > uy.y);
  return xFirst ? { flip: 'x', rotation: x } : { flip: 'y', rotation: y };
}
