// Dimensional constraints (M9-03): their kinds, and what each measures on the drawing.
//
// AutoCAD's DIMCONSTRAINT (AutoCAD 2024 Help) puts a value on a distance or angle:
//  - Linear: the horizontal or vertical distance between two points, or a line's ends;
//    DCLINEAR picks which from where the dimension line goes, and without one here from the
//    points (horizontal when they are at least as far apart across as up).
//  - Horizontal, Vertical: as Linear, the direction given.
//  - Aligned: between two points, a point and a line (to the line, extended), a line's
//    length, or two lines (2Line: the second made parallel to the first, the distance
//    between them).
//  - Angular: between two lines, an arc's included angle, or three points (vertex, first
//    and second point).
//  - Radial, Diameter: a circle's or arc's.
// A distance must be more than zero and an angle between 0 and 360 degrees. The Help does
// not give the range; these are the values a drafter can draw, and a zero distance or angle
// would collapse the geometry.
//
// Angles are in degrees, as the Parameters Manager shows them and expressions use them
// (expression.ts); the solver gets radians.

import {
  bulgeArc,
  ccwSweep,
  ellipseSweep,
  pointAt,
  polylineSegmentCount,
  TAU,
  type Entity,
  type Handle,
  type Vec2,
} from '@triya/engine';
import { isPointRef, type CurveRef, type GeomRef, type PointRef } from './model';

/** AutoCAD's dimensional constraints, in DIMCONSTRAINT's prompt order. */
export const DIMENSIONAL_KINDS = [
  'linear',
  'horizontal',
  'vertical',
  'aligned',
  'angular',
  'radial',
  'diameter',
] as const;
export type DimensionalKind = (typeof DIMENSIONAL_KINDS)[number];

/** The kind a dimensional constraint keeps: Linear becomes Horizontal or Vertical. */
export type StoredDimensionalKind = Exclude<DimensionalKind, 'linear'>;

/**
 * One dimensional constraint. `refs` as DIMCONSTRAINT picks them: Horizontal and Vertical two
 * points or a line; Aligned two points, a point and a line, a line, or two lines; Angular two
 * lines, an arc, or three points (the vertex first); Radial and Diameter a circle or arc.
 * Polyline segments count as lines and arcs. Its value is the parameter `parameter` of the
 * model's ParameterTable.
 */
export interface DimensionalConstraint {
  readonly handle: Handle;
  readonly dimension: StoredDimensionalKind;
  readonly refs: readonly GeomRef[];
  readonly parameter: string;
  /**
   * AutoCAD's Reference property: the constraint does not drive the geometry; its parameter
   * shows the measured value and cannot be edited.
   */
  readonly reference?: boolean;
}

/** The Parameters Manager's Type column for each kind. */
export const DIMENSION_TYPE: Record<StoredDimensionalKind, string> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  aligned: 'Aligned',
  angular: 'Angular',
  radial: 'Radial',
  diameter: 'Diameter',
};

/** The prefix of a new constraint's parameter name: d1, ang1, rad1, dia1. */
export const DIMENSION_PREFIX: Record<StoredDimensionalKind, string> = {
  horizontal: 'd',
  vertical: 'd',
  aligned: 'd',
  angular: 'ang',
  radial: 'rad',
  diameter: 'dia',
};

export type Measurement =
  | { readonly ok: true; readonly dimension: StoredDimensionalKind; readonly value: number }
  | { readonly ok: false; readonly reason: 'unsupported' | 'invalid'; readonly message: string };

/** What a dimensional constraint measures on the drawing now (Linear resolved). */
export function measureDimension(
  c: { readonly dimension: DimensionalKind; readonly refs: readonly GeomRef[] },
  lookup: (handle: Handle) => Entity | undefined,
): Measurement {
  try {
    const shape = dimensionShape(c, lookup);
    return { ok: true, dimension: shape.dimension, value: shape.value };
  } catch (e) {
    if (e instanceof MeasureError) return { ok: false, reason: e.reason, message: e.message };
    throw e;
  }
}

/** Whether `value` is one a constraint of this kind can take; else why not. */
export function dimensionValueError(
  dimension: StoredDimensionalKind,
  value: number | undefined,
): string | undefined {
  if (value === undefined) return 'The expression has no value.';
  if (dimension === 'angular') {
    return value > 0 && value < 360 ? undefined : 'An angle must be between 0 and 360 degrees.';
  }
  return value > 0 ? undefined : 'A distance must be greater than 0.';
}

