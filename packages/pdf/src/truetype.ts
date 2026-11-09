// TrueType font files (the OpenType spec's 'sfnt' container with 'glyf' outlines) for PDF
// embedding (M2-16 part 3): read what a PDF font dictionary needs (metrics, names, the
// embedding permissions) and write a subset holding only the glyphs a plot shows, renumbered
// from 0, as a PDF FontFile2 (PDF 32000-1:2008 §9.9). Composite glyphs bring their components.
// CFF-flavoured OpenType ('OTTO') is not read here: such text plots as outlines.
// No DOM here: this package runs in Node and in workers.

/**
 * Tables a subset keeps: the ones §9.9 names for a CIDFontType2, the hinting programs, and OS/2
 * and name, so the file stays a whole OpenType font carrying its copyright notice.
 */
const KEPT = [
  'OS/2',
  'cvt ',
  'fpgm',
  'glyf',
  'head',
  'hhea',
  'hmtx',
  'loca',
  'maxp',
  'name',
  'post',
  'prep',
];

/** Component flags of a composite glyph (OpenType 'glyf'). */
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

/** OS/2 fsType: restricted licence embedding, and bitmap embedding only. */
const FS_RESTRICTED = 0x0002;
const FS_NO_SUBSETTING = 0x0100;
const FS_BITMAP_ONLY = 0x0200;

export class TrueTypeFont {
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  /** Font units. */
  readonly bbox: readonly [number, number, number, number];
  readonly ascender: number;
  readonly descender: number;
  /** OS/2 sCapHeight (version 2 on), else the ascender. */
  readonly capHeight: number;
  /** post.italicAngle, degrees. */
  readonly italicAngle: number;
  readonly fixedPitch: boolean;
  /** name ID 6, else the full name without spaces; may be empty. */
  readonly postScriptName: string;
  /** OS/2 fsType says the font may be embedded with its outlines. */
  readonly embeddable: boolean;
  /** OS/2 fsType forbids subsetting: the whole font is embedded. */
  readonly noSubsetting: boolean;

  readonly #tables: Map<string, Uint8Array>;
  readonly #loca: number[];
  readonly #advances: number[];
  readonly #lsbs: number[];

  private constructor(tables: Map<string, Uint8Array>) {
    this.#tables = tables;
    const head = view(tables.get('head')!);
    const hhea = view(tables.get('hhea')!);
    const maxp = view(tables.get('maxp')!);
    this.unitsPerEm = head.getUint16(18) || 1000;
    this.bbox = [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)];
    const longLoca = head.getInt16(50) === 1;
    this.numGlyphs = maxp.getUint16(4);
    this.ascender = hhea.getInt16(4);
    this.descender = hhea.getInt16(6);

    const loca = view(tables.get('loca')!);
    this.#loca = [];
    for (let i = 0; i <= this.numGlyphs; i++) {
      const at = longLoca ? 4 * i : 2 * i;
      if (at + (longLoca ? 4 : 2) > loca.byteLength) throw new Error('truncated loca');
      this.#loca.push(longLoca ? loca.getUint32(at) : loca.getUint16(at) * 2);
    }

    const hmtx = view(tables.get('hmtx')!);
    const metrics = Math.max(1, Math.min(hhea.getUint16(34), this.numGlyphs));
    this.#advances = [];
    this.#lsbs = [];
    for (let i = 0; i < this.numGlyphs; i++) {
      const long = Math.min(i, metrics - 1);
      this.#advances.push(4 * long + 2 <= hmtx.byteLength ? hmtx.getUint16(4 * long) : 0);
      const at = i < metrics ? 4 * i + 2 : 4 * metrics + 2 * (i - metrics);
      this.#lsbs.push(at + 2 <= hmtx.byteLength ? hmtx.getInt16(at) : 0);
    }

    const os2 = tables.get('OS/2');
    const o = os2 && os2.length >= 10 ? view(os2) : undefined;
    const fsType = o ? o.getUint16(8) : 0;
    this.embeddable = (fsType & 0x000f) !== FS_RESTRICTED && (fsType & FS_BITMAP_ONLY) === 0;
    this.noSubsetting = (fsType & FS_NO_SUBSETTING) !== 0;
    this.capHeight =
      o && o.getUint16(0) >= 2 && os2!.length >= 90
        ? o.getInt16(88) || this.ascender
        : this.ascender;

    const post = tables.get('post');
    const p = post && post.length >= 16 ? view(post) : undefined;
    this.italicAngle = p ? p.getInt32(4) / 65536 : 0;
    this.fixedPitch = p ? p.getUint32(12) !== 0 : false;

