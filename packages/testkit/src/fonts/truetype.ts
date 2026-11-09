// A TrueType ('glyf') test font written here (M2-16 part 3), so no third-party font file is
// committed or read: "Triya Pixel", capitals, digits and some punctuation drawn on a 5 × 7
// grid of 100-unit squares, an O of quadratic Béziers (off-curve points, a counter), and Å and Ä
// as composite glyphs over two glyphs no character maps to (ring, dieresis). opentype.js reads
// it like any TrueType font, and the PDF writer embeds subsets of it.
import { writeSfnt } from '@triya/pdf';

type Point = readonly [x: number, y: number, on: boolean];
type Contour = readonly Point[];

interface SimpleGlyph {
  readonly kind: 'simple';
  readonly contours: readonly Contour[];
  readonly advance: number;
}

interface CompositeGlyph {
  readonly kind: 'composite';
  readonly parts: readonly { readonly glyph: string; readonly dx: number; readonly dy: number }[];
  readonly advance: number;
}

type GlyphDef = SimpleGlyph | CompositeGlyph;

const PX = 100;
const ADVANCE = 600;

/** Capital letters, digits and punctuation, top row first; '#' is ink. */
const BITMAPS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
  ':': ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '°': ['.##..', '#..#.', '#..#.', '.##..', '.....', '.....', '.....'],
};

/**
 * Squares of ink as rectangles: runs along each row, stacked where rows repeat. Each one
 * reaches 2 units below its last row (but not below the baseline), so rows overlap and no
 * hairline seam shows between them when filled non-zero.
 */
function pixelContours(rows: readonly string[], px = PX, x0 = 50, top = 7 * PX): Contour[] {
  const rects: { c0: number; c1: number; r0: number; r1: number }[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      let e = c;
      while (row[e + 1] === '#') e++;
      const above = rects.find((q) => q.c0 === c && q.c1 === e && q.r1 === r - 1);
      if (above) above.r1 = r;
      else rects.push({ c0: c, c1: e, r0: r, r1: r });
      c = e;
    }
  });
  return rects.map(({ c0, c1, r0, r1 }) => {
    const xa = x0 + c0 * px;
    const xb = x0 + (c1 + 1) * px;
    const ya = top - r0 * px;
    const yb = Math.max(0, top - (r1 + 1) * px - 2);
    // Clockwise, y up: TrueType's direction for filled contours.
    return [
      [xa, yb, true],
      [xa, ya, true],
      [xb, ya, true],
      [xb, yb, true],
    ];
  });
}

/** An O of quadratic arcs: on-curve points at the extremes, off-curve at the box corners. */
function roundO(): Contour[] {
  const ring = (x0: number, y0: number, x1: number, y1: number, clockwise: boolean): Contour => {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const pts: Point[] = [
      [cx, y1, true],
      [x1, y1, false],
      [x1, cy, true],
      [x1, y0, false],
      [cx, y0, true],
      [x0, y0, false],
      [x0, cy, true],
      [x0, y1, false],
    ];
    return clockwise ? pts : [pts[0]!, ...pts.slice(1).reverse()];
  };
  return [ring(50, 0, 550, 700, true), ring(150, 100, 450, 600, false)];
}

/** The glyphs in font order; .notdef first, then the unencoded components. */
function glyphDefs(): Map<string, GlyphDef> {
  const g = new Map<string, GlyphDef>();
  g.set('.notdef', {
    kind: 'simple',
    advance: ADVANCE,
    contours: [
      [
        [50, 0, true],
        [50, 700, true],
        [550, 700, true],
        [550, 0, true],
      ],
      [
        [150, 100, true],
        [450, 100, true],
        [450, 600, true],
        [150, 600, true],
      ],
    ],
  });
  g.set('ring', {
    kind: 'simple',
    advance: 0,
    contours: pixelContours(['###', '#.#', '###'], 60, 0, 960),
  });
  g.set('dieresis', { kind: 'simple', advance: 0, contours: pixelContours(['#.#'], 100, 0, 900) });
  g.set(' ', { kind: 'simple', advance: ADVANCE, contours: [] });
  for (const [ch, rows] of Object.entries(BITMAPS)) {
    g.set(ch, { kind: 'simple', advance: ADVANCE, contours: pixelContours(rows) });
    if (ch === 'N') g.set('O', { kind: 'simple', advance: ADVANCE, contours: roundO() });
  }
  g.set('Å', {
    kind: 'composite',
    advance: ADVANCE,
    parts: [
      { glyph: 'A', dx: 0, dy: 0 },
      { glyph: 'ring', dx: 210, dy: 0 },
    ],
  });
  g.set('Ä', {
    kind: 'composite',
    advance: ADVANCE,
    parts: [
      { glyph: 'A', dx: 0, dy: 0 },
      { glyph: 'dieresis', dx: 150, dy: 0 },
    ],
  });
  return g;
}

