// Running object snaps (M2-04, ARCHITECTURE.md §5.3 `OsnapEngine`): given the cursor, the
// aperture and the modes on, the snap points of the objects under the aperture, best first.
//
// AutoCAD 2024 Help, "Object Snaps" and "OSNAP (Command)" define the modes. What they leave
// open is decided here as a drafter expects, and tested in test/input/osnap.test.ts:
// - An object takes part when the aperture touches it (distance from the cursor to the object
//   ≤ aperture); the point it offers may lie anywhere on it: ENDpoint is the endpoint nearer
//   the cursor wherever the cursor is on the line, CENter shows from the circle's edge.
// - AutoSnap's choice ("the object snap location closest to the cursor"): a point inside the
//   aperture first, then NEArest (which is always under the cursor and would hide every other
//   mode if ranked by distance alone), then the remaining points by distance. Ties go by
//   the order of `OSNAP_MODES` (END before INT where a corner is both).
// - INTersection and APParent intersection count only points inside the aperture. APP in plan
//   view is the extended intersection: lines extended to infinite lines, arcs to their
//   circles, elliptical arcs to their ellipses.
// - PERpendicular and TANgent need the last point (`from`); AutoCAD's deferred perpendicular
//   and tangent (no last point yet) are not in this version.
// - EXTension and PARallel follow lines acquired by hovering, as object snap tracking does
//   (OTRACK, `track.ts`): here they offer what may be acquired, a line's nearer end with the
//   direction out of it (EXT) and the line under the cursor with its direction once there is a
//   base point (PAR), as `track` hits listed after the snap points (M2-04 part 2).
// - In a layout's paper space, the model space objects a viewport shows are snapped to as well
//   while the cursor is inside its frame, in paper coordinates and only within the frame (the
//   rectangle; a non-rectangular clip is taken as its frame), skipping layers frozen in it.
// - Hatches are ignored (OSNAPHATCH 0, AutoCAD's default). Block references are snapped into,
//   nested blocks too; a hit names the object of the space shown.
// - PDF underlays offer the vector geometry of their page (M2-22) while PDFOSNAP is on (the
//   query's `underlays`, on unless false) and the app has read the page (the source's
//   `underlays`, underlay-snap.ts): its lines, arcs and curves placed by the underlay's
//   insertion, scale and rotation, and while clipping is on only points inside the clip
//   boundary, so nothing outside it is snapped to, as nothing outside it shows.
//
// Geometry comes from the document model and candidates from the spatial index, so the cost is
// the objects under the aperture, not the drawing (PRD §12 T3: < 50 ms at 100k entities).
import { angleWithin, TAU } from '../geom/angle';
import { closestPoint } from '../geom/closest';
import type { Arc, Circle, Curve, Ellipse, Line, Polyline, Spline } from '../geom/curves';
import { arcSweep, domain, ellipseSweep, explodePolyline, pointAt } from '../geom/eval';
import { flatten } from '../geom/flatten';
import { intersect } from '../geom/intersect';
import { tangentPointsFrom } from '../geom/tangent';
import type { Tolerance } from '../geom/tolerance';
import {
  applyPoint,
  compose,
  IDENTITY,
  invert,
  transformCurve,
  type Matrix2D,
} from '../geom/transform';
import type { Vec2 } from '../geom/types';
import { distance, dot, normalize, sub } from '../geom/vec';
import type { Box } from '../geom/bounds';
import { viewportFrame, viewportShowsModel, viewportTransform } from '../layout/viewport';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, EntityGeometry, InsertGeometry } from '../model/types';
import type { SpatialIndex } from '../spatial/spatial-index';
import {
  insideRing,
  underlayClipRing,
  underlayMatrix,
  underlayShown,
  underlaySnapCurves,
  type UnderlaySnapPage,
} from './underlay-snap';

/** OSMODE bits, as AutoCAD numbers them. 16384 (`OSNAP_OFF`) suppresses running snaps. */
export const OSNAP = {
  END: 1,
  MID: 2,
  CEN: 4,
  NOD: 8,
  QUA: 16,
  INT: 32,
  INS: 64,
  PER: 128,
  TAN: 256,
  NEA: 512,
  GCE: 1024,
  APP: 2048,
  EXT: 4096,
  PAR: 8192,
} as const;

export type OsnapMode = keyof typeof OSNAP;

