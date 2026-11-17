// Named layer states (M5-07): AutoCAD keeps each as an XRECORD in the `ACAD_LAYERSTATES`
// dictionary of the LAYER table's extension dictionary, its entry name the state's name. Its
// groups (sample_AC1032_ascii.dxf's `ACAD_VIEWS_view_custom`, AutoCAD 2018; ObjectARX
// `AcDbLayerStateManager`):
//
//   91 what restoring it sets (`LAYER_STATE_MASK`), 301 description, 290 saved in paper space,
//   302 the current layer's name; then per layer: 330 the layer (or 8 its name), 90 flags
//   (1 off, 2 frozen, 4 locked, 8 plotted, 16 New VP frozen, 32 VP frozen), 62 ACI, 370
//   lineweight, 331 the linetype (or 6 its name), 1 plot style name, 440 transparency
//   (0x02000000 | alpha, 0 opaque), and for a true colour 92 (0xC2RRGGBB) and 300 its colour book
//   (`book$name`).
//
// A `.las` file (las.ts) holds the same groups with names for 330 and 331, and 2 for 1. A record
// that is not an XRECORD is not mapped and stays as read; so does every unedited state, as a save
// writes back only the states that changed (export/layer-states.ts).
import {
  CadDictionary,
  CadObject,
  Layer,
  LineType,
  XRecord,
  type CadDocument,
} from '@node-projects/acad-ts';
import {
  aciOfTrueColor,
  LAYER_STATE_MASK,
  type Color,
  type LayerState,
  type LayerStateInit,
  type LayerStateLayer,
  type Transparency,
} from '@triya/engine';
import { common, hex, mapLineweight } from './common';

/** The LAYER table's extension dictionary entry holding the states. */
export const ACAD_LAYERSTATES = 'ACAD_LAYERSTATES';

/** DXF 90 bits of a layer's entry. */
export const LAYER_STATE_FLAGS = {
  off: 1,
  frozen: 2,
  locked: 4,
  plot: 8,
  newVpFrozen: 16,
  vpFrozen: 32,
} as const;

/** AcCmTransparency "by alpha" (the high byte), as a layer's transparency is filed. */
export const BY_ALPHA = 0x02000000;
/** AcCmColor method byte of a true colour (DXF 92 here, 420 elsewhere). */
const TRUE_COLOR = 0xc2;

export interface Group {
  readonly code: number;
  readonly value: unknown;
}

/** How a state's groups name a layer or a linetype by pointer (a DXF save) or name (a `.las`). */
export interface Names {
  /** A 330 (or 331) pointer's layer (or linetype), when the drawing has it. */
  readonly layer: (v: unknown) => { handle?: string; name: string } | undefined;
  readonly linetype: (v: unknown) => { handle?: string; name: string } | undefined;
}

/** An 8 or 6 group: a name, whatever the drawing has. */
const byName = (v: unknown): { handle?: string; name: string } | undefined =>
  text(v) === '' ? undefined : { name: text(v) };

const number = (v: unknown): number | undefined => {
  const n = typeof v === 'bigint' ? Number(v) : typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : (number(v) ?? 0) !== 0);

function transparencyOf(v: number): Transparency {
  return (v & BY_ALPHA) !== 0 ? { alpha: v & 0xff } : { alpha: 255 };
}

function colorOf(aci: number, trueColor: number | undefined, book: string | undefined): Color {
  if (trueColor !== undefined && ((trueColor >>> 24) & 0xff) === TRUE_COLOR) {
    const [bookName, colorName] = book?.includes('$') ? book.split('$', 2) : [];
    return {
      kind: 'rgb',
      r: (trueColor >> 16) & 0xff,
      g: (trueColor >> 8) & 0xff,
      b: trueColor & 0xff,
      ...(bookName ? { bookName } : {}),
      ...(colorName ? { colorName } : {}),
    };
  }
  // A negative ACI is how a LAYER record says off; the state says so in 90.
  return { kind: 'aci', index: Math.abs(aci) || 7 };
}

/** One layer's groups (`groups[0]` its 330 or 8), or undefined when it names no layer. */
function layerEntry(groups: readonly Group[], names: Names): LayerStateLayer | undefined {
  const first = groups[0];
  const who = first?.code === 8 ? byName(first.value) : names.layer(first?.value);
  if (!who) return undefined;
  let flags: number = LAYER_STATE_FLAGS.plot;
  let aci = 7;
  let trueColor: number | undefined;
  let book: string | undefined;
  let linetype: { handle?: string; name: string } | undefined;
  let lineweight = -3;
  let plotStyle = '';
  let transparency = 0;
  for (const { code, value } of groups.slice(1)) {
    if (code === 90) flags = number(value) ?? flags;
    else if (code === 62) aci = number(value) ?? aci;
    else if (code === 92) trueColor = number(value);
    else if (code === 300) book = text(value);
    else if (code === 370) lineweight = number(value) ?? lineweight;
    else if (code === 331) linetype = names.linetype(value) ?? linetype;
    else if (code === 6) linetype = byName(value) ?? linetype;
    else if (code === 1 || code === 2) plotStyle = text(value);
    else if (code === 440) transparency = number(value) ?? 0;
  }
  const color = colorOf(aci, trueColor, book);
  if (plotStyle === '') plotStyle = `Color_${color.kind === 'aci' ? color.index : Math.abs(aci)}`;
  return {
    ...(who.handle ? { layer: who.handle } : {}),
    name: who.name,
    on: (flags & LAYER_STATE_FLAGS.off) === 0,
    frozen: (flags & LAYER_STATE_FLAGS.frozen) !== 0,
    locked: (flags & LAYER_STATE_FLAGS.locked) !== 0,
    plot: (flags & LAYER_STATE_FLAGS.plot) !== 0,
    newVpFrozen: (flags & LAYER_STATE_FLAGS.newVpFrozen) !== 0,
    vpFrozen: (flags & LAYER_STATE_FLAGS.vpFrozen) !== 0,
    color,
    ...(linetype?.handle ? { linetype: linetype.handle } : {}),
    linetypeName: linetype?.name ?? 'Continuous',
    lineweight: mapLineweight(lineweight),
    plotStyle,
    transparency: transparencyOf(transparency),
  };
}

