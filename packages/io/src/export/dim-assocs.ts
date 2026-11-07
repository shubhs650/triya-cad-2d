// TriyaToAcad for DIMASSOC objects (M1-75 part 35), the inverse of map/dim-assoc.ts: what keeps
// an associative dimension on the geometry it measures. A dimension made with DIMASSOC = 2 and
// DIMREASSOCIATE give a dimension a DIMASSOC, as the `ACAD_DIMASSOC` entry of its extension
// dictionary (which the save makes when the dimension has none); DIMREASSOCIATE moves a point
// to other geometry, an edit of the geometry moves its snapped points, and DIMDISASSOCIATE
// removes it. The DIMASSOC names the dimension (DXF 330) and each point's geometry (331, and 332
// for the second object of an intersection), and both list the DIMASSOC in their reactors, as
// every associative dimension of the corpus shows; the entities' side is checked in reactors.ts,
// here the DIMASSOC's.
//
// AutoCAD does not document what ERASE does to the DIMASSOC of a dimension whose geometry goes
// (the dimension "loses its associativity"). Either reading is accepted: the save writes the
// point references the model states, and refuses one still naming erased geometry.
//
// Refused, before anything changes: a DIMASSOC before R2000 (AutoCAD 2002 introduced it, in the
// R2000 format), one that is not in its dimension's extension dictionary, names something other
// than a dimension or a dimension that does not list it, has no associative point (that is
// DIMDISASSOCIATE, which removes it), a point on geometry that does not exist, is in another
// block (unless trans-space) or does not list it, old geometry still listing it, a changed point
// nested in a block reference or an xref or with a previous point reference (no corpus file
// shows how AutoCAD links those), and xdata, reactor and extension dictionary changes.

