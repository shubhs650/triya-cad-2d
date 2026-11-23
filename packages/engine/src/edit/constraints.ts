// Geometric constraints in the drawing (M9-05): what GEOMCONSTRAINT and the GC* commands pick
// and the solver the app gives the engine (`ConstraintService`, `@triya/constraints`' PlaneGCS
// model, which sits above the engine). The drawing keeps the constraints as objects
// (`GeometricConstraintObject`); the solver keeps nothing between calls.
//
// AutoCAD 2024 Help, "GEOMCONSTRAINT (Command)" and "About Applying Geometric Constraints":
// a constraint point is a valid point of an object (endpoint, midpoint, center, insertion
// point), and the one nearest the cursor is taken; a polyline segment is picked as its own
// object.
import { closestPoint } from '../geom/closest';
import { polylineSegment, polylineSegmentCount } from '../geom/eval';
import { distance, midpoint } from '../geom/vec';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { Replacement } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isGeometricConstraint,
  type ConstraintCurveRef,
  type ConstraintPointRef,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
} from '../model/types';
import type { Similarity } from './similarity';

/** Why the solver refused a constraint, with the constraints in the way (the new one included). */
export interface ConstraintRefusal {
  readonly ok: false;
  readonly reason: 'unsupported' | 'invalid' | 'overconstrained' | 'redundant';
  readonly message: string;
  readonly conflicting: readonly Handle[];
}

export type ConstraintAddResult =
  | {
      readonly ok: true;
      /** The entities the solver moved to satisfy the new constraint. */
      readonly updated: readonly Replacement<Entity>[];
      /** Degrees of freedom left in the constrained group the new constraint joined. */
      readonly dofs: number;
    }
  | ConstraintRefusal;

export type ConstraintEditResult =
  | {
      readonly ok: true;
      /**
       * The edit's own replacements (adjusted where the solver had to), then the other entities
       * it moved to keep the constraints.
       */
      readonly updated: readonly Replacement<Entity>[];
    }
  | ConstraintRefusal;

/** The geometric constraint solver: `@triya/constraints`' ConstraintModel over PlaneGCS. */
export interface ConstraintSolver {
  /**
   * Adds `constraint` to the drawing's `constraints` and solves its group, the second object
   * adjusting to the first; refused, nothing moved, when it does not fit its references or
   * would over-constrain the geometry.
   */
  add(
    constraints: readonly GeometricConstraintObject[],
    constraint: GeometricConstraintObject,
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): ConstraintAddResult;
  /**
   * Re-solves the drawing's `constraints` after an edit (M9-06): the values each of `edits`
   * changed are held and the geometry constrained to them follows. `lookup` gives the drawing as
   * it was before the edit. Refused when the edit breaks a constraint the rest cannot absorb (a
   * Fix, or a Horizontal line turned).
   */
  solveEdit(
    constraints: readonly GeometricConstraintObject[],
    edits: readonly Replacement<Entity>[],
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): ConstraintEditResult;
}

/** Loads the solver once it is first needed (a WebAssembly module of its own). */
export type ConstraintService = () => Promise<ConstraintSolver>;

/** The drawing's geometric constraints. */
export function geometricConstraints(model: DocumentModel): GeometricConstraintObject[] {
  return [...model.objects.values()].filter(isGeometricConstraint);
}

/**
 * The kind a constraint takes on copies carried by `t` (M9-06): every geometric relation but
 * Horizontal and Vertical survives a move, turn, scale or reflection; those two hold when the
 * copies' directions stay level (turned by a multiple of 180°) and swap when turned square.
 * Undefined when a copy at another angle cannot keep it.
 */
export function carriedKind(
  kind: GeometricConstraintKind,
  t: Similarity,
): GeometricConstraintKind | undefined {
  if (kind !== 'horizontal' && kind !== 'vertical') return kind;
  const turns = (2 * t.angle) / Math.PI;
  const quarter = Math.round(turns);
  if (Math.abs(turns - quarter) > 1e-9) return undefined;
  if (quarter % 2 === 0) return kind;
  return kind === 'horizontal' ? 'vertical' : 'horizontal';
}

