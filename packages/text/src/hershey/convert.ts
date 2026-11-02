// Hershey font data → Triya stroke-font JSON (M1-09, DEC-044). `scripts/build-fonts.ts` runs
// this over assets/fonts/hershey/hershey.jhf with the catalog and writes assets/fonts/*.json;
// a testkit test checks the committed files still match.
//
// No imports besides types, so the script can run it under Node type stripping.
//
// Hershey format (James Hurt's, as distributed): per glyph a 5-column number, a 3-column count
// of coordinate pairs, then the pairs as characters offset from 'R' (x right, y down). The
// first pair is the glyph's left and right edge; " R" lifts the pen. Long glyphs wrap onto
// following lines. Capitals stand from y = −12 to the baseline at y = 9 in every occidental
// font bundled here.

import type { HersheyFontDef } from './catalog';

export interface HersheyGlyph {
  readonly left: number;
  readonly right: number;
  /** Pen-down polylines in Hershey coordinates (y down). */
  readonly strokes: readonly (readonly (readonly [number, number])[])[];
}

/** One stroke-font glyph: advance, then polylines as flat x0, y0, x1, y1, … lists. */
export type StrokeGlyph = readonly [advance: number, strokes: readonly (readonly number[])[]];

/** A bundled stroke font as stored in assets/fonts (format version 1). */
export interface TriyaStrokeFont {
  readonly format: 'triya-stroke-font';
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  /** The acknowledgements the Hershey distribution terms require with the data. */
  readonly notice: string;
  /** Font units from the baseline to the top of capitals (text height maps to this). */
  readonly above: number;
  /** Font units below the baseline that the lowest glyph reaches. */
  readonly below: number;
  /** Code point (decimal) → glyph, in font units, y up from the baseline, x from the origin. */
  readonly glyphs: Readonly<Record<string, StrokeGlyph>>;
}

export const HERSHEY_NOTICE =
  'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. ' +
  'National Bureau of Standards. The format of the Font data in this distribution was ' +
  'originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, ' +
  'MA 01821. Converted for Triya CAD 2D (MIT); accents and characters past ASCII are ours.';

/** Font units per Hershey unit: halves, so the accents we add can sit between Hershey's grid. */
const UNIT = 2;
const BASELINE = 9;
const CAP_TOP = -12;

export function parseHershey(text: string): Map<number, HersheyGlyph> {
  const lines = text.split(/\r?\n/);
  const glyphs = new Map<number, HersheyGlyph>();
  for (let i = 0; i < lines.length;) {
    const line = lines[i++]!;
    if (!line.trim()) continue;
    const num = Number(line.slice(0, 5));
    const count = Number(line.slice(5, 8));
    if (!Number.isInteger(num) || !Number.isInteger(count) || count < 1) {
      throw new Error(`Hershey data: bad glyph header on line ${i}: ${JSON.stringify(line)}`);
    }
    let data = line.slice(8);
    while (data.length < count * 2 && i < lines.length) data += lines[i++];
    if (data.length < count * 2) throw new Error(`Hershey data: glyph ${num} is truncated`);
    const at = (k: number) => data.charCodeAt(k) - 82; // 'R' is 0
    const strokes: [number, number][][] = [];
    let current: [number, number][] = [];
    for (let k = 2; k < count * 2; k += 2) {
      if (data[k] === ' ' && data[k + 1] === 'R') {
        if (current.length) strokes.push(current);
        current = [];
      } else {
        current.push([at(k), at(k + 1)]);
      }
    }
    if (current.length) strokes.push(current);
    glyphs.set(num, { left: at(0), right: at(1), strokes });
  }
  return glyphs;
}

interface Ink {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function inkOf(strokes: readonly (readonly number[])[]): Ink | undefined {
  let ink: Ink | undefined;
  for (const s of strokes) {
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i]!;
      const y = s[i + 1]!;
      if (!ink) ink = { minX: x, minY: y, maxX: x, maxY: y };
      ink.minX = Math.min(ink.minX, x);
      ink.maxX = Math.max(ink.maxX, x);
      ink.minY = Math.min(ink.minY, y);
      ink.maxY = Math.max(ink.maxY, y);
    }
  }
  return ink;
}

