// TriyaToAcad for draw order (M1-75 part 7): SORTENTSTABLE objects, the inverse of
// map/sortents.ts. DRAWORDER, TEXTTOFRONT and HATCHTOBACK (M2-08) change a block's table; a
// block without one gains it in its record's extension dictionary, which the save creates when
// the record has none, as AutoCAD does. What a save cannot keep is refused before anything
// changes.

import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  DictionaryCloningFlags,
  Entity as AcadEntity,
  SortEntitiesTable,
  type CadDocument,
} from '@node-projects/acad-ts';
import type {
  BlockTableRecord,
  DocumentInit,
  DocumentModel,
  Handle,
  NonGraphicalObject,
  SortEntsTable,
} from '@triya/engine';
import { ref } from '../map/common';
import { resolve, same, type Resolver } from './entities';

const TYPE = 'SORTENTSTABLE';

const isTable = (o: NonGraphicalObject | undefined): o is SortEntsTable => o?.type === TYPE;

export interface DrawOrderPlan {
  readonly updated: { readonly acad: SortEntitiesTable; readonly after: SortEntsTable }[];
  /** New tables; `dictionary` is the record's extension dictionary, or the handle of a new one. */
  readonly added: {
    readonly block: BlockRecord;
    readonly dictionary: CadDictionary | number;
    readonly after: SortEntsTable;
  }[];
  readonly removed: SortEntitiesTable[];
}

export interface DrawOrderChanges {
  readonly plan: DrawOrderPlan;
  readonly problems: string[];
  /**
   * Block records whose only change is the extension dictionary a new table of theirs needs
   * (by record handle): the save creates it, so it is not a block record change of its own.
   */
  readonly newDictionaries: ReadonlySet<Handle>;
}

/** The model's draw order changes against the original's mapping, and why any cannot be written. */
export function planDrawOrder(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): DrawOrderChanges {
  const plan: DrawOrderPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const newDictionaries = new Set<Handle>();
  const before = new Map((base.objects ?? []).filter(isTable).map((t) => [t.handle, t]));
  const after = new Map(
    [...model.objects.values()].filter(isTable).map((t) => [t.handle, t] as const),
  );
  // Entities each block had and has: an entry may name one the save removes (it goes with it).
  const had = new Map<Handle, Set<Handle>>();
  for (const e of base.entities ?? []) {
    had.set(e.owner, (had.get(e.owner) ?? new Set()).add(e.handle));
  }
  const mapped = new Set((base.entities ?? []).map((e) => e.handle));
  const tablesPerBlock = new Map<Handle, number>();
  for (const t of after.values())
    tablesPerBlock.set(t.block, (tablesPerBlock.get(t.block) ?? 0) + 1);

  for (const h of before.keys()) {
    const a = model.objects.get(h);
    if (a === undefined) {
      const acad = resolve(r, h, SortEntitiesTable);
      if (acad && acad.owner instanceof CadDictionary) plan.removed.push(acad);
      else problems.push(`${TYPE} ${h}: the original is not in an extension dictionary`);
    } else if (!isTable(a)) {
      problems.push(`${TYPE} ${h}: becomes a ${a.type}`);
    }
  }
  for (const [h, a] of after) {
    const b = before.get(h);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    if ((tablesPerBlock.get(a.block) ?? 0) > 1)
      out.push(`a second draw order table for block ${a.block}`);
    out.push(...entryProblems(model, r, had, mapped, a));
    if (b) {
      if (a.block !== b.block) out.push('its block changes');
      if (a.owner !== b.owner) out.push('its owner changes');
      for (const k of ['xdata', 'reactors', 'extDict'] as const)
        if (!same(b[k], a[k])) out.push(`${k} changes`);
      const acad = resolve(r, h, SortEntitiesTable);
      if (!acad) out.push('the original is not a SORTENTSTABLE');
      if (out.length === 0) plan.updated.push({ acad: acad!, after: a });
    } else {
      const added = newTable(doc, base, model, r, a, out);
      if (out.length === 0 && added) {
        plan.added.push(added);
        if (typeof added.dictionary === 'number') newDictionaries.add(a.block);
      }
    }
    problems.push(...out.map((p) => `${TYPE} ${h}: ${p}`));
  }
  return { plan, problems, newDictionaries };
}

