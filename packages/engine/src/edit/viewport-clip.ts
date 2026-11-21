// Non-rectangular layout viewports (M6-02 part 2): what MVIEW Object and Polygonal and VPCLIP
// clip a viewport with, and how the viewport takes the clip.
//
// AutoCAD 2024 Help, "VPCLIP (Command)" and "MVIEW (Command)": the clipping object is "a closed
// polyline, circle, ellipse, closed spline, or region"; a polyline "must be closed and contain at
// least three vertices. It can be self-intersecting, and it can contain an arc as well as line
// segments". "If you clip a viewport that has been previously clipped, the original clipping
// boundary is deleted, and the new clipping boundary is applied"; Delete "deletes the clipping
// boundary of a selected viewport".
//
// The viewport names the object (DXF 340), sets non-rectangular clipping (DXF 90 bit 65536) and
// is listed in the object's reactors; its frame (10, 40, 41) becomes the object's extents, as
// every clipped viewport AutoCAD saved in the corpus shows (text_in_viewports.dxf: four boundaries,
// each viewport's centre, width and height those of its boundary's box). The view keeps the
// viewport's scale and where model space lies on the sheet: the clip shows more or less of the
// same drawing, it does not zoom it.
import { flatten } from '../geom/flatten';
import type { Box } from '../geom/bounds';
import { toleranceForSize } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { viewportFrame, viewportScale } from '../layout/viewport';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Entity, EntityGeometry, LwPolylineGeometry, ViewportGeometry } from '../model/types';
import { point, type Similarity } from './similarity';
import { entityBounds } from '../spatial/entity-bounds';
import { VIEWPORT_NON_RECT_CLIP } from '../layout/viewport';
import { eraseObjects } from './edit';
import { signedArea2 } from './revcloud';

