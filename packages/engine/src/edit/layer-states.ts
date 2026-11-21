// Named layer states (LAYERSTATE, the Layer States Manager; M5-07 part 1): each layer's settings
// saved under a name and set again on restore. AutoCAD 2024 Help, "Layer States Manager":
//
//   - New saves every layer's settings and the current layer; a name already used asks to
//     overwrite (the app asks, the engine replaces). Names are compared ignoring case.
//   - Restore sets the properties checked under "Layer properties to restore" (the state's mask,
//     `LAYER_STATE_MASK`) on the layers the state names, and makes its current layer current.
//     "Turn off layers not found in layer state" turns off the layers it does not name, "so that
//     the drawing looks the same way it did when the named layer state was saved".
//   - Delete and Rename change the list; Edit changes the description and what is restored.
//   - Edit Layer State (the manager's Edit..., M5-07 part 3) changes the layers the state names
//     and their settings, adds layers of the drawing it does not name ("Add layers to layer
//     state", each with its settings now) and removes some ("Remove layers from layer state").
//   - Import takes a `.las` file's state (io `parseLas`): layers it names that the drawing does
//     not have are kept by name, as the file names them, and skipped on restore.
//
// AutoCAD never freezes the current layer ("Cannot freeze the current layer"), so a restore leaves
// the layer current after it thawed. A state hidden from the manager (a view's layer snapshot,
// `ACAD_VIEWS_<view>`, mask bit 0x8000) is restored with its view (later part), not listed.
//
// VP Freeze in the current viewport (`vpFrozen`, M6-02 part 12): a state saved while a layout
// viewport is current (MSPACE) keeps each layer's VP Freeze there and is saved as a layout's
// (DXF 290, the manager's Space "Layout"); restored while one is current, with Current VP
// Frozen/Thawed checked, it sets VP Freeze there. Ambiguity, settled for the drafter: Help does
// not say what a state saved in model space restores in a viewport; its VP Freeze settings were
// never saved (all thawed), so such a state, and one saved on a layout's paper, leave VP Freeze
// alone rather than thaw every layer in the viewport. "Apply properties as viewport overrides"
// (Help: "Applies layer property overrides to the current viewport") restores the colour,
// linetype, lineweight and transparency as the viewport's overrides instead of on the layers.
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { DocumentModel, type DocumentInit } from '../model/document';
import type { Handle } from '../model/handle';
import { aciOfTrueColor } from '../model/aci';
import { LINEWEIGHTS } from '../properties/sheet';
import {
  freezeInViewports,
  frozenInViewport,
  layoutViewportProblem,
  setViewportLayerProps,
  type ViewportOverrideProps,
} from './viewport-layer-edits';
import {
  LAYER_STATE_MASK,
  isLayerState,
  type Color,
  type LayerRecord,
  type LayerState,
  type LayerStateLayer,
  type LinetypeRecord,
  type SymbolTableRecord,
} from '../model/types';

/**
 * The tables a state is compared with and restored from: a drawing's (`DocumentModel`), or the
 * app's mirror of them (the Layer States Manager's Same as DWG, M5-07 part 2).
 */
export interface LayerStateTables {
  readonly tables: {
    readonly layers: ReadonlyMap<Handle, LayerRecord>;
    readonly linetypes: ReadonlyMap<Handle, LinetypeRecord>;
    readonly plotStyles: ReadonlyMap<Handle, SymbolTableRecord>;
  };
}

/** A layer state as a `.las` file or a caller states it: no handle, no owner yet. */
export type LayerStateInit = Omit<LayerState, 'handle' | 'owner' | 'type' | 'raw'>;

