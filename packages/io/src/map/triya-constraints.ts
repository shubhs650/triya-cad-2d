// Constraints Triya made (GEOMCONSTRAINT and the GC* commands, M9-05; DIMCONSTRAINT and the DC*
// commands, M9-03 part 3; storage M9-04, PRD FR-X5, DEC-081, DEC-082, DEC-084) and user parameters (M9-03
// part 6, DEC-083): the XRECORDs of the
// `TRIYA_CONSTRAINTS` dictionary in the drawing's named object dictionary, each under its own
// handle as its key, read into the drawing's `GeometricConstraintObject`s and
// `DimensionalConstraintObject`s. A geometric constraint's groups (DEC-081):
//
//   70 the layout's version (1); 1 the kind, as Triya names it (horizontal, vertical,
//   perpendicular, parallel, tangent, smooth, coincident, concentric, collinear, symmetric,
//   equal, fix); then each reference in the order it was picked: 331 the object (soft pointer),
//   71 the point (0 the object itself, or its segment; 1 start, 2 end, 3 mid, 4 center,
//   5 position, 6 vertex), 90 the vertex or segment index of a polyline (-1 none).
//
// A dimensional constraint's (DEC-082):
//
//   70 its layout's version (1); 1 `dimensional`; 2 the kind (horizontal, vertical, aligned,
//   angular, radial, diameter); 300 the parameter's name; 301 its expression; 302 its
//   description, when it has one; 280 1 for a reference constraint, else 0; 281 the form (0
//   dynamic, 1 annotational); 282 1 when DCDISPLAY hid it (M9-03 part 7, DEC-084), else
//   nothing; 10 the dimension line's location; then the references as above.
//
// A user parameter's (the Parameters Manager's New User Parameter, M9-03 part 6, DEC-083):
//
//   70 its layout's version (1); 1 `parameter`; 300 its name; 301 its expression; 302 its
//   description, when it has one. Nothing more: it references no object.
//
// A record of another version or kind, one whose groups are not laid out so, one with no
// reference or more than three, or one naming an object the drawing does not hold is not mapped:
// it stays in the dictionary as read. AutoCAD ignores the dictionary, and its own constraints
// (ACAD_ASSOCNETWORK) stay in passthrough, untouched.
import type { CadDictionary } from '@node-projects/acad-ts';
import { CadObject, XRecord, type CadDocument } from '@node-projects/acad-ts';
import {
  DIMENSIONAL_CONSTRAINT_KINDS,
  GEOMETRIC_CONSTRAINT_KINDS,
  type ConstraintRef,
  type DimensionalConstraintKind,
  type DimensionalConstraintObject,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type UserParameterObject,
  type Vec2,
} from '@triya/engine';
import { common, hex } from './common';
import { namedDictionary } from './header';

/** The named object dictionary's entry the records are filed under. */
export const TRIYA_CONSTRAINTS = 'TRIYA_CONSTRAINTS';
/** The record layout DEC-081 sets out. */
export const TRIYA_CONSTRAINTS_VERSION = 1;
/** 71: the reference's point, by its value; 0 is the object (or segment) itself. */
export const CONSTRAINT_POINTS = [
  undefined,
  'start',
  'end',
  'mid',
  'center',
  'position',
  'vertex',
] as const;
/** Group 1 of a dimensional constraint's record (DEC-082), a word no geometric kind is. */
export const DIMENSIONAL_RECORD = 'dimensional';
/** Group 1 of a user parameter's record (DEC-083), a word no geometric kind is. */
export const PARAMETER_RECORD = 'parameter';
/** 281: the constraint's form, by its value. */
export const CONSTRAINT_FORMS = ['dynamic', 'annotational'] as const;
/** The most references a constraint takes (Symmetric: two objects and the symmetry line). */
export const MAX_CONSTRAINT_REFS = 3;

type Entries = readonly { readonly code: number; readonly value: unknown }[];

