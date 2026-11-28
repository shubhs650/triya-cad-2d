// The compare drawing (M8-06, FR-Z3, DEC-092): what COMPARE shows and exports. It is the revision
// (drawing `b`) with every object of its spaces coloured by what `compareDrawings` found, added
// green, modified amber and unchanged grey, and the original's objects it no longer has pasted
// in red where they were: the removed ones, and the previous version of each object whose
// geometry, text, attributes or block changed (a property change alone shows in place).
//
// AutoCAD 2024's COMPARE overlays the compared drawing on the current one in the same colours'
// roles (objects only in the current drawing green, only in the compared drawing red, common grey,
// "Compare Settings"); AutoCAD 2019's DWG Compare wrote the result to a drawing of its own. Triya
// does the latter, as a change set on the revision, so the overlay is a real drawing: drawn,
// plotted to PDF and saved to DXF by the code that draws, plots and saves every drawing.
//
// The revision's handles are kept (an object of the compare drawing is the revision's object, so
// a list row zooms to it by handle) and the pasted copies take handles above its $HANDSEED, as
// every paste does (clipboard.ts). A copy pasted into a drawing with a definition of the same
// name uses the revision's, as PASTECLIP does. The colours go on the objects themselves: the
// parts of a block reference drawn in their own colour keep it (only ByBlock parts follow).
import {
  ChangeSetBuilder,
  copyToClipboard,
  pasteObjects,
  type ChangeSet,
  type Color,
  type DocumentModel,
  type Entity,
  type EntityId,
  type EntityType,
  type Handle,
} from '@triya/engine';
import { spacesOf, type CompareItem, type CompareResult, type CompareStatus } from './compare';

/** What an object of the compare drawing shows. */
export type MarkStatus = CompareStatus | 'unchanged' | 'previous';

/** The overlay's colours (ACI): green, red, amber, red for previous versions, grey. */
export const COMPARE_COLORS: { readonly [K in MarkStatus]: Color } = {
  added: { kind: 'aci', index: 3 },
  removed: { kind: 'aci', index: 1 },
  modified: { kind: 'aci', index: 40 },
  previous: { kind: 'aci', index: 1 },
  unchanged: { kind: 'aci', index: 8 },
};

/** An object of the compare drawing. */
export interface Mark {
  readonly handle: Handle;
  readonly status: MarkStatus;
  /** Its layer's name, as the drawing it came from names it. */
  readonly layer: string;
  readonly type: EntityType;
  readonly space: string;
}

/** A difference with what shows it in the compare drawing. */
export interface MarkedItem extends CompareItem {
  /** The layer of the object as the drawing holding it names it (the revision's, if both). */
  readonly layer: string;
  /**
   * The compare drawing's objects showing it: the revision's object (added, modified), then the
   * original's copy (removed, a modified object's previous version). Empty where the revision
   * has no space of that name to paste a removed object in, or the object cannot be pasted
   * (a layout's viewport, an external reference).
   */
  readonly marks: readonly Handle[];
}

export interface CompareMarkup {
  /** The change set making the revision the compare drawing. */
  readonly change: ChangeSet;
  readonly items: readonly MarkedItem[];
  /** Every object coloured or pasted, the unchanged ones included. */
  readonly marks: readonly Mark[];
}

/** Changes that move what an object draws: its previous version is shown beside it. */
const DRAWN_CHANGES: ReadonlySet<string> = new Set(['geometry', 'text', 'attributes', 'block']);

const layerName = (model: DocumentModel, e: Entity): string =>
  model.tables.layers.get(e.layer)?.name ?? '0';

/**
 * The compare drawing of `result` (`compareDrawings(a, b)`): a change set on `b`, which is left
 * as it is (as is `a`).
 */
