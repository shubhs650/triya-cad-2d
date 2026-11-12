// CFF-flavoured OpenType fonts ('OTTO', a 'CFF ' table of Type 2 charstrings) for PDF embedding
// (M2-16 part 4): read what a PDF font needs (the sfnt metrics, whether the CFF is CID-keyed and
// which CID each glyph has) and write a bare CFF font program holding only the glyphs a plot
// shows, as a PDF FontFile3 /CIDFontType0C (PDF 32000-1:2008 §9.9) under a CIDFontType0.
//
// Glyphs keep their numbers: an unused glyph's charstring becomes a lone `endchar`, so the
// charset, FDSelect and the CIDs the page content shows stay as the font has them (§9.7.4.2: a
// CFF without CIDFont operators selects glyphs by CID = glyph number; a CID-keyed one through
// its charset). Subroutines are kept whole, as the charstrings left call them. Every offset in
// the rewritten DICTs is written as a five-byte integer, so the layout is known before the
// offsets are. Format: Adobe Technical Note #5176 (CFF) and #5177 (Type 2 charstrings).
// No DOM here: this package runs in Node and in workers.

import { SFNT_CFF, SfntFont, cmapTable, postFormat3, readSfnt, writeSfnt } from './sfnt';

/** DICT operators (two-byte ones as 1200 + second byte). */
const OP_CHARSET = 15;
const OP_ENCODING = 16;
const OP_CHARSTRINGS = 17;
const OP_PRIVATE = 18;
const OP_SUBRS = 19;
const OP_CHARSTRING_TYPE = 1206;
const OP_SYNTHETIC_BASE = 1220;
const OP_ROS = 1230;
const OP_FD_ARRAY = 1236;
const OP_FD_SELECT = 1237;

/** A Type 2 charstring that draws nothing: what an unused glyph becomes in a subset. */
const ENDCHAR = new Uint8Array([14]);

/** The number of CFF standard strings (SIDs below this name them, Technical Note #5176 App. A). */
const STANDARD_STRINGS = 391;

interface DictEntry {
  readonly op: number;
  readonly operands: readonly number[];
  /** The entry's bytes, operands and operator, as the font wrote them. */
  readonly raw: Uint8Array;
}

/** A Private DICT and the local subroutines it points at, as stored. */
interface PrivatePart {
  readonly dict: readonly DictEntry[];
  /** The local Subrs INDEX's bytes, or undefined when it has none. */
  readonly subrs?: Uint8Array;
}

/** The pieces of a CFF a subset copies or rewrites. */
interface CffParts {
  readonly names: Uint8Array;
  readonly top: readonly DictEntry[];
  readonly strings: Uint8Array;
  readonly globalSubrs: Uint8Array;
  readonly charStrings: readonly Uint8Array[];
  /** A custom charset's bytes; undefined for a predefined one (kept as its Top DICT entry). */
  readonly charset?: Uint8Array;
  /** Non-CID: the one Private DICT. */
  readonly private?: PrivatePart;
  /** CID-keyed: each Font DICT of the FDArray with its Private DICT, and the FDSelect. */
  readonly fonts?: readonly {
    readonly dict: readonly DictEntry[];
    readonly private: PrivatePart;
  }[];
  readonly fdSelect?: Uint8Array;
}

export class CffFont extends SfntFont {
  /** The CFF has a ROS: its glyphs are named by CID through the charset. */
  readonly cidKeyed: boolean;
  /** The character collection a CID-keyed font names (ROS), else Adobe-Identity-0. */
  readonly registry: string;
  readonly ordering: string;
  readonly supplement: number;
  /** The 'CFF ' table: what a font that may not be subset embeds whole. */
  readonly program: Uint8Array;

  readonly #parts: CffParts;
  /** Glyph number → CID, for a CID-keyed font. */
  readonly #cids?: readonly number[];

