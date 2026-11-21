// TriyaToAcad for LAYER records (M1-75 part 6): writes an edited layer's changed fields onto
// its acad-ts record, by handle, and adds the layers the drawing gains under the engine's
// handles, the inverse of `layer()` in map/tables.ts. What a save cannot keep yet is refused
// before anything changes (removing a layer, xdata and reactors); the checks every table
// shares are in records.ts.
//
// A layer's transparency (M1-75 part 16) is not a DXF group: AutoCAD keeps it as
// `AcCmTransparency` xdata, one 1071 holding 0x02000000 | alpha, and 0 for an opaque layer
// (every layer of the AutoCAD-saved sample_AC1027 but its 70 % one). The model's `xdata` keeps
// the entry as read; the save rewrites it from `transparency`, registering the application
// when the drawing has none, as AutoCAD does.
//
// A layer's viewport overrides (M1-62) are XRECORDs of its extension dictionary, one per
// property (ADSK_XREC_LAYER_COLOR_OVR, _LINETYPE_OVR, _LINEWT_OVR, _ALPHA_OVR, and M6-07's
// _PLOTSTYLE_OVR, a 390 pointer to the plot style's placeholder, DEC-078), each holding a
// `102 {ADSK_LYR_…_OVERRIDE` group per viewport: the viewport (335) and the value. A change
// (VPLAYER, MVIEW LAyer; M6-02 part 5) rewrites the records whose property changed, as AutoCAD
// files them (viewport-overrides.dxf; ezdxf `store_layer_overrides`), adding the dictionary and
// a record where the layer has none (280 1, the dictionary hard owner, as for RECONCILED) and
// removing a record left with no viewport. A save refuses to remove a viewport they name.
//
// A layer's description (M1-104) is xdata too: `AcAecLayerStandard`, an empty 1000 string and
// then the text, on every layer AutoCAD has shown in the Layer Properties Manager. The save
// rewrites the second string, keeping the first (AecObjects.dwg's layer 0 holds that one only)
// and the layer's other applications; a cleared description keeps the entry with an empty
// string, as AutoCAD's layers without one do.
//
// A layer's unreconciled state (M5-19) is the ADSK_XREC_LAYER_RECONCILED XRECORD of its
// extension dictionary (map/tables.ts): a change rewrites its 290, 0 unreconciled and 1
// reconciled, adding the dictionary and the record as AutoCAD makes them (280 1, the dictionary
// hard owner) where the layer has none. A layer nobody flagged keeps having none.

import {
  ACadVersion,
  AcdbPlaceHolder,
  AppId,
  CadDictionary,
  DictionaryCloningFlags,
  ExtendedData,
  ExtendedDataInteger32,
  ExtendedDataString,
  Layer,
  LineType,
  Material,
  Viewport,
  XRecord,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  Color,
  DocumentInit,
  DocumentModel,
  Handle,
  LayerRecord,
  LayerViewportOverride,
} from '@triya/engine';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';
import { OVERRIDES, OVERRIDE_VIEWPORT, RECONCILED } from '../map/tables';

/** DXF 70 bits `frozen` and `locked` stand for; `flags` keeps the others. */
const FROZEN = 1;
const LOCKED = 4;

/** What an R12 LAYER has no group for (it states 2, 70, 62 and 6 only). */
const NOT_IN_R12 = ['lineweight', 'plot', 'plotStyle', 'material', 'transparency'] as const;

/** The application AutoCAD files a layer's transparency under. */
const TRANSPARENCY_APP = 'AcCmTransparency';
/** The application AutoCAD files a layer's description under. */
const DESCRIPTION_APP = 'AcAecLayerStandard';
/** DXF reference: strings in extended data "can be up to 255 bytes long". */
const MAX_DESCRIPTION = 255;
/** AcCmTransparency method "by alpha" (the high byte), beside the alpha in the low one. */
const BY_ALPHA = 0x02000000;
/**
 * The LAYER dialog takes 0–90 % and stores alpha = trunc(255 × (100 − percent) / 100): 70 % is
 * 76, as sample_AC1027 has it, and 90 % is 25, the most transparent a layer can be.
 */
