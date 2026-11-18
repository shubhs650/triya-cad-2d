// BATTMAN's edit (M5-03 part 2): a block's attribute definitions changed as AutoCAD 2024's Block
// Attribute Manager changes them (AutoCAD Help, "Block Attribute Manager", "Edit Attribute Dialog
// Box (BATTMAN)", "Block Attribute Settings Dialog Box"):
//
// - an Edit Attribute dialog's changes (tag, prompt, default, the Invisible/Verify/Preset modes,
//   text options and properties) go on the ATTDEF itself, keeping its handle;
// - Move Up and Move Down put the definitions in another order in the block (the order a new
//   reference asks for their values in); the block's other entities keep their places;
// - Remove erases a definition from the block.
//
// With "Apply changes to existing references" each reference then takes the definitions as
// ATTSYNC gives them (`syncAttributes`); a renamed tag keeps the value the references hold
// under the old one, as AutoCAD's manager keeps it. Constant and Multiple lines are a
// definition's kind, not modes the manager changes (Help: "you cannot change this mode").
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  DrawingField,
  Entity,
  InsertAttribute,
  InsertGeometry,
} from '../model/types';
import type { EntityPatch } from '../model/update';
import type { AttributeDefinitionEntry, AttributeDefinitionPatch } from '../commands/prompt';
import type { TextOutline } from '../commands/view/host';
import { definitionEntry, patchAttribute, valueEntry } from '../commands/modify/attributes';
import { isXrefRecord, loadedXrefHandles } from '../model/xref';

/** DXF 70 bits the manager changes: invisible, verify, preset. Constant (2) stays. */
const CHANGEABLE_FLAGS = 1 | 4 | 8;

/** What one Apply of the Block Attribute Manager does to a block. */
export interface DefinitionChanges {
  /** The block's ATTDEFs (removed ones aside) in their new order. */
  readonly order: readonly Handle[];
  readonly removed: readonly Handle[];
  readonly attributes: readonly AttributeDefinitionPatch[];
  /**
   * The fields of each default changed, by the ATTDEF's handle (M5-03 part 4): the patch's value
   * is then the text the default shows, and the definition takes these fields (undefined: none).
   * A default changed without an entry here holds its text alone.
   */
  readonly fields?: ReadonlyMap<Handle, DrawingField | undefined>;
}

/** The block's ATTDEF entities, constant ones too, in block order. */
export function definitionsOf(model: DocumentModel, block: Handle): Entity[] {
  return model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'ATTDEF');
}

/** One ATTDEF as BATTMAN lists it: its own prompt, its default as the value. */
export function definitionManagerEntry(e: Entity): AttributeDefinitionEntry {
  const d = e.geom as AttdefGeometry;
  return {
    ...definitionEntry(e, d.mtext ? d.mtext.contents : d.value),
    // The default with its fields as codes (M5-03 part 4).
    ...valueEntry(d),
    prompt: d.prompt,
    lockPosition: d.lockPosition === true,
  };
}

/** A tag the manager takes: not empty, no spaces (AutoCAD's dialogs refuse them). */
export const validTag = (tag: string): boolean => tag.trim() !== '' && !/\s/.test(tag.trim());

/** The ATTDEF as an attribute (its fields and its entity's properties) for `patchAttribute`. */
function asAttribute(e: Entity): InsertAttribute {
  const { kind: _kind, prompt: _prompt, ...fields } = e.geom as AttdefGeometry;
  return {
    handle: e.handle,
    layer: e.layer,
    color: e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
    transparency: e.transparency,
    ltScale: e.ltScale,
    visible: e.visible,
    ...(e.plotStyle !== undefined && { plotStyle: e.plotStyle }),
    ...fields,
  };
}

/**
 * The ATTDEF `e` with patch `p`; the same entity's geometry and properties, or undefined when
 * nothing changes. `outline` is its tag as drawn now (a new single-line justification keeps
 * the insertion point, as EATTEDIT's does).
 */