  private constructor(tables: Map<string, Uint8Array>, parts: CffParts, cids?: number[]) {
    super(tables);
    this.program = tables.get('CFF ')!;
    this.#parts = parts;
    if (parts.charStrings.length !== this.numGlyphs) throw new Error('glyph counts differ');
    const ros = parts.top.find((e) => e.op === OP_ROS);
    this.cidKeyed = ros !== undefined;
    const string = (sid: number | undefined) =>
      sid !== undefined && sid >= STANDARD_STRINGS
        ? latin1(readIndex(parts.strings, 0).items[sid - STANDARD_STRINGS])
        : undefined;
    this.registry = (ros && string(ros.operands[0])) || 'Adobe';
    this.ordering = (ros && string(ros.operands[1])) || 'Identity';
    this.supplement = ros?.operands[2] ?? 0;
    if (cids) this.#cids = cids;
  }

  /** A CFF-flavoured OpenType font file, or undefined for anything else (TrueType, CFF2). */
  static parse(bytes: Uint8Array): CffFont | undefined {
    try {
      const sfnt = readSfnt(bytes);
      if (!sfnt || sfnt.version !== SFNT_CFF) return undefined;
      for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'CFF '])
        if (!sfnt.tables.has(t)) return undefined;
      const parsed = parseCff(sfnt.tables.get('CFF ')!);
      if (!parsed) return undefined;
      return new CffFont(sfnt.tables, parsed.parts, parsed.cids);
    } catch {
      return undefined;
    }
  }

  /** The CID a PDF shows glyph `gid` by: the glyph number, or the charset's CID when CID-keyed. */
  cid(gid: number): number {
    return this.#cids ? (this.#cids[gid] ?? 0) : gid;
  }

  /** The charstring of a glyph, as stored. */
  charString(gid: number): Uint8Array {
    return this.#parts.charStrings[gid] ?? new Uint8Array(0);
  }

  /**
   * A CFF font program holding the outlines of `gids` (and .notdef); every other glyph keeps
   * its number and draws nothing. With `noSubsetting`, embed `program` instead.
   */
  subset(gids: Iterable<number>): Uint8Array {
    const used = new Set<number>([0, ...gids]);
    const p = this.#parts;
    const charStrings = cffIndex(p.charStrings.map((c, g) => (used.has(g) ? c : ENDCHAR)));

    // DICTs whose offsets are written as five-byte integers have the same size whatever the
    // offsets are: lay out with zeros, then write again with the real ones.
    const at = { charset: 0, fdSelect: 0, charStrings: 0, fdArray: 0, privates: [] as number[] };
    const privates = p.fonts ? p.fonts.map((f) => f.private) : [p.private!];
    const privateDicts = privates.map(privateDict);
    const fontDicts = () =>
      (p.fonts ?? []).map((f, i) =>
        dictBytes(
          f.dict,
          [OP_PRIVATE],
          [[OP_PRIVATE, [privateDicts[i]!.length, at.privates[i] ?? 0]]],
        ),
      );
    const topDict = () => {
      const offsets: [number, number[]][] = [];
      if (p.charset) offsets.push([OP_CHARSET, [at.charset]]);
      offsets.push([OP_CHARSTRINGS, [at.charStrings]]);
      if (p.fonts) {
        offsets.push([OP_FD_ARRAY, [at.fdArray]], [OP_FD_SELECT, [at.fdSelect]]);
      } else {
        offsets.push([OP_PRIVATE, [privateDicts[0]!.length, at.privates[0] ?? 0]]);
      }
      // A custom Encoding is dropped: a CIDFontType0 selects glyphs by CID, never by code.
      const dropped = [OP_CHARSET, OP_CHARSTRINGS, OP_PRIVATE, OP_FD_ARRAY, OP_FD_SELECT];
      const keep = p.top.filter(
        (e) => !(e.op === OP_ENCODING && (e.operands[0] ?? 0) > 1) && !dropped.includes(e.op),
      );
      return dictBytes(keep, [], offsets);
    };

    const header = new Uint8Array([1, 0, 4, 4]);
    let off =
      header.length +
      p.names.length +
      cffIndex([topDict()]).length +
      p.strings.length +
      p.globalSubrs.length;
    at.charset = off;
    off += p.charset?.length ?? 0;
    at.fdSelect = off;
    off += p.fdSelect?.length ?? 0;
    at.charStrings = off;
    off += charStrings.length;
    at.fdArray = off;
    if (p.fonts) off += cffIndex(fontDicts()).length;
    privates.forEach((priv, i) => {
      at.privates[i] = off;
      off += privateDicts[i]!.length + (priv.subrs?.length ?? 0);
    });

    const pieces: Uint8Array[] = [
      header,
      p.names,
      cffIndex([topDict()]),
      p.strings,
      p.globalSubrs,
      p.charset ?? new Uint8Array(0),
      p.fdSelect ?? new Uint8Array(0),
      charStrings,
      p.fonts ? cffIndex(fontDicts()) : new Uint8Array(0),
    ];
    privates.forEach((priv, i) => {
      pieces.push(privateDicts[i]!);
      if (priv.subrs) pieces.push(priv.subrs);
    });
    const out = concat(pieces);
    if (out.length !== off) throw new Error('CFF layout mismatch');
    return out;
  }

  /**
   * A CFF-flavoured OpenType font file showing `gids` (`subset`'s program, or `program` with
   * `noSubsetting`), its glyphs keeping their numbers, with `cmap` (character → glyph) as its
   * cmap: what an SVG's text selects glyphs by. It keeps the tables a browser's font sanitiser
   * requires (head, hhea, hmtx, maxp, OS/2, name, post as format 3) and none for layout, so
   * the browser shows each character's glyph as the plot placed it.
   */
  openType(gids: Iterable<number>, cmap: ReadonlyMap<number, number>): Uint8Array {
    const tables = new Map<string, Uint8Array>([
      ['CFF ', this.noSubsetting ? this.program : this.subset(gids)],
      ['cmap', cmapTable(cmap)],
      ['post', postFormat3(this.tables.get('post'))],
    ]);
    for (const tag of ['head', 'hhea', 'hmtx', 'maxp', 'OS/2', 'name']) {
      const t = this.tables.get(tag);
      if (t) tables.set(tag, t);
    }
    return writeSfnt(tables, SFNT_CFF);
  }
}