function strokeGlyph(g: HersheyGlyph, slope = 0): StrokeGlyph {
  return [
    (g.right - g.left) * UNIT,
    g.strokes.map((s) =>
      s.flatMap(([x, y]) => {
        const fy = (BASELINE - y) * UNIT;
        // Adding 0 turns a rounded −0 into 0.
        return [Math.round((x - g.left) * UNIT + fy * slope) + 0, fy];
      }),
    ),
  ];
}

type Strokes = readonly (readonly number[])[];

/** Marks drawn above the letter's ink. */
type MarkAbove =
  | 'grave'
  | 'acute'
  | 'circumflex'
  | 'tilde'
  | 'ring'
  | 'caron'
  | 'macron'
  | 'breve'
  | 'doubleAcute'
  | 'commaAbove';

/**
 * How a letter is marked: a mark above it; a dot or two; a cedilla or ogonek hanging below;
 * or a stroke through it — `stroke` corner to corner (Ø), `bar` across the left of a bowl
 * letter (Ð Đ), `stemBar` across an ascender (đ ħ), `crossBar` across the whole letter (Ħ),
 * `lowBar` across the stem below the middle (Ŧ ŧ), `slash` up through the stem (Ł ł), and
 * `apostrophe`, the caron Czech and Slovak write beside a tall letter (ď ľ ť Ľ).
 */
type Accent =
  | MarkAbove
  | 'dot'
  | 'diaeresis'
  | 'cedilla'
  | 'ogonek'
  | 'stroke'
  | 'bar'
  | 'stemBar'
  | 'crossBar'
  | 'lowBar'
  | 'slash'
  | 'apostrophe';

/**
 * Accent marks we drew (MIT), in font units around the point above the base letter's ink
 * (x centred, y = 0 one and a half Hershey units above its top; y up).
 */
const ACCENTS: Readonly<Record<MarkAbove, Strokes>> = {
  grave: [[-3, 6, 2, 0]],
  acute: [[-2, 0, 3, 6]],
  circumflex: [[-5, 0, 0, 5, 5, 0]],
  tilde: [[-6, 0, -5, 2, -3, 3, -1, 2, 1, 1, 3, 0, 5, 1, 6, 3]],
  ring: [[0, 6, -2, 5, -3, 3, -2, 1, 0, 0, 2, 1, 3, 3, 2, 5, 0, 6]],
  caron: [[-5, 5, 0, 0, 5, 5]],
  macron: [[-6, 2, 6, 2]],
  breve: [[-5, 5, -4, 2, -2, 0, 2, 0, 4, 2, 5, 5]],
  doubleAcute: [
    [-5, 0, -2, 6],
    [1, 0, 4, 6],
  ],
  // ģ: Latvian writes the cedilla of a descending g as a turned comma above it.
  commaAbove: [[1, 0, -1, 2, -1, 4, 1, 6]],
};
/** Hangs from the baseline under the middle of the letter. */
const CEDILLA: Strokes = [[0, 0, 0, -3, 2, -4, 3, -6, 2, -8, -2, -9]];
/** Hangs from the baseline at the right of the letter. */
const OGONEK: Strokes = [[0, 0, -3, -3, -3, -6, -1, -8, 2, -8]];
/** A Hershey-sized dot (a diamond four font units across), centred on x, from y = 0 to 4. */
const dot = (x: number): number[] => [x - 2, 2, x, 4, x + 2, 2, x, 0, x - 2, 2];
const ACCENT_GAP = 3;

