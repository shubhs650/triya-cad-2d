// Associative arrays Triya makes (M3-11, DEC-059). An array is one INSERT (in the drawing's
// space) of an anonymous `*U` array block whose items are INSERTs of a second anonymous `*U`
// source block, which holds the source objects with the array's base point at its origin. The
// array's definition is an `AssocArray` record (the `TRIYA_ARRAY` XRECORD in the INSERT's
// extension dictionary); ARRAYEDIT changes the record and remakes the items from it.
//
// Frames: the array block's origin is where the base point stood when the array was made (the
// array INSERT's position then), and the source block's origin is that base point too, so item 0
// of a rectangular or polar array is the source block placed as it is (its item similarity is the
// identity), and their items are computed in the array block's coordinates. A path array follows
// its path in the drawing: its items are computed there and carried into the array block by the
// inverse of the array INSERT's transform, so they stay on the path when the array moves.
import { applyPoint, compose, invert, rotation, scaling, translation } from '../geom/transform';
import type { Matrix2D } from '../geom/transform';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { GeneralProps } from '../properties/sheet';
import type { Handle } from '../model/handle';
import {
  isAssocArray,
  type ArrayItemKey,
  type AssocArray,
  type AssocArrayParams,
  type BlockDefinition,
  type Entity,
  type InsertGeometry,
  type NonGraphicalObject,
  type ReplacedItem,
} from '../model/types';
import type { Box } from '../geom/bounds';
import { entityBounds } from '../spatial/entity-bounds';
import { toleranceForSize } from '../geom/tolerance';
import { arrayPath, pathCurveOf, pathItems, polarItems, rectangularItems } from './array';
import {
  AnonymousNames,
  copyObjects,
  eraseObjects,
  transformObjects,
  type EditReport,
} from './edit';
import { followedBy, moveBy, similarity, type Similarity } from './similarity';
import type { TransformOptions } from './transform';

/** The record of the array whose INSERT is `insert`, if it is one Triya made. */
export function assocArrayOf(
  objects: Iterable<NonGraphicalObject>,
  insert: Entity | undefined,
): AssocArray | undefined {
  if (!insert || insert.geom.kind !== 'INSERT' || insert.extDict === undefined) return undefined;
  for (const o of objects) {
    if (isAssocArray(o) && o.insert === insert.handle && o.owner === insert.extDict) return o;
  }
  return undefined;
}

/** The INSERT's transform from its block's coordinates to its space's. */
export function insertMatrix(g: InsertGeometry, basePoint: Vec2): Matrix2D {
  return compose(
    translation(-basePoint.x, -basePoint.y),
    scaling(g.scale.x, g.scale.y),
    rotation(g.rotation),
    translation(g.position.x, g.position.y),
  );
}

/**
 * The world parameters a command edits turned into the record's: the centre into the array
 * block's coordinates and the base point into the source block's (`origin` is where both blocks'
 * origins stood when the array was made).
 */
export function localParams(world: AssocArrayParams, origin: Vec2): AssocArrayParams {
  const less = (p: Vec2): Vec2 => ({ x: p.x - origin.x, y: p.y - origin.y });
  switch (world.kind) {
    case 'rectangular':
      return world;
    case 'polar':
      return { ...world, center: less(world.center), base: less(world.base) };
    case 'path':
      return { ...world, base: less(world.base) };
  }
}

/**
 * Each item's similarity from the source block's coordinates to the array block's, item 0
 * first; or why there are none (a path that is gone or no longer a curve).
 */
export function assocItems(
  model: {
    entityByHandle(h: Handle): Entity | undefined;
    readonly blocks: { get(h: Handle): BlockDefinition | undefined };
  },
  insert: Entity,
  params: AssocArrayParams,
): Similarity[] | string {
  switch (params.kind) {
    case 'rectangular':
      return rectangularItems(params);
    case 'polar':
      return polarItems(params);
    case 'path': {
      const e = params.path === undefined ? undefined : model.entityByHandle(params.path);
      const found = e ? pathCurveOf(e.geom) : undefined;
      if (!found) return 'its path is gone';
      const path = arrayPath(found.curve, found.closed, params.reversed);
      const world = pathItems({ ...params, path });
      if (insert.geom.kind !== 'INSERT') return 'it is not a block reference';
      const block = model.blocks.get(insert.geom.block);
      const w = insertMatrix(insert.geom, block?.basePoint ?? { x: 0, y: 0 });
      try {
        const back = similarity(invert(w));
        return world.map((t) => followedBy(t, back));
      } catch {
        return 'it is not scaled uniformly';
      }
    }
  }
}