/** A Private DICT with its Subrs offset pointing just past itself (where the subrs follow). */
function privateDict(part: PrivatePart): Uint8Array {
  const keep = part.dict.filter((e) => e.op !== OP_SUBRS);
  if (!part.subrs) return dictBytes(keep, [], []);
  let size = 0;
  for (const e of keep) size += e.raw.length;
  // The Subrs entry: a five-byte integer and the one-byte operator.
  return dictBytes(keep, [], [[OP_SUBRS, [size + 6]]]);
}

/** `entries` (less the operators in `drop`) as stored, then `offsets` as five-byte integers. */
function dictBytes(
  entries: readonly DictEntry[],
  drop: readonly number[],
  offsets: readonly (readonly [number, readonly number[]])[],
): Uint8Array {
  const pieces = entries.filter((e) => !drop.includes(e.op)).map((e) => e.raw);
  for (const [op, values] of offsets) {
    const b: number[] = [];
    for (const v of values)
      b.push(29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    b.push(...operatorBytes(op));
    pieces.push(new Uint8Array(b));
  }
  return concat(pieces);
}

const operatorBytes = (op: number) => (op >= 1200 ? [12, op - 1200] : [op]);

function parseCff(cff: Uint8Array): { parts: CffParts; cids?: number[] } | undefined {
  if (cff.length < 4 || cff[0] !== 1) return undefined;
  const names = readIndex(cff, cff[2]!);
  if (names.items.length !== 1) return undefined;
  const tops = readIndex(cff, names.end);
  const strings = readIndex(cff, tops.end);
  const globalSubrs = readIndex(cff, strings.end);
  const top = readDict(tops.items[0]!);
  const value = (dict: readonly DictEntry[], op: number) => dict.find((e) => e.op === op)?.operands;
  if ((value(top, OP_CHARSTRING_TYPE)?.[0] ?? 2) !== 2) return undefined;
  if (value(top, OP_SYNTHETIC_BASE)) return undefined;
  const csAt = value(top, OP_CHARSTRINGS)?.[0];
  if (csAt === undefined) return undefined;
  const charStrings = readIndex(cff, csAt).items;
  const n = charStrings.length;

  const privatePart = (dict: readonly DictEntry[]): PrivatePart | undefined => {
    const v = value(dict, OP_PRIVATE);
    if (!v || v.length < 2) return undefined;
    const [size, offset] = v as [number, number];
    if (offset + size > cff.length) throw new Error('Private DICT out of range');
    const pdict = readDict(cff.subarray(offset, offset + size));
    const subrsAt = value(pdict, OP_SUBRS)?.[0];
    if (subrsAt === undefined) return { dict: pdict };
    const start = offset + subrsAt;
    return { dict: pdict, subrs: cff.slice(start, readIndex(cff, start).end) };
  };

  const charsetAt = value(top, OP_CHARSET)?.[0] ?? 0;
  const charset = charsetAt > 2 ? readCharset(cff, charsetAt, n) : undefined;
  const span = (r: { start: number; end: number }) => cff.slice(r.start, r.end);
  const common = {
    names: cff.slice(cff[2]!, names.end),
    top,
    strings: cff.slice(tops.end, strings.end),
    globalSubrs: cff.slice(strings.end, globalSubrs.end),
    charStrings,
    ...(charset ? { charset: span(charset) } : {}),
  };

  if (!value(top, OP_ROS)) {
    const priv = privatePart(top);
    if (!priv) return undefined;
    return { parts: { ...common, private: priv } };
  }
  const fdArrayAt = value(top, OP_FD_ARRAY)?.[0];
  const fdSelectAt = value(top, OP_FD_SELECT)?.[0];
  if (fdArrayAt === undefined || fdSelectAt === undefined || !charset) return undefined;
  const fonts = readIndex(cff, fdArrayAt).items.map((item) => {
    const dict = readDict(item);
    const priv = privatePart(dict);
    if (!priv) throw new Error('Font DICT without a Private DICT');
    return { dict, private: priv };
  });
  return {
    parts: {
      ...common,
      fonts,
      fdSelect: cff.slice(fdSelectAt, fdSelectEnd(cff, fdSelectAt, n)),
    },
    cids: charset.ids,
  };
}

/** A custom charset's extent and, glyph by glyph, the SID or CID it gives (.notdef 0). */
function readCharset(
  cff: Uint8Array,
  start: number,
  n: number,
): { start: number; end: number; ids: number[] } {
  const ids = [0];
  const format = cff[start]!;
  let at = start + 1;
  const u16 = (i: number) => (cff[i]! << 8) | cff[i + 1]!;
  if (format === 0) {
    for (; ids.length < n; at += 2) ids.push(u16(at));
  } else if (format === 1 || format === 2) {
    while (ids.length < n) {
      const first = u16(at);
      const left = format === 1 ? cff[at + 2]! : u16(at + 2);
      at += format === 1 ? 3 : 4;
      for (let k = 0; k <= left && ids.length < n; k++) ids.push(first + k);
    }
  } else {
    throw new Error(`charset format ${format}`);
  }
  if (at > cff.length) throw new Error('charset out of range');
  return { start, end: at, ids };
}

function fdSelectEnd(cff: Uint8Array, start: number, n: number): number {
  const format = cff[start]!;
  if (format === 0) return start + 1 + n;
  if (format === 3) return start + 3 + 3 * ((cff[start + 1]! << 8) | cff[start + 2]!) + 2;
  throw new Error(`FDSelect format ${format}`);
}

/** A CFF INDEX at `start`: its items and the offset just past it. */
export function readIndex(
  b: Uint8Array,
  start: number,
): { readonly items: Uint8Array[]; readonly end: number } {
  const count = (b[start]! << 8) | b[start + 1]!;
  if (count === 0) return { items: [], end: start + 2 };
  const size = b[start + 2]!;
  if (size < 1 || size > 4) throw new Error('bad INDEX offset size');
  const offset = (i: number) => {
    let v = 0;
    for (let k = 0; k < size; k++) v = v * 256 + b[start + 3 + i * size + k]!;
    return v;
  };
  const base = start + 3 + (count + 1) * size - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const a = base + offset(i);
    const z = base + offset(i + 1);
    if (z < a || z > b.length) throw new Error('INDEX out of range');
    items.push(b.subarray(a, z));
  }
  return { items, end: base + offset(count) };
}