/** Letters built from a base letter and an accent: code point → base and accent. */
const ACCENTED: Readonly<Record<number, readonly [string, Accent]>> = (() => {
  const out: Record<number, readonly [string, Accent]> = {};
  // Latin-1 (M1-09).
  const add = (first: number, base: string, accents: readonly Accent[]) =>
    accents.forEach((a, i) => (out[first + i] = [base, a]));
  for (const [offset, upper] of [
    [0, true],
    [0x20, false],
  ] as const) {
    const c = (s: string) => (upper ? s : s.toLowerCase());
    add(0xc0 + offset, c('A'), ['grave', 'acute', 'circumflex', 'tilde', 'diaeresis', 'ring']);
    add(0xc7 + offset, c('C'), ['cedilla']);
    add(0xc8 + offset, c('E'), ['grave', 'acute', 'circumflex', 'diaeresis']);
    add(0xcc + offset, c('I'), ['grave', 'acute', 'circumflex', 'diaeresis']);
    add(0xd1 + offset, c('N'), ['tilde']);
    add(0xd2 + offset, c('O'), ['grave', 'acute', 'circumflex', 'tilde', 'diaeresis']);
    add(0xd8 + offset, c('O'), ['stroke']);
    add(0xd9 + offset, c('U'), ['grave', 'acute', 'circumflex', 'diaeresis']);
    add(0xdd + offset, c('Y'), ['acute']);
  }
  out[0xd0] = ['D', 'bar'];
  out[0xff] = ['y', 'diaeresis'];
  // Latin Extended-A (M1-59): capital at the code point, its small letter at the next one,
  // with the capital's accent unless a second one is given.
  // prettier-ignore
  const pairs: readonly (readonly [number, string, Accent, Accent?])[] = [
    [0x100, 'A', 'macron'], [0x102, 'A', 'breve'], [0x104, 'A', 'ogonek'],
    [0x106, 'C', 'acute'], [0x108, 'C', 'circumflex'], [0x10a, 'C', 'dot'], [0x10c, 'C', 'caron'],
    [0x10e, 'D', 'caron', 'apostrophe'], [0x110, 'D', 'bar', 'stemBar'],
    [0x112, 'E', 'macron'], [0x114, 'E', 'breve'], [0x116, 'E', 'dot'], [0x118, 'E', 'ogonek'],
    [0x11a, 'E', 'caron'],
    [0x11c, 'G', 'circumflex'], [0x11e, 'G', 'breve'], [0x120, 'G', 'dot'],
    [0x122, 'G', 'cedilla', 'commaAbove'],
    [0x124, 'H', 'circumflex'], [0x126, 'H', 'crossBar', 'stemBar'],
    [0x128, 'I', 'tilde'], [0x12a, 'I', 'macron'], [0x12c, 'I', 'breve'], [0x12e, 'I', 'ogonek'],
    [0x134, 'J', 'circumflex'], [0x136, 'K', 'cedilla'],
    [0x139, 'L', 'acute'], [0x13b, 'L', 'cedilla'], [0x13d, 'L', 'apostrophe'], [0x141, 'L', 'slash'],
    [0x143, 'N', 'acute'], [0x145, 'N', 'cedilla'], [0x147, 'N', 'caron'],
    [0x14c, 'O', 'macron'], [0x14e, 'O', 'breve'], [0x150, 'O', 'doubleAcute'],
    [0x154, 'R', 'acute'], [0x156, 'R', 'cedilla'], [0x158, 'R', 'caron'],
    [0x15a, 'S', 'acute'], [0x15c, 'S', 'circumflex'], [0x15e, 'S', 'cedilla'], [0x160, 'S', 'caron'],
    [0x162, 'T', 'cedilla'], [0x164, 'T', 'caron', 'apostrophe'], [0x166, 'T', 'lowBar'],
    [0x168, 'U', 'tilde'], [0x16a, 'U', 'macron'], [0x16c, 'U', 'breve'], [0x16e, 'U', 'ring'],
    [0x170, 'U', 'doubleAcute'], [0x172, 'U', 'ogonek'],
    [0x174, 'W', 'circumflex'], [0x176, 'Y', 'circumflex'],
    [0x179, 'Z', 'acute'], [0x17b, 'Z', 'dot'], [0x17d, 'Z', 'caron'],
  ];
  for (const [code, base, accent, small] of pairs) {
    out[code] = [base, accent];
    out[code + 1] = [base.toLowerCase(), small ?? accent];
  }
  out[0x130] = ['I', 'dot'];
  out[0x178] = ['Y', 'diaeresis'];
  // Cyrillic Ё and ё, in the faces that have Cyrillic.
  out[0x401] = ['Е', 'diaeresis'];
  out[0x451] = ['е', 'diaeresis'];
  return out;
})();

