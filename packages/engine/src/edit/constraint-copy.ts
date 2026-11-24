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
// 2 and 3 copy user parameters too, referencing those the drawing has or making the missing
//   ones. Triya has no user parameters yet (M9-03's later part), so they copy as 1 does.
// 4 "Copy all dimensional constraints, constraint parameters, and expressions. Rename the
//   parameters of copied objects if conflicts in value occurs for copied parameters."
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
  type DimensionalConstraintKind,
  type DimensionalConstraintObject,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type NonGraphicalObject,
} from '../model/types';
import { applyPoint } from '../geom/transform';
import { measuredValue } from './constraint-display';
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

/** A measured value written as an expression: 12 significant digits, as DIMCONSTRAINT keeps one. */
const constant = (v: number): string => String(Number(v.toPrecision(12)));

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
}

/**
 * Adds, for each of `source.constraints`, the same constraint between the copies, as
 * PARAMETERCOPYMODE `mode` says. `copies` maps each original's handle to its copy, which `t`
 * carried there.
 */
export function carryConstraintsFrom(
  b: ChangeSetBuilder,
  model: DocumentModel,
  source: CarrySource,
  copies: ReadonlyMap<Handle, Entity>,
  t: Similarity,
  mode: ParameterCopyMode,
): void {
  if (mode === 0 || copies.size === 0) return;
  const owner = model.meta.rootDictionary ?? '0';
  const carried = source.constraints.filter((c) => c.refs.every((r) => copies.has(r.entity)));
  if (carried.length === 0) return;
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
  if (dimensions.length === 0) return;
  // The names the drawing holds as this edit leaves it so far (earlier copies' included).
  const used = new Set<string>();
  for (const o of b.objects()) if (isDimensionalConstraint(o)) used.add(o.parameter);
  const rename = new Map<string, string>();
  for (const d of dimensions) {
    const name =
      source.sameDrawing || used.has(d.parameter)
        ? nextName(PREFIX[d.dimension], used)
        : d.parameter;
    used.add(name);
    rename.set(d.parameter, name);
  }
  const byCopy = new Map([...copies.values()].map((e) => [e.handle, e]));
  for (const d of dimensions) {
    const refs = refsOf(d);
    const now = measuredValue({ ...d, refs }, (h) => byCopy.get(h));
    const was = measuredValue(d, source.lookup);
    let expression = d.expression;
    if (!d.reference && mode === 4) {
      const names = new Set<string>();
      expression = renameInExpression(d.expression, rename, names);
      const known = [...names].every((n) => rename.has(n) || (source.sameDrawing && used.has(n)));
      if (!known || now === undefined || was === undefined || !same(now, was)) {
        expression = now === undefined ? d.expression : constant(now);
      }
    } else if (now !== undefined) {
      // A constant already giving the copy's value is kept as typed.
      const typed = Number(d.expression.trim());
      expression = d.expression.trim() !== '' && same(typed, now) ? d.expression : constant(now);
    }
    b.addObject({
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
    } as Omit<DimensionalConstraintObject, 'handle'>);
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
    { constraints, lookup: (h) => model.entityByHandle(h), sameDrawing: true },
    copies,
    t,
    mode,
  );
}
