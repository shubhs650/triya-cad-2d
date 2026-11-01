// Angles in radians, counter-clockwise from +X (AutoCAD's ANGBASE 0 / ANGDIR 0 convention;
// commands convert user angles at the prompt, the kernel never sees ANGBASE).

import type { Tolerance } from './tolerance';

export const TAU = 2 * Math.PI;

/** θ in [0, 2π). */
export function normalizeAngle(theta: number): number {
  const r = theta % TAU;
  const n = r < 0 ? r + TAU : r;
  // A tiny negative input rounds up to exactly 2π.
  return n >= TAU ? 0 : n;
}

/**
 * Counter-clockwise sweep from `start` to `end`, in (0, 2π]. Equal angles mean a full turn:
 * a DXF ARC from 0° to 360° or an ELLIPSE from 0 to 2π is closed, and AutoCAD has no
 * zero-length arcs.
 */
export function ccwSweep(start: number, end: number): number {
  const raw = end - start;
  // start + 2π can round to a hair above or below a full turn; that is still a full turn.
  // (A bound on floating-point rounding of the operands, not a geometric tolerance.)
  if (Math.abs(raw - TAU) <= 8 * Number.EPSILON * (Math.abs(start) + Math.abs(end) + TAU)) {
    return TAU;
  }
  const s = normalizeAngle(raw);
  return s === 0 ? TAU : s;
}

/**
 * If direction θ lies on the sweep [start, start + sweep] (within the angular tolerance),
 * returns it unwrapped into that interval (clamped to the ends); otherwise undefined.
 */
export function angleWithin(
  theta: number,
  start: number,
  sweep: number,
  tol: Tolerance,
): number | undefined {
  const d = normalizeAngle(theta - start);
  if (d <= sweep) return start + d;
  if (d <= sweep + tol.angular) return start + sweep;
  if (d >= TAU - tol.angular) return start;
  return undefined;
}
