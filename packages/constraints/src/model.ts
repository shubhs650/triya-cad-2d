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
//    symmetry line) is held where it is, unless other constraints need it to move.
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
// Smooth (G2 continuity with a spline) needs splines in the solver module and is refused as
// unsupported until then (M9-02 part 2), as are ellipses and splines in any constraint.

import {
  bulgeArc,
  ccwSweep,
  normalizeAngle,
  polylineSegmentCount,
  updateEntity,
  type BulgeVertex,
  type Entity,
  type EntityGeometry,
  type Handle,
  type LwPolylineGeometry,
  type Replacement,
  type Tolerance,
  type Vec2,
} from '@triya/engine';
import {
  ARC_RULES_TAG,
  ConstraintKind,
  SolveStatus,
  type ArcIds,
  type CircleIds,
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
 * start or end; a POINT's position; an LWPOLYLINE's vertex `index`, start or end, or the mid
 * of straight segment `index` or the center of arc segment `index`.
 */
export type PointName = 'start' | 'end' | 'mid' | 'center' | 'position' | 'vertex';

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
 * Symmetric two objects (or points) and then the symmetry line; Fix one point or object; the
 * others two objects.
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
    }
  | Refusal;

export type EditResult =
  | {
      readonly ok: true;
      /** The edit's own replacements (adjusted where the solver had to), then the rest it moved. */
      readonly updated: readonly Replacement<Entity>[];
    }
  | Refusal;

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
  #constraints: GeometricConstraint[] = [];

  /** `tolerance`: the document's (toleranceFromExtents), for what counts as moved. */
  constructor(gcs: PlaneGcs, tolerance: Tolerance) {
    this.#gcs = gcs;
    this.#tol = tolerance;
  }

  get constraints(): readonly GeometricConstraint[] {
    return this.#constraints;
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

  remove(handle: Handle): boolean {
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
    if (constraint.kind === 'smooth') {
      return refusal('unsupported', 'Smooth needs a spline, which constraints do not support yet');
    }
    const group = this.#group(constraint.refs.map((r) => r.entity));
    const build = new Build(this.#gcs.sketch(), lookup, this.#tol);
    try {
      for (const c of group) build.tryConstrain(c);
      const before = group.length ? build.diagnose() : undefined;
      try {
        build.constrain(constraint);
      } catch (e) {
        if (e instanceof Refused) return refusal(e.reason, e.message, [constraint.handle]);
        throw e;
      }
      if (!solveAdding(build, constraint)) {
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
      this.#constraints.push(constraint);
      return { ok: true, updated: build.moved(new Map()), dofs: diagnosis.dofs };
    } finally {
      build.dispose();
    }
  }

  /**
   * Re-solves the constraints an edit touches. `edits` are the edit's replacements; the
   * values each one changed are held and the geometry constrained to them follows. Refused
   * when the edit breaks a constraint the rest cannot absorb (a Fix, say).
   */
  solveEdit(edits: readonly Replacement<Entity>[], lookup: EntityLookup): EditResult {
    const group = this.#group(edits.map((e) => e.after.handle));
    if (!group.length) return { ok: true, updated: edits };
    const edited = new Map(edits.map((e) => [e.after.handle, e]));
    const build = this.#editBuild(group, edits, lookup);
    try {
      if (!build.solveChecked()) {
        const named = build.diagnose().conflicting;
        return refusal(
          'overconstrained',
          'The change breaks a constraint the other geometry cannot follow',
          named.length ? named : this.#culprits(group, lookup, () => edits),
        );
      }
      return { ok: true, updated: build.moved(edited, lookup) };
    } finally {
      build.dispose();
    }
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
    for (const c of this.#constraints) {
      if (done.has(c.handle)) continue;
      const group = this.#group(c.refs.map((r) => r.entity));
      for (const g of group) done.add(g.handle);
      const build = new Build(this.#gcs.sketch(), lookup, this.#tol);
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
    group: readonly GeometricConstraint[],
    edits: readonly Replacement<Entity>[],
    lookup: EntityLookup,
  ): Build {
    const build = new Build(this.#gcs.sketch(), lookup, this.#tol);
    for (const c of group) build.tryConstrain(c);
    if (edits.every((e) => build.assignEdit(e))) return build;
    build.dispose();
    const edited = new Map(edits.map((e) => [e.after.handle, e.after]));
    const reshaped = new Build(this.#gcs.sketch(), (h) => edited.get(h) ?? lookup(h), this.#tol);
    for (const c of group) reshaped.tryConstrain(c);
    for (const e of edits) reshaped.holdEntity(e.after.handle);
    return reshaped;
  }

  /**
   * The constraints of a set that cannot be solved without which it can: PlaneGCS names
   * conflicts it sees in the Jacobian, but not a solution that collapses a line or circle
   * to nothing (two horizontal lines made perpendicular), which `solveChecked` refuses.
   */
  #culprits(
    constraints: readonly GeometricConstraint[],
    lookup: EntityLookup,
    edits: () => readonly Replacement<Entity>[] | undefined,
  ): Handle[] {
    const out: Handle[] = [];
    for (const left of constraints) {
      const rest = constraints.filter((c) => c !== left);
      const e = edits();
      const build = e
        ? this.#editBuild(rest, e, lookup)
        : new Build(this.#gcs.sketch(), lookup, this.#tol);
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
  #group(entities: readonly Handle[]): GeometricConstraint[] {
    const reached = new Set(entities);
    const taken = new Set<GeometricConstraint>();
    for (let grew = true; grew;) {
      grew = false;
      for (const c of this.#constraints) {
        if (taken.has(c) || !c.refs.some((r) => reached.has(r.entity))) continue;
        taken.add(c);
        for (const r of c.refs) reached.add(r.entity);
        grew = true;
      }
    }
    // The model's order, so tags (and with them diagnosis) do not depend on the seed, but
    // Coincident first: a Tangent between curves whose ends are joined is solved at that
    // point (Build.#tangent), which it can only see once the join is in.
    const group = this.#constraints.filter((c) => taken.has(c));
    return [
      ...group.filter((c) => c.kind === 'coincident'),
      ...group.filter((c) => c.kind !== 'coincident'),
    ];
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
    default:
      return [a];
  }
}

/**
 * Solves a group with a new constraint, AutoCAD's way: the second object adjusts to the
 * first. Tries, in turn, holding everything but the second object (an arc moving whole),
 * then letting the arc change shape, then holding only the first object, then holding
 * nothing; the first that solves wins. False when none does.
 */
function solveAdding(build: Build, c: GeometricConstraint): boolean {
  const held = holdFor(c);
  if (!held.length) return build.solveChecked();
  const moving = new Set(c.refs.filter((r) => !held.includes(r)).map((r) => r.entity));
  const others = build.entities().filter((h) => !moving.has(h));
  const first = () => held.forEach((ref) => build.hold(ref, c.kind));
  const tiers = [
    () => {
      first();
      others.forEach((h) => build.holdEntity(h));
      moving.forEach((h) => build.holdShape(h));
    },
    () => {
      first();
      others.forEach((h) => build.holdEntity(h));
    },
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
}
type Curve = LinePrim | CirclePrim | ArcPrim;

type Mapped =
  | { readonly kind: 'LINE'; readonly line: LinePrim }
  | { readonly kind: 'CIRCLE'; readonly circle: CirclePrim }
  | { readonly kind: 'ARC'; readonly arc: ArcPrim }
  | { readonly kind: 'POINT'; readonly point: number }
  | {
      readonly kind: 'LWPOLYLINE';
      readonly vertices: readonly number[];
      readonly segments: readonly (LinePrim | ArcPrim)[];
      readonly closed: boolean;
    };

/** The tag of the structure Triya adds (a line's midpoint). */
const INTERNAL_TAG = ARC_RULES_TAG - 1;

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
  /** Parameters held (fixed) until `releaseHolds()`. */
  readonly #held = new Set<number>();
  /** Lines' ends and circles' and arcs' radii, with their size when mapped. */
  readonly #sizes: { line?: LinePrim; radius?: number; initial: number }[] = [];

  constructor(sketch: PlaneGcsSketch, lookup: EntityLookup, tol: Tolerance) {
    this.#s = sketch;
    this.#lookup = lookup;
    this.#tol = tol;
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
  tryConstrain(c: GeometricConstraint): boolean {
    try {
      this.constrain(c);
      return true;
    } catch (e) {
      if (e instanceof Refused) return false;
      throw e;
    }
  }

  constrain(c: GeometricConstraint): void {
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
          }[cv.type];
          add(kind, [point, cv.id]);
        } else {
          throw new Refused('invalid', 'coincident takes two points, or a point and a curve');
        }
        break;
      }
      case 'concentric': {
        arity(2);
        const a = this.#circular(refs[0]!);
        const b = this.#circular(refs[1]!);
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
        else if (a.type !== 'line' && b.type !== 'line') add(...equalRadius(a, b));
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
        } else if (ca.type !== 'line' && cb.type !== 'line') {
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
        throw new Refused(
          'unsupported',
          'Smooth needs a spline, which constraints do not support yet',
        );
      default:
        throw new Refused('invalid', `unknown constraint kind ${String(c.kind)}`);
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
    return this.#s.solve() === SolveStatus.Success && !this.#collapsed();
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
  hold(ref: GeomRef, kind: GeometricKind): void {
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
      case 'LWPOLYLINE': {
        const arcs = m.segments.filter((s): s is ArcPrim => s.type === 'arc');
        return this.#hold(
          [...m.vertices, ...arcs.map((a) => a.center)],
          arcs.map((a) => a.radius),
        );
      }
    }
  }

  /** Holds an ARC's radius and angles, so it can only move as a whole. */
  holdShape(handle: Handle): void {
    const m = this.#mapped.get(handle)?.m;
    if (m?.kind === 'ARC') this.#hold([], [m.arc.radius, m.arc.startAngle, m.arc.endAngle]);
  }

  releaseHolds(): void {
    for (const p of this.#held) this.#s.setParamKind(p, 'unknown');
    this.#held.clear();
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
    this.#hold(points, params);
    return true;
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
      default:
        throw new Refused('unsupported', `${g.kind} cannot be constrained yet`);
    }
    this.#mapped.set(handle, { entity, m });
    return m;
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
        throw bad();
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
    throw new Refused('invalid', `${ref.entity} is a point, not an object`);
  }

  #line(ref: GeomRef): LinePrim {
    const c = this.#curve(this.#curveRef(ref));
    if (c.type !== 'line') throw new Refused('invalid', `${describeRef(ref)} is not a line`);
    return c;
  }

  #circular(ref: GeomRef): CirclePrim | ArcPrim {
    const c = this.#curve(this.#curveRef(ref));
    if (c.type === 'line')
      throw new Refused('invalid', `${describeRef(ref)} is not a circle or arc`);
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
    if (m.kind === 'LWPOLYLINE' && ref.segment === undefined && use === 'fix') {
      const params = m.segments.flatMap((s) => (s.type === 'arc' ? [s.startAngle] : []));
      return { points: [...m.vertices], params };
    }
    const c = this.#curve(ref);
    if (c.type === 'line') return { points: [c.p1, c.p2], params: [] };
    if (c.type === 'circle') return { points: [c.center], params: [c.radius] };
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

/** Whether a polyline segment from `v` to `w` maps to a line or an arc. */
function segmentKind(v: BulgeVertex, w: Vec2, tol: number): 'line' | 'arc' {
  return v.bulge === 0 || samePoint(v, w, tol) ? 'line' : 'arc';
}

function mapSegmentKinds(g: LwPolylineGeometry, tol: number): ('line' | 'arc')[] {
  return Array.from({ length: polylineSegmentCount(g) }, (_, i) =>
    segmentKind(g.vertices[i]!, g.vertices[(i + 1) % g.vertices.length]!, tol),
  );
}

function samePoint(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function sameAngle(a: number, b: number, tol: number): boolean {
  const d = normalizeAngle(a - b);
  return d <= tol || 2 * Math.PI - d <= tol;
}

/** PlaneGCS's tangency between a line, circle or arc and a circle or arc. */
function tangent(a: Curve, b: Curve): [ConstraintKind, number[]] {
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

function equalRadius(a: CirclePrim | ArcPrim, b: CirclePrim | ArcPrim): [ConstraintKind, number[]] {
  if (a.type === 'circle' && b.type === 'circle')
    return [ConstraintKind.EqualRadiusCC, [a.id, b.id]];
  if (a.type === 'arc' && b.type === 'arc') return [ConstraintKind.EqualRadiusAA, [a.id, b.id]];
  return a.type === 'circle'
    ? [ConstraintKind.EqualRadiusCA, [a.id, b.id]]
    : [ConstraintKind.EqualRadiusCA, [b.id, a.id]];
}
