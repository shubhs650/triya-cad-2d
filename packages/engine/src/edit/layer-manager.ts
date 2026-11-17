// The Layer Properties Manager's edits (M5-05): a layer's properties set on the layers selected,
// a new layer, deleting layers and making one current. Each builds one change set, or says why
// AutoCAD would refuse it; the engine session makes it one LAYER undo step.
//
// AutoCAD 2024 Help, "Layer Properties Manager": a new layer "inherits the properties of the
// currently selected layer in the layer list (color, on or off state, and so on)" and is named
// LayerN; a click in a column of a selected row changes every selected layer. Layer 0 and
// Defpoints, the current layer, layers with objects (including objects in block definitions)
// and xref-dependent layers cannot be deleted. A frozen layer cannot be made current, nor can an
// xref-dependent one.
import { LINEWEIGHT_VALUES } from '../commands/sysvars';
import { ChangeSetBuilder } from '../model/builder';
import { dropLayersFromStates } from './layer-states';
import { eraseObjects } from './edit';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Color, LayerRecord, Lineweight, Transparency } from '../model/types';

/** What a row of the manager edits; absent fields stay as they are. */
export interface LayerProps {
  readonly name?: string;
  readonly on?: boolean;
  readonly frozen?: boolean;
  readonly locked?: boolean;
  readonly plot?: boolean;
  /** An ACI 1–255 or a true colour: a layer is never ByLayer or ByBlock. */
  readonly color?: Color;
  /** An LTYPE record of the drawing. */
  readonly linetype?: Handle;
  /** Hundredths of a millimetre from AutoCAD's list, or Default. */
  readonly lineweight?: Lineweight;
  /** Alpha 25 (90 %) to 255 (opaque): AutoCAD's layer transparency is 0–90 %. */
  readonly transparency?: Transparency;
  /** '' takes the description off. */
  readonly description?: string;
}

/** DXF 70 bit 16: a record that came in with an xref. */
const XREF_DEPENDENT = 16;
/** Characters AutoCAD refuses in a symbol table name, and its 255-character limit. */
const NAME_INVALID = /[<>/\\":;?*|,=`]/;
const NAME_MAX = 255;
/** The most transparent a layer may be: 90 %, alpha trunc(255 × 10 / 100). */
const MIN_ALPHA = 25;
/** DXF reference: an extended-data string, which keeps a description, is up to 255 bytes. */
const DESCRIPTION_MAX = 255;

const upper = (s: string) => s.toUpperCase();
const isXref = (l: LayerRecord) => ((l.flags ?? 0) & XREF_DEPENDENT) !== 0;
const isFixed = (l: LayerRecord) => upper(l.name) === '0' || upper(l.name) === 'DEFPOINTS';

function currentName(model: DocumentModel): string | undefined {
  const c = model.header.get('$CLAYER');
  return typeof c === 'string' ? c : undefined;
}

const isCurrent = (model: DocumentModel, l: LayerRecord) =>
  upper(l.name) === upper(currentName(model) ?? '\0');

function named(model: DocumentModel, name: string): LayerRecord | undefined {
  const key = upper(name);
  for (const l of model.tables.layers.values()) if (upper(l.name) === key) return l;
  return undefined;
}

/** Why `name` cannot name a layer (other than `self`), or undefined. */
function nameProblem(model: DocumentModel, name: string, self?: Handle): string | undefined {
  if (name.trim() === '' || name.length > NAME_MAX || NAME_INVALID.test(name))
    return 'Invalid layer name.';
  const other = named(model, name);
  if (other && other.handle !== self) return `A layer named "${other.name}" already exists.`;
  return undefined;
}

function propsProblem(model: DocumentModel, p: LayerProps): string | undefined {
  if (p.color && p.color.kind !== 'aci' && p.color.kind !== 'rgb')
    return 'A layer cannot be ByLayer or ByBlock.';
  if (p.color?.kind === 'aci' && (p.color.index < 1 || p.color.index > 255))
    return 'Invalid color.';
  if (p.linetype !== undefined && !model.tables.linetypes.has(p.linetype))
    return `No linetype ${p.linetype}.`;
  const w = p.lineweight;
  if (
    w !== undefined &&
    w !== 'Default' &&
    !(typeof w === 'number' && LINEWEIGHT_VALUES.includes(w))
  )
    return 'Invalid lineweight.';
  const t = p.transparency;
  if (t !== undefined && (typeof t === 'string' || !(t.alpha >= MIN_ALPHA && t.alpha <= 255)))
    return 'Transparency must be between 0 and 90.';
  if (p.description !== undefined && p.description.length > DESCRIPTION_MAX)
    return `A description is at most ${DESCRIPTION_MAX} characters.`;
  return undefined;
}

const sameColor = (a: Color, b: Color) => JSON.stringify(a) === JSON.stringify(b);
const sameTransparency = (a: Transparency, b: Transparency) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The fields of `p` that change `l`, as a record patch. */
function patchOf(l: LayerRecord, p: LayerProps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'on', 'frozen', 'locked', 'plot', 'linetype', 'lineweight'] as const)
    if (p[k] !== undefined && p[k] !== l[k]) out[k] = p[k];
  if (p.color && !sameColor(p.color, l.color)) out.color = p.color;
  if (p.transparency && !sameTransparency(p.transparency, l.transparency))
    out.transparency = p.transparency;
  if (p.description !== undefined && p.description !== (l.description ?? ''))
    out.description = p.description === '' ? undefined : p.description;
  return out;
}

