// CTB and STB plot style tables (M2-15): read, write and the values they hold.
//
// The format is not published by Autodesk; it is described by ezdxf's `acadctb` add-on (MIT,
// https://ezdxf.readthedocs.io/en/stable/addons/acadctb.html) and the meaning of each field by
// AutoCAD's Plot Style Table Editor help. Nothing here comes from an Autodesk file.
//
// File: a 48-byte marker `PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec` (STBVER1 for a
// named table), three little-endian 32-bit words (an Adler-32 of the compressed stream, the size
// of the text and the size of the compressed stream), then a zlib stream of the text, which ends
// in a NUL. The text is `key=value` lines and `key{` … `}` groups; a string value opens with a
// quote that nothing closes.
//
// No DOM here: the PDF writer (packages/pdf) and the I/O worker use it in Node and workers.

import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import type { Rgb } from '../style/aci';

/** "Use object color". */
export const OBJECT_COLOR = 'object';
/** "Use object linetype": plot linetype index 31 (0–30 are the plot style linetypes). */
export const OBJECT_LINETYPE = 31;
/**
 * "Use object lineweight": index 255, past the lineweight table. ezdxf reads index 0 so, but in
 * AutoCAD index 0 is the table's first pen (0.00 mm, the thinnest line the device draws).
 */
export const OBJECT_LINEWEIGHT = 255;
/** Fill style 73, end style 4 and join style 5 are "use object". */
export const OBJECT_FILL_STYLE = 73;
export const OBJECT_END_STYLE = 4;
export const OBJECT_JOIN_STYLE = 5;

export interface PlotStyle {
  readonly name: string;
  readonly localizedName: string;
  readonly description: string;
  /** The plotted colour, or "use object color". */
  readonly color: Rgb | typeof OBJECT_COLOR;
  /** `color_policy` bit 1: Enable Dithering. */
  readonly dither: boolean;
  /** `color_policy` bit 2: Convert to Grayscale. */
  readonly grayscale: boolean;
  /** `color_policy` bit 4, which AutoCAD sets on a named table's styles; no plot meaning known. */
  readonly namedColor: boolean;
  /** Pen #, 1–32; 0 is Automatic. */
  readonly physicalPen: number;
  /** Virtual Pen #, 1–255; 0 is Automatic. */
  readonly virtualPen: number;
  /** Screening, 0 (white) to 100 (full intensity). */
  readonly screening: number;
  /** Plot linetype index 0–30, or `OBJECT_LINETYPE`. */
  readonly linetype: number;
  /** Adaptive Adjustment: scale the linetype to end on a whole pattern. */
  readonly adaptiveLinetype: boolean;
  readonly linePatternSize: number;
  /** Index into the table's lineweights, or `OBJECT_LINEWEIGHT`. */
  readonly lineweight: number;
  /** 64–72, or `OBJECT_FILL_STYLE`. */
  readonly fillStyle: number;
  /** 0–3, or `OBJECT_END_STYLE`. */
  readonly endStyle: number;
  /** 0–3, or `OBJECT_JOIN_STYLE`. */
  readonly joinStyle: number;
}

export interface PlotStyleTable {
  /** Colour-dependent (one style per ACI colour) or named. */
  readonly kind: 'ctb' | 'stb';
  readonly description: string;
  /** "Apply global scale factor to non-ISO linetypes" and the factor. */
  readonly scaleFactor: number;
  readonly applyFactor: boolean;
  /** How the editor shows lineweights; the values are millimetres either way. */
  readonly lineweightUnits: 'mm' | 'in';
  /** Millimetres. */
  readonly lineweights: readonly number[];
  /** CTB: 255 styles, ACI 1 to 255. STB: in file order, Normal first. */
  readonly styles: readonly PlotStyle[];
}

export class PlotStyleTableError extends Error {
  override readonly name = 'PlotStyleTableError';
}

/** A style that plots every object as it is (what a new table entry starts from). */
export function newPlotStyle(name: string): PlotStyle {
  return {
    name,
    localizedName: name,
    description: '',
    color: OBJECT_COLOR,
    dither: true,
    grayscale: false,
    namedColor: false,
    physicalPen: 0,
    virtualPen: 0,
    screening: 100,
    linetype: OBJECT_LINETYPE,
    adaptiveLinetype: true,
    linePatternSize: 0.5,
    lineweight: OBJECT_LINEWEIGHT,
    fillStyle: OBJECT_FILL_STYLE,
    endStyle: OBJECT_END_STYLE,
    joinStyle: OBJECT_JOIN_STYLE,
  };
}

/** The lineweight table AutoCAD fills a new table with (millimetres). */
export const DEFAULT_PLOT_LINEWEIGHTS: readonly number[] = [
  0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.53, 0.6, 0.65, 0.7,
  0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11,
];

/** Number of styles in a colour-dependent table: one per ACI colour 1–255. */
export const CTB_STYLE_COUNT = 255;

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

const MARKER = 'PIAFILEVERSION_';
const HEAD = 48;

