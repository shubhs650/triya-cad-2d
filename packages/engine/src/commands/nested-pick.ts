// Picks of objects nested in blocks and xrefs for the layer tools (M5-06 part 5), as AutoCAD
// 2024 takes them (AutoCAD Help, "LAYOFF (Command)" and "LAYFRZ (Command)", Settings > Block
// selection: "Enter Block Selection nesting level [Block/Entity/None] <Block>"):
//
//   - Block: "If a selected object is nested in a block, the layer of that block is turned off.
//     If a selected object is nested in an xref, the layer of the object is turned off."
//   - Entity: "Turns off layers of selected objects even if they are nested in an xref or a
//     block."
//   - None: "If a block or an xref is selected, the layer containing that block or xref is
//     turned off."
//
// The canvas says which object a pick hit inside the reference it took (the `nested` view
// request), since what a pick hits depends on what is drawn. A dimension, table or multileader
// in a block is hit whole. An object on layer 0 inside a block is drawn on the layer of the
// reference holding it, so that is the layer a pick on it takes, as the drafter sees it (AutoCAD's
// help does not say; turning off layer 0 would hide nothing that was picked).
//
// LAYOFF and LAYFRZ keep the setting. LAYLCK, LAYULK, LAYMCUR, LAYISO, LAYDEL and LAYMRG have
// none in AutoCAD, whose help only says they take "the layer of a selected object"; they take
// the nested object's layer (Entity), as the Express Tools they came from did with nested
// selection, so a drafter can lock or isolate a layer of an xref by picking on it.
import type { CommandContext } from './command';
import type { PromptAnswer, SelectionTake } from './prompt';
import type { EntityId } from '../model/entity-ids';
import type { Vec2 } from '../geom/types';
import type { LayerRecord } from '../model/types';
import { isXrefRecord } from '../model/xref';

/** AutoCAD's Block selection nesting level. */
export type BlockSelection = 'Block' | 'Entity' | 'None';

export const BLOCK_SELECTIONS: readonly BlockSelection[] = ['Block', 'Entity', 'None'];

type SelectionAnswer = Extract<PromptAnswer, { kind: 'selection' }>;

const isLayerZero = (l: LayerRecord | undefined) => l?.name === '0';

/** The layer of an object of the space shown, as it is drawn there. */
function ownLayer(ctx: CommandContext, id: EntityId | undefined): LayerRecord | undefined {
  const e = id === undefined ? undefined : ctx.model.entity(id);
  return e && ctx.model.tables.layers.get(e.layer);
}

/**
 * The layer of the object picked at `pick` that took `id`, followed into the block reference
 * `id` as `mode` says; the object's own layer when it is no reference or the canvas finds nothing
 * inside it there.
 */
export async function layerAtPick(
  ctx: CommandContext,
  id: EntityId | undefined,
  pick: Vec2 | undefined,
  mode: BlockSelection,
): Promise<LayerRecord | undefined> {
  const top = id === undefined ? undefined : ctx.model.entity(id);
  if (!top || top.geom.kind !== 'INSERT' || !pick || mode === 'None') return ownLayer(ctx, id);
  const r = await ctx.view.request({ op: 'nested', point: pick, id: top.id });
  const nested = r.ok && r.nested?.path[0] === top.id ? r.nested : undefined;
  const path = nested?.path ?? [];
  const attribute = nested?.attribute;
  // The reference itself (its XCLIP frame), or nothing of it, was hit.
  if (path.length < (attribute === undefined ? 2 : 1)) return ownLayer(ctx, id);
  const entities = path.map((p) => ctx.model.entity(p));
  if (entities.some((e) => !e)) return ownLayer(ctx, id);
  // The references holding the object: every entry but the object itself, unless the pick hit
  // an attribute, whose reference is the last entry.
  const holders = attribute === undefined ? entities.slice(0, -1) : entities;
  const inXref = holders.some(
    (e) =>
      e!.geom.kind === 'INSERT' && isXrefRecord(ctx.model.tables.blockRecords.get(e!.geom.block)),
  );
  if (mode === 'Block' && !inXref) return ownLayer(ctx, id);
  const leaf = entities[entities.length - 1]!;
  const leafGeom = leaf.geom;
  const attrib =
    attribute !== undefined && leafGeom.kind === 'INSERT'
      ? leafGeom.attributes.find((a) => a.handle === attribute)
      : undefined;
  let layer = ctx.model.tables.layers.get(attrib ? attrib.layer : leaf.layer);
  // Layer 0 inside a block draws on the layer of the reference holding it, and so on outward.
  for (let i = holders.length - 1; i >= 0 && isLayerZero(layer); i--)
    layer = ctx.model.tables.layers.get(holders[i]!.layer);
  return layer ?? ownLayer(ctx, id);
}

/** The layer of the one object a single pick (or pre-selection) took. */
export function pickedLayer(
  ctx: CommandContext,
  a: SelectionAnswer,
  mode: BlockSelection,
): Promise<LayerRecord | undefined> {
  return layerAtPick(ctx, a.ids[0], a.pick, mode);
}

/**
 * The layers of the objects selected, each in the order first selected: an object a pick took
 * alone is followed into the reference as `mode` says; one a window, ALL or the pre-selection
 * took is taken whole.
 */
export async function selectedLayers(
  ctx: CommandContext,
  a: SelectionAnswer,
  mode: BlockSelection,
): Promise<LayerRecord[]> {
  const picks = new Map<EntityId, Vec2>();
  for (const t of a.takes ?? ([] as SelectionTake[]))
    if (t.pick && !t.window && t.ids.length === 1) picks.set(t.ids[0]!, t.pick);
  const out: LayerRecord[] = [];
  for (const id of a.ids) {
    const l = await layerAtPick(ctx, id, picks.get(id), mode);
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}
