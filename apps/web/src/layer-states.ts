// The Layer States Manager (M5-07 part 2), LAYERSTATE's dialog: what it lists and the state it
// keeps. AutoCAD 2024 Help, "Layer States Manager Dialog Box": the drawing's layer states with
// Name, Space, Same as DWG and Description; New..., Update, Rename, Delete, Import... and
// Export...; Restore Options ("Turn off layers not found in layer state", "Apply properties as
// viewport overrides"); and, under More Restore Options, the Layer Properties to Restore, which
// are the selected state's own (its mask). The Layer Properties Manager names the state restored
// last, or says "Unsaved Layer State" once the layers are no longer as it has them.
//
// The engine worker holds the drawing (M1-67), so the dialog reads the states and the tables
// they are compared with from the drawing as opened plus every change applied since.
import {
  LAYER_STATE_MASK,
  isLayerState,
  layerStateEntry,
  layerStateMatches,
  lineweightText,
  transparencyValue,
  type ChangeSet,
  type DocumentInit,
  type Handle,
  type KeyedChanges,
  type LayerRecord,
  type LayerState,
  type LayerStateLayer,
  type LayerStateTables,
  type LineweightUnits,
  type NonGraphicalObject,
  type TableName,
  type TableRecords,
} from '@triya/engine';
import { colorCell, compareNames } from './layers';

/** A table as opened with `changes` applied in order, by handle. */
export function tableNow<K extends TableName>(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  table: K,
): Map<Handle, TableRecords[K]> {
  const now = new Map<Handle, TableRecords[K]>();
  for (const r of (init.tables?.[table] ?? []) as TableRecords[K][]) now.set(r.handle, r);
  for (const cs of changes) {
    const c = cs.tables?.[table] as KeyedChanges<TableRecords[K]> | undefined;
    for (const r of c?.removed ?? []) now.delete(r.handle);
    for (const { after } of c?.updated ?? []) now.set(after.handle, after);
    for (const r of c?.added ?? []) now.set(r.handle, r);
  }
  return now;
}

/** The tables a state is compared with (Same as DWG) and exported with. */
export function layerStateTables(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): LayerStateTables {
  return {
    tables: {
      layers: tableNow(init, changes, 'layers'),
      linetypes: tableNow(init, changes, 'linetypes'),
      plotStyles: tableNow(init, changes, 'plotStyles'),
    },
  };
}

/**
 * The drawing's layer states the manager lists, by name (case ignored): a view's layer snapshot
 * (`LAYER_STATE_MASK.hidden`) is the view's, not listed.
 */
