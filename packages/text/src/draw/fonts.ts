// Fonts for drawing text (M1-41 part 1): which loaded font a character style draws with, its
// exact advances as an `MTextMeasure`, and the shape number an SHX font holds a character
// under. Font files are loaded elsewhere (user font store, TtfRegistry: async); this is the
// synchronous view the renderer and layout use once they are in memory.
//
// Font resolution (ARCHITECTURE.md §8): the style's font by file name, else by TrueType family,
// else the bundled Hershey font that stands in for that SHX name (M1-09), else the alternate
// font (AutoCAD's FONTALT, itself through the same name map), else the default bundled font,
// else nothing. Every font drawn with another one is reported (`missing`, `substitutions`).

import type { MTextBase, MTextCharStyle, MTextFont } from '../mtext/parse';
import type { MTextMeasure } from '../mtext/layout';
import type { ShxFont } from '../shx/font';
import type { TtfFont } from '../ttf/font';
import { DEFAULT_BUNDLED_FONT, SHX_EQUIVALENTS } from '../hershey/catalog';

export type TextFace =
  | { readonly kind: 'shx'; readonly font: ShxFont }
  | { readonly kind: 'ttf'; readonly font: TtfFont };

export interface TextFonts {
  /** The face a character style's font draws with; undefined when nothing loaded serves it. */
  face(font: MTextFont): TextFace | undefined;
  /** A text style's big font (DXF 4) by file name. */
  bigFont(name: string): ShxFont | undefined;
}

const TRUETYPE_FILE = /\.(ttf|otf|ttc)$/i;

/** A font file name as a lookup key: no folder, lower case, no extension. */
function fileKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.toLowerCase().replace(/\.(shx|shp|ttf|otf|ttc)$/, '');
}

/** The character format a TEXT/MTEXT style starts from (DXF 3 font, ACAD xdata style bits). */
export function styleFont(style: {
  readonly font: string;
  readonly trueTypeFlags: number;
}): MTextFont {
  // FontFlags from the style's ACAD xdata: 1 italic, 2 bold.
  return {
    name: style.font,
    kind: TRUETYPE_FILE.test(style.font) ? 'ttf' : 'shx',
    bold: (style.trueTypeFlags & 2) !== 0,
    italic: (style.trueTypeFlags & 1) !== 0,
  };
}

/**
 * The format an MTEXT on a style starts from, as the renderer reads it: the style's font,
 * width factor (0 read as 1) and obliquing (radians in the style, degrees here), at the
 * entity's height. The in-place editor reads contents relative to it (M2-07 part 2).
 */
export function mtextBase(
  style: {
    readonly font: string;
    readonly trueTypeFlags: number;
    readonly widthFactor?: number;
    readonly obliqueAngle?: number;
  },
  height: number,
): MTextBase {
  return {
    font: styleFont(style),
    height,
    widthFactor: style.widthFactor || 1,
    oblique: ((style.obliqueAngle ?? 0) * 180) / Math.PI,
  };
}

export interface FontBookOptions {
  /** FONTALT: the SHX font used for a font that is not loaded. */
  readonly alternate?: string;
}

/** Loaded fonts by file name and family. */
export class FontBook implements TextFonts {
  readonly #shx = new Map<string, ShxFont>();
  readonly #ttfFiles = new Map<string, TtfFont>();
  readonly #families = new Map<string, TtfFont[]>();
  readonly #alternate: string | undefined;
  /** Requested font names that were drawn with another font or not at all. */
  readonly missing = new Set<string>();
  /** Requested font name → the loaded font (by file key) that drew it instead, for the health report. */
  readonly substitutions = new Map<string, string>();

  constructor(options: FontBookOptions = {}) {
    this.#alternate = options.alternate;
  }

  addShx(fileName: string, font: ShxFont): void {
    this.#shx.set(fileKey(fileName), font);
  }

  addTtf(font: TtfFont, fileName?: string): void {
    if (fileName) this.#ttfFiles.set(fileKey(fileName), font);
    const family = font.family.toLowerCase();
    this.#families.set(family, [...(this.#families.get(family) ?? []), font]);
  }

  face(font: MTextFont): TextFace | undefined {
    const r = this.resolve(font);
    if (r.substitute !== undefined || !r.face) this.missing.add(font.name);
    if (r.substitute !== undefined) this.substitutions.set(font.name, r.substitute);
    return r.face;
  }

