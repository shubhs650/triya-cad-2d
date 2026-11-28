// How a dimensional constraint shows on the drawing (M9-03 part 4): the points it measures, its
// dimension line, arc or leader through the location DIMCONSTRAINT placed it at, and its text.
// The renderer sizes the arrows and text: a dynamic constraint keeps its size on screen as the
// view zooms, an annotational one is sized in drawing units as a dimension (AutoCAD 2024 Help,
// "About Applying Dimensional Constraints": dynamic constraints "maintain the same size when
// zooming in or out", annotational ones "behave like dimensions").
//
// The text follows CONSTRAINTNAMEFORMAT (AutoCAD 2024 Help: 0 Name, 1 Value, 2 Name and
// expression, initially 2). A constraint whose value is an expression of other parameters is
// shown with AutoCAD's "fx:" before it, and a reference constraint in parentheses. A value
// written as a plain number (the measured value kept when Enter took it, or a number typed) is
// shown in the drawing's units and precision (LUNITS and LUPREC, AUNITS and AUPREC), as
// DIMCONSTRAINT's default text was; the Help does not say how the number is written.

import { polylineSegment, polylineSegmentCount } from '../geom/eval';
import { drawingUnits, formatAngle, formatDistance, type DrawingUnits } from '../commands/units';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type {
  ConstraintPointRef,
  ConstraintRef,
  DimensionalConstraintObject,
  Entity,
} from '../model/types';
import { constraintPointsOf, dimensionalConstraints } from './constraints';
import { constraintDimvars, type ConstraintDimvars } from './constraint-style';

/** CONSTRAINTNAMEFORMAT: 0 Name, 1 Value, 2 Name and expression. */
export type ConstraintNameFormat = 0 | 1 | 2;

/** What a dimensional constraint draws, in drawing units. */
export type ConstraintShape =
  /**
   * A distance: extension lines from the points measured (`a`, `b`) to the dimension line's
   * ends (`da`, `db`), arrows at those ends.
   */
  | {
      readonly kind: 'linear';
      readonly a: Vec2;
      readonly b: Vec2;
      readonly da: Vec2;
      readonly db: Vec2;
    }
  /**
   * An angle: the arc about `center` from `start` counter-clockwise through `sweep` (radians),
   * arrows at its ends, and extension lines out to it where the lines stop short.
   */
  | {
      readonly kind: 'angular';
      readonly center: Vec2;
      readonly radius: number;
      readonly start: number;
      readonly sweep: number;
      readonly extensions: readonly (readonly [Vec2, Vec2])[];
      /**
       * Whether the arc's start is at the first object's side (its first line, first point
       * after the vertex, or an arc's start): which side a triangular grip there sets
       * (M9-03 part 11).
       */
      readonly firstAtStart: boolean;
    }
  /**
   * A radius or diameter: a line from the centre (or across) along `angle` to the curve, an
   * arrow where it meets it, on to the location when that is outside.
   */
  | {
      readonly kind: 'radial';
      readonly center: Vec2;
      readonly radius: number;
      readonly angle: number;
      readonly diameter: boolean;
      readonly reach: number;
    };

export interface ConstraintDisplay {
  readonly handle: string;
  readonly form: 'dynamic' | 'annotational';
  /** DCDISPLAY's Hide (M9-03 part 7): shown only while an object it constrains is selected. */
  readonly hidden?: true;
  /** The entities it constrains (its references' objects). */
  readonly entities: readonly string[];
  readonly shape: ConstraintShape;
  readonly label: string;
  /** Where the text sits (it is drawn just above this point) and its direction, radians. */
  readonly textAt: Vec2;
  readonly textAngle: number;
  /**
   * An annotational constraint's DIMVARs, which size it (its dimension style's and its own,
   * M9-03 part 15); absent for a dynamic one, sized on screen.
   */
  readonly dimvars?: ConstraintDimvars;
}

/** A plain number, as the measured value or a number typed is kept. */
const PLAIN_NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