/** OSMODE bit 16384: running object snaps off (F3), the modes kept for when they are on. */
export const OSNAP_OFF = 16384;

/** AutoCAD's initial OSMODE: Endpoint, Center, Intersection and Extension. */
export const OSMODE_DEFAULT = OSNAP.END | OSNAP.CEN | OSNAP.INT | OSNAP.EXT;

/**
 * The modes as the Drafting Settings dialog and the Shift+right-click menu list them, which is
 * also the order a tie between two modes at one point goes by.
 */
export const OSNAP_MODES: readonly { readonly mode: OsnapMode; readonly label: string }[] = [
  { mode: 'END', label: 'Endpoint' },
  { mode: 'MID', label: 'Midpoint' },
  { mode: 'INT', label: 'Intersection' },
  { mode: 'APP', label: 'Apparent Intersection' },
  { mode: 'EXT', label: 'Extension' },
  { mode: 'CEN', label: 'Center' },
  { mode: 'GCE', label: 'Geometric Center' },
  { mode: 'QUA', label: 'Quadrant' },
  { mode: 'TAN', label: 'Tangent' },
  { mode: 'PER', label: 'Perpendicular' },
  { mode: 'PAR', label: 'Parallel' },
  { mode: 'NOD', label: 'Node' },
  { mode: 'INS', label: 'Insertion' },
  { mode: 'NEA', label: 'Nearest' },
];

const RANK = new Map(OSNAP_MODES.map((m, i) => [m.mode, i]));

/** The modes an OSMODE value turns on, in bit order. */
export function osnapModeNames(osmode: number): OsnapMode[] {
  return (Object.keys(OSNAP) as OsnapMode[]).filter((m) => (osmode & OSNAP[m]) !== 0);
}

export interface OsnapSource {
  readonly model: DocumentModel;
  readonly index: SpatialIndex;
  /** The block record shown: model space or a layout's paper space. */
  readonly block: Handle;
  readonly tol: Tolerance;
  /** Model space's block record: with a layout shown, its viewports are snapped through. */
  readonly modelSpace?: Handle;
  /** A PDFDEFINITION's page geometry, once the app has read it from the PDF (M2-22). */
  readonly underlays?: (definition: Handle) => UnderlaySnapPage | undefined;
}

export interface OsnapQuery {
  /** The cursor, in the coordinates of the space shown. */
  readonly point: Vec2;
  /** APERTURE as a distance in drawing units (its pixels over the view's scale). */
  readonly aperture: number;
  /** OSMODE bits; 0 (or `OSNAP_OFF` set) snaps to nothing. */
  readonly modes: number;
  /** The last point, which PERpendicular and TANgent are drawn from. */
  readonly from?: Vec2;
  /** PDFOSNAP: PDF underlays' geometry is snapped to unless this is false (M2-22). */
  readonly underlays?: boolean;
}

export interface OsnapHit {
  readonly mode: OsnapMode;
  readonly point: Vec2;
  /**
   * The object of the space shown the point belongs to (a block reference for its contents,
   * the viewport for model space seen through it).
   */
  readonly id: EntityId;
  /** EXT and PAR: the line's direction (out of the end, for EXT). */
  readonly direction?: Vec2;
  /** Not a point to snap to, but something to acquire for tracking (EXT, PAR). */
  readonly track?: true;
}

/** Block nesting followed, and MINSERT cells taken per reference, before giving up. */
const MAX_DEPTH = 8;
const MAX_CELLS = 1024;
/**
 * Of the curves under the aperture, the nearest this many offer their points, and the nearest
 * MAX_PAIRED of those are paired for INT and APP. Zoomed out over a dense drawing the aperture
 * holds hundreds of objects; AutoSnap marks the ones nearest the cursor, and these bounds keep
 * a query within PRD §12 T3's 50 ms (`tests/e2e/perf/render.spec.ts`).
 */
const MAX_NEAR = 24;
const MAX_PAIRED = 12;

type Simple = Line | Arc | Circle | Ellipse | Spline | Curve;

interface CurvePart {
  readonly id: EntityId;
  readonly groups: readonly number[];
  readonly curve: Simple;
  /** Offers its ends to END (a polyline's segments do; a closed spline does not). */
  readonly ends: boolean;
  /** Where its points may be (a clipped underlay's boundary); anywhere when absent. */
  readonly inside?: (p: Vec2) => boolean;
}