const MIN_ALPHA = 25;
const OPAQUE = { alpha: 255 } as const;

export type LayerPlan = RecordPlan<Layer, LayerRecord>;

/** The model's layer changes against the original's mapping, and why any cannot be written. */
export function planLayers(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: LayerPlan; problems: string[] } {
  const planned = planRecords(doc, base.tables?.layers ?? [], model.tables.layers, r, {
    what: 'layer',
    removable: true,
    type: Layer,
    make: (a) => new Layer(a.name),
    // AutoCAD: "The name of layer 0 cannot be changed"; an xref's layers are renamed in it.
    fixedNames: [Layer.defaultName],
    problems: (b, a) => layerProblems(r, model, doc.header?.version, b, a),
  });
  // The overrides stay in the layer's XRECORDs as read, so a viewport the save removes would
  // leave them naming a handle the file no longer has.
  for (const l of model.tables.layers.values()) {
    for (const o of l.viewportOverrides ?? []) {
      const id = model.ids.idOf(o.viewport);
      if (id === undefined || model.entity(id) === undefined)
        planned.problems.push(
          `layer ${l.name} (${l.handle}): overrides viewport ${o.viewport}, which the save removes`,
        );
    }
  }
  return planned;
}

function layerProblems(
  r: Resolver,
  model: DocumentModel,
  version: ACadVersion | undefined,
  b: LayerRecord | undefined,
  a: LayerRecord,
): string[] {
  const out: string[] = [];
  const changed = (k: keyof LayerRecord): boolean =>
    b === undefined ? a[k] !== undefined : !same(b[k], a[k]);
  if (b ? !same(b.transparency, a.transparency) : !same(a.transparency, OPAQUE)) {
    const t = a.transparency;
    if (typeof t !== 'object') out.push(`a layer transparency cannot be ${t}`);
    else if (!Number.isInteger(t.alpha) || t.alpha < 0 || t.alpha > 255)
      out.push(`transparency alpha ${t.alpha} is not a whole number from 0 to 255`);
    else if (t.alpha < MIN_ALPHA) out.push('a layer cannot be more than 90 % transparent');
  }
  const description = a.description ?? '';
  const descriptionChanged = description !== (b?.description ?? '');
  if (descriptionChanged && description.length > MAX_DESCRIPTION)
    out.push(`a description longer than ${MAX_DESCRIPTION} characters`);
  // AutoCAD's own R12 save drops every layer's description (ACadSharp's sample_AC1009 keeps the
  // AcAecLayerStandard APPID but no layer's entry), so an R12 file has nowhere AutoCAD reads one.
  if (descriptionChanged && version !== undefined && version <= ACadVersion.AC1009)
    out.push('an R12 layer does not store its description');
  if (changed('viewportOverrides')) out.push(...overrideProblems(r, model, version, a));
  if (changed('color') && (a.color.kind === 'byLayer' || a.color.kind === 'byBlock'))
    out.push(`a layer colour cannot be ${a.color.kind}`);
  if (changed('linetype') && !resolve(r, a.linetype, LineType))
    out.push(`linetype ${a.linetype} does not exist`);
  if (changed('lineweight') && (a.lineweight === 'ByLayer' || a.lineweight === 'ByBlock'))
    out.push(`a layer lineweight cannot be ${a.lineweight}`);
  if (changed('material') && a.material && !resolve(r, a.material, Material))
    out.push(`material ${a.material} does not exist`);
  if (
    changed('plotStyle') &&
    a.plotStyle &&
    !r.store.original(a.plotStyle) &&
    !r.created.has(a.plotStyle)
  )
    out.push(`plot style ${a.plotStyle} does not exist`);
  if (version !== undefined && version <= ACadVersion.AC1009) {
    for (const k of NOT_IN_R12) {
      // A new layer's defaults are what an R12 layer reads back with.
      const lost = b
        ? changed(k)
        : k === 'lineweight'
          ? a.lineweight !== 'Default'
          : k === 'plot'
            ? !a.plot
            : k === 'transparency'
              ? !same(a.transparency, OPAQUE)
              : a[k] !== undefined;
      if (lost) out.push(`an R12 layer does not store its ${k}`);
    }
  }
  return out;
}

