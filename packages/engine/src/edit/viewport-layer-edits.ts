// Layer visibility and property overrides in layout viewports (M6-02 part 5: VPLAYER, MVIEW
// LAyer). AutoCAD 2024 Help, "VPLAYER (Command)": a layer can be frozen in some viewports and
// thawed in others (the VIEWPORT's frozen layers, DXF 341), and shown in a viewport with another
// colour, linetype, lineweight or transparency than its own (the layer's `viewportOverrides`,
// AutoCAD's ADSK_XREC_LAYER_*_OVR XRECORDs, which `layout/viewport-layers.ts` applies), and in a
// drawing with named plot styles with another plot style (M6-07: VPLAYER PStyle, the manager's VP
// Plot Style; `ADSK_XREC_LAYER_PLOTSTYLE_OVR`, which the plot reads through the same layers). A layer's
// viewport visibility default (DXF 70 bit 2, "frozen by default in new viewports") is what a new
// viewport and VPLAYER Reset give it.
//
// Each function writes into the builder only what changes, so an edit that changes nothing
// builds an empty change set.
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import { namedPlotStyles } from '../properties/general';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  Color,
  Entity,
  LayerRecord,
  LayerViewportOverride,
  Lineweight,
  Transparency,
  ViewportGeometry,
} from '../model/types';

/** DXF 70 bit 2 of a LAYER: "Layer is frozen by default in new viewports". */
export const NEW_VP_FROZEN = 2;

/** The properties a viewport can override (VPLAYER Color, Ltype, LWeight, PStyle, TRansparency). */
export interface ViewportOverrideProps {
  readonly color?: Color;
  readonly linetype?: Handle;
  readonly lineweight?: Lineweight;
  readonly transparency?: Transparency;
  /** A named plot style (ACAD_PLOTSTYLENAME), in a drawing with named plot styles only (M6-07). */
  readonly plotStyle?: Handle;
}

type ViewportEntity = Entity & { geom: ViewportGeometry };

const viewportOf = (model: DocumentModel, h: Handle): ViewportEntity | undefined => {
  const e = model.entityByHandle(h);
  return e?.geom.kind === 'VIEWPORT' ? (e as ViewportEntity) : undefined;
};

/** Whether two override entries hold the same values. */
const sameOverride = (a: LayerViewportOverride, b: LayerViewportOverride): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The layer's override list after `edit` maps each entry (undefined drops it), if it changed. */
function rewrite(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layer: Handle,
  next: (list: readonly LayerViewportOverride[]) => LayerViewportOverride[],
): void {
  const l = model.tables.layers.get(layer);
  if (!l) return;
  const before = l.viewportOverrides ?? [];
  const after = next(before);
  if (after.length === before.length && after.every((o, i) => sameOverride(o, before[i]!))) return;
  b.updateTableRecord('layers', layer, {
    viewportOverrides: after.length > 0 ? after : undefined,
  });
}

/**
 * `props` overriding each of `layers` in each of `viewports`, beside what each viewport already
 * overrides (VPLAYER Color, Ltype, LWeight and TRansparency, one property at a time).
 */
export function setViewportOverrides(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layers: readonly Handle[],
  viewports: readonly Handle[],
  props: ViewportOverrideProps,
): void {
  for (const layer of layers) {
    rewrite(b, model, layer, (list) => {
      const out = [...list];
      for (const viewport of viewports) {
        const at = out.findIndex((o) => o.viewport === viewport);
        // The viewport first, as the reader builds an entry.
        const merged = { viewport, ...(at >= 0 ? out[at] : {}), ...props };
        if (at >= 0) out[at] = merged;
        else out.push(merged);
      }
      return out;
    });
  }
}

/**
 * Every property override of `viewports` removed, of `layers` or of every layer (MVIEW LAyer:
 * "Reset viewport layer property overrides back to global properties").
 */
export function removeViewportOverrides(
  b: ChangeSetBuilder,
  model: DocumentModel,
  viewports: readonly Handle[],
  layers: readonly Handle[] = [...model.tables.layers.keys()],
): void {
  const gone = new Set(viewports);
  for (const layer of layers)
    rewrite(b, model, layer, (list) => list.filter((o) => !gone.has(o.viewport)));
}

/** `layers` frozen (or thawed) in each of `viewports`: their DXF 341 lists. */
export function freezeInViewports(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layers: readonly Handle[],
  viewports: readonly Handle[],
  frozen: boolean,
): void {
  for (const h of viewports) {
    const vp = viewportOf(model, h);
    if (!vp) continue;
    const g = (b.entity(vp.id)?.geom ?? vp.geom) as ViewportGeometry;
    const has = new Set(g.frozenLayers);
    const next = frozen
      ? [...g.frozenLayers, ...layers.filter((l) => !has.has(l))]
      : g.frozenLayers.filter((l) => !layers.includes(l));
    if (next.length !== g.frozenLayers.length)
      b.updateEntity(vp.id, { geom: { ...g, frozenLayers: next } });
  }
}