    const names = tables.get('name');
    this.postScriptName = names ? (nameRecord(names, 6) ?? nameRecord(names, 4) ?? '') : '';
  }

  /** A TrueType ('glyf') font file, or undefined for anything else (CFF, a collection). */
  static parse(bytes: Uint8Array): TrueTypeFont | undefined {
    try {
      const v = view(bytes);
      const version = v.getUint32(0);
      // 1.0 or Apple's 'true'.
      if (version !== 0x00010000 && version !== 0x74727565) return undefined;
      const count = v.getUint16(4);
      const tables = new Map<string, Uint8Array>();
      for (let i = 0; i < count; i++) {
        const at = 12 + 16 * i;
        const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
        const offset = v.getUint32(at + 8);
        const length = v.getUint32(at + 12);
        if (offset + length > bytes.length) return undefined;
        tables.set(tag, bytes.subarray(offset, offset + length));
      }
      for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf'])
        if (!tables.has(t)) return undefined;
      return new TrueTypeFont(tables);
    } catch {
      return undefined;
    }
  }

  /** Advance width of a glyph, font units. */
  advance(gid: number): number {
    return this.#advances[gid] ?? 0;
  }

  /** The glyph's bytes in 'glyf' (empty for a glyph without outline). */
  glyph(gid: number): Uint8Array {
    if (!(gid >= 0 && gid < this.numGlyphs)) return new Uint8Array(0);
    const glyf = this.#tables.get('glyf')!;
    const start = this.#loca[gid]!;
    const end = this.#loca[gid + 1]!;
    return end > start && end <= glyf.length ? glyf.subarray(start, end) : new Uint8Array(0);
  }

  /** The glyphs a composite glyph is built from (none for a simple glyph). */
  components(gid: number): number[] {
    const out: number[] = [];
    forEachComponent(this.glyph(gid), (_, index) => out.push(index));
    return out;
  }

  /**
   * The font file holding only `gids` (0, .notdef, first): glyph i of the subset is glyph
   * `order[i]` of this font, where `order` is `gids` with the components of composite glyphs
   * appended. With `noSubsetting`, pass every glyph in order.
   */
  subset(gids: readonly number[]): { readonly bytes: Uint8Array; readonly order: number[] } {
    const order = [...gids];
    const index = new Map(order.map((g, i) => [g, i]));
    for (let i = 0; i < order.length; i++) {
      for (const c of this.components(order[i]!)) {
        if (!index.has(c)) {
          index.set(c, order.length);
          order.push(c);
        }
      }
    }
    const pieces = order.map((g) => {
      const src = this.glyph(g);
      if (src.length === 0) return src;
      const copy = src.slice();
      const cv = view(copy);
      // Composite glyphs name their components by number: renumber them into the subset.
      forEachComponent(copy, (at, c) => cv.setUint16(at, index.get(c)!));
      return copy;
    });
    let size = 0;
    for (const p of pieces) size += pad4(p.length);
    const glyf = new Uint8Array(size);
    const loca = new Uint8Array(4 * (order.length + 1));
    const lv = view(loca);
    let at = 0;
    pieces.forEach((p, i) => {
      lv.setUint32(4 * i, at);
      glyf.set(p, at);
      at += pad4(p.length);
    });
    lv.setUint32(4 * order.length, at);

    const hmtx = new Uint8Array(4 * order.length);
    const hv = view(hmtx);
    order.forEach((g, i) => {
      hv.setUint16(4 * i, this.advance(g));
      hv.setInt16(4 * i + 2, this.#lsbs[g] ?? 0);
    });

    const head = this.#tables.get('head')!.slice();
    view(head).setUint32(8, 0); // checkSumAdjustment, set by writeSfnt
    view(head).setInt16(50, 1); // long loca offsets
    const hhea = this.#tables.get('hhea')!.slice();
    view(hhea).setUint16(34, order.length);
    const maxp = this.#tables.get('maxp')!.slice();
    view(maxp).setUint16(4, order.length);

    const tables = new Map<string, Uint8Array>([
      ['glyf', glyf],
      ['loca', loca],
      ['hmtx', hmtx],
      ['head', head],
      ['hhea', hhea],
      ['maxp', maxp],
    ]);
    const post = this.#tables.get('post');
    if (post && post.length >= 32) {
      // Format 3: no glyph names, which would name the old numbering.
      const p = post.slice(0, 32);
      view(p).setUint32(0, 0x00030000);
      tables.set('post', p);
    }
    // OpenType requires a cmap; the PDF maps CIDs to glyphs itself, so it maps no character.
    tables.set('cmap', EMPTY_CMAP);
    for (const tag of KEPT) {
      const t = this.#tables.get(tag);
      if (t && !tables.has(tag) && tag !== 'post') tables.set(tag, t);
    }
    return { bytes: writeSfnt(tables), order };
  }
}

