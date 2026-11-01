// What area of the plan an entity can draw on, for the spatial index (M1-07). A box always
// contains everything the entity draws, so a query never misses it; it may be looser than the
// shape (a rotated block's extents box), never tighter.
//
// Text has no box here: widths must be exact (opentype.js or stroke-font metrics, CLAUDE.md),
// and the engine cannot see fonts. Text and annotations are "unknown", which queries always
// return, until the caller injects exact bounds through `annotationBounds` (the renderer's
// `textBounds`, M1-35). A MULTILEADER is the union of its parts (`multiLeaderParts`, M1-52),
// its text through that same provider.

import { boxOf, curveBounds, unionBox, type Box } from '../geom/bounds';
import type { Polyline, Spline } from '../geom/curves';
import { validateSpline } from '../geom/nurbs';
import type { Tolerance } from '../geom/tolerance';
import { annotationParts, type AnnotationTables } from '../annotation/multileader';
import type { Vec2 } from '../geom/types';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  DimensionGeometry,
  EntityGeometry,
  HatchGeometry,
  ImageGeometry,
  InsertAttribute,
  InsertGeometry,
  LeaderGeometry,
  MLineGeometry,
  MTextGeometry,
  MultiLeaderGeometry,
  PolylineVertex,
  TableGeometry,
  TextGeometry,
  ToleranceGeometry,
  UnderlayGeometry,
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
  | MultiLeaderGeometry
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
  /** The drawing's tables and blocks, for annotations bounded by their parts (MULTILEADER). */
  readonly tables?: AnnotationTables | undefined;
}

const UNKNOWN: EntityBounds = Object.freeze({ kind: 'unknown' });

/** Whether a spline's degree, knots and control points form a NURBS curve to evaluate. */
function isNurbs(s: Spline): boolean {
  try {
    validateSpline(s);
    return true;
  } catch {
    return false;
  }
}
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
 * An ACAD_TABLE's frame in plan: its block's x axis runs along the horizontal direction (WCS)
 * and its y axis along normal × direction, which mirrors the table on a −Z plane (DEC-039).
 */
