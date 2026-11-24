// Infer Constraints (CONSTRAINTINFER, M9-05 part 7): which geometric constraints the objects a
// command made take from how they were drawn (AutoCAD 2024 Help, "About Inferring Geometric
// Constraints").
//
// The Help: constraints are applied "between the object being created or edited and the object
// or points associated with object snaps", only where the objects already meet the constraint's
// conditions, and "objects are not repositioned as a result of inferring constraints".
// Intersection, Apparent Intersection, Extension and Quadrant infer nothing; Fix, Smooth,
// Symmetric, Concentric, Equal and Collinear are never inferred. LINE (and PLINE) "infer
// coincident point-to-point constraints regardless of object snap settings", Close the first
// line's start with the last's end; RECTANG gives its closed polyline two Parallel and one
// Perpendicular. SCALE, MIRROR, OFFSET, BREAK, TRIM, EXTEND and ARRAY infer nothing.
//
// What the Help leaves open is decided here as a drafter expects:
// - ENDpoint, MIDpoint, CENter and NODe make the new object's constraint point at the snap
//   Coincident with the snapped object's point there; NEArest makes it Coincident with the
//   object (a point on a curve). CENter on a circle drawn there gives Coincident centres, as
//   Concentric is never inferred.
// - PERpendicular holds the new object's end on the object snapped to (Coincident on the curve)
//   and, where the new object is straight there, makes it Perpendicular to a line: the snap
//   placed it so, and a drafter keeps both. TANgent makes a line Tangent to the circle or arc,
//   which holds its end there already (both would be redundant); a curve's end is held on it.
// - A polyline's segments share their vertices in the constraint model (`ConstraintPointRef`'s
//   `vertex`), so PLINE's segments need no Coincident of their own.
// - The snap's point must be one of the new object's constraint points (a line's end, a circle's
//   centre); a circle drawn through a snapped point takes nothing from it.
// Each candidate is checked against the geometry within the drawing's tolerance, so nothing is
// moved to meet it, and the command then adds them through the solver, skipping what it refuses
// as redundant (`applyGeometricConstraints`).
//
// Left for later (M9-05 part 8): PARallel (a tracking path, which the canvas does not tell the
// engine), MOVE, COPY's and STRETCH's edited objects, FILLET and CHAMFER, and Horizontal and
// Vertical from object tracking.
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { cross, distance, dot, normalize, sub } from '../geom/vec';
import { polylineSegment, polylineSegmentCount } from '../geom/eval';
import type { OsnapMode } from '../input/osnap';
import type { EntityId } from '../model/entity-ids';
import type {
  ConstraintCurveRef,
  ConstraintPointRef,
  ConstraintRef,
  Entity,
  GeometricConstraintKind,
} from '../model/types';
import { constraintPointsOf, type ConstraintPoint } from './constraints';

/** CONSTRAINTINFER: geometric constraints inferred as objects are drawn (1) or not (0). */
export const CONSTRAINT_INFER = 'CONSTRAINTINFER';

/** A point a command was given by a running object snap or an override: the snap and object. */
export interface SnappedPoint {
  readonly point: Vec2;
  readonly mode: OsnapMode;
  readonly id: EntityId;
}

/** A constraint to try, as AUTOCONSTRAIN's candidates are. */
export interface InferredConstraint {
  readonly kind: GeometricConstraintKind;
  readonly refs: readonly ConstraintRef[];
}

/** The commands the Help says Infer Constraints leaves alone (ARRAY in all its forms). */
export const INFERS_NOTHING: ReadonlySet<string> = new Set([
  'ARRAY',
  'ARRAYCLASSIC',
  'ARRAYPATH',
  'ARRAYPOLAR',
  'ARRAYRECT',
  'BREAK',
  'BREAKATPOINT',
  'EXTEND',
  'MIRROR',
  'OFFSET',
  'SCALE',
  'TRIM',
]);

/** The commands that infer constraints of their own, whatever was snapped. */
export const INFERS_ITSELF: ReadonlySet<string> = new Set(['LINE', 'RECTANG']);

/** The objects the constraint model maps (`ConstraintModel`). */
const MAPPED = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'ELLIPSE', 'SPLINE', 'POINT']);

export const takesConstraints = (e: Entity): boolean => MAPPED.has(e.geom.kind);

/** The snaps that make a point Coincident with a point of the object, and which points. */
const POINT_SNAPS: Partial<Record<OsnapMode, readonly ConstraintPointRef['point'][]>> = {
  END: ['start', 'end', 'vertex'],
  MID: ['mid'],
  CEN: ['center'],
  NOD: ['position'],
};

