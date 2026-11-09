// Draw order (M2-08): DRAWORDER, TEXTTOFRONT and HATCHTOBACK rearrange the objects of a block
// by writing its SORTENTSTABLE, as AutoCAD does; the block's own order is never touched.
//
// The table gives an entity a sort handle to be drawn as; entities are drawn by ascending sort
// handle, one without an entry by its own handle, ties in block order (`drawOrder` in
// @triya/render, acad-ts `SortEntitiesTable.getSorterHandle`, ezdxf). A new order is written by
// handing the sort handles the block's objects are drawn by now back out in the new order: the
// i-th object drawn gets the i-th smallest. The set of sort handles stays the same, so objects
// Triya does not map (whose entries stay as read) keep their place among the others, and new
// objects, whose handles are above every sort handle, still draw on top as in AutoCAD. Where
// that set has a duplicate the objects' own handles are handed out instead.
//
// A block's first table goes into its record's extension dictionary, which is created when the
// record has none (the contract the DXF save accepts, M1-75 part 7).
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, NonGraphicalObject, SortEntsTable } from '../model/types';

export type DrawOrderMove =
  | { readonly to: 'front' | 'back' }
  /** Just above the topmost, or just under the bottommost, of the reference objects. */
  | { readonly to: 'above' | 'under'; readonly reference: readonly EntityId[] };

const key = (h: Handle): bigint => BigInt(`0x${h}`);

/** The block's SORTENTSTABLE, as the builder will leave it. */
export function sortTableOf(
  b: ChangeSetBuilder,
  model: DocumentModel,
  block: Handle,
): SortEntsTable | undefined {
  for (const o of model.objects.values()) {
    if (o.type !== 'SORTENTSTABLE') continue;
    const now = b.object(o.handle) as SortEntsTable | undefined;
    if (now?.block === block) return now;
  }
  return undefined;
}

/** The block's objects in the order they are drawn, with the sort handle each is drawn by. */
export function blockDrawOrder(
  model: DocumentModel,
  block: Handle,
  table: SortEntsTable | undefined,
): { id: EntityId; sort: Handle }[] {
  const sortOf = new Map(table?.entries.map((e) => [e.entity, e.sort]));
  return model
    .blockEntities(block)
    .map((id, i) => {
      const h = model.ids.handleOf(id)!;
      const sort = sortOf.get(h) ?? h;
      return { id, sort, k: key(sort), i };
    })
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map(({ id, sort }) => ({ id, sort }));
}

/** `ids` taken out of `order` and put back where `move` says, keeping their own order. */
export function rearranged(
  order: readonly EntityId[],
  ids: ReadonlySet<EntityId>,
  move: DrawOrderMove,
): EntityId[] {
  const moving = order.filter((id) => ids.has(id));
  const rest = order.filter((id) => !ids.has(id));
  if (moving.length === 0) return [...order];
  switch (move.to) {
    case 'front':
      return [...rest, ...moving];
    case 'back':
      return [...moving, ...rest];
    case 'above':
    case 'under': {
      const refs = new Set(move.reference.filter((id) => !ids.has(id)));
      const at = rest.flatMap((id, i) => (refs.has(id) ? [i] : []));
      if (at.length === 0) return [...order];
      const where = move.to === 'above' ? Math.max(...at) + 1 : Math.min(...at);
      return [...rest.slice(0, where), ...moving, ...rest.slice(where)];
    }
  }
}

/**
 * Writes `order` (the block's objects, each once) as the block's draw order. Returns whether
 * anything changed.
 */
export function writeDrawOrder(
  b: ChangeSetBuilder,
  model: DocumentModel,
  block: Handle,
  order: readonly EntityId[],
): boolean {
  const table = sortTableOf(b, model, block);
  const now = blockDrawOrder(model, block, table);
  if (now.every((e, i) => e.id === order[i])) return false;
  let sorts = now.map((e) => e.sort).sort((a, c) => (key(a) < key(c) ? -1 : 1));
  if (new Set(sorts).size !== sorts.length) {
    sorts = now.map((e) => model.ids.handleOf(e.id)!).sort((a, c) => (key(a) < key(c) ? -1 : 1));
  }
  const want = new Map<Handle, Handle>();
  order.forEach((id, i) => {
    const h = model.ids.handleOf(id)!;
    if (sorts[i] !== h) want.set(h, sorts[i]!);
  });
  const mapped = new Set(now.map((e) => model.ids.handleOf(e.id)!));
  // Entries as stored, those of objects Triya does not map untouched; then the new ones.
  const entries: { entity: Handle; sort: Handle }[] = [];
  for (const e of table?.entries ?? []) {
    if (!mapped.has(e.entity)) entries.push(e);
    else if (want.has(e.entity)) {
      entries.push({ entity: e.entity, sort: want.get(e.entity)! });
      want.delete(e.entity);
    }
  }
  for (const [entity, sort] of want) entries.push({ entity, sort });
  if (table) {
    b.updateObject(table.handle, { entries } as Partial<NonGraphicalObject>);
    return true;
  }
  if (entries.length === 0) return false;
  const record = b.tableRecord('blockRecords', block);
  let dict = record?.extDict;
  if (dict === undefined) {
    dict = b.allocateHandle();
    b.updateTableRecord('blockRecords', block, { extDict: dict });
  }
  b.addObject({
    type: 'SORTENTSTABLE',
    owner: dict,
    reactors: [dict],
    block,
    entries,
  } as Omit<SortEntsTable, 'handle'>);
  return true;
}

/**
 * DRAWORDER: moves `ids` in each block they belong to. Returns how many objects moved place in
 * the draw order (objects already where they go do not count).
 */
export function moveInDrawOrder(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  move: DrawOrderMove,
): number {
  const byBlock = new Map<Handle, Set<EntityId>>();
  for (const id of ids) {
    const e = model.entity(id);
    if (!e) continue;
    let set = byBlock.get(e.owner);
    if (!set) byBlock.set(e.owner, (set = new Set()));
    set.add(id);
  }
  let moved = 0;
  for (const [block, set] of byBlock) {
    const table = sortTableOf(b, model, block);
    const before = blockDrawOrder(model, block, table).map((e) => e.id);
    const after = rearranged(before, set, move);
    if (writeDrawOrder(b, model, block, after)) {
      moved += after.filter((id, i) => set.has(id) && before[i] !== id).length;
    }
  }
  return moved;
}

/** TEXTTOFRONT's kinds: Text, Dimensions and Leaders (All is all three). */
export const TEXT_TO_FRONT_KINDS = {
  Text: ['TEXT', 'MTEXT'],
  Dimensions: ['DIMENSION', 'LARGE_RADIAL_DIMENSION', 'ARC_DIMENSION'],
  Leaders: ['LEADER', 'MULTILEADER'],
} as const;

/**
 * The objects of every layout (model space and each paper space) that `pick` takes, off locked
 * layers: what TEXTTOFRONT and HATCHTOBACK rearrange. AutoCAD leaves the contents of block
 * definitions and xrefs alone.
 */
export function layoutObjects(model: DocumentModel, pick: (e: Entity) => boolean): EntityId[] {
  const out: EntityId[] = [];
  for (const layout of model.layouts) {
    if (!model.hasBlock(layout.blockRecord)) continue;
    for (const id of model.blockEntities(layout.blockRecord)) {
      const e = model.entity(id)!;
      if (model.tables.layers.get(e.layer)?.locked === true) continue;
      if (pick(e)) out.push(id);
    }
  }
  return out;
}
