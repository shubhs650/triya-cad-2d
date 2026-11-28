// Constraints carried with copies (M9-06, M9-10): COPY, MIRROR, ROTATE and SCALE's Copy, ARRAY's
// items, grip Copy and PASTECLIP give the copies the constraints wholly among the objects copied;
// constraints to objects left behind stay behind (PRD FR-X4: "carry constraints within the moved
// set").
//
// AutoCAD 2024 Help, "PARAMETERCOPYMODE" (Saved in: Registry, initially 1) says how:
// 0 "Do not copy any dimensional constraints or constraint parameters. Constraints are removed
//   from copied objects." Triya copies no constraint at all, geometric ones included.
// 1 "Copy dimensional constraints and constraint parameters. Always replace expressions with
//   numerical constants. Rename dimensional parameters if there is a naming conflict."
// 2 "Reference existing user parameters when available, otherwise replace expressions with
//   numerical constants." Triya keeps an expression that names only user parameters the drawing
//   has (by name); pasted into another drawing, whose user parameters may hold other values, the
//   paste then solves the copies to them (M9-12, PASTECLIP's `solvePasted`).
// 3 "Reference existing user parameters when available, otherwise create new user parameters
//   as needed." Triya also makes the user parameters the drawing lacks, as the drawing copied
//   from had them (the Clipboard carries them, `parametersNamed`), and the user parameters they
//   name in turn; a dimensional parameter left behind (its object not copied) becomes a user
//   parameter of the value it had. A made one keeps its name where the drawing has it free and
//   takes the next free user name (user1…) otherwise, as New User Parameter would.
// 4 "Copy all dimensional constraints, constraint parameters, and expressions. Rename the
//   parameters of copied objects if conflicts in value occurs for copied parameters." Triya
//   keeps what 3 keeps and the names of the dimensional parameters copied along.
//
// The Help does not say whether 2 and 3 keep a reference to a dimensional parameter copied
// along (only 4 speaks of copying expressions): Triya keeps it under 4 only, so 2 and 3 never
// tie two copies together.
//
// The Help speaks of copies "between drawings, Model space and layouts, and block definitions";
// it does not say what COPY does within one space. Triya follows the variable for every copy,
// so the drafter has one rule. A copy within the drawing always conflicts with its original's
// name, so it takes the next free name of its kind (d4, ang2, rad1, dia3: what DIMCONSTRAINT
// would give it); pasted into another drawing it keeps its name where that one is free. Under 4,
// a copied expression names the copies of the parameters copied with it, and the parameters
// left behind only where they are still there (the same drawing); an expression that would not
// give the copy the value it measures (the copy scaled, a name the other drawing lacks) becomes
// that value. A reference constraint's copy measures its copy.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isDimensionalConstraint,
  isGeometricConstraint,
  isUserParameter,
  type DimensionalConstraintKind,
  type DimensionalConstraintObject,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type NonGraphicalObject,
  type UserParameterObject,
} from '../model/types';
import { applyPoint } from '../geom/transform';
import { measuredValue } from './constraint-display';
import { newConstraintStyle } from './constraint-style';
import type { Similarity } from './similarity';

/** The constraints a copy carries. */
export type CarriedConstraint = GeometricConstraintObject | DimensionalConstraintObject;

/** PARAMETERCOPYMODE: 0 to 4, initially 1. */
export type ParameterCopyMode = 0 | 1 | 2 | 3 | 4;

export const PARAMETER_COPY_MODE = 'PARAMETERCOPYMODE';