/** A diameter sign we drew (MIT) for %%c: a circle one cap height across, slashed at 45°. */
function diameterGlyph(above: number): StrokeGlyph {
  const r = Math.round(above / 3);
  const cx = r + 4;
  const cy = Math.round(above / 2);
  const circle: number[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    circle.push(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
  }
  return [2 * cx, [circle, [cx - r, cy - r, cx + r, cy + r]]];
}

const shift = (s: readonly number[], dx: number, dy: number): number[] =>
  s.map((v, i) => v + (i % 2 === 0 ? dx : dy));

/** A near-vertical segment of a letter, bottom (x0, y0) to top (x1, y1). */
interface Segment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The segments of a letter that lean at most 1 in 2, as stems do upright and in italics. */
function steep(strokes: Strokes): Segment[] {
  const out: Segment[] = [];
  for (const s of strokes) {
    for (let i = 2; i < s.length; i += 2) {
      const [ax, ay, bx, by] = [s[i - 2]!, s[i - 1]!, s[i]!, s[i + 1]!];
      if (ay === by || Math.abs(bx - ax) > Math.abs(by - ay) / 2) continue;
      out.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by } : { x0: bx, y0: by, x1: ax, y1: ay });
    }
  }
  return out;
}

/** x on a segment's line at height y. */
const xOn = (g: Segment, y: number): number => g.x0 + ((g.x1 - g.x0) * (y - g.y0)) / (g.y1 - g.y0);

/** A letter's stem, its longest near-vertical segment (the first of equals), as x at a height. */
function stemOf(strokes: Strokes): ((y: number) => number) | undefined {
  let best: Segment | undefined;
  for (const g of steep(strokes)) if (!best || g.y1 - g.y0 > best.y1 - best.y0) best = g;
  return best && ((y: number) => Math.round(xOn(best, y)));
}

/**
 * The parts of each polyline where `side(x, y) ≥ 0` (a half plane), cut where they cross its
 * edge; the cut points round to whole font units, as the SHX encoding needs.
 */
function clip(strokes: Strokes, side: (x: number, y: number) => number): number[][] {
  const out: number[][] = [];
  for (const s of strokes) {
    let current: number[] = [];
    const flush = () => {
      if (current.length >= 4) out.push(current);
      current = [];
    };
    for (let i = 0; i < s.length; i += 2) {
      const [x, y] = [s[i]!, s[i + 1]!];
      const v = side(x, y);
      if (i > 0) {
        const [px, py] = [s[i - 2]!, s[i - 1]!];
        const pv = side(px, py);
        if (pv >= 0 !== v >= 0) {
          const t = pv / (pv - v);
          const cut = [Math.round(px + t * (x - px)) + 0, Math.round(py + t * (y - py)) + 0];
          if (v >= 0) current = cut;
          else {
            current.push(...cut);
            flush();
          }
        }
      }
      if (v >= 0) current.push(x, y);
    }
    flush();
  }
  return out;
}

/** Strokes of a glyph without its dot (i, j): those not wholly above the x-height. */
const dotless = (strokes: Strokes, xTop: number): Strokes =>
  strokes.filter((s) => (inkOf([s])?.minY ?? 0) <= xTop + 1);

function accented(base: StrokeGlyph, accent: Accent, xTop: number, dropDot: boolean): StrokeGlyph {
  // i and j lose their dot under an accent above them.
  const strokes = dropDot ? dotless(base[1], xTop) : base[1];
  const ink = inkOf(strokes);
  if (!ink) return base;
  const cx = Math.round((ink.minX + ink.maxX) / 2);
  const stem = stemOf(strokes) ?? (() => cx);
  const above = (marks: Strokes) => marks.map((s) => shift(s, cx, ink.maxY + ACCENT_GAP));
  let advance = base[0];
  let marks: Strokes;
  switch (accent) {
    case 'stroke':
      marks = [[ink.minX - 2, ink.minY - 2, ink.maxX + 2, ink.maxY + 2]];
      break;
    case 'bar': {
      const y = Math.round((ink.minY + ink.maxY) / 2);
      marks = [[ink.minX - 3, y, ink.minX + Math.round((ink.maxX - ink.minX) * 0.45), y]];
      break;
    }
    case 'stemBar': {
      const y = Math.round((xTop + ink.maxY) / 2);
      marks = [[stem(y) - 5, y, stem(y) + 5, y]];
      break;
    }
    case 'crossBar': {
      const y = Math.round(ink.maxY * 0.72);
      marks = [[ink.minX - 2, y, ink.maxX + 2, y]];
      break;
    }
    case 'lowBar': {
      const y = Math.round(ink.maxY * 0.45);
      marks = [[stem(y) - 6, y, stem(y) + 6, y]];
      break;
    }
    case 'slash': {
      const [y0, y1] = [Math.round(ink.maxY * 0.3), Math.round(ink.maxY * 0.55)];
      marks = [[stem(y0) - 6, y0, stem(y1) + 6, y1]];
      break;
    }
    case 'apostrophe': {
      const x = stem(ink.maxY) + 5;
      marks = [[x, ink.maxY, x - 1, ink.maxY - 6]];
      advance = Math.max(advance, x + 4 + (base[0] - ink.maxX));
      break;
    }
    case 'cedilla':
      marks = CEDILLA.map((s) => shift(s, cx, 0));
      break;
    case 'ogonek':
      marks = OGONEK.map((s) => shift(s, ink.maxX - 2, 0));
      break;
    case 'diaeresis':
      marks = above([dot(-4), dot(4)]);
      break;
    case 'dot':
      marks = above([dot(0)]);
      break;
    default:
      marks = above(ACCENTS[accent]);
  }
  return [advance, [...strokes, ...marks]];
}