/** An item INSERT's place, turn and scale from its similarity (a reflection mirrors X). */
function itemGeometry(source: Handle, t: Similarity): InsertGeometry {
  const { a, b } = t.m;
  const position = applyPoint(t.m, { x: 0, y: 0 });
  const s = t.scale;
  return {
    kind: 'INSERT',
    block: source,
    position,
    scale: { x: t.reflect ? -s : s, y: s, z: s },
    rotation: t.reflect ? Math.atan2(-b, -a) : Math.atan2(b, a),
    attributes: [],
  };
}

/** Layer 0, where AutoCAD puts block contents that take the reference's properties. */
function layerZero(model: DocumentModel): Handle {
  for (const l of model.tables.layers.values()) if (l.name === '0') return l.handle;
  // Every drawing has layer 0; a damaged one without it keeps the array on the current layer.
  return [...model.tables.layers.values()][0]!.handle;
}

/** Item `k`'s place in its rows: the array's items are made row by row. */
export function itemKey(params: AssocArrayParams, k: number): ArrayItemKey {
  const n = params.kind === 'rectangular' ? params.columns : params.items;
  return { item: k % n, row: Math.floor(k / n) };
}

export const sameItem = (a: ArrayItemKey, b: ArrayItemKey): boolean =>
  a.item === b.item && a.row === b.row;

/** The block item `key` is an INSERT of: the block REPlace gave it, else the source block. */
export function itemBlock(
  record: { readonly source: Handle; readonly replaced?: readonly ReplacedItem[] | undefined },
  key: ArrayItemKey,
): Handle {
  return record.replaced?.find((r) => sameItem(r, key))?.block ?? record.source;
}

/**
 * Replaces the array block's items with INSERTs at `items`, each of the block `blockOf` names
 * for it (none leaves the item out: the one whose source is being edited, ARRAYEDIT Source).
 */
export function placeItems(
  b: ChangeSetBuilder,
  model: DocumentModel,
  arrayBlock: Handle,
  items: readonly Similarity[],
  blockOf: (k: number) => Handle | undefined,
): void {
  for (const id of b.blockEntities(arrayBlock)) b.removeEntity(id);
  const layer = layerZero(model);
  items.forEach((t, k) => {
    const block = blockOf(k);
    if (block === undefined) return;
    b.addEntity({
      owner: arrayBlock,
      layer,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
      geom: itemGeometry(block, t),
    });
  });
}

/** What ARRAYEDIT's Source, REPlace and RESet change besides the parameters. */
export interface AssocArrayPatch {
  readonly source?: Handle;
  /** The replaced items; empty after RESet. */
  readonly replaced?: readonly ReplacedItem[];
}

/**
 * Remakes the array's items from `params` (and `patch`) and keeps them as its record's; returns
 * why it could not (its path is gone), changing nothing.
 */
export function remakeAssocArray(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  params: AssocArrayParams,
  patch: AssocArrayPatch = {},
): string | undefined {
  const items = assocItems(
    {
      entityByHandle: (h: Handle) => model.entityByHandle(h),
      blocks: { get: (h: Handle) => b.block(h) },
    },
    insert,
    params,
  );
  if (typeof items === 'string') return items;
  if (insert.geom.kind !== 'INSERT') return 'it is not a block reference';
  const source = patch.source ?? record.source;
  const replaced = patch.replaced ?? record.replaced;
  const next = { source, replaced: replaced?.length ? replaced : undefined };
  const editing = sourceEditOf(model);
  const hidden = editing?.insert === insert.handle ? editing.key : undefined;
  placeItems(b, model, insert.geom.block, items, (k) => {
    const key = itemKey(params, k);
    return hidden && sameItem(key, hidden) ? undefined : itemBlock(next, key);
  });
  if (params !== record.params || source !== record.source || next.replaced !== record.replaced) {
    b.updateObject(record.handle, { params, ...next } as Partial<AssocArray>);
  }
  return undefined;
}

