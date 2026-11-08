// TriyaToAcad for XCLIP (SPATIAL_FILTER objects, M1-75 part 40), the inverse of map/xclip.ts.
// AutoCAD keeps a block reference's clip as the `SPATIAL` entry of an `ACAD_FILTER` dictionary
// in the INSERT's extension dictionary; the filter lists that dictionary as its reactor, and the
// ACAD_FILTER dictionary the extension dictionary, both hard-owning with "keep existing" cloning
// (DXF 280 = 1, 281 = 1), as every corpus clip shows. XCLIP ON / OFF and Clipdepth edit the
// filter, New boundary gives it a new boundary and the insert transform it was drawn under, a
// first clip of a reference makes the filter (and the dictionaries it needs: the reference's
// extension dictionary when it has none, which the model states as the INSERT's new `extDict`,
// and the ACAD_FILTER dictionary, which the model states as the filter's `owner`), and Delete
// removes it. A reference that is erased takes its dictionary, and so its filter, with it.
//
// AutoCAD does not document whether XCLIP Delete also removes an emptied ACAD_FILTER dictionary;
// the save keeps it (an empty dictionary is valid either way), and a later clip goes back in it.
//
// Refused, before anything changes: a filter before R14 (AutoCAD Release 14 introduced XCLIP),
// one not in its INSERT's ACAD_FILTER dictionary, on something other than a single block
// reference (a MINSERT: AutoCAD documents XCLIP for block references and xrefs only), a second
// filter on one reference, a filter left behind by its erased reference, a changed INSERT or
// owner, xdata, reactor and extension dictionary changes, a new boundary on a filter with an
// extension dictionary (AutoCAD keeps an inverted clip's inner boundary there, in an
// ACAD_XREC_ROUNDTRIP record the save does not map), and values AutoCAD cannot hold (a boundary
// that encloses nothing, matrices that are not 12 finite numbers, an inverse that is singular).

import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Insert,
  Matrix4,
  SpatialFilter as AcadSpatialFilter,
  XY,
  XYZ,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  clipBoundary,
  type DocumentInit,
  type DocumentModel,
  type Entity,
  type EntityInit,
  type Handle,
  type Matrix3x4,
  type NonGraphicalObject,
  type SpatialFilter,
} from '@triya/engine';
import { resolve, same, type Resolver } from './entities';

/** The extension dictionary entry AutoCAD keeps a reference's filters under, and the clip's. */
export const ACAD_FILTER = 'ACAD_FILTER';
export const SPATIAL = 'SPATIAL';

const isFilter = (o: NonGraphicalObject | undefined): o is SpatialFilter =>
  o?.type === 'SPATIAL_FILTER';

/** The fields that make up the clip's shape: a filter with an extension dictionary keeps them. */
const SHAPE = ['boundary', 'normal', 'origin', 'inverseInsert', 'boundaryTransform'] as const;

export interface SpatialFiltersPlan {
  readonly updated: {
    readonly acad: AcadSpatialFilter;
    readonly before: SpatialFilter;
    readonly after: SpatialFilter;
  }[];
  /**
   * New filters, already holding their handle; a dictionary is a handle when the save makes it
   * (`xdict` the reference's extension dictionary, `dictionary` its ACAD_FILTER).
   */
  readonly added: {
    readonly acad: AcadSpatialFilter;
    readonly after: SpatialFilter;
    readonly xdict: CadDictionary | number;
    readonly dictionary: CadDictionary | number;
  }[];
  /** Removed ones whose reference stays (an erased reference's go with its dictionary). */
  readonly removed: AcadSpatialFilter[];
}

/** The engine handles of the extension dictionaries the save makes for new filters' references. */
export function newSpatialFilterDictionaries(plan: SpatialFiltersPlan): Map<Handle, Handle> {
  const out = new Map<Handle, Handle>();
  for (const { after, xdict } of plan.added) {
    if (typeof xdict === 'number') out.set(after.insert, xdict.toString(16).toUpperCase());
  }
  return out;
}