/** Whether `layer` is frozen in new viewports (VPLAYER Vpvisdflt, the LPM's New VP Freeze). */
export const newViewportFrozen = (model: DocumentModel, layer: Handle): boolean =>
  ((model.tables.layers.get(layer)?.flags ?? 0) & NEW_VP_FROZEN) !== 0;

/** The layers a new viewport starts frozen in, in table order. */
export const newViewportFrozenLayers = (model: DocumentModel): Handle[] =>
  [...model.tables.layers.keys()].filter((h) => newViewportFrozen(model, h));

/**
 * VPLAYER Reset: `layers` frozen or thawed in `viewports` as their viewport visibility default
 * says (Help: "Sets the visibility of layers in specified viewports to their current default
 * setting").
 */
export function resetInViewports(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layers: readonly Handle[],
  viewports: readonly Handle[],
): void {
  const frozen = layers.filter((l) => newViewportFrozen(model, l));
  const thawed = layers.filter((l) => !newViewportFrozen(model, l));
  freezeInViewports(b, model, frozen, viewports, true);
  freezeInViewports(b, model, thawed, viewports, false);
}

/** VPLAYER Vpvisdflt: `layers` frozen (or thawed) by default in new viewports. */
export function setNewViewportFrozen(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layers: readonly Handle[],
  frozen: boolean,
): void {
  for (const h of layers) {
    const l = model.tables.layers.get(h);
    if (!l) continue;
    const flags = l.flags ?? 0;
    const next = frozen ? flags | NEW_VP_FROZEN : flags & ~NEW_VP_FROZEN;
    if (next !== flags) b.updateTableRecord('layers', h, { flags: next });
  }
}

/** The Layer Properties Manager's VP columns in the viewport made current (M6-02 part 8). */
export interface ViewportLayerProps extends ViewportOverrideProps {
  /** VP Freeze. */
  readonly frozen?: boolean;
}

const OVERRIDE_KEYS = ['color', 'linetype', 'lineweight', 'transparency', 'plotStyle'] as const;

/**
 * The named plot style a layer plots by: its own (DXF 390), else the drawing's Normal, which
 * AutoCAD gives a layer that names none (the ACAD_PLOTSTYLENAME default).
 */
export function layerPlotStyle(model: DocumentModel, layer: LayerRecord): Handle | undefined {
  if (layer.plotStyle !== undefined) return layer.plotStyle;
  for (const s of model.tables.plotStyles.values())
    if (s.name.toUpperCase() === 'NORMAL') return s.handle;
  return undefined;
}

/** Whether `value` is what `layer` has of its own for `key` (no override needed). */
const ownValue = (
  model: DocumentModel,
  layer: LayerRecord,
  key: (typeof OVERRIDE_KEYS)[number],
  value: unknown,
): boolean =>
  key === 'plotStyle'
    ? layerPlotStyle(model, layer) === value
    : JSON.stringify(layer[key]) === JSON.stringify(value);

/**
 * Why `props` cannot be set as viewport overrides in this drawing: a plot style override needs
 * named plot styles (AutoCAD greys VP Plot Style in a colour-dependent drawing and VPLAYER does
 * not offer PStyle) and a plot style of the drawing.
 */
export function overridePropsProblem(
  model: DocumentModel,
  props: ViewportOverrideProps,
): string | undefined {
  if (props.plotStyle === undefined) return undefined;
  if (!namedPlotStyles(model)) return 'The drawing uses color-dependent plot styles.';
  return model.tables.plotStyles.has(props.plotStyle)
    ? undefined
    : `No plot style ${props.plotStyle}.`;
}

/** A viewport property override's key (the manager's VP cells). */
export type ViewportOverrideKey = (typeof OVERRIDE_KEYS)[number];

/** Why `viewport` is not a floating viewport of a layout, or undefined when it is. */
export function layoutViewportProblem(model: DocumentModel, viewport: Handle): string | undefined {
  const vp = viewportOf(model, viewport);
  return !vp || vp.geom.id === 1 ? `No layout viewport ${viewport}.` : undefined;
}

/**
 * `props` as `layer`'s overrides in `viewport`, into `b`: a value equal to the layer's own
 * removes that override (and the viewport's entry with its last one).
 */
