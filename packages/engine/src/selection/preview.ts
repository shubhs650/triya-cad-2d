// Selection preview (M3-04 part 5; AutoCAD 2024 Help, "SELECTIONPREVIEW (System Variable)" and
// "PREVIEWFILTER (System Variable)"): "objects are highlighted when the pickbox cursor rolls over
// them. The highlighting indicates that the object would be selected if you clicked it."
//   - SELECTIONPREVIEW is a bitcode kept per user (Saved in: Registry), initially 3: 1 on when
//     no command is active, 2 on when a command prompts for object selection;
//   - PREVIEWFILTER, also per user and initially 3, excludes object types from the preview:
//     1 objects on locked layers, 2 objects in xrefs, 4 tables, 8 multiline text, 16 hatches,
//     32 objects in groups. An excluded object can still be picked: only its preview goes.
// The front-end asks which objects to preview for the object under the pickbox. With group
// selection on (PICKSTYLE bit 1) the pick would take the object's selectable groups too, so
// they preview with it, unless PREVIEWFILTER excludes objects in groups.
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Group } from '../model/types';
import { selectableMembers } from '../edit/groups';

export const SELECTIONPREVIEW = 'SELECTIONPREVIEW';
export const PREVIEWFILTER = 'PREVIEWFILTER';
/** SELECTIONPREVIEW's bits: at `Command:`, and at a command's object selection prompt. */
export const PREVIEW_AT_COMMAND = 1;
export const PREVIEW_SELECTING = 2;
export const DEFAULT_SELECTIONPREVIEW = 3;
/** PREVIEWFILTER's bits, as AutoCAD numbers them. */
export const PREVIEW_NOT_LOCKED = 1;
export const PREVIEW_NOT_XREFS = 2;
export const PREVIEW_NOT_TABLES = 4;
export const PREVIEW_NOT_MTEXT = 8;
export const PREVIEW_NOT_HATCHES = 16;
export const PREVIEW_NOT_GROUPED = 32;
export const DEFAULT_PREVIEWFILTER = 3;

export interface PreviewOptions {
  /** PREVIEWFILTER's bits. */
  readonly filter: number;
  /** Group selection is on (PICKSTYLE bit 1): a member previews its group's other members. */
  readonly groups: boolean;
  /** The space shown, whose members of a group are taken with it. */
  readonly space: Handle;
}

/**
 * The objects that preview when the pickbox is over object `id`: none when PREVIEWFILTER
 * excludes it, else it and, with group selection, the selectable members of its groups.
 */
export function previewObjects(model: DocumentModel, id: EntityId, o: PreviewOptions): EntityId[] {
  const e = model.entity(id);
  if (!e) return [];
  const f = o.filter;
  if (f & PREVIEW_NOT_LOCKED && model.tables.layers.get(e.layer)?.locked) return [];
  const g = e.geom;
  if (f & PREVIEW_NOT_XREFS && g.kind === 'INSERT' && model.blocks.get(g.block)?.xrefPath)
    return [];
  if (f & PREVIEW_NOT_TABLES && g.kind === 'ACAD_TABLE') return [];
  if (f & PREVIEW_NOT_MTEXT && g.kind === 'MTEXT') return [];
  if (f & PREVIEW_NOT_HATCHES && g.kind === 'HATCH') return [];
  const groups = groupsHolding(model, e.handle, e.reactors);
  if (groups.length === 0) return [id];
  if (f & PREVIEW_NOT_GROUPED) return [];
  if (!o.groups) return [id];
  const out = [id];
  for (const group of groups) {
    if (!group.selectable) continue;
    for (const m of selectableMembers(model, group, o.space)) if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** The groups holding `handle`, found through its reactors (each member lists them). */
function groupsHolding(
  model: DocumentModel,
  handle: Handle,
  reactors: readonly Handle[] | undefined,
): Group[] {
  const out: Group[] = [];
  for (const r of reactors ?? []) {
    const o = model.objects.get(r);
    if (o?.type === 'GROUP' && (o as Group).entities.includes(handle)) out.push(o as Group);
  }
  return out;
}