type Shape =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'round'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'other' };

interface CurveAt {
  readonly ref: ConstraintCurveRef;
  readonly shape: Shape;
}

/** Distance from `p` to the segment a-b. */
function offSegment(a: Vec2, b: Vec2, p: Vec2): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** The segments of a polyline as shapes, by index. */
function polylineShapes(e: Entity): Shape[] {
  const g = e.geom;
  if (g.kind !== 'LWPOLYLINE') return [];
  const out: Shape[] = [];
  for (let i = 0; i < polylineSegmentCount(g); i++) {
    const s = polylineSegment(g, i);
    out.push(
      'line' in s
        ? { kind: 'line', a: s.line.a, b: s.line.b }
        : { kind: 'round', center: s.arc.center, radius: s.arc.radius },
    );
  }
  return out;
}

/** The curve of `e` (a polyline's segment) `p` lies on, within `tol`. */
function curveAt(e: Entity, p: Vec2, tol: Tolerance): CurveAt | undefined {
  const g = e.geom;
  const entity = e.handle;
  switch (g.kind) {
    case 'LINE':
      return offSegment(g.start, g.end, p) <= tol.linear
        ? { ref: { entity }, shape: { kind: 'line', a: g.start, b: g.end } }
        : undefined;
    case 'CIRCLE':
    case 'ARC':
      return Math.abs(distance(g.center, p) - g.radius) <= tol.linear
        ? { ref: { entity }, shape: { kind: 'round', center: g.center, radius: g.radius } }
        : undefined;
    case 'LWPOLYLINE': {
      const shapes = polylineShapes(e);
      for (let segment = 0; segment < shapes.length; segment++) {
        const s = shapes[segment]!;
        const on =
          s.kind === 'line'
            ? offSegment(s.a, s.b, p) <= tol.linear
            : s.kind === 'round' && Math.abs(distance(s.center, p) - s.radius) <= tol.linear;
        if (on) return { ref: { entity, segment }, shape: s };
      }
      return undefined;
    }
    // An ellipse's curve takes a point (M9-02 part 3); a snap reached it, so it lies on it.
    case 'ELLIPSE':
      return { ref: { entity }, shape: { kind: 'other' } };
    default:
      return undefined;
  }
}

/** The new object's constraint point at `p`: an end or centre before a midpoint. */
function pointAt(e: Entity, p: Vec2, tol: Tolerance): ConstraintPoint | undefined {
  const near = constraintPointsOf(e).filter((c) => distance(c.at, p) <= tol.linear);
  return near.find((c) => c.ref.point !== 'mid') ?? near[0];
}

/** The straight parts of `e` that end at its point `at`: a line, a polyline's segments. */
function straightAt(e: Entity, at: ConstraintPointRef): CurveAt[] {
  const g = e.geom;
  if (g.kind === 'LINE' && (at.point === 'start' || at.point === 'end')) {
    return [{ ref: { entity: e.handle }, shape: { kind: 'line', a: g.start, b: g.end } }];
  }
  if (g.kind !== 'LWPOLYLINE' || at.point !== 'vertex' || at.index === undefined) return [];
  const shapes = polylineShapes(e);
  const n = shapes.length;
  const segments = [at.index - 1, at.index].filter(
    (i) => (i >= 0 && i < n) || (g.closed && i === -1 && n > 0),
  );
  return segments
    .map((i) => (i + n) % n)
    .map((segment) => ({ ref: { entity: e.handle, segment }, shape: shapes[segment]! }))
    .filter((c) => c.shape.kind === 'line');
}

/** Whether two lines are perpendicular, or parallel, within the angular tolerance. */
function turn(a: Shape, b: Shape): { readonly sin: number; readonly cos: number } | undefined {
  if (a.kind !== 'line' || b.kind !== 'line') return undefined;
  const u = normalize(sub(a.b, a.a));
  const v = normalize(sub(b.b, b.a));
  return { sin: Math.abs(cross(u, v)), cos: Math.abs(dot(u, v)) };
}

/** Whether line `l` touches the circle `r` (the distance from its centre is the radius). */
function touches(l: Shape, r: Shape, tol: Tolerance): boolean {
  if (l.kind !== 'line' || r.kind !== 'round') return false;
  const u = normalize(sub(l.b, l.a));
  const off = Math.abs(cross(u, sub(r.center, l.a)));
  return Math.abs(off - r.radius) <= tol.linear;
}

const refKey = (r: ConstraintRef) =>
  JSON.stringify(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)));