/** What AutoCAD clips a viewport with (VPCLIP, MVIEW Object). */
const CLIP_TYPES = new Set(['LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'REGION']);

/** The largest coordinate of a shape's defining points, for its tolerance. */
function magnitude(g: EntityGeometry): number {
  const points: Vec2[] = [];
  if (g.kind === 'LWPOLYLINE' || g.kind === 'POLYLINE') points.push(...g.vertices);
  else if (g.kind === 'CIRCLE' || g.kind === 'ELLIPSE') points.push(g.center);
  else if (g.kind === 'SPLINE') points.push(...g.controlPoints, ...(g.fitPoints ?? []));
  else if (g.kind === 'REGION') {
    for (const l of g.loops) {
      for (const e of l.edges) points.push(e.kind === 'LINE' ? e.start : e.center);
    }
  }
  return Math.max(1, ...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
}

/** The box a clipping shape spans: the viewport's frame once it clips it. */
export function viewportClipFrame(g: EntityGeometry): Box | undefined {
  const b = entityBounds(g, {
    tol: toleranceForSize(magnitude(g)),
    blockExtents: () => undefined,
  });
  if (b.kind !== 'box') return undefined;
  const { minX, minY, maxX, maxY } = b.box;
  return maxX > minX && maxY > minY ? b.box : undefined;
}

/** Whether a polyline's vertices, bulges followed, enclose an area. */
function enclosesArea(g: EntityGeometry & { kind: 'LWPOLYLINE' | 'POLYLINE' }): boolean {
  const size = magnitude(g);
  const tol = toleranceForSize(size).linear;
  const flat = flatten({ kind: 'LWPOLYLINE', vertices: g.vertices, closed: true }, size * 1e-3);
  return Math.abs(signedArea2(flat.points)) > tol * tol;
}

/** Whether an object of a type that clips is closed, as a clip boundary must be. */
function closedShape(g: EntityGeometry): boolean {
  switch (g.kind) {
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return g.closed && !('is3d' in g && g.is3d) && g.vertices.length >= 3 && enclosesArea(g);
    case 'SPLINE':
      return g.closed || g.periodic;
    case 'ELLIPSE': {
      const sweep = Math.abs(g.endParam - g.startParam);
      return sweep === 0 || Math.abs(sweep - 2 * Math.PI) <= 1e-9;
    }
    case 'REGION':
      return g.loops.some((l) => l.edges.length > 0);
    default:
      return true;
  }
}

/** Not a shape that clips, or not closed. */
export const NOT_A_CLIP_OBJECT =
  'Object must be a closed polyline of three or more vertices, a circle, an ellipse, a closed spline or a region.';

/** Whether `g` is a shape that clips a viewport: of a type that does, closed, with an area. */
export function clipsViewport(g: EntityGeometry): boolean {
  return CLIP_TYPES.has(g.kind) && closedShape(g) && viewportClipFrame(g) !== undefined;
}

/**
 * Why `e` cannot clip `viewport` (undefined: a new viewport that will be made around it) in
 * `space`, or undefined when it can: its shape, its space, and that one object clips one
 * viewport.
 */
export function clipObjectProblem(
  model: DocumentModel,
  e: Entity,
  space: string,
  viewport?: Entity,
): string | undefined {
  if (!clipsViewport(e.geom) || e.handle === viewport?.handle) return NOT_A_CLIP_OBJECT;
  if (e.owner !== space) return 'Object is not in the layout shown.';
  for (const h of e.reactors ?? []) {
    const other = model.entityByHandle(h);
    if (
      other?.geom.kind === 'VIEWPORT' &&
      other.geom.clipBoundary === e.handle &&
      other.handle !== viewport?.handle
    ) {
      return 'Object already clips another viewport.';
    }
  }
  return undefined;
}

/** The viewport of `id` in the builder's state; undefined when it is no viewport. */
const viewportIn = (b: ChangeSetBuilder, id: EntityId) => {
  const e = b.entity(id);
  return e?.geom.kind === 'VIEWPORT' ? (e as Entity & { geom: ViewportGeometry }) : undefined;
};

/**
 * The viewport framed by `frame`, with the same scale and model space where it was on the sheet.
 */
function framedBy<G extends ViewportGeometry | Omit<ViewportGeometry, 'clipBoundary'>>(
  g: G,
  frame: Box,
): G {
  const center = { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 };
  const height = frame.maxY - frame.minY;
  const s = viewportScale(g as ViewportGeometry);
  // The view centre moves with the frame's centre, at the viewport's scale, so the sheet
  // shows model space where it was (`viewportTransform`); the view's height spans the frame's.
  const view =
    s > 0
      ? {
          viewCenter: {
            x: g.viewCenter.x + (center.x - g.center.x) / s,
            y: g.viewCenter.y + (center.y - g.center.y) / s,
          },
          viewHeight: height / s,
        }
      : {};
  return { ...g, ...view, center, width: frame.maxX - frame.minX, height };
}

/**
 * Clips viewport `viewportId` with object `boundaryId` (checked with `clipObjectProblem`): the
 * viewport names it, is non-rectangular and framed by its box, with the same scale and model
 * space where it was on the sheet; the object lists the viewport in its reactors. A boundary
 * the viewport had before is erased.
 */
export function clipViewport(
  b: ChangeSetBuilder,
  model: DocumentModel,
  viewportId: EntityId,
  boundaryId: EntityId,
): void {
  const boundary = b.entity(boundaryId)!;
  const before = viewportIn(b, viewportId)!;
  if (before.geom.clipBoundary === boundary.handle) return;
  if (before.geom.clipBoundary !== undefined) {
    const old = model.ids.idOf(before.geom.clipBoundary);
    if (old !== undefined && b.entity(old)) eraseObjects(b, model, [old]);
  }
  const { clipBoundary: _old, ...g } = viewportIn(b, viewportId)!.geom;
  const frame = viewportClipFrame(boundary.geom)!;
  b.updateEntity(viewportId, {
    geom: {
      ...framedBy(g, frame),
      clipBoundary: boundary.handle,
      flags: g.flags | VIEWPORT_NON_RECT_CLIP,
    },
  });
  const reactors = boundary.reactors ?? [];
  if (!reactors.includes(before.handle)) {
    b.updateEntity(boundaryId, { reactors: [...reactors, before.handle] });
  }
}

/**
 * VPCLIP Delete: the viewport's clipping boundary is erased and the viewport is rectangular
 * again, on the frame it had (the boundary's box).
 */
export function deleteViewportClip(
  b: ChangeSetBuilder,
  model: DocumentModel,
  viewportId: EntityId,
): void {
  const clip = viewportIn(b, viewportId)?.geom.clipBoundary;
  if (clip === undefined) return;
  const id = model.ids.idOf(clip);
  // Erasing the boundary lets the viewport go of it (`eraseObjects`, through its reactors).
  if (id !== undefined && b.entity(id)) eraseObjects(b, model, [id]);
  const g = viewportIn(b, viewportId)!.geom;
  if (g.clipBoundary !== undefined) {
    const { clipBoundary: _c, ...rest } = g;
    b.updateEntity(viewportId, { geom: { ...rest, flags: g.flags & ~VIEWPORT_NON_RECT_CLIP } });
  }
}

/**
 * A viewport an edit turned by other than right angles (ROTATE, ALIGN, a rotating grip, a
 * rotated copy; M6-02 part 16; `turnsOffSquare`): its frame stays square to the sheet, so it is
 * clipped to its turned frame, as AutoCAD makes a turned rectangular viewport a clipped one. A
 * viewport already clipped, its boundary turned with it, is framed by its boundary's box again.
 * `before` is the viewport as it was, `t` the edit's motion.
 *
 * The new boundary is a closed LWPOLYLINE through the turned frame's corners, in the viewport's
 * space with the viewport's general properties, so the sheet shows the frame as it was, turned
 * (AutoCAD's help does not say which properties it takes; choice documented in the PR).
 */
export function clipTurnedViewport(
  b: ChangeSetBuilder,
  model: DocumentModel,
  viewportId: EntityId,
  before: ViewportGeometry,
  t: Similarity,
): void {
  const vp = viewportIn(b, viewportId);
  if (!vp) return;
  const clip = vp.geom.clipBoundary;
  if (clip !== undefined) {
    const id = model.ids.idOf(clip);
    const boundary = id === undefined ? undefined : b.entity(id);
    const frame = boundary && viewportClipFrame(boundary.geom);
    if (frame) b.updateEntity(viewportId, { geom: framedBy(vp.geom, frame) });
    return;
  }
  const f = viewportFrame(before);
  const corners = [
    { x: f.minX, y: f.minY },
    { x: f.maxX, y: f.minY },
    { x: f.maxX, y: f.maxY },
    { x: f.minX, y: f.maxY },
  ].map((q) => point(t, q));
  const polygon: LwPolylineGeometry = {
    kind: 'LWPOLYLINE',
    vertices: corners.map((q) => ({ x: q.x, y: q.y, bulge: 0 })),
    closed: true,
  };
  const { layer, color, linetype, lineweight, ltScale, transparency } = vp;
  const boundary = b.addEntity({
    owner: vp.owner,
    layer,
    color,
    linetype,
    lineweight,
    ltScale,
    transparency,
    geom: polygon,
  });
  clipViewport(b, model, viewportId, boundary.id);
}