class Writer {
  readonly bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number) {
    return this.u16(Math.floor(v / 0x10000)).u16(v & 0xffff);
  }
  tag(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  out() {
    return new Uint8Array(this.bytes);
  }
}

interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function boundsOf(contours: readonly Contour[]): Bounds {
  const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  for (const c of contours)
    for (const [x, y] of c) {
      b.xMin = Math.min(b.xMin, x);
      b.yMin = Math.min(b.yMin, y);
      b.xMax = Math.max(b.xMax, x);
      b.yMax = Math.max(b.yMax, y);
    }
  return b;
}

function simpleGlyf(contours: readonly Contour[]): Uint8Array {
  if (contours.length === 0) return new Uint8Array(0);
  const b = boundsOf(contours);
  const w = new Writer().i16(contours.length).i16(b.xMin).i16(b.yMin).i16(b.xMax).i16(b.yMax);
  let end = -1;
  for (const c of contours) w.u16((end += c.length));
  w.u16(0); // no instructions
  const pts = contours.flat();
  for (const [, , on] of pts) w.u8(on ? 1 : 0); // 16-bit coordinate deltas throughout
  let px = 0;
  for (const [x] of pts) {
    w.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of pts) {
    w.i16(y - py);
    py = y;
  }
  return w.out();
}

const ARG_WORDS_XY = 0x0001 | 0x0002;
const MORE = 0x0020;

export interface TestTrueTypeOptions {
  readonly family?: string;
  /** OS/2 fsType: 0 installable; 2 restricted licence (not embeddable). */
  readonly fsType?: number;
}

