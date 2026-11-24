// TriyaToAcad for geometric constraints (M9-04, PRD FR-X5, DEC-081), dimensional ones (M9-03
// part 3, DEC-082) and user parameters (M9-03 part 6, DEC-083), the inverse of map/triya-constraints.ts: each constraint is an XRECORD in the `TRIYA_CONSTRAINTS` dictionary
// of the named object dictionary, keyed by its own handle. A new constraint joins it; the first
// one a drawing gets brings the dictionary, made as AutoCAD files its own dictionaries there
// (soft owner, 281 = 1, the root dictionary its reactor). A constraint whose kind or references
// changed has its groups written again; one that goes leaves the dictionary, which stays, empty.
//
// A constraint naming an object the drawing no longer holds is saved as none: AutoCAD removes an
// erased object's constraints with it (AutoCAD 2024 Help, "About Applying Geometric
// Constraints"), and a record naming nothing could not be read back.
//
// Refused, before anything changes: a constraint filed elsewhere than the root dictionary (where
// GEOMCONSTRAINT files a new one) or `TRIYA_CONSTRAINTS`, a kind Triya does not name, no
// reference or more than three, a bad vertex or segment index, a parameter name (a dimensional
// constraint's or a user parameter's) taken by another or text that does not fit a string group, a new constraint's handle in use,
// and a version before R2000 (the save writes AC1032, DEC-047).
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  XRecord,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  DIMENSIONAL_CONSTRAINT_KINDS,
  GEOMETRIC_CONSTRAINT_KINDS,
  isDimensionalConstraint,
  isGeometricConstraint,
  isUserParameter,
  type DimensionalConstraintObject,
  type DocumentInit,
  type DocumentModel,
  type GeometricConstraintObject,
  type Handle,
  type NonGraphicalObject,
  type UserParameterObject,
} from '@triya/engine';
import {
  CONSTRAINT_FORMS,
  CONSTRAINT_POINTS,
  DIMENSIONAL_RECORD,
  MAX_CONSTRAINT_REFS,
  PARAMETER_RECORD,
  TRIYA_CONSTRAINTS,
  TRIYA_CONSTRAINTS_VERSION,
  constraintsDictionary,
} from '../map/triya-constraints';
import { resolve, same, type Resolver } from './entities';

type Constraint = GeometricConstraintObject | DimensionalConstraintObject | UserParameterObject;

const isConstraint = (o: NonGraphicalObject | undefined): o is Constraint =>
  isGeometricConstraint(o) || isDimensionalConstraint(o) || isUserParameter(o);

/** The references a record names: a user parameter names none. */
const refsOf = (c: Constraint) => (isUserParameter(c) ? [] : c.refs);

export interface TriyaConstraintsPlan {
  readonly updated: { readonly acad: XRecord; readonly after: Constraint }[];
  readonly added: Constraint[];
  readonly removed: XRecord[];
}

const handle = (h: Handle): number => Number.parseInt(h, 16);

/** What the record states: everything but the handle and owner. */
const fields = (c: Constraint) => {
  const { handle: _h, owner: _o, ...rest } = c;
  return rest;
};

/** A string group's text: one line, at most 2049 characters (DXF's limit for a string value). */
const textProblem = (what: string, s: string): string | undefined =>
  /[\r\n]/.test(s) || s.length > 2049 ? `${what} does not fit one string group` : undefined;

/** The text groups of a parameter's record, and why they cannot be written. */
function parameterTextProblems(c: DimensionalConstraintObject | UserParameterObject): string[] {
  const out: string[] = [];
  for (const [what, text] of [
    ['the parameter name', c.parameter],
    ['the expression', c.expression],
    ['the description', c.description ?? ''],
  ] as const) {
    const p = textProblem(what, text);
    if (p) out.push(p);
  }
  if (c.parameter === '' || c.expression === '') out.push('an empty parameter or expression');
  return out;
}

/** Why `c` cannot be written as DEC-081 (DEC-082, DEC-083) lays a record out. */
function layoutProblems(c: Constraint): string[] {
  if (isUserParameter(c)) return parameterTextProblems(c);
  const out: string[] = [];
  if (isDimensionalConstraint(c)) {
    if (!(DIMENSIONAL_CONSTRAINT_KINDS as readonly string[]).includes(c.dimension)) {
      out.push(`kind ${String(c.dimension)}`);
    }
    if (!CONSTRAINT_FORMS.includes(c.form)) out.push(`form ${String(c.form)}`);
    if (!Number.isFinite(c.location?.x) || !Number.isFinite(c.location?.y)) out.push('location');
    out.push(...parameterTextProblems(c));
  } else if (!(GEOMETRIC_CONSTRAINT_KINDS as readonly string[]).includes(c.kind)) {
    out.push(`kind ${String(c.kind)}`);
  }
  if (c.refs.length === 0 || c.refs.length > MAX_CONSTRAINT_REFS) {
    out.push(`${c.refs.length} references (1 to ${MAX_CONSTRAINT_REFS})`);
  }
  for (const ref of c.refs) {
    const point = 'point' in ref ? ref.point : undefined;
    if (point !== undefined && !CONSTRAINT_POINTS.includes(point)) out.push(`point ${point}`);
    const n = 'point' in ref ? ref.index : ref.segment;
    if (n !== undefined && (!Number.isInteger(n) || n < 0)) out.push(`index ${n}`);
  }
  return out;
}