function entryProblems(
  model: DocumentModel,
  r: Resolver,
  had: ReadonlyMap<Handle, ReadonlySet<Handle>>,
  mapped: ReadonlySet<Handle>,
  t: SortEntsTable,
): string[] {
  const out: string[] = [];
  const has = new Set(
    model.hasBlock(t.block)
      ? model.blockEntities(t.block).map((id) => model.entity(id)!.handle)
      : [],
  );
  const seen = new Set<Handle>();
  for (const { entity, sort } of t.entries) {
    if (seen.has(entity)) out.push(`more than one entry for ${entity}`);
    seen.add(entity);
    // An entity the save removes from the block drops out of the table with it; one Triya does
    // not map (a MESH, a 3DSOLID) stays in its block as read.
    const removed = had.get(t.block)?.has(entity) && !model.entityByHandle(entity);
    const original = mapped.has(entity) ? undefined : r.store.original(entity);
    const kept = original instanceof AcadEntity && ref(original.owner) === t.block;
    if (!has.has(entity) && !removed && !kept)
      out.push(`the entry for ${entity} names an entity not in block ${t.block}`);
    if (!/^[0-9A-F]{1,13}$/i.test(sort) || Number.parseInt(sort, 16) === 0)
      out.push(`${JSON.stringify(sort)} is not a sort handle`);
  }
  return out;
}

/**
 * A new table sits in its block record's extension dictionary, which the save creates when the
 * record has none and the model gives it one under the table's owner. AutoCAD lists that
 * dictionary as the table's reactor; Triya writes the reactors the model states.
 */
function newTable(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  a: SortEntsTable,
  out: string[],
): DrawOrderPlan['added'][number] | undefined {
  const version = doc.header?.version;
  // Draw order came with R14; an R13 drawing has no SORTENTSTABLE.
  if (version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1014)
    out.push(`${ACadVersion[version]} has no draw order (it came with R14)`);
  if (a.xdata !== undefined || a.extDict !== undefined)
    out.push('xdata or an extension dictionary');
  if (a.reactors !== undefined && !same(a.reactors, [a.owner]))
    out.push('its reactors can only be its extension dictionary');
  const block = resolve(r, a.block, BlockRecord);
  if (!block) {
    out.push(`block ${a.block} is not in the drawing`);
    return undefined;
  }
  const was = (base.tables?.blockRecords ?? []).find((b) => b.handle === a.block) as
    BlockTableRecord | undefined;
  const now = model.tables.blockRecords.get(a.block);
  if (was?.extDict !== undefined) {
    const dictionary = resolve(r, was.extDict, CadDictionary);
    if (a.owner !== was.extDict || !dictionary || dictionary !== block.xDictionary) {
      out.push(`it must sit in its block's extension dictionary ${was.extDict}`);
      return undefined;
    }
    return { block, dictionary, after: a };
  }
  if (now?.extDict === undefined || now.extDict !== a.owner) {
    out.push(`it must sit in its block's extension dictionary (block ${a.block} has none)`);
    return undefined;
  }
  if (doc.getCadObject(Number.parseInt(a.owner, 16)))
    out.push(`the extension dictionary's handle ${a.owner} is already used`);
  if (doc.getCadObject(Number.parseInt(a.handle, 16))) out.push(`the handle is already used`);
  return { block, dictionary: Number.parseInt(a.owner, 16), after: a };
}

/** Whether a block record change is only the extension dictionary a new table needs. */
export function onlyNewDictionary(
  changes: DrawOrderChanges,
  before: BlockTableRecord | undefined,
  after: BlockTableRecord | undefined,
): boolean {
  if (!before || !after || !changes.newDictionaries.has(after.handle)) return false;
  return before.extDict === undefined && same(before, { ...after, extDict: undefined });
}

/**
 * Writes the plan, after the entity changes (an entry may name an entity the same save adds).
 * Entries of entities the save removed are left out; `removed` are their originals.
 */
export function writeDrawOrder(
  doc: CadDocument,
  plan: DrawOrderPlan,
  removed: ReadonlySet<AcadEntity>,
): void {
  for (const t of plan.removed) {
    const dictionary = t.owner as CadDictionary;
    const key = dictionary.entryNames.find((k) => dictionary.getEntry(k) === t);
    if (key !== undefined) dictionary.remove(key);
  }
  const fill = (t: SortEntitiesTable, after: SortEntsTable): void => {
    t.clear();
    for (const { entity, sort } of after.entries) {
      const e = doc.getCadObject(Number.parseInt(entity, 16));
      if (e instanceof AcadEntity && !removed.has(e)) t.add(e, Number.parseInt(sort, 16));
    }
  };
  for (const { acad, after } of plan.updated) fill(acad, after);
  for (const { block, dictionary, after } of plan.added) {
    let dict = dictionary;
    if (typeof dict === 'number') {
      // As AutoCAD makes an extension dictionary: hard owner (280 = 1), keep existing (281 = 1).
      const d = new CadDictionary();
      d.handle = dict;
      d.hardOwnerFlag = true;
      d.clonningFlags = DictionaryCloningFlags.KeepExisting;
      block.xDictionary = d;
      dict = d;
    }
    const t = new SortEntitiesTable(block);
    t.handle = Number.parseInt(after.handle, 16);
    dict.addByKey(SortEntitiesTable.dictionaryEntryName, t);
    if (after.reactors?.length) t.addReactor(dict);
    fill(t, after);
  }
}