const number = (v: unknown): number | undefined => {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const isKind = (v: unknown): v is GeometricConstraintKind =>
  (GEOMETRIC_CONSTRAINT_KINDS as readonly unknown[]).includes(v);

const point = (v: unknown): Vec2 | undefined => {
  const p = v as { x?: unknown; y?: unknown } | undefined;
  return typeof p?.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined;
};

const isDimensionalKind = (v: unknown): v is DimensionalConstraintKind =>
  (DIMENSIONAL_CONSTRAINT_KINDS as readonly unknown[]).includes(v);

/** The references of a record's last groups (331, 71, 90 each), or undefined if they are not. */
function refsOf(rest: Entries, doc: CadDocument): ConstraintRef[] | undefined {
  if (rest.length === 0 || rest.length % 3 !== 0) return undefined;
  const refs: ConstraintRef[] = [];
  for (let i = 0; i < rest.length; i += 3) {
    const [o, p, n] = [rest[i]!, rest[i + 1]!, rest[i + 2]!];
    if (o.code !== 331 || p.code !== 71 || n.code !== 90) return undefined;
    const h = number(o.value);
    const object =
      o.value instanceof CadObject ? o.value : h === undefined ? undefined : doc.getCadObject(h);
    // An object the drawing does not hold makes the record unreadable.
    if (!object) return undefined;
    const pointIndex = number(p.value);
    const index = number(n.value);
    if (pointIndex === undefined || !Number.isInteger(pointIndex)) return undefined;
    if (pointIndex < 0 || pointIndex >= CONSTRAINT_POINTS.length) return undefined;
    if (index === undefined || !Number.isInteger(index) || index < -1) return undefined;
    const entity = hex(object.handle);
    const pt = CONSTRAINT_POINTS[pointIndex];
    if (pt === undefined) refs.push(index >= 0 ? { entity, segment: index } : { entity });
    else refs.push(index >= 0 ? { entity, point: pt, index } : { entity, point: pt });
  }
  return refs.length > MAX_CONSTRAINT_REFS ? undefined : refs;
}

/** The record's kind and references, or undefined when the groups are not a whole record. */
export function constraintFields(
  entries: Entries,
  doc: CadDocument,
): Pick<GeometricConstraintObject, 'kind' | 'refs'> | undefined {
  if (entries.length < 2 || entries[0]!.code !== 70 || entries[1]!.code !== 1) return undefined;
  if (number(entries[0]!.value) !== TRIYA_CONSTRAINTS_VERSION) return undefined;
  const kind = entries[1]!.value;
  if (!isKind(kind)) return undefined;
  const refs = refsOf(entries.slice(2), doc);
  return refs && { kind, refs };
}

type DimensionalFields = Omit<DimensionalConstraintObject, 'handle' | 'type' | 'owner'>;

/** A dimensional constraint's fields (DEC-082), or undefined when the groups are not a whole record. */
export function dimensionalFields(
  entries: Entries,
  doc: CadDocument,
): DimensionalFields | undefined {
  const at = (i: number, code: number) =>
    entries[i]?.code === code ? entries[i]!.value : undefined;
  if (number(at(0, 70)) !== TRIYA_CONSTRAINTS_VERSION || at(1, 1) !== DIMENSIONAL_RECORD) {
    return undefined;
  }
  const dimension = at(2, 2);
  const parameter = at(3, 300);
  const expression = at(4, 301);
  if (!isDimensionalKind(dimension) || typeof parameter !== 'string') return undefined;
  if (typeof expression !== 'string') return undefined;
  let i = 5;
  const description = at(i, 302);
  if (description !== undefined) i++;
  if (description !== undefined && typeof description !== 'string') return undefined;
  const reference = number(at(i, 280));
  const form = number(at(i + 1, 281));
  i += 2;
  // DCDISPLAY's Hide (DEC-084): 282 1, only on a hidden constraint.
  const hidden = at(i, 282);
  if (hidden !== undefined) i++;
  if (hidden !== undefined && number(hidden) !== 1) return undefined;
  const location = point(at(i, 10));
  if (reference !== 0 && reference !== 1) return undefined;
  if (form !== 0 && form !== 1) return undefined;
  if (!location) return undefined;
  const refs = refsOf(entries.slice(i + 1), doc);
  if (!refs) return undefined;
  return {
    dimension,
    refs,
    parameter,
    expression,
    ...(description === undefined ? {} : { description: description as string }),
    ...(reference === 1 ? { reference: true } : {}),
    location,
    form: CONSTRAINT_FORMS[form],
    ...(hidden === undefined ? {} : { hidden: true as const }),
  };
}

type UserParameterFields = Omit<UserParameterObject, 'handle' | 'type' | 'owner'>;

/** A user parameter's fields (DEC-083), or undefined when the groups are not a whole record. */
export function userParameterFields(entries: Entries): UserParameterFields | undefined {
  const at = (i: number, code: number) =>
    entries[i]?.code === code ? entries[i]!.value : undefined;
  if (number(at(0, 70)) !== TRIYA_CONSTRAINTS_VERSION || at(1, 1) !== PARAMETER_RECORD) {
    return undefined;
  }
  const parameter = at(2, 300);
  const expression = at(3, 301);
  if (typeof parameter !== 'string' || typeof expression !== 'string') return undefined;
  const description = at(4, 302);
  if (description !== undefined && typeof description !== 'string') return undefined;
  if (entries.length !== (description === undefined ? 4 : 5)) return undefined;
  return {
    parameter,
    expression,
    ...(description === undefined ? {} : { description: description as string }),
  };
}

type TriyaConstraint =
  GeometricConstraintObject | DimensionalConstraintObject | UserParameterObject;

/** The drawing's constraints and user parameters, in the dictionary's order. */
export function mapTriyaConstraints(doc: CadDocument): TriyaConstraint[] {
  const dict = namedDictionary(doc, TRIYA_CONSTRAINTS);
  if (!dict) return [];
  const out: TriyaConstraint[] = [];
  for (const key of dict.entryNames) {
    const o: unknown = dict.getEntry(key);
    if (!(o instanceof XRecord) || o.owner !== dict) continue;
    const entries = o.entries as Entries;
    const owner = hex(dict.handle);
    const geometric = constraintFields(entries, doc);
    if (geometric) {
      out.push({ ...common(o), type: 'TRIYA_GEOMCONSTRAINT', owner, ...geometric });
      continue;
    }
    const dimensional = dimensionalFields(entries, doc);
    if (dimensional) {
      out.push({ ...common(o), type: 'TRIYA_DIMCONSTRAINT', owner, ...dimensional });
      continue;
    }
    const user = userParameterFields(entries);
    if (user) out.push({ ...common(o), type: 'TRIYA_USERPARAMETER', owner, ...user });
  }
  return out;
}

/** The `TRIYA_CONSTRAINTS` dictionary, if the drawing has one. */
export const constraintsDictionary = (doc: CadDocument): CadDictionary | undefined =>
  namedDictionary(doc, TRIYA_CONSTRAINTS);