/** Why the save cannot write a layer's viewport overrides as `a` has them. */
function overrideProblems(
  r: Resolver,
  model: DocumentModel,
  version: ACadVersion | undefined,
  a: LayerRecord,
): string[] {
  const list = a.viewportOverrides ?? [];
  // An R12 file has no extension dictionaries, where AutoCAD files the overrides.
  if (version !== undefined && version <= ACadVersion.AC1009 && list.length > 0)
    return ['an R12 layer does not store viewport overrides'];
  const out: string[] = [];
  for (const o of list) {
    // A viewport the same save adds (COPY, LAYOUT Copy or Template, M6-02 part 18) is written
    // before the overrides are (`writeLayerOverrides`).
    const added = r.store.original(o.viewport) === undefined && isViewport(model, o.viewport);
    if (!added && !resolve(r, o.viewport, Viewport))
      out.push(`viewport ${o.viewport} does not exist`);
    if (o.color && o.color.kind !== 'aci' && o.color.kind !== 'rgb')
      out.push(`a viewport override colour cannot be ${o.color.kind}`);
    if (o.linetype !== undefined && !resolve(r, o.linetype, LineType))
      out.push(`linetype ${o.linetype} does not exist`);
    if (o.lineweight === 'ByLayer' || o.lineweight === 'ByBlock')
      out.push(`a viewport override lineweight cannot be ${o.lineweight}`);
    const t = o.transparency;
    if (
      t !== undefined &&
      (typeof t !== 'object' || !Number.isInteger(t.alpha) || t.alpha < 0 || t.alpha > 255)
    )
      out.push('a viewport override transparency must be an alpha from 0 to 255');
    if (o.plotStyle !== undefined && !r.store.original(o.plotStyle) && !r.created.has(o.plotStyle))
      out.push(`plot style ${o.plotStyle} does not exist`);
  }
  return out;
}

/**
 * The application `name`: the drawing's own (names are matched without regard to case:
 * sample_AC1009 has ACCMTRANSPARENCY), one the same save adds, or one registered now under a
 * handle above every handle the engine handed out.
 */
function layerApp(doc: CadDocument, r: Resolver, name: string) {
  const named = (o: unknown): o is AppId =>
    o instanceof AppId && o.name.toUpperCase() === name.toUpperCase();
  const own = [...doc.appIds!].find(named) ?? [...r.created.values()].find(named);
  if (own) return own;
  const app = new AppId(name);
  app.handle = r.allocate();
  doc.appIds!.add(app);
  return app;
}

/** Rewrites a layer's AcCmTransparency 1071 from `transparency` (refused unless an alpha). */
function writeTransparency(doc: CadDocument, r: Resolver, l: Layer, a: LayerRecord): void {
  const alpha = typeof a.transparency === 'object' ? a.transparency.alpha : 255;
  const entry = [...l.extendedData].find(
    ([app]) => app.name.toUpperCase() === TRANSPARENCY_APP.toUpperCase(),
  );
  // An opaque layer without the entry reads back opaque already.
  if (!entry && alpha === 255) return;
  const value = alpha === 255 ? 0 : BY_ALPHA | alpha;
  const records = entry?.[1].records ?? [];
  const at = records.findIndex((x) => x instanceof ExtendedDataInteger32);
  const next = [...records];
  if (at >= 0) next[at] = new ExtendedDataInteger32(value);
  else next.push(new ExtendedDataInteger32(value));
  l.extendedData.set(entry?.[0] ?? layerApp(doc, r, TRANSPARENCY_APP), new ExtendedData(next));
}

/** Rewrites the second 1000 string of a layer's AcAecLayerStandard entry from `description`. */
function writeDescription(doc: CadDocument, r: Resolver, l: Layer, a: LayerRecord): void {
  const text = a.description ?? '';
  const entry = [...l.extendedData].find(
    ([app]) => app.name.toUpperCase() === DESCRIPTION_APP.toUpperCase(),
  );
  // A layer without the entry reads back without a description already.
  if (!entry && text === '') return;
  const next = [...(entry?.[1].records ?? [])];
  const strings = next.flatMap((x, i) => (x instanceof ExtendedDataString ? [i] : []));
  if (strings.length >= 2) next[strings[1]!] = new ExtendedDataString(text);
  else {
    if (strings.length === 0) next.push(new ExtendedDataString(''));
    next.push(new ExtendedDataString(text));
  }
  l.extendedData.set(entry?.[0] ?? layerApp(doc, r, DESCRIPTION_APP), new ExtendedData(next));
}