export interface NewAssocArray {
  /** The space the array goes in. */
  readonly space: Handle;
  /** The array's properties (the current ones). */
  readonly props: GeneralProps;
  /** The base point in the drawing: the source block's origin and the array's position. */
  readonly origin: Vec2;
  /** The parameters, as `localParams` gives them. */
  readonly params: AssocArrayParams;
  readonly transform?: TransformOptions;
}

/**
 * Makes an associative array of `ids`: the source objects go into a new source block (moved so
 * the base point is its origin) and leave the drawing, and the array is a new INSERT of a new
 * array block of items. Returns the INSERT and what could not go into the source block.
 */
export function makeAssocArray(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  a: NewAssocArray,
): { insert: Entity | undefined; report: EditReport } {
  const names = new AnonymousNames(model);
  const zero = { x: 0, y: 0 };
  const source = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
  const report = copyObjects(
    b,
    model,
    ids,
    moveBy({ x: -a.origin.x, y: -a.origin.y }),
    a.transform,
    source,
    names,
  );
  if (report.ids.length === 0) {
    b.removeBlock(source);
    return { insert: undefined, report };
  }
  eraseObjects(b, model, ids);
  const block = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
  const dictionary = b.allocateHandle();
  const insert = b.addEntity({
    owner: a.space,
    ...a.props,
    extDict: dictionary,
    geom: {
      kind: 'INSERT',
      block,
      position: a.origin,
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    },
  });
  const record = b.addObject({
    type: 'TRIYA_ARRAY',
    owner: dictionary,
    insert: insert.handle,
    source,
    params: a.params,
  } as Omit<AssocArray, 'handle'>) as AssocArray;
  const problem = remakeAssocArray(b, model, insert, record, a.params);
  if (problem) placeItems(b, model, block, [moveBy(zero)], () => source);
  return { insert, report };
}

/**
 * The records COPY must give the copies of arrays (`copies`: original handle → copy): each copy
 * of an array gets its own array and source blocks and record, so ARRAYEDIT on one leaves the
 * other be, as AutoCAD's copies of an array are arrays of their own.
 */
