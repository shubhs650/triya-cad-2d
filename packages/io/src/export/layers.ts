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

import {
  ACadVersion,
  AppId,
  ExtendedData,
  ExtendedDataInteger32,
  Layer,
  LineType,
  Material,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, LayerRecord } from '@triya/engine';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

/** DXF 70 bits `frozen` and `locked` stand for; `flags` keeps the others. */
const FROZEN = 1;
const LOCKED = 4;

/** What an R12 LAYER has no group for (it states 2, 70, 62 and 6 only). */
const NOT_IN_R12 = ['lineweight', 'plot', 'plotStyle', 'material', 'transparency'] as const;

/** The application AutoCAD files a layer's transparency under. */
const TRANSPARENCY_APP = 'AcCmTransparency';
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
  return planRecords(doc, base.tables?.layers ?? [], model.tables.layers, r, {
    what: 'layer',
    type: Layer,
    make: (a) => new Layer(a.name),
    // AutoCAD: "The name of layer 0 cannot be changed"; an xref's layers are renamed in it.
    fixedNames: [Layer.defaultName],
    problems: (b, a) => layerProblems(r, doc.header?.version, b, a),
  });
}

function layerProblems(
  r: Resolver,
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
  if (changed('color') && (a.color.kind === 'byLayer' || a.color.kind === 'byBlock'))
    out.push(`a layer colour cannot be ${a.color.kind}`);
  if (changed('color') && a.color.kind === 'rgb' && a.color.bookName !== undefined)
    out.push('colour-book colours');
  if (changed('linetype') && !resolve(r, a.linetype, LineType))
    out.push(`linetype ${a.linetype} does not exist`);
  if (changed('lineweight') && (a.lineweight === 'ByLayer' || a.lineweight === 'ByBlock'))
    out.push(`a layer lineweight cannot be ${a.lineweight}`);
  if (changed('material') && a.material && !resolve(r, a.material, Material))
    out.push(`material ${a.material} does not exist`);
  if (changed('plotStyle') && a.plotStyle && !r.store.original(a.plotStyle))
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

/**
 * The AcCmTransparency application: the drawing's own (names are matched without regard to
 * case: sample_AC1009 has ACCMTRANSPARENCY), one the same save adds, or one registered now
 * under a handle above every handle the engine handed out.
 */
function transparencyApp(doc: CadDocument, r: Resolver) {
  const named = (o: unknown): o is AppId =>
    o instanceof AppId && o.name.toUpperCase() === TRANSPARENCY_APP.toUpperCase();
  const own = [...doc.appIds!].find(named) ?? [...r.created.values()].find(named);
  if (own) return own;
  const app = new AppId(TRANSPARENCY_APP);
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
  l.extendedData.set(entry?.[0] ?? transparencyApp(doc, r), new ExtendedData(next));
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
  if (changed('color')) l.color = acadColor(a.color);
  if (changed('on')) l.isOn = a.on;
  if (changed('linetype')) l.lineType = resolve(r, a.linetype, LineType)!;
  if (changed('lineweight')) l.lineWeight = acadLineweight(a.lineweight);
  if (changed('plot')) l.plotFlag = a.plot;
  if (changed('plotStyle')) l.plotStyleName = a.plotStyle ? Number.parseInt(a.plotStyle, 16) : 0;
  if (changed('material')) l.material = a.material ? resolve(r, a.material, Material)! : null;
  if (changed('transparency')) writeTransparency(doc, r, l, a);
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
