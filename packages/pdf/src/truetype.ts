// TrueType font files (the OpenType spec's 'sfnt' container with 'glyf' outlines) for PDF
// embedding (M2-16 part 3): read what a PDF font dictionary needs (metrics, names, the
// embedding permissions) and write a subset holding only the glyphs a plot shows, renumbered
// from 0, as a PDF FontFile2 (PDF 32000-1:2008 §9.9). Composite glyphs bring their components.
// CFF-flavoured OpenType ('OTTO') is `cff.ts`'s; the container and metrics are `sfnt.ts`'s.
// No DOM here: this package runs in Node and in workers.

import {
  SFNT_APPLE,
  SFNT_TRUETYPE,
  SfntFont,
  cmapTable,
  pad4,
  postFormat3,
  readSfnt,
  view,
  writeSfnt,
} from './sfnt';

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

export class TrueTypeFont extends SfntFont {
  readonly #loca: number[];

  private constructor(tables: Map<string, Uint8Array>) {
    super(tables);
    const longLoca = view(tables.get('head')!).getInt16(50) === 1;
    const loca = view(tables.get('loca')!);
    this.#loca = [];
    for (let i = 0; i <= this.numGlyphs; i++) {
      const at = longLoca ? 4 * i : 2 * i;
      if (at + (longLoca ? 4 : 2) > loca.byteLength) throw new Error('truncated loca');
      this.#loca.push(longLoca ? loca.getUint32(at) : loca.getUint16(at) * 2);
    }
  }

  /** A TrueType ('glyf') font file, or undefined for anything else (CFF, a collection). */
  static parse(bytes: Uint8Array): TrueTypeFont | undefined {
    try {
      const sfnt = readSfnt(bytes);
      if (!sfnt || (sfnt.version !== SFNT_TRUETYPE && sfnt.version !== SFNT_APPLE))
        return undefined;
      for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf'])
        if (!sfnt.tables.has(t)) return undefined;
      return new TrueTypeFont(sfnt.tables);
    } catch {
      return undefined;
    }
  }

  /** The glyph's bytes in 'glyf' (empty for a glyph without outline). */
  glyph(gid: number): Uint8Array {
    if (!(gid >= 0 && gid < this.numGlyphs)) return new Uint8Array(0);
    const glyf = this.tables.get('glyf')!;
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
   * appended. With `noSubsetting`, pass every glyph in order. `cmap` maps characters to glyphs
   * of the subset (an SVG's text selects glyphs by character); without it the cmap is empty,
   * as a PDF selects them by CID.
   */
  subset(
    gids: readonly number[],
    cmap?: ReadonlyMap<number, number>,
  ): { readonly bytes: Uint8Array; readonly order: number[] } {
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
      hv.setInt16(4 * i + 2, this.lsbs[g] ?? 0);
    });

    const head = this.tables.get('head')!.slice();
    view(head).setUint32(8, 0); // checkSumAdjustment, set by writeSfnt
    view(head).setInt16(50, 1); // long loca offsets
    const hhea = this.tables.get('hhea')!.slice();
    view(hhea).setUint16(34, order.length);
    const maxp = this.tables.get('maxp')!.slice();
    view(maxp).setUint16(4, order.length);

    const tables = new Map<string, Uint8Array>([
      ['glyf', glyf],
      ['loca', loca],
      ['hmtx', hmtx],
      ['head', head],
      ['hhea', hhea],
      ['maxp', maxp],
    ]);
    const post = this.tables.get('post');
    // Format 3: no glyph names, which would name the old numbering.
    if (post && post.length >= 32) tables.set('post', postFormat3(post));
    // OpenType requires a cmap; the PDF maps CIDs to glyphs itself, so it maps no character.
    tables.set('cmap', cmapTable(cmap ?? new Map()));
    for (const tag of KEPT) {
      const t = this.tables.get(tag);
      if (t && !tables.has(tag) && tag !== 'post') tables.set(tag, t);
    }
    return { bytes: writeSfnt(tables), order };
  }
}

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
