// Selection rules that need the drawing but not its picture (M2-03, ARCHITECTURE.md §4.3): the
// ALL and Last modes and the locked-layer filter. What a pick or a window takes depends on what
// is drawn, so the canvas answers those (the renderer's `select`, packages/render).
//   AutoCAD 2024 Help, "SELECT (Command)": ALL "selects all objects in model space or the
//   current layout, except those objects on frozen or locked layers"; Last "selects the most
//   recently created visible object. The object must be in the current space, model space or
//   paper space, and its layer must not be set to frozen or off".
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity } from '../model/types';

/** A layout's own paper-space view (VIEWPORT id 1) is no object to select. */
function isOverallViewport(e: Entity): boolean {
  return e.geom.kind === 'VIEWPORT' && e.geom.id === 1;
}

/** ALL: the space's objects, but not those on frozen or locked layers (off layers included). */
export function selectAll(model: DocumentModel, space: Handle): EntityId[] {
  if (!model.hasBlock(space)) return [];
  return model.blockEntities(space).filter((id) => {
    const e = model.entity(id);
    if (!e || isOverallViewport(e)) return false;
    const l = model.tables.layers.get(e.layer);
    return !l || (!l.frozen && !l.locked);
  });
}

/** Last: the space's newest object that is visible, on a layer neither off nor frozen. */
export function selectLast(model: DocumentModel, space: Handle): EntityId | undefined {
  if (!model.hasBlock(space)) return undefined;
  const ids = model.blockEntities(space);
  for (let i = ids.length - 1; i >= 0; i--) {
    const e = model.entity(ids[i]!);
    if (!e || !e.visible || isOverallViewport(e)) continue;
    const l = model.tables.layers.get(e.layer);
    if (!l || (l.on && !l.frozen)) return e.id;
  }
  return undefined;
}

/** The objects of `ids` on locked layers, which a command that edits may not take. */
export function onLockedLayers(model: DocumentModel, ids: readonly EntityId[]): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const id of ids) {
    const e = model.entity(id);
    if (e && model.tables.layers.get(e.layer)?.locked) out.add(id);
  }
  return out;
}

/** The objects of `ids` that still exist in `space`, in order. */
export function inSpace(model: DocumentModel, space: Handle, ids: readonly EntityId[]): EntityId[] {
  return ids.filter((id) => model.entity(id)?.owner === space);
}
