// ConstraintModel (M9-02): AutoCAD's geometric constraints on Triya entities, solved by
// PlaneGCS (planegcs.ts).
//
// The model keeps the constraints; the document keeps the entities. Each operation maps the
// entities a constraint set touches to PlaneGCS points, lines, circles and arcs, solves, and
// hands back the entities the solver moved as `Replacement`s for the caller's ChangeSet. A
// sketch is built per operation from the connected group of constraints concerned and
// disposed after: groups are small, a build and solve of 50 constraints takes about a
// millisecond (M9-01), and nothing has to be kept in step with the document between edits.
//
// AutoCAD's rules encoded here (GEOMCONSTRAINT, AutoCAD 2024 Help):
//  - The second object adjusts to the first: while a new constraint is solved the first
//    object (or, for a point on a curve, the curve; for Symmetric, the first object and the
//    symmetry line) is held where it is, unless other constraints need it to move. The
//    second object moves whole where it can, else a line turns about its held point, and
//    lines keep their length before any stretches (M9-08, solveHolding).
//  - A constraint that would over-constrain the geometry, contradicting the others or
//    adding nothing to them, is refused and the geometry is left as it was.
//  - Symmetric lines mirror their angle, not their endpoints; symmetric circles and arcs
//    mirror their centres and share a radius.
//  - Coincident puts a point on a curve or on its extension (PlaneGCS's point-on-line and
//    point-on-circle are the unbounded curves).
// Where the Help is silent: Horizontal or Vertical on a line keeps its start (AutoCAD keeps
// the end nearest the pick, which a reference does not carry; the command passes the
// endpoint pair when it matters), and an edit holds exactly the values it changed, so a
// dragged grip stays under the cursor and the rest of the geometry follows.
//
// Splines (M9-02 part 2) take part by their control points: an open, clamped spline's ends are
// constraint points (AutoCAD's only points on a spline), Fix holds the whole spline, and Smooth
// joins an end of one to an end of another spline, a line, an arc or a polyline with G2
// continuity (GCSMOOTH: "Constrains a spline to be contiguous and maintain G2 continuity with
// another spline, line, arc, or polyline"). The spline is what adjusts, its end's first three
// control points moving (the Help: "The splines are updated to be contiguous"); the other curve
// stays. Where the Help is silent: a spline whose control points a constraint moved loses its
// fit points, as SPLINEDIT's control-vertex edits make it, unless it only moved whole.
// An arc's midpoint (and a polyline arc segment's) is a constraint point too.
//
// Ellipses and elliptical arcs (M9-02 part 3) are PlaneGCS ellipses (centre, first focus, minor
// radius; an arc's parameters and end points). AutoCAD's points on one are its centre and its
// axes' ends ("Center, major and minor axes"), an arc's ends too; Concentric takes its centre,
// Coincident puts a point on it, Tangent takes it with a line, and Fix holds it whole. Where
// the Help is silent: Tangent between an ellipse and a circle, arc or ellipse, and Equal and
// Symmetric on ellipses, are refused (PlaneGCS has no plain tangency between conics).
//
// Dimensional constraints (M9-03, measure.ts) live beside the geometric ones, each with its
// parameter in the model's ParameterTable, the Parameters Manager's table: an edit of an
// expression goes through `setExpression`, which re-solves the geometry its values drive. A
// reference constraint (AutoCAD's Reference property) is left out of the solver: its
// parameter follows what it measures after every solve and cannot be edited, and no driving
// value may follow from it, so an edit never feeds back into the values that drove it (the
// Help is silent; AutoCAD lets reference parameters be named in expressions).

import {
  bulgeArc,
  ccwSweep,
  ellipseSweep,
  normalizeAngle,
  polylineSegmentCount,
  purgeFitData,
  TAU,
  updateEntity,
  type BulgeVertex,
  type EllipseGeometry,
  type Entity,
  type EntityGeometry,
  type Handle,
  type LwPolylineGeometry,
  type Replacement,
  type SplineGeometry,
  type Tolerance,
  type Vec2,
} from '@triya/engine';
import {
  DIMENSION_PREFIX,
  DIMENSION_TYPE,
  dimensionHolds,
  dimensionShape,
  type DimensionSide,
  dimensionValueError,
  formatMeasured,
  lineAngle,
  measureDimension,
  pointAngle,
  type DimensionalConstraint,
  type DimensionalKind,
} from './measure';
import { ParameterTable } from './parameters';
import {
  ARC_RULES_TAG,
  ConstraintKind,
  SolveStatus,
  type ArcIds,
  type CircleIds,
  type EllipseIds,
  type EllipticalArcIds,
  type PlaneGcs,
  type PlaneGcsSketch,
} from './planegcs';

/** AutoCAD's geometric constraints, in GEOMCONSTRAINT's prompt order. */
export const GEOMETRIC_KINDS = [
  'horizontal',
  'vertical',
  'perpendicular',
  'parallel',
  'tangent',
  'smooth',
  'coincident',
  'concentric',
  'collinear',
  'symmetric',
  'equal',
  'fix',
] as const;
export type GeometricKind = (typeof GEOMETRIC_KINDS)[number];

/**
 * A point on an entity: a LINE's start, end or mid; a CIRCLE's center; an ARC's center,
 * start, end or mid; a POINT's position; an LWPOLYLINE's vertex `index`, start or end, the mid
 * of segment `index` or the center of arc segment `index`; a SPLINE's start or end; an
 * ELLIPSE's center, `quadrant` `index` (its axes' ends: 0 the major axis's, 1 the minor's, 2
 * and 3 opposite them, as the parameter runs), and an elliptical arc's start and end.
 */
export type PointName = 'start' | 'end' | 'mid' | 'center' | 'position' | 'vertex' | 'quadrant';

export interface PointRef {
  readonly entity: Handle;
  readonly point: PointName;
  readonly index?: number;
}

/** A whole LINE, CIRCLE or ARC, or segment `segment` of an LWPOLYLINE. */
export interface CurveRef {
  readonly entity: Handle;
  readonly segment?: number;
}

export type GeomRef = PointRef | CurveRef;

export const isPointRef = (ref: GeomRef): ref is PointRef => 'point' in ref;

/**
 * One geometric constraint. `refs` in the order GEOMCONSTRAINT picks them: Horizontal and
 * Vertical take a line or two points; Coincident two points or a point and a curve;
 * Symmetric two objects (or points) and then the symmetry line; Fix one point or object;
 * Smooth the end of a spline and then the end of the curve it joins (a spline, line, arc or
 * an open polyline's start or end); the others two objects.
 */
export interface GeometricConstraint {
  readonly handle: Handle;
  readonly kind: GeometricKind;
  readonly refs: readonly GeomRef[];
}

export interface Refusal {
  readonly ok: false;
  /**
   * `unsupported`: geometry the model cannot map yet; `invalid`: references that do not fit
   * the kind; `overconstrained`: it contradicts the other constraints; `redundant`: they
   * already imply it.
   */
  readonly reason: 'unsupported' | 'invalid' | 'overconstrained' | 'redundant';
  readonly message: string;
  /** The constraints in the way: the conflicting or redundant ones, the refused one included. */
  readonly conflicting: readonly Handle[];
}

export type AddResult =
  | {
      readonly ok: true;
      /** Entities the solver moved to satisfy the new constraint. */
      readonly updated: readonly Replacement<Entity>[];
      /** Degrees of freedom left in the constrained group the new constraint joined. */
      readonly dofs: number;
      /** Reference parameters that measured the moved geometry, and those that follow from them. */
      readonly parameters?: readonly string[];
    }
  | Refusal;

export type EditResult =
  | {
      readonly ok: true;
      /** The edit's own replacements (adjusted where the solver had to), then the rest it moved. */
      readonly updated: readonly Replacement<Entity>[];
      /** Reference parameters that measured the moved geometry, and those that follow from them. */
      readonly parameters?: readonly string[];
    }
  | Refusal;

/** A dimensional constraint as DIMCONSTRAINT makes it. */
export interface DimensionSpec {
  readonly handle: Handle;
  /** Linear becomes Horizontal or Vertical (measure.ts). */
  readonly dimension: DimensionalKind;
  readonly refs: readonly GeomRef[];
  /** Its parameter's name; the next free d1, ang1, rad1 or dia1 when not given. */
  readonly parameter?: string;
  /** The value typed at the prompt (`name = expression` or an expression); the measured value when not given. */
  readonly expression?: string;
  /** A reference constraint: measures, does not drive. */
  readonly reference?: boolean;
  readonly description?: string;
}

export type DimensionResult =
  | {
      readonly ok: true;
      /** The constraint as kept (Linear resolved, its parameter named). */
      readonly constraint: DimensionalConstraint;
      readonly parameter: string;
      readonly value: number;
      /** Entities the solver moved to satisfy the new constraint. */
      readonly updated: readonly Replacement<Entity>[];
      readonly dofs: number;
      /** Reference parameters that measured the moved geometry, and those that follow from them. */
      readonly parameters: readonly string[];
    }
  | Refusal;

export type ParameterResult =
  | {
      readonly ok: true;
      /** Entities moved to the new values. */
      readonly updated: readonly Replacement<Entity>[];
      /** Every row whose expression or value changed, in evaluation order. */
      readonly parameters: readonly string[];
    }
  | Refusal;

type AnyConstraint = GeometricConstraint | DimensionalConstraint;
const isDimensional = (c: AnyConstraint): c is DimensionalConstraint => 'dimension' in c;

export interface ModelDiagnosis {
  /** Every constrained group solves. */
  readonly ok: boolean;
  /** Degrees of freedom left in the constrained geometry (unconstrained entities not counted). */
  readonly dofs: number;
  readonly conflicting: readonly Handle[];
  readonly redundant: readonly Handle[];
  readonly partiallyRedundant: readonly Handle[];
  /** Constraints whose references no longer fit (an entity gone or changed type). */
  readonly invalid: readonly Handle[];
}

export type EntityLookup = (handle: Handle) => Entity | undefined;

// ── The model ───────────────────────────────────────────────────────────────────────────────

export class ConstraintModel {
  readonly #gcs: PlaneGcs;
  readonly #tol: Tolerance;
  readonly #parameters: ParameterTable;
  #constraints: GeometricConstraint[] = [];
  #dimensions: DimensionalConstraint[] = [];

  /**
   * `tolerance`: the document's (toleranceFromExtents), for what counts as moved.
   * `parameters`: the drawing's Parameters Manager table, a new one when not given.
   */
  constructor(gcs: PlaneGcs, tolerance: Tolerance, parameters = new ParameterTable()) {
    this.#gcs = gcs;
    this.#tol = tolerance;
    this.#parameters = parameters;
  }

  /** The geometric constraints. */
  get constraints(): readonly GeometricConstraint[] {
    return this.#constraints;
  }

  get dimensions(): readonly DimensionalConstraint[] {
    return this.#dimensions;
  }

  /**
   * The Parameters Manager's table. Read it here; change expressions and names through
   * `setExpression` and `renameParameter`, which solve and keep the constraints in step.
   * User parameters may be added to it directly.
   */
  get parameters(): ParameterTable {
    return this.#parameters;
  }

  /** The dimensional constraints that reference `entity`. */
  dimensionsOn(entity: Handle): DimensionalConstraint[] {
    return this.#dimensions.filter((c) => c.refs.some((r) => r.entity === entity));
  }

  /** Replaces the dimensional constraints without checking or solving them (a file being read). */
  loadDimensions(dimensions: readonly DimensionalConstraint[]): void {
    this.#dimensions = [...dimensions];
  }

  get(handle: Handle): GeometricConstraint | undefined {
    return this.#constraints.find((c) => c.handle === handle);
  }

  /** The constraints that reference `entity`. */
  constraintsOn(entity: Handle): GeometricConstraint[] {
    return this.#constraints.filter((c) => c.refs.some((r) => r.entity === entity));
  }

  /** Replaces the constraints without checking or solving them (a file being read). */
  load(constraints: readonly GeometricConstraint[]): void {
    this.#constraints = [...constraints];
  }

  /**
   * Removes a constraint. A dimensional constraint's parameter goes with it, and the
   * expressions that named it keep its value (ParameterTable.delete), so nothing moves.
   */
  remove(handle: Handle): boolean {
    const dim = this.#dimensions.find((c) => c.handle === handle);
    if (dim) {
      this.#dimensions = this.#dimensions.filter((c) => c !== dim);
      this.#parameters.delete(dim.parameter);
      return true;
    }
    const before = this.#constraints.length;
    this.#constraints = this.#constraints.filter((c) => c.handle !== handle);
    return this.#constraints.length < before;
  }

  /**
   * Adds a constraint and solves its group, the second object adjusting to the first.
   * Refused, and nothing kept or moved, when it does not fit its references or would
   * over-constrain the geometry.
   */
  add(constraint: GeometricConstraint, lookup: EntityLookup): AddResult {
    const r = this.#addSolved(constraint, holdFor(constraint), lookup);
    if (!r.ok) return r;
    this.#constraints.push(constraint);
    const parameters = this.#remeasure(r.updated, lookup);
    return parameters.length ? { ...r, parameters } : r;
  }

  /**
   * Adds a dimensional constraint as DIMCONSTRAINT does: its parameter joins the table
   * (named d1, ang1, rad1, dia1… unless given; the measured value unless an expression is
   * given) and the geometry is solved to its value, the second object adjusting. Refused,
   * and nothing kept or moved, when it does not fit its references, its expression has no
   * value or one out of range, or it would over-constrain the geometry (AutoCAD then offers
   * a reference constraint: add it again with `reference`).
   */
  addDimension(spec: DimensionSpec, lookup: EntityLookup): DimensionResult {
    const measured = measureDimension(spec, lookup);
    if (!measured.ok) return refusal(measured.reason, measured.message, [spec.handle]);
    const table = this.#parameters;
    const name = spec.parameter ?? table.nextName(DIMENSION_PREFIX[measured.dimension]);
    const added = table.add({
      name,
      expression:
        spec.reference || spec.expression === undefined
          ? formatMeasured(measured.value)
          : spec.expression,
      kind: 'constraint',
      type: DIMENSION_TYPE[measured.dimension],
      ...(spec.description === undefined ? {} : { description: spec.description }),
    });
    if (!added.ok) return refusal('invalid', added.error, [spec.handle]);
    const constraint: DimensionalConstraint = {
      handle: spec.handle,
      dimension: measured.dimension,
      refs: spec.refs,
      parameter: name,
      ...(spec.reference ? { reference: true } : {}),
    };
    const undo = () => table.delete(name);
    const value = table.value(name)!;
    if (constraint.reference) {
      this.#dimensions.push(constraint);
      return {
        ok: true,
        constraint,
        parameter: name,
        value,
        updated: [],
        dofs: this.#dofs(constraint.refs, lookup),
        parameters: [],
      };
    }
    const wrong = this.#drivingError(constraint);
    if (wrong) {
      undo();
      return refusal('invalid', wrong, [spec.handle]);
    }
    const r = this.#addSolved(constraint, dimensionShape(constraint, lookup).holds, lookup);
    if (!r.ok) {
      undo();
      return r;
    }
    this.#dimensions.push(constraint);
    return {
      ...r,
      constraint,
      parameter: name,
      value,
      parameters: this.#remeasure(r.updated, lookup),
    };
  }

