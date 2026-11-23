// Geometric constraints Triya made (GEOMCONSTRAINT and the GC* commands, M9-05; storage M9-04,
// PRD FR-X5, DEC-081): the XRECORDs of the `TRIYA_CONSTRAINTS` dictionary in the drawing's named
// object dictionary, each under its own handle as its key, read into the drawing's
// `GeometricConstraintObject`s. A record's groups:
//
//   70 the layout's version (1); 1 the kind, as Triya names it (horizontal, vertical,
//   perpendicular, parallel, tangent, smooth, coincident, concentric, collinear, symmetric,
//   equal, fix); then each reference in the order it was picked: 331 the object (soft pointer),
//   71 the point (0 the object itself, or its segment; 1 start, 2 end, 3 mid, 4 center,
//   5 position, 6 vertex), 90 the vertex or segment index of a polyline (-1 none).
//
// A record of another version or kind, one whose groups are not laid out so, one with no
// reference or more than three, or one naming an object the drawing does not hold is not mapped:
// it stays in the dictionary as read. AutoCAD ignores the dictionary, and its own constraints
// (ACAD_ASSOCNETWORK) stay in passthrough, untouched.
import type { CadDictionary } from '@node-projects/acad-ts';
import { CadObject, XRecord, type CadDocument } from '@node-projects/acad-ts';
import {
  GEOMETRIC_CONSTRAINT_KINDS,
  type ConstraintRef,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
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
/** The most references a constraint takes (Symmetric: two objects and the symmetry line). */
export const MAX_CONSTRAINT_REFS = 3;

type Entries = readonly { readonly code: number; readonly value: unknown }[];

const number = (v: unknown): number | undefined => {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const isKind = (v: unknown): v is GeometricConstraintKind =>
  (GEOMETRIC_CONSTRAINT_KINDS as readonly unknown[]).includes(v);

/** The record's kind and references, or undefined when the groups are not a whole record. */
export function constraintFields(
  entries: Entries,
  doc: CadDocument,
): Pick<GeometricConstraintObject, 'kind' | 'refs'> | undefined {
  if (entries.length < 2 || entries[0]!.code !== 70 || entries[1]!.code !== 1) return undefined;
  if (number(entries[0]!.value) !== TRIYA_CONSTRAINTS_VERSION) return undefined;
  const kind = entries[1]!.value;
  if (!isKind(kind)) return undefined;
  const rest = entries.slice(2);
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
    const point = CONSTRAINT_POINTS[pointIndex];
    if (point === undefined) refs.push(index >= 0 ? { entity, segment: index } : { entity });
    else refs.push(index >= 0 ? { entity, point, index } : { entity, point });
  }
  if (refs.length > MAX_CONSTRAINT_REFS) return undefined;
  return { kind, refs };
}

/** The drawing's geometric constraints, in the dictionary's order. */
export function mapTriyaConstraints(doc: CadDocument): GeometricConstraintObject[] {
  const dict = namedDictionary(doc, TRIYA_CONSTRAINTS);
  if (!dict) return [];
  const out: GeometricConstraintObject[] = [];
  for (const key of dict.entryNames) {
    const o: unknown = dict.getEntry(key);
    if (!(o instanceof XRecord) || o.owner !== dict) continue;
    const fields = constraintFields(o.entries as Entries, doc);
    if (!fields) continue;
    out.push({
      ...common(o),
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: hex(dict.handle),
      ...fields,
    });
  }
  return out;
}

/** The `TRIYA_CONSTRAINTS` dictionary, if the drawing has one. */
export const constraintsDictionary = (doc: CadDocument): CadDictionary | undefined =>
  namedDictionary(doc, TRIYA_CONSTRAINTS);