interface PointPart {
  readonly id: EntityId;
  readonly groups: readonly number[];
  readonly mode: OsnapMode;
  readonly point: Vec2;
  /** Whether the object is under the aperture, when the object itself says (text by its box). */
  readonly near?: boolean;
}

interface LoopPart {
  readonly id: EntityId;
  readonly groups: readonly number[];
  /** The closed outline, flattened when GCE needs it, for its centroid. */
  readonly points: () => readonly Vec2[];
}

interface Parts {
  readonly curves: CurvePart[];
  readonly points: PointPart[];
  readonly loops: LoopPart[];
  /** The frame of each viewport model space was snapped through: its hits stay inside it. */
  readonly clips: Map<EntityId, Box>;
}

/** The snap points under the aperture, best first; empty when none or no mode is on. */
export function osnap(src: OsnapSource, q: OsnapQuery): OsnapHit[] {
  const modes = q.modes & OSNAP_OFF ? 0 : q.modes;
  if (modes === 0 || !(q.aperture > 0)) return [];
  const parts = collect(src, q);
  const on = (m: OsnapMode) => (modes & OSNAP[m]) !== 0;
  const out: OsnapHit[] = [];
  const add = (mode: OsnapMode, point: Vec2, id: EntityId) => {
    if (on(mode) && Number.isFinite(point.x) && Number.isFinite(point.y))
      out.push({ mode, point, id });
  };
  const within = (part: CurvePart, p: Vec2) => !part.inside || part.inside(p);
  const addTo =
    (part: CurvePart) =>
    (mode: OsnapMode, point: Vec2, id: EntityId): void => {
      if (within(part, point)) add(mode, point, id);
    };

  // The curves the aperture touches, nearest first, and the groups (objects, and the block
  // references holding them) they belong to.
  const near: { part: CurvePart; d: number; nearest: Vec2 }[] = [];
  const nearGroups = new Set<number>();
  for (const part of parts.curves) {
    const c = closestPoint(part.curve as Curve, q.point, src.tol);
    if (c.distance > q.aperture) continue;
    near.push({ part, d: c.distance, nearest: c.point });
    for (const g of part.groups) nearGroups.add(g);
  }
  near.sort((a, b) => a.d - b.d);
  near.length = Math.min(near.length, MAX_NEAR);

  const tracks: { hit: OsnapHit; d: number }[] = [];
  for (const { part, d, nearest } of near) {
    const addPart = part.inside ? addTo(part) : add;
    curvePoints(part, q, src.tol, addPart, on);
    addPart('NEA', nearest, part.id);
    const c = part.curve;
    if (on('EXT') && part.ends && c.kind === 'LINE') {
      const atEnd = distance(c.end, q.point) < distance(c.start, q.point);
      const [from, to] = atEnd ? [c.start, c.end] : [c.end, c.start];
      if (!within(part, to)) continue;
      const hit: OsnapHit = {
        mode: 'EXT',
        point: to,
        id: part.id,
        direction: sub(to, from),
        track: true,
      };
      tracks.push({ hit, d: distance(to, q.point) });
    }
    if (
      on('PAR') &&
      q.from &&
      (c.kind === 'LINE' || c.kind === 'XLINE' || c.kind === 'RAY') &&
      within(part, nearest)
    ) {
      const direction = c.kind === 'LINE' ? sub(c.end, c.start) : c.direction;
      tracks.push({ hit: { mode: 'PAR', point: nearest, id: part.id, direction, track: true }, d });
    }
  }
  for (const p of parts.points) {
    const isNear =
      p.near ??
      (distance(p.point, q.point) <= q.aperture || p.groups.some((g) => nearGroups.has(g)));
    if (isNear) add(p.mode, p.point, p.id);
  }
  if (on('GCE')) {
    for (const loop of parts.loops) {
      if (!loop.groups.some((g) => nearGroups.has(g))) continue;
      let c: Vec2 | undefined;
      try {
        c = centroid(loop.points());
      } catch {
        // An outline that cannot be flattened has no centroid to offer.
      }
      if (c) add('GCE', c, loop.id);
    }
  }
  if (on('INT') || on('APP')) {
    const paired = near.slice(0, MAX_PAIRED);
    for (let i = 0; i < paired.length; i++) {
      for (let j = i + 1; j < paired.length; j++) {
        const a = paired[i]!.part;
        const b = paired[j]!.part;
        if (on('INT')) {
          for (const x of intersect(a.curve as Curve, b.curve as Curve, src.tol)) {
            if (
              distance(x.point, q.point) <= q.aperture &&
              within(a, x.point) &&
              within(b, x.point)
            )
              add('INT', x.point, a.id);
          }
        }
        if (on('APP')) {
          for (const x of intersect(extended(a.curve), extended(b.curve), src.tol)) {
            if (
              distance(x.point, q.point) <= q.aperture &&
              within(a, x.point) &&
              within(b, x.point)
            )
              add('APP', x.point, a.id);
          }
        }
      }
    }
  }
  const clipped = (h: OsnapHit) => {
    const box = parts.clips.get(h.id);
    return !box || boxDistance(box, h.point) <= src.tol.linear * 16;
  };
  tracks.sort((a, b) => a.d - b.d);
  return [...rank(out.filter(clipped), q, src.tol), ...tracks.map((t) => t.hit).filter(clipped)];
}

