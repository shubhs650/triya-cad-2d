// TriyaToAcad for dimension breaks and inspection data (M4-02 part 4, DEC-064), the inverse of
// map/triya-dims.ts: each record is a `TRIYA_DIMBREAK` or `TRIYA_DIMINSPECT` XRECORD in its
// dimension's extension dictionary. A dimension without one gets the dictionary the model names
// as its `extDict` (hard owner, 280 = 1, 281 = 1, as AutoCAD makes an object's extension
// dictionary); one read with a dictionary (a DIMASSOC's) gets the record added to it. DIMBREAK
// and DIMINSPECT rewrite a record's groups; Remove takes it out of the dictionary, which stays;
// an erased dimension takes its dictionary, and so its records, with it. A breaking object that
// is gone is left out of the record, so no group names a handle the file does not hold. A
// leader's and a multileader's breaks (M4-15, DEC-065) are written the same way, in theirs.
//
// Refused, before anything changes: a record whose dimension is not a dimension of the drawing or
// does not name its dictionary, one that moves to another dimension or dictionary, a new record
// under a key the dictionary already holds, a handle in use, and a version before R2000 (the save
// writes AC1032, DEC-047).
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Entity as AcadEntity,
  XRecord,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  isDimBreak,
  isDimInspect,
  type DimBreak,
  type DimInspect,
  type DocumentInit,
  type DocumentModel,
  type Handle,
  type Vec2,
} from '@triya/engine';
import {
  INSPECTION_SHAPES,
  TRIYA_DIMBREAK,
  TRIYA_DIMINSPECT,
  TRIYA_DIMS_VERSION,
} from '../map/triya-dims';
import { resolve, same, type Resolver } from './entities';

type DimRecord = DimBreak | DimInspect;

const isRecord = (o: { type: string } | undefined): o is DimRecord =>
  isDimBreak(o as DimRecord) || isDimInspect(o as DimRecord);

const DIMENSION_KINDS = new Set(['DIMENSION', 'LARGE_RADIAL_DIMENSION', 'ARC_DIMENSION']);
/** What else DIMBREAK breaks (M4-15): inspection data is a dimension's only. */
const LEADER_KINDS = new Set(['LEADER', 'MULTILEADER']);

export interface TriyaDimsPlan {
  readonly updated: { readonly acad: XRecord; readonly after: DimRecord }[];
  /** New records; `dictionary` is a handle when the save makes the dimension's dictionary. */
  readonly added: { readonly after: DimRecord; readonly dictionary: CadDictionary | number }[];
  /** Records that go while their dimension stays. */
  readonly removed: XRecord[];
}

/** The dimensions whose new extension dictionary the plan makes, by dimension. */
export function newTriyaDimDictionaries(plan: TriyaDimsPlan): Map<Handle, Handle> {
  const out = new Map<Handle, Handle>();
  for (const { after, dictionary } of plan.added) {
    if (typeof dictionary === 'number') out.set(after.dimension, after.owner);
  }
  return out;
}

const keyOf = (r: DimRecord): string => (isDimBreak(r) ? TRIYA_DIMBREAK : TRIYA_DIMINSPECT);
const handle = (h: Handle): number => Number.parseInt(h, 16);

