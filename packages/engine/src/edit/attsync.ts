// ATTSYNC's edit (M5-02 part 2): every reference to a block given the attributes its definition
// now has, as AutoCAD 2024's ATTSYNC does (AutoCAD Help, "ATTSYNC (Command)": "Updates block
// references with new and changed attributes from a specified block definition ... Values
// assigned to existing attributes in the blocks are not changed"):
//
// - an attribute whose tag the definition still has keeps its value, and its handle (a save
//   rewrites the same ATTRIB), and takes the definition's properties placed as the reference
//   places the block (position, height, style, justification, layer, colour ...);
// - a definition the reference lacks adds an attribute holding its default value;
// - an attribute whose tag the definition no longer has is removed; constant definitions carry no
//   attribute (AutoCAD keeps their value in the block).
//
// Tags match case aside, in order where a tag repeats. References inside an xref are the xref's
// and stay as they are.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { AttdefGeometry, InsertAttribute, InsertGeometry } from '../model/types';
import { isXrefRecord, loadedXrefHandles } from '../model/xref';
import { attributeDefinitions, referenceGeometry } from './blocks';

/** The value an attribute holds: a multiline one's contents. */
const valueOf = (a: InsertAttribute): string => (a.mtext ? a.mtext.contents : a.value);

/** Whether the block's definition or any reference to it has attributes (ATTSYNC takes it). */
export function hasAttributes(model: DocumentModel, block: Handle): boolean {
  for (const id of model.blockEntities(block)) {
    if (model.entity(id)?.geom.kind === 'ATTDEF') return true;
  }
  return referencesTo(model, block).some(
    (id) => (model.entity(id)!.geom as InsertGeometry).attributes.length > 0,
  );
}

/** The references to `block` the drawing owns: in its spaces and blocks, not inside an xref. */
function referencesTo(model: DocumentModel, block: Handle) {
  const xref = loadedXrefHandles(model);
  const out = [];
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

/** `g`'s attributes as the definitions `defs` of its block make them now. */
function syncedAttributes(
  b: ChangeSetBuilder,
  model: DocumentModel,
  g: InsertGeometry,
  defs: ReturnType<typeof attributeDefinitions>,
): InsertAttribute[] {
  // The reference's attributes by tag, each tag's in order, taken as definitions claim them.
  const byTag = new Map<string, InsertAttribute[]>();
  for (const a of g.attributes) {
    const tag = a.tag.toUpperCase();
    byTag.set(tag, [...(byTag.get(tag) ?? []), a]);
  }
  const kept = defs.map((d) => byTag.get((d.geom as AttdefGeometry).tag.toUpperCase())?.shift());
  const values = defs.map((d, i) => {
    const a = kept[i];
    return a ? valueOf(a) : (d.geom as AttdefGeometry).value;
  });
  const placed = referenceGeometry(
    model,
    g.block,
    { position: g.position, scale: g.scale, rotation: g.rotation },
    defs,
    values,
  );
  return placed.attributes.map((a, i) => ({
    ...a,
    handle: kept[i]?.handle ?? b.allocateHandle(),
  }));
}

/**
 * ATTSYNC: every reference to `block` given its definition's attributes. Returns how many
 * references there were.
 */
export function syncAttributes(b: ChangeSetBuilder, model: DocumentModel, block: Handle): number {
  const defs = attributeDefinitions(model, block);
  const refs = referencesTo(model, block);
  for (const id of refs) {
    const g = model.entity(id)!.geom as InsertGeometry;
    b.updateEntity(id, { geom: { ...g, attributes: syncedAttributes(b, model, g, defs) } });
  }
  return refs.length;
}
