// In-place reference editing (M5-02 part 3), the geometry side of REFEDIT, REFSET and REFCLOSE as
// AutoCAD 2024 has them (AutoCAD Help, "REFEDIT (Command)", "Reference Edit Dialog Box",
// "REFSET (Command)", "REFCLOSE (Command)"):
//
// - the working set, the objects of the block chosen that are edited, is carried out of the
//   definition into the space the reference is in, placed where the reference draws them (the
//   references' placements from the one picked inward), so the drafter edits them in place with
//   every command and object snap;
// - saving carries the working set back into the definition by the inverse placement, objects
//   drawn meanwhile included, so every reference to the block shows the edits.
//
// The objects keep their handles both ways (`moveEntity`), with their xdata, reactors and
// extension dictionaries. An object no command touched while it was out is put back exactly as it
// was (no rounding from carrying it out and back), with what was carried along with it (a
// dimension's block, its associations' points).
import type { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { AttdefGeometry, Entity, InsertGeometry } from '../model/types';
import { compose, invert, rotation, scaling, translation } from '../geom/transform';
import { isXrefDependent, isXrefRecord, xrefBringing } from '../model/xref';
import { ATTRIBUTE_CONSTANT } from './blocks';
import { patchBack, transformObjects } from './edit';
import { followedBy, similarity, type Similarity } from './similarity';
import { transformProblem } from './transform';

/** How near two scales are taken as one (relative), as EXPLODE takes them. */
const UNIFORM = 1e-12;

/**
 * How the block reference `g` carries its block's contents into the space it is in (base point
 * to the insertion point, scaled, then turned), or why it cannot be edited in place.
 */
export function referencePlacement(model: DocumentModel, g: InsertGeometry): Similarity | string {
  const def = model.blocks.get(g.block);
  const record = model.tables.blockRecords.get(g.block);
  if (!def || !record) return 'the block is missing';
  // An xref is edited in place and saved to its own file (M5-02 part 6), once loaded.
  if (isXrefRecord(record) && !def.xrefLoaded) return 'the external reference is not loaded';
  // A block an xref brought in (`xref|name`) is edited in place and saved to the xref's file
  // (M5-02 part 7), while that xref is loaded.
  if (isXrefDependent(record) && !isXrefRecord(record) && !xrefBringing(model, g.block))
    return 'the external reference that brought the block in is not loaded';
  if (record.name.startsWith('*')) return 'an anonymous or dynamic block cannot be edited in place';
  if (g.array && (g.array.columns > 1 || g.array.rows > 1))
    return 'a MINSERT cannot be edited in place';
  if (g.normal && (g.normal.x !== 0 || g.normal.y !== 0 || g.normal.z <= 0))
    return 'the block reference is not in plan';
  const sx = g.scale.x;
  const sy = g.scale.y;
  if (sx === 0 || sy === 0) return 'the block reference has a zero scale';
  if (Math.abs(Math.abs(sx) - Math.abs(sy)) > UNIFORM * Math.max(Math.abs(sx), Math.abs(sy)))
    return 'a block reference scaled differently in X and Y cannot be edited in place';
  return similarity(
    compose(
      translation(-def.basePoint.x, -def.basePoint.y),
      scaling(sx, sy),
      rotation(g.rotation),
      translation(g.position.x, g.position.y),
    ),
  );
}

/**
 * The placement of the innermost of `path` (references, the first in the space shown, each next
 * one in the block of the one before): the block of the last is carried by it into the space.
 */
export function pathPlacement(
  model: DocumentModel,
  path: readonly EntityId[],
): Similarity | string {
  let t: Similarity | undefined;
  for (const id of path) {
    const g = model.entity(id)?.geom;
    if (g?.kind !== 'INSERT') return 'the object is not a block reference';
    const own = referencePlacement(model, g);
    if (typeof own === 'string') return own;
    t = t ? followedBy(own, t) : own;
  }
  return t ?? 'no block reference was selected';
}

/**
 * The objects of `block` REFEDIT's "Automatically select all nested objects" takes: all of them,
 * but the variable attribute definitions unless they are shown for editing ("Display attribute
 * definitions for editing"; constant ones are drawn by every reference, so they are geometry).
 */
export function wholeWorkingSet(
  model: DocumentModel,
  block: Handle,
  attributes: boolean,
): EntityId[] {
  return model.blockEntities(block).filter((id) => {
    const g = model.entity(id)!.geom;
    return (
      attributes || g.kind !== 'ATTDEF' || ((g as AttdefGeometry).flags & ATTRIBUTE_CONSTANT) !== 0
    );
  });
}

/** What carrying a working set out made, for carrying it back. */
export interface Extraction {
  /** The objects carried out, as the definition held them. */
  readonly originals: ReadonlyMap<EntityId, Entity>;
  /** Objects that cannot be carried (an OLE object, a proxy), left in the definition. */
  readonly refused: number;
}

/**
 * Carries `ids` (objects of a block's definition, in its order) into `space` by `t`, keeping
 * their handles. What `t` cannot carry stays in the definition.
 */
export function extractWorkingSet(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  t: Similarity,
  space: Handle,
): Extraction {
  const originals = new Map<EntityId, Entity>();
  let refused = 0;
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    if (transformProblem(e.geom, t)) {
      refused += 1;
      continue;
    }
    originals.set(id, e);
    b.moveEntity(id, space);
  }
  // Text and hatch patterns are carried mirrored when the reference is: the reference draws them
  // so, and the way back must find them as the definition holds them.
  transformObjects(b, model, [...originals.keys()], t, {
    mirrorText: true,
    mirrorHatch: true,
    locked: true,
  });
  return { originals, refused };
}