/** The constraint's text as CONSTRAINTNAMEFORMAT says, for a constraint now measuring `value`. */
export function constraintLabel(
  c: Pick<DimensionalConstraintObject, 'dimension' | 'parameter' | 'expression' | 'reference'>,
  value: number,
  units: DrawingUnits,
  format: ConstraintNameFormat,
): string {
  const angular = c.dimension === 'angular';
  const shown = (v: number) =>
    angular ? formatAngle((v * Math.PI) / 180, units) : formatDistance(v, units);
  const plain = PLAIN_NUMBER.test(c.expression);
  const text =
    format === 0
      ? c.parameter
      : format === 1
        ? shown(value)
        : `${c.parameter}=${plain ? shown(Number(c.expression)) : c.expression.trim()}`;
  const fx = plain ? text : `fx: ${text}`;
  return c.reference ? `(${fx})` : fx;
}

/**
 * The drawing's dimensional constraints as they show (or those of `constraints`: a space's,
 * M9-14), those whose objects are gone left out.
 */
export function constraintDisplays(
  model: DocumentModel,
  format: ConstraintNameFormat,
  constraints: readonly DimensionalConstraintObject[] = dimensionalConstraints(model),
): ConstraintDisplay[] {
  const units = drawingUnits(model.header);
  const lookup = (h: string) => model.entityByHandle(h);
  const out: ConstraintDisplay[] = [];
  for (const c of constraints) {
    const d = constraintDisplay(c, lookup, units, format);
    if (!d) continue;
    out.push(c.form === 'annotational' ? { ...d, dimvars: constraintDimvars(model, c) } : d);
  }
  return out;
}

/** How one dimensional constraint shows; undefined when its references no longer resolve. */
export function constraintDisplay(
  c: DimensionalConstraintObject,
  lookup: (handle: string) => Entity | undefined,
  units: DrawingUnits,
  format: ConstraintNameFormat,
): ConstraintDisplay | undefined {
  const placed = shapeOf(c, lookup);
  if (!placed) return undefined;
  const entities = [...new Set(c.refs.map((r) => r.entity))];
  const label = constraintLabel(c, placed.value, units, format);
  return {
    handle: c.handle,
    form: c.form,
    ...(c.hidden && { hidden: true }),
    entities,
    label,
    ...placed.at,
  };
}

/**
 * What a dimensional constraint measures on the geometry `lookup` gives (a distance in drawing
 * units, an angle in degrees); undefined when its references do not resolve.
 */
export function measuredValue(c: DimensionalConstraintObject, lookup: Lookup): number | undefined {
  return shapeOf(c, lookup)?.value;
}

interface Placed {
  readonly value: number;
  readonly at: Pick<ConstraintDisplay, 'shape' | 'textAt' | 'textAngle'>;
}

type Lookup = (handle: string) => Entity | undefined;

function shapeOf(c: DimensionalConstraintObject, lookup: Lookup): Placed | undefined {
  const refs = c.refs;
  const loc = c.location;
  switch (c.dimension) {
    case 'horizontal':
    case 'vertical': {
      const pts = twoPoints(refs, lookup);
      if (!pts) return undefined;
      const [a, b] = pts;
      const h = c.dimension === 'horizontal';
      const da = h ? { x: a.x, y: loc.y } : { x: loc.x, y: a.y };
      const db = h ? { x: b.x, y: loc.y } : { x: loc.x, y: b.y };
      return { value: dist(da, db), at: linear(a, b, da, db) };
    }
    case 'aligned': {
      const pts = alignedPoints(refs, lookup);
      if (!pts) return undefined;
      const [a, b] = pts;
      const len = dist(a, b);
      if (len === 0) return undefined;
      const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      const s = (loc.x - a.x) * n.x + (loc.y - a.y) * n.y;
      const da = { x: a.x + s * n.x, y: a.y + s * n.y };
      const db = { x: b.x + s * n.x, y: b.y + s * n.y };
      return { value: len, at: linear(a, b, da, db) };
    }
    case 'angular':
      return angular(refs, loc, lookup);
    case 'radial':
    case 'diameter': {
      const circ = refs.length === 1 ? circular(refs[0]!, lookup) : undefined;
      if (!circ) return undefined;
      const { center, radius } = circ;
      const off = dist(loc, center);
      const angle = off === 0 ? 0 : Math.atan2(loc.y - center.y, loc.x - center.x);
      const diameter = c.dimension === 'diameter';
      const reach = Math.max(radius, off);
      const u = { x: Math.cos(angle), y: Math.sin(angle) };
      // The text sits halfway along the leader inside, or at the location outside.
      const t = off > radius ? off : radius / 2;
      return {
        value: diameter ? 2 * radius : radius,
        at: {
          shape: { kind: 'radial', center, radius, angle, diameter, reach },
          textAt: { x: center.x + t * u.x, y: center.y + t * u.y },
          textAngle: readable(angle),
        },
      };
    }
    default:
      return undefined;
  }
}

