// A named view's layer snapshot (M5-07 part 7). AutoCAD 2024 Help, "New View / Shot Properties
// Dialog Box": "Save Layer Snapshot with View: Saves the current layer visibility settings with
// the new named view"; "View Manager Dialog Box": the General row "Layer snapshot" and "Update
// Layers: Updates layer information saved with the selected named view to match the layer
// visibility in the current model space or layout viewport".
//
// AutoCAD keeps the snapshot as a layer state named `ACAD_VIEWS_<view>`, hidden from the Layer
// States Manager (LayerStateMask kStateIsHidden), and the view names it in DXF 302 of its
// `ADSK_XREC_VTRVIEWINFO` XRECORD (`ViewRecord.layerState`). sample_AC1032_ascii.dxf's
// `ACAD_VIEWS_view_custom` (AutoCAD 2018) has the mask 0x8200, hidden and VP Freeze in the
// current viewport, which a snapshot saved here is given too.
//
// Ambiguity: the Help says a view restores "layer visibility" and does not list the properties.
// The common drafter expectation, which Triya follows, is the layers' On and Freeze settings, and
// VP Freeze in a layout viewport made current (M6-02 part 12): a snapshot saved while one is
// keeps the layers' VP Freeze there (and is saved as a layout's, DXF 290), and restored while
// one is sets VP Freeze there; one saved in model space leaves it alone. The state keeps
// every property, as AutoCAD's does, but only those are restored, the current layer staying
// current and thawed. A renamed view's snapshot is renamed with it, and a deleted view's goes
// with it, so no hidden state is left that nothing restores.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import { LAYER_STATE_MASK, type LayerState, type ViewRecord } from '../model/types';
import { layerStateNamed, restoreLayerVisibility, saveLayerState } from './layer-states';
import { PAPER_VIEW } from './named-view';

/** The prefix of the layer state that holds a view's layer snapshot. */
export const VIEW_LAYER_STATE_PREFIX = 'ACAD_VIEWS_';

/** The mask AutoCAD gives a view's snapshot: hidden, and VP Freeze in the current viewport. */
export const VIEW_LAYER_STATE_MASK = LAYER_STATE_MASK.hidden | LAYER_STATE_MASK.vpFrozen;

/** The layer state a snapshot of the view `name` is saved as. */
export function viewLayerStateName(name: string): string {
  return `${VIEW_LAYER_STATE_PREFIX}${name}`;
}

/** The hidden layer state a view's snapshot is kept in, if the drawing has it. */
function snapshotOf(model: DocumentModel, view: ViewRecord): LayerState | undefined {
  const s = view.layerState === undefined ? undefined : layerStateNamed(model, view.layerState);
  return s && (s.mask & LAYER_STATE_MASK.hidden) !== 0 ? s : undefined;
}

/**
 * Save layer snapshot with view, Update Layers and the Layer snapshot row's Yes: every layer's
 * settings now saved as the view's snapshot (its state overwritten, or a new one), into `b`.
 * Undefined when saved, otherwise why not, with nothing built.
 */
export function saveViewLayers(
  b: ChangeSetBuilder,
  model: DocumentModel,
  view: ViewRecord,
  /** The layout viewport made current: its VP Freeze is kept (M6-02 part 12). */
  viewport?: Handle,
): string | undefined {
  const own = snapshotOf(model, view);
  const name = own?.name ?? viewLayerStateName(view.name);
  const why = saveLayerState(b, model, name, {
    mask: VIEW_LAYER_STATE_MASK,
    hidden: true,
    paperSpace: ((view.flags ?? 0) & PAPER_VIEW) !== 0,
    viewport,
  });
  if (why) return why;
  if (view.layerState !== name) b.updateTableRecord('views', view.handle, { layerState: name });
  return undefined;
}

/** The Layer snapshot row's No, and a deleted view: the snapshot goes, with its hidden state. */
export function dropViewLayers(b: ChangeSetBuilder, model: DocumentModel, view: ViewRecord): void {
  const own = snapshotOf(model, view);
  if (own) b.removeObject(own.handle);
  if (view.layerState !== undefined && model.tables.views.has(view.handle))
    b.updateTableRecord('views', view.handle, { layerState: undefined });
}

/**
 * A view renamed `name`: its snapshot's state renamed to match (`ACAD_VIEWS_<name>`) when it is
 * the view's own hidden state and no other state has that name. Call before renaming the view.
 */
export function renameViewLayers(
  b: ChangeSetBuilder,
  model: DocumentModel,
  view: ViewRecord,
  name: string,
): void {
  const own = snapshotOf(model, view);
  if (!own) return;
  const to = viewLayerStateName(name);
  const other = layerStateNamed(model, to);
  if (other && other.handle !== own.handle) return;
  if (own.name !== to) b.updateObject(own.handle, { name: to } as Partial<LayerState>);
  b.updateTableRecord('views', view.handle, { layerState: to });
}

/**
 * The view's layers as its snapshot has them, into `b`, VP Freeze too in the layout viewport
 * `viewport` made current; false when it has none.
 */
export function restoreViewLayers(
  b: ChangeSetBuilder,
  model: DocumentModel,
  view: ViewRecord,
  viewport?: Handle,
): boolean {
  const s = view.layerState === undefined ? undefined : layerStateNamed(model, view.layerState);
  return s !== undefined && restoreLayerVisibility(b, model, s.handle, viewport);
}
