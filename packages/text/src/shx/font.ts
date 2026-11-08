// Compiled SHX files (M1-08, DEC-007): shape files and normal fonts ("AutoCAD-86 shapes 1.0"
// and 1.1), Unicode fonts ("unifont 1.0") and Asian big fonts ("bigfont 1.0", minimal). Users
// drop their own fonts; none are bundled (Autodesk SHX files are copyrighted).
//
// Compiled layouts, all little-endian after a text header ending in 0x1A:
//   shapes   u16 first, u16 last, u16 count; count × (u16 number, u16 bytes); then each
//            shape's bytes in index order.
//   unifont  u32 count (font info included), u16 info bytes, the info shape; then per shape
//            u16 number, u16 bytes, the bytes.
//   bigfont  u16 index entries, u16 shapes, u16 ranges; ranges × (u16 first, u16 last escape
//            byte); entries × (u16 number, u16 bytes, u32 file offset), all-zero entries empty.
// A shape's bytes are its name, a 0, and the specification ending in code 0. Shape 0 of a
// font is the font info: name, then above, below, modes (unifont: encoding, type; bigfont:
// width), then 0.
//
// The shapes layout matches AutoCAD's .shp compiler output as documented by the format's
// long-standing third-party descriptions; the big-font index layout has had no real file to
// check against yet (needs an owner-provided big font, see the M1-08 PR).

import { interpretShape, type ShapeSource, type ShxGlyph } from './strokes';

export type ShxKind = 'shapes' | 'unifont' | 'bigfont';

interface RawShape {
  readonly name: string;
  readonly spec: Uint8Array;
}

class FileReader {
  at = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number, what: string): void {
    if (this.at + n > this.bytes.length) {
      throw new Error(`SHX file is truncated: ${what} needs ${n} bytes at offset ${this.at}`);
    }
  }
  u16(what: string): number {
    this.need(2, what);
    const v = this.view.getUint16(this.at, true);
    this.at += 2;
    return v;
  }
  u32(what: string): number {
    this.need(4, what);
    const v = this.view.getUint32(this.at, true);
    this.at += 4;
    return v;
  }
  take(n: number, what: string): Uint8Array {
    this.need(n, what);
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}