function layersOf(model: DocumentModel, handles: readonly Handle[]): LayerRecord[] | string {
  const out: LayerRecord[] = [];
  for (const h of handles) {
    const l = model.tables.layers.get(h);
    if (!l) return `No layer ${h}.`;
    out.push(l);
  }
  return out;
}

/** `props` set on every layer of `handles`: the change, or why AutoCAD refuses it. */
export function layerPropsChange(
  model: DocumentModel,
  handles: readonly Handle[],
  props: LayerProps,
): ChangeSet | string {
  const layers = layersOf(model, handles);
  if (typeof layers === 'string') return layers;
  const problem = propsProblem(model, props);
  if (problem) return problem;
  // AutoCAD refuses to freeze the current layer ("Cannot freeze the current layer.") but lets
  // it be turned off, with a warning only.
  if (props.frozen === true && layers.some((l) => !l.frozen && isCurrent(model, l)))
    return 'Cannot freeze the current layer.';
  let rename: string | undefined;
  if (props.name !== undefined) {
    if (layers.length !== 1) return 'Select one layer to rename.';
    const l = layers[0]!;
    if (props.name !== l.name) {
      // AutoCAD: "The name of layer 0 cannot be changed"; an xref's layers are renamed in it.
      if (upper(l.name) === '0') return 'The name of layer 0 cannot be changed.';
      if (isXref(l)) return 'An xref-dependent layer cannot be renamed.';
      const why = nameProblem(model, props.name, l.handle);
      if (why) return why;
      if (isCurrent(model, l)) rename = props.name;
    }
  }
  const b = new ChangeSetBuilder(model);
  for (const l of layers) {
    const patch = patchOf(l, props);
    if (Object.keys(patch).length > 0) b.updateTableRecord('layers', l.handle, patch);
  }
  // $CLAYER names the current layer, so it follows a rename.
  if (rename !== undefined) b.setHeader('$CLAYER', rename);
  return b.build();
}

/** AutoCAD's name for a new layer: Layer1, Layer2, …, the first no layer has. */
export function newLayerName(model: DocumentModel): string {
  const taken = new Set([...model.tables.layers.values()].map((l) => upper(l.name)));
  for (let n = 1; ; n++) if (!taken.has(`LAYER${n}`)) return `Layer${n}`;
}

/**
 * A new layer with `like`'s properties (layer 0's when none is selected) and none of its
 * description, xdata or viewport overrides: the change, or why it cannot be made.
 */
export function newLayerChange(
  model: DocumentModel,
  like?: Handle,
  name: string = newLayerName(model),
): ChangeSet | string {
  const why = nameProblem(model, name);
  if (why) return why;
  const base =
    like === undefined
      ? (named(model, '0') ?? model.tables.layers.values().next().value)
      : model.tables.layers.get(like);
  if (!base) return like === undefined ? 'The drawing has no layers.' : `No layer ${like}.`;
  const b = new ChangeSetBuilder(model);
  b.addTableRecord('layers', {
    name,
    color: base.color,
    linetype: base.linetype,
    lineweight: base.lineweight,
    transparency: base.transparency,
    plot: base.plot,
    on: base.on,
    // A new layer is not xref-dependent, and an xref layer's frozen state is the xref's.
    frozen: isXref(base) ? false : base.frozen,
    locked: base.locked,
    ...(base.plotStyle !== undefined && { plotStyle: base.plotStyle }),
  });
  return b.build();
}