function patched(
  e: Entity,
  p: AttributeDefinitionPatch,
  outline?: TextOutline,
  fieldsOf?: ReadonlyMap<Handle, DrawingField | undefined>,
): EntityPatch | undefined {
  const d = e.geom as AttdefGeometry;
  let a = patchAttribute(asAttribute(e), p, outline);
  const field = fieldsOf?.has(e.handle) ? fieldsOf.get(e.handle) : a.field;
  if (JSON.stringify(field) !== JSON.stringify(a.field)) {
    const { field: _was, ...rest } = a;
    a = field ? { ...rest, field } : rest;
  }
  const {
    handle: _h,
    layer,
    color,
    linetype,
    lineweight,
    transparency: _t,
    ltScale: _l,
    visible: _v,
    plotStyle,
    ...fields
  } = a;
  let geom: AttdefGeometry = { ...fields, kind: 'ATTDEF', prompt: d.prompt };
  if (p.tag !== undefined && validTag(p.tag)) geom = { ...geom, tag: p.tag.trim().toUpperCase() };
  // A constant definition has no prompt (AutoCAD's dialog greys it).
  if (p.prompt !== undefined && (d.flags & 2) === 0) geom = { ...geom, prompt: p.prompt };
  if (p.flags !== undefined) {
    const flags = (d.flags & ~CHANGEABLE_FLAGS) | (p.flags & CHANGEABLE_FLAGS);
    geom = { ...geom, flags: (flags & 2) !== 0 ? flags & ~(4 | 8) : flags };
  }
  // A multiline default is both DXF 1 and the embedded MTEXT's contents (`attdefGeometry`).
  if (d.mtext && p.value !== undefined) geom = { ...geom, value: p.value };
  const next = { geom, layer, color, linetype, lineweight, plotStyle };
  const was = {
    geom: e.geom,
    layer: e.layer,
    color: e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
    plotStyle: e.plotStyle,
  };
  return JSON.stringify(next) === JSON.stringify(was) ? undefined : next;
}

/** The references to `block` the drawing owns: in its spaces and blocks, not inside an xref. */
export function referencesTo(model: DocumentModel, block: Handle): EntityId[] {
  const xref = loadedXrefHandles(model);
  const out: EntityId[] = [];
  for (const [owner] of model.blocks) {
    const r = model.tables.blockRecords.get(owner);
    if (xref.has(owner) || isXrefRecord(r) || r?.name.includes('|')) continue;
    for (const id of model.blockEntities(owner)) {
      const g = model.entity(id)?.geom;
      if (g?.kind === 'INSERT' && g.block === block) out.push(id);
    }
  }
  return out;
}

/**
 * Applies `changes` to `block`'s attribute definitions. With `renameReferences`, each
 * reference's attributes under a renamed tag take the new tag, so the ATTSYNC that follows keeps
 * their values. Returns whether anything changed; a tag that is not valid is left as it was.
 */
export function changeDefinitions(
  b: ChangeSetBuilder,
  model: DocumentModel,
  block: Handle,
  changes: DefinitionChanges,
  outlines: ReadonlyMap<Handle, TextOutline> = new Map(),
  renameReferences = false,
): boolean {
  const defs = definitionsOf(model, block);
  const byHandle = new Map(defs.map((e) => [e.handle, e]));
  let changed = false;
  // Edits, each ATTDEF keeping its handle.
  const renamed = new Map<string, string>();
  for (const p of changes.attributes) {
    const e = byHandle.get(p.handle);
    if (!e || changes.removed.includes(p.handle)) continue;
    const next = patched(e, p, outlines.get(p.handle), changes.fields);
    if (!next) continue;
    // A plot style of undefined is ByLayer: the patch takes it off.
    b.updateEntity(e.id, next);
    changed = true;
    const from = (e.geom as AttdefGeometry).tag.toUpperCase();
    const to = (next.geom as AttdefGeometry).tag;
    if (from !== to.toUpperCase()) renamed.set(from, to);
  }
  // Removals.
  for (const h of changes.removed) {
    const e = byHandle.get(h);
    if (!e) continue;
    b.removeEntity(e.id);
    changed = true;
  }
  // The new order: the ATTDEFs' places in the block filled in the order given. Everything from
  // the first place that differs is moved to the end in turn (each keeps its handle), so the
  // entities before it are not touched.
  const kept = defs.filter((e) => !changes.removed.includes(e.handle));
  const wanted = changes.order
    .map((h) => byHandle.get(h))
    .filter((e): e is Entity => e !== undefined && kept.includes(e));
  if (wanted.length === kept.length && wanted.some((e, i) => e !== kept[i])) {
    const removed = new Set(changes.removed);
    const now = model
      .blockEntities(block)
      .filter((id) => !removed.has(model.entity(id)!.handle))
      .map((id) => model.entity(id)!);
    let slot = 0;
    const want = now.map((e) => (e.geom.kind === 'ATTDEF' ? wanted[slot++]! : e));
    const first = want.findIndex((e, i) => e !== now[i]);
    for (const e of want.slice(first)) b.moveEntity(e.id, block);
    changed = true;
  }
  if (renameReferences && renamed.size > 0) renameTags(b, model, block, renamed);
  return changed;
}

/** Each reference's attributes under a renamed tag given the new one, values kept. */
function renameTags(
  b: ChangeSetBuilder,
  model: DocumentModel,
  block: Handle,
  renamed: ReadonlyMap<string, string>,
): void {
  for (const id of referencesTo(model, block)) {
    const g = model.entity(id)!.geom as InsertGeometry;
    let touched = false;
    const attributes = g.attributes.map((a) => {
      const to = renamed.get(a.tag.toUpperCase());
      if (to === undefined) return a;
      touched = true;
      return { ...a, tag: to };
    });
    if (touched) b.updateEntity(id, { geom: { ...g, attributes } });
  }
}
