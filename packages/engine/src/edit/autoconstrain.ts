// AUTOCONSTRAIN (M9-05 part 3): which geometric constraints a selection of objects takes, by how
// the objects lie to one another (AutoCAD 2024 Help, "AUTOCONSTRAIN (Command)": "Applies
// geometric constraints to a selection set of objects based on orientation of the objects
// relative to one another", and "AutoConstrain Tab (Constraint Settings Dialog Box)").
//
// The tab lists the constraint types in the order they are applied, each with its Apply check,
// two checks that tangent and perpendicular objects must share an intersection point, and two
// tolerances: Distance (coincident, concentric, tangent and collinear) and Angle (horizontal,
// vertical, parallel, perpendicular, tangent and collinear). The Help gives neither the list's
// order nor the defaults; Triya takes the order of AutoCAD 2024's dialog as shipped (Coincident,
// Collinear, Parallel, Perpendicular, Tangent, Concentric, Horizontal, Vertical, Equal), every
// type applied, both checks on, Distance 0.05 and Angle 1 degree. Equal is not named under
// either tolerance; it compares lengths and radii, so it takes Distance.
//
// This module only finds the candidates, in the order they are to be tried. The command adds
// them one at a time through the solver, which refuses one the constraints already applied make
// redundant (two horizontal lines made parallel need only one Horizontal) or cannot take, as
// AutoCAD skips them. Objects that agree with each other are grouped round the first of them
// (lines at the same angle all made parallel to the first), so a selection of n parallel lines
// gives n - 1 candidates rather than every pair.
//
// Lines, arcs, circles and polyline segments take part, and (M9-05 part 5) splines and ellipses
// as far as the solver takes them (M9-02 parts 2 and 3): an open spline by its ends, which meet
// other objects' ends or lie on them (a constraint cannot put a point on a spline, so nothing is
// made coincident with a spline's middle; Smooth is not among the tab's types); an ellipse or
// elliptical arc by its centre (Concentric with circles, arcs and other ellipses), the curve
// itself (an end lying on it is Coincident, a line touching it Tangent) and an arc's ends. The
// solver refuses Tangent between an ellipse and a circle, arc or ellipse and Equal on ellipses,
// so they are not offered.
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import { closestPoint } from '../geom/closest';
import type { Ellipse } from '../geom/curves';
import { ellipseAxes, polylineSegment, polylineSegmentCount } from '../geom/eval';
import { toleranceForSize } from '../geom/tolerance';
import { distance, dot, length } from '../geom/vec';
import type { Vec2 } from '../geom/types';
import type {
  ConstraintCurveRef,
  ConstraintPointRef,
  ConstraintRef,
  Entity,
  GeometricConstraintKind,
} from '../model/types';
import { constraintPointsOf } from './constraints';

/** The types the AutoConstrain tab lists: every geometric constraint but Smooth, Symmetric, Fix. */
export const AUTOCONSTRAIN_KINDS = [
  'coincident',
  'collinear',
  'parallel',
  'perpendicular',
  'tangent',
  'concentric',
  'horizontal',
  'vertical',
  'equal',
] as const satisfies readonly GeometricConstraintKind[];

export type AutoConstrainKind = (typeof AUTOCONSTRAIN_KINDS)[number];

/** The AutoConstrain tab's settings: per user, as AutoCAD keeps them in the registry. */
export interface AutoConstrainSettings {
  /** Every type, in the order applied (Priority), each with its Apply check. */
  readonly order: readonly { readonly kind: AutoConstrainKind; readonly apply: boolean }[];
  /** Tangent objects must share an intersection point. */
  readonly tangentTouch: boolean;
  /** Perpendicular objects must share an intersection point. */
  readonly perpendicularTouch: boolean;
  /** Distance tolerance, drawing units. */
  readonly distance: number;
  /** Angle tolerance, degrees. */
  readonly angle: number;
}

export const AUTOCONSTRAIN_DEFAULTS: AutoConstrainSettings = {
  order: AUTOCONSTRAIN_KINDS.map((kind) => ({ kind, apply: true })),
  tangentTouch: true,
  perpendicularTouch: true,
  distance: 0.05,
  angle: 1,
};

