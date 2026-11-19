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
 * `points` as a closed polygon: two points are the rectangle on those corners (counter-clockwise
 * from the lower left). Undefined under two points or for a rectangle without area.
 */
function closedPolygon(points: readonly Vec2[]): Vec2[] | undefined {
  if (points.length < 2) return undefined;
  if (points.length > 2) return [...points];
  const [a, b] = points as readonly [Vec2, Vec2];
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (!(x1 > x0 && y1 > y0)) return undefined;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * The closed polygon a filter clips its reference's block to, in block coordinates: two points
 * are the rectangle on those corners (counter-clockwise from the lower left). Undefined when the
 * boundary encloses nothing (under two points, or a rectangle without area).
 *
 * An inverted clip shows everything but the inside of its inner boundary. The region is cut out
 * of the stored bounds grown by their own size on every side, so what the block grew to since it
 * was clipped still shows, as AutoCAD shows it (AutoCAD's own fallback boundary is not always the
 * region: on ezdxf's xclip.dxf one leaves its concave inner boundary out).
 */
export function clipBoundary(filter: SpatialFilter): Vec2[] | undefined {
  const region = filter.inverted
    ? invertedRegion(filter, filter.inverted)
    : closedPolygon(filter.boundary);
  return region?.map((p) => apply(filter.inverseInsert, p));
}

/**
 * The boundary the drafter drew, in block coordinates: an inverted clip's inner boundary,
 * otherwise `clipBoundary`'s polygon. What XCLIPFRAME shows and generate Polyline draws.
 */
export function clipFrame(filter: SpatialFilter): Vec2[] | undefined {
  return closedPolygon(filter.inverted ?? filter.boundary)?.map((p) =>
    apply(filter.inverseInsert, p),
  );
}

function invertedRegion(filter: SpatialFilter, inverted: readonly Vec2[]): Vec2[] | undefined {
  const inner = closedPolygon(inverted);
  if (!inner || inner.length < 3) return undefined;
  const all = [...filter.boundary, ...inner];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const box = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
  const grow = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  return invertedBoundary(inner, {
    minX: box.minX - grow,
    minY: box.minY - grow,
    maxX: box.maxX + grow,
    maxY: box.maxY + grow,
  });
}

/**
 * An inverted clip's region as one polygon: the rectangle `outer` counter-clockwise with the
 * closed `inner` boundary (two points for a rectangle) cut out clockwise, joined by a slit of no
 * width, as AutoCAD stores an inverted clip's boundary for readers that know no inverted clip
 * (DXF SPATIAL_FILTER 10s on ezdxf's xclip.dxf: 11 points around a rectangle). Nonzero winding
 * then fills the ring and leaves the inside out. The slit runs from the inner vertex nearest a
 * side of `outer` straight to it: an extreme vertex, so it crosses none of the inner edges (ties
 * go to the first side counter-clockwise from the bottom, then the first vertex clockwise).
 * `inner` must lie inside `outer`.
 */
export function invertedBoundary(
  inner: readonly Vec2[],
  outer: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
): Vec2[] {
  const ring = closedPolygon(inner) ?? [...inner];
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  const cw = area2 > 0 ? [...ring].reverse() : ring;
  const corners: Vec2[] = [
    { x: outer.minX, y: outer.minY },
    { x: outer.maxX, y: outer.minY },
    { x: outer.maxX, y: outer.maxY },
    { x: outer.minX, y: outer.maxY },
  ];
  // Side k runs from corners[k] to corners[k + 1]: bottom, right, top, left.
  const distance = [
    (p: Vec2) => p.y - outer.minY,
    (p: Vec2) => outer.maxX - p.x,
    (p: Vec2) => outer.maxY - p.y,
    (p: Vec2) => p.x - outer.minX,
  ];
  const foot = [
    (p: Vec2) => ({ x: p.x, y: outer.minY }),
    (p: Vec2) => ({ x: outer.maxX, y: p.y }),
    (p: Vec2) => ({ x: p.x, y: outer.maxY }),
    (p: Vec2) => ({ x: outer.minX, y: p.y }),
  ];
  let side = 0;
  let at = 0;
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < cw.length; i++) {
      const d = distance[k]!(cw[i]!);
      if (d < best) {
        best = d;
        side = k;
        at = i;
      }
    }
  }
  const start = cw[at]!;
  const q = foot[side]!(start);
  const out: Vec2[] = [q];
  for (let k = 1; k <= 4; k++) out.push(corners[(side + k) % 4]!);
  out.push(q);
  for (let i = 0; i <= cw.length; i++) out.push(cw[(at + i) % cw.length]!);
  return out.map((p) => ({ x: p.x + 0, y: p.y + 0 }));
}