/** A cmap of one Windows Unicode format 4 subtable holding only the closing 0xFFFF segment. */
const EMPTY_CMAP = new Uint8Array([
  0,
  0,
  0,
  1,
  0,
  3,
  0,
  1,
  0,
  0,
  0,
  12, // version, one subtable at 12
  0,
  4,
  0,
  24,
  0,
  0,
  0,
  2,
  0,
  2,
  0,
  0,
  0,
  0, // format 4, length 24, one segment
  0xff,
  0xff,
  0,
  0,
  0xff,
  0xff,
  0,
  1,
  0,
  0, // end, pad, start, delta 1, range offset
]);

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const pad4 = (n: number) => (n + 3) & ~3;

/** Calls `f` with each component's glyph-index offset and glyph index in a composite glyph. */
function forEachComponent(glyph: Uint8Array, f: (at: number, index: number) => void): void {
  if (glyph.length < 10) return;
  const v = view(glyph);
  if (v.getInt16(0) >= 0) return;
  let at = 10;
  for (;;) {
    if (at + 4 > glyph.length) return;
    const flags = v.getUint16(at);
    f(at + 2, v.getUint16(at + 2));
    at += 4 + (flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2);
    if (flags & WE_HAVE_A_SCALE) at += 2;
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) at += 4;
    else if (flags & WE_HAVE_A_TWO_BY_TWO) at += 8;
    if (!(flags & MORE_COMPONENTS)) return;
  }
}

/** A name record as a string: Windows Unicode (UTF-16BE) first, then Macintosh Roman (ASCII part). */
function nameRecord(table: Uint8Array, id: number): string | undefined {
  if (table.length < 6) return undefined;
  const v = view(table);
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  let mac: string | undefined;
  for (let i = 0; i < count; i++) {
    const at = 6 + 12 * i;
    if (at + 12 > table.length) break;
    const platform = v.getUint16(at);
    if (v.getUint16(at + 6) !== id) continue;
    const length = v.getUint16(at + 8);
    const offset = strings + v.getUint16(at + 10);
    if (offset + length > table.length) continue;
    const raw = table.subarray(offset, offset + length);
    if (platform === 3 || platform === 0) {
      let s = '';
      for (let k = 0; k + 1 < raw.length; k += 2)
        s += String.fromCharCode((raw[k]! << 8) | raw[k + 1]!);
      if (s) return s;
    } else if (platform === 1 && mac === undefined) {
      mac = String.fromCharCode(...raw.filter((c) => c < 0x80));
    }
  }
  return mac || undefined;
}

/** The sum of a table's big-endian 32-bit words, zero padded (the OpenType table checksum). */
function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) {
    const word =
      ((b[i]! << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/**
 * A TrueType font file of `tables` (tag → data): the table directory sorted by tag, each table
 * 4-byte aligned with its checksum, and head.checkSumAdjustment set when there is a head.
 */
export function writeSfnt(tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const pow = 2 ** Math.floor(Math.log2(Math.max(1, n)));
  let size = 12 + 16 * n;
  for (const t of tags) size += pad4(tables.get(t)!.length);
  const out = new Uint8Array(size);
  const v = view(out);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  v.setUint16(6, pow * 16);
  v.setUint16(8, Math.log2(pow));
  v.setUint16(10, n * 16 - pow * 16);
  let at = 12 + 16 * n;
  let headAt = -1;
  tags.forEach((tag, i) => {
    const data = tables.get(tag)!;
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[e + k] = tag.charCodeAt(k);
    if (tag === 'head') {
      headAt = at;
      out.set(data, at);
      if (data.length >= 12) v.setUint32(at + 8, 0);
      v.setUint32(e + 4, checksum(out.subarray(at, at + data.length)));
    } else {
      out.set(data, at);
      v.setUint32(e + 4, checksum(data));
    }
    v.setUint32(e + 8, at);
    v.setUint32(e + 12, data.length);
    at += pad4(data.length);
  });
  if (headAt >= 0 && tables.get('head')!.length >= 12)
    v.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
