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
  isDimensionalConstraint,
  isGeometricConstraint,
  type ConstraintCurveRef,
  type ConstraintPointRef,
  type ConstraintRef,
  type DimensionalConstraintKind,
  type DimensionalConstraintObject,
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

/**
 * A parameter whose expression a solve changed (M9-03 part 3): a reference constraint measuring
 * geometry that moved, and the parameters that follow from it.
 */
export interface ExpressionChange {
  readonly parameter: string;
  readonly expression: string;
}

export type ConstraintAddResult =
  | {
      readonly ok: true;
      /** The entities the solver moved to satisfy the new constraint. */
      readonly updated: readonly Replacement<Entity>[];
      /** Degrees of freedom left in the constrained group the new constraint joined. */
      readonly dofs: number;
      /** Dimensional constraints' expressions the moved geometry changed. */
      readonly expressions?: readonly ExpressionChange[];
    }
  | ConstraintRefusal;

/** A dimensional constraint as DIMCONSTRAINT and the DC* commands ask for one (M9-03 part 3). */
export interface DimensionalConstraintSpec {
  /** Linear becomes Horizontal or Vertical by the points (horizontal when as far across as up). */
  readonly dimension: DimensionalConstraintKind | 'linear';
  readonly refs: readonly ConstraintRef[];
  /** The parameter's name; the next free d1, ang1, rad1 or dia1 when not given. */
  readonly parameter?: string;
  /** The value or expression typed; the measured value when not given. */
  readonly expression?: string;
  readonly reference?: boolean;
}

/** What a dimensional constraint would measure, before it is placed. */
export type DimensionMeasurement =
  | {
      readonly ok: true;
      readonly dimension: DimensionalConstraintKind;
      /** A distance in drawing units, an angle in degrees. */
      readonly value: number;
      /** The name a new constraint's parameter takes when none is typed. */
      readonly parameter: string;
    }
  | ConstraintRefusal;

export type DimensionAddResult =
  | {
      readonly ok: true;
      readonly dimension: DimensionalConstraintKind;
      readonly parameter: string;
      /** The parameter's expression as kept (the measured value when none was typed). */
      readonly expression: string;
      readonly value: number;
      readonly updated: readonly Replacement<Entity>[];
      readonly dofs: number;
      readonly expressions: readonly ExpressionChange[];
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
      /** Dimensional constraints' expressions the moved geometry changed (reference ones). */
      readonly expressions?: readonly ExpressionChange[];
    }
  | ConstraintRefusal;

/**
 * A row of the Parameters Manager (M9-03 part 5, AutoCAD's PARAMETERS palette): a dimensional
 * constraint's parameter, with its value worked out from the expressions.
 */
export interface ParameterInfo {
  readonly name: string;
  readonly expression: string;
  /** A distance in drawing units or an angle in degrees; undefined while it has none. */
  readonly value: number | undefined;
  /** Why it has no value. */
  readonly error?: string;
  /** The constraint's type as the manager's Type column shows it: Horizontal, Aligned, Angular… */
  readonly type: string;
  readonly description: string;
  /** A reference constraint's parameter: measured, never set. */
  readonly reference: boolean;
  /** The dimensional constraint whose value it is. */
  readonly constraint: Handle;
}

/**
 * What an edit in the Parameters Manager changes (M9-03 part 5): the entities the new values
 * moved and the expressions the edit rewrote (its own, and others that name it).
 */
export type ParameterChangeResult =
  | {
      readonly ok: true;
      readonly updated: readonly Replacement<Entity>[];
      readonly expressions: readonly ExpressionChange[];
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
    dimensions?: readonly DimensionalConstraintObject[],
  ): ConstraintAddResult;
  /**
   * Re-solves the drawing's `constraints` after an edit (M9-06): the values each of `edits`
   * changed are held and the geometry constrained to them follows. `lookup` gives the drawing as
   * it was before the edit. With `whole`, each edited entity is held whole, the values it kept
   * too (a modify command places its objects whole; a grip drag moves only its grip). Refused
   * when the edit breaks a constraint the rest cannot absorb (a Fix, or a Horizontal line
   * turned). The drawing's `dimensions` keep their values while the edit is solved.
   */
  solveEdit(
    constraints: readonly GeometricConstraintObject[],
    edits: readonly Replacement<Entity>[],
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
    whole: boolean,
    dimensions?: readonly DimensionalConstraintObject[],
  ): ConstraintEditResult;
  /** What `spec` measures and the name its parameter would take (M9-03 part 3). */
  measure(
    dimensions: readonly DimensionalConstraintObject[],
    spec: DimensionalConstraintSpec,
    lookup: (handle: Handle) => Entity | undefined,
  ): DimensionMeasurement;
  /**
   * Adds a dimensional constraint to the drawing's and solves its group to the value, the second
   * object adjusting; refused, nothing moved, when the expression has no value or one out of
   * range, or the value would over-constrain the geometry (AutoCAD then offers a reference
   * constraint: add it again with `reference`).
   */
  addDimension(
    constraints: readonly GeometricConstraintObject[],
    dimensions: readonly DimensionalConstraintObject[],
    spec: DimensionalConstraintSpec,
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): DimensionAddResult;
  /** The drawing's parameters, as the Parameters Manager lists them (M9-03 part 5). */
  parameters(dimensions: readonly DimensionalConstraintObject[]): readonly ParameterInfo[];
  /**
   * Sets parameter `name`'s expression and moves the geometry its values drive; refused, nothing
   * changed, when the expression has no value, makes a cycle, or the geometry cannot take it.
   */
  setExpression(
    constraints: readonly GeometricConstraintObject[],
    dimensions: readonly DimensionalConstraintObject[],
    name: string,
    expression: string,
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): ParameterChangeResult;
  /** Renames a parameter; `expressions` are those naming it, rewritten. Moves nothing. */
  renameParameter(
    dimensions: readonly DimensionalConstraintObject[],
    from: string,
    to: string,
  ): ParameterChangeResult;
  /**
   * The expressions that name parameter `name` once it is deleted with its constraint: each
   * keeps the value it had, as the Parameters Manager's delete does. Moves nothing.
   */
  deleteParameter(
    dimensions: readonly DimensionalConstraintObject[],
    name: string,
  ): ParameterChangeResult;
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

/** The drawing's dimensional constraints (M9-03 part 3). */
export function dimensionalConstraints(model: DocumentModel): DimensionalConstraintObject[] {
  return [...model.objects.values()].filter(isDimensionalConstraint);
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
