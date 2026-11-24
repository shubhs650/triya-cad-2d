// Constraint bars (M9-05 part 2): where the drawing's geometric constraints show. AutoCAD 2024
// Help, "About Displaying and Verifying Geometric Constraints": "A constraint bar displays one or
// more icons that represent the geometric constraints applied to an object", and "To reduce
// clutter, Coincident constraints display by default as small, blue squares". A bar's default
// place is "near the midpoint of the entity" (BricsCAD's CONSTRAINTBAR Reset; AutoCAD's Help
// says only "their default locations"), so each object's bar is laid out from its midpoint, off
// to one side: below a line (right of a vertical one), outside an arc, below a circle, below a
// spline or elliptical arc at its middle parameter (as a line through it there). A
// polyline's segments each have their own bar, as AutoCAD constrains them one by one.
//
// The renderer draws the bars at a fixed size on screen (`render/constraint-bars.ts`); which ones
// show (CONSTRAINTBAR's Show and Hide, CONSTRAINTBARMODE's kinds, CONSTRAINTBARDISPLAY) is the
// app's display state, not the drawing's: AutoCAD's Help does not say a bar's visibility is
// saved, and BricsCAD's says bars "are initially hidden when a drawing is opened".
import {
  derivativeAt,
  domain,
  pointAt as curvePointAt,
  polylineSegment,
  polylineSegmentCount,
} from '../geom/eval';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  ConstraintRef,
  Entity,
  GeometricConstraintKind,
  GeometricConstraintObject,
} from '../model/types';
import { constraintPointsOf, geometricConstraints } from './constraints';

/** One icon of a bar: a geometric constraint and the objects it constrains. */
export interface ConstraintBarIcon {
  readonly handle: Handle;
  readonly kind: GeometricConstraintKind;
  readonly entities: readonly Handle[];
}

/** An object's constraint bar (a polyline segment's, with `segment`). */
export interface ConstraintBar {
  readonly entity: Handle;
  readonly segment?: number;
  /** The object's midpoint, which the bar is laid out from. */
  readonly anchor: Vec2;
  /** The unit direction from the anchor the bar sits off in. */
  readonly side: Vec2;
  readonly icons: readonly ConstraintBarIcon[];
}

/** A Coincident constraint's small square, at the point it holds together. */
export interface CoincidentMark {
  readonly handle: Handle;
  readonly at: Vec2;
  readonly entities: readonly Handle[];
}

export interface ConstraintBars {
  readonly bars: readonly ConstraintBar[];
  readonly marks: readonly CoincidentMark[];
}

/**
 * CONSTRAINTBARMODE's bits (AutoCAD 2024 Help, "CONSTRAINTBARMODE (System Variable)", "Saved
 * in: Registry", initially 4095): which kinds of geometric constraint the bars show.
 */
export const CONSTRAINT_BAR_BITS: Readonly<Record<GeometricConstraintKind, number>> = {
  horizontal: 1,
  vertical: 2,
  perpendicular: 4,
  parallel: 8,
  tangent: 16,
  smooth: 32,
  coincident: 64,
  concentric: 128,
  collinear: 256,
  symmetric: 512,
  equal: 1024,
  fix: 2048,
};

/** Every kind shown, CONSTRAINTBARMODE's initial value. */
export const CONSTRAINT_BAR_ALL = 4095;

type Lookup = (handle: Handle) => Entity | undefined;

const isPoint = (r: ConstraintRef): r is Extract<ConstraintRef, { point: string }> => 'point' in r;

/** The segment of a polyline a reference names, or undefined for a whole object. */
function segmentOf(r: ConstraintRef, e: Entity): number | undefined {
  const g = e.geom;
  if (g.kind !== 'LWPOLYLINE') return undefined;
  const n = polylineSegmentCount(g);
  if (n === 0) return undefined;
  const clamp = (i: number) => Math.min(Math.max(i, 0), n - 1);
  if (!isPoint(r)) return clamp(r.segment ?? 0);
  if (r.point === 'start') return 0;
  if (r.point === 'end') return g.closed ? 0 : n - 1;
  return clamp(r.index ?? 0);
}

const unit = (v: Vec2): Vec2 => {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: -1 };
};

/**
 * Below a line, or right of a vertical one: of the line's two normals, the one pointing down,
 * the one pointing right when neither does.
 */
function lineSide(a: Vec2, b: Vec2): Vec2 {
  const n = unit({ x: b.y - a.y, y: a.x - b.x });
  if (Math.abs(n.y) > 1e-9) return n.y < 0 ? n : { x: -n.x, y: -n.y };
  return n.x > 0 ? n : { x: -n.x, y: -n.y };
}

function arcPlace(center: Vec2, radius: number, start: number, sweep: number) {
  const a = start + sweep / 2;
  const side = { x: Math.cos(a), y: Math.sin(a) };
  return {
    anchor: { x: center.x + radius * side.x, y: center.y + radius * side.y },
    side,
  };
}

