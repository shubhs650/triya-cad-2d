// Block authoring and insertion (M5-01): what BLOCK and INSERT make, apart from their prompts
// (commands/blocks.ts). AutoCAD 2024 Help, "BLOCK (Command)", "-BLOCK (Command)", "INSERT
// (Command)", "-INSERT (Command)", "About Defining Blocks", "About Inserting Blocks":
//
// - a block holds copies of the objects selected, in the coordinates of the UCS current when it
//   was made ("the block definition is created in the current UCS"), based at the point given;
//   its units are the drawing's INSUNITS. Redefining a block replaces what it holds and its
//   base point; every reference draws the new contents at once, its attributes staying as they
//   are until ATTSYNC (M5-02);
// - a reference places the block's base point at the insertion point, scaled along the block's
//   own axes and turned; each attribute definition that is not constant becomes an attribute of
//   the reference, placed as the definition is in the block, with the value given.
//
// A block cannot hold a reference to itself, however deeply nested: AutoCAD refuses the
// selection ("Block references itself"), and so does Triya.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  BlockTableRecord,
  Entity,
  InsertAttribute,
  InsertGeometry,
} from '../model/types';
import type { GeneralProps } from '../properties/sheet';
import { insUnitsOf } from '../model/units';
import { isXrefRecord } from '../model/xref';
import { followedBy, moveBy, scaleAbout, turnAbout, type Similarity } from './similarity';
import { rescaledReference, transformGeometry } from './transform';
import { copyObjects, eraseObjects, type EditReport } from './edit';
import { validViewName } from './named-view';

/** DXF 70 of an ATTDEF: the value never changes, so references carry no attribute for it. */
export const ATTRIBUTE_CONSTANT = 2;
/** DXF 70: the value is asked for twice (INSERT's "Verify attribute values"). */
export const ATTRIBUTE_VERIFY = 4;
/** DXF 70: the default value is taken without asking. */
export const ATTRIBUTE_PRESET = 8;

/** A UCS in plan: its origin and the world angle of its X axis (`input/ucs.ts`'s `PlanUcs`). */
export interface BlockFrame {
  readonly origin: Vec2;
  readonly angle: number;
}

/** The block record named `name` (case aside), the anonymous and layout blocks included. */
export function blockNamed(model: DocumentModel, name: string): BlockTableRecord | undefined {
  const upper = name.trim().toUpperCase();
  for (const r of model.tables.blockRecords.values()) {
    if (r.name.toUpperCase() === upper) return r;
  }
  return undefined;
}

/**
 * Why `name` cannot name a block the drafter makes: AutoCAD's symbol name rules (up to 255
 * characters, none of < > / \ " : ; ? * | , = `), and no leading `*`, which names the anonymous
 * and layout blocks AutoCAD makes itself.
 */
export function blockNameProblem(name: string): string | undefined {
  const n = name.trim();
  if (n === '' || n.startsWith('*') || !validViewName(n)) return 'Invalid block name.';
  return undefined;
}

/** The blocks a drafter can insert: named, not a layout's, not an xref's, sorted by name. */
export function insertableBlocks(model: DocumentModel): BlockTableRecord[] {
  return [...model.tables.blockRecords.values()]
    .filter((r) => !r.name.startsWith('*') && !isXrefRecord(r) && model.hasBlock(r.handle))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** True when `block` holds a reference to `target`, at any depth (or is `target`). */
export function blockReaches(
  model: DocumentModel,
  block: Handle,
  target: Handle,
  seen = new Set<Handle>(),
): boolean {
  if (block === target) return true;
  if (seen.has(block)) return false;
  seen.add(block);
  for (const id of model.blockEntities(block)) {
    const g = model.entity(id)?.geom;
    if (g?.kind === 'INSERT' && blockReaches(model, g.block, target, seen)) return true;
  }
  return false;
}

/** The selected objects that are, or hold, a reference to `target` (BLOCK refuses them). */
export function selfReferences(
  model: DocumentModel,
  ids: readonly EntityId[],
  target: Handle,
): EntityId[] {
  return ids.filter((id) => {
    const g = model.entity(id)?.geom;
    return g?.kind === 'INSERT' && blockReaches(model, g.block, target);
  });
}

/** World coordinates into `ucs`'s: the move and turn that BLOCK carries the objects by. */
function intoFrame(ucs: BlockFrame): Similarity {
  const move = moveBy({ x: -ucs.origin.x, y: -ucs.origin.y });
  return ucs.angle === 0 ? move : followedBy(move, turnAbout({ x: 0, y: 0 }, -ucs.angle));
}

export interface BlockDefinitionInit {
  readonly name: string;
  /** The base point, in world coordinates. */
  readonly base: Vec2;
  readonly ids: readonly EntityId[];
  /** The UCS current when the block is made; the world when absent. */
  readonly ucs?: BlockFrame;
  /** Remove the objects once copied into the block (-BLOCK, and the dialog's Delete). */
  readonly erase?: boolean;
}

export interface BlockDefinitionReport extends EditReport {
  /** The block's record. */
  readonly block: Handle;
  /** True when an existing block of the name was redefined. */
  readonly redefined: boolean;
}

/**
 * BLOCK: a block named `init.name` holding copies of `init.ids`, made or, where one of the name
 * exists, redefined. The caller has checked the name (`blockNameProblem`), that an existing block
 * is no xref, and that the objects hold no reference to it (`selfReferences`).
 */
export function defineBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  init: BlockDefinitionInit,
): BlockDefinitionReport {
  const t = intoFrame(init.ucs ?? { origin: { x: 0, y: 0 }, angle: 0 });
  const basePoint = transformGeometry({ kind: 'POINT', position: init.base }, t);
  const base = (basePoint as { position: Vec2 }).position;
  const existing = blockNamed(model, init.name);
  let block: Handle;
  if (existing && model.hasBlock(existing.handle)) {
    block = existing.handle;
    eraseObjects(b, model, b.blockEntities(block));
    b.updateBlock(block, { basePoint: base });
  } else {
    const units = insUnitsOf(model);
    block = b.addBlock({
      name: init.name.trim(),
      basePoint: base,
      ...(units !== 0 ? { units } : {}),
    }).handle;
  }
  const report = copyObjects(b, model, init.ids, t, {}, block);
  if (init.erase) eraseObjects(b, model, init.ids);
  return { ...report, block, redefined: existing !== undefined };
}