/** A key the same for the same constraint whatever order its references came in. */
export const constraintKey = (c: InferredConstraint): string =>
  `${c.kind}:${c.refs.map(refKey).sort().join('|')}`;

/**
 * The constraints the objects `added` (in the order the command made them) take from the
 * points it was given by object snaps (`snaps`) and from the command itself: candidates the
 * geometry already meets, each once, in the order found.
 */
export function inferredConstraints(o: {
  readonly command: string;
  readonly added: readonly Entity[];
  readonly snaps: readonly SnappedPoint[];
  readonly entity: (id: EntityId) => Entity | undefined;
  readonly tol: Tolerance;
}): InferredConstraint[] {
  const { tol } = o;
  if (INFERS_NOTHING.has(o.command)) return [];
  const added = o.added.filter(takesConstraints);
  const out: InferredConstraint[] = [];
  const seen = new Set<string>();
  const push = (c: InferredConstraint) => {
    const key = constraintKey(c);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  for (const s of o.snaps) {
    const target = o.entity(s.id);
    if (!target || !takesConstraints(target)) continue;
    const points = POINT_SNAPS[s.mode];
    const onTarget = points
      ? constraintPointsOf(target).find(
          (c) => points.includes(c.ref.point) && distance(c.at, s.point) <= tol.linear,
        )
      : undefined;
    const curve =
      s.mode === 'NEA' || s.mode === 'PER' || s.mode === 'TAN'
        ? curveAt(target, s.point, tol)
        : undefined;
    if (!onTarget && !curve) continue;
    for (const e of added) {
      if (e.handle === target.handle) continue;
      const at = pointAt(e, s.point, tol);
      if (!at) continue;
      if (onTarget) {
        push({ kind: 'coincident', refs: [onTarget.ref, at.ref] });
        continue;
      }
      if (!curve) continue;
      const straights = straightAt(e, at.ref);
      // A line Tangent to a circle meets it at one point, its end: holding the end on the
      // circle as well would be redundant, which the solver refuses.
      const tangent =
        s.mode === 'TAN' ? straights.filter((l) => touches(l.shape, curve.shape, tol)) : [];
      if (tangent.length === 0) push({ kind: 'coincident', refs: [curve.ref, at.ref] });
      for (const l of tangent) push({ kind: 'tangent', refs: [l.ref, curve.ref] });
      if (s.mode !== 'PER') continue;
      for (const l of straights) {
        const t = turn(curve.shape, l.shape);
        if (t && t.cos <= tol.angular) {
          push({ kind: 'perpendicular', refs: [curve.ref, l.ref] });
        }
      }
    }
  }

  if (o.command === 'LINE') {
    const lines = added.filter((e) => e.geom.kind === 'LINE');
    const end = (e: Entity) => (e.geom.kind === 'LINE' ? e.geom.end : { x: NaN, y: NaN });
    const start = (e: Entity) => (e.geom.kind === 'LINE' ? e.geom.start : { x: NaN, y: NaN });
    const join = (a: Entity, b: Entity) => {
      if (distance(end(a), start(b)) > tol.linear) return;
      push({
        kind: 'coincident',
        refs: [
          { entity: a.handle, point: 'end' },
          { entity: b.handle, point: 'start' },
        ],
      });
    };
    for (let i = 0; i + 1 < lines.length; i++) join(lines[i]!, lines[i + 1]!);
    // Close: the last line's end on the first line's start.
    if (lines.length >= 2) join(lines.at(-1)!, lines[0]!);
  }

  if (o.command === 'RECTANG') {
    for (const e of added) {
      const g = e.geom;
      if (g.kind !== 'LWPOLYLINE' || !g.closed || g.vertices.length !== 4) continue;
      if (g.vertices.some((v) => v.bulge !== 0)) continue;
      const shapes = polylineShapes(e);
      const seg = (segment: number): ConstraintCurveRef => ({ entity: e.handle, segment });
      const t02 = turn(shapes[0]!, shapes[2]!);
      const t13 = turn(shapes[1]!, shapes[3]!);
      const t01 = turn(shapes[0]!, shapes[1]!);
      if (t02 && t02.sin <= tol.angular) push({ kind: 'parallel', refs: [seg(0), seg(2)] });
      if (t13 && t13.sin <= tol.angular) push({ kind: 'parallel', refs: [seg(1), seg(3)] });
      if (t01 && t01.cos <= tol.angular) push({ kind: 'perpendicular', refs: [seg(0), seg(1)] });
    }
  }
  return out;
}