/** What `cs` changed: entity ids and object handles. */
export function changedIn(cs: ChangeSet, into: Set<EntityId | Handle>): void {
  const e = cs.entities;
  for (const a of e?.added ?? []) into.add(a.entity.id);
  for (const u of e?.updated ?? []) into.add(u.before.id);
  for (const r of e?.removed ?? []) into.add(r.entity.id);
  const o = cs.objects;
  for (const a of o?.added ?? []) into.add(a.handle);
  for (const u of o?.updated ?? []) into.add(u.before.handle);
  for (const r of o?.removed ?? []) into.add(r.handle);
}

export interface WorkingSetReturn {
  readonly block: Handle;
  /** The placement the working set was carried out by. */
  readonly t: Similarity;
  /** The change that carried it out, and what it carried (`extractWorkingSet`). */
  readonly extraction: ChangeSet;
  readonly originals: ReadonlyMap<EntityId, Entity>;
  /** What changed after the extraction (`changedIn` over the later changes). */
  readonly touched: ReadonlySet<EntityId | Handle>;
}

/**
 * REFCLOSE's Save: the working set `ids` (objects of the space, those carried out first in the
 * definition's order) carried back into the definition. What no later change touched is put back
 * exactly as it was.
 */
export function returnWorkingSet(
  b: ChangeSetBuilder,
  model: DocumentModel,
  r: WorkingSetReturn,
  ids: readonly EntityId[],
): void {
  for (const id of ids) b.moveEntity(id, r.block);
  transformObjects(b, model, ids, similarity(invert(r.t.m)), {
    mirrorText: true,
    mirrorHatch: true,
    locked: true,
  });
  const same = (id: EntityId | Handle) => !r.touched.has(id);
  for (const id of ids) {
    const was = r.originals.get(id);
    if (was && same(id)) b.updateEntity(id, patchBack(was, b.entity(id)!));
  }
  // A dimension's block and the records carried along with what went out, untouched since.
  for (const u of r.extraction.entities?.updated ?? []) {
    const now = b.entity(u.before.id);
    if (now && same(u.before.id)) b.updateEntity(u.before.id, patchBack(u.before, now));
  }
  for (const u of r.extraction.objects?.updated ?? []) {
    const now = b.object(u.before.handle);
    if (now && same(u.before.handle))
      b.updateObject(u.before.handle, patchBack(u.before, now) as never);
  }
}
