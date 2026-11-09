// TrueType/OpenType fonts (M1-10) through opentype.js: glyph outlines in font units, exact
// advance widths, and the style flags text styles select by. Widths come from the font's
// metrics, never estimates (CLAUDE.md), so TEXT/MTEXT layout, dimension text and PDF output
// all measure the same way in the browser, in workers and in Node.

import type { Font, Glyph, LocalizedName, NameTable } from 'opentype.js';
import { opentype } from './lib';

export type TtfPathCommand =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

export interface TtfGlyph {
  readonly index: number;
  readonly codePoint: number;
  readonly name: string;
  /** Advance width in font units. */
  readonly advance: number;
  /** Outline in font units, y up, from the glyph origin on the baseline. */
  readonly commands: readonly TtfPathCommand[];
  /** The font has no glyph for the character; this is .notdef. */
  readonly missing: boolean;
}

export interface TtfStyle {
  readonly bold: boolean;
  readonly italic: boolean;
  /** OS/2 usWeightClass (400 regular, 700 bold). */
  readonly weight: number;
  /** post.italicAngle in degrees, negative leaning right. */
  readonly italicAngle: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

/** The English (or first) string of a name record, from whichever platform table has it. */
function nameOf(names: Font['names'], key: string): string {
  const tables: (NameTable | undefined)[] = [names.windows, names.macintosh, names.unicode, names];
  for (const t of tables) {
    const rec: LocalizedName | undefined = t?.[key];
    if (!rec) continue;
    const s = rec['en'] ?? Object.values(rec).find((v) => typeof v === 'string');
    if (s) return s;
  }
  return '';
}

function convert(glyph: Glyph): TtfPathCommand[] {
  return glyph.path.commands.map((c): TtfPathCommand => {
    switch (c.type) {
      case 'M':
      case 'L':
        return { op: c.type, x: c.x, y: c.y };
      case 'Q':
        return { op: 'Q', x1: c.x1, y1: c.y1, x: c.x, y: c.y };
      case 'C':
        return { op: 'C', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: c.x, y: c.y };
      case 'Z':
        return { op: 'Z' };
    }
  });
}

export class TtfFont {
  readonly family: string;
  readonly subfamily: string;
  readonly fullName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  /** Height of capitals in font units: OS/2 sCapHeight, else the 'H' outline, else ascender. */
  readonly capHeight: number;
  readonly style: TtfStyle;
  /** The font file, when read from one: a PDF plot embeds it (M2-16 part 3). */
  readonly bytes?: Uint8Array;

  readonly #font: Font;
  readonly #glyphs = new Map<number, TtfGlyph>();

  constructor(font: Font, bytes?: Uint8Array) {
    this.#font = font;
    if (bytes) this.bytes = bytes;
    this.family = nameOf(font.names, 'fontFamily');
    this.subfamily = nameOf(font.names, 'fontSubfamily');
    this.fullName = nameOf(font.names, 'fullName');
    this.unitsPerEm = font.unitsPerEm;
    this.ascender = font.ascender;
    this.descender = font.descender;
    const os2 = font.tables['os2'] ?? {};
    const head = font.tables['head'] ?? {};
    const post = font.tables['post'] ?? {};
    const fsSelection = num(os2['fsSelection']);
    const macStyle = num(head['macStyle']);
    const weight = num(os2['usWeightClass'], 400);
    const italicAngle = num(post['italicAngle']);
    this.style = {
      // OS/2 fsSelection bit 5 / head macStyle bit 0 (bold); bit 0 / bit 1 (italic).
      bold: (fsSelection & 0x20) !== 0 || (macStyle & 1) !== 0 || weight >= 600,
      italic: (fsSelection & 1) !== 0 || (macStyle & 2) !== 0 || italicAngle !== 0,
      weight,
      italicAngle,
    };
    this.capHeight = num(os2['sCapHeight']) || this.#outlineTop(0x48) || font.ascender;
  }

  /**
   * Scale from font units to drawing units for a text height. AutoCAD's text height is the
   * height of capitals for TrueType text as for SHX, so this divides by the cap height
   * (ambiguous in AutoCAD's docs; this is what drafters see: "H" stands `height` tall).
   */
  scaleFor(height: number): number {
    return height / this.capHeight;
  }

  hasGlyph(codePoint: number): boolean {
    return this.#font.hasChar(String.fromCodePoint(codePoint));
  }

  /** The glyph for a code point (.notdef when missing), converted once and cached. */
  glyph(codePoint: number): TtfGlyph {
    const cached = this.#glyphs.get(codePoint);
    if (cached) return cached;
    const char = String.fromCodePoint(codePoint);
    // The index from the cmap: a glyph object built in memory does not always carry its own.
    const index = this.#font.charToGlyphIndex(char);
    const g = this.#font.glyphs.get(index);
    const out: TtfGlyph = {
      index,
      codePoint,
      name: g.name ?? '',
      advance: g.advanceWidth ?? 0,
      commands: convert(g),
      missing: !this.#font.hasChar(char),
    };
    this.#glyphs.set(codePoint, out);
    return out;
  }

  /**
   * Advance width of a string in font units: the glyph advances, by code point, plus the
   * font's kerning when asked. AutoCAD does not kern TEXT, so kerning is off by default.
   */
  advance(text: string, options: { kerning?: boolean } = {}): number {
    let total = 0;
    let prev: TtfGlyph | undefined;
    for (const ch of text) {
      const g = this.glyph(ch.codePointAt(0)!);
      if (options.kerning && prev) total += this.#font.getKerningValue(prev.index, g.index);
      total += g.advance;
      prev = g;
    }
    return total;
  }

  /** Width of a string in drawing units at a text height (no width factor or kerning). */
  width(text: string, height: number): number {
    return this.advance(text) * this.scaleFor(height);
  }

  #outlineTop(codePoint: number): number {
    if (!this.hasGlyph(codePoint)) return 0;
    let top = 0;
    for (const c of this.glyph(codePoint).commands) if (c.op !== 'Z') top = Math.max(top, c.y);
    return top;
  }
}

/** Reads a .ttf/.otf file (TrueType or CFF outlines). */
export function parseTtf(bytes: Uint8Array): TtfFont {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let font: Font;
  try {
    font = opentype.parse(buffer as ArrayBuffer);
  } catch (e) {
    throw new Error(`not a TrueType/OpenType font: ${(e as Error).message}`, { cause: e });
  }
  return new TtfFont(font, new Uint8Array(buffer as ArrayBuffer));
}