/** A measured value written as the expression of a parameter that has none typed. */
export function formatMeasured(value: number): string {
  // 12 significant digits: past the solver's tolerance, short of floating-point noise.
  return String(Number(value.toPrecision(12)));
}

// ── The geometry a constraint measures ──────────────────────────────────────────────────────

export class MeasureError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export interface Line {
  readonly a: Vec2;
  readonly b: Vec2;
  /** The references to its first and second end (a LINE's start and end, a segment's vertices). */
  readonly startRef: PointRef;
  readonly endRef: PointRef;
}

export interface Circular {
  readonly center: Vec2;
  readonly radius: number;
  /** Included angle, radians; undefined for a circle. */
  readonly sweep?: number;
  /**
   * What holds it while its radius changes: an ARC's or CIRCLE's centre, a polyline arc
   * segment's first vertex (its centre moves with the bulge).
   */
  readonly anchor: PointRef;
  readonly centerRef: PointRef;
  /** An arc's start point (ARC), or a polyline arc segment's first vertex. */
  readonly startRef?: PointRef;
  /** An arc's end point (ARC), or a polyline arc segment's second vertex (M9-03 part 11). */
  readonly endRef?: PointRef;
}

export interface LineAngle {
  /** The angle between the lines as drawn, from the first to the second, degrees in (0, 180]. */
  readonly degrees: number;
  /** +1 when the second line is counter-clockwise from the first. */
  readonly sign: 1 | -1;
  /** Whether a line runs into the corner (its end nearer the lines' crossing than its start). */
  readonly flipA: boolean;
  readonly flipB: boolean;
}

export interface DimensionShape {
  readonly dimension: StoredDimensionalKind;
  readonly value: number;
  /** What stays while a new constraint or value is first solved (AutoCAD: the second object adjusts). */
  readonly holds: readonly GeomRef[];
}

type Lookup = (handle: Handle) => Entity | undefined;

/** The measured value of a constraint and what to hold while it is solved. */
export function dimensionShape(
  c: { readonly dimension: DimensionalKind; readonly refs: readonly GeomRef[] },
  lookup: Lookup,
): DimensionShape {
  const refs = c.refs;
  const arity = (...counts: number[]) => {
    if (!counts.includes(refs.length)) {
      throw new MeasureError('invalid', `${c.dimension} takes ${counts.join(' or ')} references`);
    }
  };
  switch (c.dimension) {
    case 'linear':
    case 'horizontal':
    case 'vertical': {
      arity(1, 2);
      const [p, q, hold] =
        refs.length === 1
          ? (() => {
              const l = resolveLine(refs[0]!, lookup);
              return [l.a, l.b, l.startRef] as const;
            })()
          : [resolvePoint(refs[0]!, lookup), resolvePoint(refs[1]!, lookup), refs[0]!];
      if (refs.length === 2) distinct(refs[0]!, refs[1]!);
      const dx = Math.abs(q.x - p.x);
      const dy = Math.abs(q.y - p.y);
      const dimension =
        c.dimension === 'linear' ? (dx >= dy ? 'horizontal' : 'vertical') : c.dimension;
      return { dimension, value: dimension === 'horizontal' ? dx : dy, holds: [hold] };
    }
    case 'aligned': {
      arity(1, 2);
      if (refs.length === 1) {
        const l = resolveLine(refs[0]!, lookup);
        return { dimension: 'aligned', value: dist(l.a, l.b), holds: [l.startRef] };
      }
      const [r0, r1] = refs as [GeomRef, GeomRef];
      if (isPointRef(r0) && isPointRef(r1)) {
        distinct(r0, r1);
        const value = dist(resolvePoint(r0, lookup), resolvePoint(r1, lookup));
        return { dimension: 'aligned', value, holds: [r0] };
      }
      if (isPointRef(r0) !== isPointRef(r1)) {
        const [p, l] = isPointRef(r0) ? [r0, r1 as CurveRef] : [r1 as PointRef, r0];
        const line = resolveLine(l, lookup);
        const value = toLine(resolvePoint(p, lookup), line);
        return { dimension: 'aligned', value, holds: [r0] };
      }
      const a = resolveLine(r0, lookup);
      const b = resolveLine(r1, lookup);
      if (sameCurve(r0, r1)) throw new MeasureError('invalid', 'aligned needs two different lines');
      return { dimension: 'aligned', value: toLine(b.a, a), holds: [r0] };
    }
    case 'angular': {
      arity(1, 2, 3);
      if (refs.length === 1) {
        const arc = resolveCircular(refs[0]!, lookup);
        if (arc.sweep === undefined) {
          throw new MeasureError('invalid', 'angular takes an arc, not a circle');
        }
        return {
          dimension: 'angular',
          value: arc.sweep * DEG,
          holds: [arc.centerRef, arc.startRef!],
        };
      }
      if (refs.length === 2) {
        const [r0, r1] = refs as [GeomRef, GeomRef];
        const a = resolveLine(r0, lookup);
        const b = resolveLine(r1, lookup);
        if (sameCurve(r0, r1)) {
          throw new MeasureError('invalid', 'angular needs two different lines');
        }
        const angle = lineAngle(a, b);
        if (!angle) throw new MeasureError('invalid', 'the lines are parallel');
        // The second line turns about its end at the corner.
        return {
          dimension: 'angular',
          value: angle.degrees,
          holds: [r0, angle.flipB ? b.endRef : b.startRef],
        };
      }
      const [v, p, q] = refs.map((r) => resolvePoint(r, lookup)) as [Vec2, Vec2, Vec2];
      distinct(refs[0]!, refs[1]!);
      distinct(refs[0]!, refs[2]!);
      const theta = pointAngle(v, p, q);
      if (theta === undefined) {
        throw new MeasureError('invalid', 'the points must be away from the vertex');
      }
      return { dimension: 'angular', value: Math.abs(theta) * DEG, holds: [refs[0]!, refs[1]!] };
    }
    case 'radial':
    case 'diameter': {
      arity(1);
      const circ = resolveCircular(refs[0]!, lookup);
      const value = c.dimension === 'radial' ? circ.radius : 2 * circ.radius;
      return { dimension: c.dimension, value, holds: [circ.anchor] };
    }
    default:
      throw new MeasureError('invalid', `unknown dimensional constraint ${String(c.dimension)}`);
  }
}