/** The tolerances' limits, as the tab takes them: a distance above 0, an angle 0 to 90. */
export const AUTOCONSTRAIN_ANGLE_MAX = 90;

/**
 * Settings read back from anywhere (preferences, the app's reply): any type missing is added,
 * applied, at the end; anything out of range takes its default.
 */
export function autoConstrainSettingsOf(v: unknown): AutoConstrainSettings {
  const d = AUTOCONSTRAIN_DEFAULTS;
  if (typeof v !== 'object' || v === null) return d;
  const o = v as Record<string, unknown>;
  const seen = new Set<AutoConstrainKind>();
  const order: { kind: AutoConstrainKind; apply: boolean }[] = [];
  for (const item of Array.isArray(o['order']) ? o['order'] : []) {
    const kind = (item as { kind?: unknown })?.kind;
    const apply = (item as { apply?: unknown })?.apply;
    if (!AUTOCONSTRAIN_KINDS.includes(kind as AutoConstrainKind)) continue;
    if (seen.has(kind as AutoConstrainKind)) continue;
    seen.add(kind as AutoConstrainKind);
    order.push({ kind: kind as AutoConstrainKind, apply: apply !== false });
  }
  for (const kind of AUTOCONSTRAIN_KINDS) if (!seen.has(kind)) order.push({ kind, apply: true });
  const num = (x: unknown, ok: (n: number) => boolean, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) && ok(x) ? x : fallback;
  return {
    order,
    tangentTouch: typeof o['tangentTouch'] === 'boolean' ? o['tangentTouch'] : d.tangentTouch,
    perpendicularTouch:
      typeof o['perpendicularTouch'] === 'boolean' ? o['perpendicularTouch'] : d.perpendicularTouch,
    distance: num(o['distance'], (n) => n > 0, d.distance),
    angle: num(o['angle'], (n) => n >= 0 && n <= AUTOCONSTRAIN_ANGLE_MAX, d.angle),
  };
}

/** A constraint AUTOCONSTRAIN would try, its references as GEOMCONSTRAINT's picks give them. */
export interface AutoConstraint {
  readonly kind: AutoConstrainKind;
  readonly refs: readonly ConstraintRef[];
}

interface Line {
  readonly ref: ConstraintCurveRef;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Direction, radians in [0, π). */
  readonly angle: number;
  readonly length: number;
}

interface Round {
  readonly ref: ConstraintCurveRef;
  readonly center: Vec2;
  readonly radius: number;
  /** An arc's start angle and counter-clockwise sweep; a circle's sweep is a full turn. */
  readonly start: number;
  readonly sweep: number;
}

/** An ellipse or elliptical arc. */
interface Oval {
  readonly ref: ConstraintCurveRef;
  readonly ellipse: Ellipse;
}

interface End {
  readonly ref: ConstraintPointRef;
  readonly at: Vec2;
}

/** A circle, arc or ellipse by its centre, for Concentric. */
interface Centred {
  readonly ref: ConstraintCurveRef;
  readonly center: Vec2;
}

/**
 * The lines, arcs, circles and ellipses of `entities` (a polyline's segments each), their
 * centres, and their ends (a spline's too).
 */
