// AcadToTriya for symbol tables and the style dictionaries (M1-03, ARCHITECTURE.md §6.1).
//
// Each acad-ts table entry becomes one frozen-ready Triya record keyed by its handle, with the
// fields the renderer and commands read. What a record does not model stays in the retained
// acad-ts original (the record's `raw` link), so nothing here can lose data on save.

import {
  AcdbPlaceHolder,
  CadDictionary,
  Material,
  MLineStyle,
  MultiLeaderStyle,
  TableStyle,
  VisualStyle,
  XRecord,
  type BlockRecord,
  type CadDocument,
  type CadObject,
  type Layer,
  type LineType,
  type TextStyle,
  type UCS,
  type View,
  type VPort,
} from '@node-projects/acad-ts';
import type {
  BlockTableRecord,
  Color,
  LayerRecord,
  LayerViewportOverride,
  LinetypeRecord,
  SymbolTableRecord,
  TableName,
  TableRecords,
  TextStyleRecord,
  Transparency,
  UcsFrame,
  UcsRecord,
  ViewParams,
  ViewRecord,
  VportRecord,
} from '@triya/engine';
import { common, hex, mapColor, mapLineweight, ref, vec2, vec3 } from './common';
import { dimStyle } from './dimvars';
import { mleaderStyle, mlineStyle, tableStyle } from './styles';

export type MappedTables = { [K in TableName]: TableRecords[K][] };

/** `ObjectCommon` plus name and DXF 70 flags. */
function base(
  e: CadObject & { readonly name: string; readonly flags?: number },
): SymbolTableRecord {
  return { ...common(e), name: e.name, ...(e.flags ? { flags: e.flags } : {}) };
}

/**
 * A layer's transparency is not a DXF group: AutoCAD writes it as `AcCmTransparency` xdata
 * (1071 = 0x02000000 | alpha). Without it the layer is opaque.
 */
function layerTransparency(l: Layer): Transparency {
  for (const [app, data] of l.extendedData) {
    if (app.name.toUpperCase() !== 'ACCMTRANSPARENCY') continue;
    const v = data.records.find((r) => (r.code as number) === 1071)?.rawValue;
    if (typeof v === 'number' && (v & 0x02000000) !== 0) return { alpha: v & 0xff };
  }
  return { alpha: 255 };
}

/**
 * The Description of the Layer Properties Manager (M1-104): AutoCAD files it as
 * `AcAecLayerStandard` xdata, an empty 1000 string and then the text (every ACadSharp sample's
 * Layer_desc; AecObjects.dwg's layer 0 holds the first string only). Names match without regard
 * to case (sample_AC1014.dwg has ACAECLAYERSTANDARD).
 */
function layerDescription(l: Layer): string | undefined {
  for (const [app, data] of l.extendedData) {
    if (app.name.toUpperCase() !== 'ACAECLAYERSTANDARD') continue;
    const strings = data.records.filter((r) => (r.code as number) === 1000);
    const v = strings[1]?.rawValue;
    return typeof v === 'string' && v !== '' ? v : undefined;
  }
  return undefined;
}

/**
 * Viewport layer overrides (M1-62): AutoCAD files each property in an XRECORD of the layer's
 * extension dictionary, one `102 {ADSK_LYR_…_OVERRIDE` group per viewport holding the
 * viewport (335) and the value. Names and codes as AutoCAD writes them and ezdxf reads them
 * (`ezdxf.entities.layer.load_layer_overrides`); the transparency key is `_ALPHA_OVR`.
 */
const OVERRIDES = [
  ['ADSK_XREC_LAYER_COLOR_OVR', 420, 'color'],
  ['ADSK_XREC_LAYER_LINETYPE_OVR', 343, 'linetype'],
  ['ADSK_XREC_LAYER_LINEWT_OVR', 91, 'lineweight'],
  ['ADSK_XREC_LAYER_ALPHA_OVR', 440, 'transparency'],
] as const;
/** The viewport's group in each override. */
const OVERRIDE_VIEWPORT = 335;

/** A pointer group's value: acad-ts keeps a number from DXF, an object once resolved. */
function pointer(v: unknown): string | undefined {
  if (typeof v === 'number' || typeof v === 'bigint') return v ? hex(v) : undefined;
  if (typeof v === 'object' && v !== null && 'handle' in v) return pointer(v.handle);
  return undefined;
}

/**
 * An AcCmEntityColor as one 32-bit group (420 here): the method in the high byte, 0xC3 an ACI
 * in the low byte, 0xC2 a true colour. ByLayer (0xC0) and ByBlock (0xC1) override nothing.
 */