export function copyAssocArrays(
  b: ChangeSetBuilder,
  model: DocumentModel,
  copies: ReadonlyMap<Handle, Entity>,
  names: AnonymousNames,
): void {
  for (const [original, copy] of copies) {
    const record = assocArrayOf(model.objects.values(), model.entityByHandle(original));
    if (!record || copy.geom.kind !== 'INSERT') continue;
    const zero = { x: 0, y: 0 };
    // The source block and each replacement block get a copy of their own.
    const blocks = new Map<Handle, Handle>();
    for (const from of [record.source, ...(record.replaced ?? []).map((r) => r.block)]) {
      if (blocks.has(from)) continue;
      const to = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
      copyObjects(b, model, b.blockEntities(from), moveBy(zero), {}, to, names);
      blocks.set(from, to);
    }
    const block = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
    const items = b
      .blockEntities(copy.geom.block)
      .map((id) => b.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT');
    const layer = layerZero(model);
    for (const item of items) {
      const g = item.geom as InsertGeometry;
      b.addEntity({
        owner: block,
        layer,
        color: item.color,
        linetype: item.linetype,
        lineweight: item.lineweight,
        geom: { ...g, block: blocks.get(g.block) ?? blocks.get(record.source)! },
      });
    }
    const dictionary = b.allocateHandle();
    b.updateEntity(copy.id, { extDict: dictionary, geom: { ...copy.geom, block } });
    const replaced = record.replaced?.map((r) => ({ ...r, block: blocks.get(r.block)! }));
    b.addObject({
      type: 'TRIYA_ARRAY',
      owner: dictionary,
      insert: copy.handle,
      source: blocks.get(record.source)!,
      params: record.params,
      ...(replaced && { replaced }),
    } as Omit<AssocArray, 'handle'>);
  }
}

// ── ARRAYEDIT's item edits (M3-11 part 2) ──────────────────────────────────────────────────

/** Where item `k` is in the drawing: from its block's coordinates to the array's space. */
export function itemMatrix(model: DocumentModel, insert: Entity, item: Similarity): Matrix2D {
  const g = insert.geom as InsertGeometry;
  return compose(item.m, insertMatrix(g, model.blocks.get(g.block)?.basePoint ?? { x: 0, y: 0 }));
}

/** The geometric extents of a block's objects (blocks inside it count as their base point). */
function blockBox(model: DocumentModel, block: Handle): Box | undefined {
  let box: Box | undefined;
  for (const id of model.blockEntities(block)) {
    const e = model.entity(id)!;
    const r = entityBounds(e.geom, { tol: toleranceForSize(1), blockExtents: () => 'unknown' });
    const p = e.geom.kind === 'INSERT' ? e.geom.position : undefined;
    const bb = r.kind === 'box' ? r.box : p && { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    if (!bb) continue;
    box = box
      ? {
          minX: Math.min(box.minX, bb.minX),
          minY: Math.min(box.minY, bb.minY),
          maxX: Math.max(box.maxX, bb.maxX),
          maxY: Math.max(box.maxY, bb.maxY),
        }
      : bb;
  }
  return box;
}

/**
 * The item of the array at `p` in the drawing: the first whose objects' extents (grown by 5 %
 * of their size, so a line has some width to pick) hold the point; undefined when none does.
 */
export function arrayItemAt(
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  p: Vec2,
): { k: number; key: ArrayItemKey; item: Similarity } | undefined {
  const items = assocItems(model, insert, record.params);
  if (typeof items === 'string') return undefined;
  const boxes = new Map<Handle, Box | undefined>();
  for (let k = 0; k < items.length; k++) {
    const key = itemKey(record.params, k);
    const block = itemBlock(record, key);
    if (!boxes.has(block)) boxes.set(block, blockBox(model, block));
    const box = boxes.get(block);
    if (!box) continue;
    let local: Vec2;
    try {
      local = applyPoint(invert(itemMatrix(model, insert, items[k]!)), p);
    } catch {
      return undefined;
    }
    const grow = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6) * 0.05;
    if (
      local.x >= box.minX - grow &&
      local.x <= box.maxX + grow &&
      local.y >= box.minY - grow &&
      local.y <= box.maxY + grow
    ) {
      return { k, key, item: items[k]! };
    }
  }
  return undefined;
}

/**
 * A new anonymous block of copies of `ids`, moved so `base` is its origin (REPlace's
 * replacement objects, which stay in the drawing as they are). Undefined when none could be
 * copied; the report says why.
 */
export function replacementBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  base: Vec2,
  transform?: TransformOptions,
): { block: Handle | undefined; report: EditReport } {
  const names = new AnonymousNames(model);
  const block = b.addBlock({ name: names.take('U'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  const report = copyObjects(
    b,
    model,
    ids,
    moveBy({ x: -base.x, y: -base.y }),
    transform,
    block,
    names,
  );
  if (report.ids.length > 0) return { block, report };
  b.removeBlock(block);
  return { block: undefined, report };
}

/**
 * A rectangular array's Base point moved to `q` (in the array block's coordinates): the source
 * and replacement blocks' objects shift by -q and the array INSERT by q, so every item stays
 * where it is and the array's grip goes to the new point.
 */
export function rebaseRectangular(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  q: Vec2,
): void {
  const g = insert.geom as InsertGeometry;
  const w = insertMatrix(g, b.block(g.block)?.basePoint ?? { x: 0, y: 0 });
  const blocks = new Set([record.source, ...(record.replaced ?? []).map((r) => r.block)]);
  for (const block of blocks) {
    transformObjects(b, model, b.blockEntities(block), moveBy({ x: -q.x, y: -q.y }));
  }
  b.updateEntity(insert.id, { geom: { ...g, position: applyPoint(w, q) } });
}

// ── ARRAYEDIT Source: the editing state ARRAYCLOSE ends ─────────────────────────────────────

/**
 * An item's source objects opened for editing (ARRAYEDIT Source): copies of its block's objects
 * stand in the drawing where the item was, and the item is left out of the array until
 * ARRAYCLOSE. What is drawn in the same space meanwhile joins them, as AutoCAD's "including the
 * creation of new objects". Each command that changes them writes them back into the block, so
 * every item showing it follows at once.
 */
export interface SourceEdit {
  readonly insert: Handle;
  readonly record: Handle;
  /** The block being edited: the source block, or a replaced item's. */
  readonly block: Handle;
  readonly key: ArrayItemKey;
  readonly space: Handle;
  /** From the block's coordinates to the space's, where the item stood. */
  readonly place: Similarity;
  /** The block's objects when the edit opened, for ARRAYCLOSE's No. */
  readonly original: readonly Entity[];
  /** The objects being edited, by handle. */
  readonly handles: Set<Handle>;
}

// One editing state per drawing, as AutoCAD's: kept outside the drawing's data, so a save
// writes the objects being edited as they stand (and the item left out).
const sourceEdits = new WeakMap<DocumentModel, SourceEdit>();

export const sourceEditOf = (model: DocumentModel): SourceEdit | undefined =>
  sourceEdits.get(model);

/** Opens the editing state on item `k` of the array; returns what could not be copied out. */
export function openSourceEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  space: Handle,
  insert: Entity,
  record: AssocArray,
  at: { key: ArrayItemKey; item: Similarity },
  transform?: TransformOptions,
): EditReport | string {
  let place: Similarity;
  try {
    place = similarity(itemMatrix(model, insert, at.item));
  } catch {
    return 'it is not scaled uniformly';
  }
  const block = itemBlock(record, at.key);
  const ids = b.blockEntities(block);
  const original = ids.map((id) => b.entity(id)!);
  const report = copyObjects(b, model, ids, place, transform, space);
  sourceEdits.set(model, {
    insert: insert.handle,
    record: record.handle,
    block,
    key: at.key,
    space,
    place,
    original,
    handles: new Set(report.ids.map((id) => b.entity(id)!.handle)),
  });
  remakeAssocArray(b, model, insert, record, record.params);
  return report;
}

/** The objects being edited that are still in the drawing. */
export function sourceEditIds(model: DocumentModel, edit: SourceEdit): EntityId[] {
  const out: EntityId[] = [];
  for (const h of edit.handles) {
    const e = model.entityByHandle(h);
    if (e && e.owner === edit.space) out.push(e.id);
  }
  return out;
}

/** Writes the objects being edited back into the block and remakes the array. */
export function syncSourceEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  edit: SourceEdit,
  transform?: TransformOptions,
): void {
  const ids = sourceEditIds(model, edit);
  const insert = model.entityByHandle(edit.insert);
  const record = model.objects.get(edit.record);
  // Every object erased: the block keeps what it had until ARRAYCLOSE says what to do.
  if (ids.length === 0 || !insert || !isAssocArray(record)) return;
  for (const id of b.blockEntities(edit.block)) b.removeEntity(id);
  copyObjects(b, model, ids, similarity(invert(edit.place.m)), transform, edit.block);
  remakeAssocArray(b, model, insert, record, record.params);
}

/**
 * Ends the editing state (ARRAYCLOSE): `save` keeps the block as the edits left it, else its
 * objects go back to what they were; the objects being edited leave the drawing and the item
 * returns to the array. Returns false when nothing was being edited.
 */
export function closeSourceEdit(b: ChangeSetBuilder, model: DocumentModel, save: boolean): boolean {
  const edit = sourceEdits.get(model);
  if (!edit) return false;
  sourceEdits.delete(model);
  if (!save && b.block(edit.block)) {
    const kept = new Set(edit.original.map((e) => e.id));
    for (const id of b.blockEntities(edit.block)) if (!kept.has(id)) b.removeEntity(id);
    for (const e of edit.original) if (!b.entity(e.id)) b.restoreEntity(e);
  }
  for (const id of sourceEditIds(model, edit)) b.removeEntity(id);
  const insert = model.entityByHandle(edit.insert);
  const record = model.objects.get(edit.record);
  if (insert && isAssocArray(record)) remakeAssocArray(b, model, insert, record, record.params);
  return true;
}

/** Forgets an editing state whose array is gone (erased, or undone away). */
export function dropSourceEdit(model: DocumentModel): void {
  sourceEdits.delete(model);
}
