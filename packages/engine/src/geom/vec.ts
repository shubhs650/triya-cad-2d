// 2D vector algebra on plain `{x, y}` values. Every function returns a new value.

import type { Tolerance } from './tolerance';
import type { Vec2 } from './types';

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z of the 3D cross product: > 0 when b is counter-clockwise from a. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
/** a turned 90° counter-clockwise. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  if (l === 0) throw new Error('cannot normalise a zero-length vector');
  return { x: a.x / l, y: a.y / l };
}

/** Direction angle in [0, 2π), counter-clockwise from +X. */
export function angleOf(a: Vec2): number {
  const t = Math.atan2(a.y, a.x);
  return t < 0 ? t + 2 * Math.PI : t;
}

export const fromAngle = (theta: number, r = 1): Vec2 => ({
  x: r * Math.cos(theta),
  y: r * Math.sin(theta),
});

export function rotate(a: Vec2, theta: number): Vec2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const rotateAbout = (p: Vec2, center: Vec2, theta: number): Vec2 =>
  add(center, rotate(sub(p, center), theta));

export const pointsEqual = (a: Vec2, b: Vec2, tol: Tolerance): boolean =>
  distance(a, b) <= tol.linear;
