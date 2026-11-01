// What area of the plan an entity can draw on, for the spatial index (M1-07). A box always
// contains everything the entity draws, so a query never misses it; it may be looser than the
// shape (a rotated block's extents box), never tighter.
//
// Text has no box here: widths must be exact (opentype.js or stroke-font metrics, CLAUDE.md),
// and the engine cannot see fonts. Text and annotations are "unknown", which queries always
// return, until the caller injects exact bounds through `annotationBounds` (wired up when the
// text engine lands, roadmap M1-35).

import { boxOf, curveBounds, unionBox, type Box } from '../geom/bounds';
import type { Polyline } from '../geom/curves';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  DimensionGeometry,
  EntityGeometry,
  InsertAttribute,
  InsertGeometry,
  LeaderGeometry,
  MTextGeometry,
  PolylineVertex,
  TextGeometry,
  ToleranceGeometry,
} from '../model/types';

export type EntityBounds =
  /** Everything the entity draws lies inside `box`. */
  | { readonly kind: 'box'; readonly box: Box }
  /** XLINE (`ray` false) or RAY: tested against a query exactly, as a line. */
  | {
      readonly kind: 'infinite';
      readonly base: Vec2;
      readonly direction: Vec2;
      readonly ray: boolean;
    }
  /** Extent not known to the engine (text without metrics): every query returns it. */
  | { readonly kind: 'unknown' }
  /** Draws nothing (a polyline without vertices): no query returns it. */
  | { readonly kind: 'empty' };

/** Geometry whose extent depends on text layout, dimension styles or arrowheads. */
export type AnnotationGeometry =
  | TextGeometry
  | MTextGeometry
  | AttdefGeometry
  | ToleranceGeometry
  | LeaderGeometry
  | DimensionGeometry
  | InsertAttribute;

/** Exact bounds for annotation geometry, or undefined when the provider cannot tell. */
export type AnnotationBounds = (geom: AnnotationGeometry) => Box | undefined;

export interface BoundsContext {
  readonly tol: Tolerance;
  /**
   * The extents of a block's contents in its own coordinates: `EMPTY_BOX` when it draws
   * nothing, 'unknown' when any of its contents is, undefined when there is no such block.
   */
  blockExtents(block: Handle): Box | 'unknown' | undefined;
  /** A block's base point; the origin when not given. */
  basePoint?(block: Handle): Vec2 | undefined;
  readonly annotationBounds?: AnnotationBounds | undefined;
}

const UNKNOWN: EntityBounds = Object.freeze({ kind: 'unknown' });
const EMPTY: EntityBounds = Object.freeze({ kind: 'empty' });
const boxed = (box: Box): EntityBounds => ({ kind: 'box', box });
const isEmptyBox = (b: Box): boolean => b.minX > b.maxX || b.minY > b.maxY;

const pad = (b: Box, d: number): Box =>
  d > 0 ? { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d } : b;

/**
 * A polyline's box, grown by half its widest segment. Mitred joins of very sharp turns in a
 * wide polyline can reach a little further; the renderer task that draws widths owns that.
 */
function polylineBounds(
  vertices: readonly PolylineVertex[],
  closed: boolean,
  halfWidth: number,
  tol: Tolerance,
): EntityBounds {
  if (vertices.length === 0) return EMPTY;
  const kernel: Polyline = { kind: 'LWPOLYLINE', vertices, closed };
  const b = vertices.length === 1 ? boxOf(vertices) : curveBounds(kernel, tol);
  return boxed(pad(b, halfWidth));
}

function maxWidth(vertices: readonly PolylineVertex[], start = 0, end = 0, constant = 0): number {
  let w = constant;
  for (const v of vertices) w = Math.max(w, v.startWidth ?? start, v.endWidth ?? end);
  return w;
}

function annotation(geom: AnnotationGeometry, ctx: BoundsContext): Box | undefined {
  return ctx.annotationBounds?.(geom);
}