function rank(hits: OsnapHit[], q: OsnapQuery, tol: Tolerance): OsnapHit[] {
  const tier = (h: OsnapHit, d: number) => (h.mode === 'NEA' ? 1 : d <= q.aperture ? 0 : 2);
  const scored = hits.map((h) => {
    const d = distance(h.point, q.point);
    return { h, d, tier: tier(h, d) };
  });
  // Distances this close are a tie, which the mode order settles.
  const same = Math.max(tol.linear * 16, q.aperture * 1e-9);
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      (Math.abs(a.d - b.d) <= same ? 0 : a.d - b.d) ||
      RANK.get(a.h.mode)! - RANK.get(b.h.mode)!,
  );
  const out: OsnapHit[] = [];
  for (const { h } of scored) {
    if (out.some((o) => o.mode === h.mode && distance(o.point, h.point) <= same)) continue;
    out.push(h);
  }
  return out;
}

/** END, MID, CEN, QUA, PER and TAN of one curve the aperture touches. */
function curvePoints(
  part: CurvePart,
  q: OsnapQuery,
  tol: Tolerance,
  add: (mode: OsnapMode, p: Vec2, id: EntityId) => void,
  on: (m: OsnapMode) => boolean,
): void {
  const c = part.curve as Curve;
  const id = part.id;
  const closed = isClosed(c);
  if (on('END') && part.ends && !closed) {
    if (c.kind === 'RAY') add('END', c.base, id);
    else if (c.kind !== 'XLINE') {
      const d = domain(c);
      const a = pointAt(c, d.start);
      const b = pointAt(c, d.end);
      // ENDpoint: the end nearer the cursor.
      add('END', distance(a, q.point) <= distance(b, q.point) ? a : b, id);
    }
  }
  if (on('MID')) {
    if (c.kind === 'XLINE') add('MID', c.base, id);
    else if (c.kind === 'LINE')
      add('MID', { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }, id);
    else if (c.kind === 'ARC') add('MID', pointAt(c, c.startAngle + arcSweep(c) / 2), id);
    else if ((c.kind === 'ELLIPSE' || c.kind === 'SPLINE') && !closed) {
      const m = midByLength(c, q.aperture * 1e-3);
      if (m) add('MID', m, id);
    }
  }
  if (on('CEN') && (c.kind === 'ARC' || c.kind === 'CIRCLE' || c.kind === 'ELLIPSE')) {
    add('CEN', c.center, id);
  }
  if (on('QUA')) {
    if (c.kind === 'CIRCLE' || c.kind === 'ARC') {
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (c.kind === 'ARC' && angleWithin(a, c.startAngle, arcSweep(c), tol) === undefined)
          continue;
        add(
          'QUA',
          { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) },
          id,
        );
      }
    } else if (c.kind === 'ELLIPSE') {
      for (let k = 0; k < 4; k++) {
        const t = angleWithin((k * Math.PI) / 2, c.startParam, ellipseSweep(c), tol);
        if (t !== undefined) add('QUA', pointAt(c, t), id);
      }
    }
  }
  const from = q.from;
  if (from && on('PER')) {
    for (const p of perpendicularFeet(c, from, tol)) add('PER', p, id);
  }
  if (from && on('TAN') && c.kind !== 'LINE' && c.kind !== 'XLINE' && c.kind !== 'RAY') {
    for (const t of tangentPointsFrom(c, from, tol)) add('TAN', t.point, id);
  }
}