/** b drawn after a, a's advance to the right of a's origin (or `dx`). */
function after(a: StrokeGlyph, b: StrokeGlyph, dx = a[0]): StrokeGlyph {
  return [dx + b[0], [...a[1], ...b[1].map((s) => shift(s, dx, 0))]];
}

/** Turned half a turn about its ink box centre: ¡ from !, ¿ from ?. */
function turned(g: StrokeGlyph, top: number): StrokeGlyph {
  const ink = inkOf(g[1]);
  if (!ink) return g;
  // The turned mark hangs below the baseline and reaches the x-height, as in Spanish text.
  const dy = top - ink.maxY;
  return [
    g[0],
    g[1].map((s) =>
      s.map((v, i) => (i % 2 === 0 ? ink.minX + ink.maxX - v : ink.minY + ink.maxY - v + dy)),
    ),
  ];
}

/**
 * Letters built from other letters (M1-59), each only when its parts are in the font:
 * ı Ĳ ĳ ĸ Ŀ ŀ ŉ Ŋ ŋ Œ œ ſ (Latin Extended-A) and Æ æ ß Þ þ ð ¡ ¿ (Latin-1).
 */
function composed(
  glyph: (ch: string) => StrokeGlyph | undefined,
  xTop: number,
): Map<number, StrokeGlyph> {
  const out = new Map<number, StrokeGlyph>();
  const make = (code: number, parts: string, build: (...g: StrokeGlyph[]) => StrokeGlyph) => {
    const g = [...parts].map(glyph);
    if (g.every((p): p is StrokeGlyph => p !== undefined)) out.set(code, build(...g));
  };
  const inkBox = (g: StrokeGlyph) => inkOf(g[1]) ?? { minX: 0, minY: 0, maxX: g[0], maxY: 0 };

  // ı: i without its dot.
  make(0x131, 'i', (i) => [i[0], dotless(i[1], xTop)]);
  // Ĳ ĳ ŉ: two letters side by side.
  make(0x132, 'IJ', (a, b) => after(a, b));
  make(0x133, 'ij', (a, b) => after(a, b));
  make(0x149, "'n", (a, b) => after(a, b));
  // ĸ (kra): a small capital K, the capital scaled to the x-height.
  make(0x138, 'K', (k) => {
    const sy = xTop / ((BASELINE - CAP_TOP) * UNIT);
    const sx = 0.8;
    return [
      Math.round(k[0] * sx),
      k[1].map((s) => s.map((v, i) => Math.round(v * (i % 2 === 0 ? sx : sy)) + 0)),
    ];
  });
  // Ŀ ŀ: L and l with a middle dot right of the stem, at half the cap or x-height.
  make(0x13f, 'L', (l) => {
    const y = Math.round(inkBox(l).maxY / 2);
    const x = (stemOf(l[1]) ?? (() => inkBox(l).minX))(y) + 9;
    return [l[0], [...l[1], shift(dot(x), 0, y - 2)]];
  });
  make(0x140, 'l', (l) => {
    const ink = inkBox(l);
    const x = ink.maxX + 5;
    return [x + 2 + (l[0] - ink.maxX), [...l[1], shift(dot(x), 0, Math.round(xTop / 2) - 2)]];
  });
  // ſ (long s): f without its cross-bar, the flat strokes (a line, or a duplex outline two
  // units high) at the x-height. A script f, drawn in one stroke without a bar, stays as it is.
  const longS = (f: StrokeGlyph): StrokeGlyph => [
    f[0],
    f[1].filter((s) => {
      const ink = inkOf([s])!;
      const flat = ink.maxY - ink.minY <= 2 && ink.maxX - ink.minX >= 6;
      return !(flat && ink.maxY >= xTop - 4 && ink.minY <= xTop + 2);
    }),
  ];
  make(0x17f, 'f', longS);
  // Ŋ ŋ (eng): N and n whose right stem ends in the hook of a j below the baseline.
  const eng = (n: StrokeGlyph, j: StrokeGlyph): StrokeGlyph => {
    const hook = clip(dotless(j[1], xTop), (_, y) => -y);
    const top = hook.flatMap((s) => (s[1] === 0 ? [s[0]!] : s.at(-1) === 0 ? [s.at(-2)!] : []));
    const ink = inkBox(n);
    // The right stem's foot, or for a letter without stems its rightmost point on the baseline.
    const feet = steep(n[1])
      .filter((g) => g.y1 - g.y0 >= (ink.maxY - ink.minY) / 3)
      .map((g) => g.x0);
    if (!feet.length) {
      for (const s of n[1])
        for (let i = 0; i < s.length; i += 2) if (s[i + 1]! <= 1) feet.push(s[i]!);
    }
    if (!top.length || !feet.length) return n;
    const dx = Math.max(...feet) - Math.min(...top);
    return [n[0], [...n[1], ...hook.map((s) => shift(s, dx, 0))]];
  };
  make(0x14a, 'Nj', eng);
  make(0x14b, 'nj', eng);
  // Œ Æ: the left of O or A up to its middle (O) or apex (A), closed by the stem of an E.
  const ligature = (left: StrokeGlyph, e: StrokeGlyph, at: number, y: number): StrokeGlyph => {
    const dx = at - (stemOf(e[1]) ?? (() => inkBox(e).minX))(y);
    return [dx + e[0], [...clip(left[1], (x) => at - x), ...e[1].map((s) => shift(s, dx, 0))]];
  };
  make(0x152, 'OE', (o, e) => {
    const ink = inkBox(o);
    return ligature(o, e, Math.round((ink.minX + ink.maxX) / 2), Math.round(ink.maxY / 2));
  });
  make(0xc6, 'AE', (a, e) => {
    let apex = { x: 0, y: -Infinity };
    for (const s of a[1])
      for (let i = 0; i < s.length; i += 2)
        if (s[i + 1]! > apex.y) apex = { x: s[i]!, y: s[i + 1]! };
    return ligature(a, e, apex.x, apex.y);
  });
  // œ æ: o or a with an e drawn against its right side.
  const touching = (a: StrokeGlyph, e: StrokeGlyph): StrokeGlyph =>
    after(a, e, inkBox(a).maxX - inkBox(e).minX - 2);
  make(0x153, 'oe', touching);
  make(0xe6, 'ae', touching);
  // ß: the ligature of long s and round s it grew from, the s tucked against the stem.
  make(0xdf, 'fs', (f, s) => {
    const l = longS(f);
    const stem = (stemOf(l[1]) ?? (() => inkBox(l).maxX))(Math.round(xTop / 2));
    return after(l, s, stem + 2 - inkBox(s).minX);
  });
  // Þ: P with its bowl moved down to the middle of the stem.
  make(0xde, 'P', (p) => {
    const ink = inkBox(p);
    const stem = (stemOf(p[1]) ?? (() => ink.minX))(Math.round(ink.maxY / 2));
    const isBowl = (s: readonly number[]) => inkOf([s])!.maxX > stem + (ink.maxX - stem) * 0.4;
    const bowl = p[1].filter(isBowl);
    const down = Math.round((inkOf(bowl)?.minY ?? 0) / 2);
    return [p[0], p[1].map((s) => (isBowl(s) ? shift(s, 0, -down) : [...s]))];
  });
  // þ: p with its stem carried up to the ascender line of l.
  make(0xfe, 'pl', (p, l) => {
    const ascender = inkBox(l).maxY;
    const stems = steep(p[1]).filter((g) => g.y1 >= xTop - 2 && g.y1 - g.y0 > xTop / 2);
    return [
      p[0],
      [...p[1], ...stems.map((g) => [g.x1, g.y1, Math.round(xOn(g, ascender)), ascender])],
    ];
  });
  // ð (eth): o whose right side rises into a curved ascender, crossed by a bar.
  make(0xf0, 'ol', (o, l) => {
    const ink = inkBox(o);
    const asc = inkBox(l).maxY;
    const w = ink.maxX - ink.minX;
    const at = (fx: number, fy: number) => [
      Math.round(ink.minX + fx * w),
      Math.round(ink.maxY + fy * (asc - ink.maxY)),
    ];
    const rise = [...at(0.95, -0.3), ...at(0.95, 0.2), ...at(0.75, 0.65), ...at(0.3, 1)];
    return [o[0], [...o[1], rise, [...at(0.3, 0.45), ...at(0.95, 0.7)]]];
  });
  // ¡ ¿: ! and ? turned, hanging from the x-height.
  make(0xa1, '!', (g) => turned(g, xTop));
  make(0xbf, '?', (g) => turned(g, xTop));
  return out;
}