export function drawingLayerStates(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): LayerState[] {
  const now = new Map<Handle, NonGraphicalObject>();
  for (const o of init.objects ?? []) if (isLayerState(o)) now.set(o.handle, o);
  for (const cs of changes) {
    for (const o of cs.objects?.removed ?? []) now.delete(o.handle);
    for (const { after } of cs.objects?.updated ?? [])
      if (isLayerState(after)) now.set(after.handle, after);
    for (const o of cs.objects?.added ?? []) if (isLayerState(o)) now.set(o.handle, o);
  }
  return [...now.values()]
    .filter(isLayerState)
    .filter((s) => (s.mask & LAYER_STATE_MASK.hidden) === 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** One row of the manager's list. */
export interface LayerStateRow {
  readonly handle: Handle;
  readonly name: string;
  /** Model, or Layout for a state saved in paper space (DXF 290). */
  readonly space: 'Model' | 'Layout';
  /** Same as DWG: whether the drawing's layers are as the state has them. */
  readonly same: boolean;
  readonly description: string;
  /** The state restored last (LayerStateMask kLastRestored). */
  readonly lastRestored: boolean;
  readonly mask: number;
  readonly state: LayerState;
}

export function layerStateRows(
  states: readonly LayerState[],
  tables: LayerStateTables,
): LayerStateRow[] {
  return states.map((s) => ({
    handle: s.handle,
    name: s.name,
    space: s.paperSpace ? 'Layout' : 'Model',
    same: layerStateMatches(tables, s),
    description: s.description,
    lastRestored: (s.mask & LAYER_STATE_MASK.lastRestored) !== 0,
    mask: s.mask,
    state: s,
  }));
}

/** What the Layer Properties Manager shows when no restored state matches the layers. */
export const UNSAVED_LAYER_STATE = 'Unsaved Layer State';

/**
 * The Layer Properties Manager's layer state: the one restored last while the layers match it.
 * Only that state is compared, and the tables are read only when there is one, so a drawing
 * without layer states costs the manager nothing (its search must stay under 100 ms, M5-05).
 */
export function currentLayerStateName(init: DocumentInit, changes: readonly ChangeSet[]): string {
  const last = drawingLayerStates(init, changes).find(
    (s) => (s.mask & LAYER_STATE_MASK.lastRestored) !== 0,
  );
  return last && layerStateMatches(layerStateTables(init, changes), last)
    ? last.name
    : UNSAVED_LAYER_STATE;
}

/** The Layer Properties to Restore, in AutoCAD's order, each a mask bit. */
export const RESTORE_PROPERTIES: readonly { readonly bit: number; readonly label: string }[] = [
  { bit: LAYER_STATE_MASK.on, label: 'On/Off' },
  { bit: LAYER_STATE_MASK.frozen, label: 'Frozen/Thawed' },
  { bit: LAYER_STATE_MASK.locked, label: 'Locked/Unlocked' },
  { bit: LAYER_STATE_MASK.plot, label: 'Plot/No Plot' },
  { bit: LAYER_STATE_MASK.vpFrozen, label: 'Current VP Frozen/Thawed' },
  { bit: LAYER_STATE_MASK.newVpFrozen, label: 'New VP Frozen/Thawed' },
  { bit: LAYER_STATE_MASK.color, label: 'Color' },
  { bit: LAYER_STATE_MASK.linetype, label: 'Linetype' },
  { bit: LAYER_STATE_MASK.lineweight, label: 'Lineweight' },
  { bit: LAYER_STATE_MASK.transparency, label: 'Transparency' },
  { bit: LAYER_STATE_MASK.plotStyle, label: 'Plot Style' },
];

/** The mask with `bit` set or cleared; the state's own bits (hidden, last restored) kept. */
export function withRestoreProperty(mask: number, bit: number, on: boolean): number {
  return on ? mask | bit : mask & ~bit;
}

/** Select All and Clear All: every property to restore, or none. */
export function allRestoreProperties(mask: number, on: boolean): number {
  return on ? mask | LAYER_STATE_MASK.all : mask & ~LAYER_STATE_MASK.all;
}

/** Export's file name: the state's, as AutoCAD offers it, without characters files refuse. */
export function lasFileName(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]/g, '_')}.las`;
}

// Edit Layer State (the manager's Edit..., M5-07 part 3; AutoCAD 2024 Help, "Edit Layer State
// Dialog Box"): the layers the selected state names with the settings it restores (Name, On,
// Freeze, Lock, Plot, Color, Linetype, Lineweight, Transparency, Plot Style, New VP Freeze);
// "Add layers to layer state" offers the drawing's layers it does not name (Select Layers to Add
// to Layer State), each added with its settings now; "Remove layers from layer state" takes the
// selected rows out. OK saves the layers as one LAYERSTATE step, Cancel leaves the state.

/** The key a state's entry is known by in the dialog: its layer, or its name (a `.las` file's). */
export const entryKey = (e: LayerStateLayer): string => e.layer ?? `name:${e.name.toUpperCase()}`;

/** One row of Edit Layer State. */
export interface EditLayerStateRow {
  readonly key: string;
  readonly name: string;
  readonly on: boolean;
  readonly frozen: boolean;
  readonly locked: boolean;
  readonly plot: boolean;
  readonly newVpFrozen: boolean;
  readonly color: { readonly label: string; readonly css: string };
  readonly linetype: string;
  readonly lineweight: string;
  /** AutoCAD's percentage, 0 (opaque) to 90. */
  readonly transparency: number;
  readonly plotStyle: string;
  /** False for a layer the state names that the drawing does not have. */
  readonly inDrawing: boolean;
  readonly entry: LayerStateLayer;
}

export function editLayerStateRows(
  entries: readonly LayerStateLayer[],
  tables: LayerStateTables,
  units: LineweightUnits,
): EditLayerStateRow[] {
  const names = new Set([...tables.tables.layers.values()].map((l) => l.name.toUpperCase()));
  return entries.map((e) => {
    const t = transparencyValue(e.transparency);
    return {
      key: entryKey(e),
      name: e.name,
      on: e.on,
      frozen: e.frozen,
      locked: e.locked,
      plot: e.plot,
      newVpFrozen: e.newVpFrozen,
      color: colorCell(e.color),
      linetype: e.linetypeName,
      lineweight:
        typeof e.lineweight === 'number' ? lineweightText(e.lineweight, units) : e.lineweight,
      transparency: typeof t === 'number' ? t : 0,
      plotStyle: e.plotStyle,
      inDrawing:
        (e.layer !== undefined && tables.tables.layers.has(e.layer)) ||
        names.has(e.name.toUpperCase()),
      entry: e,
    };
  });
}

/**
 * Select Layers to Add to Layer State: the drawing's layers the state does not name (by layer,
 * or by name for an entry without one), in the Layer Properties Manager's order.
 */
export function layersToAdd(
  entries: readonly LayerStateLayer[],
  tables: LayerStateTables,
): LayerRecord[] {
  const handles = new Set(entries.flatMap((e) => (e.layer === undefined ? [] : [e.layer])));
  const names = new Set(entries.map((e) => e.name.toUpperCase()));
  return [...tables.tables.layers.values()]
    .filter((l) => !handles.has(l.handle) && !names.has(l.name.toUpperCase()))
    .sort((a, b) => compareNames(a.name, b.name));
}

/** The layers added, each with its settings now, after the state's own. */
export function withLayersAdded(
  entries: readonly LayerStateLayer[],
  tables: LayerStateTables,
  added: readonly LayerRecord[],
): LayerStateLayer[] {
  return [...entries, ...added.map((l) => layerStateEntry(tables, l))];
}

/** The manager open, by drawing, and what LAYERSTATE waits for: the dialog to close. */
export const layerStatesManager = (() => {
  let open: number | undefined;
  let done: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = () => {
    const d = done;
    done = undefined;
    d?.();
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(doc: number): Promise<void> {
      finish();
      set(doc);
      return new Promise((resolve) => (done = resolve));
    },
    close() {
      set(undefined);
      finish();
    },
  };
})();