  /**
   * Sets a parameter's expression (the Parameters Manager's Expression cell, or a
   * constraint's value edited in place) and moves the geometry its driving values change.
   * Refused, the table and the drawing left as they were, when the expression has no value,
   * a driving value would be out of range or follow from a reference parameter, the
   * parameter is a reference one, or the geometry cannot take the values.
   */
  setExpression(
    name: string,
    expression: string,
    lookup: EntityLookup,
    side: DimensionSide = 'second',
  ): ParameterResult {
    const table = this.#parameters;
    const row = table.get(name);
    if (!row) return refusal('invalid', `No parameter named "${name}".`);
    const own = this.#dimensions.find((c) => c.parameter === name);
    if (own?.reference) {
      return refusal(
        'invalid',
        `${name} is a reference parameter: its value is measured and cannot be set`,
        [own.handle],
      );
    }
    const edit = table.setExpression(name, expression);
    if (!edit.ok) return refusal('invalid', edit.error);
    const undo = () => table.setExpression(name, row.expression);
    const driven = this.#dimensions.filter(
      (c) => !c.reference && edit.changed.includes(c.parameter),
    );
    for (const c of driven) {
      const wrong = this.#drivingError(c);
      if (wrong) {
        undo();
        return refusal('invalid', `${c.parameter}: ${wrong}`, [c.handle]);
      }
    }
    const updated: Replacement<Entity>[] = [];
    const done = new Set<DimensionalConstraint>();
    for (const c of driven) {
      if (done.has(c)) continue;
      const group = this.#group(c.refs.map((r) => r.entity));
      const changed = driven.filter((d) => group.includes(d));
      changed.forEach((d) => done.add(d));
      const r = this.#resolveValues(
        group,
        changed,
        lookup,
        own && side === 'first' ? own : undefined,
      );
      if (!r.ok) {
        undo();
        return r;
      }
      updated.push(...r.updated);
    }
    const remeasured = this.#remeasure(updated, lookup);
    return { ok: true, updated, parameters: [...new Set([...edit.changed, ...remeasured])] };
  }

  /**
   * The Properties palette's Reference (M9-03 part 10; AutoCAD 2024 Help, "About Applying
   * Dimensional Constraints"): `reference` makes the constraint measure rather than drive, its
   * expression set to the value it measures; refused while a driving value follows from it.
   * Made driving again it keeps that value and is solved as a new one; refused, and left a
   * reference, when it would over-constrain the geometry ("You cannot change a reference
   * parameter back to a dimensional constraint if doing so would overconstrain the geometry").
   * `parameters`: the rows whose expression or value changed.
   */
  setReference(handle: Handle, reference: boolean, lookup: EntityLookup): ParameterResult {
    const c = this.#dimensions.find((d) => d.handle === handle);
    if (!c) return refusal('invalid', `No dimensional constraint ${handle}.`);
    if ((c.reference === true) === reference) return { ok: true, updated: [], parameters: [] };
    const table = this.#parameters;
    if (reference) {
      const driven = new Set(table.dependents(c.parameter));
      const follows = this.#dimensions.find((d) => !d.reference && driven.has(d.parameter));
      if (follows) {
        return refusal(
          'invalid',
          `${follows.parameter} follows from ${c.parameter}: a driving value cannot follow from a reference parameter`,
          [follows.handle],
        );
      }
      const measured = measureDimension(c, lookup);
      if (!measured.ok) return refusal(measured.reason, measured.message, [handle]);
      const set = table.setExpression(c.parameter, formatMeasured(measured.value));
      if (!set.ok) return refusal('invalid', set.error, [handle]);
      this.#dimensions = this.#dimensions.map((d) => (d === c ? { ...c, reference: true } : d));
      return { ok: true, updated: [], parameters: set.changed };
    }
    const { reference: _, ...driving } = c;
    const wrong = this.#drivingError(driving);
    if (wrong) return refusal('invalid', wrong, [handle]);
    // Solved as a constraint added anew, without itself among the drawing's.
    const others = this.#dimensions;
    this.#dimensions = others.filter((d) => d !== c);
    const r = this.#addSolved(driving, dimensionShape(driving, lookup).holds, lookup);
    if (!r.ok) {
      this.#dimensions = others;
      return r;
    }
    this.#dimensions = others.map((d) => (d === c ? driving : d));
    return { ok: true, updated: r.updated, parameters: this.#remeasure(r.updated, lookup) };
  }

  /** Renames a parameter in the table, in its constraint and in every expression naming it. */
  renameParameter(
    from: string,
    to: string,
  ): { readonly ok: true; readonly parameters: readonly string[] } | Refusal {
    const r = this.#parameters.rename(from, to);
    if (!r.ok) return refusal('invalid', r.error);
    this.#dimensions = this.#dimensions.map((c) =>
      c.parameter === from ? { ...c, parameter: to } : c,
    );
    return { ok: true, parameters: [to, ...r.changed.filter((n) => n !== to)] };
  }

  /**
   * Builds a constraint's group with it added and solves, holding `holds` (the first
   * object) and as much of the rest as can stay. The caller keeps the constraint.
   */
  #addSolved(
    constraint: AnyConstraint,
    holds: readonly GeomRef[],
    lookup: EntityLookup,
  ): (AddResult & { ok: true }) | Refusal {
    const group = this.#group(constraint.refs.map((r) => r.entity));
    const build = this.#build(lookup);
    try {
      for (const c of group) build.tryConstrain(c);
      const before = group.length ? build.diagnose() : undefined;
      try {
        build.constrain(constraint);
      } catch (e) {
        if (e instanceof Refused) return refusal(e.reason, e.message, [constraint.handle]);
        throw e;
      }
      const dimensional = isDimensional(constraint);
      const kind = dimensional ? undefined : constraint.kind;
      const keeps = dimensional ? [constraint] : [];
      if (!solveHolding(build, holds, constraint.refs, kind, keeps)) {
        const named = build.diagnose().conflicting;
        const conflicting = named.length
          ? named
          : this.#culprits([...group, constraint], lookup, () => undefined);
        return refusal(
          'overconstrained',
          'The constraint would over-constrain the geometry',
          withHandle(conflicting, constraint.handle),
        );
      }
      const diagnosis = build.diagnose();
      const newlyRedundant = diagnosis.redundant.filter((h) => !before?.redundant.includes(h));
      if (newlyRedundant.length) {
        return refusal(
          'redundant',
          'The constraint would over-constrain the geometry: the others already imply it',
          withHandle(newlyRedundant, constraint.handle),
        );
      }
      return { ok: true, updated: build.moved(new Map()), dofs: diagnosis.dofs };
    } finally {
      build.dispose();
    }
  }

  /**
   * Solves a group whose driving values `changed` were set, holding their first objects; the
   * second instead for `firstSide`, set from its first side (a triangular grip, M9-03 part 11).
   */
  #resolveValues(
    group: readonly AnyConstraint[],
    changed: readonly DimensionalConstraint[],
    lookup: EntityLookup,
    firstSide?: DimensionalConstraint,
  ): EditResult {
    const build = this.#build(lookup);
    try {
      for (const c of group) build.tryConstrain(c);
      const holds = changed.flatMap((c) =>
        dimensionHolds(c, lookup, c === firstSide ? 'first' : 'second'),
      );
      if (
        !solveHolding(
          build,
          holds,
          changed.flatMap((c) => c.refs),
          undefined,
          changed,
          firstSide,
        )
      ) {
        const named = build.diagnose().conflicting;
        return refusal(
          'overconstrained',
          'The geometry cannot take the value',
          named.length ? named : changed.map((c) => c.handle),
        );
      }
      return { ok: true, updated: build.moved(new Map()) };
    } finally {
      build.dispose();
    }
  }

  /** Why a driving constraint's parameter cannot drive it now, if it cannot. */
  #drivingError(c: DimensionalConstraint): string | undefined {
    const table = this.#parameters;
    const row = table.get(c.parameter);
    if (row?.value === undefined) return row?.error ?? `No parameter named "${c.parameter}".`;
    const range = dimensionValueError(c.dimension, row.value);
    if (range) return range;
    for (const r of this.#dimensions) {
      if (r.reference && table.dependents(r.parameter).includes(c.parameter)) {
        return `a driving value cannot follow from reference parameter ${r.parameter}`;
      }
    }
    return undefined;
  }

  /**
   * Sets each reference parameter that measures geometry `updated` moved to its new value;
   * the rows changed, with those that follow from them.
   */
  #remeasure(updated: readonly Replacement<Entity>[], lookup: EntityLookup): string[] {
    if (!updated.length) return [];
    const after = new Map(updated.map((u) => [u.after.handle, u.after]));
    const view: EntityLookup = (h) => after.get(h) ?? lookup(h);
    const changed: string[] = [];
    for (const c of this.#dimensions) {
      if (!c.reference || !c.refs.some((r) => after.has(r.entity))) continue;
      const m = measureDimension(c, view);
      const old = this.#parameters.value(c.parameter);
      if (!m.ok || (old !== undefined && Math.abs(m.value - old) <= this.#tol.linear)) continue;
      const r = this.#parameters.setExpression(c.parameter, formatMeasured(m.value));
      if (r.ok) changed.push(...r.changed);
    }
    return [...new Set(changed)];
  }

  /** Degrees of freedom of the constrained group around `refs`' entities. */
  #dofs(refs: readonly GeomRef[], lookup: EntityLookup): number {
    const group = this.#group(refs.map((r) => r.entity));
    if (!group.length) return 0;
    const build = this.#build(lookup);
    try {
      for (const c of group) build.tryConstrain(c);
      return build.diagnose().dofs;
    } finally {
      build.dispose();
    }
  }

  /** The constraints the solver takes: geometric and driving dimensional ones. */
  #active(): AnyConstraint[] {
    return [...this.#constraints, ...this.#dimensions.filter((c) => !c.reference)];
  }

  #build(lookup: EntityLookup): Build {
    return new Build(this.#gcs.sketch(), lookup, this.#tol, (c) => {
      const v = this.#parameters.value(c.parameter);
      if (dimensionValueError(c.dimension, v)) return undefined;
      return c.dimension === 'angular' ? (v! * Math.PI) / 180 : v;
    });
  }

  /**
   * Re-solves the constraints an edit touches. `edits` are the edit's replacements; the
   * values each one changed are held and the geometry constrained to them follows. With
   * `whole`, each edited entity is held whole, unchanged values too: a modify command (MOVE,
   * ROTATE…) places its objects whole, where a grip drag moves only its grip (M9-06); a grip
   * drag still keeps the rest of its entity where it can, and a line an orientation
   * constraint turns keeps its length (M9-09, solveEditKeeping). Refused when the edit breaks
   * a constraint the rest cannot absorb (a Fix, say).
   */
  solveEdit(
    edits: readonly Replacement<Entity>[],
    lookup: EntityLookup,
    whole = false,
  ): EditResult {
    const done = (updated: readonly Replacement<Entity>[]): EditResult => {
      const parameters = this.#remeasure(updated, lookup);
      return parameters.length ? { ok: true, updated, parameters } : { ok: true, updated };
    };
    const group = this.#group(edits.map((e) => e.after.handle));
    if (!group.length) return done(edits);
    const edited = new Map(edits.map((e) => [e.after.handle, e]));
    const build = this.#editBuild(group, edits, lookup, whole);
    try {
      const start = build.snapshot();
      const solved = () => solveEditKeeping(build, group, new Set(edited.keys()), whole);
      if (!solved() && !this.#solveTurnedAlong(build, group, edits, start, solved)) {
        const named = build.diagnose().conflicting;
        return refusal(
          'overconstrained',
          'The change breaks a constraint the other geometry cannot follow',
          named.length ? named : this.#culprits(group, lookup, () => edits, whole),
        );
      }
      return done(build.moved(edited, lookup));
    } finally {
      build.dispose();
    }
  }

  /**
   * Tries an edit again with the lines it turns along started turned (M9-11). PlaneGCS's
   * Parallel is the cross product of two directions, which has no slope when they are square:
   * an edit that turns one of a parallel pair exactly 90 degrees leaves the solver no way to
   * start turning the other (it could only shorten it to nothing), and 89 degrees solved.
   * So when the edited lines all turned by one angle (ROTATE, or a grip drag of one line),
   * the lines Parallel, Perpendicular, Collinear or an angle ties to them start turned by
   * it about their starts (M9-08's pivot), lengths kept, and the edit is solved from there.
   * Symmetric turns its line the other way and is left to the solver.
   */
  #solveTurnedAlong(
    build: Build,
    group: readonly AnyConstraint[],
    edits: readonly Replacement<Entity>[],
    start: readonly number[],
    solved: () => boolean,
  ): boolean {
    const angle = commonTurn(edits, this.#tol.angular);
    if (angle === undefined) return false;
    const along = turnedAlong(
      group,
      edits.map((e) => e.after.handle),
    );
    if (!along.length) return false;
    build.restore(start);
    build.turnLines(along, angle);
    return solved();
  }

  /** Degrees of freedom, conflicting, redundant and invalid constraints, group by group. */
  diagnose(lookup: EntityLookup): ModelDiagnosis {
    const out = {
      ok: true,
      dofs: 0,
      conflicting: [] as Handle[],
      redundant: [] as Handle[],
      partiallyRedundant: [] as Handle[],
      invalid: [] as Handle[],
    };
    const done = new Set<Handle>();
    for (const c of this.#active()) {
      if (done.has(c.handle)) continue;
      const group = this.#group(c.refs.map((r) => r.entity));
      for (const g of group) done.add(g.handle);
      const build = this.#build(lookup);
      try {
        for (const g of group) if (!build.tryConstrain(g)) out.invalid.push(g.handle);
        const ok = build.solveChecked();
        const d = build.diagnose();
        out.ok &&= ok;
        out.dofs += d.dofs;
        out.conflicting.push(
          ...(ok || d.conflicting.length
            ? d.conflicting
            : this.#culprits(group, lookup, () => undefined)),
        );
        out.redundant.push(...d.redundant);
        out.partiallyRedundant.push(...d.partiallyRedundant);
      } finally {
        build.dispose();
      }
    }
    return out;
  }

  /**
   * A sketch of `group` with an edit applied and its changed values held: built from the
   * drawing as it was (a Fix holds where its geometry was) with the edit's values set into
   * it, or, when an edit reshaped a polyline, from the edited geometry with the edited
   * entities held whole.
   */
  #editBuild(
    group: readonly AnyConstraint[],
    edits: readonly Replacement<Entity>[],
    lookup: EntityLookup,
    whole = false,
  ): Build {
    const build = this.#build(lookup);
    for (const c of group) build.tryConstrain(c);
    if (edits.every((e) => build.assignEdit(e))) {
      build.holdEdited(whole);
      return build;
    }
    build.dispose();
    const edited = new Map(edits.map((e) => [e.after.handle, e.after]));
    const reshaped = this.#build((h) => edited.get(h) ?? lookup(h));
    for (const c of group) reshaped.tryConstrain(c);
    reshaped.reshapedEdits(edits.map((e) => e.after.handle));
    reshaped.holdEdited(true);
    return reshaped;
  }

  /**
   * The constraints of a set that cannot be solved without which it can: PlaneGCS names
   * conflicts it sees in the Jacobian, but not a solution that collapses a line or circle
   * to nothing (two horizontal lines made perpendicular), which `solveChecked` refuses.
   */
  #culprits(
    constraints: readonly AnyConstraint[],
    lookup: EntityLookup,
    edits: () => readonly Replacement<Entity>[] | undefined,
    whole = false,
  ): Handle[] {
    const out: Handle[] = [];
    for (const left of constraints) {
      const rest = constraints.filter((c) => c !== left);
      const e = edits();
      const build = e ? this.#editBuild(rest, e, lookup, whole) : this.#build(lookup);
      try {
        if (!e) for (const c of rest) build.tryConstrain(c);
        if (build.solveChecked()) out.push(left.handle);
      } finally {
        build.dispose();
      }
    }
    return out;
  }

  /** The constraints connected, through the entities they share, to any of `entities`. */
  #group(entities: readonly Handle[]): AnyConstraint[] {
    const reached = new Set(entities);
    const taken = new Set<AnyConstraint>();
    const active = this.#active();
    for (let grew = true; grew;) {
      grew = false;
      for (const c of active) {
        if (taken.has(c) || !c.refs.some((r) => reached.has(r.entity))) continue;
        taken.add(c);
        for (const r of c.refs) reached.add(r.entity);
        grew = true;
      }
    }
    // The model's order, so tags (and with them diagnosis) do not depend on the seed, but
    // Coincident first: a Tangent between curves whose ends are joined is solved at that
    // point (Build.#tangent), which it can only see once the join is in.
    const group = active.filter((c) => taken.has(c));
    const coincident = (c: AnyConstraint) => !isDimensional(c) && c.kind === 'coincident';
    return [...group.filter(coincident), ...group.filter((c) => !coincident(c))];
  }
}

