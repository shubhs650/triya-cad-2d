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
// - EXTension and PARallel need points acquired by hovering, as object snap tracking does
//   (OTRACK); they are accepted in `modes` and offer nothing until then (M2-04 part 2).
// - Hatches are ignored (OSNAPHATCH 0, AutoCAD's default). Block references are snapped into,
//   nested blocks too; a hit names the object of the space shown.
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
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, EntityGeometry, InsertGeometry } from '../model/types';
import type { SpatialIndex } from '../spatial/spatial-index';

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
}

export interface OsnapHit {
  readonly mode: OsnapMode;
  readonly point: Vec2;
  /** The object of the space shown the point belongs to (a block reference for its contents). */
  readonly id: EntityId;
}

/** Block nesting followed, and MINSERT cells taken per reference, before giving up. */
const MAX_DEPTH = 8;
const MAX_CELLS = 1024;
/** Objects under the aperture paired for INT and APP: the nearest this many. */
const MAX_PAIRED = 48;

type Simple = Line | Arc | Circle | Ellipse | Spline | Curve;

interface CurvePart {
  readonly id: EntityId;
  readonly groups: readonly number[];
  readonly curve: Simple;
  /** Offers its ends to END (a polyline's segments do; a closed spline does not). */
  readonly ends: boolean;
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
  /** The closed outline, flattened, for its centroid (GCE). */
  readonly points: readonly Vec2[];
}

interface Parts {
  readonly curves: CurvePart[];
  readonly points: PointPart[];
  readonly loops: LoopPart[];
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

  for (const { part, nearest } of near) {
    curvePoints(part, q, src.tol, add, on);
    add('NEA', nearest, part.id);
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
      const c = centroid(loop.points);
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
            if (distance(x.point, q.point) <= q.aperture) add('INT', x.point, a.id);
          }
        }
        if (on('APP')) {
          for (const x of intersect(extended(a.curve), extended(b.curve), src.tol)) {
            if (distance(x.point, q.point) <= q.aperture) add('APP', x.point, a.id);
          }
        }
      }
    }
  }
  return rank(out, q, src.tol);
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
  const parts: Parts = { curves: [], points: [], loops: [] };
  const r = q.aperture;
  const box: Box = {
    minX: q.point.x - r,
    minY: q.point.y - r,
    maxX: q.point.x + r,
    maxY: q.point.y + r,
  };
  const ctx: Ctx = { src, q, parts, nextGroup: 0 };
  for (const id of src.index.query(src.block, box)) {
    const e = src.model.entity(id);
    if (!e || !shown(src.model, e)) continue;
    let near: boolean | undefined;
    const b = src.index.bounds(id);
    if (b?.kind === 'box') near = boxDistance(b.box, q.point) <= r;
    addEntity(ctx, e, IDENTITY, id, [], 0, near);
  }
  return parts;
}

interface Ctx {
  readonly src: OsnapSource;
  readonly q: OsnapQuery;
  readonly parts: Parts;
  nextGroup: number;
}

/** Visible, on a layer neither off nor frozen. */
function shown(model: DocumentModel, e: Entity): boolean {
  if (!e.visible) return false;
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
  const polyline = (p: Polyline) => {
    for (const s of explodePolyline(p)) curve(s);
    if (p.closed && p.vertices.length >= 2) {
      try {
        const f = flatten(p, Math.max(ctx.q.aperture * 1e-3, src.tol.linear));
        parts.loops.push({ id, groups, points: f.points.map(pt) });
      } catch {
        // A polyline whose segments cannot be flattened has no centroid to offer.
      }
    }
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
      if (g.closed) {
        try {
          const f = flatten(g, Math.max(ctx.q.aperture * 1e-3, src.tol.linear));
          parts.loops.push({ id, groups, points: f.points.map(pt) });
        } catch {
          // No centroid for a spline that cannot be flattened.
        }
      }
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
    case 'ATTDEF': {
      // INSertion: the alignment point, except for left, aligned and fitted text.
      const first = g.halign === 0 || g.halign === 3 || g.halign === 5;
      const p = !first && g.alignmentPoint ? g.alignmentPoint : g.position;
      point('INS', p, depth === 0 ? boxNear : undefined);
      break;
    }
    case 'MTEXT':
      point('INS', g.position, depth === 0 ? boxNear : undefined);
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
    if (!e || !shown(src.model, e)) continue;
    addEntity(ctx, e, m, id, groups, depth + 1, undefined);
  }
}
