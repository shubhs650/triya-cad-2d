// TriyaToAcad for LAYER records (M1-75 part 6): writes an edited layer's changed fields onto
// its acad-ts record, by handle, and adds the layers the drawing gains under the engine's
// handles, the inverse of `layer()` in map/tables.ts. What a save cannot keep yet is refused
// before anything changes (removing a layer, its transparency, xdata and reactors).

import {
  ACadVersion,
  INamedCadObjectExtensions,
  Layer,
  LineType,
  Material,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, LayerRecord } from '@triya/engine';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';

/** DXF 70 bits `frozen` and `locked` stand for; `flags` keeps the others. */
const FROZEN = 1;
const LOCKED = 4;
const XREF_DEPENDENT = 16;

/** Record fields no layer writer handles yet. */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

/** What an R12 LAYER has no group for (it states 2, 70, 62 and 6 only). */
const NOT_IN_R12 = ['lineweight', 'plot', 'plotStyle', 'material'] as const;

export interface LayerPlan {
  readonly updated: {
    readonly acad: Layer;
    readonly before: LayerRecord;
    readonly after: LayerRecord;
  }[];
  /** New acad-ts layers, already holding their handle, with the record to write. */
  readonly added: { readonly acad: Layer; readonly after: LayerRecord }[];
}

/** The model's layer changes against the original's mapping, and why any cannot be written. */
export function planLayers(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, Layer> },
): { plan: LayerPlan; problems: string[] } {
  const plan: LayerPlan = { updated: [], added: [] };
  const problems: string[] = [];
  const before = new Map((base.tables?.layers ?? []).map((l) => [l.handle, l]));
  const after = model.tables.layers;
  for (const [h, b] of before) {
    if (!after.has(h)) problems.push(`layer ${b.name} (${h}): removing a layer`);
  }
  // Names are unique without regard to case, among the layers the drawing ends up with.
  const names = new Map<string, Handle[]>();
  for (const l of after.values()) {
    const key = l.name.toUpperCase();
    names.set(key, [...(names.get(key) ?? []), l.handle]);
  }
  for (const [h, a] of after) {
    const b = before.get(h);
    if (b && same(b, a)) continue;
    const what = `layer ${a.name} (${h})`;
    const out: string[] = [];
    if ((names.get(a.name.toUpperCase())?.length ?? 0) > 1)
      out.push(`another layer is named ${a.name}`);
    let acad: Layer | undefined;
    if (b) {
      acad = resolve(r, h, Layer);
      if (!acad) out.push('the original is not a layer');
      // An R12 file without layer 0 reads with one acad-ts makes up and does not write back
      // (a written one would move every other made-up handle on reopening).
      if (
        acad &&
        doc.madeUpHandles?.added.has(acad.handle) &&
        (doc.header?.version ?? ACadVersion.AC1032) <= ACadVersion.AC1009
      )
        out.push(
          'the file does not have this layer (acad-ts made it up and writes it back only as read)',
        );
    } else if (doc.getCadObject(Number.parseInt(h, 16))) {
      out.push('the handle is already used');
    } else {
      acad = new Layer(a.name);
      acad.handle = Number.parseInt(h, 16);
    }
    out.push(...layerProblems(r, doc.header?.version, b, a));
    if (out.length > 0) {
      problems.push(...out.map((p) => `${what}: ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      plan.added.push({ acad: acad!, after: a });
      r.created.set(h, acad!);
    }
  }
  return { plan, problems };
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
  for (const k of UNSUPPORTED) if (changed(k)) out.push(`${k} changes`);
  // AutoCAD stores a layer's transparency as AcCmTransparency xdata, which Triya does not write.
  if (b ? !same(b.transparency, a.transparency) : !same(a.transparency, { alpha: 255 }))
    out.push('transparency changes (its AcCmTransparency xdata)');
  if (b ? b.name !== a.name : true) {
    // AutoCAD: "The name of layer 0 cannot be changed"; an xref's layers are renamed in it.
    if (b && b.name === Layer.defaultName) out.push('layer 0 cannot be renamed');
    else if (b && ((b.flags ?? 0) & XREF_DEPENDENT) !== 0)
      out.push('an xref-dependent layer cannot be renamed');
    else if (!INamedCadObjectExtensions.isValidDxfName({ name: a.name } as never, version))
      out.push(`${JSON.stringify(a.name)} is not a valid layer name`);
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
            : a[k] !== undefined;
      if (lost) out.push(`an R12 layer does not store its ${k}`);
    }
  }
  return out;
}

/** Writes the fields of `a` that differ from `b` (every field when `b` is undefined). */
function writeLayer(r: Resolver, l: Layer, b: LayerRecord | undefined, a: LayerRecord): void {
  const changed = (...keys: (keyof LayerRecord)[]): boolean =>
    !b || keys.some((k) => !same(b[k], a[k]));
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
