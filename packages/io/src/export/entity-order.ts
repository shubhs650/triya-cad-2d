// TriyaToAcad for where an entity sits (M1-75 part 24): moving it to another block (CHSPACE,
// BLOCK's Convert to block, the engine's `moveEntity`) and the order of a block's entities.
//
// A moved entity keeps its handle, extension dictionary, xdata and reactors: acad-ts's
// `CadObjectCollection.moveTo` (patch 0161) changes its owner without unregistering it from the
// document, which `remove` and `add` would do (they give it a new handle). Its draw order entry
// in the old block goes, as AutoCAD keeps no entry for an entity outside the block.
//
// A block's entities are written in the order the engine lists them (block order is file order,
// which is the draw order of a block without a SORTENTSTABLE). Entities Triya does not map (a
// MESH, a 3DSOLID) stay right after the mapped entity they followed when read.

import {
  BlockRecord,
  Entity as AcadEntity,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Entity, EntityInit, Handle } from '@triya/engine';
import { resolve, same, type Resolver } from './entities';

/** BLOCK DXF 70 bits of an xref (4 xref, 8 overlay) and of what an xref brings (16, 32). */
const XREF_FLAGS = 4 | 8 | 16 | 32;

export interface Move {
  readonly acad: AcadEntity;
  readonly block: BlockRecord;
}

/**
 * Why `before`, moved to `after.owner`, cannot be saved: a viewport belongs to its layout's
 * block (AutoCAD's CHSPACE does not take viewports either), and an xref's block holds what the
 * xref file states, so nothing moves in or out of one.
 */
export function moveProblems(
  model: DocumentModel,
  r: Resolver,
  before: EntityInit,
  after: Entity,
): { block?: BlockRecord; problems: string[] } {
  const what = `${after.type} ${after.handle}`;
  if (after.type === 'VIEWPORT')
    return { problems: [`${what}: a viewport moves to another block`] };
  const xref = (h: string): boolean =>
    ((model.tables.blockRecords.get(h)?.flags ?? 0) & XREF_FLAGS) !== 0;
  if (xref(before.owner) || xref(after.owner))
    return { problems: [`${what}: moves into or out of an xref block`] };
  const block = resolve(r, after.owner, BlockRecord);
  if (!block) return { problems: [`${what}: owner block ${after.owner} is not in the drawing`] };
  return { block, problems: [] };
}

/**
 * A file that states no entity handles (before R11, or R12 with $HANDLING 0) has them numbered
 * in file order on read (`CadDocument.madeUpHandles`), so an entity that moves or changes place
 * would come back under another handle, and so would the entities after it. There survivors keep
 * their order and new entities follow them.
 */
export function madeUpOrderProblems(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
): string[] {
  const madeUp = doc.madeUpHandles;
  if (!madeUp) return [];
  const isMadeUp = (h: Handle): boolean => {
    const n = Number.parseInt(h, 16);
    return n >= madeUp.first && n <= madeUp.last;
  };
  const why = 'the file states no entity handles, so they are numbered in file order on read';
  const out: string[] = [];
  const baseOrder = new Map<Handle, Handle[]>();
  for (const e of base.entities ?? []) {
    const list = baseOrder.get(e.owner) ?? [];
    list.push(e.handle);
    baseOrder.set(e.owner, list);
    const now = model.entityByHandle(e.handle);
    if (now && now.owner !== e.owner && isMadeUp(e.handle))
      out.push(`${now.type} ${e.handle}: moves to another block, and ${why}`);
  }
  for (const block of model.blocks.keys()) {
    const old = (baseOrder.get(block) ?? []).filter(
      (h) => isMadeUp(h) && model.entityByHandle(h)?.owner === block,
    );
    if (old.length === 0) continue;
    const oldSet = new Set(old);
    const now = model.blockEntities(block).map((id) => model.entity(id)!.handle);
    const survivors = now.filter((h) => oldSet.has(h));
    const lastOld = now.findIndex((h) => h === old.at(-1));
    // An entity new to the block is written without a handle too, so it must follow them.
    const had = new Set(baseOrder.get(block));
    const firstNew = now.findIndex((h) => !had.has(h));
    if (!same(survivors, old) || (firstNew >= 0 && firstNew < lastOld))
      out.push(`entity order in block ${block} changes, and ${why}`);
  }
  return out;
}

/** Moves each entity to its new block, leaving its old block's draw order table. */
export function writeMoves(moves: readonly Move[]): void {
  for (const { acad, block } of moves) {
    const from = acad.owner as BlockRecord;
    from.sortEntitiesTable?.remove(acad);
    from.entities.moveTo(acad, block.entities);
  }
}

/**
 * Puts every block's entities in the engine's order, after the save's removals, moves and
 * additions. A block whose order is unchanged is not touched.
 */
export function writeEntityOrder(doc: CadDocument, model: DocumentModel, r: Resolver): void {
  for (const handle of model.blocks.keys()) {
    const block = resolve(r, handle, BlockRecord);
    if (!block) continue;
    const want = model
      .blockEntities(handle)
      .map((id) => entityOf(doc, r, model.entity(id)!))
      .filter((e): e is AcadEntity => e !== undefined && e.owner === block);
    const current = [...block.entities];
    const mapped = new Set<CadObject>(want);
    // Unmapped entities ride along after the mapped one they followed.
    const head: AcadEntity[] = [];
    const after = new Map<AcadEntity, AcadEntity[]>();
    let last: AcadEntity | undefined;
    for (const e of current) {
      if (mapped.has(e)) last = e;
      else if (last) after.set(last, [...(after.get(last) ?? []), e]);
      else head.push(e);
    }
    const order = [...head, ...want.flatMap((e) => [e, ...(after.get(e) ?? [])])];
    if (order.every((e, i) => e === current[i])) continue;
    block.entities.reorder(order);
  }
}

function entityOf(doc: CadDocument, r: Resolver, e: Entity): AcadEntity | undefined {
  const o = r.created.get(e.handle) ?? doc.getCadObject(Number.parseInt(e.handle, 16));
  return o instanceof AcadEntity ? o : undefined;
}
