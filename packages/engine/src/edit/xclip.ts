// XCLIP's edits (M5-04 part 3): a block reference's clip made, replaced, turned on or off and
// deleted, and the polyline "generate Polyline" draws along it. The clip is AutoCAD's
// SPATIAL_FILTER (model/xclip.ts reads it): the boundary in the coordinates of the space the
// reference stands in, and the inverse of the reference's transform when it was clipped, which
// takes the boundary into the block, so a reference moved later keeps its clip.
//
// Where it is filed is the save's contract (io export/xclips.ts): the filter is the SPATIAL entry
// of an ACAD_FILTER dictionary (the filter's `owner`) in the INSERT's extension dictionary. A
// first clip gives the INSERT an extension dictionary when it has none and the dictionary a new
// handle when there is none; a new boundary replaces the filter in the dictionary it was in.
//
// Invert clip (M5-04 part 11) keeps the boundary drawn as the filter's `inverted` and stores, as
// AutoCAD does, the region that shows for a reader without inverted clips: the reference's extents
// with the boundary, grown by a twentieth of their width and height on each side (as both inverted
// clips of ezdxf's xclip.dxf are; AutoCAD's help does not say), the boundary cut out through a
// slit. Text has no extents in the engine, so a block of text alone is bounded by the boundary.
import type { Vec2 } from '../geom/types';
import { applyPoint, invert, type Matrix2D } from '../geom/transform';
import { insertMatrices } from '../input/osnap';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, Matrix3x4, NonGraphicalObject, SpatialFilter } from '../model/types';
import { clipFrame, invertedBoundary } from '../model/xclip';
import { blockExtentsOf } from './mleader';

// prettier-ignore
const IDENTITY: Matrix3x4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
];

const isFilter = (o: NonGraphicalObject): o is SpatialFilter => o.type === 'SPATIAL_FILTER';

/** The clip of the reference `insert` (an INSERT's handle), if it has one. */
export function clipOf(model: DocumentModel, insert: Handle): SpatialFilter | undefined {
  for (const o of model.objects.values()) if (isFilter(o) && o.insert === insert) return o;
  return undefined;
}

/**
 * Why XCLIP cannot clip `e`, or undefined when it can: AutoCAD clips block references and
 * xrefs; a MINSERT's rows and columns are not one reference (the save refuses a clip on one).
 */
export function xclipProblem(e: Entity): string | undefined {
  const g = e.geom;
  if (g.kind !== 'INSERT') return 'not a block reference';
  if (g.array && (g.array.columns > 1 || g.array.rows > 1)) return 'a multiple insert (MINSERT)';
  return undefined;
}

/** The reference's transform from its block's coordinates to its space's. */
function placement(model: DocumentModel, e: Entity): Matrix2D | undefined {
  if (e.geom.kind !== 'INSERT') return undefined;
  const def = model.blocks.get(e.geom.block);
  return insertMatrices(e.geom, def?.basePoint ?? { x: 0, y: 0 }, 1)[0];
}

/**
 * The SPATIAL_FILTER's first matrix for the reference as it stands: the inverse of its insert
 * transform as a 3×4 (rows x, y, z; translation last), Z scaled and lifted as the reference is.
 * Undefined when the reference cannot be inverted (a zero scale).
 */
export function inverseInsertMatrix(model: DocumentModel, e: Entity): Matrix3x4 | undefined {
  const m = placement(model, e);
  if (!m || e.geom.kind !== 'INSERT') return undefined;
  let i: Matrix2D;
  try {
    i = invert(m);
  } catch {
    return undefined;
  }
  const sz = e.geom.scale.z || 1;
  const z = e.geom.elevation ?? 0;
  // prettier-ignore
  return [
    i.a, i.c, 0, i.e,
    i.b, i.d, 0, i.f,
    0, 0, 1 / sz, -z / sz,
  ].map((v) => v + 0);
}

/**
 * Clips `e` to `boundary` (XCLIP New boundary): a closed polygon, or two points for the
 * rectangle on those corners, in the coordinates of the reference's space. A clip it had is
 * replaced, in the dictionary it was in. False when the reference cannot be inverted.
 */
export function setClip(
  b: ChangeSetBuilder,
  model: DocumentModel,
  e: Entity,
  boundary: readonly Vec2[],
  inverted = false,
): boolean {
  const inverseInsert = inverseInsertMatrix(model, e);
  if (!inverseInsert) return false;
  const stored = inverted
    ? invertedBoundary(boundary, invertedBounds(model, e, boundary))
    : boundary;
  const old = clipOf(model, e.handle);
  const extDict = e.extDict ?? b.allocateHandle();
  if (e.extDict === undefined) b.updateEntity(e.id, { extDict });
  // The old filter goes (with an inverted clip's extension dictionary, which the new boundary
  // would make stale) and the new one takes its place as the SPATIAL entry.
  if (old) b.removeObject(old.handle);
  const owner = old?.owner ?? b.allocateHandle();
  b.addObject({
    type: 'SPATIAL_FILTER',
    owner,
    reactors: [owner],
    insert: e.handle,
    boundary: stored.map((p) => ({ x: p.x + 0, y: p.y + 0 })),
    ...(inverted && { inverted: boundary.map((p) => ({ x: p.x + 0, y: p.y + 0 })) }),
    normal: { x: 0, y: 0, z: 1 },
    origin: { x: 0, y: 0, z: 0 },
    enabled: true,
    ...(old?.frontClip !== undefined && { frontClip: old.frontClip }),
    ...(old?.backClip !== undefined && { backClip: old.backClip }),
    inverseInsert,
    boundaryTransform: IDENTITY,
  } as Omit<SpatialFilter, 'handle'>);
  return true;
}

