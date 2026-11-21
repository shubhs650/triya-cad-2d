// The Layer Properties Manager's filter menu (M5-07 part 6; AutoCAD 2024 Help, "Layer Properties
// Manager", the tree view's shortcut menu), on a node of the filter tree: All, All Used Layers or
// a filter.
//
//   - Visibility (On, Off, Thawed, Frozen) and Lock (Lock, Unlock) "change the visibility state
//     of all the layers in the selected filter" / "control whether the objects on the layers in
//     the selected filter can be modified". AutoCAD never freezes the current layer ("Cannot
//     freeze the current layer."): Frozen freezes the others.
//   - Isolate Group: "In all viewports of a layout, sets the VP Freeze setting for all layers
//     that are not in the selected filter. In model space, turns off all layers that are not in
//     the selected filter." The layers in the filter keep their settings. Active Viewport Only
//     acts in the layout viewport made current (M6-02 part 8; MSPACE, part 3); the app offers it
//     in a layout while one is, and in model space, where it does what All Viewports does.
//   - Viewport (Freeze, Thaw), M6-02 part 8: "Freezes or thaws the layers in the selected filter
//     in the current viewport", the layout viewport made current.
//   - Convert to Group Filter: "Converts the selected property filter to a group filter.
//     Changing the properties of the layers in a group filter has no effect on the filter." The
//     group holds the layers the filter lists now, under the same name, handle and parent, with
//     the filters nested in it.
//
// Ambiguity, settled for the common drafter expectation: Help says the menu acts on "the layers
// in the selected filter", so Invert filter, which only changes what the list shows, is not
// applied. Each item is one LAYER undo step, as the manager's other edits.
//
// The Xref node (part 8; Help: the tree lists "Xref" when external references are attached,
// with a node for each): each xref's node lists the xref-dependent layers it brings
// (`xref|layer`, a nested xref's under its own name, as it is loaded as an xref of its own), the
// Xref node every xref-dependent layer. The menu's Visibility, Lock and Isolate Group act on them
// as on any node.
//
// The Unreconciled New Layers node (M5-19 part 2; Help, "Layer Properties Manager": the filter
// lists the new layers an evaluation of the layer list found and nobody has reconciled yet,
// LAYEREVAL) lists the unreconciled layers. It is there only while one is; the menu acts on its
// layers as on the Xref node's.
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isLayerFilter,
  type BlockTableRecord,
  type LayerFilter,
  type LayerRecord,
} from '../model/types';
import { isXrefDependent, isXrefRecord } from '../model/xref';
import { filteredLayers } from './layer-filters';
import { layerPropsChange, layersInUse, type LayerProps } from './layer-manager';
import { viewportLayerChange } from './viewport-layer-edits';

/**
 * A node of the filter tree: All, All Used Layers, a filter's handle, Unreconciled New Layers
 * (`UNRECONCILED_NODE`), the Xref node (`XREF_NODE`) or an xref's (`xrefNode(name)`). Handles
 * are hexadecimal, so none of these spellings can be one.
 */
export type LayerFilterNode = 'all' | 'used' | Handle;

/** The Xref node: every xref-dependent layer. */
export const XREF_NODE = 'xref';

const XREF_PREFIX = 'xref:';

/** The node of the xref named `name`: the layers it brings. */
export const xrefNode = (name: string): LayerFilterNode => `${XREF_PREFIX}${name}`;

/** The Unreconciled New Layers node: every unreconciled layer. */
export const UNRECONCILED_NODE = 'unreconciled';

/** The unreconciled layers of `layers`, in its order. */
export function unreconciledLayers(layers: Iterable<LayerRecord>): LayerRecord[] {
  return [...layers].filter((l) => l.unreconciled === true);
}