/** The side of a dimensional constraint whose object adjusts as its value is set. */
export type DimensionSide = 'first' | 'second';

/**
 * What to hold while a constraint's new value is solved, `side` adjusting (M9-03 part 11): the
 * second side is AutoCAD's way with a value typed (`dimensionShape`'s holds); the first is a
 * triangular grip at the first object's end dragged, which holds the second object instead: a
 * distance keeps its second point (a line's end), an angle its second line, second point or
 * arc end. A radius or diameter has one side.
 */
export function dimensionHolds(
  c: { readonly dimension: DimensionalKind; readonly refs: readonly GeomRef[] },
  lookup: Lookup,
  side: DimensionSide = 'second',
): readonly GeomRef[] {
  const shape = dimensionShape(c, lookup);
  if (side === 'second') return shape.holds;
  const refs = c.refs;
  switch (shape.dimension) {
    case 'horizontal':
    case 'vertical':
    case 'aligned':
      return refs.length === 1 ? [resolveLine(refs[0]!, lookup).endRef] : [refs[1]!];
    case 'angular': {
      if (refs.length === 1) {
        const arc = resolveCircular(refs[0]!, lookup);
        return [arc.centerRef, arc.endRef!];
      }
      if (refs.length === 2) {
        const a = resolveLine(refs[0]!, lookup);
        const b = resolveLine(refs[1]!, lookup);
        const angle = lineAngle(a, b)!;
        // The first line turns about its end at the corner.
        return [refs[1]!, angle.flipA ? a.endRef : a.startRef];
      }
      return [refs[0]!, refs[2]!];
    }
    default:
      return shape.holds;
  }
}

const DEG = 180 / Math.PI;

/**
 * The angle between two lines as drawn: from the lines' crossing (extended when they do not
 * reach it) along each line toward its far end. Undefined for parallel lines.
 */
export function lineAngle(
  a: { readonly a: Vec2; readonly b: Vec2 },
  b: { readonly a: Vec2; readonly b: Vec2 },
): LineAngle | undefined {
  const da = { x: a.b.x - a.a.x, y: a.b.y - a.a.y };
  const db = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
  const denom = da.x * db.y - da.y * db.x;
  const la = Math.hypot(da.x, da.y);
  const lb = Math.hypot(db.x, db.y);
  if (la === 0 || lb === 0 || Math.abs(denom) <= 1e-12 * la * lb) return undefined;
  // The crossing: a.a + t·da.
  const t = ((b.a.x - a.a.x) * db.y - (b.a.y - a.a.y) * db.x) / denom;
  const x = { x: a.a.x + t * da.x, y: a.a.y + t * da.y };
  const flipA = dist(a.b, x) < dist(a.a, x);
  const flipB = dist(b.b, x) < dist(b.a, x);
  const ra = flipA ? { x: -da.x, y: -da.y } : da;
  const rb = flipB ? { x: -db.x, y: -db.y } : db;
  const theta = Math.atan2(ra.x * rb.y - ra.y * rb.x, ra.x * rb.x + ra.y * rb.y);
  return { degrees: Math.abs(theta) * DEG, sign: theta >= 0 ? 1 : -1, flipA, flipB };
}

