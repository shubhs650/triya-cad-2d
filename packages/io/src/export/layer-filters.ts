// TriyaToAcad for layer filters (M5-07 part 4, DEC-076), the inverse of map/layer-filters.ts:
// each filter is an XRECORD in an `ACLYDICTIONARY` (the LAYER table's extension dictionary's, or
// for a nested filter its parent's). Only the filters that changed are written; the others stay as
// read, groups Triya does not map included. A changed filter is written whole from the model (its
// own extension dictionary, xdata and reactors stay as read). A new filter is filed under the
// lowest free anonymous key (`*A1`, `*A2`, ...: the name is the record's 300, so a rename changes
// no key). A drawing without the LAYER table's `ACLYDICTIONARY` gets it, as the handle the engine
// gave it, with its first filter; a filter given its first nested filter gets one in its own
// extension dictionary (made too, when it has none). AutoCAD files both as a soft owner (281 1, no
// 280) listing its extension dictionary as a reactor, as the drawing's own `ACLYDICTIONARY` shows.
//
// Refused, before anything changes: a version before R2000 (the save writes AC1032, DEC-047), a
// filter that moves to another dictionary or parent, a new filter's handle in use, a new filter
// filed in a dictionary other than its parent's (or the drawing's), and a made dictionary's handle
// in use.
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Layer,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  isLayerFilter,
  type DocumentInit,
  type DocumentModel,
  type Handle,
  type LayerFilter,
} from '@triya/engine';
import {
  ACLYDICTIONARY,
  GROUP_FILTER_CLASS,
  PROPERTY_FILTER_CLASS,
  filterDictionaryOf,
  layerFiltersDictionary,
} from '../map/layer-filters';
import { resolve, same, type Resolver } from './entities';

export interface LayerFiltersPlan {
  readonly updated: {
    readonly acad: XRecord;
    readonly before: LayerFilter;
    readonly after: LayerFilter;
  }[];
  /** Parents before the filters nested in them. */
  readonly added: LayerFilter[];
  readonly removed: XRecord[];
  /** The LAYER table's `ACLYDICTIONARY` the save makes for the drawing's first filters. */
  readonly dictionary?: number;
}

const handle = (h: Handle): number => Number.parseInt(h, 16);

export function planLayerFilters(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: LayerFiltersPlan; problems: string[] } {
  const updated: LayerFiltersPlan['updated'][number][] = [];
  const added: LayerFilter[] = [];
  const removed: XRecord[] = [];
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isLayerFilter).map((o) => [o.handle, o]));
  const top = layerFiltersDictionary(doc);
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  for (const [h] of before) {
    if (isLayerFilter(model.objects.get(h))) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) removed.push(acad);
    else problems.push(`LAYER_FILTER ${h}: the original is not an XRECORD`);
  }
  let made: number | undefined;
  const filters = [...model.objects.values()].filter(isLayerFilter);
  for (const a of filters) {
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (a.nested !== undefined && a.nested !== b?.nested) {
      if (b?.nested !== undefined) out.push('its nested filters move to another dictionary');
      else if (doc.getCadObject(handle(a.nested)))
        out.push(`dictionary ${a.nested}: the handle is already used`);
    }
    if (b) {
      if (b.owner !== a.owner || b.parent !== a.parent) out.push('it moves to another dictionary');
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) updated.push({ acad: acad!, before: b, after: a });
    } else if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
    problems.push(...out.map((p) => `LAYER_FILTER ${a.handle}: ${p}`));
  }
  for (const a of filters) {
    if (before.has(a.handle)) continue;
    const out: string[] = [];
    const parent = a.parent === undefined ? undefined : model.objects.get(a.parent);
    if (a.parent !== undefined) {
      if (!isLayerFilter(parent) || parent.nested !== a.owner)
        out.push('it is not filed in its parent’s dictionary');
    } else if (top) {
      if (top.handle !== handle(a.owner)) out.push(`it is not filed in ${ACLYDICTIONARY}`);
    } else if (made === undefined) {
      if (doc.getCadObject(handle(a.owner)))
        out.push(`dictionary ${a.owner}: the handle is already used`);
      else made = handle(a.owner);
    } else if (made !== handle(a.owner)) out.push(`it is not filed in ${ACLYDICTIONARY}`);
    if (out.length === 0) added.push(a);
    problems.push(...out.map((p) => `LAYER_FILTER ${a.handle}: ${p}`));
  }
  // Parents first: a new nested filter is filed in the dictionary its new parent gets.
  const depth = (f: LayerFilter): number => {
    let n = 0;
    for (let p = f.parent; p !== undefined && n < filters.length; n++) {
      const o = model.objects.get(p);
      p = isLayerFilter(o) ? o.parent : undefined;
    }
    return n;
  };
  added.sort((x, y) => depth(x) - depth(y));
  return {
    plan: {
      updated,
      added,
      removed,
      ...(made !== undefined && added.some((a) => a.parent === undefined)
        ? { dictionary: made }
        : {}),
    },
    problems,
  };
}