/** Splits a shape's bytes into its name (up to the first 0) and its specification. */
function splitShape(bytes: Uint8Array): RawShape {
  const nul = bytes.indexOf(0);
  if (nul < 0) return { name: latin1(bytes), spec: new Uint8Array(0) };
  return { name: latin1(bytes.subarray(0, nul)), spec: bytes.subarray(nul + 1) };
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

const HEADER = /^AutoCAD-86 (\w+) (\d+\.\d+)\r\n$/;

export class ShxFont {
  readonly kind: ShxKind;
  /** The font info's name (shape 0); '' for a shape file without one. */
  readonly name: string;
  /** Font units from the baseline to the top of capitals; 0 for a plain shape file. */
  readonly above: number;
  readonly below: number;
  /** 0 horizontal only, 2 horizontal and vertical. */
  readonly modes: number;
  /** unifont: DXF-style encoding and embedding type bytes, as stored. */
  readonly encoding: number;
  readonly type: number;
  /** bigfont: character width from the font info, as stored. */
  readonly width: number;
  /** bigfont: lead-byte ranges of double-byte character codes. */
  readonly escapeRanges: readonly (readonly [number, number])[];
  /** Whether the file has font info (shape 0), i.e. is a text font rather than shapes. */
  readonly isFont: boolean;
  /** Font info mode 2: the font draws vertical text too (its code 14 commands). */
  readonly supportsVertical: boolean;

  readonly #shapes: ReadonlyMap<number, RawShape>;
  readonly #byName = new Map<string, number>();
  readonly #glyphs = new Map<number, ShxGlyph>();
  readonly #verticalGlyphs = new Map<number, ShxGlyph>();
  readonly #source: ShapeSource;

  constructor(
    kind: ShxKind,
    shapes: ReadonlyMap<number, RawShape>,
    info: readonly number[] | undefined,
    escapeRanges: readonly (readonly [number, number])[] = [],
  ) {
    this.kind = kind;
    this.#shapes = shapes;
    this.isFont = info !== undefined;
    this.name = shapes.get(0)?.name ?? '';
    const at = (i: number) => info?.[i] ?? 0;
    this.above = at(0);
    this.below = at(1);
    this.modes = at(2);
    this.supportsVertical = this.isFont && (this.modes & 2) !== 0;
    this.encoding = kind === 'unifont' ? at(3) : 0;
    this.type = kind === 'unifont' ? at(4) : 0;
    this.width = kind === 'bigfont' ? at(3) : 0;
    this.escapeRanges = escapeRanges;
    for (const [code, s] of shapes) if (code !== 0 && s.name) this.#byName.set(s.name, code);
    this.#source = {
      spec: (code) => (code === 0 ? undefined : shapes.get(code)?.spec),
      wideSubshapes: kind === 'unifont',
      bigfont: kind === 'bigfont',
      above: this.above,
    };
  }

  /** Shape numbers (character codes) present, ascending, without the font info. */
  codes(): number[] {
    return [...this.#shapes.keys()].filter((c) => c !== 0).sort((a, b) => a - b);
  }

  hasShape(code: number): boolean {
    return code !== 0 && this.#shapes.has(code);
  }

  /** A shape's number by its name (complex linetypes refer to shapes by name). */
  shapeByName(name: string): number | undefined {
    return this.#byName.get(name);
  }

  /** bigfont: does this byte start a double-byte character code? */
  isLeadByte(byte: number): boolean {
    return this.escapeRanges.some(([a, b]) => byte >= a && byte <= b);
  }

  /** Scale from font units to drawing units for a text height (capital height = height). */
  scaleFor(height: number): number {
    return this.above > 0 ? height / this.above : height;
  }

  /** The glyph for a shape number, interpreted once and cached; undefined if absent. */
  glyph(code: number): ShxGlyph | undefined {
    return this.#glyph(code, false, this.#glyphs);
  }

  /**
   * The glyph for vertical text (M1-110): the commands after code 14 run, so the pen starts
   * and ends where the font puts characters stacked top to bottom. Undefined if absent or the
   * font has no vertical mode.
   */
  verticalGlyph(code: number): ShxGlyph | undefined {
    if (!this.supportsVertical) return undefined;
    return this.#glyph(code, true, this.#verticalGlyphs);
  }

  #glyph(code: number, vertical: boolean, cache: Map<number, ShxGlyph>): ShxGlyph | undefined {
    const cached = cache.get(code);
    if (cached) return cached;
    const raw = code === 0 ? undefined : this.#shapes.get(code);
    if (!raw) return undefined;
    const label = (c: number) => {
      const n = this.#shapes.get(c)?.name;
      return n ? `shape ${c} (${n})` : `shape ${c}`;
    };
    const g = interpretShape(code, raw.name, this.#source, label, vertical);
    cache.set(code, g);
    return g;
  }
}

/** Font info values after the name (shape 0's spec, without its trailing 0). */
function infoOf(shapes: Map<number, RawShape>): number[] | undefined {
  const info = shapes.get(0);
  if (!info) return undefined;
  const values = [...info.spec];
  if (values[values.length - 1] === 0) values.pop();
  return values;
}

export function parseShx(bytes: Uint8Array): ShxFont {
  const eof = bytes.indexOf(0x1a);
  const header = eof > 0 && eof < 64 ? latin1(bytes.subarray(0, eof)) : '';
  const m = HEADER.exec(header);
  if (!m) throw new Error('not a compiled SHX file (no "AutoCAD-86 … 1.0" header)');
  const r = new FileReader(bytes);
  r.at = eof + 1;
  const kind = m[1]!;
  const shapes = new Map<number, RawShape>();

  if (kind === 'shapes') {
    r.u16('first shape number');
    r.u16('last shape number');
    const count = r.u16('shape count');
    const index: [number, number][] = [];
    for (let i = 0; i < count; i++) index.push([r.u16('index'), r.u16('index')]);
    for (const [code, length] of index)
      shapes.set(code, splitShape(r.take(length, `shape ${code}`)));
    return new ShxFont('shapes', shapes, infoOf(shapes));
  }

  if (kind === 'unifont') {
    const count = r.u32('shape count');
    const infoLength = r.u16('font info length');
    shapes.set(0, splitShape(r.take(infoLength, 'font info')));
    for (let i = 1; i < count; i++) {
      const code = r.u16('shape number');
      const length = r.u16('shape length');
      shapes.set(code, splitShape(r.take(length, `shape ${code}`)));
    }
    return new ShxFont('unifont', shapes, infoOf(shapes));
  }

  if (kind === 'bigfont') {
    const entries = r.u16('index size');
    r.u16('shape count');
    const rangeCount = r.u16('escape range count');
    const ranges: [number, number][] = [];
    for (let i = 0; i < rangeCount; i++) ranges.push([r.u16('range'), r.u16('range')]);
    for (let i = 0; i < entries; i++) {
      const code = r.u16('index');
      const length = r.u16('index');
      const offset = r.u32('index');
      if (length === 0 && offset === 0) continue;
      const at = new FileReader(bytes);
      at.at = offset;
      shapes.set(code, splitShape(at.take(length, `shape ${code}`)));
    }
    return new ShxFont('bigfont', shapes, infoOf(shapes), ranges);
  }

  throw new Error(`unsupported SHX type "${kind}"`);
}
