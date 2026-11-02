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

function strokeGlyph(g: HersheyGlyph): StrokeGlyph {
  return [
    (g.right - g.left) * UNIT,
    g.strokes.map((s) => s.flatMap(([x, y]) => [(x - g.left) * UNIT, (BASELINE - y) * UNIT])),
  ];
}

type Accent =
  'grave' | 'acute' | 'circumflex' | 'tilde' | 'diaeresis' | 'ring' | 'cedilla' | 'stroke' | 'bar';

/**
 * Accent marks we drew (MIT), in font units around the point above the base letter's ink
 * (x centred, y = 0 one and a half Hershey units above its top; y up). Cedilla hangs from the
 * baseline instead; stroke and bar are placed from the letter's ink box.
 */
const ACCENTS: Readonly<
  Record<
    'grave' | 'acute' | 'circumflex' | 'tilde' | 'ring' | 'cedilla',
    readonly (readonly number[])[]
  >
> = {
  grave: [[-3, 6, 2, 0]],
  acute: [[-2, 0, 3, 6]],
  circumflex: [[-5, 0, 0, 5, 5, 0]],
  tilde: [[-6, 0, -5, 2, -3, 3, -1, 2, 1, 1, 3, 0, 5, 1, 6, 3]],
  ring: [[0, 6, -2, 5, -3, 3, -2, 1, 0, 0, 2, 1, 3, 3, 2, 5, 0, 6]],
  cedilla: [[0, 0, 0, -3, 2, -4, 3, -6, 2, -8, -2, -9]],
};
/** A Hershey-sized dot (a diamond two font units across each way), for the diaeresis. */
const dot = (x: number): number[] => [x - 2, 2, x, 4, x + 2, 2, x, 0, x - 2, 2];
const ACCENT_GAP = 3;

/** Latin-1 letters built from a base letter and an accent. */
const ACCENTED: Readonly<Record<number, readonly [string, Accent]>> = (() => {
  const out: Record<number, readonly [string, Accent]> = {};
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

function accented(base: StrokeGlyph, accent: Accent, dotlessTop: number | undefined): StrokeGlyph {
  // i and j lose their dot under an accent: drop strokes wholly above the x-height.
  const strokes =
    dotlessTop === undefined
      ? base[1]
      : base[1].filter((s) => (inkOf([s])?.minY ?? 0) <= dotlessTop);
  const ink = inkOf(strokes);
  if (!ink) return base;
  const cx = Math.round((ink.minX + ink.maxX) / 2);
  let marks: (readonly number[])[];
  if (accent === 'stroke') {
    marks = [[ink.minX - 2, ink.minY - 2, ink.maxX + 2, ink.maxY + 2]];
  } else if (accent === 'bar') {
    const y = Math.round((ink.minY + ink.maxY) / 2);
    marks = [[ink.minX - 3, y, ink.minX + Math.round((ink.maxX - ink.minX) * 0.45), y]];
  } else if (accent === 'cedilla') {
    marks = ACCENTS.cedilla.map((s) => shift(s, cx, 0));
  } else if (accent === 'diaeresis') {
    marks = [dot(-4), dot(4)].map((s) => shift(s, cx, ink.maxY + ACCENT_GAP));
  } else {
    marks = ACCENTS[accent].map((s) => shift(s, cx, ink.maxY + ACCENT_GAP));
  }
  return [base[0], [...strokes, ...marks]];
}

/** Builds one bundled font from the Hershey glyphs. */
export function buildStrokeFont(
  def: HersheyFontDef,
  hershey: ReadonlyMap<number, HersheyGlyph>,
): TriyaStrokeFont {
  const glyphs = new Map<number, StrokeGlyph>();
  const take = (code: number, num: number) => {
    const g = hershey.get(num);
    if (!g) throw new Error(`${def.name}: Hershey glyph ${num} (for U+${hex(code)}) is missing`);
    glyphs.set(code, strokeGlyph(g));
  };
  if (def.ascii.length !== 95) throw new Error(`${def.name}: needs 95 ASCII glyphs`);
  def.ascii.forEach((num, i) => take(32 + i, num));
  for (const [code, num] of Object.entries(def.extra)) take(Number(code), num);

  const above = (BASELINE - CAP_TOP) * UNIT;
  const xTop = inkOf(glyphs.get(0x78)![1])!.maxY; // 'x'
  for (const [code, [base, accent]] of Object.entries(ACCENTED)) {
    const b = glyphs.get(base.codePointAt(0)!);
    if (b && !glyphs.has(Number(code)))
      glyphs.set(Number(code), accented(b, accent, base === 'i' ? xTop + 1 : undefined));
  }
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