function linear(a: Vec2, b: Vec2, da: Vec2, db: Vec2): Placed['at'] {
  return {
    shape: { kind: 'linear', a, b, da, db },
    textAt: { x: (da.x + db.x) / 2, y: (da.y + db.y) / 2 },
    textAngle: readable(Math.atan2(db.y - da.y, db.x - da.x)),
  };
}

/** A direction turned to read left to right or bottom to top, as dimension text does. */
function readable(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  // Within a hair of straight down counts as up, so vertical text reads bottom to top.
  if (a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9) a -= Math.PI;
  return a > Math.PI ? a - 2 * Math.PI : a;
}

function angular(refs: readonly ConstraintRef[], loc: Vec2, lookup: Lookup): Placed | undefined {
  if (refs.length === 1) {
    const arc = circular(refs[0]!, lookup);
    if (!arc || arc.sweep === undefined) return undefined;
    const off = dist(loc, arc.center);
    const r = off > 0 ? off : arc.radius;
    return arcPlaced(arc.center, r, arc.start!, arc.sweep, [], !arc.reversed);
  }
  let v: Vec2;
  let far: [Vec2, Vec2];
  let near: [Vec2 | undefined, Vec2 | undefined] = [undefined, undefined];
  if (refs.length === 2) {
    const l1 = line(refs[0]!, lookup);
    const l2 = line(refs[1]!, lookup);
    if (!l1 || !l2) return undefined;
    const x = crossing(l1, l2);
    if (!x) return undefined;
    v = x;
    const ends = (l: readonly [Vec2, Vec2]) =>
      dist(l[0], x) > dist(l[1], x) ? ([l[0], l[1]] as const) : ([l[1], l[0]] as const);
    const [f1, n1] = ends(l1);
    const [f2, n2] = ends(l2);
    far = [f1, f2];
    near = [n1, n2];
  } else if (refs.length === 3) {
    const pts = refs.map((r) => point(r, lookup));
    if (pts.some((p) => !p)) return undefined;
    v = pts[0]!;
    far = [pts[1]!, pts[2]!];
  } else return undefined;
  const a1 = Math.atan2(far[0].y - v.y, far[0].x - v.x);
  const a2 = Math.atan2(far[1].y - v.y, far[1].x - v.x);
  let sweep = a2 - a1;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const start = sweep >= 0 ? a1 : a2;
  const r = dist(loc, v) || Math.min(dist(far[0], v), dist(far[1], v));
  // Extension lines run from a line's end along its direction out to the arc, where the arc is
  // beyond it or short of it.
  const extensions: (readonly [Vec2, Vec2])[] = [];
  far.forEach((f, i) => {
    const angle = Math.atan2(f.y - v.y, f.x - v.x);
    const on = { x: v.x + r * Math.cos(angle), y: v.y + r * Math.sin(angle) };
    const fd = dist(f, v);
    const nd = near[i] ? dist(near[i]!, v) : 0;
    if (r > fd) extensions.push([f, on]);
    else if (r < nd) extensions.push([near[i]!, on]);
  });
  return arcPlaced(v, r, start, Math.abs(sweep), extensions, sweep >= 0);
}

function arcPlaced(
  center: Vec2,
  radius: number,
  start: number,
  sweep: number,
  extensions: (readonly [Vec2, Vec2])[],
  firstAtStart: boolean,
): Placed {
  const mid = start + sweep / 2;
  return {
    value: (sweep * 180) / Math.PI,
    at: {
      shape: { kind: 'angular', center, radius, start, sweep, extensions, firstAtStart },
      textAt: { x: center.x + radius * Math.cos(mid), y: center.y + radius * Math.sin(mid) },
      textAngle: readable(mid - Math.PI / 2),
    },
  };
}

// ── Resolving references (as @triya/constraints' measure.ts reads them) ─────────────────────

const isPoint = (r: ConstraintRef): r is ConstraintPointRef => 'point' in r;

