// The OpenType 'sfnt' container shared by TrueType ('glyf') and CFF-flavoured ('OTTO') fonts
// (M2-16 parts 3 and 4): reading the table directory, the metrics a PDF font descriptor and
// its /W widths need (head, hhea, hmtx, maxp, OS/2, post, name), the OS/2 embedding
// permissions, and writing a font file back from its tables.
// No DOM here: this package runs in Node and in workers.

/** OS/2 fsType: restricted licence embedding, no subsetting, and bitmap embedding only. */
const FS_RESTRICTED = 0x0002;
const FS_NO_SUBSETTING = 0x0100;
const FS_BITMAP_ONLY = 0x0200;

/** sfnt versions: TrueType 1.0, Apple's 'true', and CFF-flavoured OpenType 'OTTO'. */
export const SFNT_TRUETYPE = 0x00010000;
export const SFNT_APPLE = 0x74727565;
export const SFNT_CFF = 0x4f54544f;

/** The tables of a single-font sfnt file and its version, or undefined for anything else. */
export function readSfnt(
  bytes: Uint8Array,
): { readonly version: number; readonly tables: Map<string, Uint8Array> } | undefined {
  if (bytes.length < 12) return undefined;
  const v = view(bytes);
  const version = v.getUint32(0);
  if (version !== SFNT_TRUETYPE && version !== SFNT_APPLE && version !== SFNT_CFF) return undefined;
  const count = v.getUint16(4);
  if (12 + 16 * count > bytes.length) return undefined;
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = v.getUint32(at + 8);
    const length = v.getUint32(at + 12);
    if (offset + length > bytes.length) return undefined;
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return { version, tables };
}

/** What a PDF font dictionary needs of any OpenType font, read from its common tables. */
export abstract class SfntFont {
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

  protected readonly tables: Map<string, Uint8Array>;
  readonly #advances: number[];
  protected readonly lsbs: number[];

  /** Throws when a table it reads is missing or short: `parse` turns that into undefined. */
  protected constructor(tables: Map<string, Uint8Array>) {
    this.tables = tables;
    const head = view(tables.get('head')!);
    const hhea = view(tables.get('hhea')!);
    const maxp = view(tables.get('maxp')!);
    this.unitsPerEm = head.getUint16(18) || 1000;
    this.bbox = [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)];
    this.numGlyphs = maxp.getUint16(4);
    this.ascender = hhea.getInt16(4);
    this.descender = hhea.getInt16(6);

    const hmtx = view(tables.get('hmtx')!);
    const metrics = Math.max(1, Math.min(hhea.getUint16(34), this.numGlyphs));
    this.#advances = [];
    this.lsbs = [];
    for (let i = 0; i < this.numGlyphs; i++) {
      const long = Math.min(i, metrics - 1);
      this.#advances.push(4 * long + 2 <= hmtx.byteLength ? hmtx.getUint16(4 * long) : 0);
      const at = i < metrics ? 4 * i + 2 : 4 * metrics + 2 * (i - metrics);
      this.lsbs.push(at + 2 <= hmtx.byteLength ? hmtx.getInt16(at) : 0);
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

  /** Advance width of a glyph, font units. */
  advance(gid: number): number {
    return this.#advances[gid] ?? 0;
  }
}

export const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const pad4 = (n: number) => (n + 3) & ~3;

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
 * A font file of `tables` (tag → data): the table directory sorted by tag, each table 4-byte
 * aligned with its checksum, and head.checkSumAdjustment set when there is a head. `version`
 * is the sfnt version: TrueType 1.0 by default, `SFNT_CFF` ('OTTO') for CFF outlines.
 */
export function writeSfnt(
  tables: ReadonlyMap<string, Uint8Array>,
  version: number = SFNT_TRUETYPE,
): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const pow = 2 ** Math.floor(Math.log2(Math.max(1, n)));
  let size = 12 + 16 * n;
  for (const t of tags) size += pad4(tables.get(t)!.length);
  const out = new Uint8Array(size);
  const v = view(out);
  v.setUint32(0, version);
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
