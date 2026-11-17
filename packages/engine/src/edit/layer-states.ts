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
//   - Import takes a `.las` file's state (io `parseLas`): layers it names that the drawing does
//     not have are kept by name, as the file names them, and skipped on restore.
//
// AutoCAD never freezes the current layer ("Cannot freeze the current layer"), so a restore leaves
// the layer current after it thawed. A state hidden from the manager (a view's layer snapshot,
// `ACAD_VIEWS_<view>`, mask bit 0x8000) is restored with its view (later part), not listed.
//
// VP Freeze in the current viewport (`vpFrozen`) waits for a layout viewport to be made current
// (MSPACE, M6-02): a state saved here keeps it off and a restore leaves it alone.
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import { aciOfTrueColor } from '../model/aci';
import {
  LAYER_STATE_MASK,
  isLayerState,
  type Color,
  type LayerRecord,
  type LayerState,
  type LayerStateLayer,
} from '../model/types';

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

/** A layer's settings now, as a state keeps them. */
function layerSettings(model: DocumentModel, l: LayerRecord): LayerStateLayer {
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
    vpFrozen: false,
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
  b.addObject({ type: 'LAYER_STATE', owner: ownerFor(model, b), ...init } as Omit<
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
  const old = layerStateNamed(model, name);
  const why =
    nameProblem(model, name, old?.handle) ??
    descriptionProblem(options.description) ??
    maskProblem(options.mask);
  if (why) return why;
  const init: LayerStateInit = {
    name,
    description: options.description ?? old?.description ?? '',
    // Hidden and last restored are the state's own, not what to restore.
    mask: options.mask ?? (old ? old.mask & ~LAYER_STATE_MASK.lastRestored : LAYER_STATE_MASK.all),
    paperSpace: false,
    currentLayer: currentLayerName(model),
    layers: [...model.tables.layers.values()].map((l) => layerSettings(model, l)),
  };
  const b = new ChangeSetBuilder(model);
  if (old) b.updateObject(old.handle, init);
  else addState(model, b, init);
  return b.build();
}

/** A `.las` file's state imported as a new state; layers and linetypes found by name. */
export function importLayerStateChange(
  model: DocumentModel,
  state: LayerStateInit,
): ChangeSet | string {
  const why =
    nameProblem(model, state.name) ??
    descriptionProblem(state.description) ??
    maskProblem(state.mask);
  if (why) return why;
  const layers = new Map([...model.tables.layers.values()].map((l) => [upper(l.name), l]));
  const linetypes = new Map(
    [...model.tables.linetypes.values()].map((l) => [upper(l.name), l.handle]),
  );
  const b = new ChangeSetBuilder(model);
  addState(model, b, {
    ...state,
    layers: state.layers.map((e) => {
      const { layer: _l, linetype: _t, ...rest } = e;
      const layer = layers.get(upper(e.name))?.handle;
      const linetype = linetypes.get(upper(e.linetypeName));
      return { ...(layer ? { layer } : {}), ...rest, ...(linetype ? { linetype } : {}) };
    }),
  });
  return b.build();
}

function stateOf(model: DocumentModel, handle: Handle): LayerState | string {
  const s = model.objects.get(handle);
  return isLayerState(s) ? s : `No layer state ${handle}.`;
}

/** The layer an entry names: by handle, else by name. */
function layerOf(model: DocumentModel, e: LayerStateLayer): LayerRecord | undefined {
  const l = e.layer === undefined ? undefined : model.tables.layers.get(e.layer);
  if (l) return l;
  const key = upper(e.name);
  for (const r of model.tables.layers.values()) if (upper(r.name) === key) return r;
  return undefined;
}

function linetypeOf(model: DocumentModel, e: LayerStateLayer): Handle | undefined {
  if (e.linetype !== undefined && model.tables.linetypes.has(e.linetype)) return e.linetype;
  const key = upper(e.linetypeName);
  for (const r of model.tables.linetypes.values()) if (upper(r.name) === key) return r.handle;
  return undefined;
}

function plotStyleOf(model: DocumentModel, name: string): Handle | undefined {
  const key = upper(name);
  for (const r of model.tables.plotStyles.values()) if (upper(r.name) === key) return r.handle;
  return undefined;
}

const sameColor = (a: Color, b: Color): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The layer properties `e` restores under `mask`, where they differ from `l`'s. */
function restorePatch(
  model: DocumentModel,
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

/** Restore: the state's settings set on its layers, its current layer made current. */
export function restoreLayerStateChange(
  model: DocumentModel,
  handle: Handle,
  options: { readonly turnOffMissing?: boolean } = {},
): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
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
      ? restorePatch(model, l, e, s.mask)
      : options.turnOffMissing && l.on
        ? { on: false }
        : {};
    // AutoCAD never freezes the current layer.
    if (current && l.handle === current.handle && patch['frozen'] === true) delete patch['frozen'];
    if (Object.keys(patch).length > 0) b.updateTableRecord('layers', l.handle, patch);
  }
  if (current && upper(current.name) !== upper(currentLayerName(model)))
    b.setHeader('$CLAYER', current.name);
  return b.build();
}

/** Delete: the state goes. */
export function deleteLayerStateChange(model: DocumentModel, handle: Handle): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
  const b = new ChangeSetBuilder(model);
  b.removeObject(s.handle);
  return b.build();
}

/** Rename (the list's name in place) and Edit (description, layer properties to restore). */
export function editLayerStateChange(
  model: DocumentModel,
  handle: Handle,
  edit: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly mask?: number | undefined;
  },
): ChangeSet | string {
  const s = stateOf(model, handle);
  if (typeof s === 'string') return s;
  const why =
    (edit.name === undefined ? undefined : nameProblem(model, edit.name, s.handle)) ??
    descriptionProblem(edit.description) ??
    maskProblem(edit.mask);
  if (why) return why;
  const patch = Object.fromEntries(
    Object.entries(edit).filter(([k, v]) => v !== undefined && s[k as keyof LayerState] !== v),
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