const withHandle = (handles: readonly Handle[], handle: Handle) =>
  handles.includes(handle) ? [...handles] : [...handles, handle];

function refusal(
  reason: Refusal['reason'],
  message: string,
  conflicting: readonly Handle[] = [],
): Refusal {
  return { ok: false, reason, message, conflicting };
}

/** What stays put while a new constraint is first solved (AutoCAD: the second object adjusts). */
function holdFor(c: GeometricConstraint): GeomRef[] {
  const [a, b, axis] = c.refs;
  if (!a) return [];
  switch (c.kind) {
    case 'fix':
      return [];
    case 'horizontal':
    case 'vertical':
      // A line turns about its start (Build.hold); of two points the second moves.
      return [a];
    case 'coincident':
      // A point goes onto the curve, whichever was picked first.
      return b && !isPointRef(b) ? [b] : [a];
    case 'symmetric':
      return axis ? [a, axis] : [a];
    case 'smooth':
      // The spline adjusts: the curve it joins stays, held whole (Build.hold).
      return b ? [b] : [];
    default:
      return [a];
  }
}

/** Geometric constraints that set a line's direction from another's. */
const ORIENTING: ReadonlySet<GeometricKind> = new Set<GeometricKind>([
  'parallel',
  'perpendicular',
  'collinear',
  'symmetric',
]);

/**
 * The entities whose lines a constraint of `group` turns with others: the curves of
 * Parallel, Perpendicular, Collinear and Symmetric, of an Angular dimension, and of an
 * Aligned one between two lines (which makes them parallel).
 */
function orientedEntities(group: readonly AnyConstraint[]): Set<Handle> {
  const out = new Set<Handle>();
  for (const c of group) {
    const orients = isDimensional(c)
      ? c.dimension === 'angular' || (c.dimension === 'aligned' && c.refs.length === 2)
      : ORIENTING.has(c.kind);
    if (!orients) continue;
    for (const r of c.refs) if (!isPointRef(r)) out.add(r.entity);
  }
  return out;
}

/**
 * The one angle (radians) every edited line turned by, or undefined when none turned or
 * they turned by different angles. Other edited entities do not count.
 */
function commonTurn(edits: readonly Replacement<Entity>[], tol: number): number | undefined {
  let out: number | undefined;
  for (const { before, after } of edits) {
    const was = before.geom;
    const g = after.geom;
    if (was.kind !== 'LINE' || g.kind !== 'LINE') continue;
    const u = { x: was.end.x - was.start.x, y: was.end.y - was.start.y };
    const v = { x: g.end.x - g.start.x, y: g.end.y - g.start.y };
    if (!Math.hypot(u.x, u.y) || !Math.hypot(v.x, v.y)) return undefined;
    const angle = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
    if (out === undefined) out = angle;
    else if (!sameAngle(angle, out, tol)) return undefined;
  }
  return out === undefined || Math.abs(out) <= tol ? undefined : out;
}

/**
 * The entities, other than `edited`, that a chain of Parallel, Perpendicular and Collinear
 * constraints, Angular dimensions and two-line Aligned ones ties to the edited ones: each
 * turns by the angle its neighbour turns.
 */
function turnedAlong(group: readonly AnyConstraint[], edited: readonly Handle[]): Handle[] {
  const links = group
    .filter((c) =>
      isDimensional(c)
        ? c.dimension === 'angular' || (c.dimension === 'aligned' && c.refs.length === 2)
        : ORIENTING.has(c.kind) && c.kind !== 'symmetric',
    )
    .map((c) => c.refs.filter((r) => !isPointRef(r)).map((r) => r.entity));
  const reached = new Set(edited);
  for (let grew = true; grew;) {
    grew = false;
    for (const link of links) {
      if (!link.some((h) => reached.has(h))) continue;
      for (const h of link) {
        if (reached.has(h)) continue;
        reached.add(h);
        grew = true;
      }
    }
  }
  return [...reached].filter((h) => !edited.includes(h));
}

/**
 * Solves an edit (its values set into `build`) so that constrained lines keep their length
 * (M9-09). A least-change solve spreads a turn over both ends of a line it has to turn,
 * shortening it (dragging the end of a line made parallel to a 20-long one left that one
 * 17.5 long), and lets a grip drag move the dragged line's other end. So:
 *  - the edited entities are first held whole as edited, and only their changed values when
 *    that cannot solve (a rectangle's corner grip moves the far end of the side it drags);
 *  - a line an orientation constraint turns (orientedEntities) keeps its length: with every
 *    other entity held, it turns about its start, else about whatever its joints allow;
 *    else the rest may move too, the lengths still kept; else the least-change solution
 *    stands. When least change cannot solve the edit at all (a quarter turn would collapse
 *    the line it shortens), these tiers are tried with every such line kept. A line the edit turns that way may in turn turn another: it joins the kept
 *    ones and the tiers run again.
 * A line held only by joints still stretches as a drag pulls it, its far end staying (a
 * polyline vertex's way): lengths are free until a dimensional constraint sets them, and a
 * constrained rectangle resizes from a grip on one side rather than moving whole. The Help
 * does not say which end a turned line keeps; the start, as for GCPARALLEL (M9-08).
 * False when the edit cannot be solved at all.
 */
function solveEditKeeping(
  build: Build,
  group: readonly AnyConstraint[],
  edited: ReadonlySet<Handle>,
  whole: boolean,
): boolean {
  build.releaseHolds();
  const start = build.snapshot();
  const attempt = (tier: () => void) => {
    build.restore(start);
    let ok = false;
    try {
      tier();
      ok = build.solveChecked();
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
    }
    build.releaseHolds();
    return ok;
  };
  const bases = whole
    ? [() => build.holdEdited(true)]
    : [() => build.holdEdited(true), () => build.holdEdited(false)];
  const candidates = [...orientedEntities(group)].filter((h) => !edited.has(h));
  // When even least change cannot solve (a quarter turn collapses the line it shortens),
  // every line that may turn keeps its length.
  let result = bases.some(attempt) ? build.snapshot() : undefined;
  let turned = result ? build.turned(candidates, start) : candidates;
  for (let round = 0; turned.length && round < candidates.length; round++) {
    const kept = turned;
    const others = build.entities().filter((h) => !edited.has(h) && !kept.includes(h));
    const keep = (base: () => void, how: KeepMoving, holdOthers: boolean) => () => {
      base();
      if (holdOthers) others.forEach((h) => build.holdEntity(h));
      kept.forEach((h) => build.keepMoving(h, how));
    };
    const tiers = [
      ...bases.flatMap((base) => [keep(base, 'pivot', true), keep(base, 'length', true)]),
      ...bases.map((base) => keep(base, 'length', false)),
    ];
    if (!tiers.some(attempt)) break;
    result = build.snapshot();
    const more = build.turned(candidates, start).filter((h) => !kept.includes(h));
    if (!more.length) break;
    turned = [...kept, ...more];
  }
  if (!result) return false;
  build.restore(result);
  return true;
}

/**
 * Solves a group with a new constraint or value, AutoCAD's way: the second object adjusts to
 * the first. `held` is the first object (geometric constraints: holdFor; dimensional:
 * dimensionShape), `refs` every reference of the constraints concerned. Tries, in turn,
 * holding everything but the second object (an arc moving whole), then letting the arc
 * change shape, then holding only the first object, then holding nothing; the first that
 * solves wins. False when none does.
 *
 * A geometric constraint first tries the tiers of M9-08, before any line may stretch: a
 * least-change solve spreads the change over every coordinate, so a line it turns comes out
 * shorter (GCPARALLEL on a 63-long line left it 60 long) and a horizontal line whose start
 * is joined to another line had its end left behind. AutoCAD moves the second object whole
 * where it can, or turns it about its held point, and keeps the lengths of lines it moves.
 * So, everything but the second object held: it moves whole; else a line turns about its
 * start, its length kept; else lines keep their length; else a line keeps its start and
 * direction (Equal: its end slides along it). Each of these keeps circles and arcs whole.
 * Then the old tiers, with a tier between holding the others and holding only the first
 * object where the objects joined to the second move too but keep their lengths. The Help
 * does not say which end a line turns about for Parallel or Perpendicular; the start, as
 * for Horizontal (the reference carries no pick point).
 */
function solveHolding(
  build: Build,
  held: readonly GeomRef[],
  refs: readonly GeomRef[],
  kind?: GeometricKind,
  keeps: readonly DimensionalConstraint[] = [],
  firstSide?: DimensionalConstraint,
): boolean {
  if (!held.length) return build.solveChecked();
  // Horizontal and Vertical hold only a line's start: the line itself turns.
  const turning =
    kind === 'horizontal' || kind === 'vertical'
      ? held.filter((r) => !isPointRef(r)).map((r) => r.entity)
      : [];
  const moving = new Set([
    ...refs.filter((r) => !held.includes(r)).map((r) => r.entity),
    ...turning,
  ]);
  const others = build.entities().filter((h) => !moving.has(h));
  const first = () => {
    held.forEach((ref) => build.hold(ref, kind));
    keeps.forEach((c) => build.keep(c, c === firstSide ? 'first' : 'second'));
  };
  const holdOthers = () => {
    first();
    others.forEach((h) => build.holdEntity(h));
  };
  const keepMoving = (how: KeepMoving) => () => {
    holdOthers();
    moving.forEach((h) => build.keepMoving(h, how));
  };
  // Every entity the first object does not hold whole.
  const loose = build
    .entities()
    .filter((h) => turning.includes(h) || !held.some((r) => !isPointRef(r) && r.entity === h));
  const geometric =
    kind === undefined
      ? []
      : [keepMoving('whole'), keepMoving('pivot'), keepMoving('length'), keepMoving('slide')];
  const tiers = [
    ...geometric,
    () => {
      holdOthers();
      moving.forEach((h) => build.holdShape(h));
    },
    holdOthers,
    ...(kind === undefined
      ? []
      : [
          () => {
            first();
            loose.forEach((h) => build.keepMoving(h, 'length'));
          },
        ]),
    first,
    () => undefined,
  ];
  for (const tier of tiers) {
    const values = build.snapshot();
    let ok = false;
    try {
      tier();
      ok = build.solveChecked();
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
    }
    build.releaseHolds();
    if (ok) return true;
    build.restore(values);
  }
  return false;
}

// ── One solver sketch ───────────────────────────────────────────────────────────────────────

