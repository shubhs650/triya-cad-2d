// Text in a plot (M2-16 parts 3 and 4): each OpenType font a plot's text uses is embedded once
// per document as a subset of the glyphs shown, as PDF 32000-1:2008 §9.7 builds a composite
// font: a Type 0 font with the Identity-H encoding (two-byte codes, code = CID) over a
// descendant CIDFont, its widths in /W, and a ToUnicode CMap (§9.10.3) so the text stays
// searchable and copies as the characters typed.
// - TrueType ('glyf') fonts: a CIDFontType2 whose CIDs are the subset's glyph numbers
//   (CIDToGIDMap Identity), handed out as glyphs are first shown, so a page's content can be
//   written before the subset is known; the file is a FontFile2.
// - CFF-flavoured OpenType ('OTTO'): a CIDFontType0 over a bare CFF program (FontFile3
//   /CIDFontType0C) in which glyphs keep their numbers (`cff.ts`), so a CID is the glyph number,
//   or the font's own CID when the CFF is CID-keyed, and /W lists only the CIDs shown.
// A font whose OS/2 fsType forbids embedding outlines, or any other kind of file, is not
// embedded: its text plots as outlines (AutoCAD's PDF export also turns such fonts into
// geometry). No DOM here.

import { CffFont } from './cff';
import { pdfNumber } from './content';
import { TrueTypeFont } from './truetype';

/** What a plot needs of a font: its file. `TtfFont` from the text package carries it. */
export interface PlotFont {
  /** The .ttf/.otf file the font was read from. */
  readonly bytes?: Uint8Array;
}

/** An OpenType font embedded in a document, named `F<n>` in page resources. */
export class EmbeddedFont {
  /**
   * The glyphs shown, .notdef first. TrueType: subset glyph (= CID) → glyph of the font. CFF:
   * in the order first shown (the CID is `font.cid` of the glyph).
   */
  readonly glyphs: number[] = [0];
  /** CID → the character it was first shown for. */
  readonly unicode = new Map<number, number>();
  /** Glyph of the font → CID, and back. */
  readonly #cids = new Map<number, number>([[0, 0]]);
  readonly #gids = new Map<number, number>([[0, 0]]);

  constructor(
    readonly name: string,
    readonly font: TrueTypeFont | CffFont,
  ) {
    // A TrueType font that must not be subset is embedded whole, its glyphs keeping their
    // numbers (a CFF one keeps them anyway).
    if (font.noSubsetting && font instanceof TrueTypeFont) {
      for (let g = 1; g < font.numGlyphs; g++) this.#add(g, g);
    }
  }