/** The layers any object is on: in model space, the layouts and every block definition. */
export function layersInUse(model: DocumentModel): Set<Handle> {
  const used = new Set<Handle>();
  for (const e of model.entities()) used.add(e.layer);
  return used;
}

/**
 * `handles` deleted, as the manager's Delete Layer does: each also leaves the viewports that
 * freeze it. All or nothing: the first layer AutoCAD keeps says why.
 */
export function deleteLayersChange(
  model: DocumentModel,
  handles: readonly Handle[],
): ChangeSet | string {
  const layers = layersOf(model, handles);
  if (typeof layers === 'string') return layers;
  const used = layersInUse(model);
  for (const l of layers) {
    const why = isFixed(l)
      ? 'layer 0 and Defpoints cannot be deleted'
      : isCurrent(model, l)
        ? 'it is the current layer'
        : isXref(l)
          ? 'it is xref-dependent'
          : used.has(l.handle)
            ? 'it has objects (including objects in block definitions)'
            : undefined;
    if (why) return `Layer "${l.name}" was not deleted: ${why}.`;
  }
  const gone = new Set(layers.map((l) => l.handle));
  const b = new ChangeSetBuilder(model);
  for (const e of model.entities()) {
    if (e.geom.kind !== 'VIEWPORT') continue;
    const kept = e.geom.frozenLayers.filter((h) => !gone.has(h));
    if (kept.length !== e.geom.frozenLayers.length)
      b.updateEntity(e.id, { geom: { ...e.geom, frozenLayers: kept } });
  }
  for (const h of gone) b.removeTableRecord('layers', h);
  // Layer states stop naming them (M5-07).
  dropLayersFromStates(b, gone);
  return b.build();
}

/** `handle` made the current layer ($CLAYER): the change (empty when it is), or why not. */
export function currentLayerChange(model: DocumentModel, handle: Handle): ChangeSet | string {
  const l = model.tables.layers.get(handle);
  if (!l) return `No layer ${handle}.`;
  if (isXref(l)) return 'Cannot set an xref-dependent layer current.';
  if (l.frozen) return 'Cannot set a frozen layer current.';
  if (currentName(model) === l.name) return {};
  const b = new ChangeSetBuilder(model);
  b.setHeader('$CLAYER', l.name);
  return b.build();
}

/**
 * `handles` merged into `target`, as the manager's Merge Selected Layer(s) to does: every object
 * on them (in model space, the layouts, every block definition and a block reference's
 * attributes) moves to `target`, then the layers go as Delete Layer takes them (out of the
 * viewports that freeze them and the layer states that name them). All or nothing.
 *
 * AutoCAD's help does not say what it does with layer 0, Defpoints, the current layer or an
 * xref-dependent layer as a source; merging deletes the layer, so these are refused as Delete
 * Layer refuses them (the drafter makes another layer current first). The target may not be one
 * of the sources nor xref-dependent, as no object of the drawing can go on an xref's layer.
 */
export function mergeLayersChange(
  model: DocumentModel,
  handles: readonly Handle[],
  target: Handle,
): ChangeSet | string {
  const b = new ChangeSetBuilder(model);
  return mergeLayers(b, model, handles, target) ?? b.build();
}

/**
 * {@link mergeLayersChange} into `b` (LAYMRG builds in its command's edit): undefined when
 * merged, otherwise why not, with nothing built.
 */
export function mergeLayers(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handles: readonly Handle[],
  target: Handle,
): string | undefined {
  const layers = layersOf(model, handles);
  if (typeof layers === 'string') return layers;
  if (layers.length === 0) return 'Select the layers to merge.';
  const into = model.tables.layers.get(target);
  if (!into) return `No layer ${target}.`;
  if (isXref(into)) return 'Cannot merge into an xref-dependent layer.';
  for (const l of layers) {
    const why =
      l.handle === target
        ? 'it is the target layer'
        : isFixed(l)
          ? 'layer 0 and Defpoints cannot be merged'
          : isCurrent(model, l)
            ? 'it is the current layer'
            : isXref(l)
              ? 'it is xref-dependent'
              : undefined;
    if (why) return `Layer "${l.name}" was not merged: ${why}.`;
  }
  const gone = new Set(layers.map((l) => l.handle));
  for (const e of model.entities()) {
    const g = e.geom;
    const attributes =
      g.kind === 'INSERT' && g.attributes.some((a) => gone.has(a.layer))
        ? g.attributes.map((a) => (gone.has(a.layer) ? { ...a, layer: target } : a))
        : undefined;
    const frozen =
      g.kind === 'VIEWPORT' && g.frozenLayers.some((h) => gone.has(h))
        ? g.frozenLayers.filter((h) => !gone.has(h))
        : undefined;
    const patch = {
      ...(gone.has(e.layer) && { layer: target }),
      ...(attributes && g.kind === 'INSERT' && { geom: { ...g, attributes } }),
      ...(frozen && g.kind === 'VIEWPORT' && { geom: { ...g, frozenLayers: frozen } }),
    };
    if (Object.keys(patch).length > 0) b.updateEntity(e.id, patch);
  }
  for (const h of gone) b.removeTableRecord('layers', h);
  dropLayersFromStates(b, gone);
  return undefined;
}

