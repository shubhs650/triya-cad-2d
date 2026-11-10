// Views kept in the drawing (M2-29). The drawing's named views are its VIEW table as its engine
// has it: the views it opened with and those VIEW Save and the navigation bar's Save view added
// since (`saveNamedView`), so a save writes them. A save also writes the view each Model tile
// shows into its `*Active` VPORT, as AutoCAD does, so the drawing reopens where it was left. That
// change goes into the save only: looking around is not an edit, so it is not an undo step and
// does not make the drawing unsaved.
import {
  activeViewsChange,
  type ChangeSet,
  type DocumentInit,
  type Handle,
  type TableName,
  type TableRecords,
  type ViewRecord,
} from '@triya/engine';
import type { ViewTransform } from '@triya/render';
import type { ViewportSize } from './canvas/navigate';
import { modelTiles } from './canvas/views';

/** A table's records as the change log leaves them, in the order the drawing lists them. */
function records<K extends TableName>(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  table: K,
): TableRecords[K][] {
  const now = new Map<Handle, TableRecords[K]>(
    ((init.tables?.[table] ?? []) as TableRecords[K][]).map((r) => [r.handle, r]),
  );
  for (const cs of changes) {
    const c = cs.tables?.[table];
    for (const r of c?.removed ?? []) now.delete(r.handle);
    for (const { after } of c?.updated ?? []) now.set(after.handle, after as TableRecords[K]);
    for (const r of c?.added ?? []) now.set(r.handle, r as TableRecords[K]);
  }
  return [...now.values()];
}

/** The drawing's named views, model and paper space, as its engine has them now. */
export function drawingViews(init: DocumentInit, changes: readonly ChangeSet[]): ViewRecord[] {
  return records(init, changes, 'views');
}

/** What a Model tile's canvas shows. */
export interface ShownView {
  readonly view: ViewTransform | undefined;
  readonly size: ViewportSize;
}

/**
 * The change that writes what each Model tile shows (by tile index, as `modelTiles` places them)
 * into its `*Active` VPORT, for the save to add to the change log (`activeViewsChange`). Empty
 * for a Model tab never shown and a drawing without an `*Active` VPORT.
 */
export function shownViewsChange(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  shown: ReadonlyMap<number, ShownView>,
): ChangeSet {
  const tiles = modelTiles(records(init, changes, 'vports'));
  const out = [];
  for (const [i, { view, size }] of shown) {
    const vport = tiles[i]?.vport;
    if (!vport || !view || !(view.scale > 0) || !(size.width > 0) || !(size.height > 0)) continue;
    out.push({
      vport,
      view: {
        center: view.center,
        height: size.height / view.scale,
        width: size.width / view.scale,
      },
    });
  }
  return activeViewsChange(out);
}