/** The names of the xrefs the Xref node lists, by name (case ignored). */
export function xrefNodeNames(records: Iterable<BlockTableRecord>): string[] {
  return [...records]
    .filter((r) => isXrefRecord(r))
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * The layers the Xref node or an xref's node lists, in `layers`' order; undefined when `node` is
 * neither.
 */
export function xrefNodeLayers(
  layers: Iterable<LayerRecord>,
  node: LayerFilterNode,
): LayerRecord[] | undefined {
  const dependent = [...layers].filter(isXrefDependent);
  if (node === XREF_NODE) return dependent;
  if (!node.startsWith(XREF_PREFIX)) return undefined;
  const prefix = `${node.slice(XREF_PREFIX.length)}|`.toUpperCase();
  return dependent.filter((l) => l.name.toUpperCase().startsWith(prefix));
}

/** The Visibility and Lock items. */
export type FilterLayerSetting = 'on' | 'off' | 'thawed' | 'frozen' | 'lock' | 'unlock';

const SETTINGS: Readonly<Record<FilterLayerSetting, LayerProps>> = {
  on: { on: true },
  off: { on: false },
  thawed: { frozen: false },
  frozen: { frozen: true },
  lock: { locked: true },
  unlock: { locked: false },
};

/** The layers `node` lists, in the table's order, or why there are none to list. */
export function filterNodeLayers(
  model: DocumentModel,
  node: LayerFilterNode,
): LayerRecord[] | string {
  const layers = [...model.tables.layers.values()];
  if (node === 'all') return layers;
  if (node === UNRECONCILED_NODE) return unreconciledLayers(layers);
  const xref = xrefNodeLayers(layers, node);
  if (xref) return xref;
  const used = layersInUse(model);
  if (node === 'used') return layers.filter((l) => used.has(l.handle));
  if (!isLayerFilter(model.objects.get(node))) return `No layer filter ${node}.`;
  return filteredLayers(model, node, { used });
}

const isCurrent = (model: DocumentModel, l: LayerRecord) => {
  const c = model.header.get('$CLAYER');
  return typeof c === 'string' && c.toUpperCase() === l.name.toUpperCase();
};

/** Visibility or Lock on every layer `node` lists. */
export function filterLayersChange(
  model: DocumentModel,
  node: LayerFilterNode,
  setting: FilterLayerSetting,
): ChangeSet | string {
  const listed = filterNodeLayers(model, node);
  if (typeof listed === 'string') return listed;
  const layers = setting === 'frozen' ? listed.filter((l) => !isCurrent(model, l)) : listed;
  if (layers.length === 0 && listed.length > 0) return 'Cannot freeze the current layer.';
  return layerPropsChange(
    model,
    layers.map((l) => l.handle),
    SETTINGS[setting],
  );
}

/** Viewport Freeze or Thaw: the layers `node` lists frozen or thawed in `viewport` (part 8). */
export function filterViewportChange(
  model: DocumentModel,
  node: LayerFilterNode,
  viewport: Handle,
  frozen: boolean,
): ChangeSet | string {
  const listed = filterNodeLayers(model, node);
  if (typeof listed === 'string') return listed;
  return viewportLayerChange(
    model,
    listed.map((l) => l.handle),
    viewport,
    { frozen },
  );
}

/**
 * Isolate Group: in model space (`space` undefined or model space's block) the layers `node`
 * does not list turned off; in the layout whose block is `space`, frozen in each of its
 * viewports (not the sheet's own view, viewport 1), or with `viewport` (Active Viewport Only,
 * M6-02 part 8) in that one only.
 */
export function isolateFilterChange(
  model: DocumentModel,
  node: LayerFilterNode,
  space?: Handle,
  viewport?: Handle,
): ChangeSet | string {
  const listed = filterNodeLayers(model, node);
  if (typeof listed === 'string') return listed;
  if (listed.length === 0) return 'The filter lists no layers.';
  const keep = new Set(listed.map((l) => l.handle));
  const others = [...model.tables.layers.keys()].filter((h) => !keep.has(h));
  if (viewport !== undefined) return viewportLayerChange(model, others, viewport, { frozen: true });
  const layout =
    space === undefined ? undefined : model.layouts.find((l) => l.blockRecord === space);
  if (space !== undefined && !layout) return `No layout ${space}.`;
  const paper =
    layout !== undefined &&
    model.tables.blockRecords.get(layout.blockRecord)?.name.toUpperCase() !== '*MODEL_SPACE';
  if (!paper) return layerPropsChange(model, others, { on: false });
  const b = new ChangeSetBuilder(model);
  let viewports = 0;
  for (const id of model.blockEntities(space!)) {
    const e = model.entity(id);
    if (e?.geom.kind !== 'VIEWPORT' || e.geom.id === 1) continue;
    viewports++;
    const frozen = new Set(e.geom.frozenLayers);
    const add = others.filter((h) => !frozen.has(h));
    if (add.length > 0)
      b.updateEntity(e.id, { geom: { ...e.geom, frozenLayers: [...e.geom.frozenLayers, ...add] } });
  }
  if (viewports === 0) return 'The layout has no viewports.';
  return b.build();
}

/** Convert to Group Filter: property filter `handle` made a group of the layers it lists now. */
export function convertLayerFilterChange(model: DocumentModel, handle: Handle): ChangeSet | string {
  const f = model.objects.get(handle);
  if (!isLayerFilter(f)) return `No layer filter ${handle}.`;
  if (f.filterType === 'group') return `${f.name} is a group filter already.`;
  const parent = f.parent === undefined ? undefined : model.objects.get(f.parent);
  if (isLayerFilter(parent) && parent.filterType === 'property')
    return 'A group filter cannot be nested in a property filter.';
  const layers = filteredLayers(model, handle, { used: layersInUse(model) }).map((l) => l.handle);
  const b = new ChangeSetBuilder(model);
  b.updateObject(handle, { filterType: 'group', expression: '', layers } as Partial<LayerFilter>);
  return b.build();
}