/**
 * Why LAYDEL or LAYMRG cannot take `l` from the drawing, or undefined. AutoCAD's help names no
 * layer they refuse; both purge the layer, so they refuse what the manager's Delete Layer does
 * (layer 0, Defpoints, the current layer and an xref's layers), as Merge Selected Layer(s) to.
 */
export function layerRemovalProblem(
  model: DocumentModel,
  l: LayerRecord,
  verb: 'deleted' | 'merged',
): string | undefined {
  if (isFixed(l)) return `Layer "${l.name}" cannot be ${verb}.`;
  if (isCurrent(model, l)) return `Layer "${l.name}" is the current layer and cannot be ${verb}.`;
  if (isXref(l)) return `Layer "${l.name}" is xref-dependent and cannot be ${verb}.`;
  return undefined;
}

/**
 * LAYDEL (AutoCAD Help, "LAYDEL (Command)": "Deletes all objects on a layer and purges the
 * layer. This command also changes block definitions that use the layer to be deleted."): every
 * object on `handles`, in model space, the layouts and every block definition, erased as ERASE
 * erases it (whatever refers to it lets go), a block reference's attributes on them dropped, the
 * layers out of the viewports and layer states and purged. All or nothing: undefined when done,
 * otherwise why not, with nothing built.
 */
export function deleteLayersWithObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handles: readonly Handle[],
): string | undefined {
  const layers = layersOf(model, handles);
  if (typeof layers === 'string') return layers;
  if (layers.length === 0) return 'Select the layers to delete.';
  for (const l of layers) {
    const why = layerRemovalProblem(model, l, 'deleted');
    if (why) return why;
  }
  const gone = new Set(layers.map((l) => l.handle));
  const on = [...model.entities()].filter((e) => gone.has(e.layer));
  // A layout's own paper-space view (VIEWPORT id 1) is not an object the drafter can erase.
  const sheet = on.find((e) => e.geom.kind === 'VIEWPORT' && e.geom.id === 1);
  if (sheet) {
    const l = model.tables.layers.get(sheet.layer)!;
    return `Layer "${l.name}" holds a layout's paper-space view and cannot be deleted.`;
  }
  // A layer's viewport overrides name their viewport, which cannot be erased yet (M1-62).
  const overridden = new Set<Handle>();
  for (const l of model.tables.layers.values())
    for (const o of l.viewportOverrides ?? []) overridden.add(o.viewport);
  const kept = on.find((e) => overridden.has(e.handle));
  if (kept) {
    const l = model.tables.layers.get(kept.layer)!;
    return `Layer "${l.name}" holds a viewport with layer overrides, which cannot be erased yet.`;
  }
  eraseObjects(
    b,
    model,
    on.map((e) => e.id),
  );
  for (const e of model.entities()) {
    // As ERASE left it: an erased object is gone, a kept one may have let go of one erased.
    const g = b.entity(e.id)?.geom;
    if (!g) continue;
    if (g.kind === 'INSERT' && g.attributes.some((a) => gone.has(a.layer)))
      b.updateEntity(e.id, {
        geom: { ...g, attributes: g.attributes.filter((a) => !gone.has(a.layer)) },
      });
    if (g.kind === 'VIEWPORT' && g.frozenLayers.some((h) => gone.has(h)))
      b.updateEntity(e.id, {
        geom: { ...g, frozenLayers: g.frozenLayers.filter((h) => !gone.has(h)) },
      });
  }
  for (const h of gone) b.removeTableRecord('layers', h);
  dropLayersFromStates(b, gone);
  return undefined;
}
