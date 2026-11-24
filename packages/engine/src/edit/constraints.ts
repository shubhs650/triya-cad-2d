// Geometric constraints in the drawing (M9-05): what GEOMCONSTRAINT and the GC* commands pick
// and the solver the app gives the engine (`ConstraintService`, `@triya/constraints`' PlaneGCS
// model, which sits above the engine). The drawing keeps the constraints as objects
// (`GeometricConstraintObject`); the solver keeps nothing between calls.
//
// AutoCAD 2024 Help, "GEOMCONSTRAINT (Command)" and "About Applying Geometric Constraints":
// a constraint point is a valid point of an object (endpoint, midpoint, center, insertion
// point), and the one nearest the cursor is taken; a polyline segment is picked as its own
// object.
import { ccwSweep } from '../geom/angle';
import { closestPoint } from '../geom/closest';
import { polylineSegment, polylineSegmentCount } from '../geom/eval';
import { distance, midpoint } from '../geom/vec';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import type { Replacement } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isDimensionalConstraint,
  isGeometricConstraint,
  isUserParameter,
  type ConstraintCurveRef,
  type ConstraintPointRef,
  type ConstraintRef,
  type DimensionalConstraintKind,
  type DimensionalConstraintObject,
  type Entity,
  type GeometricConstraintObject,
  type ParameterObject,
  type UserParameterObject,
} from '../model/types';

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
 * constraint's parameter or a user parameter (part 6), with its value worked out from the
 * expressions.
 */
export interface ParameterInfo {
  readonly name: string;
  readonly expression: string;
  /** A distance in drawing units or an angle in degrees; undefined while it has none. */
  readonly value: number | undefined;
  /** Why it has no value. */
  readonly error?: string;
  /**
   * The constraint's type as the manager's Type column shows it: Horizontal, Aligned, Angular…,
   * or User for a user parameter.
   */
  readonly type: string;
  readonly description: string;
  /** A reference constraint's parameter: measured, never set. */
  readonly reference: boolean;
  /** The dimensional constraint whose value it is, or the user parameter's own object. */
  readonly constraint: Handle;
  /** A user parameter (the manager's User Parameters group). */
  readonly user?: boolean;
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
    dimensions?: readonly ParameterObject[],
  ): ConstraintAddResult;
  /**
   * Re-solves the drawing's `constraints` after an edit (M9-06): the values each of `edits`
   * changed are held and the geometry constrained to them follows. `lookup` gives the drawing as
   * it was before the edit. With `whole`, each edited entity is held whole, the values it kept
   * too (a modify command places its objects whole; a grip drag moves only its grip). Refused
   * when the edit breaks a constraint the rest cannot absorb (a Fix, or a Horizontal line
   * turned). The drawing's `dimensions` keep their values while the edit is solved.
   *
   * Each `dimensions` here is the drawing's `parameterObjects`: its dimensional constraints and
   * the user parameters their expressions may name (M9-03 part 6).
   */
  solveEdit(
    constraints: readonly GeometricConstraintObject[],
    edits: readonly Replacement<Entity>[],
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
    whole: boolean,
    dimensions?: readonly ParameterObject[],
  ): ConstraintEditResult;
  /** What `spec` measures and the name its parameter would take (M9-03 part 3). */
  measure(
    dimensions: readonly ParameterObject[],
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
    dimensions: readonly ParameterObject[],
    spec: DimensionalConstraintSpec,
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): DimensionAddResult;
  /** The drawing's parameters, as the Parameters Manager lists them (M9-03 part 5). */
  parameters(dimensions: readonly ParameterObject[]): readonly ParameterInfo[];
  /**
   * Sets parameter `name`'s expression and moves the geometry its values drive; refused, nothing
   * changed, when the expression has no value, makes a cycle, or the geometry cannot take it.
   */
  setExpression(
    constraints: readonly GeometricConstraintObject[],
    dimensions: readonly ParameterObject[],
    name: string,
    expression: string,
    lookup: (handle: Handle) => Entity | undefined,
    tolerance: Tolerance,
  ): ParameterChangeResult;
  /** Renames a parameter; `expressions` are those naming it, rewritten. Moves nothing. */
  renameParameter(
    dimensions: readonly ParameterObject[],
    from: string,
    to: string,
  ): ParameterChangeResult;
  /**
   * The expressions that name parameter `name` once it is deleted with its constraint: each
   * keeps the value it had, as the Parameters Manager's delete does. Moves nothing.
   */
  deleteParameter(dimensions: readonly ParameterObject[], name: string): ParameterChangeResult;
}

/** Loads the solver once it is first needed (a WebAssembly module of its own). */
export type ConstraintService = () => Promise<ConstraintSolver>;

/** The drawing's geometric constraints. */
export function geometricConstraints(model: DocumentModel): GeometricConstraintObject[] {
  return [...model.objects.values()].filter(isGeometricConstraint);
}