/** DXF 70 bit 2: a layer frozen in new viewports. */
const NEW_VP_FROZEN = 2;
const NAME_INVALID = /[<>/\\":;?*|,=`]/;
const NAME_MAX = 255;
const DESCRIPTION_MAX = 255;

const upper = (s: string) => s.toUpperCase();

/** The drawing's layer states, by name; those the manager hides only with `hidden`. */
export function layerStates(model: DocumentModel, hidden = false): LayerState[] {
  const out: LayerState[] = [];
  for (const o of model.objects.values()) {
    if (isLayerState(o) && (hidden || (o.mask & LAYER_STATE_MASK.hidden) === 0)) out.push(o);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The layer state named `name` (case ignored), hidden or not. */
export function layerStateNamed(model: DocumentModel, name: string): LayerState | undefined {
  const key = upper(name);
  return layerStates(model, true).find((s) => upper(s.name) === key);
}

/** The `ACAD_LAYERSTATES` dictionary new states are filed in, when the drawing has one. */
export function layerStateDictionary(model: DocumentModel): Handle | undefined {
  if (model.meta.layerStateDictionary) return model.meta.layerStateDictionary;
  for (const o of model.objects.values()) if (isLayerState(o)) return o.owner;
  return undefined;
}

function nameProblem(model: DocumentModel, name: string, self?: Handle): string | undefined {
  if (name.trim() === '' || name.length > NAME_MAX || NAME_INVALID.test(name))
    return 'Invalid layer state name.';
  const other = layerStateNamed(model, name);
  if (other && other.handle !== self) return `A layer state named "${other.name}" already exists.`;
  return undefined;
}

function descriptionProblem(description: string | undefined): string | undefined {
  return description !== undefined && description.length > DESCRIPTION_MAX
    ? 'The description is too long.'
    : undefined;
}

function maskProblem(mask: number | undefined): string | undefined {
  return mask !== undefined && (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff)
    ? 'Invalid layer properties to restore.'
    : undefined;
}

const aciOf = (c: Color): number =>
  c.kind === 'aci' ? c.index : c.kind === 'rgb' ? aciOfTrueColor(c.r, c.g, c.b) : 7;

/**
 * A layer's settings now, as a state keeps them: what New saves for it, and what Edit Layer
 * State's "Add layers to layer state" adds (with the app's mirror of the tables).
 */
export function layerStateEntry(
  model: LayerStateTables,
  l: LayerRecord,
  /** VP Freeze in the layout viewport current when saved (M6-02 part 12). */
  vpFrozen = false,
): LayerStateLayer {
  const linetype = model.tables.linetypes.get(l.linetype);
  const style = l.plotStyle === undefined ? undefined : model.tables.plotStyles.get(l.plotStyle);
  return {
    layer: l.handle,
    name: l.name,
    on: l.on,
    frozen: l.frozen,
    locked: l.locked,
    plot: l.plot,
    newVpFrozen: ((l.flags ?? 0) & NEW_VP_FROZEN) !== 0,
    vpFrozen,
    color: l.color,
    ...(linetype ? { linetype: linetype.handle } : {}),
    linetypeName: linetype?.name ?? 'Continuous',
    lineweight: l.lineweight,
    // A colour-dependent drawing's plot style is the colour's (`Color_7`), as AutoCAD saves it.
    plotStyle: style?.name ?? `Color_${aciOf(l.color)}`,
    transparency: l.transparency,
  };
}

function currentLayerName(model: DocumentModel): string {
  const c = model.header.get('$CLAYER');
  return typeof c === 'string' ? c : '0';
}

/** A new state's owner: the drawing's `ACAD_LAYERSTATES`, or the one its first state makes. */
function ownerFor(model: DocumentModel, b: ChangeSetBuilder): Handle {
  for (const o of b.objects()) if (isLayerState(o)) return o.owner;
  return model.meta.layerStateDictionary ?? b.allocateHandle();
}

function addState(model: DocumentModel, b: ChangeSetBuilder, init: LayerStateInit): void {
  const owner = ownerFor(model, b);
  // AutoCAD lists the dictionary as the record's reactor too.
  b.addObject({ type: 'LAYER_STATE', owner, reactors: [owner], ...init } as Omit<
    LayerState,
    'handle'
  >);
}

/**
 * New (or an overwrite of the state of the same name): every layer's settings and the current
 * layer saved as `name`. An overwrite keeps the state's description unless one is given.
 */
export function saveLayerStateChange(
  model: DocumentModel,
  name: string,
  options: { readonly description?: string; readonly mask?: number } = {},
): ChangeSet | string {
  const b = new ChangeSetBuilder(model);
  return saveLayerState(b, model, name, options) ?? b.build();
}

/**
 * {@link saveLayerStateChange} into `b` (LAYWALK's Save Layer State builds in its command's edit,
 * M5-06 part 4): undefined when saved, otherwise why not, with nothing built.
 */
export function saveLayerState(
  b: ChangeSetBuilder,
  model: DocumentModel,
  name: string,
  options: {
    readonly description?: string;
    readonly mask?: number;
    /** A view's layer snapshot (M5-07 part 7): hidden from the manager, saved in a layout. */
    readonly hidden?: boolean;
    readonly paperSpace?: boolean;
    /** The layout viewport made current (M6-02 part 12): its VP Freeze is saved. */
    readonly viewport?: Handle | undefined;
  } = {},
): string | undefined {
  const old = layerStateNamed(model, name);
  const { viewport } = options;
  const why =
    (viewport === undefined ? undefined : layoutViewportProblem(model, viewport)) ??
    nameProblem(model, name, old?.handle) ??
    descriptionProblem(options.description) ??
    maskProblem(options.mask);
  if (why) return why;
  const frozen = viewport === undefined ? new Set<Handle>() : frozenInViewport(model, viewport);
  const init: LayerStateInit = {
    name,
    description: options.description ?? old?.description ?? '',
    // Hidden and last restored are the state's own, not what to restore: an overwrite (New
    // with its name, Update) keeps them, so a state restored and updated is still the one the
    // Layer Properties Manager names.
    mask:
      (options.mask === undefined
        ? (old?.mask ?? LAYER_STATE_MASK.all)
        : (options.mask & LAYER_STATE_MASK.all) | ((old?.mask ?? 0) & ~LAYER_STATE_MASK.all)) |
      (options.hidden ? LAYER_STATE_MASK.hidden : 0),
    paperSpace: options.paperSpace === true || viewport !== undefined,
    currentLayer: currentLayerName(model),
    layers: [...model.tables.layers.values()].map((l) =>
      layerStateEntry(model, l, frozen.has(l.handle)),
    ),
  };
  if (old) b.updateObject(old.handle, init);
  else addState(model, b, init);
  return undefined;
}

/**
 * A `.las` file's state imported as a new state; layers and linetypes found by name. With
 * `replace`, a state of the same name goes first (the manager's "Do you want to overwrite it?").
 */
export function importLayerStateChange(
  model: DocumentModel,
  state: LayerStateInit,
  replace = false,
): ChangeSet | string {
  const b = new ChangeSetBuilder(model);
  return importLayerState(b, model, state, replace) ?? b.build();
}

/**
 * {@link importLayerStateChange} into `b` (-LAYER stAte Import builds in its command's edit,
 * M5-18 part 3): undefined when imported, otherwise why not, with nothing built.
 */
export function importLayerState(
  b: ChangeSetBuilder,
  model: DocumentModel,
  state: LayerStateInit,
  replace = false,
): string | undefined {
  const old = replace ? layerStateNamed(model, state.name) : undefined;
  const why =
    nameProblem(model, state.name, old?.handle) ??
    descriptionProblem(state.description) ??
    maskProblem(state.mask);
  if (why) return why;
  const layers = new Map([...model.tables.layers.values()].map((l) => [upper(l.name), l]));
  const linetypes = new Map(
    [...model.tables.linetypes.values()].map((l) => [upper(l.name), l.handle]),
  );
  if (old) b.removeObject(old.handle);
  addState(model, b, {
    ...state,
    // The file's own mark says nothing of this drawing.
    mask: state.mask & ~LAYER_STATE_MASK.lastRestored,
    layers: state.layers.map((e) => {
      const { layer: _l, linetype: _t, ...rest } = e;
      const layer = layers.get(upper(e.name))?.handle;
      const linetype = linetypes.get(upper(e.linetypeName));
      return { ...(layer ? { layer } : {}), ...rest, ...(linetype ? { linetype } : {}) };
    }),
  });
  return undefined;
}

/**
 * `state` as a file holds it (-LAYER stAte EXport, M5-18 part 3; a drawing's states imported
 * from it): its layers and linetypes by the names the drawing gives them now, no handles.
 */
export function fileLayerState(model: DocumentModel, state: LayerState): LayerStateInit {
  return {
    name: state.name,
    description: state.description,
    mask: state.mask,
    paperSpace: state.paperSpace,
    currentLayer: state.currentLayer,
    layers: state.layers.map((e) => {
      const { layer, linetype, ...rest } = e;
      const l = layer === undefined ? undefined : model.tables.layers.get(layer);
      const t = linetype === undefined ? undefined : model.tables.linetypes.get(linetype);
      return { ...rest, name: l?.name ?? e.name, linetypeName: t?.name ?? e.linetypeName };
    }),
  };
}

/**
 * The layer states another drawing holds, as a file holds them (-LAYER stAte Import of a DWG or
 * DXF; AutoCAD 2024 Help: Import "loads ... layers states from a file (DWG, DWS, DWT)"): those
 * the Layer States Manager lists, views' snapshots left out.
 */
export function drawingLayerStates(drawing: DocumentInit): LayerStateInit[] {
  const model = DocumentModel.create(drawing);
  return layerStates(model).map((s) => fileLayerState(model, s));
}

function stateOf(model: DocumentModel, handle: Handle): LayerState | string {
  const s = model.objects.get(handle);
  return isLayerState(s) ? s : `No layer state ${handle}.`;
}

/** The layer an entry names: by handle, else by name. */
function layerOf(model: LayerStateTables, e: LayerStateLayer): LayerRecord | undefined {
  const l = e.layer === undefined ? undefined : model.tables.layers.get(e.layer);
  if (l) return l;
  const key = upper(e.name);
  for (const r of model.tables.layers.values()) if (upper(r.name) === key) return r;
  return undefined;
}

function linetypeOf(model: LayerStateTables, e: LayerStateLayer): Handle | undefined {
  if (e.linetype !== undefined && model.tables.linetypes.has(e.linetype)) return e.linetype;
  const key = upper(e.linetypeName);
  for (const r of model.tables.linetypes.values()) if (upper(r.name) === key) return r.handle;
  return undefined;
}

function plotStyleOf(model: LayerStateTables, name: string): Handle | undefined {
  const key = upper(name);
  for (const r of model.tables.plotStyles.values()) if (upper(r.name) === key) return r.handle;
  return undefined;
}

const sameColor = (a: Color, b: Color): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The layer properties `e` restores under `mask`, where they differ from `l`'s. */
function restorePatch(
  model: LayerStateTables,
  l: LayerRecord,
  e: LayerStateLayer,
  mask: number,
): Partial<LayerRecord> {
  const p: Record<string, unknown> = {};
  const has = (bit: number) => (mask & bit) !== 0;
  if (has(LAYER_STATE_MASK.on) && l.on !== e.on) p['on'] = e.on;
  if (has(LAYER_STATE_MASK.frozen) && l.frozen !== e.frozen) p['frozen'] = e.frozen;
  if (has(LAYER_STATE_MASK.locked) && l.locked !== e.locked) p['locked'] = e.locked;
  if (has(LAYER_STATE_MASK.plot) && l.plot !== e.plot) p['plot'] = e.plot;
  if (has(LAYER_STATE_MASK.newVpFrozen)) {
    const flags = l.flags ?? 0;
    const want = e.newVpFrozen ? flags | NEW_VP_FROZEN : flags & ~NEW_VP_FROZEN;
    if (want !== flags) p['flags'] = want;
  }
  // A layer is never ByLayer or ByBlock.
  const colorOk = e.color.kind === 'aci' || e.color.kind === 'rgb';
  if (has(LAYER_STATE_MASK.color) && colorOk && !sameColor(l.color, e.color)) p['color'] = e.color;
  const linetype = has(LAYER_STATE_MASK.linetype) ? linetypeOf(model, e) : undefined;
  if (linetype !== undefined && linetype !== l.linetype) p['linetype'] = linetype;
  if (has(LAYER_STATE_MASK.lineweight) && !sameValue(l.lineweight, e.lineweight))
    p['lineweight'] = e.lineweight;
  if (has(LAYER_STATE_MASK.transparency) && !sameValue(l.transparency, e.transparency))
    p['transparency'] = e.transparency;
  const style = has(LAYER_STATE_MASK.plotStyle) ? plotStyleOf(model, e.plotStyle) : undefined;
  if (style !== undefined && style !== l.plotStyle) p['plotStyle'] = style;
  return p as Partial<LayerRecord>;
}

/**
 * Same as DWG (the Layer States Manager's column, M5-07 part 2): whether every layer the state
 * names that the drawing has is as the state has it, under the properties it restores. Layers it
 * does not name, and those the drawing lacks, are not compared.
 */
export function layerStateMatches(model: LayerStateTables, state: LayerState): boolean {
  return state.layers.every((e) => {
    const l = layerOf(model, e);
    return !l || Object.keys(restorePatch(model, l, e, state.mask)).length === 0;
  });
}

/**
 * Restore: the state's settings set on its layers, its current layer made current. The state is
 * marked restored last (LayerStateMask kLastRestored), the mark taken off any other, so the Layer
 * Properties Manager can name it.
 */
export function restoreLayerStateChange(
  model: DocumentModel,
  handle: Handle,
  options: {
    readonly turnOffMissing?: boolean | undefined;
    /** The layout viewport made current (M6-02 part 12). */
    readonly viewport?: Handle | undefined;
    /** "Apply properties as viewport overrides", in `viewport`. */
    readonly asOverrides?: boolean | undefined;
  } = {},
): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
  const { viewport } = options;
  const why = viewport === undefined ? undefined : layoutViewportProblem(model, viewport);
  if (why) return why;
  const overridesIn = options.asOverrides === true ? viewport : undefined;
  const layerMask = overridesIn !== undefined ? s.mask & ~VIEWPORT_PROPERTIES : s.mask;
  const entries = new Map<Handle, LayerStateLayer>();
  for (const e of s.layers) {
    const l = layerOf(model, e);
    if (l && !entries.has(l.handle)) entries.set(l.handle, e);
  }
  // The state's current layer, when the drawing has it and the state does not freeze it.
  const named = layerOf(model, { name: s.currentLayer } as LayerStateLayer);
  const keepsFrozen = (l: LayerRecord) => {
    const e = entries.get(l.handle);
    return e && (s.mask & LAYER_STATE_MASK.frozen) !== 0 ? e.frozen : l.frozen;
  };
  const current =
    named && !keepsFrozen(named)
      ? named
      : [...model.tables.layers.values()].find(
          (l) => upper(l.name) === upper(currentLayerName(model)),
        );
  const b = new ChangeSetBuilder(model);
  for (const l of model.tables.layers.values()) {
    const e = entries.get(l.handle);
    const patch: Record<string, unknown> = e
      ? restorePatch(model, l, e, layerMask)
      : options.turnOffMissing && l.on
        ? { on: false }
        : {};
    // AutoCAD never freezes the current layer.
    if (current && l.handle === current.handle && patch['frozen'] === true) delete patch['frozen'];
    if (Object.keys(patch).length > 0) b.updateTableRecord('layers', l.handle, patch);
    if (e && overridesIn !== undefined)
      setViewportLayerProps(b, model, l.handle, overridesIn, overrideProps(model, e, s.mask));
  }
  if (viewport !== undefined) restoreViewportFreeze(b, model, s, viewport);
  if (current && upper(current.name) !== upper(currentLayerName(model)))
    b.setHeader('$CLAYER', current.name);
  for (const o of layerStates(model, true)) {
    const mask =
      o.handle === s.handle
        ? o.mask | LAYER_STATE_MASK.lastRestored
        : o.mask & ~LAYER_STATE_MASK.lastRestored;
    if (mask !== o.mask) b.updateObject(o.handle, { mask } as Partial<LayerState>);
  }
  return b.build();
}

/** The properties a viewport can override, as mask bits. */
const VIEWPORT_PROPERTIES =
  LAYER_STATE_MASK.color |
  LAYER_STATE_MASK.linetype |
  LAYER_STATE_MASK.lineweight |
  LAYER_STATE_MASK.transparency;

/** The overrides "Apply properties as viewport overrides" gives a layer from `e` under `mask`. */
function overrideProps(
  model: DocumentModel,
  e: LayerStateLayer,
  mask: number,
): ViewportOverrideProps {
  const has = (bit: number) => (mask & bit) !== 0;
  const linetype = has(LAYER_STATE_MASK.linetype) ? linetypeOf(model, e) : undefined;
  return {
    ...(has(LAYER_STATE_MASK.color) &&
      (e.color.kind === 'aci' || e.color.kind === 'rgb') && { color: e.color }),
    ...(linetype !== undefined && { linetype }),
    ...(has(LAYER_STATE_MASK.lineweight) && { lineweight: e.lineweight }),
    ...(has(LAYER_STATE_MASK.transparency) && { transparency: e.transparency }),
  };
}

/**
 * The state's VP Freeze set in `viewport`, into `b`, when it was saved in a layout (where a
 * viewport's VP Freeze is saved) and Current VP Frozen/Thawed is checked.
 */
function restoreViewportFreeze(
  b: ChangeSetBuilder,
  model: DocumentModel,
  s: LayerState,
  viewport: Handle,
): void {
  if (!s.paperSpace || (s.mask & LAYER_STATE_MASK.vpFrozen) === 0) return;
  const frozen: Handle[] = [];
  const thawed: Handle[] = [];
  for (const e of s.layers) {
    const l = layerOf(model, e);
    if (l) (e.vpFrozen ? frozen : thawed).push(l.handle);
  }
  freezeInViewports(b, model, frozen, [viewport], true);
  freezeInViewports(b, model, thawed, [viewport], false);
}

/**
 * A view's layer snapshot restored with the view (M5-07 part 7): the On and Freeze settings of
 * the layers the state names, into `b`, whatever the state's own mask says, the current layer
 * left current and thawed and no state marked restored last; in the layout viewport `viewport`
 * made current, VP Freeze there too when the snapshot was saved in a layout (M6-02 part 12).
 * False when there is no such state.
 */
export function restoreLayerVisibility(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handle: Handle,
  viewport?: Handle,
): boolean {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return false;
  const current = upper(currentLayerName(model));
  const done = new Set<Handle>();
  for (const e of s.layers) {
    const l = layerOf(model, e);
    if (!l || done.has(l.handle)) continue;
    done.add(l.handle);
    const patch: Record<string, unknown> = restorePatch(
      model,
      l,
      e,
      LAYER_STATE_MASK.on | LAYER_STATE_MASK.frozen,
    );
    // AutoCAD never freezes the current layer.
    if (upper(l.name) === current && patch['frozen'] === true) delete patch['frozen'];
    if (Object.keys(patch).length > 0) b.updateTableRecord('layers', l.handle, patch);
  }
  if (viewport !== undefined) restoreViewportFreeze(b, model, s, viewport);
  return true;
}

/** Delete: the state goes. */
export function deleteLayerStateChange(model: DocumentModel, handle: Handle): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
  const b = new ChangeSetBuilder(model);
  b.removeObject(s.handle);
  return b.build();
}

// Made on first use: VIEW's command module reaches this one (view layer snapshots) before
// properties/sheet has run when the engine's index is loaded.
let layerLineweights: ReadonlySet<unknown> | undefined;
const LAYER_LINEWEIGHTS = (): ReadonlySet<unknown> =>
  (layerLineweights ??= new Set<unknown>(['Default', ...LINEWEIGHTS]));

/**
 * Edit Layer State's layers, checked and made consistent with the drawing: a layer named by
 * handle takes the drawing's name for it (a rename since the save), a linetype named by handle
 * the record's name; or why they are refused. A layer the drawing lacks (a `.las` file's) stays
 * named, as the state keeps it.
 */
function editedLayers(
  model: DocumentModel,
  layers: readonly LayerStateLayer[],
): LayerStateLayer[] | string {
  const out: LayerStateLayer[] = [];
  const seen = new Set<string>();
  for (const e of layers) {
    const l = e.layer === undefined ? undefined : model.tables.layers.get(e.layer);
    if (e.layer !== undefined && !l) return `Layer "${e.name}" is not in the drawing.`;
    const name = l?.name ?? e.name;
    if (name.trim() === '') return 'A layer in the state has no name.';
    if (seen.has(upper(name))) return `Layer "${e.name}" is listed twice.`;
    seen.add(upper(name));
    if (e.color.kind !== 'aci' && e.color.kind !== 'rgb')
      return 'A layer’s color cannot be ByLayer or ByBlock.';
    const linetype = e.linetype === undefined ? undefined : model.tables.linetypes.get(e.linetype);
    if (e.linetype !== undefined && !linetype)
      return `Linetype ${e.linetype} is not in the drawing.`;
    if (!LAYER_LINEWEIGHTS().has(e.lineweight)) return 'Invalid lineweight.';
    const t = e.transparency;
    if (typeof t !== 'object' || !Number.isInteger(t.alpha) || t.alpha < 0 || t.alpha > 255)
      return 'Invalid transparency.';
    // Spread over `e`, so its keys keep their order and an unchanged entry compares the same.
    const entry: { -readonly [K in keyof LayerStateLayer]: LayerStateLayer[K] } = {
      ...e,
      name,
      ...(linetype ? { linetypeName: linetype.name } : {}),
    };
    if (entry.layer === undefined) delete entry.layer;
    out.push(entry);
  }
  return out;
}

/**
 * Rename (the list's name in place), Edit (description, layer properties to restore) and Edit
 * Layer State (the layers and their settings, M5-07 part 3).
 */
export function editLayerStateChange(
  model: DocumentModel,
  handle: Handle,
  edit: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly mask?: number | undefined;
    readonly layers?: readonly LayerStateLayer[] | undefined;
  },
): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
  const layers = edit.layers === undefined ? undefined : editedLayers(model, edit.layers);
  if (typeof layers === 'string') return layers;
  const why =
    (edit.name === undefined ? undefined : nameProblem(model, edit.name, s.handle)) ??
    descriptionProblem(edit.description) ??
    maskProblem(edit.mask);
  if (why) return why;
  const patch = Object.fromEntries(
    Object.entries({ ...edit, layers }).filter(
      ([k, v]) => v !== undefined && !sameValue(s[k as keyof LayerState], v),
    ),
  );
  const b = new ChangeSetBuilder(model);
  if (Object.keys(patch).length > 0) b.updateObject(s.handle, patch);
  return b.build();
}

/**
 * Layers deleted (Delete Layer, M5-05): each state stops naming them, as a state names layers
 * of the drawing only (a save writes each by handle).
 */
export function dropLayersFromStates(b: ChangeSetBuilder, gone: ReadonlySet<Handle>): void {
  for (const o of [...b.objects()]) {
    if (!isLayerState(o)) continue;
    const kept = o.layers.filter((e) => e.layer === undefined || !gone.has(e.layer));
    if (kept.length !== o.layers.length)
      b.updateObject(o.handle, { layers: kept } as Partial<LayerState>);
  }
}