/** Feet of the perpendiculars from `p`: on a line's extension too, on an arc within its sweep. */
function perpendicularFeet(c: Curve, p: Vec2, tol: Tolerance): Vec2[] {
  switch (c.kind) {
    case 'LINE':
    case 'XLINE':
    case 'RAY': {
      const base = c.kind === 'LINE' ? c.start : c.base;
      const dir = normalize(c.kind === 'LINE' ? sub(c.end, c.start) : c.direction);
      const t = dot(sub(p, base), dir);
      if (c.kind === 'RAY' && t < 0) return [];
      return [{ x: base.x + dir.x * t, y: base.y + dir.y * t }];
    }
    case 'CIRCLE':
    case 'ARC': {
      const d = distance(p, c.center);
      if (d <= tol.linear) return [];
      const u = { x: (p.x - c.center.x) / d, y: (p.y - c.center.y) / d };
      const feet = [1, -1].map((s) => ({
        x: c.center.x + s * c.radius * u.x,
        y: c.center.y + s * c.radius * u.y,
      }));
      if (c.kind === 'CIRCLE') return feet;
      return feet.filter(
        (f) =>
          angleWithin(
            Math.atan2(f.y - c.center.y, f.x - c.center.x),
            c.startAngle,
            arcSweep(c),
            tol,
          ) !== undefined,
      );
    }
    default: {
      const foot = closestPoint(c, p, tol);
      return foot.distance > tol.linear ? [foot.point] : [];
    }
  }
}

function isClosed(c: Curve): boolean {
  switch (c.kind) {
    case 'CIRCLE':
      return true;
    case 'ELLIPSE':
      return ellipseSweep(c) >= TAU - 1e-12;
    case 'SPLINE': {
      const d = domain(c);
      return distance(pointAt(c, d.start), pointAt(c, d.end)) === 0;
    }
    case 'LWPOLYLINE':
      return c.closed;
    default:
      return false;
  }
}

/** The point halfway along an elliptical arc or a spline, by length. */
function midByLength(c: Ellipse | Spline, deviation: number): Vec2 | undefined {
  const f = flatten(c, Math.max(deviation, 1e-12));
  const n = f.points.length;
  if (n < 2) return undefined;
  const lengths = [0];
  for (let i = 1; i < n; i++)
    lengths.push(lengths[i - 1]! + distance(f.points[i - 1]!, f.points[i]!));
  const half = lengths[n - 1]! / 2;
  let i = 1;
  while (i < n - 1 && lengths[i]! < half) i++;
  const span = lengths[i]! - lengths[i - 1]!;
  const s = span > 0 ? (half - lengths[i - 1]!) / span : 0;
  // Interpolated in the parameter and evaluated on the curve, so the point is on it.
  const t = f.params[i - 1]! + s * (f.params[i]! - f.params[i - 1]!);
  return pointAt(c, t);
}

/** Area centroid of a closed outline; undefined for one with no area. */
function centroid(points: readonly Vec2[]): Vec2 | undefined {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const o = points[0];
  if (!o) return undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    // Relative to the first point, so far-off coordinates keep their precision.
    const px = p.x - o.x;
    const py = p.y - o.y;
    const qx = q.x - o.x;
    const qy = q.y - o.y;
    const k = px * qy - qx * py;
    a += k;
    cx += (px + qx) * k;
    cy += (py + qy) * k;
  }
  if (Math.abs(a) < 1e-300) return undefined;
  return { x: o.x + cx / (3 * a), y: o.y + cy / (3 * a) };
}

/** The natural extension of a curve: a line's infinite line, an arc's circle, an ellipse's whole. */
function extended(c: Simple): Curve {
  switch (c.kind) {
    case 'LINE':
      return { kind: 'XLINE', base: c.start, direction: sub(c.end, c.start) };
    case 'RAY':
      return { kind: 'XLINE', base: c.base, direction: c.direction };
    case 'ARC':
      return { kind: 'CIRCLE', center: c.center, radius: c.radius };
    case 'ELLIPSE':
      return { ...c, startParam: 0, endParam: TAU };
    default:
      return c as Curve;
  }
}

// ── Collecting the geometry under the aperture ───────────────────────────────────────────