function shapesOf(entities: readonly Entity[]): {
  lines: Line[];
  rounds: Round[];
  ovals: Oval[];
  centred: Centred[];
  ends: End[];
} {
  const lines: Line[] = [];
  const rounds: Round[] = [];
  const ovals: Oval[] = [];
  const centred: Centred[] = [];
  const ends: End[] = [];
  const round = (r: Round) => {
    rounds.push(r);
    centred.push(r);
  };
  // A spline's or an elliptical arc's start and end, as the solver maps them.
  const endsOf = (e: Entity) => {
    for (const c of constraintPointsOf(e)) {
      if (c.ref.point === 'start' || c.ref.point === 'end') ends.push(c);
    }
  };
  const line = (ref: ConstraintCurveRef, a: Vec2, b: Vec2) => {
    const length = distance(a, b);
    if (length === 0) return;
    const angle = normalizeAngle(Math.atan2(b.y - a.y, b.x - a.x)) % Math.PI;
    lines.push({ ref, a, b, angle, length });
  };
  for (const e of entities) {
    const g = e.geom;
    const entity = e.handle;
    switch (g.kind) {
      case 'LINE':
        line({ entity }, g.start, g.end);
        ends.push(
          { ref: { entity, point: 'start' }, at: g.start },
          { ref: { entity, point: 'end' }, at: g.end },
        );
        break;
      case 'CIRCLE':
        round({ ref: { entity }, center: g.center, radius: g.radius, start: 0, sweep: TAU });
        break;
      case 'ARC': {
        const sweep = ccwSweep(g.startAngle, g.endAngle);
        round({
          ref: { entity },
          center: g.center,
          radius: g.radius,
          start: g.startAngle,
          sweep,
        });
        const on = (t: number): Vec2 => ({
          x: g.center.x + g.radius * Math.cos(t),
          y: g.center.y + g.radius * Math.sin(t),
        });
        ends.push(
          { ref: { entity, point: 'start' }, at: on(g.startAngle) },
          { ref: { entity, point: 'end' }, at: on(g.startAngle + sweep) },
        );
        break;
      }
      case 'LWPOLYLINE': {
        for (let segment = 0; segment < polylineSegmentCount(g); segment++) {
          const s = polylineSegment(g, segment);
          if ('line' in s) {
            line({ entity, segment }, s.line.a, s.line.b);
            continue;
          }
          const { center, radius, startAngle, sweep } = s.arc;
          round({
            ref: { entity, segment },
            center,
            radius,
            start: sweep < 0 ? startAngle + sweep : startAngle,
            sweep: Math.abs(sweep),
          });
        }
        g.vertices.forEach((v, index) =>
          ends.push({ ref: { entity, point: 'vertex', index }, at: { x: v.x, y: v.y } }),
        );
        break;
      }
      case 'ELLIPSE':
        ovals.push({ ref: { entity }, ellipse: g });
        centred.push({ ref: { entity }, center: g.center });
        endsOf(e);
        break;
      case 'SPLINE':
        endsOf(e);
        break;
      default:
        break;
    }
  }
  return { lines, rounds, ovals, centred, ends };
}

