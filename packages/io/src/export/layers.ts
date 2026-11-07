// TriyaToAcad for LAYER records (M1-75 part 6): writes an edited layer's changed fields onto
// its acad-ts record, by handle, and adds the layers the drawing gains under the engine's
// handles, the inverse of `layer()` in map/tables.ts. What a save cannot keep yet is refused
// before anything changes (removing a layer, its transparency, xdata and reactors); the
// checks every table shares are in records.ts.

import {
  ACadVersion,
  Layer,
  LineType,
  Material,
  type CadDocument,
  type TableEntry,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, LayerRecord } from '@triya/engine';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

/** DXF 70 bits `frozen` and `locked` stand for; `flags` keeps the others. */
const FROZEN = 1;
const LOCKED = 4;

/** What an R12 LAYER has no group for (it states 2, 70, 62 and 6 only). */
const NOT_IN_R12 = ['lineweight', 'plot', 'plotStyle', 'material'] as const;

export type LayerPlan = RecordPlan<Layer, LayerRecord>;

/** The model's layer changes against the original's mapping, and why any cannot be written. */
export function planLayers(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, TableEntry> },
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
  // AutoCAD stores a layer's transparency as AcCmTransparency xdata, which Triya does not write.
  if (b ? !same(b.transparency, a.transparency) : !same(a.transparency, { alpha: 255 }))
    out.push('transparency changes (its AcCmTransparency xdata)');
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
            : a[k] !== undefined;
      if (lost) out.push(`an R12 layer does not store its ${k}`);
    }
  }
  return out;
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeLayer(r: Resolver, l: Layer, b: LayerRecord | undefined, a: LayerRecord): void {
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
}

/** Writes the planned layer changes onto `doc`; new layers join its LAYER table first. */
export function writeLayers(doc: CadDocument, r: Resolver, plan: LayerPlan): void {
  for (const { acad, after } of plan.added) {
    // acad-ts keeps a non-zero handle it has not seen, so the layer keeps Triya's handle.
    doc.layers!.add(acad);
    writeLayer(r, acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeLayer(r, acad, before, after);
}