function collect(src: OsnapSource, q: OsnapQuery): Parts {
  const parts: Parts = { curves: [], points: [], loops: [], clips: new Map() };
  const r = q.aperture;
  const box: Box = {
    minX: q.point.x - r,
    minY: q.point.y - r,
    maxX: q.point.x + r,
    maxY: q.point.y + r,
  };
  const ctx: Ctx = { src, q, parts, nextGroup: 0, frozen: undefined };
  const throughViewports = src.modelSpace !== undefined && src.modelSpace !== src.block;
  for (const id of src.index.query(src.block, box)) {
    const e = src.model.entity(id);
    if (!e) continue;
    // A viewport's view shows whatever its own layer and visibility (layout-render's rule).
    if (throughViewports && e.geom.kind === 'VIEWPORT' && viewportShowsModel(e.geom)) {
      const frame = viewportFrame(e.geom);
      if (boxDistance(frame, q.point) === 0) {
        parts.clips.set(id, frame);
        ctx.frozen = e.geom.frozenLayers.length > 0 ? new Set(e.geom.frozenLayers) : undefined;
        nested(ctx, src.modelSpace!, viewportTransform(e.geom), id, [ctx.nextGroup++], -1);
        ctx.frozen = undefined;
      }
    }
    if (!shown(src.model, e)) continue;
    let near: boolean | undefined;
    const b = src.index.bounds(id);
    if (b?.kind === 'box') near = boxDistance(b.box, q.point) <= r;
    // Text no loaded font bounds is in every query: it counts only by its insertion point.
    else if (isText(e.geom) && distance(textInsertion(e.geom), q.point) > r) continue;
    addEntity(ctx, e, IDENTITY, id, [], 0, near);
  }
  return parts;
}

interface Ctx {
  readonly src: OsnapSource;
  readonly q: OsnapQuery;
  readonly parts: Parts;
  nextGroup: number;
  /** The layers frozen in the viewport being looked through. */
  frozen: ReadonlySet<Handle> | undefined;
}

/** Visible, on a layer neither off nor frozen (nor frozen in the viewport looked through). */
function shown(model: DocumentModel, e: Entity, frozen?: ReadonlySet<Handle>): boolean {
  if (!e.visible || frozen?.has(e.layer)) return false;
  const l = model.tables.layers.get(e.layer);
  return !l || (l.on && !l.frozen);
}

function boxDistance(b: Box, p: Vec2): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
}

/**
 * One object's snap geometry, carried into the space shown by `m`. `near` is whether the
 * aperture touches the object's box, for objects that offer points but no curves (text).
 */