function point(r: ConstraintRef, lookup: Lookup): Vec2 | undefined {
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

function line(r: ConstraintRef, lookup: Lookup): readonly [Vec2, Vec2] | undefined {
  if (isPoint(r)) return undefined;
  const g = lookup(r.entity)?.geom;
  if (g?.kind === 'LINE' && r.segment === undefined) return [g.start, g.end];
  if (g?.kind !== 'LWPOLYLINE' || r.segment === undefined) return undefined;
  if (r.segment < 0 || r.segment >= polylineSegmentCount(g)) return undefined;
  const s = polylineSegment(g, r.segment);
  return 'line' in s ? [s.line.a, s.line.b] : undefined;
}

interface Circular {
  readonly center: Vec2;
  readonly radius: number;
  /** An arc's start angle and counter-clockwise sweep, radians; undefined for a circle. */
  readonly start?: number;
  readonly sweep?: number;
  /** A clockwise polyline arc segment: its start angle is its second vertex's. */
  readonly reversed?: true;
}

function circular(r: ConstraintRef, lookup: Lookup): Circular | undefined {
  if (isPoint(r)) return undefined;
  const g = lookup(r.entity)?.geom;
  if (!g) return undefined;
  if (r.segment === undefined) {
    if (g.kind === 'CIRCLE') return { center: g.center, radius: g.radius };
    if (g.kind !== 'ARC') return undefined;
    let sweep = g.endAngle - g.startAngle;
    while (sweep <= 0) sweep += 2 * Math.PI;
    return { center: g.center, radius: g.radius, start: g.startAngle, sweep };
  }
  if (g.kind !== 'LWPOLYLINE' || r.segment < 0 || r.segment >= polylineSegmentCount(g)) {
    return undefined;
  }
  const s = polylineSegment(g, r.segment);
  if ('line' in s) return undefined;
  const { center, radius, startAngle, sweep } = s.arc;
  return sweep >= 0
    ? { center, radius, start: startAngle, sweep }
    : { center, radius, start: startAngle + sweep, sweep: -sweep, reversed: true };
}

/** Horizontal and Vertical: two points, or a line's ends. */
function twoPoints(refs: readonly ConstraintRef[], lookup: Lookup): [Vec2, Vec2] | undefined {
  if (refs.length === 1) {
    const l = line(refs[0]!, lookup);
    return l ? [l[0], l[1]] : undefined;
  }
  if (refs.length !== 2) return undefined;
  const a = point(refs[0]!, lookup);
  const b = point(refs[1]!, lookup);
  return a && b ? [a, b] : undefined;
}

/**
 * Aligned: two points, a line's ends, a point and its foot on a line, or (2Line) the second
 * line's start and its foot on the first, which is what the constraint measures.
 */
function alignedPoints(refs: readonly ConstraintRef[], lookup: Lookup): [Vec2, Vec2] | undefined {
  if (refs.length !== 2) return twoPoints(refs, lookup);
  const [r0, r1] = refs as [ConstraintRef, ConstraintRef];
  if (isPoint(r0) && isPoint(r1)) return twoPoints(refs, lookup);
  if (isPoint(r0) !== isPoint(r1)) {
    const p = point(isPoint(r0) ? r0 : r1, lookup);
    const l = line(isPoint(r0) ? r1 : r0, lookup);
    return p && l ? [p, foot(p, l)] : undefined;
  }
  const l1 = line(r0, lookup);
  const l2 = line(r1, lookup);
  return l1 && l2 ? [foot(l2[0], l1), l2[0]] : undefined;
}

function foot(p: Vec2, [a, b]: readonly [Vec2, Vec2]): Vec2 {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len2 = d.x * d.x + d.y * d.y;
  if (len2 === 0) return a;
  const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2;
  return { x: a.x + t * d.x, y: a.y + t * d.y };
}

/** Where two lines (extended) cross; undefined for parallel ones. */
function crossing([a, b]: readonly [Vec2, Vec2], [c, d]: readonly [Vec2, Vec2]): Vec2 | undefined {
  const da = { x: b.x - a.x, y: b.y - a.y };
  const db = { x: d.x - c.x, y: d.y - c.y };
  const denom = da.x * db.y - da.y * db.x;
  if (Math.abs(denom) <= 1e-12 * Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y)) return undefined;
  const t = ((c.x - a.x) * db.y - (c.y - a.y) * db.x) / denom;
  return { x: a.x + t * da.x, y: a.y + t * da.y };
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y);
