// The dimensional constraint a dimension converts to (M9-03 part 9, DCCONVERT and DIMCONSTRAINT's
// "Select associative dimension to convert"; AutoCAD 2024 Help, "DCCONVERT (Command)": "Converts
// associative dimensions to dimensional constraints").
//
// A dimension measures what its definition points sit on: a linear dimension at 0° (or 180°) is
// a Horizontal constraint and at 90° a Vertical one, an aligned one Aligned, a two-line or
// three-point angular one Angular, a radius or diameter one Radius or Diameter. Ordinate, arc
// length and jogged radius dimensions have no dimensional constraint, nor does a linear one at
// another angle (a constraint measures across, along or up, never along a direction of its own).
//
// Which objects: AutoCAD converts associative dimensions, whose DIMASSOC names the objects. Triya's
// dimension commands do not make associative dimensions (DIMASSOC 1, M4-02), so a dimension
// without a DIMASSOC converts when its definition points lie on constraint points of objects of
// its space, as an associative dimension made with object snaps would; one with a DIMASSOC looks
// only among the objects it names. Where several objects share a point, one whose ends are both
// the dimension's is taken whole (a line's length, as DCALIGNED's Object), then two points of the
// same object, then the first object drawn; ends and vertices before centres before midpoints.
import { closestPoint } from '../geom/closest';
import { polylineSegment, polylineSegmentCount } from '../geom/eval';
import { distance, midpoint } from '../geom/vec';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  ConstraintCurveRef,
  ConstraintPointRef,
  ConstraintRef,
  DimAssoc,
  DimensionalConstraintKind,
  Entity,
} from '../model/types';
import { constraintPointsOf, type ConstraintPoint } from './constraints';

/** What a dimension converts to: the constraint's kind, references and dimension line location. */
export interface DimensionConversion {
  readonly dimension: DimensionalConstraintKind;
  readonly refs: readonly ConstraintRef[];
  readonly location: Vec2;
}

/**
 * Why a dimension does not convert: `kind`, an ordinate, arc length or jogged dimension; `rotated`,
 * a linear dimension neither horizontal nor vertical; `unattached`, its points (or its circle) are
 * not on objects a constraint can take.
 */
export type DimensionConversionProblem = { readonly problem: 'kind' | 'rotated' | 'unattached' };

/** Ends and vertices first, then centres, then midpoints. */
const RANK: Readonly<Record<ConstraintPointRef['point'], number>> = {
  start: 0,
  end: 0,
  vertex: 0,
  position: 0,
  quadrant: 0,
  center: 1,
  mid: 2,
};

/** The objects a dimension's constraint may name: its DIMASSOC's, or every object of its space. */
function candidatesOf(model: DocumentModel, dim: Entity): Entity[] {
  const assoc = [...model.objects.values()].find(
    (o): o is DimAssoc => o.type === 'DIMASSOC' && (o as DimAssoc).dimension === dim.handle,
  );
  if (assoc) {
    const named = new Set<Handle>();
    for (const p of assoc.points) {
      if (p?.geometry.length === 1) named.add(p.geometry[0]!);
      if (p?.intersection?.geometry.length === 1) named.add(p.intersection.geometry[0]!);
    }
    return [...named].flatMap((h) => {
      const e = model.entityByHandle(h);
      return e && e.owner === dim.owner ? [e] : [];
    });
  }
  return model
    .blockEntities(dim.owner)
    .map((id) => model.entity(id)!)
    .filter((e) => e.handle !== dim.handle);
}

/** The constraint points at `p`, best first. */
function pointsAt(candidates: readonly Entity[], p: Vec2, tol: Tolerance): ConstraintPoint[] {
  const out = candidates.flatMap((e) =>
    constraintPointsOf(e).filter((c) => distance(c.at, p) <= tol.linear),
  );
  // A stable sort keeps the drawing's order within a rank.
  return out.sort((a, b) => RANK[a.ref.point] - RANK[b.ref.point]);
}

/** The line (a LINE, or a polyline's line segment) whose two ends are `p` and `q`. */
function lineWithEnds(
  candidates: readonly Entity[],
  p: Vec2,
  q: Vec2,
  tol: Tolerance,
): ConstraintCurveRef | undefined {
  const same = (a: Vec2, b: Vec2) =>
    (distance(a, p) <= tol.linear && distance(b, q) <= tol.linear) ||
    (distance(a, q) <= tol.linear && distance(b, p) <= tol.linear);
  for (const e of candidates) {
    const g = e.geom;
    if (g.kind === 'LINE' && same(g.start, g.end)) return { entity: e.handle };
    if (g.kind !== 'LWPOLYLINE') continue;
    for (let segment = 0; segment < polylineSegmentCount(g); segment++) {
      const s = polylineSegment(g, segment);
      if ('line' in s && same(s.line.a, s.line.b)) return { entity: e.handle, segment };
    }
  }
  return undefined;
}