/** The filter's groups, as map/layer-filters.ts reads them. */
function fill(x: XRecord, f: LayerFilter, doc: CadDocument): void {
  x.clear();
  x.createEntry(1, f.filterType === 'group' ? GROUP_FILTER_CLASS : PROPERTY_FILTER_CLASS);
  x.createEntry(90, 1);
  x.createEntry(300, f.name);
  if (f.filterType === 'property') x.createEntry(301, f.expression);
  for (const h of f.filterType === 'group' ? f.layers : []) {
    // A layer the drawing no longer has (an unloaded xref's) is left out.
    const layer = doc.getCadObject(handle(h));
    if (layer instanceof Layer) x.createEntry(330, layer.handle);
  }
}

function newDictionary(h: number, hardOwner: boolean): CadDictionary {
  const d = new CadDictionary();
  d.handle = h;
  d.hardOwnerFlag = hardOwner;
  d.clonningFlags = DictionaryCloningFlags.KeepExisting;
  return d;
}

/** `o`'s `ACLYDICTIONARY` made as `h`, in its extension dictionary (made too when it has none). */
function makeFilterDictionary(
  o: { xDictionary: CadDictionary | null },
  h: number,
  r: Resolver,
): CadDictionary {
  if (!o.xDictionary) o.xDictionary = newDictionary(r.allocate(), true);
  const d = newDictionary(h, false);
  o.xDictionary!.addByKey(ACLYDICTIONARY, d);
  d.addReactor(o.xDictionary!);
  return d;
}

function freeKey(dict: CadDictionary): string {
  const taken = new Set(dict.entryNames.map((k) => k.toUpperCase()));
  let n = 1;
  while (taken.has(`*A${n}`)) n++;
  return `*A${n}`;
}

/** Writes the plan, after the layers: a group may hold a layer the same save adds. */
export function writeLayerFilters(doc: CadDocument, r: Resolver, plan: LayerFiltersPlan): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  const records = new Map<Handle, XRecord>();
  for (const { acad, before, after } of plan.updated) {
    fill(acad, after, doc);
    records.set(after.handle, acad);
    if (after.nested !== undefined && before.nested === undefined)
      makeFilterDictionary(acad, handle(after.nested), r);
  }
  if (plan.added.length === 0) return;
  const top =
    layerFiltersDictionary(doc) ??
    (plan.dictionary === undefined
      ? undefined
      : makeFilterDictionary(doc.layers!, plan.dictionary, r));
  for (const f of plan.added) {
    const parent =
      f.parent === undefined ? undefined : (records.get(f.parent) ?? resolve(r, f.parent, XRecord));
    const dict = f.parent === undefined ? top : filterDictionaryOf(parent);
    if (!dict) continue;
    const x = new XRecord();
    x.handle = handle(f.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, f, doc);
    dict.addByKey(freeKey(dict), x);
    if (f.reactors?.includes(f.owner)) x.addReactor(dict);
    records.set(f.handle, x);
    if (f.nested !== undefined) makeFilterDictionary(x, handle(f.nested), r);
  }
}