/** Rewrites a layer's ADSK_XREC_LAYER_RECONCILED 290 from `unreconciled`. */
function writeReconciled(r: Resolver, l: Layer, a: LayerRecord): void {
  const found = l.xDictionary?.getEntry(RECONCILED);
  const record = found instanceof XRecord ? found : newRecord(r, l, RECONCILED);
  const reconciled = a.unreconciled !== true;
  const flag = record.entries.find((e) => e.code === 290);
  if (flag) flag.value = reconciled;
  else record.createEntry(290, reconciled);
}

/** The `102 {…` group name of each override record (viewport-overrides.dxf). */
const OVERRIDE_GROUPS: Record<string, string> = {
  ADSK_XREC_LAYER_COLOR_OVR: '{ADSK_LYR_COLOR_OVERRIDE',
  ADSK_XREC_LAYER_LINETYPE_OVR: '{ADSK_LYR_LINETYPE_OVERRIDE',
  ADSK_XREC_LAYER_LINEWT_OVR: '{ADSK_LYR_LINEWT_OVERRIDE',
  ADSK_XREC_LAYER_ALPHA_OVR: '{ADSK_LYR_ALPHA_OVERRIDE',
  ADSK_XREC_LAYER_PLOTSTYLE_OVR: '{ADSK_LYR_PLOTSTYLE_OVERRIDE',
};

/**
 * An AcCmEntityColor as one signed 32-bit group (420): 0xC3 and the ACI, or 0xC2 and the RGB
 * (`rawColor` in map/tables.ts reads it).
 */
const rawColor = (c: Color): number =>
  c.kind === 'aci'
    ? 0xc3000000 | c.index | 0
    : c.kind === 'rgb'
      ? 0xc2000000 | (c.r << 16) | (c.g << 8) | c.b | 0
      : 0;

/** One override's value for the record holding `field`, as AutoCAD files it. */
function overrideValue(r: Resolver, o: LayerViewportOverride, field: string): unknown {
  if (field === 'color') return o.color && rawColor(o.color);
  if (field === 'linetype') return o.linetype && resolve(r, o.linetype, LineType);
  if (field === 'lineweight')
    return o.lineweight === undefined ? undefined : acadLineweight(o.lineweight);
  if (field === 'plotStyle')
    return (
      o.plotStyle && (resolve(r, o.plotStyle, AcdbPlaceHolder) ?? Number.parseInt(o.plotStyle, 16))
    );
  const t = o.transparency;
  return typeof t === 'object' ? BY_ALPHA | t.alpha : undefined;
}

/** The overrides of `l` holding `field`, compared between before and after. */
const holding = (l: LayerRecord | undefined, field: string) =>
  JSON.stringify(
    (l?.viewportOverrides ?? []).flatMap((o) => {
      const v = (o as unknown as Record<string, unknown>)[field];
      return v === undefined ? [] : [[o.viewport, v]];
    }),
  );

/** Rewrites the override XRECORDs whose property changed between `b` and `a`. */
function writeOverrides(r: Resolver, l: Layer, b: LayerRecord | undefined, a: LayerRecord): void {
  for (const [name, code, field] of OVERRIDES) {
    if (holding(b, field) === holding(a, field)) continue;
    const list = (a.viewportOverrides ?? []).filter(
      (o) => (o as unknown as Record<string, unknown>)[field] !== undefined,
    );
    const dict = l.xDictionary;
    const found = dict?.getEntry(name);
    if (list.length === 0) {
      if (found) dict!.remove(name);
      continue;
    }
    const record = found instanceof XRecord ? found : newRecord(r, l, name);
    record.clear();
    for (const o of list) {
      record.createEntry(102, OVERRIDE_GROUPS[name]);
      const vp = resolve(r, o.viewport, Viewport);
      record.createEntry(OVERRIDE_VIEWPORT, vp ?? Number.parseInt(o.viewport, 16));
      record.createEntry(code, overrideValue(r, o, field));
      record.createEntry(102, '}');
    }
  }
}

