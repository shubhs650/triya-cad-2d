// Builds compiled SHX files for tests, so no Autodesk font is ever needed (CLAUDE.md "No
// Autodesk assets"). The layouts follow the compiled formats the parser reads (see
// src/shx/parse.ts); shape bytes are written exactly as a .shp source lists them.

export interface ShapeDef {
  readonly code: number;
  readonly name: string;
  /** The shape specification bytes after the name, ending with the 0 terminator. */
  readonly bytes: readonly number[];
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

class Writer {
  readonly out: number[] = [];
  u8(...v: number[]): this {
    for (const b of v) this.out.push(b & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v & 0xff, v >> 8);
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  str(s: string): this {
    return this.u8(...ascii(s));
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** A signed byte as stored in shape bytes. */
export const s8 = (v: number): number => v & 0xff;

/** Shape body: name, a zero, then the spec bytes. */
const body = (s: ShapeDef): number[] => [...ascii(s.name), 0, ...s.bytes];

/** "AutoCAD-86 shapes 1.0" (or 1.1): a shape file or a normal (non-Unicode) font. */
export function buildShapes(
  shapes: readonly ShapeDef[],
  font?: { name: string; above: number; below: number; modes?: number },
  version = '1.0',
): Uint8Array {
  const all = font
    ? [{ code: 0, name: font.name, bytes: [font.above, font.below, font.modes ?? 0, 0] }, ...shapes]
    : [...shapes];
  const w = new Writer().str(`AutoCAD-86 shapes ${version}\r\n\x1a`);
  const codes = all.map((s) => s.code);
  w.u16(Math.min(...codes))
    .u16(Math.max(...codes))
    .u16(all.length);
  for (const s of all) w.u16(s.code).u16(body(s).length);
  for (const s of all) w.u8(...body(s));
  return w.bytes();
}

/** "AutoCAD-86 unifont 1.0": 16-bit Unicode shape numbers, font info first. */
export function buildUnifont(
  shapes: readonly ShapeDef[],
  font: {
    name: string;
    above: number;
    below: number;
    modes?: number;
    encoding?: number;
    type?: number;
  },
): Uint8Array {
  const info = [
    ...ascii(font.name),
    0,
    font.above,
    font.below,
    font.modes ?? 0,
    font.encoding ?? 0,
    font.type ?? 0,
    0,
  ];
  const w = new Writer().str('AutoCAD-86 unifont 1.0\r\n\x1a');
  w.u32(shapes.length + 1)
    .u16(info.length)
    .u8(...info);
  for (const s of shapes)
    w.u16(s.code)
      .u16(body(s).length)
      .u8(...body(s));
  return w.bytes();
}

/** "AutoCAD-86 bigfont 1.0": escape-byte ranges and an offset index (empty slots allowed). */
export function buildBigfont(
  shapes: readonly ShapeDef[],
  font: { name: string; above: number; below: number; modes?: number; width?: number },
  ranges: readonly (readonly [number, number])[],
  emptySlots = 0,
): Uint8Array {
  const all = [
    {
      code: 0,
      name: font.name,
      bytes: [font.above, font.below, font.modes ?? 0, font.width ?? 0, 0],
    },
    ...shapes,
  ];
  const header = 'AutoCAD-86 bigfont 1.0\r\n\x1a';
  const entries = all.length + emptySlots;
  const dataStart = header.length + 6 + 4 * ranges.length + 8 * entries;
  const w = new Writer().str(header);
  w.u16(entries).u16(all.length).u16(ranges.length);
  for (const [a, b] of ranges) w.u16(a).u16(b);
  let offset = dataStart;
  for (const s of all) {
    w.u16(s.code).u16(body(s).length).u32(offset);
    offset += body(s).length;
  }
  for (let i = 0; i < emptySlots; i++) w.u16(0).u16(0).u32(0);
  for (const s of all) w.u8(...body(s));
  return w.bytes();
}