/**
 * Adds, for each of the drawing's constraints whose objects were all copied, the same constraint
 * between the copies (COPY, MIRROR, ROTATE and SCALE's Copy; AutoCAD's PARAMETERCOPYMODE 1:
 * constraints among the objects copied go with them, those to objects left behind do not).
 * `copies` maps each source's handle to its copy.
 */
export function carryConstraints(
  b: ChangeSetBuilder,
  model: DocumentModel,
  copies: ReadonlyMap<Handle, Entity>,
  t: Similarity,
): void {
  if (copies.size === 0) return;
  for (const c of geometricConstraints(model)) {
    if (!c.refs.every((r) => copies.has(r.entity))) continue;
    const kind = carriedKind(c.kind, t);
    if (!kind) continue;
    b.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: c.owner,
      kind,
      refs: c.refs.map((r) => ({ ...r, entity: copies.get(r.entity)!.handle })),
    } as Omit<GeometricConstraintObject, 'handle'>);
  }
}

/** A constraint point of an entity and where it is. */
export interface ConstraintPoint {
  readonly ref: ConstraintPointRef;
  readonly at: Vec2;
}

/**
 * The points of `e` a constraint can take, as ConstraintModel maps them; none for an entity it
 * does not map (ellipses, splines, blocks, text…).
 */
export function constraintPointsOf(e: Entity): ConstraintPoint[] {
  const g = e.geom;
  const entity = e.handle;
  switch (g.kind) {
    case 'LINE':
      return [
        { ref: { entity, point: 'start' }, at: g.start },
        { ref: { entity, point: 'end' }, at: g.end },
        { ref: { entity, point: 'mid' }, at: midpoint(g.start, g.end) },
      ];
    case 'CIRCLE':
      return [{ ref: { entity, point: 'center' }, at: g.center }];
    case 'ARC': {
      const on = (a: number): Vec2 => ({
        x: g.center.x + g.radius * Math.cos(a),
        y: g.center.y + g.radius * Math.sin(a),
      });
      return [
        { ref: { entity, point: 'center' }, at: g.center },
        { ref: { entity, point: 'start' }, at: on(g.startAngle) },
        { ref: { entity, point: 'end' }, at: on(g.endAngle) },
      ];
    }
    case 'POINT':
      return [{ ref: { entity, point: 'position' }, at: g.position }];
    case 'LWPOLYLINE': {
      const out: ConstraintPoint[] = g.vertices.map((v, index) => ({
        ref: { entity, point: 'vertex', index },
        at: { x: v.x, y: v.y },
      }));
      for (let index = 0; index < polylineSegmentCount(g); index++) {
        const s = polylineSegment(g, index);
        out.push(
          'line' in s
            ? { ref: { entity, point: 'mid', index }, at: midpoint(s.line.a, s.line.b) }
            : { ref: { entity, point: 'center', index }, at: s.arc.center },
        );
      }
      return out;
    }
    default:
      return [];
  }
}

/** The constraint point of `e` nearest `p`, AutoCAD's pick; undefined when it has none. */
export function constraintPointAt(e: Entity, p: Vec2): ConstraintPoint | undefined {
  let best: ConstraintPoint | undefined;
  for (const c of constraintPointsOf(e))
    if (!best || distance(c.at, p) < distance(best.at, p)) best = c;
  return best;
}

/**
 * The curve a pick at `p` takes on `e`: a LINE, CIRCLE or ARC whole, or the LWPOLYLINE segment
 * nearest the pick; undefined for an entity a constraint cannot take as a curve.
 */
export function constraintCurveAt(
  e: Entity,
  p: Vec2,
  tol: Tolerance,
): ConstraintCurveRef | undefined {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE':
    case 'CIRCLE':
    case 'ARC':
      return { entity: e.handle };
    case 'LWPOLYLINE': {
      const n = polylineSegmentCount(g);
      if (n === 0) return undefined;
      const t = closestPoint(g, p, tol).t;
      return { entity: e.handle, segment: Math.min(Math.max(Math.floor(t), 0), n - 1) };
    }
    default:
      return undefined;
  }
}
