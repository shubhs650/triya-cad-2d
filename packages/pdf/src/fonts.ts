// TrueType text in a plot (M2-16 part 3): each TrueType font a plot's text uses is embedded
// once per document as a subset of the glyphs shown, as PDF 32000-1:2008 §9.7 builds a
// composite font: a Type 0 font with the Identity-H encoding (two-byte codes, code = CID) over a
// CIDFontType2 descendant whose CIDs are the subset's glyph numbers (CIDToGIDMap Identity),
// its widths in /W, and a ToUnicode CMap (§9.10.3) so the text stays searchable and copies as
// the characters typed. CIDs are handed out as glyphs are first shown, so a page's content can
// be written before the subset is known. A font that is not TrueType ('glyf'), or whose OS/2
// fsType forbids embedding outlines, is not embedded: its text plots as outlines (AutoCAD's PDF
// export also turns such fonts into geometry). No DOM here.

import { pdfNumber } from './content';
import { TrueTypeFont } from './truetype';

/** What a plot needs of a font: its file. `TtfFont` from the text package carries it. */
export interface PlotFont {
  /** The .ttf/.otf file the font was read from. */
  readonly bytes?: Uint8Array;
}

/** A TrueType font embedded in a document, named `F<n>` in page resources. */
export class EmbeddedFont {
  /** Subset glyph (= CID) → glyph of the font; .notdef is CID 0. */
  readonly glyphs: number[] = [0];
  /** CID → the character it was first shown for. */
  readonly unicode = new Map<number, number>();
  readonly #cids = new Map<number, number>([[0, 0]]);

  constructor(
    readonly name: string,
    readonly font: TrueTypeFont,
  ) {
    // A font that must not be subset is embedded whole, its glyphs keeping their numbers.
    if (font.noSubsetting) {
      for (let g = 1; g < font.numGlyphs; g++) this.#cids.set(g, this.glyphs.push(g) - 1);
    }
  }

  /** The CID showing glyph `gid` of the font, for the character `codePoint`. */
  cid(gid: number, codePoint: number): number {
    const g = gid >= 0 && gid < this.font.numGlyphs ? gid : 0;
    let cid = this.#cids.get(g);
    if (cid === undefined) this.#cids.set(g, (cid = this.glyphs.push(g) - 1));
    if (!this.unicode.has(cid) && codePoint > 0) this.unicode.set(cid, codePoint);
    return cid;
  }

  /** A CID's advance in thousandths of an em, as /W writes it. */
  width(cid: number): number {
    return Number(
      pdfNumber((this.font.advance(this.glyphs[cid] ?? 0) * 1000) / this.font.unitsPerEm),
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
    const { bytes } = f.subset(this.glyphs);
    const k = 1000 / f.unitsPerEm;
    const base = `${subsetTag(this.glyphs, f.postScriptName)}+${pdfName(f.postScriptName) || this.name}`;
    const file = stream(`/Length1 ${bytes.length}`, bytes);
    const flags = (f.fixedPitch ? 1 : 0) | 4 | (f.italicAngle !== 0 ? 64 : 0);
    const descriptor = add(
      `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${f.bbox
        .map((v) => pdfNumber(v * k))
        .join(' ')}] /ItalicAngle ${pdfNumber(f.italicAngle)} /Ascent ${pdfNumber(
        f.ascender * k,
      )} /Descent ${pdfNumber(f.descender * k)} /CapHeight ${pdfNumber(
        f.capHeight * k,
      )} /StemV 80 /FontFile2 ${file} 0 R >>`,
    );
    const widths = this.glyphs.map((_, cid) => pdfNumber(this.width(cid)));
    const cidFont = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /W [0 [${widths.join(
        ' ',
      )}]] /CIDToGIDMap /Identity >>`,
    );
    const toUnicode = stream('', latin1(this.cmap()));
    set(
      type0,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
    );
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

/** The TrueType fonts of one document, each embedded once whichever pages show it. */
export class PdfFonts {
  readonly #byFile = new Map<Uint8Array, EmbeddedFont | null>();
  readonly embedded: EmbeddedFont[] = [];

  /** The embedded font for `font`, or undefined when it cannot be embedded. */
  embed(font: PlotFont): EmbeddedFont | undefined {
    const bytes = font.bytes;
    if (!bytes) return undefined;
    let e = this.#byFile.get(bytes);
    if (e === undefined) {
      const ttf = TrueTypeFont.parse(bytes);
      e = ttf?.embeddable ? new EmbeddedFont(`F${this.embedded.length + 1}`, ttf) : null;
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