  /**
   * How `face` would draw a font, without recording anything: its own face, or the loaded
   * font (by file key) that stands in for it, or nothing. The health report asks this per
   * drawing, as `missing` and `substitutions` gather every drawing the book has drawn.
   */
  resolve(font: MTextFont): { readonly face?: TextFace; readonly substitute?: string } {
    const found = this.#find(font);
    if (found) return { face: found };
    const key = this.#substitute(font.name);
    if (key === undefined) return {};
    return { face: { kind: 'shx', font: this.#shx.get(key)! }, substitute: key };
  }

  /** Whether an SHX file (a big font or shape file) of this name is loaded. */
  hasShx(name: string): boolean {
    return this.#shx.has(fileKey(name));
  }

  /**
   * The loaded SHX font that draws a font that is not loaded. The bundled equivalent of the
   * very font the style names comes first, as it is closer than FONTALT, which stands in for
   * any font (DEC-044).
   */
  #substitute(name: string): string | undefined {
    const loaded = (key: string | undefined) => (key && this.#shx.has(key) ? key : undefined);
    const equivalent = (key: string) =>
      Object.hasOwn(SHX_EQUIVALENTS, key) ? loaded(SHX_EQUIVALENTS[key]) : undefined;
    const alt = this.#alternate === undefined ? undefined : fileKey(this.#alternate);
    return (
      equivalent(fileKey(name)) ??
      (alt === undefined ? undefined : (loaded(alt) ?? equivalent(alt))) ??
      loaded(DEFAULT_BUNDLED_FONT)
    );
  }

  bigFont(name: string): ShxFont | undefined {
    const f = this.#shx.get(fileKey(name));
    if (!f) this.missing.add(name);
    return f;
  }

  #find(font: MTextFont): TextFace | undefined {
    const key = fileKey(font.name);
    if (font.kind === 'shx' && !TRUETYPE_FILE.test(font.name)) {
      const shx = this.#shx.get(key);
      if (shx) return { kind: 'shx', font: shx };
    }
    const file = this.#ttfFiles.get(key);
    if (file && TRUETYPE_FILE.test(font.name)) return { kind: 'ttf', font: file };
    const family = this.#families.get(font.name.toLowerCase());
    if (family) {
      // The face whose bold and italic match best; ties keep the first added.
      const score = (f: TtfFont) =>
        Number(f.style.bold === font.bold) + Number(f.style.italic === font.italic);
      const best = family.reduce((a, b) => (score(b) > score(a) ? b : a));
      return { kind: 'ttf', font: best };
    }
    if (file) return { kind: 'ttf', font: file };
    return undefined;
  }
}

/**
 * Where a non-Unicode SHX font, which has no shapes past 255, keeps the `%%d`, `%%p` and `%%c`
 * symbols: 127 degree, 128 plus/minus, 129 diameter. AutoCAD documents the codes but not these
 * shape numbers ("Control Codes and Special Characters"); this is the layout of the classic
 * .shp text fonts that drafters' fonts follow. A font without them shows "?".
 */
const SHX_SYMBOLS: Readonly<Record<number, number>> = { 0xb0: 127, 0xb1: 128, 0x2205: 129 };
/** AutoCAD draws a character a font lacks as a question mark. */
const QUESTION = 0x3f;

/** The shape number an SHX font draws a character with, or undefined if it has none. */
export function shxCode(font: ShxFont, codePoint: number): number | undefined {
  if (font.hasShape(codePoint)) return codePoint;
  const symbol = SHX_SYMBOLS[codePoint];
  if (symbol !== undefined && font.kind !== 'unifont' && font.hasShape(symbol)) return symbol;
  return font.hasShape(QUESTION) ? QUESTION : undefined;
}

/** Font units → drawing units for a text height (capital height = height). */
export function faceScale(face: TextFace, height: number): number {
  return face.font.scaleFor(height);
}

/** A character's advance in font units in a face (SHX: its pen's end; TrueType: hmtx). */
export function charAdvance(face: TextFace, codePoint: number): number {
  if (face.kind === 'ttf') return face.font.glyph(codePoint).advance;
  const code = shxCode(face.font, codePoint);
  return code === undefined ? 0 : (face.font.glyph(code)?.advance.x ?? 0);
}

/** Whether a face draws vertical text (M1-110): an SHX font with both orientations. */
export function verticalFace(face: TextFace | undefined): boolean {
  return face?.kind === 'shx' && face.font.supportsVertical;
}

/**
 * A character's advance down the column in vertical text, in font units: how far its
 * vertical glyph moves the pen down. 0 in a face without vertical text.
 */
export function verticalAdvance(face: TextFace, codePoint: number): number {
  if (face.kind !== 'shx') return 0;
  const code = shxCode(face.font, codePoint);
  return code === undefined ? 0 : -(face.font.verticalGlyph(code)?.advance.y ?? 0);
}

export interface FontMeasureOptions {
  /**
   * Measure down the column of vertical text (M1-110): the advance is the vertical pen
   * advance, which the width factor (a horizontal scale) leaves alone. Faces without vertical
   * text measure as in horizontal text.
   */
  readonly vertical?: boolean;
}

/**
 * Exact advances from the loaded fonts. A style whose font is not loaded measures with fixed
 * cells one height wide, so layout still places it (it draws nothing until the font arrives).
 */
export function fontMeasure(
  fonts: TextFonts,
  bigFont?: ShxFont,
  options: FontMeasureOptions = {},
): MTextMeasure {
  const vertical = options.vertical === true;
  return {
    advance(text: string, style: MTextCharStyle): number {
      const face = fonts.face(style.font);
      let units = 0;
      if (!face) return [...text].length * style.height * style.widthFactor;
      if (vertical && verticalFace(face)) {
        for (const ch of text) units += verticalAdvance(face, ch.codePointAt(0)!);
        return units * faceScale(face, style.height);
      }
      if (face.kind === 'ttf') units = face.font.advance(text);
      else for (const ch of text) units += charAdvance(face, ch.codePointAt(0)!);
      return units * faceScale(face, style.height) * style.widthFactor;
    },
    mbcs(_codepage: number, code: number, style: MTextCharStyle): number {
      if (vertical && bigFont?.supportsVertical) {
        const v = bigFont.verticalGlyph(code);
        return v ? -v.advance.y * bigFont.scaleFor(style.height) : style.height;
      }
      const g = bigFont?.glyph(code);
      if (!bigFont || !g) return style.height;
      return g.advance.x * bigFont.scaleFor(style.height) * style.widthFactor;
    },
  };
}
