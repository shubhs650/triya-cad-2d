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