/** A CFF INDEX of `items`, with the smallest offset size that holds them. */
export function cffIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);
  let total = 1;
  for (const it of items) total += it.length;
  const size = total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
  const out = new Uint8Array(3 + (items.length + 1) * size + total - 1);
  out[0] = items.length >> 8;
  out[1] = items.length & 255;
  out[2] = size;
  let off = 1;
  const put = (i: number, v: number) => {
    for (let k = size - 1; k >= 0; k--) {
      out[3 + i * size + k] = v & 255;
      v = Math.floor(v / 256);
    }
  };
  let at = 3 + (items.length + 1) * size;
  items.forEach((it, i) => {
    put(i, off);
    out.set(it, at);
    at += it.length;
    off += it.length;
  });
  put(items.length, off);
  return out;
}

/** A DICT's entries, each with its operands and its bytes as stored. */
export function readDict(b: Uint8Array): DictEntry[] {
  const out: DictEntry[] = [];
  let operands: number[] = [];
  let from = 0;
  let i = 0;
  while (i < b.length) {
    const b0 = b[i]!;
    if (b0 <= 21) {
      const op = b0 === 12 ? 1200 + b[i + 1]! : b0;
      i += b0 === 12 ? 2 : 1;
      out.push({ op, operands, raw: b.subarray(from, i) });
      operands = [];
      from = i;
    } else if (b0 === 28) {
      operands.push(((b[i + 1]! << 24) | (b[i + 2]! << 16)) >> 16);
      i += 3;
    } else if (b0 === 29) {
      operands.push((b[i + 1]! << 24) | (b[i + 2]! << 16) | (b[i + 3]! << 8) | b[i + 4]!);
      i += 5;
    } else if (b0 === 30) {
      let s = '';
      for (i++; ; i++) {
        const hi = b[i]! >> 4;
        const lo = b[i]! & 15;
        if (hi === 15) break;
        s += REAL[hi];
        if (lo === 15) break;
        s += REAL[lo];
      }
      i++;
      operands.push(Number(s));
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + b[i + 1]! + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - b[i + 1]! - 108);
      i += 2;
    } else {
      throw new Error(`bad DICT byte ${b0}`);
    }
  }
  return out;
}