/** The model's XCLIP changes against the original's mapping, and why any cannot be written. */
export function planSpatialFilters(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: SpatialFiltersPlan; problems: string[] } {
  const plan: SpatialFiltersPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const version = doc.header?.version;
  const baseObjects = new Map((base.objects ?? []).map((o) => [o.handle, o]));
  const baseEntities = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  // Filters that leave their dictionary in this save: a new clip may take their place.
  const leaving = new Set<CadObject>();

  for (const b of baseObjects.values()) {
    if (!isFilter(b) || model.objects.has(b.handle)) continue;
    if (!model.entityByHandle(b.insert)) continue; // its dictionary goes with the reference
    const acad = resolve(r, b.handle, AcadSpatialFilter);
    if (!acad || !(acad.owner instanceof CadDictionary)) {
      problems.push(`SPATIAL_FILTER ${b.handle}: the original is not a filter in a dictionary`);
    } else {
      plan.removed.push(acad);
      leaving.add(acad);
    }
  }

  const clipped = new Set<Handle>();
  for (const a of model.objects.values()) {
    if (!isFilter(a)) continue;
    const h = a.handle;
    const b = baseObjects.get(h);
    if (b && !isFilter(b)) continue; // another object's type change, refused with it
    const insert = model.entityByHandle(a.insert);
    const out: string[] = [];
    if (!insert) {
      out.push(
        baseEntities.has(a.insert)
          ? `still clips the erased INSERT ${a.insert}`
          : `INSERT ${a.insert} is not an entity of the drawing`,
      );
    }
    if (b && same(b, a)) {
      problems.push(...out.map((p) => `SPATIAL_FILTER ${h}: ${p}`));
      continue;
    }
    let acad: AcadSpatialFilter | undefined;
    let xdict: CadDictionary | number | undefined;
    let dictionary: CadDictionary | number | undefined;
    if (b) {
      acad = resolve(r, h, AcadSpatialFilter);
      if (!acad) out.push('the original is not a SPATIAL_FILTER');
      if (b.owner !== a.owner) out.push('owner changes');
      if (b.insert !== a.insert) out.push('its INSERT changes');
      for (const k of ['xdata', 'reactors', 'extDict'] as const) {
        if (!same(b[k], a[k])) out.push(`${k} changes`);
      }
      if (b.extDict !== undefined && SHAPE.some((k) => !same(b[k], a[k]))) {
        out.push(
          "a new boundary on a clip with an extension dictionary (an inverted clip's ACAD_XREC_ROUNDTRIP record would go stale)",
        );
      }
    } else {
      // AutoCAD Release 14 introduced XCLIP (and the SPATIAL_FILTER object).
      if (
        version !== undefined &&
        version !== ACadVersion.Unknown &&
        version < ACadVersion.AC1014
      ) {
        out.push(`${ACadVersion[version]} has no XCLIP (Release 14 added it)`);
      }
      if (doc.getCadObject(Number.parseInt(h, 16))) out.push('the handle is already used');
      if (a.xdata !== undefined || a.extDict !== undefined)
        out.push('xdata or an extension dictionary');
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) {
        out.push('its reactors can only be its dictionary');
      }
      if (insert) {
        if (clipped.has(insert.handle)) out.push(`INSERT ${insert.handle} has another new clip`);
        clipped.add(insert.handle);
        const where = placement(doc, r, baseEntities.get(insert.handle), insert, a, leaving);
        out.push(...where.problems);
        xdict = where.xdict;
        dictionary = where.dictionary;
      }
    }
    if (insert) out.push(...referenceProblems(insert));
    out.push(...valueProblems(b, a));
    if (out.length > 0) {
      problems.push(...out.map((p) => `SPATIAL_FILTER ${h}: ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      acad = new AcadSpatialFilter();
      // acad-ts keeps a non-zero handle it has not seen, so the filter keeps Triya's handle.
      acad.handle = Number.parseInt(h, 16);
      r.created.set(h, acad);
      plan.added.push({ acad, after: a, xdict: xdict!, dictionary: dictionary! });
    }
  }
  return { plan, problems };
}

/** What XCLIP takes: a single block reference (DXF INSERT without MINSERT's rows and columns). */
function referenceProblems(insert: Entity): string[] {
  if (insert.geom.kind !== 'INSERT')
    return [`${insert.handle} is a ${insert.type}, not a block reference`];
  const array = insert.geom.array;
  if (array && (array.columns > 1 || array.rows > 1)) {
    return [`${insert.handle} is a MINSERT (XCLIP clips single references)`];
  }
  return [];
}

/**
 * Where a new filter goes: the reference's extension dictionary (its own, or one the save makes
 * when the model gives the reference a new one) and the ACAD_FILTER dictionary in it (the one
 * there, or one the save makes under the filter's `owner`).
 */
function placement(
  doc: CadDocument,
  r: Resolver,
  was: EntityInit | undefined,
  insert: Entity,
  a: SpatialFilter,
  leaving: ReadonlySet<CadObject>,
): {
  problems: string[];
  xdict?: CadDictionary | number;
  dictionary?: CadDictionary | number;
} {
  const misplaced = `it must be the ${SPATIAL} entry of an ${ACAD_FILTER} dictionary in INSERT ${insert.handle}'s extension dictionary${insert.extDict ? ` ${insert.extDict}` : ''}`;
  const unused = (h: Handle): boolean => !doc.getCadObject(Number.parseInt(h, 16));
  if (insert.extDict === undefined) return { problems: [misplaced] };
  if (was?.extDict === insert.extDict) {
    const xdict = resolve(r, insert.extDict, CadDictionary);
    if (!xdict)
      return { problems: [`extension dictionary ${insert.extDict} is not in the drawing`] };
    const key = xdict.entryNames.find((k) => k.toUpperCase() === ACAD_FILTER);
    const there = key === undefined ? undefined : xdict.getEntry(key);
    if (there === undefined) {
      if (a.owner === insert.extDict || !unused(a.owner)) return { problems: [misplaced] };
      return { problems: [], xdict, dictionary: Number.parseInt(a.owner, 16) };
    }
    if (!(there instanceof CadDictionary) || there.handle !== Number.parseInt(a.owner, 16)) {
      return { problems: [misplaced] };
    }
    const spatial = there.entryNames.find((k) => k.toUpperCase() === SPATIAL);
    const old = spatial === undefined ? undefined : there.getEntry(spatial);
    if (old && !leaving.has(old)) {
      return { problems: [`INSERT ${insert.handle} already has a ${SPATIAL} entry`] };
    }
    return { problems: [], xdict, dictionary: there };
  }
  if (was?.extDict !== undefined) {
    return { problems: [`INSERT ${insert.handle} changes its extension dictionary`] };
  }
  const out: string[] = [];
  if (!unused(insert.extDict)) {
    out.push(`the extension dictionary's handle ${insert.extDict} is already used`);
  }
  if (a.owner === insert.extDict) out.push(misplaced);
  else if (!unused(a.owner))
    out.push(`the ${ACAD_FILTER} dictionary's handle ${a.owner} is already used`);
  return {
    problems: out,
    xdict: Number.parseInt(insert.extDict, 16),
    dictionary: Number.parseInt(a.owner, 16),
  };
}

const finite = (...xs: unknown[]): boolean => xs.every((x) => Number.isFinite(x));

/** A 3×4 matrix of 12 finite numbers. */
const isMatrix = (m: unknown): m is Matrix3x4 =>
  Array.isArray(m) && m.length === 12 && m.every((x) => Number.isFinite(x));

/** The determinant of a 3×4's linear part. */
const det = (m: Matrix3x4): number =>
  m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
  m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) +
  m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);

/** Why the values that changed (all, for a new filter) cannot be written. */
function valueProblems(b: SpatialFilter | undefined, a: SpatialFilter): string[] {
  const out: string[] = [];
  const changed = (k: keyof SpatialFilter): boolean => !b || !same(b[k], a[k]);
  if (changed('boundary')) {
    const points = Array.isArray(a.boundary) ? a.boundary : [];
    if (!points.every((p) => finite(p?.x, p?.y))) out.push('boundary: a point that is not finite');
    else if (!clipBoundary(a)) out.push('boundary: encloses nothing');
  }
  for (const k of ['normal', 'origin'] as const) {
    const v = a[k];
    if (changed(k) && !finite(v?.x, v?.y, v?.z)) out.push(`${k}: not a finite point`);
  }
  if (changed('normal') && finite(a.normal?.x, a.normal?.y, a.normal?.z)) {
    if (Math.hypot(a.normal.x, a.normal.y, a.normal.z) === 0) out.push('normal: zero length');
  }
  if (changed('enabled') && typeof a.enabled !== 'boolean')
    out.push(`enabled: ${JSON.stringify(a.enabled)} is not true or false`);
  for (const k of ['frontClip', 'backClip'] as const) {
    if (changed(k) && a[k] !== undefined && !finite(a[k])) out.push(`${k}: not a finite number`);
  }
  for (const k of ['inverseInsert', 'boundaryTransform'] as const) {
    if (!changed(k)) continue;
    if (!isMatrix(a[k])) out.push(`${k}: not 12 finite numbers`);
    else if (k === 'inverseInsert' && det(a[k]) === 0) out.push(`${k}: not invertible`);
  }
  return out;
}

const matrix = (m: Matrix3x4): Matrix4 => new Matrix4([...m, 0, 0, 0, 1]);

/** Writes the fields that differ from `before` (all of them for a new filter). */
function fill(
  acad: AcadSpatialFilter,
  before: SpatialFilter | undefined,
  after: SpatialFilter,
): void {
  const d = (k: keyof SpatialFilter): boolean => !before || !same(before[k], after[k]);
  if (d('boundary')) acad.boundaryPoints = after.boundary.map((p) => new XY(p.x, p.y));
  if (d('normal')) acad.normal = new XYZ(after.normal.x, after.normal.y, after.normal.z);
  if (d('origin')) acad.origin = new XYZ(after.origin.x, after.origin.y, after.origin.z);
  if (d('enabled')) acad.displayBoundary = after.enabled;
  if (d('frontClip')) {
    acad.clipFrontPlane = after.frontClip !== undefined;
    acad.frontDistance = after.frontClip ?? 0;
  }
  if (d('backClip')) {
    acad.clipBackPlane = after.backClip !== undefined;
    acad.backDistance = after.backClip ?? 0;
  }
  if (d('inverseInsert')) acad.inverseInsertTransform = matrix(after.inverseInsert);
  if (d('boundaryTransform')) acad.insertTransform = matrix(after.boundaryTransform);
}

/** A dictionary as AutoCAD makes the XCLIP ones: hard owner (280 = 1), keep existing (281 = 1). */
function dictionary(handle: number): CadDictionary {
  const d = new CadDictionary();
  d.handle = handle;
  d.hardOwnerFlag = true;
  d.clonningFlags = DictionaryCloningFlags.KeepExisting;
  return d;
}

/**
 * Writes the planned XCLIP changes, after the entities (a new clip may be on a reference the same
 * save adds, as COPY of a clipped reference makes). Removed filters leave their dictionary first,
 * so a new one can take their place.
 */
export function writeSpatialFilters(r: Resolver, plan: SpatialFiltersPlan): void {
  for (const acad of plan.removed) {
    const dict = acad.owner as CadDictionary;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === acad);
    if (key !== undefined) dict.remove(key);
  }
  for (const { acad, before, after } of plan.updated) fill(acad, before, after);
  for (const { acad, after, xdict, dictionary: filters } of plan.added) {
    const insert = resolve(r, after.insert, Insert)!;
    let x = xdict;
    if (typeof x === 'number') {
      x = dictionary(x);
      insert.xDictionary = x;
    }
    let d = filters;
    if (typeof d === 'number') {
      d = dictionary(d);
      x.addByKey(ACAD_FILTER, d);
      d.addReactor(x);
    }
    d.addByKey(SPATIAL, acad);
    if (after.reactors?.length) acad.addReactor(d);
    fill(acad, undefined, after);
  }
}