/** Where `e`'s bar (its `segment`'s) is laid out from; undefined for one constraints cannot take. */
export function barPlace(
  e: Entity,
  segment: number | undefined,
): { anchor: Vec2; side: Vec2 } | undefined {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE':
      return {
        anchor: { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 },
        side: lineSide(g.start, g.end),
      };
    case 'CIRCLE':
      return { anchor: { x: g.center.x, y: g.center.y - g.radius }, side: { x: 0, y: -1 } };
    case 'ARC': {
      let sweep = g.endAngle - g.startAngle;
      while (sweep <= 0) sweep += 2 * Math.PI;
      return arcPlace(g.center, g.radius, g.startAngle, sweep);
    }
    case 'POINT':
      return { anchor: g.position, side: unit({ x: 1, y: -1 }) };
    case 'SPLINE':
    case 'ELLIPSE': {
      const d = domain(g);
      const t = (d.start + d.end) / 2;
      const anchor = curvePointAt(g, t);
      const dir = derivativeAt(g, t);
      if (dir.x === 0 && dir.y === 0) return { anchor, side: { x: 0, y: -1 } };
      return { anchor, side: lineSide(anchor, { x: anchor.x + dir.x, y: anchor.y + dir.y }) };
    }
    case 'LWPOLYLINE': {
      if (segment === undefined || segment >= polylineSegmentCount(g)) return undefined;
      const s = polylineSegment(g, segment);
      if ('line' in s) {
        return {
          anchor: { x: (s.line.a.x + s.line.b.x) / 2, y: (s.line.a.y + s.line.b.y) / 2 },
          side: lineSide(s.line.a, s.line.b),
        };
      }
      const { center, radius, startAngle, sweep } = s.arc;
      return arcPlace(center, radius, startAngle, sweep);
    }
    default:
      return undefined;
  }
}

/** Where a point reference is, as the constraint display reads it. */
function pointAt(r: ConstraintRef, lookup: Lookup): Vec2 | undefined {
  if (!isPoint(r)) return undefined;
  const e = lookup(r.entity);
  if (!e) return undefined;
  if (e.geom.kind === 'LWPOLYLINE' && (r.point === 'start' || r.point === 'end')) {
    const v = e.geom.vertices;
    if (v.length === 0) return undefined;
    return r.point === 'start' || e.geom.closed ? v[0]! : v[v.length - 1]!;
  }
  return constraintPointsOf(e).find(
    (p) => p.ref.point === r.point && (p.ref.index ?? -1) === (r.index ?? -1),
  )?.at;
}

/** The objects `c` names, each once, in the order picked. */
export function constrainedEntities(c: GeometricConstraintObject): Handle[] {
  return [...new Set(c.refs.map((r) => r.entity))];
}

/**
 * The drawing's constraint bars and coincident squares, the bars in the order their objects were
 * first constrained and each bar's icons in the order its constraints were applied. A constraint
 * on an object that is gone is left out.
 */
export function constraintBars(
  model: DocumentModel,
  constraints: readonly GeometricConstraintObject[] = geometricConstraints(model),
): ConstraintBars {
  const lookup: Lookup = (h) => model.entityByHandle(h);
  const bars = new Map<string, { entity: Handle; segment?: number; icons: ConstraintBarIcon[] }>();
  const marks: CoincidentMark[] = [];
  for (const c of constraints) {
    const entities = constrainedEntities(c);
    if (entities.some((h) => !lookup(h))) continue;
    if (c.kind === 'coincident') {
      const at = c.refs.map((r) => pointAt(r, lookup)).find((p) => p !== undefined);
      if (at) marks.push({ handle: c.handle, at, entities });
      continue;
    }
    const icon: ConstraintBarIcon = { handle: c.handle, kind: c.kind, entities };
    const seen = new Set<string>();
    for (const r of c.refs) {
      const segment = segmentOf(r, lookup(r.entity)!);
      const key = `${r.entity}:${segment ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let bar = bars.get(key);
      if (!bar) {
        bar = { entity: r.entity, ...(segment !== undefined && { segment }), icons: [] };
        bars.set(key, bar);
      }
      bar.icons.push(icon);
    }
  }
  const out: ConstraintBar[] = [];
  for (const b of bars.values()) {
    const place = barPlace(lookup(b.entity)!, b.segment);
    if (place) out.push({ ...b, ...place });
  }
  return { bars: out, marks };
}

/** The objects any geometric constraint names: what Showall and Hideall show or hide. */
export function constrainedObjects(model: DocumentModel): Handle[] {
  const out = new Set<Handle>();
  for (const c of geometricConstraints(model)) for (const h of constrainedEntities(c)) out.add(h);
  return [...out];
}