class Refused extends Error {
  constructor(
    readonly reason: 'unsupported' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

interface LinePrim {
  readonly type: 'line';
  readonly id: number;
  readonly p1: number;
  readonly p2: number;
  mid?: number;
}
interface CirclePrim extends CircleIds {
  readonly type: 'circle';
}
interface ArcPrim extends ArcIds {
  readonly type: 'arc';
  /** A polyline arc segment that runs clockwise (negative bulge): start and end swapped. */
  readonly cw?: boolean;
  /** Its midpoint, once a constraint names it (Build.#arcMid). */
  mid?: number;
}
interface EllipsePrim extends EllipseIds {
  readonly type: 'ellipse';
  /** An elliptical arc's parameters and end points. */
  readonly arc?: Pick<EllipticalArcIds, 'startAngle' | 'endAngle' | 'start' | 'end'>;
  /** Its axes' ends, by quadrant, once a constraint names them. */
  readonly quadrants: (number | undefined)[];
}
type Curve = LinePrim | CirclePrim | ArcPrim | EllipsePrim;

type Mapped =
  | { readonly kind: 'LINE'; readonly line: LinePrim }
  | { readonly kind: 'CIRCLE'; readonly circle: CirclePrim }
  | { readonly kind: 'ARC'; readonly arc: ArcPrim }
  | { readonly kind: 'POINT'; readonly point: number }
  | { readonly kind: 'ELLIPSE'; readonly ellipse: EllipsePrim }
  | {
      readonly kind: 'SPLINE';
      /** Its control points, in order. */
      readonly points: readonly number[];
      readonly spline: SplineGeometry;
    }
  | {
      readonly kind: 'LWPOLYLINE';
      readonly vertices: readonly number[];
      readonly segments: readonly (LinePrim | ArcPrim)[];
      readonly closed: boolean;
    };

/**
 * A spline end as Smooth uses it: its first three control points counted from the end, and
 * the factor that turns them into the end's curvature (sketch.cpp's SplineEndCurvature*).
 */
interface SplineEnd {
  readonly points: readonly [number, number, number];
  readonly factor: number;
}

/** The end of the curve a spline is made smooth with, and where it is (Build.#endCurve). */
type EndCurve =
  | { readonly type: 'line'; readonly line: LinePrim; readonly at: number; readonly from: number }
  | { readonly type: 'arc'; readonly arc: ArcPrim; readonly at: number }
  | { readonly type: 'spline'; readonly end: SplineEnd; readonly at: number };

/** The tag of the structure Triya adds (a line's or arc's midpoint). */
const INTERNAL_TAG = ARC_RULES_TAG - 1;
/** What a moving object keeps while a geometric constraint is first solved (Build.keepMoving). */
type KeepMoving = 'whole' | 'pivot' | 'length' | 'slide';

/** The tag of what `Build.keep` and `Build.keepMoving` add until `releaseHolds()`. */
const KEEP_TAG = ARC_RULES_TAG - 2;

const describeRef = (ref: GeomRef) =>
  isPointRef(ref)
    ? `${ref.point}${ref.index === undefined ? '' : ` ${ref.index}`} of ${ref.entity}`
    : `${ref.entity}${ref.segment === undefined ? '' : ` segment ${ref.segment}`}`;

class Build {
  readonly #s: PlaneGcsSketch;
  readonly #lookup: EntityLookup;
  readonly #tol: Tolerance;
  readonly #mapped = new Map<Handle, { entity: Entity; m: Mapped }>();
  /** User constraint tags (1, 2, …) to constraint handles. */
  readonly #tags = new Map<number, Handle>();
  /** Points joined by Coincident constraints: each point's parent (union-find). */
  readonly #joined = new Map<number, number>();
  /** Whether `keep` added constraints (KEEP_TAG) that `releaseHolds()` removes. */
  #keeping = false;
  /** Parameters held (fixed) until `releaseHolds()`. */
  readonly #held = new Set<number>();
  /** The values edits set (assignEdit), and the entities edited, for `holdEdited`. */
  readonly #edit = { points: [] as number[], params: [] as number[], handles: [] as Handle[] };
  /** Whether the sketch was built from edited geometry, so an edit's values are not known apart. */
  #reshaped = false;
  /** Pairs of lines a Parallel constraint keeps parallel (pairKey). */
  readonly #parallel = new Set<string>();
  /** Lines' ends and circles' and arcs' radii, with their size when mapped. */
  readonly #sizes: { line?: LinePrim; radius?: number; initial: number }[] = [];
  /**
   * For each Smooth, how far the spline's end runs on along the curve it joins (a dot
   * product): a solution where it turns back is refused (#solveOnce).
   */
  readonly #senses: (() => number)[] = [];

  /** A driving dimensional constraint's value for the solver (radians for angles); undefined without one. */
  readonly #value: (c: DimensionalConstraint) => number | undefined;

  constructor(
    sketch: PlaneGcsSketch,
    lookup: EntityLookup,
    tol: Tolerance,
    value: (c: DimensionalConstraint) => number | undefined,
  ) {
    this.#s = sketch;
    this.#lookup = lookup;
    this.#tol = tol;
    this.#value = value;
  }

  dispose(): void {
    this.#s.dispose();
  }

  /** The sketch's diagnosis with tags turned back into constraint handles. */
  diagnose(): {
    dofs: number;
    conflicting: Handle[];
    redundant: Handle[];
    partiallyRedundant: Handle[];
  } {
    const d = this.#s.diagnose();
    const handles = (tags: number[]) =>
      tags.map((t) => this.#tags.get(t)).filter((h): h is Handle => h !== undefined);
    return {
      dofs: d.dofs,
      conflicting: handles(d.conflicting),
      redundant: handles(d.redundant),
      partiallyRedundant: handles(d.partiallyRedundant),
    };
  }

  /** Adds a constraint that is already in the model; false if its references no longer fit. */
  tryConstrain(c: AnyConstraint): boolean {
    try {
      this.constrain(c);
      return true;
    } catch (e) {
      if (e instanceof Refused) return false;
      throw e;
    }
  }

  constrain(c: AnyConstraint): void {
    if (isDimensional(c)) {
      this.#dimension(c);
      return;
    }
    const tag = this.#tags.size + 1;
    const add = (kind: ConstraintKind, ids: readonly number[]) => this.#s.constrain(kind, ids, tag);
    const refs = c.refs;
    const arity = (n: number) => {
      if (refs.length !== n) throw new Refused('invalid', `${c.kind} takes ${n} references`);
    };
    // Resolve every reference before adding anything, so a refusal leaves no partial constraint.
    switch (c.kind) {
      case 'horizontal':
      case 'vertical': {
        const [linesKind, pointsKind] =
          c.kind === 'horizontal'
            ? [ConstraintKind.Horizontal, ConstraintKind.HorizontalPoints]
            : [ConstraintKind.Vertical, ConstraintKind.VerticalPoints];
        if (refs.length === 1) {
          add(linesKind, [this.#line(refs[0]!).id]);
        } else {
          arity(2);
          const [p, q] = this.#distinctPoints(refs[0]!, refs[1]!);
          add(pointsKind, [p, q]);
        }
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'collinear': {
        arity(2);
        const a = this.#line(refs[0]!);
        const b = this.#line(refs[1]!);
        if (a === b) throw new Refused('invalid', `${c.kind} needs two different lines`);
        if (c.kind === 'collinear') {
          add(ConstraintKind.PointOnLine, [b.p1, a.id]);
          add(ConstraintKind.PointOnLine, [b.p2, a.id]);
        } else {
          add(c.kind === 'parallel' ? ConstraintKind.Parallel : ConstraintKind.Perpendicular, [
            a.id,
            b.id,
          ]);
          if (c.kind === 'parallel') this.#parallel.add(pairKey(a.id, b.id));
        }
        break;
      }
      case 'coincident': {
        arity(2);
        const [a, b] = refs as [GeomRef, GeomRef];
        if (isPointRef(a) && isPointRef(b)) {
          const [p, q] = this.#distinctPoints(a, b);
          add(ConstraintKind.Coincident, [p, q]);
          this.#join(p, q);
        } else if (isPointRef(a) !== isPointRef(b)) {
          const [p, curve] = isPointRef(a) ? [a, b as CurveRef] : [b as PointRef, a];
          const point = this.#point(p);
          const cv = this.#curve(curve);
          const kind = {
            line: ConstraintKind.PointOnLine,
            circle: ConstraintKind.PointOnCircle,
            arc: ConstraintKind.PointOnArc,
            ellipse: ConstraintKind.PointOnEllipse,
          }[cv.type];
          add(kind, [point, cv.id]);
        } else {
          throw new Refused('invalid', 'coincident takes two points, or a point and a curve');
        }
        break;
      }
      case 'concentric': {
        arity(2);
        const a = this.#centred(refs[0]!);
        const b = this.#centred(refs[1]!);
        if (a.center === b.center)
          throw new Refused('invalid', 'concentric needs two different centres');
        add(ConstraintKind.Coincident, [a.center, b.center]);
        break;
      }
      case 'tangent': {
        arity(2);
        const a = this.#curve(this.#curveRef(refs[0]!));
        const b = this.#curve(this.#curveRef(refs[1]!));
        if (a === b) throw new Refused('invalid', 'tangent needs two different curves');
        this.#tangent(a, b, tag);
        break;
      }
      case 'equal': {
        arity(2);
        const a = this.#curve(this.#curveRef(refs[0]!));
        const b = this.#curve(this.#curveRef(refs[1]!));
        if (a === b) throw new Refused('invalid', 'equal needs two different objects');
        if (a.type === 'line' && b.type === 'line') add(ConstraintKind.EqualLength, [a.id, b.id]);
        else if (isRound(a) && isRound(b)) add(...equalRadius(a, b));
        else throw new Refused('invalid', 'equal takes two lines, or two circles or arcs');
        break;
      }
      case 'symmetric': {
        arity(3);
        const axis = this.#line(refs[2]!);
        const [a, b] = refs as [GeomRef, GeomRef];
        if (isPointRef(a) && isPointRef(b)) {
          add(ConstraintKind.SymmetricLine, [...this.#distinctPoints(a, b), axis.id]);
          break;
        }
        if (isPointRef(a) || isPointRef(b)) {
          throw new Refused('invalid', 'symmetric takes two points or two objects');
        }
        const ca = this.#curve(a);
        const cb = this.#curve(b);
        if (ca === cb || ca === axis || cb === axis) {
          throw new Refused(
            'invalid',
            'symmetric needs two different objects and a third, the line',
          );
        }
        if (ca.type === 'line' && cb.type === 'line') {
          this.#symmetricAngles(ca, cb, axis, tag);
        } else if (isRound(ca) && isRound(cb)) {
          const eq = equalRadius(ca, cb);
          add(ConstraintKind.SymmetricLine, [ca.center, cb.center, axis.id]);
          add(...eq);
        } else {
          throw new Refused('invalid', 'symmetric takes two lines, or two circles or arcs');
        }
        break;
      }
      case 'fix': {
        arity(1);
        const { points, params } = this.#parts(refs[0]!, 'fix');
        this.#pin(points, params, tag);
        break;
      }
      case 'smooth':
        arity(2);
        this.#smooth(refs[0]!, refs[1]!, tag);
        break;
      default:
        throw new Refused('invalid', `unknown constraint kind ${String(c.kind)}`);
    }
    this.#tags.set(tag, c.handle);
  }

  /**
   * A driving dimensional constraint at its parameter's value. The sense it was drawn in is
   * kept: a horizontal distance stays to the right or left, an angle counter-clockwise or
   * clockwise, read from the geometry as it is when the sketch is built.
   */
  #dimension(c: DimensionalConstraint): void {
    const tag = this.#tags.size + 1;
    const s = this.#s;
    const v = this.#value(c);
    if (v === undefined) throw new Refused('invalid', `${c.parameter} has no value it can take`);
    const refs = c.refs;
    const add = (kind: ConstraintKind, ids: readonly number[]) => s.constrain(kind, ids, tag);
    const fixed = (value: number) => s.param(value, 'fixed');
    const arity = (...n: number[]) => {
      if (!n.includes(refs.length)) {
        throw new Refused('invalid', `${c.dimension} takes ${n.join(' or ')} references`);
      }
    };
    switch (c.dimension) {
      case 'horizontal':
      case 'vertical': {
        arity(1, 2);
        const [p, q] =
          refs.length === 1
            ? (() => {
                const l = this.#line(refs[0]!);
                return [l.p1, l.p2];
              })()
            : this.#distinctPoints(refs[0]!, refs[1]!);
        const axis = c.dimension === 'horizontal' ? 0 : 1;
        const pa = s.pointParams(p)[axis];
        const qa = s.pointParams(q)[axis];
        const sign = s.value(qa) - s.value(pa) < 0 ? -1 : 1;
        add(ConstraintKind.Difference, [pa, qa, fixed(sign * v)]);
        break;
      }
      case 'aligned': {
        arity(1, 2);
        if (refs.length === 1) {
          const l = this.#line(refs[0]!);
          add(ConstraintKind.P2PDistance, [l.p1, l.p2, fixed(v)]);
          break;
        }
        const [a, b] = refs as [GeomRef, GeomRef];
        if (isPointRef(a) && isPointRef(b)) {
          add(ConstraintKind.P2PDistance, [...this.#distinctPoints(a, b), fixed(v)]);
        } else if (isPointRef(a) !== isPointRef(b)) {
          const [p, l] = isPointRef(a) ? [a, b] : [b, a];
          add(ConstraintKind.P2LDistance, [this.#point(p), this.#line(l).id, fixed(v)]);
        } else {
          const la = this.#line(a);
          const lb = this.#line(b);
          if (la === lb) throw new Refused('invalid', 'aligned needs two different lines');
          // 2Line: the second line is made parallel to the first, unless a Parallel already
          // keeps them so (the two together would be redundant).
          if (!this.#parallel.has(pairKey(la.id, lb.id)))
            add(ConstraintKind.Parallel, [la.id, lb.id]);
          add(ConstraintKind.P2LDistance, [lb.p1, la.id, fixed(v)]);
        }
        break;
      }
      case 'angular': {
        arity(1, 2, 3);
        if (refs.length === 1) {
          const arc = this.#circular(refs[0]!);
          if (arc.type !== 'arc')
            throw new Refused('invalid', 'angular takes an arc, not a circle');
          add(ConstraintKind.Difference, [arc.startAngle, arc.endAngle, fixed(v)]);
        } else if (refs.length === 2) {
          const la = this.#line(refs[0]!);
          const lb = this.#line(refs[1]!);
          if (la === lb) throw new Refused('invalid', 'angular needs two different lines');
          const ends = (l: LinePrim) => ({ a: s.pointAt(l.p1), b: s.pointAt(l.p2) });
          const angle = lineAngle(ends(la), ends(lb));
          if (!angle) throw new Refused('invalid', 'the lines are parallel');
          // PlaneGCS's angle runs from line a's direction to line b's; a line that runs
          // into the corner points half a turn from the side the angle is measured on.
          const turn = (Number(angle.flipB) - Number(angle.flipA)) * Math.PI;
          add(ConstraintKind.L2LAngle, [la.id, lb.id, fixed(angle.sign * v + turn)]);
        } else {
          const [vtx, p, q] = refs.map((r) => this.#point(r)) as [number, number, number];
          if (vtx === p || vtx === q || p === q) {
            throw new Refused('invalid', 'the constraint needs three different points');
          }
          const theta = pointAngle(s.pointAt(vtx), s.pointAt(p), s.pointAt(q));
          if (theta === undefined) {
            throw new Refused('invalid', 'the points must be away from the vertex');
          }
          // Lines from the vertex, not P2PAngle: PlaneGCS adds that one without its tag.
          const sign = theta < 0 ? -1 : 1;
          add(ConstraintKind.L2LAngle, [s.line(vtx, p), s.line(vtx, q), fixed(sign * v)]);
        }
        break;
      }
      case 'radial':
      case 'diameter': {
        arity(1);
        const circ = this.#circular(refs[0]!);
        const kind =
          c.dimension === 'radial'
            ? circ.type === 'circle'
              ? ConstraintKind.CircleRadius
              : ConstraintKind.ArcRadius
            : circ.type === 'circle'
              ? ConstraintKind.CircleDiameter
              : ConstraintKind.ArcDiameter;
        add(kind, [circ.id, fixed(v)]);
        break;
      }
      default:
        throw new Refused('invalid', `unknown dimensional constraint ${String(c.dimension)}`);
    }
    this.#tags.set(tag, c.handle);
  }

  /**
   * Solves with the held values kept, then releases them. Fails when PlaneGCS does not zero
   * every constraint, when the solution collapses a line, circle or arc to nothing, or when
   * a constraint with no free value left (a Fix on a held point) does not hold: the check
   * solves again without the holds, and the held values must not move.
   */
  solveChecked(): boolean {
    let ok = this.#solveOnce();
    if (this.#held.size) {
      const held = [...this.#held];
      const values = held.map((p) => this.#s.value(p));
      this.releaseHolds();
      ok &&= this.#solveOnce();
      const tol = Math.max(this.#tol.linear, this.#tol.angular);
      ok &&= held.every((p, i) => Math.abs(this.#s.value(p) - values[i]!) <= tol);
    }
    return ok;
  }

  #solveOnce(): boolean {
    return (
      this.#s.solve() === SolveStatus.Success &&
      !this.#collapsed() &&
      this.#senses.every((sense) => sense() > 0)
    );
  }

  snapshot(): number[] {
    return this.#s.values();
  }

  restore(values: readonly number[]): void {
    values.forEach((v, i) => this.#s.setValue(i, v));
  }

  /** The entities mapped so far. */
  entities(): Handle[] {
    return [...this.#mapped.keys()];
  }

  /**
   * Holds the reference's geometry where it is until `releaseHolds()`; for Horizontal and
   * Vertical on a line, only its start.
   */
  hold(ref: GeomRef, kind?: GeometricKind): void {
    // Smooth holds the curve the spline joins whole, not only its end.
    if (kind === 'smooth' && isPointRef(ref)) return this.holdEntity(ref.entity);
    const lineStart = (kind === 'horizontal' || kind === 'vertical') && !isPointRef(ref);
    const { points, params } = lineStart
      ? { points: [this.#line(ref).p1], params: [] }
      : this.#parts(ref, 'hold');
    this.#hold(points, params);
  }

  /** Holds a whole mapped entity where it is. */
  holdEntity(handle: Handle): void {
    const m = this.#mapped.get(handle)?.m;
    if (!m) return;
    switch (m.kind) {
      case 'LINE':
        return this.#hold([m.line.p1, m.line.p2], []);
      case 'CIRCLE':
        return this.#hold([m.circle.center], [m.circle.radius]);
      case 'ARC':
        return this.#hold([m.arc.center], [m.arc.radius, m.arc.startAngle, m.arc.endAngle]);
      case 'POINT':
        return this.#hold([m.point], []);
      case 'SPLINE':
        return this.#hold(m.points, []);
      case 'ELLIPSE': {
        const { points, params } = ellipseParts(m.ellipse);
        return this.#hold(points, params);
      }
      case 'LWPOLYLINE': {
        const arcs = m.segments.filter((s): s is ArcPrim => s.type === 'arc');
        return this.#hold(
          [...m.vertices, ...arcs.map((a) => a.center)],
          arcs.map((a) => a.radius),
        );
      }
    }
  }

  /** Holds an ARC's radius and angles, so it can only move as a whole; an ellipse's size. */
  holdShape(handle: Handle): void {
    const m = this.#mapped.get(handle)?.m;
    if (m?.kind === 'ARC') this.#hold([], [m.arc.radius, m.arc.startAngle, m.arc.endAngle]);
    if (m?.kind === 'ELLIPSE') this.#keepEllipse(m.ellipse, 'turning');
  }

  /**
   * Keeps an ellipse's size (its focus's distance from its centre, its minor radius, an arc's
   * parameters), and unless `turning` its turn too (the focus's offset).
   */
  #keepEllipse(e: EllipsePrim, how?: 'turning'): void {
    if (how === 'turning') this.#keepLength(e.center, e.focus);
    else this.#keepOffsets(e.center, [e.focus]);
    this.#hold([], ellipseParts(e).params);
  }

  /**
   * Keeps what `how` says of a mapped entity that moves while a geometric constraint is
   * first solved, until `releaseHolds()` (M9-08, solveHolding): 'whole' moves a line or
   * polyline without turning it (each end or vertex keeps its offset from the first);
   * 'pivot' keeps a line's start and length, so it turns about its start; 'length' keeps
   * the length of a line or of a polyline's straight segments; 'slide' keeps a line's start
   * and direction. Each keeps a circle's radius, an arc's radius and angles, and a polyline
   * arc segment's radius.
   */
  keepMoving(handle: Handle, how: KeepMoving): void {
    const m = this.#mapped.get(handle)?.m;
    if (!m) return;
    switch (m.kind) {
      case 'LINE': {
        const l = m.line;
        if (how === 'whole') return this.#keepOffsets(l.p1, [l.p2]);
        if (how === 'pivot' || how === 'slide') this.#hold([l.p1], []);
        if (how === 'slide') return this.#keepDirection(l.p1, l.p2, l.id);
        return this.#keepLength(l.p1, l.p2);
      }
      case 'CIRCLE':
        return this.#hold([], [m.circle.radius]);
      case 'ARC':
        return this.holdShape(handle);
      case 'POINT':
        return;
      case 'ELLIPSE':
        return this.#keepEllipse(m.ellipse, how === 'whole' ? undefined : 'turning');
      case 'SPLINE': {
        // Moved whole, or else free: Smooth reshapes only the end it joins.
        const [p0, ...rest] = m.points;
        if (how === 'whole' && p0 !== undefined) this.#keepOffsets(p0, rest);
        return;
      }
      case 'LWPOLYLINE': {
        const [v0, ...rest] = m.vertices;
        if (how === 'whole' && v0 !== undefined) this.#keepOffsets(v0, rest);
        for (const seg of m.segments) {
          if (seg.type === 'arc') this.#hold([], [seg.radius]);
          else if (how === 'pivot' || how === 'length') this.#keepLength(seg.p1, seg.p2);
        }
        return;
      }
    }
  }

  /** Keeps each of `points` at its offset from `p`, so they move together without turning. */
  #keepOffsets(p: number, points: readonly number[]): void {
    const s = this.#s;
    const [px, py] = s.pointParams(p);
    for (const q of points) {
      const [qx, qy] = s.pointParams(q);
      s.constrain(
        ConstraintKind.Difference,
        [px, qx, s.param(s.value(qx) - s.value(px), 'fixed')],
        KEEP_TAG,
      );
      s.constrain(
        ConstraintKind.Difference,
        [py, qy, s.param(s.value(qy) - s.value(py), 'fixed')],
        KEEP_TAG,
      );
      this.#keeping = true;
    }
  }

  /** Keeps p→q parallel to where it runs now (a fixed line beside it, not P2PAngle: PlaneGCS adds that one without its tag). */
  #keepDirection(p: number, q: number, line?: number): void {
    const s = this.#s;
    const a = s.pointAt(p);
    const b = s.pointAt(q);
    if (a.x === b.x && a.y === b.y) return;
    const h1 = s.point(a.x, a.y);
    const h2 = s.point(b.x, b.y);
    s.fix(h1);
    s.fix(h2);
    s.constrain(ConstraintKind.Parallel, [line ?? s.line(p, q), s.line(h1, h2)], KEEP_TAG);
    this.#keeping = true;
  }

  /** Keeps the distance from p to q; not for points that meet (a zero distance has no direction to keep). */
  #keepLength(p: number, q: number): void {
    const s = this.#s;
    const d = dist(s.pointAt(p), s.pointAt(q));
    if (d <= this.#tol.linear) return;
    s.constrain(ConstraintKind.P2PDistance, [p, q, s.param(d, 'fixed')], KEEP_TAG);
    this.#keeping = true;
  }

  releaseHolds(): void {
    for (const p of this.#held) this.#s.setParamKind(p, 'unknown');
    this.#held.clear();
    if (this.#keeping) this.#s.remove(KEEP_TAG);
    this.#keeping = false;
  }

  /**
   * While a dimensional constraint's value is first solved, keeps what AutoCAD keeps of the
   * object that adjusts, until `releaseHolds()`: a distance moves the second point along
   * the line between the points (a line keeps its direction, a horizontal distance moves
   * only across, a line at a distance from a point moves parallel); an angle turns the
   * second line or point about the vertex, its length kept. Without these the solver's
   * least-change step reaches the value by any route (a point moved to distance 10 also
   * swings round).
   */
  keep(c: DimensionalConstraint, side: DimensionSide = 'second'): void {
    const s = this.#s;
    // Set from its first side (M9-03 part 11), the first object is the one to keep in shape.
    const first = side === 'first';
    const refs = c.refs;
    const direction = (p: number, q: number, line?: number) => this.#keepDirection(p, q, line);
    const length = (p: number, q: number) => {
      const a = s.pointAt(p);
      const b = s.pointAt(q);
      s.constrain(ConstraintKind.P2PDistance, [p, q, s.param(dist(a, b), 'fixed')], KEEP_TAG);
      this.#keeping = true;
    };
    switch (c.dimension) {
      case 'horizontal':
      case 'vertical': {
        const q =
          refs.length === 1
            ? this.#line(refs[0]!)[first ? 'p1' : 'p2']
            : this.#point(refs[first ? 0 : 1]!);
        // The second point (the first, set from its side) moves only along the dimension.
        this.#hold([], [s.pointParams(q)[c.dimension === 'horizontal' ? 1 : 0]]);
        return;
      }
      case 'aligned': {
        if (refs.length === 1) {
          const l = this.#line(refs[0]!);
          return direction(l.p1, l.p2, l.id);
        }
        const [a, b] = refs as [GeomRef, GeomRef];
        if (isPointRef(a) && isPointRef(b)) return direction(this.#point(a), this.#point(b));
        if (isPointRef(a) && !isPointRef(b)) {
          const l = this.#line(b);
          return direction(l.p1, l.p2, l.id);
        }
        if (!isPointRef(a) && !isPointRef(b)) {
          // 2Line: the second line turns parallel and moves; its length stays.
          const l = this.#line(first ? a : b);
          return length(l.p1, l.p2);
        }
        return;
      }
      case 'angular': {
        if (refs.length === 2) {
          const l = this.#line(refs[first ? 0 : 1]!);
          return length(l.p1, l.p2);
        }
        if (refs.length === 3) {
          return length(this.#point(refs[0]!), this.#point(refs[first ? 1 : 2]!));
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Sets an edit's values into the sketch (built from the drawing before it) and holds the
   * ones it changed. False when the sketch cannot take them: a polyline whose vertices or
   * straight and arc segments changed.
   */
  assignEdit({ before, after }: Replacement<Entity>): boolean {
    const m = this.#mapped.get(after.handle)?.m;
    if (!m) return true;
    const s = this.#s;
    const was = before.geom;
    const g = after.geom;
    const points: number[] = [];
    const params: number[] = [];
    const moved = (a: Vec2, b: Vec2) => !samePoint(a, b, this.#tol.linear);
    const setPoint = (p: number, v: Vec2) => {
      const [px, py] = s.pointParams(p);
      s.setValue(px, v.x);
      s.setValue(py, v.y);
    };
    const setPointIf = (p: number, v: Vec2, old: Vec2) => {
      if (!moved(v, old)) return;
      setPoint(p, v);
      points.push(p);
    };
    const setParamIf = (p: number, v: number, changed: boolean) => {
      if (!changed) return;
      s.setValue(p, v);
      params.push(p);
    };
    /** An arc's values: centre, radius and counter-clockwise angles, ends set to follow. */
    const setArc = (a: ArcPrim, center: Vec2, radius: number, a0: number, a1: number) => {
      setPointIf(a.center, center, s.pointAt(a.center));
      setParamIf(a.radius, radius, Math.abs(radius - s.value(a.radius)) > this.#tol.linear);
      const turned = (p: number, v: number) => !sameAngle(v, s.value(p), this.#tol.angular);
      setParamIf(a.startAngle, a0, turned(a.startAngle, a0));
      setParamIf(a.endAngle, a1, turned(a.endAngle, a1));
      const at = (t: number) => ({
        x: center.x + radius * Math.cos(t),
        y: center.y + radius * Math.sin(t),
      });
      setPoint(a.start, at(a0));
      setPoint(a.end, at(a1));
    };
    if (m.kind === 'LINE' && g.kind === 'LINE' && was.kind === 'LINE') {
      setPointIf(m.line.p1, g.start, was.start);
      setPointIf(m.line.p2, g.end, was.end);
    } else if (m.kind === 'POINT' && g.kind === 'POINT' && was.kind === 'POINT') {
      setPointIf(m.point, g.position, was.position);
    } else if (m.kind === 'CIRCLE' && g.kind === 'CIRCLE' && was.kind === 'CIRCLE') {
      setPointIf(m.circle.center, g.center, was.center);
      setParamIf(m.circle.radius, g.radius, Math.abs(g.radius - was.radius) > this.#tol.linear);
    } else if (m.kind === 'ARC' && g.kind === 'ARC') {
      const a0 = g.startAngle;
      setArc(m.arc, g.center, g.radius, a0, a0 + ccwSweep(a0, g.endAngle));
    } else if (m.kind === 'ELLIPSE' && g.kind === 'ELLIPSE' && was.kind === 'ELLIPSE') {
      const e = m.ellipse;
      // Mapped as a whole ellipse or as an arc of one: it must stay what it was.
      if ((ellipseSweep(g) === TAU) !== !e.arc) return false;
      const fb = ellipseFocus(was);
      const fa = ellipseFocus(g);
      if (!fa || !fb) return false;
      setPointIf(e.center, g.center, was.center);
      setPointIf(e.focus, fa, fb);
      const b = Math.hypot(g.majorAxis.x, g.majorAxis.y) * g.ratio;
      setParamIf(e.radmin, b, Math.abs(b - s.value(e.radmin)) > this.#tol.linear);
      if (e.arc) {
        const a0 = g.startParam;
        const a1 = a0 + ellipseSweep(g);
        const turned = (p: number, v: number) => !sameAngle(v, s.value(p), this.#tol.angular);
        setParamIf(e.arc.startAngle, a0, turned(e.arc.startAngle, a0));
        setParamIf(e.arc.endAngle, a1, turned(e.arc.endAngle, a1));
        setPoint(e.arc.start, ellipseAt(g, a0));
        setPoint(e.arc.end, ellipseAt(g, a1));
      }
      e.quadrants.forEach((q, i) => {
        if (q !== undefined) setPoint(q, ellipseAt(g, (i * Math.PI) / 2));
      });
    } else if (m.kind === 'SPLINE' && g.kind === 'SPLINE' && was.kind === 'SPLINE') {
      // Smooth's curvature factor was worked out from the knots and weights mapped.
      if (!sameSplineFrame(g, was)) return false;
      g.controlPoints.forEach((p, i) => setPointIf(m.points[i]!, p, was.controlPoints[i]!));
    } else if (m.kind === 'LWPOLYLINE' && g.kind === 'LWPOLYLINE' && was.kind === 'LWPOLYLINE') {
      const n = g.vertices.length;
      if (n !== was.vertices.length || g.closed !== was.closed) return false;
      // The segments were mapped from `was`: an arc must stay an arc and a line a line.
      const shapes = mapSegmentKinds(g, this.#tol.linear);
      if (shapes.some((k, i) => k !== m.segments[i]!.type)) return false;
      g.vertices.forEach((v, i) => setPointIf(m.vertices[i]!, v, was.vertices[i]!));
      m.segments.forEach((seg, i) => {
        if (seg.type !== 'arc') return;
        const a = bulgeArc(g.vertices[i]!, g.vertices[(i + 1) % n]!, g.vertices[i]!.bulge);
        const [a0, a1] =
          a.sweep > 0
            ? [a.startAngle, a.startAngle + a.sweep]
            : [a.startAngle + a.sweep, a.startAngle];
        setArc(seg, a.center, a.radius, a0, a1);
      });
    } else {
      return false;
    }
    this.#edit.points.push(...points);
    this.#edit.params.push(...params);
    this.#edit.handles.push(after.handle);
    return true;
  }

  /** Marks `handles` as edited in a sketch built from their edited geometry. */
  reshapedEdits(handles: readonly Handle[]): void {
    this.#edit.handles.push(...handles);
    this.#reshaped = true;
  }

  /**
   * Holds, until `releaseHolds()`, the values edits set (assignEdit), or with `whole` (or in
   * a sketch built from edited geometry) every edited entity whole.
   */
  holdEdited(whole: boolean): void {
    if (whole || this.#reshaped) this.#edit.handles.forEach((h) => this.holdEntity(h));
    else this.#hold(this.#edit.points, this.#edit.params);
  }

  /** Turns the lines of `handles` about their starts by `angle` (radians), lengths kept. */
  turnLines(handles: readonly Handle[], angle: number): void {
    const s = this.#s;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const setPoint = (p: number, v: Vec2) => {
      const [px, py] = s.pointParams(p);
      s.setValue(px, v.x);
      s.setValue(py, v.y);
    };
    for (const h of handles) {
      const m = this.#mapped.get(h)?.m;
      if (m?.kind !== 'LINE') continue;
      const a = s.pointAt(m.line.p1);
      const b = s.pointAt(m.line.p2);
      const d = { x: b.x - a.x, y: b.y - a.y };
      const end = { x: a.x + d.x * cos - d.y * sin, y: a.y + d.x * sin + d.y * cos };
      setPoint(m.line.p2, end);
      if (m.line.mid !== undefined)
        setPoint(m.line.mid, { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 });
    }
  }

  /**
   * Of `handles`, the lines, and polylines with a straight segment, whose direction differs
   * from the one they had in `from` (a snapshot).
   */
  turned(handles: readonly Handle[], from: readonly number[]): Handle[] {
    const s = this.#s;
    const at = (p: number, values?: readonly number[]): Vec2 => {
      if (!values) return s.pointAt(p);
      const [px, py] = s.pointParams(p);
      return { x: values[px]!, y: values[py]! };
    };
    const turns = (p: number, q: number) => {
      const a0 = at(p, from);
      const b0 = at(q, from);
      const a1 = at(p);
      const b1 = at(q);
      const u = { x: b0.x - a0.x, y: b0.y - a0.y };
      const v = { x: b1.x - a1.x, y: b1.y - a1.y };
      if (Math.hypot(u.x, u.y) <= this.#tol.linear || Math.hypot(v.x, v.y) <= this.#tol.linear) {
        return false;
      }
      const angle = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
      return Math.abs(angle) > this.#tol.angular;
    };
    return handles.filter((h) => {
      const m = this.#mapped.get(h)?.m;
      if (m?.kind === 'LINE') return turns(m.line.p1, m.line.p2);
      if (m?.kind !== 'LWPOLYLINE') return false;
      return m.segments.some((seg) => seg.type === 'line' && turns(seg.p1, seg.p2));
    });
  }

  /**
   * Replacements for every mapped entity the solve moved: an edited one against its edit's
   * `before` (its `after` kept when the solver left it alone), others against the drawing.
   */
  moved(
    edited: ReadonlyMap<Handle, Replacement<Entity>>,
    lookup: EntityLookup = this.#lookup,
  ): Replacement<Entity>[] {
    const own: Replacement<Entity>[] = [];
    const others: Replacement<Entity>[] = [];
    for (const [handle, edit] of edited) {
      const { m } = this.#mapped.get(handle) ?? {};
      const geom = m && this.#solvedGeometry(edit.after.geom, m);
      own.push(geom ? { before: edit.before, after: updateEntity(edit.after, { geom }) } : edit);
    }
    for (const [handle, { m }] of this.#mapped) {
      if (edited.has(handle)) continue;
      const before = lookup(handle)!;
      const geom = this.#solvedGeometry(before.geom, m);
      if (geom) others.push({ before, after: updateEntity(before, { geom }) });
    }
    return [...own, ...others];
  }

  // ── Mapping entities to primitives ──

  #map(handle: Handle): Mapped {
    const known = this.#mapped.get(handle);
    if (known) return known.m;
    const entity = this.#lookup(handle);
    if (!entity) throw new Refused('invalid', `there is no entity ${handle}`);
    const s = this.#s;
    const g = entity.geom;
    let m: Mapped;
    switch (g.kind) {
      case 'LINE': {
        m = {
          kind: 'LINE',
          line: this.#newLine(s.point(g.start.x, g.start.y), s.point(g.end.x, g.end.y)),
        };
        break;
      }
      case 'CIRCLE': {
        const ids = s.circle(s.point(g.center.x, g.center.y), g.radius);
        this.#radius(ids.radius);
        m = { kind: 'CIRCLE', circle: { type: 'circle', ...ids } };
        break;
      }
      case 'ARC': {
        const c = s.point(g.center.x, g.center.y);
        const ids = s.arc(
          c,
          g.radius,
          g.startAngle,
          g.startAngle + ccwSweep(g.startAngle, g.endAngle),
        );
        this.#radius(ids.radius);
        m = { kind: 'ARC', arc: { type: 'arc', ...ids } };
        break;
      }
      case 'POINT':
        m = { kind: 'POINT', point: s.point(g.position.x, g.position.y) };
        break;
      case 'LWPOLYLINE':
        m = this.#mapPolyline(g);
        break;
      case 'SPLINE':
        m = { kind: 'SPLINE', points: g.controlPoints.map((p) => s.point(p.x, p.y)), spline: g };
        break;
      case 'ELLIPSE':
        m = { kind: 'ELLIPSE', ellipse: this.#mapEllipse(g, handle) };
        break;
      default:
        throw new Refused('unsupported', `${g.kind} cannot be constrained yet`);
    }
    this.#mapped.set(handle, { entity, m });
    return m;
  }

  /**
   * An ellipse or elliptical arc. One whose foci are within tolerance of its centre is a
   * circle to PlaneGCS, which keeps an ellipse by its focus: refused, as AutoCAD's ELLIPSE
   * never draws one (its ratio stays below 1).
   */
  #mapEllipse(g: EllipseGeometry, handle: Handle): EllipsePrim {
    const s = this.#s;
    const a = Math.hypot(g.majorAxis.x, g.majorAxis.y);
    if (a * Math.sqrt(Math.max(0, 1 - g.ratio * g.ratio)) <= this.#tol.linear) {
      throw new Refused('unsupported', `ellipse ${handle} is a circle: its axes are equal`);
    }
    const c = s.point(g.center.x, g.center.y);
    const sweep = ellipseSweep(g);
    if (sweep === TAU) {
      const ids = s.ellipse(c, g.majorAxis, g.ratio);
      this.#radius(ids.radmin);
      return { type: 'ellipse', ...ids, quadrants: [] };
    }
    const { startAngle, endAngle, start, end, ...ids } = s.ellipticalArc(
      c,
      g.majorAxis,
      g.ratio,
      g.startParam,
      g.startParam + sweep,
    );
    this.#radius(ids.radmin);
    return { type: 'ellipse', ...ids, arc: { startAngle, endAngle, start, end }, quadrants: [] };
  }

  #newLine(p1: number, p2: number): LinePrim {
    const line: LinePrim = { type: 'line', id: this.#s.line(p1, p2), p1, p2 };
    const a = this.#s.pointAt(p1);
    const b = this.#s.pointAt(p2);
    this.#sizes.push({ line, initial: Math.hypot(b.x - a.x, b.y - a.y) });
    return line;
  }

  #mapPolyline(g: LwPolylineGeometry): Mapped {
    const s = this.#s;
    const vertices = g.vertices.map((v) => s.point(v.x, v.y));
    const segments: (LinePrim | ArcPrim)[] = [];
    for (let i = 0; i < polylineSegmentCount(g); i++) {
      const j = (i + 1) % g.vertices.length;
      const v = g.vertices[i]!;
      const w = g.vertices[j]!;
      if (segmentKind(v, w, this.#tol.linear) === 'line') {
        segments.push(this.#newLine(vertices[i]!, vertices[j]!));
        continue;
      }
      const a = bulgeArc(v, w, v.bulge);
      const c = s.point(a.center.x, a.center.y);
      // PlaneGCS arcs run counter-clockwise: a clockwise segment is the arc from w back to v.
      const ids =
        a.sweep > 0
          ? s.arc(c, a.radius, a.startAngle, a.startAngle + a.sweep, {
              start: vertices[i]!,
              end: vertices[j]!,
            })
          : s.arc(c, a.radius, a.startAngle + a.sweep, a.startAngle, {
              start: vertices[j]!,
              end: vertices[i]!,
            });
      this.#radius(ids.radius);
      segments.push({ type: 'arc', ...ids, cw: a.sweep < 0 });
    }
    return { kind: 'LWPOLYLINE', vertices, segments, closed: g.closed };
  }

  // ── Resolving references ──

  #point(ref: GeomRef): number {
    if (!isPointRef(ref)) throw new Refused('invalid', `${describeRef(ref)} is not a point`);
    const m = this.#map(ref.entity);
    const bad = () => new Refused('invalid', `there is no ${describeRef(ref)}`);
    switch (m.kind) {
      case 'LINE':
        if (ref.point === 'start') return m.line.p1;
        if (ref.point === 'end') return m.line.p2;
        if (ref.point === 'mid') return this.#midpoint(m.line);
        throw bad();
      case 'CIRCLE':
        if (ref.point === 'center') return m.circle.center;
        throw bad();
      case 'ARC':
        if (ref.point === 'center') return m.arc.center;
        if (ref.point === 'start') return m.arc.start;
        if (ref.point === 'end') return m.arc.end;
        if (ref.point === 'mid') return this.#arcMid(m.arc);
        throw bad();
      case 'SPLINE':
        if (ref.point !== 'start' && ref.point !== 'end') throw bad();
        return m.points[splineEndIndex(m.spline, ref.point, ref.entity)]!;
      case 'ELLIPSE': {
        const e = m.ellipse;
        if (ref.point === 'center') return e.center;
        if (ref.point === 'start' && e.arc) return e.arc.start;
        if (ref.point === 'end' && e.arc) return e.arc.end;
        const i = ref.index ?? -1;
        if (ref.point === 'quadrant' && i >= 0 && i < 4 && Number.isInteger(i)) {
          return this.#quadrant(e, i);
        }
        throw bad();
      }
      case 'POINT':
        if (ref.point === 'position') return m.point;
        throw bad();
      case 'LWPOLYLINE': {
        const v = m.vertices;
        if (ref.point === 'start' && v.length) return v[0]!;
        if (ref.point === 'end' && v.length) return m.closed ? v[0]! : v[v.length - 1]!;
        const i = ref.index ?? -1;
        if (ref.point === 'vertex' && v[i] !== undefined) return v[i];
        const seg = m.segments[i];
        if (ref.point === 'mid' && seg?.type === 'line') return this.#midpoint(seg);
        if (ref.point === 'mid' && seg?.type === 'arc') return this.#arcMid(seg);
        if (ref.point === 'center' && seg?.type === 'arc') return seg.center;
        throw bad();
      }
    }
  }

  #distinctPoints(a: GeomRef, b: GeomRef): [number, number] {
    const p = this.#point(a);
    const q = this.#point(b);
    if (p === q) throw new Refused('invalid', 'the constraint needs two different points');
    return [p, q];
  }

  #curveRef(ref: GeomRef): CurveRef {
    if (isPointRef(ref))
      throw new Refused('invalid', `${describeRef(ref)} is a point, not an object`);
    return ref;
  }

  #curve(ref: CurveRef): Curve {
    const m = this.#map(ref.entity);
    if (m.kind === 'LWPOLYLINE') {
      const seg = ref.segment === undefined ? undefined : m.segments[ref.segment];
      if (!seg) throw new Refused('invalid', `pick a segment of polyline ${ref.entity}`);
      return seg;
    }
    if (ref.segment !== undefined) throw new Refused('invalid', `${ref.entity} has no segments`);
    if (m.kind === 'LINE') return m.line;
    if (m.kind === 'CIRCLE') return m.circle;
    if (m.kind === 'ARC') return m.arc;
    if (m.kind === 'ELLIPSE') return m.ellipse;
    if (m.kind === 'SPLINE') {
      throw new Refused(
        'unsupported',
        `${ref.entity} is a spline: a constraint takes its ends, or Smooth or Fix the spline`,
      );
    }
    throw new Refused('invalid', `${ref.entity} is a point, not an object`);
  }

  #line(ref: GeomRef): LinePrim {
    const c = this.#curve(this.#curveRef(ref));
    if (c.type !== 'line') throw new Refused('invalid', `${describeRef(ref)} is not a line`);
    return c;
  }

  #circular(ref: GeomRef): CirclePrim | ArcPrim {
    const c = this.#curve(this.#curveRef(ref));
    if (!isRound(c)) throw new Refused('invalid', `${describeRef(ref)} is not a circle or arc`);
    return c;
  }

  /** A circle, arc or ellipse, for Concentric. */
  #centred(ref: GeomRef): CirclePrim | ArcPrim | EllipsePrim {
    const c = this.#curve(this.#curveRef(ref));
    if (c.type === 'line') {
      throw new Refused('invalid', `${describeRef(ref)} is not a circle, arc or ellipse`);
    }
    return c;
  }

  /** Records two points joined by a Coincident constraint (union-find). */
  #join(p: number, q: number): void {
    const a = this.#root(p);
    const b = this.#root(q);
    if (a !== b) this.#joined.set(a, b);
  }

  #root(p: number): number {
    let r = p;
    while (this.#joined.has(r)) r = this.#joined.get(r)!;
    return r;
  }

  /**
   * Tangent. Where the two curves meet at an end of the arc (a fillet, a polyline's line and
   * arc segments, ends joined by Coincident) the tangency is solved at that point: the
   * radius to it is perpendicular to the line, or runs through the other arc's centre.
   * PlaneGCS's own tangency (the centre at a radius from the line or circle) is
   * ill-conditioned there, where the touching point and the shared end are one: it settles
   * with the touching point up to 1e-5 off the end.
   */
  #tangent(a: Curve, b: Curve, tag: number): void {
    if (a.type === 'line' && b.type === 'line') {
      throw new Refused('invalid', 'tangent needs a circle or arc');
    }
    const s = this.#s;
    if (a.type === 'ellipse' || b.type === 'ellipse') {
      const [line, ellipse] = a.type === 'line' ? [a, b] : [b, a];
      if (line.type !== 'line' || ellipse.type !== 'ellipse') {
        throw new Refused('unsupported', 'tangent takes an ellipse with a line only');
      }
      s.constrain(ConstraintKind.TangentLineEllipse, [line.id, ellipse.id], tag);
      return;
    }
    const ends = (c: Curve) =>
      c.type === 'line' ? [c.p1, c.p2] : c.type === 'arc' ? [c.start, c.end] : [];
    const meet = (arc: ArcPrim, other: Curve) =>
      ends(arc).find((p) => ends(other).some((q) => this.#root(p) === this.#root(q)));
    if (a.type === 'arc' || b.type === 'arc') {
      const [arc, other] = (a.type === 'arc' ? [a, b] : [b, a]) as [ArcPrim, Curve];
      const at = meet(arc, other);
      if (at !== undefined) {
        const radius = s.line(arc.center, at);
        if (other.type === 'line') {
          s.constrain(ConstraintKind.Perpendicular, [other.id, radius], tag);
        } else {
          s.constrain(ConstraintKind.PointOnLine, [other.center, radius], tag);
        }
        return;
      }
    }
    const [kind, ids] = tangent(a, b);
    s.constrain(kind, ids, tag);
  }

  /**
   * An arc's midpoint: on the arc and as far from its start as from its end. Of the two such
   * points it starts at the arc's own, and the solver keeps it there.
   */
  #arcMid(arc: ArcPrim): number {
    if (arc.mid === undefined) {
      const s = this.#s;
      const c = s.pointAt(arc.center);
      const r = s.value(arc.radius);
      const t = (s.value(arc.startAngle) + s.value(arc.endAngle)) / 2;
      arc.mid = s.point(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
      s.constrain(ConstraintKind.PointOnArc, [arc.mid, arc.id], INTERNAL_TAG);
      const chord = s.line(arc.start, arc.end);
      s.constrain(ConstraintKind.PointOnPerpBisector, [arc.mid, chord], INTERNAL_TAG);
    }
    return arc.mid;
  }

  /**
   * An end of an ellipse's axis, `i` quadrants round from the major axis's positive end (the
   * parameter i·π/2), held there by PlaneGCS's internal alignment. An elliptical arc's
   * quadrant may lie off the arc, as AutoCAD's quadrant osnap never offers it then.
   */
  #quadrant(e: EllipsePrim, i: number): number {
    let q = e.quadrants[i];
    if (q === undefined) {
      const s = this.#s;
      const { x, y } = ellipseAt(this.#ellipseValues(e), (i * Math.PI) / 2);
      q = s.point(x, y);
      e.quadrants[i] = q;
      const kind = [
        ConstraintKind.EllipseMajorStart,
        ConstraintKind.EllipseMinorStart,
        ConstraintKind.EllipseMajorEnd,
        ConstraintKind.EllipseMinorEnd,
      ][i]!;
      s.constrain(kind, [e.id, q], INTERNAL_TAG);
    }
    return q;
  }

  /** An ellipse's solved centre, major axis and ratio (from its focus and minor radius). */
  #ellipseValues(e: EllipsePrim): { center: Vec2; majorAxis: Vec2; ratio: number } {
    const s = this.#s;
    const center = s.pointAt(e.center);
    const f = s.pointAt(e.focus);
    const dx = f.x - center.x;
    const dy = f.y - center.y;
    const c = Math.hypot(dx, dy);
    const b = Math.abs(s.value(e.radmin));
    const a = Math.hypot(b, c);
    // A focus on the centre leaves the axis's direction to the ellipse as it was drawn.
    const dir = c > 0 ? { x: dx / c, y: dy / c } : { x: 1, y: 0 };
    return { center, majorAxis: { x: dir.x * a, y: dir.y * a }, ratio: a > 0 ? b / a : 1 };
  }

  /**
   * Smooth (G2): the spline's end on the other curve's end, its tangent there running on
   * along the curve, and its curvature the curve's (none for a line, 1 / radius turning the
   * arc's way, the other spline's turning back). The end's first three control points carry
   * it: the tangent runs from the first to the second, and the curvature follows from the
   * third (sketch.cpp). The three are first placed where they satisfy it (#placeSmooth):
   * PlaneGCS's Gauss-Newton steps (FullPivLU, which moves the variables it pivots on, not
   * the least change) crawl on the curvature's 1 / length terms from far off and give up.
   */
  #smooth(a: GeomRef, b: GeomRef, tag: number): void {
    if (!isPointRef(a) || !isPointRef(b)) {
      throw new Refused('invalid', 'smooth takes the end of a spline and the end of a curve');
    }
    if (a.entity === b.entity) throw new Refused('invalid', 'smooth needs two different curves');
    const s = this.#s;
    const end = this.#splineEnd(a);
    const other = this.#endCurve(b);
    const [q0, q1, q2] = end.points;
    this.#placeSmooth(end, other);
    const runsOn = () => {
      const t = this.#tangentIn(other);
      const p = s.pointAt(q0);
      const r = s.pointAt(q1);
      return (r.x - p.x) * t.x + (r.y - p.y) * t.y;
    };
    const add = (kind: ConstraintKind, ids: readonly number[]) => s.constrain(kind, ids, tag);
    add(ConstraintKind.Coincident, [q0, other.at]);
    this.#join(q0, other.at);
    switch (other.type) {
      case 'line':
        add(ConstraintKind.PointOnLine, [q1, other.line.id]);
        add(ConstraintKind.PointOnLine, [q2, other.line.id]);
        break;
      case 'arc': {
        const radius = s.line(other.arc.center, other.at);
        add(ConstraintKind.Perpendicular, [radius, s.line(q0, q1)]);
        // Arriving at the arc's end it turned counter-clockwise; at its start, clockwise.
        const turn = other.at === other.arc.end ? 1 : -1;
        const factor = s.param(turn * end.factor, 'fixed');
        add(ConstraintKind.SplineEndCurvatureArc, [q0, q1, q2, other.arc.radius, factor]);
        break;
      }
      case 'spline': {
        const [r0, r1] = other.end.points;
        add(ConstraintKind.Parallel, [s.line(q0, q1), s.line(r0, r1)]);
        add(ConstraintKind.SplineEndCurvatureMatch, [
          ...end.points,
          ...other.end.points,
          s.param(end.factor, 'fixed'),
          s.param(other.end.factor, 'fixed'),
        ]);
        break;
      }
    }
    this.#senses.push(runsOn);
  }

  /**
   * Places a spline end's first three control points on the curve it joins, G2 already:
   * the first at the curve's end, the second along the curve's tangent at the distance it
   * had from the first, the third at the distance along the tangent it had and across it as
   * far as the curvature needs (k = factor * offset / distance^2). A spline that ran back
   * along the curve is turned round, so it runs on.
   */
  #placeSmooth(end: SplineEnd, other: EndCurve): void {
    const s = this.#s;
    const [q0, q1, q2] = end.points.map((q) => s.pointAt(q)) as [Vec2, Vec2, Vec2];
    const at = s.pointAt(other.at);
    const tIn = this.#tangentIn(other);
    const tLen = Math.hypot(tIn.x, tIn.y);
    const u1 = { x: q1.x - q0.x, y: q1.y - q0.y };
    const a = Math.hypot(u1.x, u1.y);
    if (tLen === 0 || a === 0) return;
    const t = { x: tIn.x / tLen, y: tIn.y / tLen };
    const n = { x: -t.y, y: t.x };
    const sense = u1.x * t.x + u1.y * t.y < 0 ? -1 : 1;
    const along = sense * ((q2.x - q0.x) * t.x + (q2.y - q0.y) * t.y);
    const across = (this.#curvatureIn(other) * a * a) / end.factor;
    this.#setPoint(end.points[0], at);
    this.#setPoint(end.points[1], { x: at.x + a * t.x, y: at.y + a * t.y });
    this.#setPoint(end.points[2], {
      x: at.x + along * t.x + across * n.x,
      y: at.y + along * t.y + across * n.y,
    });
  }

  /** A curve's signed curvature as it arrives at its end (positive turning counter-clockwise). */
  #curvatureIn(e: EndCurve): number {
    const s = this.#s;
    switch (e.type) {
      case 'line':
        return 0;
      case 'arc':
        return (e.at === e.arc.end ? 1 : -1) / s.value(e.arc.radius);
      case 'spline': {
        // Its own curvature leaving the end, turned round.
        const [r0, r1, r2] = e.end.points.map((r) => s.pointAt(r)) as [Vec2, Vec2, Vec2];
        const d1 = { x: r1.x - r0.x, y: r1.y - r0.y };
        const d2 = { x: r2.x - r1.x, y: r2.y - r1.y };
        const l = Math.hypot(d1.x, d1.y);
        return l === 0 ? 0 : (-e.end.factor * (d1.x * d2.y - d1.y * d2.x)) / l ** 3;
      }
    }
  }

  /** The direction a curve runs in as it arrives at its end `at`. */
  #tangentIn(e: EndCurve): Vec2 {
    const s = this.#s;
    const at = s.pointAt(e.at);
    switch (e.type) {
      case 'line': {
        const from = s.pointAt(e.from);
        return { x: at.x - from.x, y: at.y - from.y };
      }
      case 'arc': {
        const c = s.pointAt(e.arc.center);
        const turn = e.at === e.arc.end ? 1 : -1;
        return { x: -(at.y - c.y) * turn, y: (at.x - c.x) * turn };
      }
      case 'spline': {
        const next = s.pointAt(e.end.points[1]);
        return { x: at.x - next.x, y: at.y - next.y };
      }
    }
  }

  /** A spline's start or end for Smooth: degree 2 or more, open, clamped there. */
  #splineEnd(ref: PointRef): SplineEnd {
    const m = this.#map(ref.entity);
    if (m.kind !== 'SPLINE') throw new Refused('invalid', `${ref.entity} is not a spline`);
    if (ref.point !== 'start' && ref.point !== 'end') {
      throw new Refused('invalid', `there is no ${describeRef(ref)}`);
    }
    const g = m.spline;
    const i = splineEndIndex(g, ref.point, ref.entity);
    const p = g.degree;
    if (p < 2 || m.points.length < 3) {
      throw new Refused('invalid', `smooth needs a spline of degree 2 or more (${ref.entity})`);
    }
    const k = g.knots;
    const last = k.length - 1;
    // The two knot spans from the end, and the weights of its first three control points.
    const [d1, d2] =
      i === 0
        ? [k[p + 1]! - k[p]!, k[p + 2]! - k[p]!]
        : [k[last]! - k[last - p - 1]!, k[last]! - k[last - p - 2]!];
    const order = i === 0 ? [0, 1, 2] : [i, i - 1, i - 2];
    const [w0, w1, w2] = order.map((j) => g.weights?.[j] ?? 1) as [number, number, number];
    if (!(d1 > 0 && d2 > 0 && w0 > 0 && w1 > 0 && w2 > 0)) {
      throw new Refused(
        'invalid',
        `the knots or weights at the ${ref.point} of ${ref.entity} cannot be smoothed`,
      );
    }
    return {
      points: order.map((j) => m.points[j]!) as [number, number, number],
      factor: (((p - 1) / p) * d1 * w0 * w2) / (d2 * w1 * w1),
    };
  }

  /** The end of the curve Smooth joins a spline to: a line's, an arc's, an open polyline's, a spline's. */
  #endCurve(ref: PointRef): EndCurve {
    const m = this.#map(ref.entity);
    const bad = () =>
      new Refused('invalid', 'smooth joins a spline to the end of a spline, line, arc or polyline');
    if (ref.point !== 'start' && ref.point !== 'end') throw bad();
    const first = ref.point === 'start';
    const onSegment = (seg: LinePrim | ArcPrim, at: number): EndCurve =>
      seg.type === 'line'
        ? { type: 'line', line: seg, at, from: seg.p1 === at ? seg.p2 : seg.p1 }
        : { type: 'arc', arc: seg, at };
    switch (m.kind) {
      case 'LINE':
        return onSegment(m.line, first ? m.line.p1 : m.line.p2);
      case 'ARC':
        return onSegment(m.arc, first ? m.arc.start : m.arc.end);
      case 'LWPOLYLINE': {
        if (m.closed || !m.segments.length) throw bad();
        const seg = first ? m.segments[0]! : m.segments[m.segments.length - 1]!;
        return onSegment(seg, first ? m.vertices[0]! : m.vertices[m.vertices.length - 1]!);
      }
      case 'SPLINE': {
        const end = this.#splineEnd(ref);
        return { type: 'spline', end, at: end.points[0] };
      }
      default:
        throw bad();
    }
  }

  #setPoint(p: number, v: Vec2): void {
    const [px, py] = this.#s.pointParams(p);
    this.#s.setValue(px, v.x);
    this.#s.setValue(py, v.y);
  }

  #midpoint(line: LinePrim): number {
    if (line.mid === undefined) {
      const a = this.#s.pointAt(line.p1);
      const b = this.#s.pointAt(line.p2);
      line.mid = this.#s.point((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.#s.constrain(ConstraintKind.SymmetricPoint, [line.p1, line.p2, line.mid], INTERNAL_TAG);
    }
    return line.mid;
  }

  /**
   * The points and parameters that pin a reference down: a point; a line's ends; a
   * circle's centre and radius; an arc's centre, radius and angles; a polyline segment's
   * vertices (and an arc segment's start angle, or for a hold its centre and radius); a
   * whole polyline (Fix only) its vertices and arc segments.
   */
  #parts(ref: GeomRef, use: 'fix' | 'hold'): { points: number[]; params: number[] } {
    if (isPointRef(ref)) return { points: [this.#point(ref)], params: [] };
    const m = this.#map(ref.entity);
    if (m.kind === 'SPLINE' && ref.segment === undefined)
      return { points: [...m.points], params: [] };
    if (m.kind === 'LWPOLYLINE' && ref.segment === undefined && use === 'fix') {
      const params = m.segments.flatMap((s) => (s.type === 'arc' ? [s.startAngle] : []));
      return { points: [...m.vertices], params };
    }
    const c = this.#curve(ref);
    if (c.type === 'line') return { points: [c.p1, c.p2], params: [] };
    if (c.type === 'circle') return { points: [c.center], params: [c.radius] };
    if (c.type === 'ellipse') return ellipseParts(c);
    if (m.kind === 'ARC') {
      return { points: [c.center], params: [c.radius, c.startAngle, c.endAngle] };
    }
    return use === 'fix'
      ? { points: [c.start, c.end], params: [c.startAngle] }
      : { points: [c.start, c.end, c.center], params: [c.radius] };
  }

  /**
   * Holds points and parameters at their current values by making them fixed, not by
   * constraints: pinning equations would duplicate a Fix or a hold of the same value, and
   * PlaneGCS sets redundant equations aside and checks them only loosely (an error under
   * 1e-5), leaving arcs a little off their ends.
   */
  #hold(points: readonly number[], params: readonly number[]): void {
    for (const p of [...points.flatMap((q) => this.#s.pointParams(q)), ...params]) {
      this.#held.add(p);
      this.#s.setParamKind(p, 'fixed');
    }
  }

  /** A line shrunk to a point, or a circle or arc to its centre, by the last solve. */
  #collapsed(): boolean {
    const s = this.#s;
    return this.#sizes.some(({ line, radius, initial }) => {
      let size: number;
      if (line) {
        const a = s.pointAt(line.p1);
        const b = s.pointAt(line.p2);
        size = Math.hypot(b.x - a.x, b.y - a.y);
      } else {
        size = Math.abs(s.value(radius!));
      }
      return initial > this.#tol.linear && size <= COLLAPSE * initial;
    });
  }

  #radius(radius: number): void {
    this.#sizes.push({ radius, initial: Math.abs(this.#s.value(radius)) });
  }

  /** Pins points (by their coordinates) and parameters to their current values under `tag`. */
  #pin(points: readonly number[], params: readonly number[], tag: number): void {
    const s = this.#s;
    for (const p of points) {
      const { x, y } = s.pointAt(p);
      s.constrain(ConstraintKind.CoordinateX, [p, s.param(x, 'fixed')], tag);
      s.constrain(ConstraintKind.CoordinateY, [p, s.param(y, 'fixed')], tag);
    }
    for (const p of params)
      s.constrain(ConstraintKind.Equal, [p, s.param(s.value(p), 'fixed')], tag);
  }

  /**
   * Symmetric lines (AutoCAD: the angle is made symmetric, not the endpoints): the angle
   * from the axis to `a` equals the angle from `b` to the axis, or differs by π when `b`
   * runs the other way round from `a`'s mirror image (whichever is nearer now).
   */
  #symmetricAngles(a: LinePrim, b: LinePrim, axis: LinePrim, tag: number): void {
    const s = this.#s;
    const dir = (l: LinePrim) => {
      const p = s.pointAt(l.p1);
      const q = s.pointAt(l.p2);
      return Math.atan2(q.y - p.y, q.x - p.x);
    };
    const toA = dir(a) - dir(axis);
    const fromB = dir(axis) - dir(b);
    const offset = Math.cos(fromB - toA) >= 0 ? 0 : Math.PI;
    const a1 = s.param(toA);
    const a2 = s.param(toA + offset);
    s.constrain(ConstraintKind.L2LAngle, [axis.id, a.id, a1], tag);
    s.constrain(ConstraintKind.L2LAngle, [b.id, axis.id, a2], tag);
    s.constrain(ConstraintKind.Difference, [a1, a2, s.param(offset, 'fixed')], tag);
  }

  // ── Reading the solution back ──

  /** The entity's geometry from the solved values, or undefined if it did not move. */
  #solvedGeometry(g: EntityGeometry, m: Mapped): EntityGeometry | undefined {
    const s = this.#s;
    const lin = this.#tol.linear;
    const at = (p: number) => s.pointAt(p);
    if (m.kind === 'LINE' && g.kind === 'LINE') {
      const start = at(m.line.p1);
      const end = at(m.line.p2);
      if (samePoint(start, g.start, lin) && samePoint(end, g.end, lin)) return undefined;
      return { ...g, start, end };
    }
    if (m.kind === 'POINT' && g.kind === 'POINT') {
      const position = at(m.point);
      return samePoint(position, g.position, lin) ? undefined : { ...g, position };
    }
    if (m.kind === 'CIRCLE' && g.kind === 'CIRCLE') {
      const center = at(m.circle.center);
      const radius = Math.abs(s.value(m.circle.radius));
      if (samePoint(center, g.center, lin) && Math.abs(radius - g.radius) <= lin) return undefined;
      return { ...g, center, radius };
    }
    if (m.kind === 'ARC' && g.kind === 'ARC') {
      const arc = this.#arcValues(m.arc);
      const same =
        samePoint(arc.center, g.center, lin) &&
        Math.abs(arc.radius - g.radius) <= lin &&
        sameAngle(arc.startAngle, g.startAngle, this.#tol.angular) &&
        sameAngle(arc.endAngle, g.endAngle, this.#tol.angular);
      return same ? undefined : { ...g, ...arc };
    }
    if (m.kind === 'SPLINE' && g.kind === 'SPLINE') return solvedSpline(g, m.points.map(at), lin);
    if (m.kind === 'ELLIPSE' && g.kind === 'ELLIPSE') {
      const e = this.#ellipseValues(m.ellipse);
      const arc = m.ellipse.arc;
      const startParam = arc ? normalizeAngle(s.value(arc.startAngle)) : g.startParam;
      const endParam = arc ? normalizeAngle(s.value(arc.endAngle)) : g.endParam;
      const ang = this.#tol.angular;
      const same =
        samePoint(e.center, g.center, lin) &&
        samePoint(e.majorAxis, g.majorAxis, lin) &&
        Math.abs(e.ratio - g.ratio) <= ang &&
        sameAngle(startParam, g.startParam, ang) &&
        sameAngle(endParam, g.endParam, ang);
      return same ? undefined : { ...g, ...e, startParam, endParam };
    }
    if (m.kind === 'LWPOLYLINE' && g.kind === 'LWPOLYLINE') {
      let changed = false;
      const vertices = g.vertices.map((v, i) => {
        const p = at(m.vertices[i]!);
        const seg = m.segments[i];
        let bulge = v.bulge;
        if (seg?.type === 'arc') {
          const { startAngle, endAngle } = this.#arcValues(seg);
          const b = Math.tan(ccwSweep(startAngle, endAngle) / 4);
          const solvedBulge = seg.cw ? -b : b;
          if (Math.abs(solvedBulge - v.bulge) > this.#tol.angular) bulge = solvedBulge;
        }
        if (samePoint(p, v, lin) && bulge === v.bulge) return v;
        changed = true;
        return { ...v, x: p.x, y: p.y, bulge };
      });
      return changed ? { ...g, vertices } : undefined;
    }
    return undefined;
  }

  /** An arc's solved centre, radius and angles, with a negative radius turned round. */
  #arcValues(a: ArcIds): { center: Vec2; radius: number; startAngle: number; endAngle: number } {
    const s = this.#s;
    let radius = s.value(a.radius);
    let start = s.value(a.startAngle);
    let end = s.value(a.endAngle);
    if (radius < 0) {
      radius = -radius;
      start += Math.PI;
      end += Math.PI;
    }
    return {
      center: s.pointAt(a.center),
      radius,
      startAngle: normalizeAngle(start),
      endAngle: normalizeAngle(end),
    };
  }
}

/**
 * A solution that leaves a line, or a circle's or arc's radius, at this fraction of its size
 * has collapsed it: PlaneGCS satisfies Perpendicular between two horizontal lines by
 * shrinking one to a point, where AutoCAD reports the geometry over-constrained.
 */
const COLLAPSE = 1e-6;

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * The index of the control point at a spline's start or end: the curve's own end only when
 * the spline is open and clamped there (its first or last degree + 1 knots equal).
 */
function splineEndIndex(g: SplineGeometry, end: 'start' | 'end', handle: Handle): number {
  if (g.closed || g.periodic) throw new Refused('invalid', `closed spline ${handle} has no ends`);
  const n = g.controlPoints.length;
  const k = g.knots;
  const p = g.degree;
  if (n < 2 || p < 1 || k.length !== n + p + 1) {
    throw new Refused('invalid', `spline ${handle} has no ends a constraint can take`);
  }
  const eps = 1e-9 * Math.max(1, Math.abs(k[k.length - 1]! - k[0]!));
  const ends = end === 'start' ? k.slice(0, p + 1) : k.slice(k.length - p - 1);
  if (ends.some((u) => Math.abs(u - ends[0]!) > eps)) {
    throw new Refused(
      'unsupported',
      `the ${end} of spline ${handle} is not one of its control points`,
    );
  }
  return end === 'start' ? 0 : n - 1;
}

/** Whether two splines share degree, knots, weights and closure, so only control points differ. */
function sameSplineFrame(a: SplineGeometry, b: SplineGeometry): boolean {
  const same = (x?: readonly number[], y?: readonly number[]) =>
    (x?.length ?? 0) === (y?.length ?? 0) && (x ?? []).every((v, i) => v === y![i]);
  return (
    a.degree === b.degree &&
    a.closed === b.closed &&
    a.periodic === b.periodic &&
    a.controlPoints.length === b.controlPoints.length &&
    same(a.knots, b.knots) &&
    same(a.weights, b.weights)
  );
}

/**
 * A spline with its solved control points, or undefined when none moved. One moved whole
 * keeps its fit points, moved with it; one reshaped loses them (and their tangents and
 * tolerance), as SPLINEDIT's control-vertex edits make it (purgeFitData): they no longer lie
 * on it.
 */
function solvedSpline(
  g: SplineGeometry,
  controlPoints: readonly Vec2[],
  tol: number,
): SplineGeometry | undefined {
  const was = g.controlPoints;
  if (controlPoints.every((p, i) => samePoint(p, was[i]!, tol))) return undefined;
  const d = { x: controlPoints[0]!.x - was[0]!.x, y: controlPoints[0]!.y - was[0]!.y };
  const whole = controlPoints.every((p, i) =>
    samePoint({ x: p.x - d.x, y: p.y - d.y }, was[i]!, tol),
  );
  if (whole) {
    const fitPoints = g.fitPoints?.map((f) => ({ x: f.x + d.x, y: f.y + d.y }));
    return { ...g, controlPoints, ...(fitPoints && { fitPoints }) };
  }
  return { ...purgeFitData(g), controlPoints };
}

/** Whether a polyline segment from `v` to `w` maps to a line or an arc. */
function segmentKind(v: BulgeVertex, w: Vec2, tol: number): 'line' | 'arc' {
  return v.bulge === 0 || samePoint(v, w, tol) ? 'line' : 'arc';
}

function mapSegmentKinds(g: LwPolylineGeometry, tol: number): ('line' | 'arc')[] {
  return Array.from({ length: polylineSegmentCount(g) }, (_, i) =>
    segmentKind(g.vertices[i]!, g.vertices[(i + 1) % g.vertices.length]!, tol),
  );
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samePoint(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function sameAngle(a: number, b: number, tol: number): boolean {
  const d = normalizeAngle(a - b);
  return d <= tol || 2 * Math.PI - d <= tol;
}

/** PlaneGCS's tangency between a line, circle or arc and a circle or arc. */
function tangent(
  a: LinePrim | CirclePrim | ArcPrim,
  b: LinePrim | CirclePrim | ArcPrim,
): [ConstraintKind, number[]] {
  if (b.type === 'line') return tangent(b, a);
  if (a.type === 'line') {
    return [
      b.type === 'circle' ? ConstraintKind.TangentLC : ConstraintKind.TangentLA,
      [a.id, b.id],
    ];
  }
  if (a.type === 'circle' && b.type === 'circle') return [ConstraintKind.TangentCC, [a.id, b.id]];
  if (a.type === 'arc' && b.type === 'arc') return [ConstraintKind.TangentAA, [a.id, b.id]];
  return a.type === 'circle'
    ? [ConstraintKind.TangentCA, [a.id, b.id]]
    : [ConstraintKind.TangentCA, [b.id, a.id]];
}

const isRound = (c: Curve): c is CirclePrim | ArcPrim => c.type === 'circle' || c.type === 'arc';

/** What pins an ellipse down: its centre and focus, its minor radius, an arc's parameters. */
function ellipseParts(e: EllipsePrim): { points: number[]; params: number[] } {
  const arc = e.arc ? [e.arc.startAngle, e.arc.endAngle] : [];
  return { points: [e.center, e.focus], params: [e.radmin, ...arc] };
}

/** The point at parameter `t` of an ellipse (DXF's: the minor axis 90° counter-clockwise). */
function ellipseAt(e: { center: Vec2; majorAxis: Vec2; ratio: number }, t: number): Vec2 {
  const { center: c, majorAxis: a, ratio: r } = e;
  const cos = Math.cos(t);
  const sin = Math.sin(t) * r;
  return { x: c.x + a.x * cos - a.y * sin, y: c.y + a.y * cos + a.x * sin };
}

/** An ellipse's first focus (on its major axis's positive side), or undefined for a circle. */
function ellipseFocus(e: { center: Vec2; majorAxis: Vec2; ratio: number }): Vec2 | undefined {
  const f = Math.sqrt(1 - e.ratio * e.ratio);
  if (!(f > 0)) return undefined;
  return { x: e.center.x + e.majorAxis.x * f, y: e.center.y + e.majorAxis.y * f };
}

function equalRadius(a: CirclePrim | ArcPrim, b: CirclePrim | ArcPrim): [ConstraintKind, number[]] {
  if (a.type === 'circle' && b.type === 'circle')
    return [ConstraintKind.EqualRadiusCC, [a.id, b.id]];
  if (a.type === 'arc' && b.type === 'arc') return [ConstraintKind.EqualRadiusAA, [a.id, b.id]];
  return a.type === 'circle'
    ? [ConstraintKind.EqualRadiusCA, [a.id, b.id]]
    : [ConstraintKind.EqualRadiusCA, [b.id, a.id]];
}