import {
  ACadVersion,
  AssociativityFlags,
  CadDictionary,
  CadObject,
  DictionaryCloningFlags,
  DimensionAssociationObject,
  Entity as AcadEntity,
  OsnapPointRef,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import type {
  DimAssoc,
  DimAssocPoint,
  DocumentInit,
  DocumentModel,
  Entity,
  EntityInit,
  Handle,
  NonGraphicalObject,
} from '@triya/engine';
import { resolve, same, type Resolver } from './entities';

/** The dictionary entry AutoCAD keeps a dimension's DIMASSOC under. */
export const DIMASSOC_ENTRY = 'ACAD_DIMASSOC';

const isAssoc = (o: NonGraphicalObject | undefined): o is DimAssoc => o?.type === 'DIMASSOC';

/** The entity kinds AutoCAD keeps associative (every dimension). */
const DIMENSION_KINDS = new Set(['DIMENSION', 'LARGE_RADIAL_DIMENSION', 'ARC_DIMENSION']);

/** DXF 90's bit for each point. */
const BITS = [
  AssociativityFlags.FirstPointReference,
  AssociativityFlags.SecondPointReference,
  AssociativityFlags.ThirdPointReference,
  AssociativityFlags.FourthPointReference,
] as const;

/** ObjectOsnapType: intersection and apparent intersection, which name a second object. */
const INTERSECTIONS = new Set([6, 11]);

export interface DimAssocsPlan {
  readonly updated: {
    readonly acad: DimensionAssociationObject;
    readonly before: DimAssoc;
    readonly after: DimAssoc;
  }[];
  /** New DIMASSOCs, already holding their handle; `dictionary` is a handle when the save makes it. */
  readonly added: {
    readonly acad: DimensionAssociationObject;
    readonly after: DimAssoc;
    readonly dictionary: CadDictionary | number;
  }[];
  /** Removed ones whose dimension stays (an erased dimension's go with its dictionary). */
  readonly removed: DimensionAssociationObject[];
}

/** The engine handles of the extension dictionaries the save makes for new DIMASSOCs. */
export function newDimAssocDictionaries(plan: DimAssocsPlan): Map<Handle, Handle> {
  const out = new Map<Handle, Handle>();
  for (const { after, dictionary } of plan.added) {
    if (typeof dictionary === 'number') out.set(after.dimension, after.owner);
  }
  return out;
}

const points = (a: DimAssoc | undefined): readonly (DimAssocPoint | null)[] =>
  Array.isArray(a?.points) ? a.points : [];

/** Every object a DIMASSOC's points name: their geometry and intersection objects. */
export function dimAssocGeometry(a: DimAssoc | undefined): Handle[] {
  return points(a).flatMap((p) => (p ? [...p.geometry, ...(p.intersection?.geometry ?? [])] : []));
}

/** The model's DIMASSOC changes against the original's mapping, and why any cannot be written. */
export function planDimAssocs(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: DimAssocsPlan; problems: string[] } {
  const plan: DimAssocsPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const version = doc.header?.version;
  const baseObjects = new Map((base.objects ?? []).map((o) => [o.handle, o]));
  const baseEntities = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  const reactorsOf = (h: Handle): readonly Handle[] => model.entityByHandle(h)?.reactors ?? [];

  for (const b of baseObjects.values()) {
    if (!isAssoc(b) || model.objects.has(b.handle)) continue;
    const what = `DIMASSOC ${b.handle}`;
    // DIMDISASSOCIATE, or ERASE of the dimension: the dimension and geometry let go of it.
    for (const h of new Set([b.dimension, ...dimAssocGeometry(b)])) {
      if (reactorsOf(h).includes(b.handle))
        problems.push(`${what}: ${h} still points at it (reactors)`);
    }
    if (!model.entityByHandle(b.dimension)) continue; // its dictionary goes with the dimension
    const acad = resolve(r, b.handle, DimensionAssociationObject);
    if (!acad || !(acad.owner instanceof CadDictionary))
      problems.push(`${what}: the original is not a DIMASSOC in a dictionary`);
    else plan.removed.push(acad);
  }

  for (const a of model.objects.values()) {
    if (!isAssoc(a)) continue;
    const h = a.handle;
    const b = baseObjects.get(h);
    if (b && !isAssoc(b)) continue; // another object's type change, refused with it
    // ERASE of a dimension or its geometry: one the DIMASSOC still names would be saved dangling.
    const erased = [a.dimension, ...dimAssocGeometry(a)].filter(
      (e) => baseEntities.has(e) && !model.entityByHandle(e),
    );
    if (b && same(b, a)) {
      for (const e of new Set(erased)) {
        problems.push(`DIMASSOC ${h}: still names the erased entity ${e}`);
      }
      continue;
    }
    const out = [...new Set(erased)].map((e) => `still names the erased entity ${e}`);
    const dim = model.entityByHandle(a.dimension);
    if (!dim) {
      if (!baseEntities.has(a.dimension)) {
        out.push(`dimension ${a.dimension} is not an entity of the drawing`);
      }
    } else {
      if (!DIMENSION_KINDS.has(dim.geom.kind))
        out.push(`${a.dimension} is a ${dim.type}, not a dimension`);
      if (!(dim.reactors ?? []).includes(h))
        out.push(`dimension ${a.dimension} does not point back at it (reactors)`);
    }
    let acad: DimensionAssociationObject | undefined;
    let dictionary: CadDictionary | number | undefined;
    if (b) {
      acad = resolve(r, h, DimensionAssociationObject);
      if (!acad) out.push('the original is not a DIMASSOC');
      if (b.owner !== a.owner) out.push('owner changes');
      if (b.dimension !== a.dimension) out.push('its dimension changes');
      for (const k of ['xdata', 'reactors', 'extDict'] as const) {
        if (!same(b[k], a[k])) out.push(`${k} changes`);
      }
    } else {
      // AutoCAD 2002 made dimensions associative; it saves in the R2000 format.
      if (
        version !== undefined &&
        version !== ACadVersion.Unknown &&
        version < ACadVersion.AC1015
      ) {
        out.push(
          `${ACadVersion[version]} has no associative dimensions (DIMASSOC came with R2000)`,
        );
      }
      if (doc.getCadObject(Number.parseInt(h, 16))) out.push('the handle is already used');
      if (a.xdata !== undefined || a.extDict !== undefined)
        out.push('xdata or an extension dictionary');
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) {
        out.push('its reactors can only be its dictionary');
      }
      if (dim) dictionary = newDictionary(doc, r, baseEntities.get(a.dimension), dim, a, out);
    }
    out.push(...valueProblems(a));
    out.push(...pointProblems(model, a, b, dim, new Set(erased)));
    if (out.length > 0) {
      problems.push(...out.map((p) => `DIMASSOC ${h}: ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      acad = new DimensionAssociationObject();
      // acad-ts keeps a non-zero handle it has not seen, so the DIMASSOC keeps Triya's handle.
      acad.handle = Number.parseInt(h, 16);
      r.created.set(h, acad);
      plan.added.push({ acad, after: a, dictionary: dictionary! });
    }
  }
  return { plan, problems };
}

/**
 * The extension dictionary a new DIMASSOC goes into: its dimension's, or one the save makes when
 * the dimension has none and the model gives it one (the dimension's `extDict` and the DIMASSOC's
 * owner, both new).
 */
function newDictionary(
  doc: CadDocument,
  r: Resolver,
  was: EntityInit | undefined,
  dim: Entity,
  a: DimAssoc,
  out: string[],
): CadDictionary | number | undefined {
  if (dim.extDict === undefined || dim.extDict !== a.owner) {
    out.push(
      `it must sit in its dimension's extension dictionary${dim.extDict ? ` ${dim.extDict}` : ''}`,
    );
    return undefined;
  }
  if (was?.extDict === dim.extDict) {
    const dictionary = resolve(r, dim.extDict, CadDictionary);
    if (!dictionary) out.push(`extension dictionary ${dim.extDict} is not in the drawing`);
    else if (dictionary.entryNames.some((k) => k.toUpperCase() === DIMASSOC_ENTRY)) {
      out.push(`dimension ${dim.handle} already has an ${DIMASSOC_ENTRY} entry`);
    }
    return dictionary;
  }
  if (was?.extDict !== undefined) {
    out.push(`dimension ${dim.handle} changes its extension dictionary`);
    return undefined;
  }
  if (doc.getCadObject(Number.parseInt(a.owner, 16))) {
    out.push(`the extension dictionary's handle ${a.owner} is already used`);
  }
  return Number.parseInt(a.owner, 16);
}

const isInt = (v: unknown, min: number, max: number): boolean =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function valueProblems(a: DimAssoc): string[] {
  const out: string[] = [];
  if (typeof a.transSpace !== 'boolean')
    out.push(`transSpace: ${JSON.stringify(a.transSpace)} is not true or false`);
  if (!isInt(a.rotatedType, 0, 2))
    out.push(`rotatedType: ${JSON.stringify(a.rotatedType)} is not 0, 1 or 2`);
  if (!Array.isArray(a.points) || a.points.length !== 4)
    out.push('points: not four point references or nulls');
  else if (a.points.every((p) => p === null)) {
    out.push('no associative point (DIMDISASSOCIATE removes the DIMASSOC)');
  }
  return out;
}

/** The DIMASSOC's side of the link with its geometry: points that changed, and old geometry. */
function pointProblems(
  model: DocumentModel,
  a: DimAssoc,
  b: DimAssoc | undefined,
  dim: Entity | undefined,
  erasedBefore: ReadonlySet<Handle>,
): string[] {
  if (!Array.isArray(a.points) || a.points.length !== 4) return [];
  const out: string[] = [];
  a.points.forEach((p, i) => {
    const was = points(b)[i] ?? null;
    if (p === null || (b && same(was, p))) return;
    const where = `point ${i + 1}`;
    if (!isInt(p.osnap, 0, 13))
      out.push(`${where}: osnap ${JSON.stringify(p.osnap)} is not 0 to 13`);
    if (!isInt(p.subentType, 0, 2))
      out.push(`${where}: subentType ${JSON.stringify(p.subentType)} is not 0, 1 or 2`);
    if (!Number.isInteger(p.gsMarker)) out.push(`${where}: gsMarker is not an integer`);
    const finite = [p.parameter, p.point?.x, p.point?.y, p.point?.z].every(Number.isFinite);
    if (!finite) out.push(`${where}: a parameter or point that is not a finite number`);
    if (p.last !== undefined && !same(p.last, was?.last)) {
      out.push(`${where}: a previous point reference (DXF 75)`);
    }
    const intersection = INTERSECTIONS.has(p.osnap);
    if (intersection !== (p.intersection !== undefined)) {
      out.push(
        `${where}: ${intersection ? 'an intersection snap without' : 'a second object without an intersection snap'}`,
      );
    }
    for (const [g, xref, name] of [
      [p.geometry, p.xrefPaths, 'geometry'],
      [p.intersection?.geometry, p.intersection?.xrefPaths, 'intersection object'],
    ] as const) {
      if (g === undefined) continue;
      if (!Array.isArray(g) || g.length !== 1) {
        out.push(
          `${where}: ${name} is not one entity (a path into a block reference is not written yet)`,
        );
        continue;
      }
      if (xref?.length) out.push(`${where}: ${name} in an xref (xref paths are not written yet)`);
      const h = g[0]!;
      const e = model.entityByHandle(h);
      if (!e) {
        // An erased one is reported once, above.
        if (!erasedBefore.has(h))
          out.push(`${where}: ${name} ${h} is not an entity of the drawing`);
        continue;
      }
      if (dim && (e.owner === dim.owner) === a.transSpace) {
        out.push(
          a.transSpace
            ? `${where}: ${name} ${h} is in the dimension's own space, on a trans-space DIMASSOC`
            : `${where}: ${name} ${h} is in another block`,
        );
      }
      if (!(e.reactors ?? []).includes(a.handle)) {
        out.push(`${where}: ${name} ${h} does not point back at it (reactors)`);
      }
    }
  });
  // AutoCAD takes the DIMASSOC off the reactors of geometry no point keeps to any more.
  const now = new Set(dimAssocGeometry(a));
  for (const h of new Set(dimAssocGeometry(b))) {
    if (!now.has(h) && (model.entityByHandle(h)?.reactors ?? []).includes(a.handle)) {
      out.push(`its old geometry ${h} still points at it (reactors)`);
    }
  }
  return out;
}

/** An acad-ts point reference for `p` (every object it names exists by now). */
function osnapRef(r: Resolver, p: DimAssocPoint): OsnapPointRef {
  const o = new OsnapPointRef();
  const objects = (hs: readonly Handle[]): CadObject[] => hs.map((h) => resolve(r, h, CadObject)!);
  o.objectOsnapType = p.osnap;
  o.geometryPath = objects(p.geometry);
  o.geometry = o.geometryPath[0] ?? null;
  o.subentType = p.subentType;
  o.gsMarker = p.gsMarker;
  o.xrefPaths = [...p.xrefPaths];
  o.geometryParameter = p.parameter;
  o.osnapPoint = new XYZ(p.point.x, p.point.y, p.point.z);
  if (p.intersection) {
    o.intersectionGeometry = objects(p.intersection.geometry);
    o.intersectionSubType = p.intersection.subentType;
    o.intersectionGsMarker = p.intersection.gsMarker;
    o.intersectionXrefPaths = [...p.intersection.xrefPaths];
  }
  if (p.last) {
    o.hasLastPointRef = true;
    o.lastPointRef = osnapRef(r, p.last);
  }
  return o;
}

type PointRefKey = 'firstPointRef' | 'secondPointRef' | 'thirdPointRef' | 'fourthPointRef';
const KEYS: readonly PointRefKey[] = [
  'firstPointRef',
  'secondPointRef',
  'thirdPointRef',
  'fourthPointRef',
];

/**
 * Writes the planned DIMASSOC changes, after the entities (a new one names a dimension and
 * geometry the same save may add). Removed ones leave their dimension's dictionary, which stays.
 */
export function writeDimAssocs(r: Resolver, plan: DimAssocsPlan): void {
  for (const acad of plan.removed) {
    const dict = acad.owner as CadDictionary;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === acad);
    if (key !== undefined) dict.remove(key);
  }
  const fill = (
    acad: DimensionAssociationObject,
    before: DimAssoc | undefined,
    after: DimAssoc,
  ): void => {
    if (!before || before.transSpace !== after.transSpace) acad.isTransSpace = after.transSpace;
    if (!before || before.rotatedType !== after.rotatedType)
      acad.rotatedDimensionType = after.rotatedType;
    let flags = 0;
    after.points.forEach((p, i) => {
      if (p) flags |= BITS[i]!;
      if (before && same(points(before)[i] ?? null, p)) return;
      acad[KEYS[i]!] = p ? osnapRef(r, p) : null;
    });
    acad.associativityFlags = flags as AssociativityFlags;
  };
  for (const { acad, before, after } of plan.updated) fill(acad, before, after);
  for (const { acad, after, dictionary } of plan.added) {
    const dim = resolve(r, after.dimension, AcadEntity)!;
    let dict = dictionary;
    if (typeof dict === 'number') {
      // As AutoCAD makes an extension dictionary: hard owner (280 = 1), keep existing (281 = 1).
      const d = new CadDictionary();
      d.handle = dict;
      d.hardOwnerFlag = true;
      d.clonningFlags = DictionaryCloningFlags.KeepExisting;
      dim.xDictionary = d;
      dict = d;
    }
    acad.dimension = dim as never;
    dict.addByKey(DIMASSOC_ENTRY, acad);
    if (after.reactors?.length) acad.addReactor(dict);
    fill(acad, undefined, after);
  }
}