function addEntity(
  ctx: Ctx,
  e: Entity,
  m: Matrix2D,
  id: EntityId,
  parents: readonly number[],
  depth: number,
  boxNear: boolean | undefined,
): void {
  const { parts, src } = ctx;
  const groups = [...parents, ctx.nextGroup++];
  const identity = m === IDENTITY;
  const pt = (p: Vec2): Vec2 => (identity ? p : applyPoint(m, p));
  const curve = (c: Curve, ends = true) => {
    try {
      parts.curves.push({ id, groups, curve: identity ? c : transformCurve(c, m, src.tol), ends });
    } catch {
      // A degenerate curve or a singular block transform: nothing to snap to.
    }
  };
  const point = (mode: OsnapMode, p: Vec2, near?: boolean) =>
    parts.points.push({ id, groups, mode, point: pt(p), ...(near !== undefined && { near }) });
  const loop = (c: Polyline | Spline) => {
    if ((ctx.q.modes & OSNAP.GCE) === 0) return;
    const dev = Math.max(ctx.q.aperture * 1e-3, src.tol.linear);
    parts.loops.push({ id, groups, points: () => flatten(c, dev).points.map(pt) });
  };
  const polyline = (p: Polyline) => {
    for (const s of explodePolyline(p)) curve(s);
    if (p.closed && p.vertices.length >= 2) loop(p);
  };
  const lines = (corners: readonly Vec2[], skip: (i: number) => boolean = () => false) => {
    for (let i = 0; i < corners.length; i++) {
      if (skip(i)) continue;
      const a = corners[i]!;
      const b = corners[(i + 1) % corners.length]!;
      if (a.x !== b.x || a.y !== b.y) curve({ kind: 'LINE', start: a, end: b });
    }
  };

  const g: EntityGeometry = e.geom;
  switch (g.kind) {
    case 'LINE':
    case 'ARC':
    case 'CIRCLE':
    case 'ELLIPSE':
    case 'XLINE':
    case 'RAY':
      curve(g);
      break;
    case 'SPLINE':
      curve(g, !g.closed);
      if (g.closed) loop(g);
      break;
    case 'LWPOLYLINE':
      polyline(g);
      break;
    case 'POLYLINE':
      polyline({
        kind: 'LWPOLYLINE',
        closed: g.closed,
        vertices: g.vertices.map((v) => ({ x: v.x, y: v.y, bulge: g.is3d ? 0 : v.bulge })),
      });
      break;
    case 'SOLID':
    case 'TRACE': {
      // Corners in DXF order; the outline is 1–2–4–3.
      const [a, b, c, d] = g.corners;
      lines([a, b, d, c]);
      break;
    }
    case '3DFACE':
      lines(g.corners, (i) => (g.hiddenEdges & (1 << i)) !== 0);
      break;
    case 'LEADER':
      for (let i = 0; i + 1 < g.vertices.length; i++) {
        curve({ kind: 'LINE', start: g.vertices[i]!, end: g.vertices[i + 1]! });
      }
      break;
    case 'POINT':
      point('NOD', g.position);
      break;
    case 'TEXT':
    case 'ATTDEF':
    case 'MTEXT':
      point('INS', textInsertion(g), depth === 0 ? boxNear : undefined);
      break;
    case 'INSERT':
      point('INS', g.position);
      for (const a of g.attributes) point('INS', a.position);
      if (depth < MAX_DEPTH) blockContents(ctx, g, m, id, groups, depth);
      break;
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      // NODe: the definition points (AutoCAD snaps to a dimension's "definition points").
      for (const p of definitionPoints(g)) point('NOD', p);
      if (g.block && depth < MAX_DEPTH) nested(ctx, g.block, m, id, groups, depth);
      break;
    }
    case 'PDFUNDERLAY':
      underlayParts(ctx, g, m, id, groups);
      break;
    case 'VIEWPORT':
      if (g.id !== 1) {
        const w = g.width / 2;
        const h = g.height / 2;
        const { x, y } = g.center;
        lines([
          { x: x - w, y: y - h },
          { x: x + w, y: y - h },
          { x: x + w, y: y + h },
          { x: x - w, y: y + h },
        ]);
      }
      break;
    default:
      // HATCH (OSNAPHATCH 0), images, tables, multileaders and the rest offer nothing yet.
      break;
  }
}

/**
 * A PDF underlay's page geometry under the aperture (M2-22), carried into the space shown by
 * `m`: the aperture's box taken back to page inches picks the page's curves, and a clipped
 * underlay's points must lie inside its boundary (on it counts).
 */