/** The line (a LINE, or a polyline's line segment) both points lie on. */
function lineThrough(
  candidates: readonly Entity[],
  p: Vec2,
  q: Vec2,
  tol: Tolerance,
): ConstraintCurveRef | undefined {
  const ends = lineWithEnds(candidates, p, q, tol);
  if (ends) return ends;
  const on = (a: Vec2, b: Vec2) =>
    [p, q].every(
      (x) => closestPoint({ kind: 'LINE', start: a, end: b }, x, tol).distance <= tol.linear,
    );
  for (const e of candidates) {
    const g = e.geom;
    if (g.kind === 'LINE' && on(g.start, g.end)) return { entity: e.handle };
    if (g.kind !== 'LWPOLYLINE') continue;
    for (let segment = 0; segment < polylineSegmentCount(g); segment++) {
      const s = polylineSegment(g, segment);
      if ('line' in s && on(s.line.a, s.line.b)) return { entity: e.handle, segment };
    }
  }
  return undefined;
}

/** Two constraint points: a line between them whole, else two of one object, else the best. */
function twoPoints(
  candidates: readonly Entity[],
  p: Vec2,
  q: Vec2,
  tol: Tolerance,
): ConstraintRef[] | undefined {
  const whole = lineWithEnds(candidates, p, q, tol);
  if (whole) return [whole];
  const at = pointsAt(candidates, p, tol);
  const to = pointsAt(candidates, q, tol);
  if (at.length === 0 || to.length === 0) return undefined;
  for (const a of at) {
    const b = to.find((c) => c.ref.entity === a.ref.entity && c.ref !== a.ref);
    if (b && distance(a.at, b.at) > tol.linear) return [a.ref, b.ref];
  }
  return [at[0]!.ref, to[0]!.ref];
}

/** The circle, arc or polyline arc segment with this centre and radius. */
function circleAt(
  candidates: readonly Entity[],
  center: Vec2,
  radius: number,
  tol: Tolerance,
): ConstraintCurveRef | undefined {
  const same = (c: Vec2, r: number) =>
    distance(c, center) <= tol.linear && Math.abs(r - radius) <= tol.linear;
  for (const e of candidates) {
    const g = e.geom;
    if ((g.kind === 'CIRCLE' || g.kind === 'ARC') && same(g.center, g.radius)) {
      return { entity: e.handle };
    }
    if (g.kind !== 'LWPOLYLINE') continue;
    for (let segment = 0; segment < polylineSegmentCount(g); segment++) {
      const s = polylineSegment(g, segment);
      if ('arc' in s && same(s.arc.center, s.arc.radius)) return { entity: e.handle, segment };
    }
  }
  return undefined;
}

/** Whether `angle` is a multiple of π (0) or an odd multiple of π/2 (π/2), within `tol`. */
function axisOf(angle: number, tol: Tolerance): 'horizontal' | 'vertical' | undefined {
  if (Math.abs(Math.sin(angle)) <= tol.angular) return 'horizontal';
  if (Math.abs(Math.cos(angle)) <= tol.angular) return 'vertical';
  return undefined;
}

/** The dimensional constraint dimension `dim` converts to, or why it does not. */
export function dimensionConstraintOf(
  model: DocumentModel,
  dim: Entity,
  tol: Tolerance,
): DimensionConversion | DimensionConversionProblem {
  const g = dim.geom;
  if (g.kind !== 'DIMENSION') return { problem: 'kind' };
  const candidates = candidatesOf(model, dim);
  const done = (
    dimension: DimensionalConstraintKind,
    refs: readonly ConstraintRef[] | undefined,
    location: Vec2,
  ): DimensionConversion | DimensionConversionProblem =>
    refs ? { dimension, refs, location } : { problem: 'unattached' };
  switch (g.dimType) {
    case 'linear': {
      const axis = axisOf(g.rotation ?? 0, tol);
      if (!axis) return { problem: 'rotated' };
      return done(axis, twoPoints(candidates, g.first, g.second, tol), g.definitionPoint);
    }
    case 'aligned':
      return done('aligned', twoPoints(candidates, g.first, g.second, tol), g.definitionPoint);
    case 'angular': {
      const a = lineThrough(candidates, g.line1Start, g.line1End, tol);
      const b = lineThrough(candidates, g.line2Start, g.definitionPoint, tol);
      return done(
        'angular',
        a && b && !(a.entity === b.entity && a.segment === b.segment) ? [a, b] : undefined,
        g.arcPoint,
      );
    }
    case 'angular3pt': {
      const refs = [g.vertex, g.first, g.second].map((p) => pointsAt(candidates, p, tol)[0]?.ref);
      return done(
        'angular',
        refs.every((r) => r) ? (refs as ConstraintPointRef[]) : undefined,
        g.definitionPoint,
      );
    }
    case 'radius':
    case 'diameter': {
      const center =
        g.dimType === 'radius' ? g.definitionPoint : midpoint(g.definitionPoint, g.chordPoint);
      const radius = distance(center, g.chordPoint);
      const circle = circleAt(candidates, center, radius, tol);
      return done(
        g.dimType === 'radius' ? 'radial' : 'diameter',
        circle && [circle],
        g.textPosition,
      );
    }
    default:
      return { problem: 'kind' };
  }
}