/**
 * The outer bounds of an inverted clip of `e` by `boundary`, in the reference's space: its block's
 * extents where it stands, with the boundary, grown by a twentieth of their size on each side.
 */
function invertedBounds(model: DocumentModel, e: Entity, boundary: readonly Vec2[]) {
  const points = [...boundary];
  const m = placement(model, e);
  const box = e.geom.kind === 'INSERT' ? blockExtentsOf(model, e.geom.block) : undefined;
  if (m && box && e.geom.kind === 'INSERT') {
    const base = model.blocks.get(e.geom.block)?.basePoint ?? { x: 0, y: 0 };
    for (const x of [box.minX, box.maxX]) {
      for (const y of [box.minY, box.maxY])
        points.push(applyPoint(m, { x: x + base.x, y: y + base.y }));
    }
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const dx = (maxX - minX) / 20;
  const dy = (maxY - minY) / 20;
  return { minX: minX - dx, minY: minY - dy, maxX: maxX + dx, maxY: maxY + dy };
}

/**
 * Gives each copy of a clipped reference the clip (M5-16; `copies` maps each copied object's
 * handle to its copy), as AutoCAD's COPY, MIRROR and ARRAY clone a reference with its extension
 * dictionary. The boundary and the inverse insert transform hold the clip in the block's
 * coordinates, so the same fields clip the copy where it stands, mirrored with a mirrored block;
 * the filter is a new one, filed as `setClip` files a first clip: the SPATIAL entry of a new
 * ACAD_FILTER dictionary in the copy's extension dictionary (one another record of the copy
 * already gave it, or a new one). Its xdata and extension dictionary are not carried: the save
 * writes an inverted clip's ACAD_XREC_ROUNDTRIP record for a new filter itself.
 */
export function copyClips(b: ChangeSetBuilder, copies: ReadonlyMap<Handle, Entity>): void {
  if (copies.size === 0) return;
  const clips = new Map<Handle, SpatialFilter>();
  for (const o of b.objects()) if (isFilter(o) && copies.has(o.insert)) clips.set(o.insert, o);
  for (const [from, copy] of copies) {
    const f = clips.get(from);
    const e = f && b.entity(copy.id);
    if (!f || e?.geom.kind !== 'INSERT') continue;
    const extDict = e.extDict ?? b.allocateHandle();
    if (e.extDict === undefined) b.updateEntity(e.id, { extDict });
    const {
      handle: _handle,
      owner: _owner,
      reactors: _reactors,
      xdata: _xdata,
      extDict: _extDict,
      raw: _raw,
      ...clip
    } = f;
    const owner = b.allocateHandle();
    b.addObject({ ...clip, owner, reactors: [owner], insert: e.handle } as Omit<
      SpatialFilter,
      'handle'
    >);
  }
}

/** XCLIP ON and OFF: whether the clip hides what lies outside it. */
export function setClipEnabled(b: ChangeSetBuilder, filter: SpatialFilter, enabled: boolean) {
  if (filter.enabled !== enabled) {
    b.updateObject(filter.handle, { enabled } as Partial<NonGraphicalObject>);
  }
}

/**
 * Where the clip of `e` lies now, in the coordinates of the reference's space: the block's
 * boundary (an inverted clip's inner boundary) through the reference's present transform (the
 * reference may have moved, turned or been scaled since it was clipped). Undefined when the
 * clip encloses nothing.
 */
export function clipOutline(
  model: DocumentModel,
  e: Entity,
  filter: SpatialFilter,
): Vec2[] | undefined {
  const inBlock = clipFrame(filter);
  const m = placement(model, e);
  if (!inBlock || !m) return undefined;
  return inBlock.map((p) => {
    const q = applyPoint(m, p);
    return { x: q.x + 0, y: q.y + 0 };
  });
}

/** Whether segments p1-p2 and q1-q2 cross or touch (`tol` the drawing's linear tolerance). */
function segmentsMeet(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, tol: number): boolean {
  const orient = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const scale = Math.max(
    Math.hypot(p2.x - p1.x, p2.y - p1.y),
    Math.hypot(q2.x - q1.x, q2.y - q1.y),
  );
  const eps = tol * scale;
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  ) {
    return true;
  }
  const within = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.min(a.x, b.x) - tol <= c.x &&
    c.x <= Math.max(a.x, b.x) + tol &&
    Math.min(a.y, b.y) - tol <= c.y &&
    c.y <= Math.max(a.y, b.y) + tol;
  return (
    (Math.abs(d1) <= eps && within(q1, q2, p1)) ||
    (Math.abs(d2) <= eps && within(q1, q2, p2)) ||
    (Math.abs(d3) <= eps && within(p1, p2, q1)) ||
    (Math.abs(d4) <= eps && within(p1, p2, q2))
  );
}

/**
 * Whether the closed polygon `points` crosses or touches itself: two of its edges that are not
 * neighbours meet (AutoCAD: a clipping polyline "cannot intersect itself").
 */
export function selfIntersecting(points: readonly Vec2[], tol: number): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Neighbouring edges share a vertex: the first and the last are neighbours too.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsMeet(a, b, points[j]!, points[(j + 1) % n]!, tol)) return true;
    }
  }
  return false;
}