/** The signed angle at `v` from `p` to `q`, radians in (−π, π]; undefined at the vertex. */
export function pointAngle(v: Vec2, p: Vec2, q: Vec2): number | undefined {
  const u = { x: p.x - v.x, y: p.y - v.y };
  const w = { x: q.x - v.x, y: q.y - v.y };
  if ((u.x === 0 && u.y === 0) || (w.x === 0 && w.y === 0)) return undefined;
  return Math.atan2(u.x * w.y - u.y * w.x, u.x * w.x + u.y * w.y);
}

// ── Resolving references on the drawing ─────────────────────────────────────────────────────

const describe = (ref: GeomRef) =>
  isPointRef(ref)
    ? `${ref.point}${ref.index === undefined ? '' : ` ${ref.index}`} of ${ref.entity}`
    : `${ref.entity}${ref.segment === undefined ? '' : ` segment ${ref.segment}`}`;

function entityOf(ref: GeomRef, lookup: Lookup): Entity {
  const e = lookup(ref.entity);
  if (!e) throw new MeasureError('invalid', `there is no entity ${ref.entity}`);
  const kind = e.geom.kind;
  if (
    kind !== 'LINE' &&
    kind !== 'CIRCLE' &&
    kind !== 'ARC' &&
    kind !== 'POINT' &&
    kind !== 'LWPOLYLINE' &&
    kind !== 'SPLINE' &&
    kind !== 'ELLIPSE'
  ) {
    throw new MeasureError('unsupported', `${kind} cannot be constrained yet`);
  }
  return e;
}

export function resolvePoint(ref: GeomRef, lookup: Lookup): Vec2 {
  if (!isPointRef(ref)) throw new MeasureError('invalid', `${describe(ref)} is not a point`);
  const g = entityOf(ref, lookup).geom;
  const bad = () => new MeasureError('invalid', `there is no ${describe(ref)}`);
  const mid = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  switch (g.kind) {
    case 'LINE':
      if (ref.point === 'start') return g.start;
      if (ref.point === 'end') return g.end;
      if (ref.point === 'mid') return mid(g.start, g.end);
      throw bad();
    case 'CIRCLE':
      if (ref.point === 'center') return g.center;
      throw bad();
    case 'ARC': {
      const at = (t: number) => ({
        x: g.center.x + g.radius * Math.cos(t),
        y: g.center.y + g.radius * Math.sin(t),
      });
      if (ref.point === 'center') return g.center;
      if (ref.point === 'start') return at(g.startAngle);
      if (ref.point === 'end') return at(g.endAngle);
      if (ref.point === 'mid') return at(g.startAngle + ccwSweep(g.startAngle, g.endAngle) / 2);
      throw bad();
    }
    case 'SPLINE': {
      // An open, clamped spline's ends are its first and last control points (model.ts).
      const c = g.controlPoints;
      const k = g.knots;
      const eps = 1e-9 * Math.max(1, Math.abs(k[k.length - 1]! - k[0]!));
      const clamped = (knots: readonly number[]) =>
        knots.every((u) => Math.abs(u - knots[0]!) <= eps);
      if (g.closed || g.periodic || !c.length) throw bad();
      if (ref.point === 'start' && clamped(k.slice(0, g.degree + 1))) return c[0]!;
      if (ref.point === 'end' && clamped(k.slice(k.length - g.degree - 1))) return c[c.length - 1]!;
      throw bad();
    }
    case 'ELLIPSE': {
      // Its centre, its axes' ends by quadrant, and an elliptical arc's ends (model.ts).
      const arc = ellipseSweep(g) !== TAU;
      const i = ref.index ?? -1;
      if (ref.point === 'center') return g.center;
      if (ref.point === 'start' && arc) return pointAt(g, g.startParam);
      if (ref.point === 'end' && arc) return pointAt(g, g.startParam + ellipseSweep(g));
      if (ref.point === 'quadrant' && Number.isInteger(i) && i >= 0 && i < 4) {
        return pointAt(g, (i * Math.PI) / 2);
      }
      throw bad();
    }
    case 'POINT':
      if (ref.point === 'position') return g.position;
      throw bad();
    case 'LWPOLYLINE': {
      const v = g.vertices;
      if (ref.point === 'start' && v.length) return v[0]!;
      if (ref.point === 'end' && v.length) return g.closed ? v[0]! : v[v.length - 1]!;
      const i = ref.index ?? -1;
      if (ref.point === 'vertex' && v[i]) return v[i];
      if (i >= 0 && i < polylineSegmentCount(g)) {
        const p = v[i]!;
        const q = v[(i + 1) % v.length]!;
        if (ref.point === 'mid' && p.bulge === 0) return mid(p, q);
        if (ref.point === 'mid') {
          const a = bulgeArc(p, q, p.bulge);
          const t = a.startAngle + a.sweep / 2;
          return { x: a.center.x + a.radius * Math.cos(t), y: a.center.y + a.radius * Math.sin(t) };
        }
        if (ref.point === 'center' && p.bulge !== 0) return bulgeArc(p, q, p.bulge).center;
      }
      throw bad();
    }
    default:
      throw bad();
  }
}