function underlayParts(
  ctx: Ctx,
  g: Extract<EntityGeometry, { readonly kind: 'PDFUNDERLAY' }>,
  m: Matrix2D,
  id: EntityId,
  groups: readonly number[],
): void {
  const { src, q, parts } = ctx;
  if (q.underlays === false || !src.underlays || g.definition === undefined) return;
  if (!underlayShown(g)) return;
  const page = src.underlays(g.definition);
  if (!page) return;
  let toShown: Matrix2D;
  let toPage: Matrix2D;
  try {
    toShown = identityOr(m, underlayMatrix(g));
    toPage = invert(toShown);
  } catch {
    return;
  }
  const r = q.aperture;
  const corners = [
    { x: q.point.x - r, y: q.point.y - r },
    { x: q.point.x + r, y: q.point.y - r },
    { x: q.point.x + r, y: q.point.y + r },
    { x: q.point.x - r, y: q.point.y + r },
  ].map((p) => applyPoint(toPage, p));
  let box: Box = {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
  const ring = underlayClipRing(g);
  let inside: ((p: Vec2) => boolean) | undefined;
  if (ring) {
    box = {
      minX: Math.max(box.minX, Math.min(...ring.map((p) => p.x))),
      minY: Math.max(box.minY, Math.min(...ring.map((p) => p.y))),
      maxX: Math.min(box.maxX, Math.max(...ring.map((p) => p.x))),
      maxY: Math.min(box.maxY, Math.max(...ring.map((p) => p.y))),
    };
    if (box.minX > box.maxX || box.minY > box.maxY) return;
    // Page inches per unit of the space shown. The aperture must reach what of the page
    // shows; then only points inside count, those on the boundary (within tolerance) too.
    const k = Math.sqrt(Math.abs(toShown.a * toShown.d - toShown.b * toShown.c));
    if (!insideRing(ring, applyPoint(toPage, q.point), r / k)) return;
    const eps = (src.tol.linear * 16) / k;
    inside = (p) => insideRing(ring, applyPoint(toPage, p), eps);
  }
  for (const c of underlaySnapCurves(page, box)) {
    try {
      const curve = transformCurve(c, toShown, src.tol);
      parts.curves.push({ id, groups, curve, ends: true, ...(inside && { inside }) });
    } catch {
      // A degenerate curve: nothing to snap to.
    }
  }
}

type TextGeometry = Extract<EntityGeometry, { readonly kind: 'TEXT' | 'ATTDEF' | 'MTEXT' }>;

const isText = (g: EntityGeometry): g is TextGeometry =>
  g.kind === 'TEXT' || g.kind === 'ATTDEF' || g.kind === 'MTEXT';

/** INSertion of text: the alignment point, except for left, aligned and fitted text. */
function textInsertion(g: TextGeometry): Vec2 {
  if (g.kind === 'MTEXT') return g.position;
  const first = g.halign === 0 || g.halign === 3 || g.halign === 5;
  return !first && g.alignmentPoint ? g.alignmentPoint : g.position;
}

function definitionPoints(g: Extract<EntityGeometry, { readonly definitionPoint: Vec2 }>): Vec2[] {
  const out = [g.definitionPoint];
  const any = g as unknown as Record<string, unknown>;
  for (const k of [
    'first',
    'second',
    'line1Start',
    'line1End',
    'line2Start',
    'arcPoint',
    'vertex',
    'chordPoint',
    'feature',
    'leaderEnd',
    'center',
  ]) {
    const v = any[k] as Vec2 | undefined;
    if (v && typeof v.x === 'number' && typeof v.y === 'number') out.push(v);
  }
  return out;
}

/**
 * Block coordinates → the INSERT's owner's coordinates, one transform per MINSERT cell: to the
 * insertion point, turned, stepped to the cell, scaled, with the base point at the origin. The
 * same transform the renderer draws block references with (render/blocks.ts insertTransforms).
 */
export function insertMatrices(g: InsertGeometry, base: Vec2, limit = MAX_CELLS): Matrix2D[] {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const sx = g.scale.x;
  const sy = g.scale.y;
  const cols = g.array ? g.array.columns : 1;
  const rows = g.array ? g.array.rows : 1;
  const out: Matrix2D[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (out.length >= limit) return out;
      const tx = (g.array ? col * g.array.columnSpacing : 0) - sx * base.x;
      const ty = (g.array ? row * g.array.rowSpacing : 0) - sy * base.y;
      out.push({
        a: cos * sx,
        b: sin * sx,
        c: -sin * sy,
        d: cos * sy,
        e: g.position.x + cos * tx - sin * ty,
        f: g.position.y + sin * tx + cos * ty,
      });
    }
  }
  return out;
}

function blockContents(
  ctx: Ctx,
  g: InsertGeometry,
  m: Matrix2D,
  id: EntityId,
  groups: readonly number[],
  depth: number,
): void {
  const def = ctx.src.model.blocks.get(g.block);
  if (!def) return;
  for (const t of insertMatrices(g, def.basePoint)) {
    nested(ctx, g.block, identityOr(m, t), id, groups, depth);
  }
}

const identityOr = (outer: Matrix2D, inner: Matrix2D): Matrix2D =>
  outer === IDENTITY ? inner : compose(inner, outer);

/** The entities of `block` under the aperture, `m` taking block coordinates to the space shown. */
function nested(
  ctx: Ctx,
  block: Handle,
  m: Matrix2D,
  id: EntityId,
  groups: readonly number[],
  depth: number,
): void {
  const { src, q } = ctx;
  if (!src.model.hasBlock(block)) return;
  let inv: Matrix2D;
  try {
    inv = invert(m);
  } catch {
    return;
  }
  const r = q.aperture;
  const corners = [
    { x: q.point.x - r, y: q.point.y - r },
    { x: q.point.x + r, y: q.point.y - r },
    { x: q.point.x + r, y: q.point.y + r },
    { x: q.point.x - r, y: q.point.y + r },
  ].map((p) => applyPoint(inv, p));
  const box: Box = {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
  for (const inner of src.index.query(block, box)) {
    const e = src.model.entity(inner);
    if (!e || !shown(src.model, e, ctx.frozen)) continue;
    addEntity(ctx, e, m, id, groups, depth + 1, undefined);
  }
}