export function planTriyaConstraints(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: TriyaConstraintsPlan; problems: string[] } {
  const plan: TriyaConstraintsPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isConstraint).map((o) => [o.handle, o]));
  const dict = constraintsDictionary(doc);
  const owners = new Set<Handle | undefined>([model.meta.rootDictionary]);
  if (dict) owners.add(dict.handle.toString(16).toUpperCase());
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  // A constraint on an object that is gone is saved as none.
  const saved = (o: NonGraphicalObject | undefined): o is Constraint =>
    isConstraint(o) && refsOf(o).every((ref) => model.entityByHandle(ref.entity));
  for (const [h, was] of before) {
    if (saved(model.objects.get(h))) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) plan.removed.push(acad);
    else problems.push(`${was.type} ${h}: the original is not an XRECORD`);
  }
  // A parameter's name is the Parameters Manager's key: two records may not share one.
  const names = new Map<string, number>();
  const named = (o: Constraint) => isDimensionalConstraint(o) || isUserParameter(o);
  for (const a of model.objects.values()) {
    if (saved(a) && named(a)) names.set(a.parameter, (names.get(a.parameter) ?? 0) + 1);
  }
  for (const a of model.objects.values()) {
    if (!saved(a)) continue;
    const b = before.get(a.handle);
    if (b && b.type === a.type && same(fields(b), fields(a))) continue;
    const out = layoutProblems(a);
    if (named(a) && (names.get(a.parameter) ?? 0) > 1) {
      out.push(`parameter ${a.parameter} is another constraint's too`);
    }
    if (!owners.has(a.owner)) out.push(`it is filed in ${a.owner}, not ${TRIYA_CONSTRAINTS}`);
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (b) {
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) plan.updated.push({ acad: acad!, after: a });
    } else {
      if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
      if (!dict && !doc.rootDictionary) out.push('the drawing has no named object dictionary');
      if (out.length === 0) plan.added.push(a);
    }
    problems.push(...out.map((p) => `${a.type} ${a.handle}: ${p}`));
  }
  return { plan, problems };
}

/** The record's groups, as map/triya-constraints.ts reads them. */
function fill(x: XRecord, c: Constraint): void {
  x.clear();
  x.createEntry(70, TRIYA_CONSTRAINTS_VERSION);
  if (isUserParameter(c)) {
    x.createEntry(1, PARAMETER_RECORD);
    x.createEntry(300, c.parameter);
    x.createEntry(301, c.expression);
    if (c.description !== undefined) x.createEntry(302, c.description);
    return;
  }
  if (isDimensionalConstraint(c)) {
    x.createEntry(1, DIMENSIONAL_RECORD);
    x.createEntry(2, c.dimension);
    x.createEntry(300, c.parameter);
    x.createEntry(301, c.expression);
    if (c.description !== undefined) x.createEntry(302, c.description);
    x.createEntry(280, c.reference ? 1 : 0);
    x.createEntry(281, CONSTRAINT_FORMS.indexOf(c.form));
    x.createEntry(10, new XYZ(c.location.x, c.location.y, 0));
  } else {
    x.createEntry(1, c.kind);
  }
  for (const ref of c.refs) {
    const point = 'point' in ref ? ref.point : undefined;
    const index = 'point' in ref ? ref.index : ref.segment;
    x.createEntry(331, handle(ref.entity));
    x.createEntry(71, CONSTRAINT_POINTS.indexOf(point));
    x.createEntry(90, index ?? -1);
  }
}

/** Writes the plan, after the entities: a record may name an object the same save adds. */
export function writeTriyaConstraints(
  doc: CadDocument,
  r: Resolver,
  plan: TriyaConstraintsPlan,
): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  for (const { acad, after } of plan.updated) fill(acad, after);
  if (plan.added.length === 0) return;
  let dict = constraintsDictionary(doc);
  if (!dict) {
    const root = doc.rootDictionary!;
    // As AutoCAD files a dictionary of the named object dictionary (ACAD_GROUP and the others):
    // a soft owner of its entries, listing the root dictionary as its reactor.
    dict = new CadDictionary();
    dict.handle = r.allocate();
    dict.hardOwnerFlag = false;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
    root.addByKey(TRIYA_CONSTRAINTS, dict);
    dict.addReactor(root);
  }
  for (const c of plan.added) {
    const x = new XRecord();
    x.handle = handle(c.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, c);
    dict.addByKey(c.handle, x);
  }
}