export function planTriyaDims(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: TriyaDimsPlan; problems: string[] } {
  const plan: TriyaDimsPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isRecord).map((o) => [o.handle, o]));
  const baseEntities = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  for (const [h, b] of before) {
    if (model.objects.has(h) || !model.entityByHandle(b.dimension)) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) plan.removed.push(acad);
    else problems.push(`${b.type} ${h}: the original is not an XRECORD`);
  }
  for (const a of model.objects.values()) {
    if (!isRecord(a)) continue;
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    const dim = model.entityByHandle(a.dimension);
    const holder =
      dim &&
      (DIMENSION_KINDS.has(dim.geom.kind) || (isDimBreak(a) && LEADER_KINDS.has(dim.geom.kind)));
    if (!holder) {
      out.push(`dimension ${a.dimension} is not in the drawing`);
    } else if (dim.extDict !== a.owner) {
      out.push(`dimension ${a.dimension}'s extension dictionary is not ${a.owner}`);
    }
    if (isDimInspect(a) && !INSPECTION_SHAPES.includes(a.shape)) out.push(`shape ${a.shape}`);
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (b) {
      for (const k of ['owner', 'dimension', 'type'] as const) {
        if (b[k] !== a[k]) out.push(`its ${k} changes`);
      }
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) plan.updated.push({ acad: acad!, after: a });
    } else if (dim && out.length === 0) {
      if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
      const was = baseEntities.get(a.dimension);
      let dictionary: CadDictionary | number | undefined;
      if (was?.extDict === a.owner) {
        dictionary = resolve(r, a.owner, CadDictionary);
        if (!dictionary) out.push(`extension dictionary ${a.owner} is not in the drawing`);
        else if (dictionary.entryNames.some((k) => k.toUpperCase() === keyOf(a))) {
          out.push(`dimension ${a.dimension} already has a ${keyOf(a)} entry`);
        }
      } else if (was?.extDict !== undefined) {
        out.push(`dimension ${a.dimension} changes its extension dictionary`);
      } else if (doc.getCadObject(handle(a.owner))) {
        out.push(`dictionary ${a.owner}: the handle is already used`);
      } else dictionary = handle(a.owner);
      if (out.length === 0) plan.added.push({ after: a, dictionary: dictionary! });
    }
    problems.push(...out.map((p) => `${a.type} ${a.handle}: ${p}`));
  }
  return { plan, problems };
}

const xyz = (p: Vec2): XYZ => new XYZ(p.x, p.y, 0);

/** The record's groups, as map/triya-dims.ts reads them. */
function fill(x: XRecord, a: DimRecord, doc: CadDocument): void {
  x.clear();
  x.createEntry(70, TRIYA_DIMS_VERSION);
  if (isDimBreak(a)) {
    for (const h of a.objects) {
      // An object erased since stays in the model's record (undo brings it back) but not here.
      if (doc.getCadObject(handle(h))) x.createEntry(331, handle(h));
    }
    for (const [p, q] of a.manual) {
      x.createEntry(10, xyz(p));
      x.createEntry(11, xyz(q));
    }
    return;
  }
  x.createEntry(71, INSPECTION_SHAPES.indexOf(a.shape));
  if (a.label !== undefined) x.createEntry(1, a.label);
  if (a.rate !== undefined) x.createEntry(3, a.rate);
}

/** Writes the plan, after the entities: a new record may be on a dimension the save adds. */
export function writeTriyaDims(doc: CadDocument, r: Resolver, plan: TriyaDimsPlan): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  for (const { acad, after } of plan.updated) fill(acad, after, doc);
  // The records of one dimension share the dictionary the save makes for it.
  const made = new Map<number, CadDictionary>();
  const join: [AcadEntity, CadDictionary][] = [];
  for (const { after, dictionary } of plan.added) {
    const x = new XRecord();
    x.handle = handle(after.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, after, doc);
    let dict: CadDictionary;
    if (typeof dictionary === 'number') {
      let d = made.get(dictionary);
      if (!d) {
        d = new CadDictionary();
        d.handle = dictionary;
        d.hardOwnerFlag = true;
        d.clonningFlags = DictionaryCloningFlags.KeepExisting;
        made.set(dictionary, d);
        join.push([resolve(r, after.dimension, AcadEntity)!, d]);
      }
      dict = d;
    } else dict = dictionary;
    dict.addByKey(keyOf(after), x);
  }
  // Joining the dimension last registers the dictionary and its records with the drawing.
  for (const [dim, dict] of join) if (dim.xDictionary !== dict) dim.xDictionary = dict;
}