  #add(gid: number, cid: number): void {
    this.glyphs.push(gid);
    this.#cids.set(gid, cid);
    this.#gids.set(cid, gid);
  }

  /** The CID showing glyph `gid` of the font, for the character `codePoint`. */
  cid(gid: number, codePoint: number): number {
    const f = this.font;
    const g = gid >= 0 && gid < f.numGlyphs ? gid : 0;
    let cid = this.#cids.get(g);
    if (cid === undefined) {
      cid = f instanceof CffFont ? f.cid(g) : this.glyphs.length;
      this.#add(g, cid);
    }
    if (!this.unicode.has(cid) && codePoint > 0) this.unicode.set(cid, codePoint);
    return cid;
  }

  /** A CID's advance in thousandths of an em, as /W writes it. */
  width(cid: number): number {
    return Number(
      pdfNumber((this.font.advance(this.#gids.get(cid) ?? 0) * 1000) / this.font.unitsPerEm),
    );
  }

  /**
   * The PDF objects of the font: `add` stores a dictionary or a stream (`data`, `length1`
   * for the font file) and returns its object number; `type0` is the number reserved for the
   * Type 0 font itself, which page resources name.
   */
  write(
    type0: number,
    set: (id: number, body: string) => void,
    add: (body: string) => number,
    stream: (dict: string, data: Uint8Array) => number,
  ): void {
    const f = this.font;
    const k = 1000 / f.unitsPerEm;
    const cff = f instanceof CffFont;
    const whole = cff && f.noSubsetting;
    const bytes = cff ? (whole ? f.program : f.subset(this.glyphs)) : f.subset(this.glyphs).bytes;
    const name = pdfName(f.postScriptName) || this.name;
    // §9.6.4: a subset's name starts with a tag; a font embedded whole has none.
    const base = whole ? name : `${subsetTag(this.glyphs, f.postScriptName)}+${name}`;
    const file = cff
      ? stream('/Subtype /CIDFontType0C', bytes)
      : stream(`/Length1 ${bytes.length}`, bytes);
    const flags = (f.fixedPitch ? 1 : 0) | 4 | (f.italicAngle !== 0 ? 64 : 0);
    const descriptor = add(
      `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${f.bbox
        .map((v) => pdfNumber(v * k))
        .join(' ')}] /ItalicAngle ${pdfNumber(f.italicAngle)} /Ascent ${pdfNumber(
        f.ascender * k,
      )} /Descent ${pdfNumber(f.descender * k)} /CapHeight ${pdfNumber(
        f.capHeight * k,
      )} /StemV 80 /${cff ? 'FontFile3' : 'FontFile2'} ${file} 0 R >>`,
    );
    const cidFont = cff
      ? add(
          `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${base} /CIDSystemInfo << /Registry (${pdfName(
            f.registry,
          )}) /Ordering (${pdfName(f.ordering)}) /Supplement ${f.supplement} >> /FontDescriptor ${descriptor} 0 R /W [${this.sparseWidths()}] >>`,
        )
      : add(
          `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /W [0 [${this.glyphs
            .map((_, cid) => pdfNumber(this.width(cid)))
            .join(' ')}]] /CIDToGIDMap /Identity >>`,
        );
    const toUnicode = stream('', latin1(this.cmap()));
    set(
      type0,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
    );
  }

  /** /W for the CIDs shown, in order, consecutive CIDs sharing one array: `c [w w …] …`. */
  sparseWidths(): string {
    const cids = [...this.#gids.keys()].sort((a, b) => a - b);
    const runs: string[] = [];
    for (let i = 0; i < cids.length;) {
      let j = i + 1;
      while (j < cids.length && cids[j] === cids[j - 1]! + 1) j++;
      const ws = cids.slice(i, j).map((c) => pdfNumber(this.width(c)));
      runs.push(`${cids[i]} [${ws.join(' ')}]`);
      i = j;
    }
    return runs.join(' ');
  }

  /** The ToUnicode CMap: each CID shown to the character it was shown for. */
  cmap(): string {
    const entries = [...this.unicode].sort((a, b) => a[0] - b[0]);
    const blocks: string[] = [];
    // At most 100 mappings per bfchar block (§9.10.3, as CMaps are written).
    for (let i = 0; i < entries.length; i += 100) {
      const part = entries.slice(i, i + 100);
      blocks.push(
        `${part.length} beginbfchar\n${part.map(([cid, cp]) => `<${hex4(cid)}> <${utf16(cp)}>`).join('\n')}\nendbfchar`,
      );
    }
    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
      '',
    ].join('\n');
  }
}

/** The OpenType fonts of one document, each embedded once whichever pages show it. */
export class PdfFonts {
  readonly #byFile = new Map<Uint8Array, EmbeddedFont | null>();
  readonly embedded: EmbeddedFont[] = [];

  /** The embedded font for `font`, or undefined when it cannot be embedded. */
  embed(font: PlotFont): EmbeddedFont | undefined {
    const bytes = font.bytes;
    if (!bytes) return undefined;
    let e = this.#byFile.get(bytes);
    if (e === undefined) {
      const font = TrueTypeFont.parse(bytes) ?? CffFont.parse(bytes);
      e = font?.embeddable ? new EmbeddedFont(`F${this.embedded.length + 1}`, font) : null;
      if (e) this.embedded.push(e);
      this.#byFile.set(bytes, e);
    }
    return e ?? undefined;
  }
}

const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');

/** A code point as UTF-16BE hex (a surrogate pair above the BMP). */
function utf16(cp: number): string {
  if (cp < 0x10000) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}

/** A PostScript name as a PDF name's regular characters (others dropped). */
function pdfName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100);
}

/**
 * The six capital letters §9.6.4 puts before a subset's name, made from the subset itself
 * (FNV-1a), so the same plot writes the same bytes and different subsets get different tags.
 */
function subsetTag(glyphs: readonly number[], name: string): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const g of glyphs) mix(g);
  for (let i = 0; i < name.length; i++) mix(name.charCodeAt(i));
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26);
  }
  return tag;
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};
