// TriyaToAcad for associative arrays Triya made (M3-11, DEC-059), the inverse of
// map/triya-array.ts: each array's record is the `TRIYA_ARRAY` XRECORD in its INSERT's extension
// dictionary. A new array (ARRAY with Associative Yes, a COPY of one) gets the record and, as its
// INSERT is new too, the extension dictionary the model names as the INSERT's `extDict` (hard
// owner, 280 = 1, 281 = 1, as AutoCAD makes an object's extension dictionary); ARRAYEDIT rewrites
// the record's groups; an erased array takes its dictionary, and so its record, with it.
//
// Refused, before anything changes: a record whose INSERT is not an entity of the drawing or does
// not name its dictionary, a record that moves to another INSERT, dictionary or source block, a
// new record on an INSERT the drawing already has (Triya makes arrays only as new INSERTs), a
// handle in use, and a version before R2000 (the save writes AC1032, DEC-047).
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Insert,
  XRecord,
  XYZ,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  isAssocArray,
  type AssocArray,
  type DocumentInit,
  type DocumentModel,
  type Handle,
  type Vec2,
} from '@triya/engine';
import { TRIYA_ARRAY, TRIYA_ARRAY_VERSION } from '../map/triya-array';
import { resolve, same, type Resolver } from './entities';

export interface TriyaArraysPlan {
  readonly updated: { readonly acad: XRecord; readonly after: AssocArray }[];
  /** New records; `dictionary` is a handle when the save makes the INSERT's dictionary. */
  readonly added: { readonly after: AssocArray; readonly dictionary: CadDictionary | number }[];
  /** Records that go while their INSERT stays. */
  readonly removed: XRecord[];
}

/** The INSERTs whose new extension dictionary the plan makes, by INSERT. */
export function newTriyaArrayDictionaries(plan: TriyaArraysPlan): Map<Handle, Handle> {
  const out = new Map<Handle, Handle>();
  for (const { after, dictionary } of plan.added) {
    if (typeof dictionary === 'number') out.set(after.insert, after.owner);
  }
  return out;
}

const unused = (doc: CadDocument, h: Handle): boolean => !doc.getCadObject(Number.parseInt(h, 16));

export function planTriyaArrays(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: TriyaArraysPlan; problems: string[] } {
  const plan: TriyaArraysPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isAssocArray).map((o) => [o.handle, o]));
  const baseEntities = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  for (const [h, b] of before) {
    if (model.objects.has(h) || !model.entityByHandle(b.insert)) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) plan.removed.push(acad);
    else problems.push(`TRIYA_ARRAY ${h}: the original is not an XRECORD`);
  }
  for (const a of model.objects.values()) {
    if (!isAssocArray(a)) continue;
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    const insert = model.entityByHandle(a.insert);
    if (!insert || insert.geom.kind !== 'INSERT')
      out.push(`INSERT ${a.insert} is not in the drawing`);
    else if (insert.extDict !== a.owner) {
      out.push(`INSERT ${a.insert}'s extension dictionary is not ${a.owner}`);
    }
    if (!model.blocks.has(a.source)) out.push(`source block ${a.source} is not in the drawing`);
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (b) {
      for (const k of ['owner', 'insert', 'source'] as const) {
        if (b[k] !== a[k]) out.push(`its ${k} changes`);
      }
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) plan.updated.push({ acad: acad!, after: a });
    } else {
      if (!unused(doc, a.handle)) out.push('the handle is already used');
      const was = baseEntities.get(a.insert);
      if (was) out.push(`INSERT ${a.insert} is not new (Triya makes arrays as new INSERTs)`);
      else if (!unused(doc, a.owner)) out.push(`dictionary ${a.owner}: the handle is already used`);
      if (out.length === 0) {
        plan.added.push({ after: a, dictionary: Number.parseInt(a.owner, 16) });
      }
    }
    problems.push(...out.map((p) => `TRIYA_ARRAY ${a.handle}: ${p}`));
  }
  return { plan, problems };
}

const xyz = (p: Vec2): XYZ => new XYZ(p.x, p.y, 0);
const handle = (h: Handle): number => Number.parseInt(h, 16);

/** The record's groups, as map/triya-array.ts reads them. */
function fill(x: XRecord, a: AssocArray): void {
  x.clear();
  x.createEntry(70, TRIYA_ARRAY_VERSION);
  const p = a.params;
  x.createEntry(71, p.kind === 'rectangular' ? 0 : p.kind === 'polar' ? 1 : 2);
  x.createEntry(340, handle(a.source));
  switch (p.kind) {
    case 'rectangular':
      x.createEntry(90, p.columns);
      x.createEntry(91, p.rows);
      x.createEntry(40, p.columnSpacing);
      x.createEntry(41, p.rowSpacing);
      break;
    case 'polar':
      x.createEntry(10, xyz(p.center));
      x.createEntry(11, xyz(p.base));
      x.createEntry(90, p.items);
      x.createEntry(91, p.rows);
      x.createEntry(50, (p.fillAngle * 180) / Math.PI);
      x.createEntry(41, p.rowSpacing);
      x.createEntry(290, p.rotateItems);
      break;
    case 'path':
      if (p.path !== undefined) x.createEntry(331, handle(p.path));
      x.createEntry(72, p.method === 'divide' ? 0 : 1);
      x.createEntry(11, xyz(p.base));
      x.createEntry(12, xyz(p.tangent));
      x.createEntry(40, p.spacing);
      x.createEntry(90, p.items);
      x.createEntry(91, p.rows);
      x.createEntry(41, p.rowSpacing);
      x.createEntry(290, p.align);
      x.createEntry(291, p.reversed);
      break;
  }
}

/** Writes the plan, after the entities: a new record is on an INSERT the same save adds. */
export function writeTriyaArrays(r: Resolver, plan: TriyaArraysPlan): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  for (const { acad, after } of plan.updated) fill(acad, after);
  for (const { after, dictionary } of plan.added) {
    const insert = resolve(r, after.insert, Insert)!;
    const x = new XRecord();
    x.handle = handle(after.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, after);
    let dict = dictionary;
    if (typeof dict === 'number') {
      const d = new CadDictionary();
      d.handle = dict;
      d.hardOwnerFlag = true;
      d.clonningFlags = DictionaryCloningFlags.KeepExisting;
      dict = d;
    }
    dict.addByKey(TRIYA_ARRAY, x);
    // Joining the INSERT last registers the dictionary and its record with the drawing.
    if (insert.xDictionary !== dict) insert.xDictionary = dict;
  }
}