export function tableAxes(geom: TableGeometry): { readonly x: Vec2; readonly y: Vec2 } {
  const len = Math.hypot(geom.direction.x, geom.direction.y);
  const d = len > 0 ? { x: geom.direction.x / len, y: geom.direction.y / len } : { x: 1, y: 0 };
  const nz = (geom.normal?.z ?? 1) < 0 ? -1 : 1;
  return { x: d, y: { x: -nz * d.y, y: nz * d.x } };
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

/**
 * HATCH: the fill and pattern stay inside the boundary loops, so the loops' union bounds it.
 * Arc and ellipse edges count as their whole circle or ellipse and spline edges as their
 * control points (a NURBS curve lies in their convex hull), which never misses and spares
 * the clockwise-edge angle conventions.
 */
function hatchBounds(geom: HatchGeometry, tol: Tolerance): EntityBounds {
  let out: Box | undefined;
  const add = (b: Box) => {
    out = out ? unionBox(out, b) : b;
  };
  for (const loop of geom.loops) {
    if (loop.polyline && loop.polyline.vertices.length > 0) {
      const b = polylineBounds(loop.polyline.vertices, loop.polyline.closed, 0, tol);
      if (b.kind === 'box') add(b.box);
    }
    for (const edge of loop.edges ?? []) {
      if (edge.type === 'line') add(boxOf([edge.start, edge.end]));
      else if (edge.type === 'arc') {
        const { center: c, radius: r } = edge;
        add({ minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r });
      } else if (edge.type === 'ellipse') {
        add(
          curveBounds(
            {
              kind: 'ELLIPSE',
              center: edge.center,
              majorAxis: edge.majorAxis,
              ratio: edge.ratio,
              startParam: 0,
              endParam: 2 * Math.PI,
            },
            tol,
          ),
        );
      } else if (edge.controlPoints.length > 0) add(boxOf(edge.controlPoints));
    }
  }
  return out ? boxed(out) : EMPTY;
}

/**
 * An image covers `size` pixels along u and v from its corner. Clip vertices are pixel
 * coordinates centred on pixels, with V counted up or down depending on the writer, so both
 * readings are added; a clip boundary only ever removes part of the image.
 */
function imageBounds(geom: ImageGeometry): EntityBounds {
  const at = (i: number, j: number): Vec2 => ({
    x: geom.position.x + geom.u.x * i + geom.v.x * j,
    y: geom.position.y + geom.u.y * i + geom.v.y * j,
  });
  const { x: w, y: h } = geom.size;
  const pts = [at(0, 0), at(w, 0), at(0, h), at(w, h)];
  for (const c of geom.clip.vertices)
    pts.push(at(c.x + 0.5, c.y + 0.5), at(c.x + 0.5, h - c.y - 0.5));
  return boxed(boxOf(pts));
}

/**
 * Each element of a multiline runs through vertex + miter × its first parameter, which the
 * file already states in drawing units (scale applied). Round or angled end caps join the
 * outermost elements and reach at most half their spread past an end, so the box grows by
 * the widest half-spread.
 */
function mlineBounds(geom: MLineGeometry): EntityBounds {
  if (geom.vertices.length === 0) return EMPTY;
  const pts: Vec2[] = [];
  let half = 0;
  for (const v of geom.vertices) {
    pts.push(v.position);
    const offsets = v.elements.map((e) => e.parameters[0] ?? 0);
    for (const d of offsets)
      pts.push({ x: v.position.x + v.miter.x * d, y: v.position.y + v.miter.y * d });
    if (offsets.length > 0) {
      // The miter is a unit vector in the file; its length scales the spread all the same.
      const len = Math.hypot(v.miter.x, v.miter.y);
      half = Math.max(half, ((Math.max(...offsets) - Math.min(...offsets)) * len) / 2);
    }
  }
  return boxed(pad(boxOf(pts), half));
}

/** The PDF's own extent is not in the drawing; only a clip boundary bounds an underlay. */
function underlayBounds(geom: UnderlayGeometry): EntityBounds {
  if (geom.clip.length === 0) return UNKNOWN;
  const cos = Math.cos(geom.rotation);
  const sin = Math.sin(geom.rotation);
  const flip = geom.upsideDown ? -1 : 1;
  // Two vertices are opposite corners of a rectangle; rotated, all four corners count.
  const [a, b] = geom.clip;
  const pts =
    geom.clip.length === 2 ? [a!, b!, { x: a!.x, y: b!.y }, { x: b!.x, y: a!.y }] : geom.clip;
  return boxed(
    boxOf(
      pts.map((c) => {
        const x = c.x * geom.scale.x;
        const y = c.y * geom.scale.y * flip;
        return { x: geom.position.x + x * cos - y * sin, y: geom.position.y + x * sin + y * cos };
      }),
    ),
  );
}

export function entityBounds(geom: EntityGeometry, ctx: BoundsContext): EntityBounds {
  switch (geom.kind) {
    case 'LINE':
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
      return boxed(curveBounds(geom, ctx.tol));
    case 'SPLINE':
      // A spline stored only as fit points has no NURBS to bound until the kernel computes
      // AutoCAD's interpolation (M1-47); unknown keeps every query returning it.
      return isNurbs(geom) ? boxed(curveBounds(geom, ctx.tol)) : UNKNOWN;
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
    case 'MULTILEADER': {
      // The union of what it draws (M1-52): lines, arrowheads, landing, content.
      const parts = ctx.tables ? annotationParts(geom, ctx.tables) : undefined;
      if (!parts) return UNKNOWN;
      let out: Box | undefined;
      for (const p of parts) {
        const b = entityBounds(p.geom, ctx);
        if (b.kind === 'unknown' || b.kind === 'infinite') return UNKNOWN;
        if (b.kind === 'box') out = out ? unionBox(out, b.box) : b.box;
      }
      return out ? boxed(out) : EMPTY;
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
    case 'HATCH':
      return hatchBounds(geom, ctx.tol);
    case 'IMAGE':
    case 'WIPEOUT':
      return imageBounds(geom);
    case 'PDFUNDERLAY':
      return underlayBounds(geom);
    case 'MLINE':
      return mlineBounds(geom);
    case 'OLE2FRAME':
      return boxed(boxOf([geom.upperLeft, geom.lowerRight]));
    case 'ACAD_PROXY_ENTITY': {
      // The stated extents and every drawn curve; an object that draws nothing we read is unknown.
      const boxes = geom.curves.map((c) => curveBounds(c, ctx.tol));
      if (geom.extents) boxes.push(boxOf([geom.extents.min, geom.extents.max]));
      if (boxes.length === 0) return UNKNOWN;
      return boxed(boxes.reduce(unionBox));
    }
    case 'REGION': {
      const edges = geom.loops.flatMap((l) => l.edges);
      if (edges.length === 0) return EMPTY;
      return boxed(edges.map((c) => curveBounds(c, ctx.tol)).reduce(unionBox));
    }
    case 'VIEWPORT': {
      // The frame on the sheet; what it shows of model space is drawn inside it.
      const hw = Math.abs(geom.width) / 2;
      const hh = Math.abs(geom.height) / 2;
      const { x, y } = geom.center;
      return boxed({ minX: x - hw, minY: y - hh, maxX: x + hw, maxY: y + hh });
    }
    case 'ACAD_TABLE': {
      // The `*T` block draws the table as AutoCAD last did, in the table's own frame (M1-17):
      // its extents placed at the insertion point bound it exactly.
      const ext = geom.block === undefined ? undefined : ctx.blockExtents(geom.block);
      if (ext !== undefined && ext !== 'unknown' && !isEmptyBox(ext)) {
        const base = ctx.basePoint?.(geom.block!) ?? { x: 0, y: 0 };
        const { x: ax, y: ay } = tableAxes(geom);
        const at = (x: number, y: number): Vec2 => ({
          x: geom.position.x + (x - base.x) * ax.x + (y - base.y) * ay.x,
          y: geom.position.y + (x - base.x) * ax.y + (y - base.y) * ay.y,
        });
        return boxed(
          boxOf([
            at(ext.minX, ext.minY),
            at(ext.maxX, ext.minY),
            at(ext.minX, ext.maxY),
            at(ext.maxX, ext.maxY),
          ]),
        );
      }
      // Without it (or while its text has no metrics), the grid starts at the insertion point
      // and may flow up or down along any direction, so a circle of the grid's diagonal
      // around that point holds it; cell text wraps inside its cell. Looser, never tighter.
      const w = geom.columnWidths.reduce((a, b) => a + Math.abs(b), 0);
      const h = geom.rowHeights.reduce((a, b) => a + Math.abs(b), 0);
      if (geom.columnWidths.length === 0 || geom.rowHeights.length === 0) return EMPTY;
      return boxed(pad(boxOf([geom.position]), Math.hypot(w, h)));
    }
  }
}