/** The layer's extension dictionary, made where it has none (as AutoCAD makes it). */
function extensionDictionary(r: Resolver, l: Layer): CadDictionary {
  let dict = l.xDictionary;
  if (!dict) {
    dict = new CadDictionary();
    dict.handle = r.allocate();
    dict.hardOwnerFlag = true;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
    l.xDictionary = dict;
  }
  return dict;
}

/** A new XRECORD `name` in the layer's extension dictionary (280 1, the dictionary its owner). */
function newRecord(r: Resolver, l: Layer, name: string): XRecord {
  const dict = extensionDictionary(r, l);
  const record = new XRecord();
  record.handle = r.allocate();
  record.cloningFlags = DictionaryCloningFlags.KeepExisting;
  dict.addByKey(name, record);
  record.addReactor(dict);
  return record;
}

/** Whether `model` has a VIEWPORT entity of handle `h`. */
function isViewport(model: DocumentModel, h: Handle): boolean {
  const id = model.ids.idOf(h);
  return id !== undefined && model.entity(id)?.geom.kind === 'VIEWPORT';
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeLayer(
  doc: CadDocument,
  r: Resolver,
  l: Layer,
  b: LayerRecord | undefined,
  a: LayerRecord,
): void {
  const changed = changes(b, a);
  if (b && changed('name')) l.name = a.name;
  if (changed('flags', 'frozen', 'locked')) {
    const others = (a.flags ?? 0) & ~(FROZEN | LOCKED);
    l.flags = (others | (a.frozen ? FROZEN : 0) | (a.locked ? LOCKED : 0)) as never;
  }
  if (changed('color')) {
    l.color = acadColor(a.color);
    // A colour-book colour is named by the layer's own 430, with no DBCOLOR (M2-35 part 19).
    const c = a.color;
    l.trueColorName =
      c.kind === 'rgb' && c.bookName !== undefined ? `${c.bookName}$${c.colorName ?? ''}` : null;
  }
  if (changed('on')) l.isOn = a.on;
  if (changed('linetype')) l.lineType = resolve(r, a.linetype, LineType)!;
  if (changed('lineweight')) l.lineWeight = acadLineweight(a.lineweight);
  if (changed('plot')) l.plotFlag = a.plot;
  if (changed('plotStyle')) l.plotStyleName = a.plotStyle ? Number.parseInt(a.plotStyle, 16) : 0;
  if (changed('material')) l.material = a.material ? resolve(r, a.material, Material)! : null;
  if (changed('transparency')) writeTransparency(doc, r, l, a);
  if ((a.description ?? '') !== (b?.description ?? '')) writeDescription(doc, r, l, a);
  if ((a.unreconciled ?? false) !== (b?.unreconciled ?? false)) writeReconciled(r, l, a);
}

/** Writes the planned layer changes onto `doc`; new layers join its LAYER table first. */
export function writeLayers(doc: CadDocument, r: Resolver, plan: LayerPlan): void {
  for (const { acad, after } of plan.added) {
    // acad-ts keeps a non-zero handle it has not seen, so the layer keeps Triya's handle.
    doc.layers!.add(acad);
    writeLayer(doc, r, acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeLayer(doc, r, acad, before, after);
}

/**
 * Writes the planned layers' viewport overrides, once the entities the save adds exist: an
 * override may name a viewport the same save adds (M6-02 part 18: a copied viewport's).
 */
export function writeLayerOverrides(r: Resolver, plan: LayerPlan): void {
  for (const { acad, after } of plan.added)
    if (after.viewportOverrides !== undefined) writeOverrides(r, acad, undefined, after);
  for (const { acad, before, after } of plan.updated)
    if (!same(before.viewportOverrides, after.viewportOverrides))
      writeOverrides(r, acad, before, after);
}