/** Real-number nibbles 0–14 (15 ends the number). */
const REAL = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'E', 'E-', '', '-'];

/** A DICT of `entries` (operator, operands): integers in their shortest form, others as reals. */
export function cffDict(entries: readonly (readonly [number, readonly number[]])[]): Uint8Array {
  const b: number[] = [];
  for (const [op, values] of entries) {
    for (const v of values) b.push(...dictNumber(v));
    b.push(...operatorBytes(op));
  }
  return new Uint8Array(b);
}

function dictNumber(v: number): number[] {
  if (Number.isInteger(v)) {
    if (v >= -107 && v <= 107) return [v + 139];
    if (v >= 108 && v <= 1131) return [((v - 108) >> 8) + 247, (v - 108) & 255];
    if (v >= -1131 && v <= -108) return [((-v - 108) >> 8) + 251, (-v - 108) & 255];
    if (v >= -32768 && v <= 32767) return [28, (v >> 8) & 255, v & 255];
    return [29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  }
  const s = String(v).replace('e', 'E').replace('E+', 'E');
  const nibbles: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === 'E' && s[i + 1] === '-') {
      nibbles.push(12);
      i++;
    } else nibbles.push(c === '.' ? 10 : c === 'E' ? 11 : c === '-' ? 14 : Number(c));
  }
  nibbles.push(15);
  if (nibbles.length % 2) nibbles.push(15);
  const out = [30];
  for (let i = 0; i < nibbles.length; i += 2) out.push((nibbles[i]! << 4) | nibbles[i + 1]!);
  return out;
}

function concat(pieces: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const p of pieces) size += p.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const latin1 = (b: Uint8Array | undefined) => (b ? String.fromCharCode(...b) : '');
