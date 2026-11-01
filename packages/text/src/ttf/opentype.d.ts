// The part of opentype.js 2.0 (MIT) that Triya uses. The package ships no type definitions,
// and @types/opentype.js describes 1.x.
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' };

  export class Path {
    commands: PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    close(): void;
  }

  export class Glyph {
    constructor(options: {
      name?: string;
      unicode?: number;
      unicodes?: number[];
      advanceWidth?: number;
      path?: Path;
    });
    index: number;
    name: string | null;
    unicode?: number;
    unicodes: number[];
    advanceWidth?: number;
    /** Outline in font units, y up. */
    path: Path;
  }

  export interface GlyphSet {
    length: number;
    get(index: number): Glyph;
  }

  /** A name table record: language tag → string. */
  export type LocalizedName = Record<string, string | undefined>;
  export type NameTable = Record<string, LocalizedName | undefined>;

  export class Font {
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      glyphs: Glyph[];
      weightClass?: number;
      italicAngle?: number;
      fsSelection?: number;
    });
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: NameTable & { windows?: NameTable; macintosh?: NameTable; unicode?: NameTable };
    tables: Record<string, Record<string, unknown> | undefined>;
    glyphs: GlyphSet;
    numGlyphs: number;
    kerningPairs: Record<string, number>;
    charToGlyph(c: string): Glyph;
    charToGlyphIndex(c: string): number;
    hasChar(c: string): boolean;
    getKerningValue(left: Glyph | number, right: Glyph | number): number;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    toArrayBuffer(): ArrayBuffer;
  }

  export function parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font;
}