/** Reads a .ctb or .stb file. */
export function parsePlotStyleTable(bytes: Uint8Array): PlotStyleTable {
  if (bytes.length < HEAD + 12 || strFromU8(bytes.subarray(0, MARKER.length), true) !== MARKER) {
    throw new PlotStyleTableError('not a plot style table (no PIAFILEVERSION marker)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // AutoCAD's three sizes are 32-bit words. ezdxf on 64-bit Linux packs them with the native
  // `L`, eight bytes each; its files are read too.
  let start = HEAD + 12;
  if (bytes.length >= HEAD + 24 && view.getUint32(HEAD + 8, true) + start !== bytes.length) {
    const wide = view.getUint32(HEAD + 16, true);
    if (wide + HEAD + 24 === bytes.length && view.getUint32(HEAD + 20, true) === 0) {
      start = HEAD + 24;
    }
  }
  let text: Uint8Array;
  try {
    text = unzlibSync(bytes.subarray(start));
  } catch (e) {
    throw new PlotStyleTableError(`the table's compressed text is damaged (${String(e)})`);
  }
  let end = text.length;
  while (end > 0 && text[end - 1] === 0) end--;
  return parsePlotStyleText(decode(text.subarray(0, end)));
}

/** UTF-8, falling back to Latin-1 for a table saved in a single-byte code page. */
function decode(bytes: Uint8Array): string {
  try {
    const s = strFromU8(bytes);
    if (!s.includes('�')) return s;
  } catch {
    // not UTF-8
  }
  return strFromU8(bytes, true);
}

type Group = Map<string, string | Group>;

/** Reads the text inside a .ctb or .stb file. */
export function parsePlotStyleText(text: string): PlotStyleTable {
  const root = parseGroups(text);
  const kindValue = root.get('aci_table_available');
  if (typeof kindValue !== 'string') {
    throw new PlotStyleTableError('not a plot style table (no aci_table_available)');
  }
  const kind = bool(kindValue, false) ? 'ctb' : 'stb';
  const lineweights: number[] = [];
  const lwGroup = root.get('custom_lineweight_table');
  if (lwGroup instanceof Map) {
    for (const [k, v] of lwGroup) {
      if (typeof v === 'string') lineweights[int(k, 0)] = num(v, 0);
    }
  }
  const raw = root.get('plot_style');
  const entries: [number, Group][] = [];
  if (raw instanceof Map) {
    for (const [k, v] of raw) if (v instanceof Map) entries.push([int(k, entries.length), v]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  let styles: PlotStyle[];
  if (kind === 'ctb') {
    styles = Array.from({ length: CTB_STYLE_COUNT }, (_, i) => newPlotStyle(`Color_${i + 1}`));
    for (const [i, g] of entries) {
      if (i >= 0 && i < CTB_STYLE_COUNT) styles[i] = readStyle(g, `Color_${i + 1}`);
    }
  } else {
    styles = entries.map(([i, g]) => readStyle(g, `Style ${i}`));
  }
  return {
    kind,
    description: str(root.get('description')),
    scaleFactor: num(root.get('scale_factor'), 1),
    applyFactor: bool(root.get('apply_factor'), false),
    lineweightUnits: int(root.get('custom_lineweight_display_units'), 0) === 1 ? 'in' : 'mm',
    lineweights: Array.from(lineweights, (w) => w ?? 0),
    styles,
  };
}

function parseGroups(text: string): Group {
  const root: Group = new Map();
  const stack: Group[] = [root];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const top = stack[stack.length - 1]!;
    if (line === '}') {
      if (stack.length === 1) throw new PlotStyleTableError('a "}" closes no group');
      stack.pop();
    } else if (line.endsWith('{') && !line.includes('=')) {
      const group: Group = new Map();
      top.set(line.slice(0, -1).trim(), group);
      stack.push(group);
    } else {
      const eq = line.indexOf('=');
      if (eq < 0) throw new PlotStyleTableError(`not a plot style table line: ${line}`);
      top.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
  }
  if (stack.length > 1) throw new PlotStyleTableError('the table ends inside an unclosed group');
  return root;
}

function readStyle(g: Group, fallbackName: string): PlotStyle {
  const name = str(g.get('name')) || fallbackName;
  const policy = int(g.get('color_policy'), 1);
  return {
    name,
    localizedName: str(g.get('localized_name')) || name,
    description: str(g.get('description')),
    color: readColor(g),
    dither: (policy & 1) !== 0,
    grayscale: (policy & 2) !== 0,
    namedColor: (policy & 4) !== 0,
    physicalPen: int(g.get('physical_pen_number'), 0),
    virtualPen: int(g.get('virtual_pen_number'), 0),
    screening: int(g.get('screen'), 100),
    linetype: int(g.get('linetype'), OBJECT_LINETYPE),
    adaptiveLinetype: bool(g.get('adaptive_linetype'), true),
    linePatternSize: num(g.get('linepattern_size'), 0.5),
    lineweight: int(g.get('lineweight'), OBJECT_LINEWEIGHT),
    fillStyle: int(g.get('fill_style'), OBJECT_FILL_STYLE),
    endStyle: int(g.get('end_style'), OBJECT_END_STYLE),
    joinStyle: int(g.get('join_style'), OBJECT_JOIN_STYLE),
  };
}

/** Colour words: type byte, then R, G, B. -1 and 0xC3FFFFFF are "use object color". */
const OBJECT_WORDS = new Set([-1, 0xc3ffffff | 0]);

function readColor(g: Group): PlotStyle['color'] {
  const color = int(g.get('color'), -1);
  if (OBJECT_WORDS.has(color | 0)) return OBJECT_COLOR;
  // `mode_color` holds the colour AutoCAD shows; `color` may hold an ACI word for a custom
  // colour, which AutoCAD corrects itself (ezdxf's notes).
  const mode = g.get('mode_color');
  const word = (typeof mode === 'string' ? int(mode, color) : color) >>> 0;
  return [(word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff];
}

/** A string value: the opening quote dropped, and a closing one if a writer added it. */
function str(v: string | Group | undefined): string {
  if (typeof v !== 'string') return '';
  if (!v.startsWith('"')) return v;
  return v.length > 1 && v.endsWith('"') ? v.slice(1, -1) : v.slice(1);
}

/** A number, ignoring the bracketed bytes some files carry after it (ezdxf issue 1069). */
function num(v: string | Group | undefined, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number(v.split(' ')[0]);
  return Number.isFinite(n) ? n : fallback;
}

function int(v: string | Group | undefined, fallback: number): number {
  const n = num(v, fallback);
  return Number.isInteger(n) ? n : fallback;
}

function bool(v: string | Group | undefined, fallback: boolean): boolean {
  if (typeof v !== 'string') return fallback;
  const s = v.toUpperCase();
  return s === 'TRUE' ? true : s === 'FALSE' ? false : fallback;
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

/** Writes a .ctb or .stb file AutoCAD's Plot Style Table Editor opens. */
export function writePlotStyleTable(table: PlotStyleTable): Uint8Array {
  const text = strToU8(`${plotStyleText(table)}\0`);
  const packed = zlibSync(text, { level: 9 });
  const marker = table.kind === 'ctb' ? 'CTBVER1' : 'STBVER1';
  const out = new Uint8Array(HEAD + 12 + packed.length);
  out.set(strToU8(`PIAFILEVERSION_2.0,${marker},compress\r\npmzlibcodec`), 0);
  const view = new DataView(out.buffer);
  view.setUint32(HEAD, adler32(packed), true);
  view.setUint32(HEAD + 4, text.length, true);
  view.setUint32(HEAD + 8, packed.length, true);
  out.set(packed, HEAD + 12);
  return out;
}

/** The text of a .ctb or .stb file, laid out as AutoCAD writes it. */
export function plotStyleText(table: PlotStyleTable): string {
  const lines = [
    `description="${table.description}`,
    `aci_table_available=${table.kind === 'ctb' ? 'TRUE' : 'FALSE'}`,
    `scale_factor=${decimal(table.scaleFactor)}`,
    `apply_factor=${table.applyFactor ? 'TRUE' : 'FALSE'}`,
    `custom_lineweight_display_units=${table.lineweightUnits === 'in' ? 1 : 0}`,
  ];
  if (table.kind === 'ctb') {
    lines.push('aci_table{');
    table.styles.forEach((s, i) => lines.push(` ${i}="${s.name}`));
    lines.push('}');
  }
  lines.push('plot_style{');
  table.styles.forEach((s, i) => {
    const color = colorWord(s.color);
    const policy = (s.dither ? 1 : 0) | (s.grayscale ? 2 : 0) | (s.namedColor ? 4 : 0);
    lines.push(
      ` ${i}{`,
      `  name="${s.name}`,
      `  localized_name="${s.localizedName}`,
      `  description="${s.description}`,
      `  color=${color}`,
      `  mode_color=${color}`,
      `  color_policy=${policy}`,
      `  physical_pen_number=${s.physicalPen}`,
      `  virtual_pen_number=${s.virtualPen}`,
      `  screen=${s.screening}`,
      `  linepattern_size=${decimal(s.linePatternSize)}`,
      `  linetype=${s.linetype}`,
      `  adaptive_linetype=${s.adaptiveLinetype ? 'TRUE' : 'FALSE'}`,
      `  lineweight=${s.lineweight}`,
      `  fill_style=${s.fillStyle}`,
      `  end_style=${s.endStyle}`,
      `  join_style=${s.joinStyle}`,
      ' }',
    );
  });
  lines.push('}', 'custom_lineweight_table{');
  table.lineweights.forEach((w, i) => lines.push(` ${i}=${w.toFixed(2)}`));
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** AutoCAD's object word for "use object color", or 0xC2 (RGB) then R, G, B, as a signed int. */
function colorWord(c: PlotStyle['color']): number {
  if (c === OBJECT_COLOR) return 0xc3ffffff | 0;
  const [r, g, b] = c;
  return (0xc2 << 24) | (r << 16) | (g << 8) | b | 0;
}

/** A number with at least one decimal, as AutoCAD writes `1.0` and `0.5`. */
function decimal(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length;) {
    // 5552 bytes keep the sums inside 2^32 before the modulo (zlib's NMAX).
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