export function compareMarkup(
  a: DocumentModel,
  b: DocumentModel,
  result: CompareResult,
): CompareMarkup {
  const builder = new ChangeSetBuilder(b);
  const marks: Mark[] = [];
  const colour = (e: Entity, status: MarkStatus, space: string) => {
    builder.updateEntity(e.id, { color: COMPARE_COLORS[status] });
    marks.push({ handle: e.handle, status, layer: layerName(b, e), type: e.type, space });
  };

  for (const p of result.unchanged) {
    const e = b.entityByHandle(p.b);
    if (e) colour(e, 'unchanged', p.space);
  }

  // The original's objects to paste, by the revision's space they go in.
  const blocks = new Map(spacesOf(b).map((s) => [s.name.toUpperCase(), s.block]));
  const toPaste = new Map<Handle, { space: string; ids: EntityId[] }>();
  const items = result.items.map((item) => {
    const own = item.b === undefined ? undefined : b.entityByHandle(item.b);
    const old = item.a === undefined ? undefined : a.entityByHandle(item.a);
    if (own) colour(own, item.status, item.space);
    const pasted =
      old !== undefined &&
      (item.status === 'removed' || item.changes.some((c) => DRAWN_CHANGES.has(c)));
    const block = blocks.get(item.space.toUpperCase());
    if (pasted && block !== undefined) {
      const list = toPaste.get(block) ?? { space: item.space, ids: [] };
      list.ids.push(old.id);
      toPaste.set(block, list);
    }
    return {
      item,
      own,
      old: pasted ? old : undefined,
      layer: own ? layerName(b, own) : old ? layerName(a, old) : '0',
    };
  });

  // Pasted where they were: no move and no units scale (the compare is of raw coordinates).
  const copies = new Map<Handle, Handle>();
  for (const [block, { space, ids }] of toPaste) {
    const clip = copyToClipboard(a, ids, { x: 0, y: 0 }).clipboard;
    const units = clip.insUnits ?? 0;
    const report = pasteObjects(builder, b, clip, block, clip.base, units);
    clip.entities.forEach((init, i) => {
      const id = report.ids[i];
      const copy = id === undefined ? undefined : builder.entity(id);
      if (!copy) return;
      const source = a.entityByHandle(init.handle)!;
      const removed = items.some((x) => x.old === source && x.item.status === 'removed');
      const status: MarkStatus = removed ? 'removed' : 'previous';
      builder.updateEntity(copy.id, { color: COMPARE_COLORS[status] });
      marks.push({
        handle: copy.handle,
        status,
        layer: layerName(a, source),
        type: copy.type,
        space,
      });
      copies.set(init.handle, copy.handle);
    });
  }

  return {
    change: builder.build(),
    items: items.map(({ item, own, old, layer }) => {
      const copy = old ? copies.get(old.handle) : undefined;
      return {
        ...item,
        layer,
        marks: [...(own ? [own.handle] : []), ...(copy ? [copy] : [])],
      };
    }),
    marks,
  };
}

/** What the compare drawing and its list show. */
export interface CompareFilter {
  /** The differences shown. */
  readonly statuses: readonly CompareStatus[];
  /** The unchanged objects shown too. */
  readonly unchanged: boolean;
  /** Only objects on this layer (the case aside); all when absent. */
  readonly layer?: string;
  /** Only objects of this type; all when absent. */
  readonly type?: EntityType;
}

const onLayer = (layer: string, f: CompareFilter) =>
  f.layer === undefined || layer.toUpperCase() === f.layer.toUpperCase();

/** Whether the results list shows `item`. */
export function itemShown(item: MarkedItem, f: CompareFilter): boolean {
  return (
    f.statuses.includes(item.status) &&
    onLayer(item.layer, f) &&
    (f.type === undefined || item.type === f.type)
  );
}

/** Which objects of the compare drawing the filter shows and hides. */
export function marksShown(
  markup: CompareMarkup,
  f: CompareFilter,
): { readonly shown: Handle[]; readonly hidden: Handle[] } {
  const shown: Handle[] = [];
  const hidden: Handle[] = [];
  for (const k of markup.marks) {
    const status = k.status === 'previous' ? 'modified' : k.status;
    const on =
      (status === 'unchanged' ? f.unchanged : f.statuses.includes(status)) &&
      onLayer(k.layer, f) &&
      (f.type === undefined || k.type === f.type);
    (on ? shown : hidden).push(k.handle);
  }
  return { shown, hidden };
}
