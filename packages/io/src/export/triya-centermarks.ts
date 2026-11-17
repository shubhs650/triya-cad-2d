// TriyaToAcad for center marks and centerlines Triya made (M4-08 part 2, DEC-066), the inverse of
// map/triya-centermarks.ts: each mark's record is the `TRIYA_CENTERMARK` XRECORD in its INSERT's
// extension dictionary. A new mark (CENTERMARK, CENTERLINE, a COPY of one with its objects) gets
// the record and, as its INSERT is new too, the extension dictionary the model names as the
// INSERT's `extDict` (hard owner, 280 = 1, 281 = 1, as AutoCAD makes an object's extension
// dictionary). A mark whose objects changed has its record rewritten; one that lets go of them
// (moved on its own) loses the record and keeps the dictionary, empty; an erased mark takes its
// dictionary, and so its record, with it. A new mark let go of in the same session is saved with
// its dictionary empty.
//
// Refused, before anything changes: a record whose INSERT is not an entity of the drawing or does
// not name its dictionary, one that moves to another INSERT or dictionary, a new record on an
// INSERT the drawing already has (Triya makes marks only as new INSERTs), a handle in use, and a
// version before R2000 (the save writes AC1032, DEC-047).
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Insert,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  isCenterMark,
  type CenterMark,
  type DocumentInit,
  type DocumentModel,
  type Handle,
} from '@triya/engine';
import {
  CENTER_MARK_KINDS,
  TRIYA_CENTERMARK,
  TRIYA_CENTERMARK_VERSION,
} from '../map/triya-centermarks';
import { resolve, same, type Resolver } from './entities';

export interface TriyaCenterMarksPlan {
  readonly updated: { readonly acad: XRecord; readonly after: CenterMark }[];
  /** New records, each with the new dictionary the save makes for its new INSERT. */
  readonly added: { readonly after: CenterMark; readonly dictionary: number }[];
  /** Records that go while their INSERT stays. */
  readonly removed: XRecord[];
  /** New INSERTs whose dictionary holds no record (a new mark let go of): made empty. */
  readonly empty: { readonly insert: Handle; readonly dictionary: number }[];
}

const handle = (h: Handle): number => Number.parseInt(h, 16);
const unused = (doc: CadDocument, h: Handle): boolean => !doc.getCadObject(handle(h));

/** The INSERTs whose new extension dictionary the plan makes, by INSERT. */
export function newTriyaCenterMarkDictionaries(plan: TriyaCenterMarksPlan): Map<Handle, Handle> {
  const out = new Map<Handle, Handle>();
  for (const { after } of plan.added) out.set(after.insert, after.owner);
  for (const { insert, dictionary } of plan.empty)
    out.set(insert, dictionary.toString(16).toUpperCase());
  return out;
}

export function planTriyaCenterMarks(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: TriyaCenterMarksPlan; problems: string[] } {
  const plan: TriyaCenterMarksPlan = { updated: [], added: [], removed: [], empty: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isCenterMark).map((o) => [o.handle, o]));
  const baseEntities = new Map((base.entities ?? []).map((e) => [e.handle, e]));
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  for (const [h, b] of before) {
    if (model.objects.has(h) || !model.entityByHandle(b.insert)) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) plan.removed.push(acad);
    else problems.push(`TRIYA_CENTERMARK ${h}: the original is not an XRECORD`);
  }
  const owners = new Set<Handle>();
  for (const o of model.objects.values()) owners.add(o.owner);
  for (const a of model.objects.values()) {
    if (!isCenterMark(a)) continue;
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    const insert = model.entityByHandle(a.insert);
    if (!insert || insert.geom.kind !== 'INSERT') {
      out.push(`INSERT ${a.insert} is not in the drawing`);
    } else if (insert.extDict !== a.owner) {
      out.push(`INSERT ${a.insert}'s extension dictionary is not ${a.owner}`);
    }
    if (!CENTER_MARK_KINDS.includes(a.kind)) out.push(`kind ${a.kind}`);
    if (a.objects.length !== (a.kind === 'mark' ? 1 : 2)) {
      out.push(`${a.objects.length} objects for a ${a.kind}`);
    }
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (b) {
      for (const k of ['owner', 'insert'] as const) {
        if (b[k] !== a[k]) out.push(`its ${k} changes`);
      }
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) plan.updated.push({ acad: acad!, after: a });
    } else {
      if (!unused(doc, a.handle)) out.push('the handle is already used');
      if (baseEntities.has(a.insert)) {
        out.push(`INSERT ${a.insert} is not new (Triya makes marks as new INSERTs)`);
      } else if (!unused(doc, a.owner))
        out.push(`dictionary ${a.owner}: the handle is already used`);
      if (out.length === 0) plan.added.push({ after: a, dictionary: handle(a.owner) });
    }
    problems.push(...out.map((p) => `TRIYA_CENTERMARK ${a.handle}: ${p}`));
  }
  // A new mark let go of in the session it was made keeps its dictionary with nothing in it.
  for (const e of model.entities()) {
    if (e.geom.kind !== 'INSERT' || e.extDict === undefined || baseEntities.has(e.handle)) continue;
    if (owners.has(e.extDict) || !unused(doc, e.extDict)) continue;
    plan.empty.push({ insert: e.handle, dictionary: handle(e.extDict) });
  }
  return { plan, problems };
}

/** The record's groups, as map/triya-centermarks.ts reads them. */
function fill(x: XRecord, a: CenterMark, doc: CadDocument): void {
  x.clear();
  x.createEntry(70, TRIYA_CENTERMARK_VERSION);
  x.createEntry(71, CENTER_MARK_KINDS.indexOf(a.kind));
  for (const h of a.objects) {
    // The engine erases a mark with its objects, so each is in the drawing.
    if (doc.getCadObject(handle(h))) x.createEntry(331, handle(h));
  }
  if (a.kind === 'mark') {
    x.createEntry(1, a.crossSize ?? '0.1x');
    x.createEntry(3, a.crossGap ?? '0.05x');
  }
  a.extensions.forEach((n, i) => x.createEntry(40 + i, n));
  if (a.kind === 'mark') x.createEntry(290, a.showExtensions ?? true);
}

function newDictionary(h: number): CadDictionary {
  const d = new CadDictionary();
  d.handle = h;
  d.hardOwnerFlag = true;
  d.clonningFlags = DictionaryCloningFlags.KeepExisting;
  return d;
}

/** Writes the plan, after the entities: a new record is on an INSERT the same save adds. */
export function writeTriyaCenterMarks(
  doc: CadDocument,
  r: Resolver,
  plan: TriyaCenterMarksPlan,
): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  for (const { acad, after } of plan.updated) fill(acad, after, doc);
  for (const { after, dictionary } of plan.added) {
    const insert = resolve(r, after.insert, Insert)!;
    const x = new XRecord();
    x.handle = handle(after.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, after, doc);
    const dict = newDictionary(dictionary);
    dict.addByKey(TRIYA_CENTERMARK, x);
    // Joining the INSERT last registers the dictionary and its record with the drawing.
    if (insert.xDictionary !== dict) insert.xDictionary = dict;
  }
  for (const { insert, dictionary } of plan.empty) {
    const acad = resolve(r, insert, Insert);
    if (acad) acad.xDictionary = newDictionary(dictionary);
  }
}
