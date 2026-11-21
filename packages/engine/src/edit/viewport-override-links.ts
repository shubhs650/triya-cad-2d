// A layer's viewport overrides name their viewport by its handle (M1-62: XRECORD group 335 of
// the layer's ADSK_XREC_LAYER_*_OVR records), so they follow the viewport (M6-02 part 18): a
// viewport erased (ERASE, LAYDEL, LAYOUT Delete) takes them with it, as AutoCAD's erase leaves no
// override naming an erased viewport, and a viewport copied (COPY, LAYOUT Copy, LAYOUT Template)
// shows its layers as the original does, the copy given the same overrides. Each function reads
// the layers as the builder has them, so several edits of one change set add up.
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { LayerRecord, LayerViewportOverride } from '../model/types';

/** Each layer's override list rewritten by `next`, where it changes. */
function rewriteAll(
  b: ChangeSetBuilder,
  next: (list: readonly LayerViewportOverride[]) => readonly LayerViewportOverride[],
): void {
  const layers: LayerRecord[] = [...b.tableRecords('layers')];
  for (const l of layers) {
    const before = l.viewportOverrides;
    if (!before || before.length === 0) continue;
    const after = next(before);
    if (after === before) continue;
    b.updateTableRecord('layers', l.handle, {
      viewportOverrides: after.length > 0 ? after : undefined,
    });
  }
}

/** The overrides naming any of `viewports` dropped from every layer (the viewports erased). */
export function dropViewportOverrides(b: ChangeSetBuilder, viewports: ReadonlySet<Handle>): void {
  if (viewports.size === 0) return;
  rewriteAll(b, (list) =>
    list.some((o) => viewports.has(o.viewport))
      ? list.filter((o) => !viewports.has(o.viewport))
      : list,
  );
}

/**
 * Each copied viewport (`copies`: the original's handle to the copy's) given its original's
 * overrides, after the layer's own entries.
 */
export function copyViewportOverrides(
  b: ChangeSetBuilder,
  copies: ReadonlyMap<Handle, Handle>,
): void {
  if (copies.size === 0) return;
  rewriteAll(b, (list) => {
    const added = list.flatMap((o) => {
      const to = copies.get(o.viewport);
      return to === undefined ? [] : [{ ...o, viewport: to }];
    });
    return added.length > 0 ? [...list, ...added] : list;
  });
}