/**
 * INSERT/MINSERT: the block's extents relative to its base point, scaled, spread over the
 * array cells (which step along the rotated but unscaled axes), rotated and moved to the
 * insertion point; the four corners of that box bound it. Visible attributes add their own
 * (injected) bounds; ATTRIB positions are already in plan coordinates.
 */
function insertBounds(geom: InsertGeometry, ctx: BoundsContext): EntityBounds {
  const ext = ctx.blockExtents(geom.block);
  if (ext === 'unknown') return UNKNOWN;
  let out: Box;
  if (ext === undefined || isEmptyBox(ext)) {
    // Nothing to draw (or an unresolved block AUDIT would flag): the insertion point stands in.
    out = boxOf([geom.position]);
  } else {
    const base = ctx.basePoint?.(geom.block) ?? { x: 0, y: 0 };
    const { x: sx, y: sy } = geom.scale;
    const xs = [(ext.minX - base.x) * sx, (ext.maxX - base.x) * sx];
    const ys = [(ext.minY - base.y) * sy, (ext.maxY - base.y) * sy];
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    if (geom.array) {
      const dx = Math.max(0, geom.array.columns - 1) * geom.array.columnSpacing;
      const dy = Math.max(0, geom.array.rows - 1) * geom.array.rowSpacing;
      x0 += Math.min(0, dx);
      x1 += Math.max(0, dx);
      y0 += Math.min(0, dy);
      y1 += Math.max(0, dy);
    }
    const cos = Math.cos(geom.rotation);
    const sin = Math.sin(geom.rotation);
    const at = (x: number, y: number): Vec2 => ({
      x: geom.position.x + x * cos - y * sin,
      y: geom.position.y + x * sin + y * cos,
    });
    out = boxOf([at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)]);
  }
  for (const attr of geom.attributes) {
    if (attr.flags & 1) continue; // DXF 70 bit 1: invisible
    const b = annotation(attr, ctx);
    if (b === undefined) return UNKNOWN;
    out = unionBox(out, b);
  }
  return boxed(out);
}

export function entityBounds(geom: EntityGeometry, ctx: BoundsContext): EntityBounds {
  switch (geom.kind) {
    case 'LINE':
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
    case 'SPLINE':
      return boxed(curveBounds(geom, ctx.tol));
    case 'XLINE':
    case 'RAY': {
      const len = Math.hypot(geom.direction.x, geom.direction.y);
      if (len === 0) return boxed(boxOf([geom.base]));
      return {
        kind: 'infinite',
        base: geom.base,
        direction: { x: geom.direction.x / len, y: geom.direction.y / len },
        ray: geom.kind === 'RAY',
      };
    }
    case 'POINT':
      return boxed(boxOf([geom.position]));
    case 'LWPOLYLINE':
      return polylineBounds(
        geom.vertices,
        geom.closed,
        maxWidth(geom.vertices, 0, 0, geom.constantWidth) / 2,
        ctx.tol,
      );
    case 'POLYLINE': {
      // A 3D polyline is straight segments in plan, whatever bulges the vertices carry.
      const vertices = geom.is3d ? geom.vertices.map((v) => ({ ...v, bulge: 0 })) : geom.vertices;
      const half = maxWidth(geom.vertices, geom.startWidth, geom.endWidth) / 2;
      return polylineBounds(vertices, geom.closed, half, ctx.tol);
    }
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      return boxed(boxOf(geom.corners));
    case 'TEXT':
    case 'MTEXT':
    case 'ATTDEF':
    case 'TOLERANCE':
    case 'LEADER': {
      const b = annotation(geom, ctx);
      return b ? boxed(b) : UNKNOWN;
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION': {
      const b = annotation(geom, ctx);
      if (b) return boxed(b);
      // The *D block holds the dimension as last drawn, in plan coordinates (no transform).
      const ext = geom.block === undefined ? undefined : ctx.blockExtents(geom.block);
      return ext === undefined || ext === 'unknown' || isEmptyBox(ext) ? UNKNOWN : boxed(ext);
    }
    case 'INSERT':
      return insertBounds(geom, ctx);
  }
}