/** The difference of two line directions, 0 to π/2. */
function turn(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/** How far `p` lies from the infinite line through `l`. */
function offLine(l: Line, p: Vec2): number {
  return Math.abs((l.b.x - l.a.x) * (p.y - l.a.y) - (l.b.y - l.a.y) * (p.x - l.a.x)) / l.length;
}

/** Where along `l` the foot of `p` lies, 0 at its start and 1 at its end. */
function along(l: Line, p: Vec2): number {
  return ((p.x - l.a.x) * (l.b.x - l.a.x) + (p.y - l.a.y) * (l.b.y - l.a.y)) / l.length ** 2;
}

/** How far `p` lies from the segment `l`. */
function offSegment(l: Line, p: Vec2): number {
  const t = Math.min(Math.max(along(l, p), 0), 1);
  return distance(p, { x: l.a.x + t * (l.b.x - l.a.x), y: l.a.y + t * (l.b.y - l.a.y) });
}

/** How far apart two segments come (0 where they cross). */
function segmentGap(l: Line, m: Line): number {
  const cross = (o: Vec2, p: Vec2, q: Vec2) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(l.a, l.b, m.a);
  const d2 = cross(l.a, l.b, m.b);
  const d3 = cross(m.a, m.b, l.a);
  const d4 = cross(m.a, m.b, l.b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(offSegment(l, m.a), offSegment(l, m.b), offSegment(m, l.a), offSegment(m, l.b));
}

/** How far `p` lies from the arc or circle `r`. */
function offRound(r: Round, p: Vec2): number {
  const t = Math.atan2(p.y - r.center.y, p.x - r.center.x);
  if (r.sweep >= TAU || normalizeAngle(t - r.start) <= r.sweep) {
    return Math.abs(distance(p, r.center) - r.radius);
  }
  const at = (a: number): Vec2 => ({
    x: r.center.x + r.radius * Math.cos(a),
    y: r.center.y + r.radius * Math.sin(a),
  });
  return Math.min(distance(p, at(r.start)), distance(p, at(r.start + r.sweep)));
}

/** How far `p` lies from the ellipse or elliptical arc `o`. */
function offOval(o: Oval, p: Vec2): number {
  const e = o.ellipse;
  const size = Math.max(
    Math.abs(e.center.x),
    Math.abs(e.center.y),
    Math.abs(p.x),
    Math.abs(p.y),
    length(e.majorAxis),
  );
  return closestPoint(e, p, toleranceForSize(size)).distance;
}

/**
 * Where the infinite line through `l` would touch the ellipse `o` (the point of the ellipse
 * whose tangent runs parallel to it, on the line's side), and how far the line lies from
 * touching it.
 */
function ovalTouch(l: Line, o: Oval): { at: Vec2; gap: number } {
  const { major, minor } = ellipseAxes(o.ellipse);
  const c = o.ellipse.center;
  // The line's unit normal, turned to point from the centre towards the line.
  let n = { x: -(l.b.y - l.a.y) / l.length, y: (l.b.x - l.a.x) / l.length };
  const s = dot(n, { x: l.a.x - c.x, y: l.a.y - c.y });
  if (s < 0) n = { x: -n.x, y: -n.y };
  // The ellipse's support in that direction: its farthest point along n.
  const nu = dot(n, major);
  const nv = dot(n, minor);
  const h = Math.hypot(nu, nv);
  const at = {
    x: c.x + (nu * major.x + nv * minor.x) / h,
    y: c.y + (nu * major.y + nv * minor.y) / h,
  };
  return { at, gap: Math.abs(Math.abs(s) - h) };
}

/**
 * Groups `items` round the first of each group: an item joins the first group whose first item
 * it `agrees` with, else starts one. Returns each group's first item with each other item.
 */
function leaders<T>(items: readonly T[], agrees: (first: T, other: T) => boolean): [T, T][] {
  const firsts: T[] = [];
  const pairs: [T, T][] = [];
  for (const item of items) {
    const first = firsts.find((f) => agrees(f, item));
    if (first === undefined) firsts.push(item);
    else pairs.push([first, item]);
  }
  return pairs;
}

const allPairs = <T>(items: readonly T[]): [T, T][] =>
  items.flatMap((a, i) => items.slice(i + 1).map((b): [T, T] => [a, b]));

/**
 * The constraints AUTOCONSTRAIN tries on `entities`, the selection's objects a constraint can
 * take, in the order `settings` applies them; the types not applied are left out.
 */
export function autoConstraints(
  entities: readonly Entity[],
  settings: AutoConstrainSettings,
): AutoConstraint[] {
  const { lines, rounds, ovals, centred, ends } = shapesOf(entities);
  const dist = settings.distance;
  const ang = (settings.angle * Math.PI) / 180;
  const other = (a: { ref: { entity: string } }, b: { ref: { entity: string } }) =>
    a.ref.entity !== b.ref.entity;
  const collinear = (l: Line, m: Line) =>
    turn(l.angle, m.angle) <= ang && offLine(l, m.a) <= dist && offLine(l, m.b) <= dist;
  const find: Record<AutoConstrainKind, () => AutoConstraint[]> = {
    coincident: () => {
      // Ends of different objects that meet, then an end lying on another object's middle.
      const meet = leaders(ends, (a, b) => other(a, b) && distance(a.at, b.at) <= dist);
      const out: AutoConstraint[] = meet.map(([a, b]) => ({
        kind: 'coincident',
        refs: [a.ref, b.ref],
      }));
      const nearEnd = (p: Vec2, entity: string) =>
        ends.some((e) => e.ref.entity === entity && distance(e.at, p) <= dist);
      for (const p of ends) {
        for (const l of lines) {
          if (!other(p, l) || nearEnd(p.at, l.ref.entity)) continue;
          if (offSegment(l, p.at) <= dist) out.push({ kind: 'coincident', refs: [l.ref, p.ref] });
        }
        for (const r of rounds) {
          if (!other(p, r) || nearEnd(p.at, r.ref.entity)) continue;
          if (offRound(r, p.at) <= dist) out.push({ kind: 'coincident', refs: [r.ref, p.ref] });
        }
        for (const o of ovals) {
          if (!other(p, o) || nearEnd(p.at, o.ref.entity)) continue;
          if (offOval(o, p.at) <= dist) out.push({ kind: 'coincident', refs: [o.ref, p.ref] });
        }
      }
      return out;
    },
    collinear: () =>
      leaders(lines, collinear).map(([l, m]) => ({ kind: 'collinear', refs: [l.ref, m.ref] })),
    parallel: () =>
      leaders(lines, (l, m) => turn(l.angle, m.angle) <= ang && !collinear(l, m)).map(([l, m]) => ({
        kind: 'parallel',
        refs: [l.ref, m.ref],
      })),
    perpendicular: () =>
      allPairs(lines)
        .filter(
          ([l, m]) =>
            Math.PI / 2 - turn(l.angle, m.angle) <= ang &&
            (!settings.perpendicularTouch || segmentGap(l, m) <= dist),
        )
        .map(([l, m]) => ({ kind: 'perpendicular', refs: [l.ref, m.ref] })),
    tangent: () => {
      const out: AutoConstraint[] = [];
      for (const l of lines) {
        for (const r of rounds) {
          if (Math.abs(offLine(l, r.center) - r.radius) > dist) continue;
          if (settings.tangentTouch) {
            const t = along(l, r.center);
            const foot = { x: l.a.x + t * (l.b.x - l.a.x), y: l.a.y + t * (l.b.y - l.a.y) };
            if (offSegment(l, foot) > dist || offRound(r, foot) > dist) continue;
          }
          out.push({ kind: 'tangent', refs: [l.ref, r.ref] });
        }
        for (const o of ovals) {
          const { at, gap } = ovalTouch(l, o);
          if (gap > dist) continue;
          if (settings.tangentTouch && (offSegment(l, at) > dist || offOval(o, at) > dist)) {
            continue;
          }
          out.push({ kind: 'tangent', refs: [l.ref, o.ref] });
        }
      }
      for (const [r, s] of allPairs(rounds)) {
        const d = distance(r.center, s.center);
        if (d <= dist) continue;
        const outside = Math.abs(d - (r.radius + s.radius)) <= dist;
        const inside = Math.abs(d - Math.abs(r.radius - s.radius)) <= dist;
        if (!outside && !inside) continue;
        if (settings.tangentTouch) {
          // The touching point: on the line through the centres, the larger's radius from its
          // centre towards the smaller's (outside or inside it alike).
          const big = r.radius >= s.radius ? r : s;
          const small = big === r ? s : r;
          const k = big.radius / d;
          const p = {
            x: big.center.x + (small.center.x - big.center.x) * k,
            y: big.center.y + (small.center.y - big.center.y) * k,
          };
          if (offRound(r, p) > dist || offRound(s, p) > dist) continue;
        }
        out.push({ kind: 'tangent', refs: [r.ref, s.ref] });
      }
      return out;
    },
    concentric: () =>
      leaders(centred, (r, s) => distance(r.center, s.center) <= dist).map(([r, s]) => ({
        kind: 'concentric',
        refs: [r.ref, s.ref],
      })),
    horizontal: () =>
      lines
        .filter((l) => turn(l.angle, 0) <= ang)
        .map((l) => ({ kind: 'horizontal', refs: [l.ref] })),
    vertical: () =>
      lines
        .filter((l) => turn(l.angle, Math.PI / 2) <= ang)
        .map((l) => ({ kind: 'vertical', refs: [l.ref] })),
    equal: () => [
      ...leaders(lines, (l, m) => Math.abs(l.length - m.length) <= dist).map(([l, m]) => ({
        kind: 'equal' as const,
        refs: [l.ref, m.ref],
      })),
      ...leaders(rounds, (r, s) => Math.abs(r.radius - s.radius) <= dist).map(([r, s]) => ({
        kind: 'equal' as const,
        refs: [r.ref, s.ref],
      })),
    ],
  };
  return settings.order.filter((o) => o.apply).flatMap((o) => find[o.kind]());
}