/** A value PARAMETERCOPYMODE can take; anything else is its initial 1. */
export function parameterCopyMode(v: unknown): ParameterCopyMode {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4 ? v : 1;
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

/** The constraints of `objects` whose references are all among `handles`. */
export function constraintsAmong(
  objects: Iterable<NonGraphicalObject>,
  handles: ReadonlySet<Handle> | ReadonlyMap<Handle, unknown>,
): CarriedConstraint[] {
  const out: CarriedConstraint[] = [];
  for (const o of objects) {
    if (!isGeometricConstraint(o) && !isDimensionalConstraint(o)) continue;
    if (o.refs.length > 0 && o.refs.every((r) => handles.has(r.entity))) out.push(o);
  }
  return out;
}

/** The prefix DIMCONSTRAINT names a new parameter of each kind with. */
const PREFIX: Readonly<Record<DimensionalConstraintKind, string>> = {
  horizontal: 'd',
  vertical: 'd',
  aligned: 'd',
  angular: 'ang',
  radial: 'rad',
  diameter: 'dia',
};

/** `prefix` and the lowest number from 1 not in `used`. */
function nextName(prefix: string, used: ReadonlySet<string>): string {
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

// An expression's numbers and names as `@triya/constraints`' parser reads them (expression.ts):
// a number first, so the `e5` of `1e5` is no name.
const NUMBER = /\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z][A-Za-z0-9_]*/y;
/** Constants and functions are not parameters (a parameter may not take their names). */
const CONSTANTS = new Set(['pi', 'e']);

/**
 * Rewrites the parameter names in `expression` by `rename` (others left as written), and
 * collects every parameter name it holds into `names`.
 */
export function renameInExpression(
  expression: string,
  rename: ReadonlyMap<string, string>,
  names?: Set<string>,
): string {
  let out = '';
  let i = 0;
  while (i < expression.length) {
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(expression);
    if (num) {
      out += num[0];
      i += num[0].length;
      continue;
    }
    NAME.lastIndex = i;
    const name = NAME.exec(expression);
    if (!name) {
      out += expression[i];
      i++;
      continue;
    }
    const word = name[0];
    i += word.length;
    const call = /^\s*\(/.test(expression.slice(i));
    if (call || CONSTANTS.has(word.toLowerCase())) {
      out += word;
      continue;
    }
    names?.add(word);
    out += rename.get(word) ?? word;
  }
  return out;
}

/** The style fields of a copy of `d` into `model`, within the drawing or pasted from another. */
function copiedStyle(
  model: DocumentModel,
  d: DimensionalConstraintObject,
  sameDrawing: boolean,
): Pick<DimensionalConstraintObject, 'style' | 'dimvars'> {
  if (sameDrawing || (d.style === undefined && d.form !== 'annotational')) {
    return {
      ...(d.style !== undefined && { style: d.style }),
      ...(d.dimvars !== undefined && { dimvars: d.dimvars }),
    };
  }
  const current = newConstraintStyle(model);
  const dimvars = { ...current.dimvars, ...d.dimvars };
  return {
    ...(current.style !== undefined && { style: current.style }),
    ...(Object.keys(dimvars).length > 0 && { dimvars }),
  };
}

/** A measured value written as an expression: 12 significant digits, as DIMCONSTRAINT keeps one. */
export const formatConstant = (v: number): string => String(Number(v.toPrecision(12)));
const constant = formatConstant;

const same = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Where the copied constraints come from and go. */
export interface CarrySource {
  /** The constraints wholly among the objects copied. */
  readonly constraints: readonly CarriedConstraint[];
  /** The objects copied as they were (a dimensional constraint's original value). */
  readonly lookup: (handle: Handle) => Entity | undefined;
  /** Copied within the drawing (every name in use), not pasted from another. */
  readonly sameDrawing: boolean;
  /**
   * The parameters the constraints' expressions name that were not copied with them (M9-12),
   * which PARAMETERCOPYMODE 3 and 4 make where the drawing lacks them: `parametersNamed`.
   */
  readonly parameters?: readonly CarriedParameter[];
}

/**
 * A parameter copied constraints name that is not among them (M9-12): a user parameter, by its
 * expression, or a dimensional constraint left behind, by the value it measured.
 */
export type CarriedParameter =
  | {
      readonly kind: 'user';
      readonly parameter: string;
      readonly expression: string;
      readonly description?: string;
    }
  | { readonly kind: 'dimension'; readonly parameter: string; readonly value: number };

/**
 * The parameters of `model` that `constraints`' expressions name, directly or through the user
 * parameters they name, other than the dimensional constraints among `constraints` themselves.
 */
export function parametersNamed(
  model: DocumentModel,
  constraints: readonly CarriedConstraint[],
): CarriedParameter[] {
  const copied = new Set(constraints.filter(isDimensionalConstraint).map((d) => d.parameter));
  const byName = new Map<string, NonGraphicalObject>();
  for (const o of model.objects.values()) {
    if (isDimensionalConstraint(o) || isUserParameter(o)) byName.set(o.parameter, o);
  }
  const out: CarriedParameter[] = [];
  const seen = new Set<string>();
  const visit = (expression: string) => {
    const names = new Set<string>();
    renameInExpression(expression, new Map(), names);
    for (const n of names) {
      if (seen.has(n) || copied.has(n)) continue;
      seen.add(n);
      const o = byName.get(n);
      if (isUserParameter(o)) {
        out.push({
          kind: 'user',
          parameter: n,
          expression: o.expression,
          ...(o.description !== undefined && { description: o.description }),
        });
        visit(o.expression);
      } else if (isDimensionalConstraint(o)) {
        const value = measuredValue(o, (h) => model.entityByHandle(h));
        if (value !== undefined) out.push({ kind: 'dimension', parameter: n, value });
      }
    }
  };
  for (const d of constraints) if (isDimensionalConstraint(d)) visit(d.expression);
  return out;
}

/**
 * Adds, for each of `source.constraints`, the same constraint between the copies, as
 * PARAMETERCOPYMODE `mode` says. `copies` maps each original's handle to its copy, which `t`
 * carried there. Returns the dimensional constraints pasted from another drawing with an
 * expression kept (M9-12): that drawing's user parameters may give them other values than their
 * copies measure, so the paste solves them (`solvePasted`).
 */
export function carryConstraintsFrom(
  b: ChangeSetBuilder,
  model: DocumentModel,
  source: CarrySource,
  copies: ReadonlyMap<Handle, Entity>,
  t: Similarity,
  mode: ParameterCopyMode,
): Handle[] {
  if (mode === 0 || copies.size === 0) return [];
  const owner = model.meta.rootDictionary ?? '0';
  const carried = source.constraints.filter((c) => c.refs.every((r) => copies.has(r.entity)));
  if (carried.length === 0) return [];
  const refsOf = (c: CarriedConstraint) =>
    c.refs.map((r) => ({ ...r, entity: copies.get(r.entity)!.handle }));
  for (const c of carried) {
    if (!isGeometricConstraint(c)) continue;
    const kind = carriedKind(c.kind, t);
    if (!kind) continue;
    b.addObject({ type: 'TRIYA_GEOMCONSTRAINT', owner, kind, refs: refsOf(c) } as Omit<
      GeometricConstraintObject,
      'handle'
    >);
  }
  const dimensions = carried.filter(isDimensionalConstraint);
  if (dimensions.length === 0) return [];
  // The names the drawing holds as this edit leaves it so far (earlier copies' included), user
  // parameters' too (M9-03 part 6).
  const used = new Set<string>();
  const user = new Set<string>();
  for (const o of b.objects()) {
    if (isDimensionalConstraint(o)) used.add(o.parameter);
    if (isUserParameter(o)) {
      used.add(o.parameter);
      user.add(o.parameter);
    }
  }
  const rename = new Map<string, string>();
  for (const d of dimensions) {
    const name =
      source.sameDrawing || used.has(d.parameter)
        ? nextName(PREFIX[d.dimension], used)
        : d.parameter;
    used.add(name);
    rename.set(d.parameter, name);
  }
  const names = new ParameterNames(b, owner, mode, source, rename, used, user);
  const byCopy = new Map([...copies.values()].map((e) => [e.handle, e]));
  const solve: Handle[] = [];
  for (const d of dimensions) {
    const refs = refsOf(d);
    const now = measuredValue({ ...d, refs }, (h) => byCopy.get(h));
    const was = measuredValue(d, source.lookup);
    let expression = d.expression;
    // An expression is kept where the copy measures what its original did (not scaled) and
    // every name it holds has a name in the drawing (`ParameterNames`).
    const kept =
      !d.reference && now !== undefined && was !== undefined && same(now, was)
        ? names.expression(d.expression)
        : undefined;
    if (kept !== undefined) {
      expression = kept;
    } else if (now !== undefined) {
      // A constant already giving the copy's value is kept as typed.
      const typed = Number(d.expression.trim());
      expression = d.expression.trim() !== '' && same(typed, now) ? d.expression : constant(now);
    }
    const added = b.addObject({
      type: 'TRIYA_DIMCONSTRAINT',
      owner,
      dimension: d.dimension,
      refs,
      parameter: rename.get(d.parameter)!,
      expression,
      ...(d.description !== undefined && { description: d.description }),
      ...(d.reference && { reference: true }),
      location: applyPoint(t.m, d.location),
      form: d.form,
      // DCDISPLAY's Hide goes with the copy (M9-03 part 7).
      ...(d.hidden && { hidden: true }),
      // And its dimension style and DIMVARs (M9-03 part 15): another drawing's handles name
      // other styles, so a paste takes that drawing's current one, keeping its own DIMVARs.
      ...copiedStyle(model, d, source.sameDrawing),
    } as Omit<DimensionalConstraintObject, 'handle'>);
    if (kept !== undefined && !source.sameDrawing && names.named(d.expression)) {
      solve.push(added.handle);
    }
  }
  return solve;
}

/**
 * The names a copied expression may keep under PARAMETERCOPYMODE 2 to 4, and the user
 * parameters 3 and 4 make for it (M9-12). A name the copy keeps is, in this order: a
 * dimensional parameter copied along, renamed as its copy (4 only); one the drawing still has,
 * copied within it (4 only, as M9-10 did); a user parameter the drawing has; or (3 and 4) a
 * parameter the source carries (`CarrySource.parameters`), made a user parameter.
 */
class ParameterNames {
  /** What each carried parameter made is named in the drawing. */
  readonly #made = new Map<string, string>();
  readonly #carried: ReadonlyMap<string, CarriedParameter>;

  constructor(
    private readonly b: ChangeSetBuilder,
    private readonly owner: Handle,
    private readonly mode: ParameterCopyMode,
    private readonly source: CarrySource,
    private readonly rename: ReadonlyMap<string, string>,
    private readonly used: Set<string>,
    private readonly user: ReadonlySet<string>,
  ) {
    this.#carried = new Map((source.parameters ?? []).map((p) => [p.parameter, p]));
  }

  /**
   * Whether `expression` names a parameter other than the copies' own: a user parameter, whose
   * value in another drawing may not be what the copy measures.
   */
  named(expression: string): boolean {
    const names = new Set<string>();
    renameInExpression(expression, new Map(), names);
    return [...names].some((n) => !this.rename.has(n));
  }

  /**
   * `expression` with each name the one the drawing gives it, the user parameters it needs made;
   * undefined, nothing made, when it names one it cannot keep (or names none under 2 and 3,
   * where the copy is no different from its value).
   */
  expression(expression: string): string | undefined {
    if (this.mode === 1) return undefined;
    const names = new Set<string>();
    renameInExpression(expression, new Map(), names);
    if (this.mode !== 4 && names.size === 0) return undefined;
    if (![...names].every((n) => this.#keeps(n, new Set()))) return undefined;
    const to = new Map([...names].map((n) => [n, this.#name(n)]));
    return renameInExpression(expression, to);
  }

  /** Whether name `n` can be kept; `visiting` guards against a cycle among carried ones. */
  #keeps(n: string, visiting: Set<string>): boolean {
    if (this.rename.has(n)) return this.mode === 4;
    if (this.mode === 4 && this.source.sameDrawing && this.used.has(n)) return true;
    if (this.user.has(n) || this.#made.has(n)) return true;
    if (this.mode === 2) return false;
    const p = this.#carried.get(n);
    if (!p || visiting.has(n)) return false;
    if (p.kind === 'dimension') return true;
    visiting.add(n);
    const names = new Set<string>();
    renameInExpression(p.expression, new Map(), names);
    const ok = [...names].every((m) => this.#keeps(m, visiting));
    visiting.delete(n);
    return ok;
  }

  /** The name `n` takes in the drawing (one `#keeps` allowed), made a user parameter if need be. */
  #name(n: string): string {
    const renamed = this.rename.get(n);
    if (renamed !== undefined) return renamed;
    if (this.mode === 4 && this.source.sameDrawing && this.used.has(n)) return n;
    if (this.user.has(n)) return n;
    const made = this.#made.get(n);
    if (made !== undefined) return made;
    const p = this.#carried.get(n)!;
    let expression: string;
    if (p.kind === 'dimension') expression = constant(p.value);
    else {
      const names = new Set<string>();
      renameInExpression(p.expression, new Map(), names);
      const to = new Map([...names].map((m) => [m, this.#name(m)]));
      expression = renameInExpression(p.expression, to);
    }
    const name = this.used.has(n) ? nextName('user', this.used) : n;
    this.used.add(name);
    this.#made.set(n, name);
    this.b.addObject({
      type: 'TRIYA_USERPARAMETER',
      owner: this.owner,
      parameter: name,
      expression,
      ...(p.kind === 'user' && p.description !== undefined && { description: p.description }),
    } as Omit<UserParameterObject, 'handle'>);
    return name;
  }
}

/**
 * Copies within the drawing (COPY, MIRROR, ROTATE and SCALE's Copy, ARRAY's items, grip Copy):
 * the drawing's constraints among the objects `copies` copied go with them.
 */
export function carryConstraints(
  b: ChangeSetBuilder,
  model: DocumentModel,
  copies: ReadonlyMap<Handle, Entity>,
  t: Similarity,
  mode: ParameterCopyMode = 1,
): void {
  if (mode === 0 || copies.size === 0) return;
  const constraints = constraintsAmong(model.objects.values(), copies);
  if (constraints.length === 0) return;
  carryConstraintsFrom(
    b,
    model,
    {
      constraints,
      lookup: (h) => model.entityByHandle(h),
      sameDrawing: true,
      ...(mode >= 3 && { parameters: parametersNamed(model, constraints) }),
    },
    copies,
    t,
    mode,
  );
}