/** The drawing's dimensional constraints (M9-03 part 3). */
export function dimensionalConstraints(model: DocumentModel): DimensionalConstraintObject[] {
  return [...model.objects.values()].filter(isDimensionalConstraint);
}

/** The drawing's user parameters (M9-03 part 6). */
export function userParameters(model: DocumentModel): UserParameterObject[] {
  return [...model.objects.values()].filter(isUserParameter);
}

/**
 * Everything that holds a parameter, dimensional constraints first and then user parameters, as
 * the Parameters Manager groups them: what the solver builds the parameter table from.
 */
export function parameterObjects(model: DocumentModel): ParameterObject[] {
  return [...dimensionalConstraints(model), ...userParameters(model)];
}

/** A constraint point of an entity and where it is. */
export interface ConstraintPoint {
  readonly ref: ConstraintPointRef;
  readonly at: Vec2;
}

/**
 * The points of `e` a constraint can take, as ConstraintModel maps them (AutoCAD's: a line's
 * ends and midpoint, an arc's centre, ends and midpoint, a polyline's vertices and its
 * segments' midpoints and arc centres, an open spline's ends); none for an entity it does not
 * map (ellipses, blocks, text…).
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
        {
          ref: { entity, point: 'mid' },
          at: on(g.startAngle + ccwSweep(g.startAngle, g.endAngle) / 2),
        },
      ];
    }
    case 'SPLINE':
      return splineEnds(e);
    case 'POINT':
      return [{ ref: { entity, point: 'position' }, at: g.position }];
    case 'LWPOLYLINE': {
      const out: ConstraintPoint[] = g.vertices.map((v, index) => ({
        ref: { entity, point: 'vertex', index },
        at: { x: v.x, y: v.y },
      }));
      for (let index = 0; index < polylineSegmentCount(g); index++) {
        const s = polylineSegment(g, index);
        if ('line' in s) {
          out.push({ ref: { entity, point: 'mid', index }, at: midpoint(s.line.a, s.line.b) });
          continue;
        }
        const { center, radius, startAngle, sweep } = s.arc;
        const t = startAngle + sweep / 2;
        out.push(
          { ref: { entity, point: 'center', index }, at: center },
          {
            ref: { entity, point: 'mid', index },
            at: { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) },
          },
        );
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * An open spline's start and end, the points a constraint takes on it: its first and last
 * control points, where the curve begins and ends when its knots are clamped there.
 */
function splineEnds(e: Entity): ConstraintPoint[] {
  const g = e.geom;
  if (g.kind !== 'SPLINE' || g.closed || g.periodic) return [];
  const c = g.controlPoints;
  const k = g.knots;
  if (c.length < 2 || k.length !== c.length + g.degree + 1) return [];
  const eps = 1e-9 * Math.max(1, Math.abs(k[k.length - 1]! - k[0]!));
  const clamped = (us: readonly number[]) => us.every((u) => Math.abs(u - us[0]!) <= eps);
  const out: ConstraintPoint[] = [];
  if (clamped(k.slice(0, g.degree + 1))) {
    out.push({ ref: { entity: e.handle, point: 'start' }, at: c[0]! });
  }
  if (clamped(k.slice(k.length - g.degree - 1))) {
    out.push({ ref: { entity: e.handle, point: 'end' }, at: c[c.length - 1]! });
  }
  return out;
}

/**
 * The end of a curve nearest `p`, as GCSMOOTH picks it ("Selects an endpoint of a curve"): a
 * line's, an arc's, an open polyline's or an open spline's start or end; undefined for
 * anything else.
 */
export function constraintEndAt(e: Entity, p: Vec2): ConstraintPoint | undefined {
  const g = e.geom;
  const ends =
    g.kind === 'LINE' ||
    g.kind === 'ARC' ||
    g.kind === 'SPLINE' ||
    (g.kind === 'LWPOLYLINE' && !g.closed)
      ? constraintPointsOf(e).filter((c) => c.ref.point === 'start' || c.ref.point === 'end')
      : [];
  if (g.kind === 'LWPOLYLINE' && g.vertices.length >= 2) {
    const v = g.vertices;
    ends.push(
      { ref: { entity: e.handle, point: 'start' }, at: { x: v[0]!.x, y: v[0]!.y } },
      {
        ref: { entity: e.handle, point: 'end' },
        at: { x: v[v.length - 1]!.x, y: v[v.length - 1]!.y },
      },
    );
  }
  let best: ConstraintPoint | undefined;
  for (const c of ends) if (!best || distance(c.at, p) < distance(best.at, p)) best = c;
  return best;
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
    case 'SPLINE':
      // Whole, for Fix; the solver says which other constraints cannot take a spline.
      return splineEnds(e).length ? { entity: e.handle } : undefined;
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
