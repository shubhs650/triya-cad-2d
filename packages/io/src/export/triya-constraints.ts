// TriyaToAcad for geometric constraints (M9-04, PRD FR-X5, DEC-081), the inverse of
// map/triya-constraints.ts: each constraint is an XRECORD in the `TRIYA_CONSTRAINTS` dictionary
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
// reference or more than three, a bad vertex or segment index, a new constraint's handle in use,
// and a version before R2000 (the save writes AC1032, DEC-047).
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  GEOMETRIC_CONSTRAINT_KINDS,
  isGeometricConstraint,
  type DocumentInit,
  type DocumentModel,
  type GeometricConstraintObject,
  type Handle,
  type NonGraphicalObject,
} from '@triya/engine';
import {
  CONSTRAINT_POINTS,
  MAX_CONSTRAINT_REFS,
  TRIYA_CONSTRAINTS,
  TRIYA_CONSTRAINTS_VERSION,
  constraintsDictionary,
} from '../map/triya-constraints';
import { resolve, same, type Resolver } from './entities';

export interface TriyaConstraintsPlan {
  readonly updated: { readonly acad: XRecord; readonly after: GeometricConstraintObject }[];
  readonly added: GeometricConstraintObject[];
  readonly removed: XRecord[];
}

const handle = (h: Handle): number => Number.parseInt(h, 16);

/** What the record states: its kind and references. */
const fields = (c: GeometricConstraintObject) => ({ kind: c.kind, refs: c.refs });

/** Why `c` cannot be written as DEC-081 lays a record out. */
function layoutProblems(c: GeometricConstraintObject): string[] {
  const out: string[] = [];
  if (!(GEOMETRIC_CONSTRAINT_KINDS as readonly string[]).includes(c.kind)) {
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
  const before = new Map(
    (base.objects ?? []).filter(isGeometricConstraint).map((o) => [o.handle, o]),
  );
  const dict = constraintsDictionary(doc);
  const owners = new Set<Handle | undefined>([model.meta.rootDictionary]);
  if (dict) owners.add(dict.handle.toString(16).toUpperCase());
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  // A constraint on an object that is gone is saved as none.
  const saved = (o: NonGraphicalObject | undefined): o is GeometricConstraintObject =>
    isGeometricConstraint(o) && o.refs.every((ref) => model.entityByHandle(ref.entity));
  for (const h of before.keys()) {
    if (saved(model.objects.get(h))) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) plan.removed.push(acad);
    else problems.push(`TRIYA_GEOMCONSTRAINT ${h}: the original is not an XRECORD`);
  }
  for (const a of model.objects.values()) {
    if (!saved(a)) continue;
    const b = before.get(a.handle);
    if (b && same(fields(b), fields(a))) continue;
    const out = layoutProblems(a);
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
    problems.push(...out.map((p) => `TRIYA_GEOMCONSTRAINT ${a.handle}: ${p}`));
  }
  return { plan, problems };
}

/** The record's groups, as map/triya-constraints.ts reads them. */
function fill(x: XRecord, c: GeometricConstraintObject): void {
  x.clear();
  x.createEntry(70, TRIYA_CONSTRAINTS_VERSION);
  x.createEntry(1, c.kind);
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