/** The block's attribute definitions that references carry (not constant), in block order. */
export function attributeDefinitions(model: DocumentModel, block: Handle): Entity[] {
  return model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .filter(
      (e) =>
        e.geom.kind === 'ATTDEF' && ((e.geom as AttdefGeometry).flags & ATTRIBUTE_CONSTANT) === 0,
    );
}

/** Where a reference puts its block: insertion point, X/Y/Z scale and rotation (world). */
export interface BlockPlacement {
  readonly position: Vec2;
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: number;
}

/**
 * The reference geometry of `block` at `p`, with an attribute for each of `definitions` (from
 * `attributeDefinitions`) holding `values[i]`, placed by the same placement as the block. Its
 * attributes have no handles yet (`placeReference` gives them theirs).
 */
export function referenceGeometry(
  model: DocumentModel,
  block: Handle,
  p: BlockPlacement,
  definitions: readonly Entity[] = [],
  values: readonly string[] = [],
): InsertGeometry {
  const def = model.blocks.get(block)!;
  // The attributes as the definitions stand in the block, the reference at the block's own base
  // point unscaled; then moved, scaled uniformly, turned and finally stretched to the X/Y/Z
  // scale, as a reference whose scale is changed carries them (`rescaledReference`).
  const attributes: InsertAttribute[] = definitions.map((e, i) => {
    const { kind: _kind, prompt: _prompt, ...fields } = e.geom as AttdefGeometry;
    const value = values[i] ?? fields.value;
    return {
      handle: '0',
      layer: e.layer,
      ...(e.color !== undefined && { color: e.color }),
      ...(e.linetype !== undefined && { linetype: e.linetype }),
      ...(e.lineweight !== undefined && { lineweight: e.lineweight }),
      ...(e.transparency !== undefined && { transparency: e.transparency }),
      ...(e.ltScale !== undefined && { ltScale: e.ltScale }),
      ...(e.visible !== undefined && { visible: e.visible }),
      ...fields,
      value,
      ...(fields.mtext && { mtext: { ...fields.mtext, contents: value } }),
    } as InsertAttribute;
  });
  const at: InsertGeometry = {
    kind: 'INSERT',
    block,
    position: def.basePoint,
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes,
  };
  const k = Math.abs(p.scale.x) || 1;
  let t = moveBy({ x: p.position.x - def.basePoint.x, y: p.position.y - def.basePoint.y });
  if (k !== 1) t = followedBy(t, scaleAbout(p.position, k));
  if (p.rotation !== 0) t = followedBy(t, turnAbout(p.position, p.rotation));
  const placed = transformGeometry(at, t) as InsertGeometry;
  const same = placed.scale.x === p.scale.x && placed.scale.y === p.scale.y;
  const out = same && placed.scale.z === p.scale.z ? placed : rescaledReference(placed, p.scale);
  return { ...out, rotation: p.rotation };
}

/**
 * INSERT: a reference to `block` in `owner` with `props`, from `referenceGeometry`. With
 * `explode` (a name typed as `*NAME`), the block's contents are copied out where the reference
 * would put them and no reference is kept, as AutoCAD's explode on insert does; the placement
 * must then scale uniformly. Returns what was added.
 */
export function placeReference(
  b: ChangeSetBuilder,
  model: DocumentModel,
  owner: Handle,
  props: GeneralProps,
  geom: InsertGeometry,
  explode = false,
): EditReport {
  if (explode) {
    const def = model.blocks.get(geom.block)!;
    const p = geom.position;
    let t = moveBy({ x: p.x - def.basePoint.x, y: p.y - def.basePoint.y });
    if (geom.scale.x !== 1) t = followedBy(t, scaleAbout(p, geom.scale.x));
    if (geom.rotation !== 0) t = followedBy(t, turnAbout(p, geom.rotation));
    return copyObjects(b, model, model.blockEntities(geom.block), t, {}, owner);
  }
  const attributes = geom.attributes.map((a) => ({ ...a, handle: b.allocateHandle() }));
  const ref = b.addEntity({ owner, ...props, geom: { ...geom, attributes } });
  return { ids: [ref.id], refused: new Map(), unannotated: 0 };
}