export function resolveLine(ref: GeomRef, lookup: Lookup): Line {
  if (isPointRef(ref)) throw new MeasureError('invalid', `${describe(ref)} is not a line`);
  const g = entityOf(ref, lookup).geom;
  const notLine = () => new MeasureError('invalid', `${describe(ref)} is not a line`);
  if (g.kind === 'LINE' && ref.segment === undefined) {
    return {
      a: g.start,
      b: g.end,
      startRef: { entity: ref.entity, point: 'start' },
      endRef: { entity: ref.entity, point: 'end' },
    };
  }
  if (g.kind === 'LWPOLYLINE' && ref.segment !== undefined) {
    const i = ref.segment;
    if (i < 0 || i >= polylineSegmentCount(g)) throw notLine();
    const j = (i + 1) % g.vertices.length;
    const p = g.vertices[i]!;
    if (p.bulge !== 0) throw notLine();
    return {
      a: p,
      b: g.vertices[j]!,
      startRef: { entity: ref.entity, point: 'vertex', index: i },
      endRef: { entity: ref.entity, point: 'vertex', index: j },
    };
  }
  throw notLine();
}

export function resolveCircular(ref: GeomRef, lookup: Lookup): Circular {
  const notCircular = () => new MeasureError('invalid', `${describe(ref)} is not a circle or arc`);
  if (isPointRef(ref)) throw notCircular();
  const g = entityOf(ref, lookup).geom;
  if (ref.segment === undefined) {
    if (g.kind === 'CIRCLE') {
      const center: PointRef = { entity: ref.entity, point: 'center' };
      return { center: g.center, radius: g.radius, anchor: center, centerRef: center };
    }
    if (g.kind === 'ARC') {
      const center: PointRef = { entity: ref.entity, point: 'center' };
      return {
        center: g.center,
        radius: g.radius,
        sweep: ccwSweep(g.startAngle, g.endAngle),
        anchor: center,
        centerRef: center,
        startRef: { entity: ref.entity, point: 'start' },
        endRef: { entity: ref.entity, point: 'end' },
      };
    }
    throw notCircular();
  }
  if (g.kind !== 'LWPOLYLINE') throw notCircular();
  const i = ref.segment;
  if (i < 0 || i >= polylineSegmentCount(g)) throw notCircular();
  const p = g.vertices[i]!;
  const q = g.vertices[(i + 1) % g.vertices.length]!;
  if (p.bulge === 0) throw notCircular();
  const arc = bulgeArc(p, q, p.bulge);
  const first: PointRef = { entity: ref.entity, point: 'vertex', index: i };
  return {
    center: arc.center,
    radius: arc.radius,
    sweep: Math.abs(arc.sweep),
    anchor: first,
    centerRef: { entity: ref.entity, point: 'center', index: i },
    startRef: first,
    endRef: { entity: ref.entity, point: 'vertex', index: (i + 1) % g.vertices.length },
  };
}

function distinct(a: GeomRef, b: GeomRef): void {
  if (
    isPointRef(a) &&
    isPointRef(b) &&
    a.entity === b.entity &&
    a.point === b.point &&
    a.index === b.index
  ) {
    throw new MeasureError('invalid', 'the constraint needs two different points');
  }
}

const sameCurve = (a: GeomRef, b: GeomRef) =>
  !isPointRef(a) && !isPointRef(b) && a.entity === b.entity && a.segment === b.segment;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Distance from `p` to the line through `l`'s ends. */
function toLine(p: Vec2, l: { readonly a: Vec2; readonly b: Vec2 }): number {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  return Math.abs(dx * (p.y - l.a.y) - dy * (p.x - l.a.x)) / Math.hypot(dx, dy);
}