/** "Triya Pixel" as a TrueType font file. */
export function testTrueType(options: TestTrueTypeOptions = {}): Uint8Array {
  const family = options.family ?? 'Triya Pixel';
  const defs = glyphDefs();
  const names = [...defs.keys()];
  const index = new Map(names.map((n, i) => [n, i]));
  const bounds = new Map<string, Bounds>();
  const glyphs = names.map((name) => {
    const d = defs.get(name)!;
    if (d.kind === 'simple') {
      if (d.contours.length > 0) bounds.set(name, boundsOf(d.contours));
      return simpleGlyf(d.contours);
    }
    const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
    for (const p of d.parts) {
      const pb = bounds.get(p.glyph)!;
      b.xMin = Math.min(b.xMin, pb.xMin + p.dx);
      b.yMin = Math.min(b.yMin, pb.yMin + p.dy);
      b.xMax = Math.max(b.xMax, pb.xMax + p.dx);
      b.yMax = Math.max(b.yMax, pb.yMax + p.dy);
    }
    bounds.set(name, b);
    const w = new Writer().i16(-1).i16(b.xMin).i16(b.yMin).i16(b.xMax).i16(b.yMax);
    d.parts.forEach((p, i) => {
      w.u16(ARG_WORDS_XY | (i < d.parts.length - 1 ? MORE : 0))
        .u16(index.get(p.glyph)!)
        .i16(p.dx)
        .i16(p.dy);
    });
    return w.out();
  });

  const glyf = new Writer();
  const loca = new Writer();
  for (const g of glyphs) {
    loca.u32(glyf.bytes.length);
    for (const b of g) glyf.u8(b);
    while (glyf.bytes.length % 4) glyf.u8(0);
  }
  loca.u32(glyf.bytes.length);

  const hmtx = new Writer();
  for (const name of names) hmtx.u16(defs.get(name)!.advance).i16(bounds.get(name)?.xMin ?? 0);

  let maxPoints = 0;
  let maxContours = 0;
  for (const d of defs.values()) {
    if (d.kind !== 'simple') continue;
    maxPoints = Math.max(maxPoints, d.contours.flat().length);
    maxContours = Math.max(maxContours, d.contours.length);
  }
  const all = [...bounds.values()];
  const fontBox = {
    xMin: Math.min(...all.map((b) => b.xMin)),
    yMin: Math.min(...all.map((b) => b.yMin)),
    xMax: Math.max(...all.map((b) => b.xMax)),
    yMax: Math.max(...all.map((b) => b.yMax)),
  };

  const head = new Writer()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(1000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(fontBox.xMin)
    .i16(fontBox.yMin)
    .i16(fontBox.xMax)
    .i16(fontBox.yMax)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1) // long loca
    .i16(0);

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(1000)
    .i16(-250)
    .i16(0)
    .u16(ADVANCE)
    .i16(0)
    .i16(0)
    .i16(fontBox.xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(names.length);

  const maxp = new Writer()
    .u32(0x00010000)
    .u16(names.length)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(maxPoints * 2)
    .u16(maxContours * 2)
    .u16(2);
  for (let i = 0; i < 6; i++) maxp.u16(0);
  maxp.u16(2).u16(1);

  const codes = names
    .filter((n) => [...n].length === 1 && defs.get(n))
    .map((n) => ({ cp: n.codePointAt(0)!, gid: index.get(n)! }))
    .sort((a, b) => a.cp - b.cp);

  const os2 = new Writer()
    .u16(4)
    .i16(ADVANCE)
    .u16(400)
    .u16(5)
    .u16(options.fsType ?? 0);
  for (let i = 0; i < 11; i++) os2.i16(0); // sub/superscript, strikeout, family class
  for (let i = 0; i < 10; i++) os2.u8(0); // panose
  os2.u32(1).u32(0).u32(0).u32(0); // Basic Latin
  os2
    .tag('TRYA')
    .u16(0x40)
    .u16(codes[0]!.cp)
    .u16(codes[codes.length - 1]!.cp)
    .i16(1000)
    .i16(-250)
    .i16(0)
    .u16(1000)
    .u16(250)
    .u32(1)
    .u32(0)
    .i16(500)
    .i16(700)
    .u16(0)
    .u16(32)
    .u16(1);

  // cmap: one format 4 segment per character, then the closing 0xFFFF segment.
  const seg = [
    ...codes.map((c) => ({ start: c.cp, delta: (c.gid - c.cp) & 0xffff })),
    { start: 0xffff, delta: 1 },
  ];
  const segX2 = seg.length * 2;
  const pow = 2 ** Math.floor(Math.log2(seg.length));
  const sub = new Writer()
    .u16(4)
    .u16(16 + 8 * seg.length)
    .u16(0)
    .u16(segX2)
    .u16(pow * 2)
    .u16(Math.log2(pow))
    .u16(segX2 - pow * 2);
  for (const s of seg) sub.u16(s.start);
  sub.u16(0);
  for (const s of seg) sub.u16(s.start);
  for (const s of seg) sub.u16(s.delta);
  for (let i = 0; i < seg.length; i++) sub.u16(0);
  const cmap = new Writer().u16(0).u16(1).u16(3).u16(1).u32(12);
  for (const b of sub.bytes) cmap.u8(b);

  const postscript = family.replace(/[^A-Za-z0-9]/g, '');
  const strings: [number, string][] = [
    [1, family],
    [2, 'Regular'],
    [3, `${postscript}-Regular-test`],
    [4, family],
    [5, 'Version 1.0'],
    [6, postscript],
  ];
  const name = new Writer()
    .u16(0)
    .u16(strings.length)
    .u16(6 + 12 * strings.length);
  let offset = 0;
  for (const [id, s] of strings) {
    name
      .u16(3)
      .u16(1)
      .u16(0x409)
      .u16(id)
      .u16(s.length * 2)
      .u16(offset);
    offset += s.length * 2;
  }
  for (const [, s] of strings) for (const ch of s) name.u16(ch.charCodeAt(0));

  const post = new Writer()
    .u32(0x00030000)
    .u32(0)
    .i16(-100)
    .i16(50)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0);

  return writeSfnt(
    new Map([
      ['OS/2', os2.out()],
      ['cmap', cmap.out()],
      ['glyf', glyf.out()],
      ['head', head.out()],
      ['hhea', hhea.out()],
      ['hmtx', hmtx.out()],
      ['loca', loca.out()],
      ['maxp', maxp.out()],
      ['name', name.out()],
      ['post', post.out()],
    ]),
  );
}

/** The characters the test font draws. */
export const TEST_TRUETYPE_CHARACTERS = `${Object.keys(BITMAPS).join('')}O ÅÄ`;
