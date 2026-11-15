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
  type AssocArray,
  type AssocArrayParams,
  type BlockDefinition,
  type Entity,
  type InsertGeometry,
  type NonGraphicalObject,
} from '../model/types';
import { arrayPath, pathCurveOf, pathItems, polarItems, rectangularItems } from './array';
import { AnonymousNames, copyObjects, eraseObjects, type EditReport } from './edit';
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

/** Replaces the array block's items with INSERTs of the source block at `items`. */
export function placeItems(
  b: ChangeSetBuilder,
  model: DocumentModel,
  arrayBlock: Handle,
  source: Handle,
  items: readonly Similarity[],
): void {
  for (const id of b.blockEntities(arrayBlock)) b.removeEntity(id);
  const layer = layerZero(model);
  for (const t of items) {
    b.addEntity({
      owner: arrayBlock,
      layer,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
      geom: itemGeometry(source, t),
    });
  }
}

/**
 * Remakes the array's items from `params` and keeps them as its record's; returns why it could
 * not (its path is gone), changing nothing.
 */
export function remakeAssocArray(
  b: ChangeSetBuilder,
  model: DocumentModel,
  insert: Entity,
  record: AssocArray,
  params: AssocArrayParams,
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
  placeItems(b, model, insert.geom.block, record.source, items);
  if (params !== record.params) b.updateObject(record.handle, { params } as Partial<AssocArray>);
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
  if (problem) placeItems(b, model, block, source, [moveBy(zero)]);
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
    const source = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
    copyObjects(b, model, b.blockEntities(record.source), moveBy(zero), {}, source, names);
    const block = b.addBlock({ name: names.take('U'), basePoint: zero, flags: 1 }).handle;
    const items = b
      .blockEntities(copy.geom.block)
      .map((id) => b.entity(id)!)
      .filter((e) => e.geom.kind === 'INSERT');
    const layer = layerZero(model);
    for (const item of items) {
      b.addEntity({
        owner: block,
        layer,
        color: item.color,
        linetype: item.linetype,
        lineweight: item.lineweight,
        geom: { ...(item.geom as InsertGeometry), block: source },
      });
    }
    const dictionary = b.allocateHandle();
    b.updateEntity(copy.id, { extDict: dictionary, geom: { ...copy.geom, block } });
    b.addObject({
      type: 'TRIYA_ARRAY',
      owner: dictionary,
      insert: copy.handle,
      source,
      params: record.params,
    } as Omit<AssocArray, 'handle'>);
  }
}