/** A state's fields from its groups (a DXF XRECORD's or a `.las` file's), named `name`. */
export function layerStateFields(
  name: string,
  groups: readonly Group[],
  names: Names,
): LayerStateInit {
  let mask: number = LAYER_STATE_MASK.all;
  let description = '';
  let paperSpace = false;
  let currentLayer = '0';
  const layers: LayerStateLayer[] = [];
  let i = 0;
  for (; i < groups.length; i++) {
    const { code, value } = groups[i]!;
    if (code === 330 || code === 8) break;
    if (code === 91) mask = number(value) ?? mask;
    else if (code === 301) description = text(value);
    else if (code === 290) paperSpace = bool(value);
    else if (code === 302) currentLayer = text(value);
  }
  while (i < groups.length) {
    let end = i + 1;
    while (end < groups.length && groups[end]!.code !== 330 && groups[end]!.code !== 8) end++;
    const e = layerEntry(groups.slice(i, end), names);
    if (e) layers.push(e);
    i = end;
  }
  return { name, description, mask, paperSpace, currentLayer, layers };
}

/** A pointer group's object: acad-ts resolves it on read, or keeps the number. */
function pointed(doc: CadDocument, v: unknown): CadObject | undefined {
  if (v instanceof CadObject) return v;
  const n = number(v);
  return n === undefined ? undefined : (doc.getCadObject(n) ?? undefined);
}

/** How a drawing's XRECORD names layers and linetypes: by pointer, or by name. */
export function drawingNames(doc: CadDocument): Names {
  const by =
    <T extends Layer | LineType>(type: new () => T) =>
    (v: unknown) => {
      const o = pointed(doc, v);
      return o instanceof type ? { handle: hex(o.handle), name: o.name } : undefined;
    };
  return { layer: by(Layer), linetype: by(LineType) };
}

/** The drawing's `ACAD_LAYERSTATES` dictionary, when it has one. */
export function layerStatesDictionary(doc: CadDocument): CadDictionary | undefined {
  const d = doc.layers?.xDictionary?.get(ACAD_LAYERSTATES);
  return d instanceof CadDictionary ? d : undefined;
}

/** The drawing's layer states. */
export function mapLayerStates(doc: CadDocument): LayerState[] {
  const dict = layerStatesDictionary(doc);
  if (!dict) return [];
  const names = drawingNames(doc);
  const out: LayerState[] = [];
  dict.entryNames.forEach((key, i) => {
    const x = [...dict][i];
    if (!(x instanceof XRecord)) return;
    out.push({
      ...common(x),
      type: 'LAYER_STATE',
      owner: hex(dict.handle),
      ...layerStateFields(key, x.entries as readonly Group[], names),
    });
  });
  return out;
}

const LINEWEIGHT: Record<string, number> = { ByLayer: -1, ByBlock: -2, Default: -3 };

/** An entry's numeric groups as a save or a `.las` file writes them: 90, 62, 370, 440, 92, 300. */
export function layerEntryValues(e: LayerStateLayer): {
  flags: number;
  aci: number;
  lineweight: number;
  transparency: number;
  trueColor?: number;
  book?: string;
} {
  const c = e.color;
  const t = e.transparency;
  return {
    flags:
      (e.on ? 0 : LAYER_STATE_FLAGS.off) |
      (e.frozen ? LAYER_STATE_FLAGS.frozen : 0) |
      (e.locked ? LAYER_STATE_FLAGS.locked : 0) |
      (e.plot ? LAYER_STATE_FLAGS.plot : 0) |
      (e.newVpFrozen ? LAYER_STATE_FLAGS.newVpFrozen : 0) |
      (e.vpFrozen ? LAYER_STATE_FLAGS.vpFrozen : 0),
    aci: c.kind === 'aci' ? c.index : c.kind === 'rgb' ? aciOfTrueColor(c.r, c.g, c.b) : 7,
    lineweight: typeof e.lineweight === 'number' ? e.lineweight : LINEWEIGHT[e.lineweight]!,
    transparency: typeof t === 'object' && t.alpha !== 255 ? BY_ALPHA | t.alpha : 0,
    ...(c.kind === 'rgb' ? { trueColor: (TRUE_COLOR << 24) | (c.r << 16) | (c.g << 8) | c.b } : {}),
    ...(c.kind === 'rgb' && c.bookName && c.colorName
      ? { book: `${c.bookName}$${c.colorName}` }
      : {}),
  };
}