function rawColor(v: number): Color | undefined {
  const method = (v >>> 24) & 0xff;
  if (method === 0xc3) return { kind: 'aci', index: v & 0xff };
  if (method === 0xc2) return { kind: 'rgb', r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  return undefined;
}

function viewportOverrides(l: Layer): LayerViewportOverride[] | undefined {
  const xdict = l.xDictionary;
  if (!xdict) return undefined;
  const byViewport = new Map<string, Record<string, unknown>>();
  for (const [name, code, field] of OVERRIDES) {
    const x = xdict.getEntry(name);
    if (!(x instanceof XRecord)) continue;
    let viewport: string | undefined;
    for (const e of x.entries) {
      if (e.code === 102) viewport = undefined;
      else if (e.code === OVERRIDE_VIEWPORT) viewport = pointer(e.value);
      else if (e.code === code && viewport !== undefined) {
        const value =
          field === 'color'
            ? rawColor(Number(e.value))
            : field === 'linetype'
              ? pointer(e.value)
              : field === 'lineweight'
                ? mapLineweight(Number(e.value))
                : (Number(e.value) & 0x02000000) !== 0
                  ? { alpha: Number(e.value) & 0xff }
                  : undefined;
        if (value === undefined) continue;
        const o = byViewport.get(viewport) ?? { viewport };
        o[field] = value;
        byViewport.set(viewport, o);
      }
    }
  }
  return byViewport.size > 0
    ? ([...byViewport.values()] as unknown as LayerViewportOverride[])
    : undefined;
}

/**
 * A layer's colour, a colour-book colour with its book and name: AutoCAD names it by the layer's
 * own 430, `BOOK$COLOR`, with no DBCOLOR (acadsharp's Layer_color_book; M2-35 part 19). A name
 * without a `$` names no book, so the colour is its RGB.
 */
function layerColor(l: Layer): Color {
  const c = mapColor(l.color);
  const name = l.trueColorName;
  const at = name?.indexOf('$') ?? -1;
  if (c.kind !== 'rgb' || !name || at < 0) return c;
  return { ...c, bookName: name.slice(0, at), colorName: name.slice(at + 1) };
}

function layer(l: Layer): LayerRecord {
  const flags = l.flags as number;
  const plotStyle = l.plotStyleName ? hex(l.plotStyleName) : undefined;
  const material = ref(l.material);
  const description = layerDescription(l);
  const overrides = viewportOverrides(l);
  return {
    ...base(l),
    color: layerColor(l),
    linetype: hex(l.lineType.handle),
    lineweight: mapLineweight(l.lineWeight),
    transparency: layerTransparency(l),
    // acad-ts reports DEFPOINTS as never plotting, which is what AutoCAD does whatever 290 says.
    plot: l.plotFlag,
    on: l.isOn,
    frozen: (flags & 1) !== 0,
    locked: (flags & 4) !== 0,
    ...(plotStyle ? { plotStyle } : {}),
    ...(material ? { material } : {}),
    ...(description ? { description } : {}),
    ...(overrides ? { viewportOverrides: overrides } : {}),
  };
}

function linetype(t: LineType): LinetypeRecord {
  return {
    ...base(t),
    description: t.description ?? '',
    // acad-ts keeps DXF 72 as read, the character code as text ("65"); DWG gives the letter.
    alignment: /^\d+$/.test(t.alignment) ? String.fromCharCode(Number(t.alignment)) : t.alignment,
    patternLength: t.patternLength,
    elements: t.segments.map((s) => {
      const style = ref(s.style);
      return {
        length: s.length,
        shapeFlags: s.shapeFlags as number,
        shapeNumber: s.shapeNumber,
        ...(style ? { style } : {}),
        offset: vec2(s.offset),
        rotation: s.rotation,
        scale: s.scale,
        ...(s.text ? { text: s.text } : {}),
      };
    }),
  };
}

function textStyle(s: TextStyle): TextStyleRecord {
  return {
    ...base(s),
    font: s.filename,
    ...(s.bigFontFilename ? { bigFont: s.bigFontFilename } : {}),
    height: s.height,
    widthFactor: s.width,
    obliqueAngle: s.obliqueAngle,
    lastHeight: s.lastHeight,
    generation: s.mirrorFlag as number,
    trueTypeFlags: s.trueType as number,
  };
}

function blockRecord(b: BlockRecord): BlockTableRecord {
  const layout = ref(b.layout);
  return {
    // A block record's flags are the BLOCK entity's DXF 70 (anonymous, xref, …).
    ...common(b),
    name: b.name,
    ...(b.blockFlags ? { flags: b.blockFlags as number } : {}),
    ...(layout ? { layout } : {}),
    units: b.units as number,
    explodable: b.isExplodable,
    scalable: b.canScale,
  };
}

function ucsFrame(u: {
  origin: { x: number; y: number; z: number };
  xAxis: { x: number; y: number; z: number };
  yAxis: { x: number; y: number; z: number };
  elevation: number;
  orthographicType: number;
}): UcsFrame {
  return {
    origin: vec3(u.origin),
    xAxis: vec3(u.xAxis),
    yAxis: vec3(u.yAxis),
    elevation: u.elevation,
    orthographic: u.orthographicType,
  };
}

function ucs(u: UCS): UcsRecord {
  return { ...base(u), ...ucsFrame(u) };
}

function view(v: View): ViewRecord {
  const params: ViewParams = {
    center: vec2(v.center),
    height: v.height,
    direction: vec3(v.direction),
    target: vec3(v.target),
    lensLength: v.lensLength,
    frontClip: v.frontClipping,
    backClip: v.backClipping,
    twist: v.angle,
    viewMode: v.viewMode as number,
    renderMode: v.renderMode as number,
  };
  const frame = v.isUcsAssociated
    ? ucsFrame({
        origin: v.ucsOrigin,
        xAxis: v.ucsXAxis,
        yAxis: v.ucsYAxis,
        elevation: v.ucsElevation,
        orthographicType: v.ucsOrthographicType,
      })
    : undefined;
  return { ...base(v), ...params, width: v.width, ...(frame ? { ucs: frame } : {}) };
}

function vport(p: VPort): VportRecord {
  return {
    ...base(p),
    center: vec2(p.center),
    height: p.viewHeight,
    direction: vec3(p.direction),
    target: vec3(p.target),
    lensLength: p.lensLength,
    frontClip: p.frontClippingPlane,
    backClip: p.backClippingPlane,
    twist: p.twistAngle,
    viewMode: p.viewMode as number,
    renderMode: p.renderMode as number,
    lowerLeft: vec2(p.bottomLeft),
    upperRight: vec2(p.topRight),
    aspectRatio: p.aspectRatio,
    snapBase: vec2(p.snapBasePoint),
    snapSpacing: vec2(p.snapSpacing),
    snapRotation: p.snapRotation,
    snapOn: p.snapOn,
    isometricSnap: p.isometricSnap,
    isometricPlane: p.snapIsoPair,
    gridSpacing: vec2(p.gridSpacing),
    gridOn: p.showGrid,
    gridFlags: p.gridFlags as number,
    gridMajor: p.minorGridLinesPerMajorGridLine,
    circleZoom: p.circleZoomPercent,
    ucsIcon: p.ucsIconDisplay as number,
    ucs: ucsFrame(p),
  };
}

/**
 * Multileader and table styles are entries of the ACAD_MLEADERSTYLE and ACAD_TABLESTYLE
 * dictionaries. acad-ts does not fill `doc.mLeaderStyles`/`doc.tableStyles` on read, so they
 * are taken from the named-object dictionary, as AutoCAD finds them.
 */
function styleEntries<T>(
  doc: CadDocument,
  key: string,
  type: abstract new (...args: never[]) => T,
): T[] {
  const dict = doc.rootDictionary?.get(key);
  if (!(dict instanceof CadDictionary)) return [];
  return [...dict].filter((o): o is T & typeof o => o instanceof type);
}

/**
 * The entries of a named-object dictionary that PURGE takes (M1-75 part 29), by the entry name
 * AutoCAD lists them under: MLINESTYLE, MATERIAL, VISUALSTYLE and the ACDBPLACEHOLDER plot
 * style names. `map` makes the record (only the name, but for MLINE styles, M1-75 part 31). An
 * entry acad-ts did not read as its class (a visual style kept as a proxy) is left to the
 * passthrough.
 */
function namedEntries<T extends CadObject, R extends SymbolTableRecord = SymbolTableRecord>(
  doc: CadDocument,
  key: string,
  type: abstract new (...args: never[]) => T,
  map: (o: T, name: string) => R = (o, name) => ({ ...common(o), name }) as R,
): R[] {
  const dict = doc.rootDictionary?.get(key);
  if (!(dict instanceof CadDictionary)) return [];
  const names = dict.entryNames;
  return [...dict].flatMap((o, i) => (o instanceof type ? [map(o, names[i] ?? o.name)] : []));
}

const each = <T, R>(items: Iterable<T> | null | undefined, f: (t: T) => R): R[] =>
  [...(items ?? [])].map(f);

/** Every table of the document as Triya records, in acad-ts collection order. */
export function mapTables(doc: CadDocument): MappedTables {
  return {
    layers: each(doc.layers, layer),
    linetypes: each(doc.lineTypes, linetype),
    textStyles: each(doc.textStyles, textStyle),
    dimStyles: each(doc.dimensionStyles, dimStyle),
    mleaderStyles: each(
      styleEntries(doc, CadDictionary.acadMLeaderStyle, MultiLeaderStyle),
      mleaderStyle,
    ),
    tableStyles: each(styleEntries(doc, CadDictionary.acadTableStyle, TableStyle), tableStyle),
    appIds: each(doc.appIds, base),
    views: each(doc.views, view),
    ucs: each(doc.uCSs, ucs),
    vports: each(doc.vPorts, vport),
    blockRecords: each(doc.blockRecords, blockRecord),
    mlineStyles: namedEntries(doc, CadDictionary.acadMLineStyle, MLineStyle, mlineStyle),
    materials: namedEntries(doc, CadDictionary.acadMaterial, Material),
    visualStyles: namedEntries(doc, CadDictionary.acadVisualStyle, VisualStyle),
    plotStyles: namedEntries(doc, CadDictionary.acadPlotStyleName, AcdbPlaceHolder),
  };
}