/** Builds one bundled font from the Hershey glyphs. */
export function buildStrokeFont(
  def: HersheyFontDef,
  hershey: ReadonlyMap<number, HersheyGlyph>,
): TriyaStrokeFont {
  const glyphs = new Map<number, StrokeGlyph>();
  const take = (code: number, num: number, slope = 0) => {
    const g = hershey.get(num);
    if (!g) throw new Error(`${def.name}: Hershey glyph ${num} (for U+${hex(code)}) is missing`);
    glyphs.set(code, strokeGlyph(g, slope));
  };
  if (def.ascii.length !== 95) throw new Error(`${def.name}: needs 95 ASCII glyphs`);
  def.ascii.forEach((num, i) => take(32 + i, num));
  for (const [code, num] of Object.entries(def.extra)) take(Number(code), num);
  if (def.slanted) {
    for (const [code, num] of Object.entries(def.slanted.glyphs))
      take(Number(code), num, def.slanted.slope);
  }

  const above = (BASELINE - CAP_TOP) * UNIT;
  const xTop = inkOf(glyphs.get(0x78)![1])!.maxY; // 'x'
  for (const [code, [base, accent]] of Object.entries(ACCENTED)) {
    const b = glyphs.get(base.codePointAt(0)!);
    const dropDot = (base === 'i' || base === 'j') && accent !== 'ogonek';
    if (b && !glyphs.has(Number(code)))
      glyphs.set(Number(code), accented(b, accent, xTop, dropDot));
  }
  const letter = (ch: string) => glyphs.get(ch.codePointAt(0)!);
  for (const [code, g] of composed(letter, xTop)) if (!glyphs.has(code)) glyphs.set(code, g);
  const diameter = diameterGlyph(above);
  for (const code of [0x2205, 0x2300]) if (!glyphs.has(code)) glyphs.set(code, diameter);

  let below = 0;
  for (const [, strokes] of glyphs.values()) below = Math.max(below, -(inkOf(strokes)?.minY ?? 0));
  return {
    format: 'triya-stroke-font',
    version: 1,
    name: def.name,
    description: def.description,
    notice: HERSHEY_NOTICE,
    above,
    below,
    glyphs: Object.fromEntries(
      [...glyphs].sort(([a], [b]) => a - b).map(([c, g]) => [String(c), g]),
    ),
  };
}

const hex = (code: number) => code.toString(16).toUpperCase().padStart(4, '0');

/** The font as committed: stable key order, one glyph per line, so diffs stay readable. */
export function formatStrokeFont(font: TriyaStrokeFont): string {
  const head = { ...font, glyphs: undefined };
  const lines = Object.entries(font.glyphs).map(([c, g]) => `    "${c}": ${JSON.stringify(g)}`);
  const fields = Object.entries(head)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${fields.join(',\n')},\n  "glyphs": {\n${lines.join(',\n')}\n  }\n}\n`;
}