export function setViewportLayerProps(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layer: Handle,
  viewport: Handle,
  props: ViewportOverrideProps,
): void {
  const record = model.tables.layers.get(layer);
  const keys = OVERRIDE_KEYS.filter((k) => props[k] !== undefined);
  if (!record || keys.length === 0) return;
  rewrite(b, model, layer, (list) => {
    const at = list.findIndex((o) => o.viewport === viewport);
    // The viewport first, as the reader builds an entry.
    const entry: Record<string, unknown> = { viewport, ...(at >= 0 ? list[at] : {}) };
    for (const k of keys) {
      if (ownValue(model, record, k, props[k])) delete entry[k];
      else entry[k] = props[k];
    }
    const kept = OVERRIDE_KEYS.some((k) => entry[k] !== undefined);
    const out = [...list];
    if (at >= 0 && kept) out[at] = entry as unknown as LayerViewportOverride;
    else if (at >= 0) out.splice(at, 1);
    else if (kept) out.push(entry as unknown as LayerViewportOverride);
    return out;
  });
}

/**
 * The manager's VP Freeze, VP Color, VP Linetype, VP Lineweight, VP Transparency and VP Plot
 * Style (M6-07) on `layers` in the floating viewport `viewport` (AutoCAD 2024 Help, "Layer
 * Properties Manager": "for the active layout viewport"). A VP value set to the layer's own value removes that override (and
 * the viewport's entry with its last one): Help does not say whether such an override is kept,
 * and the drafter setting it back expects the cell to read as not overridden again.
 */
export function viewportLayerChange(
  model: DocumentModel,
  layers: readonly Handle[],
  viewport: Handle,
  props: ViewportLayerProps,
): ChangeSet | string {
  const why = layoutViewportProblem(model, viewport);
  if (why) return why;
  const unknown = layers.find((h) => !model.tables.layers.has(h));
  if (unknown !== undefined) return `No layer ${unknown}.`;
  const bad = overridePropsProblem(model, props);
  if (bad) return bad;
  const b = new ChangeSetBuilder(model);
  if (props.frozen !== undefined) freezeInViewports(b, model, layers, [viewport], props.frozen);
  for (const h of layers) setViewportLayerProps(b, model, h, viewport, props);
  return b.build();
}

/**
 * The layer list menu's Remove Viewport Overrides For (M6-02 part 12; AutoCAD 2024 Help, "Layer
 * Properties Manager": "Removes a single property override or all property overrides on
 * selected layers or all layers, for either the current viewport or all viewports"): the
 * overrides of `layers` (every layer when absent) in `viewport` (every viewport when absent), of
 * `property` only (the VP cell right-clicked) or of every one. VP Freeze is not an override.
 */
export function removeViewportOverridesChange(
  model: DocumentModel,
  o: {
    readonly layers?: readonly Handle[] | undefined;
    readonly viewport?: Handle | undefined;
    readonly property?: ViewportOverrideKey | undefined;
  },
): ChangeSet | string {
  const why = o.viewport === undefined ? undefined : layoutViewportProblem(model, o.viewport);
  if (why) return why;
  const unknown = o.layers?.find((h) => !model.tables.layers.has(h));
  if (unknown !== undefined) return `No layer ${unknown}.`;
  const b = new ChangeSetBuilder(model);
  for (const h of o.layers ?? [...model.tables.layers.keys()]) {
    rewrite(b, model, h, (list) =>
      list.flatMap((e) => {
        if (o.viewport !== undefined && e.viewport !== o.viewport) return [e];
        if (o.property === undefined) return [];
        const rest: Record<string, unknown> = { ...e };
        delete rest[o.property];
        return OVERRIDE_KEYS.some((k) => rest[k] !== undefined)
          ? [rest as unknown as LayerViewportOverride]
          : [];
      }),
    );
  }
  return b.build();
}

/** The layers `viewport` overrides a property of (the Viewport Overrides filter node). */
export function viewportOverrideLayers(
  layers: Iterable<LayerRecord>,
  viewport: Handle,
): LayerRecord[] {
  return [...layers].filter((l) =>
    (l.viewportOverrides ?? []).some(
      (o) => o.viewport === viewport && OVERRIDE_KEYS.some((k) => o[k] !== undefined),
    ),
  );
}

/** The layers frozen in `viewport` (its DXF 341), when it is a viewport. */
export function frozenInViewport(model: DocumentModel, viewport: Handle): ReadonlySet<Handle> {
  return new Set(viewportOf(model, viewport)?.geom.frozenLayers ?? []);
}

/** Every layout's floating viewports (not a sheet's own, 69 = 1), in layout tab order. */
export function layoutViewports(model: DocumentModel): ViewportEntity[] {
  const out: ViewportEntity[] = [];
  const layouts = [...model.layouts].sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0));
  for (const layout of layouts) {
    if (model.tables.blockRecords.get(layout.blockRecord)?.name.toUpperCase() === '*MODEL_SPACE')
      continue;
    for (const id of model.blockEntities(layout.blockRecord)) {
      const e = model.entity(id);
      if (e?.geom.kind === 'VIEWPORT' && e.geom.id !== 1) out.push(e as ViewportEntity);
    }
  }
  return out;
}
