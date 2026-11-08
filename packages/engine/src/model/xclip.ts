// XCLIP (M1-103): where a SPATIAL_FILTER clips its block reference, in the block's coordinates.
//
// The boundary is stored where the reference stood when XCLIP made it; the filter's first matrix
// is the inverse of that insert transform (DXF reference, SPATIAL_FILTER: "the inverse of the
// original block reference (insert entity) transformation"), so it takes the boundary into the
// block, where every later placement of the reference carries it. The boundary's plane (210, 11)
// and its own transform (the second matrix) are the defaults in every corpus sample and are not
// applied, as ezdxf's `XClip.get_block_clipping_path` does not apply them either.

import type { Vec2 } from '../geom/types';
import type { Matrix3x4, SpatialFilter } from './types';

/** A 2D point through rows x and y of a 3×4 matrix, at z 0. */
function apply(m: Matrix3x4, p: Vec2): Vec2 {
  return {
    x: m[0]! * p.x + m[1]! * p.y + m[3]!,
    y: m[4]! * p.x + m[5]! * p.y + m[7]!,
  };
}

/**
 * The closed polygon a filter clips its reference's block to, in block coordinates: two points
 * are the rectangle on those corners (counter-clockwise from the lower left). Undefined when the
 * boundary encloses nothing (under two points, or a rectangle without area).
 */
export function clipBoundary(filter: SpatialFilter): Vec2[] | undefined {
  let points = filter.boundary;
  if (points.length < 2) return undefined;
  if (points.length === 2) {
    const [a, b] = points as readonly [Vec2, Vec2];
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    if (!(x1 > x0 && y1 > y0)) return undefined;
    points = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  return points.map((p) => apply(filter.inverseInsert, p));
}
