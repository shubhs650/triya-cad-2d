// The tolerance model (ARCHITECTURE.md §4.1: "a document-level epsilon derived from extents,
// never a hard-coded 1e-6").
//
// A double carries ~16 significant digits, so the precision of a coordinate depends on its
// magnitude: a drawing that sits 1e6 units from the origin cannot resolve 1e-12. The linear
// tolerance is therefore relative to the largest magnitude in the drawing (coordinate or
// extent), with a floor of 1 drawing unit so tiny drawings are not held to sub-ULP precision.
// 1e-10 relative leaves ~5 digits of headroom for error accumulated through a few operations,
// and matches the default equal-point tolerance AutoCAD's geometry library uses for unit-scale
// data. The angular tolerance is dimensionless, so it is the relative epsilon itself.

import type { Vec2 } from './types';

export interface Tolerance {
  /** Two points closer than this are the same point (drawing units). */
  readonly linear: number;
  /** Two directions closer than this are the same direction (radians). */
  readonly angular: number;
}

export const RELATIVE_EPSILON = 1e-10;

/** Tolerance for geometry whose coordinates and sizes are at most `magnitude`. */
export function toleranceForSize(magnitude: number): Tolerance {
  const m = Number.isFinite(magnitude) && magnitude > 1 ? magnitude : 1;
  return { linear: m * RELATIVE_EPSILON, angular: RELATIVE_EPSILON };
}

/**
 * Tolerance for a drawing with the given extents (`$EXTMIN`/`$EXTMAX`). Empty extents, which
 * AutoCAD writes as min = 1e20, max = -1e20, give the unit-size tolerance.
 */
export function toleranceFromExtents(min: Vec2, max: Vec2): Tolerance {
  if (!(min.x <= max.x && min.y <= max.y)) return toleranceForSize(1);
  return toleranceForSize(
    Math.max(
      Math.abs(min.x),
      Math.abs(min.y),
      Math.abs(max.x),
      Math.abs(max.y),
      max.x - min.x,
      max.y - min.y,
    ),
  );
}
