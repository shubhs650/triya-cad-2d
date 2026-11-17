// TriyaToAcad for named layer states (M5-07), the inverse of map/layer-states.ts: each state is
// an XRECORD in the `ACAD_LAYERSTATES` dictionary of the LAYER table's extension dictionary,
// under its name. Only the states that changed are written; the others stay as read, groups
// Triya does not map included. A changed state is written whole from the model (its own
// extension dictionary, xdata and reactors stay as read); a renamed one changes its entry name in
// place. A drawing without `ACAD_LAYERSTATES` gets it, as the handle the engine gave it, with its
// first state, under the LAYER table's extension dictionary (made too, when the table has none,
// as AutoCAD makes one: hard owner, 280 = 1, 281 = 1).
//
// Refused, before anything changes: a version before R2000 (the save writes AC1032, DEC-047), a
// state that moves to another dictionary, a new state's handle in use, a new state filed in a
// dictionary other than the drawing's `ACAD_LAYERSTATES`, and a name an entry Triya keeps as read
// already holds.
import {
  ACadVersion,
  CadDictionary,
  DictionaryCloningFlags,
  Layer,
  LineType,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  isLayerState,
  type DocumentInit,
  type DocumentModel,
  type Handle,
  type LayerState,
} from '@triya/engine';
import { ACAD_LAYERSTATES, layerEntryValues, layerStatesDictionary } from '../map/layer-states';
import { entryTakenProblems, renameEntries } from './dictionary-entries';
import { resolve, same, type Resolver } from './entities';

export interface LayerStatesPlan {
  readonly updated: {
    readonly acad: XRecord;
    readonly before: LayerState;
    readonly after: LayerState;
  }[];
  readonly added: LayerState[];
  readonly removed: XRecord[];
  /** The `ACAD_LAYERSTATES` the save makes for the drawing's first states, by handle. */
  readonly dictionary?: number;
}

const handle = (h: Handle): number => Number.parseInt(h, 16);

export function planLayerStates(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: LayerStatesPlan; problems: string[] } {
  const updated: LayerStatesPlan['updated'][number][] = [];
  const added: LayerState[] = [];
  const removed: XRecord[] = [];
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isLayerState).map((o) => [o.handle, o]));
  const dict = layerStatesDictionary(doc);
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015;

  for (const [h] of before) {
    if (isLayerState(model.objects.get(h))) continue;
    const acad = resolve(r, h, XRecord);
    if (acad) removed.push(acad);
    else problems.push(`LAYER_STATE ${h}: the original is not an XRECORD`);
  }
  let made: number | undefined;
  const names = new Map<string, Handle>();
  for (const a of model.objects.values()) {
    if (!isLayerState(a)) continue;
    const b = before.get(a.handle);
    const out: string[] = [];
    const key = a.name.toUpperCase();
    if (names.has(key)) out.push(`another state is named ${a.name}`);
    names.set(key, a.handle);
    if (b && same(b, a)) continue;
    if (old) out.push(`${ACadVersion[version!]} is older than R2000`);
    if (b) {
      if (b.owner !== a.owner) out.push('its dictionary changes');
      const acad = resolve(r, a.handle, XRecord);
      if (!acad) out.push('the original is not an XRECORD');
      if (out.length === 0) updated.push({ acad: acad!, before: b, after: a });
    } else {
      if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
      if (dict) {
        if (dict.handle !== handle(a.owner)) out.push(`it is not filed in ${ACAD_LAYERSTATES}`);
      } else if (made === undefined) {
        if (doc.getCadObject(handle(a.owner)))
          out.push(`dictionary ${a.owner}: the handle is already used`);
        else made = handle(a.owner);
      } else if (made !== handle(a.owner)) out.push(`it is not filed in ${ACAD_LAYERSTATES}`);
      if (out.length === 0) added.push(a);
    }
    if (!b || b.name.toUpperCase() !== key) {
      out.push(...entryTakenProblems(dict, a.name, (o) => o instanceof XRecord));
    }
    problems.push(...out.map((p) => `LAYER_STATE ${a.handle}: ${p}`));
  }
  return {
    plan: {
      updated,
      added,
      removed,
      ...(made !== undefined && added.length > 0 ? { dictionary: made } : {}),
    },
    problems,
  };
}

/** The state's groups, as map/layer-states.ts reads them. */
function fill(x: XRecord, s: LayerState, doc: CadDocument): void {
  x.clear();
  x.createEntry(91, s.mask);
  x.createEntry(301, s.description);
  x.createEntry(290, s.paperSpace);
  x.createEntry(302, s.currentLayer);
  for (const e of s.layers) {
    const layer = e.layer === undefined ? undefined : doc.getCadObject(handle(e.layer));
    // A layer the drawing lacks (a `.las` file's) is named, as the file names it.
    if (layer instanceof Layer) x.createEntry(330, layer.handle);
    else x.createEntry(8, e.name);
    const v = layerEntryValues(e);
    x.createEntry(90, v.flags);
    x.createEntry(62, v.aci);
    x.createEntry(370, v.lineweight);
    const linetype = e.linetype === undefined ? undefined : doc.getCadObject(handle(e.linetype));
    if (linetype instanceof LineType) x.createEntry(331, linetype.handle);
    else x.createEntry(6, e.linetypeName);
    x.createEntry(1, e.plotStyle);
    x.createEntry(440, v.transparency);
    if (v.trueColor !== undefined) x.createEntry(92, v.trueColor);
    if (v.book !== undefined) x.createEntry(300, v.book);
  }
}

function newDictionary(h: number): CadDictionary {
  const d = new CadDictionary();
  d.handle = h;
  d.hardOwnerFlag = true;
  d.clonningFlags = DictionaryCloningFlags.KeepExisting;
  return d;
}

/** Writes the plan, after the layers: a state may name a layer the same save adds. */
export function writeLayerStates(doc: CadDocument, r: Resolver, plan: LayerStatesPlan): void {
  for (const x of plan.removed) {
    const dict = x.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = dict.entryNames.find((k) => dict.getEntry(k) === x);
    if (key !== undefined) dict.remove(key);
  }
  renameEntries(
    plan.updated
      .filter(({ before, after }) => before.name !== after.name)
      .map(({ acad, after }) => ({ acad, name: after.name })),
  );
  for (const { acad, after } of plan.updated) fill(acad, after, doc);
  if (plan.added.length === 0) return;
  let dict = layerStatesDictionary(doc);
  if (!dict) {
    const table = doc.layers!;
    if (!table.xDictionary) table.xDictionary = newDictionary(r.allocate());
    // As AutoCAD files it: a soft owner of its states (350), listing its owner as a reactor.
    dict = newDictionary(plan.dictionary!);
    dict.hardOwnerFlag = false;
    table.xDictionary!.addByKey(ACAD_LAYERSTATES, dict);
    dict.addReactor(table.xDictionary!);
  }
  for (const s of plan.added) {
    const x = new XRecord();
    x.handle = handle(s.handle);
    x.cloningFlags = DictionaryCloningFlags.KeepExisting;
    fill(x, s, doc);
    dict.addByKey(s.name, x);
    if (s.reactors?.includes(s.owner)) x.addReactor(dict);
  }
}
