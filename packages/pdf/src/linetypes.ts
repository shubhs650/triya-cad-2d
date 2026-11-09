// The 31 plot style linetypes a CTB or STB style can plot with instead of the object's own
// (Plot Style Table Editor, "Linetype": index 0–30, 31 is "Use object linetype"). AutoCAD
// lists their names but publishes no dash lengths, so the patterns are authored here
// (M2-15 left them to this task):
// - The ISO types (17–30) are ISO 128-20's line types 02–15, whose elements are multiples of
//   the line width d: long dash 24d, dash 12d, short dash 6d, dot 0.5d, gap 3d (18d in type
//   03). AutoCAD's ISO linetypes are built the same way, so they scale with the lineweight.
// - The others (1–16) are ours, in units of an eighth of the style's line pattern size
//   (`linepattern_size`, inches; 0.5 in a new table), times the table's global scale factor
//   when it applies it to non-ISO linetypes. Short, medium and long dashes are 2, 4 and 8
//   units, X2 doubles a pattern, gaps are 1.5 units, as their names read to a drafter.
// Adaptive adjustment ("adjusts the scale of the linetype to complete the linetype pattern")
// stretches the pattern so each subpath holds a whole number of repetitions.

/** One linetype: dashes (> 0), dots (0) and gaps (< 0) in its unit. */
export interface PlotLinetypeDef {
  readonly name: string;
  readonly iso: boolean;
  readonly elements: readonly number[];
}

const nonIso = (name: string, elements: number[]): PlotLinetypeDef => ({
  name,
  iso: false,
  elements,
});
const iso = (name: string, elements: number[]): PlotLinetypeDef => ({ name, iso: true, elements });

// ISO 128-20 elements in multiples of d.
const LD = 24;
const DA = 12;
const SD = 6;
const DOT = 0.5;
const G = -3;

/** By index, as AutoCAD's Plot Style Table Editor lists them. */
export const PLOT_LINETYPES: readonly PlotLinetypeDef[] = [
  nonIso('Solid', []),
  nonIso('Dashed', [6, -2]),
  nonIso('Dotted', [0, -1]),
  nonIso('Dash Dot', [5, -1.5, 0, -1.5]),
  nonIso('Short Dash', [2, -1]),
  nonIso('Medium Dash', [4, -1.5]),
  nonIso('Long Dash', [8, -2]),
  nonIso('Short Dash X2', [4, -2]),
  nonIso('Medium Dash X2', [8, -3]),
  nonIso('Long Dash X2', [16, -4]),
  nonIso('Medium Long Dash', [8, -1.5, 4, -1.5]),
  nonIso('Medium Dash Short Dash Short Dash', [4, -1.5, 2, -1.5, 2, -1.5]),
  nonIso('Long Dash Short Dash', [8, -1.5, 2, -1.5]),
  nonIso('Long Dash Dot Dot', [8, -1.5, 0, -1.5, 0, -1.5]),
  nonIso('Long Dash Dot', [8, -1.5, 0, -1.5]),
  nonIso('Medium Dash Dot Short Dash Dot', [4, -1.5, 0, -1.5, 2, -1.5, 0, -1.5]),
  nonIso('Sparse Dot', [0, -4]),
  iso('ISO Dash', [DA, G]),
  iso('ISO Dash Space', [DA, -18]),
  iso('ISO Long Dash Dot', [LD, G, DOT, G]),
  iso('ISO Long Dash Double Dot', [LD, G, DOT, G, DOT, G]),
  iso('ISO Long Dash Triple Dot', [LD, G, DOT, G, DOT, G, DOT, G]),
  iso('ISO Dot', [DOT, G]),
  iso('ISO Long Dash Short Dash', [LD, G, SD, G]),
  iso('ISO Long Dash Double Short Dash', [LD, G, SD, G, SD, G]),
  iso('ISO Dash Dot', [DA, G, DOT, G]),
  iso('ISO Double Dash Dot', [DA, G, DA, G, DOT, G]),
  iso('ISO Dash Double Dot', [DA, G, DOT, G, DOT, G]),
  iso('ISO Double Dash Double Dot', [DA, G, DA, G, DOT, G, DOT, G]),
  iso('ISO Dash Triple Dot', [DA, G, DOT, G, DOT, G, DOT, G]),
  iso('ISO Double Dash Triple Dot', [DA, G, DA, G, DOT, G, DOT, G, DOT, G]),
];

/** Points per inch and per millimetre. */
export const POINTS_PER_INCH = 72;
export const POINTS_PER_MM = 72 / 25.4;

/**
 * ISO 128-20's thinnest line width, mm: the d an ISO pattern takes for a thinner line (a 0 or
 * 0.05 mm pen would otherwise shrink the pattern to dust). Ours: AutoCAD does not say.
 */
const ISO_MIN_D = 0.13;

export interface PlotDashOptions {
  /** The style's line pattern size, inches (0.5 in a new table). */
  readonly patternSize: number;
  /** The line's width on paper, mm. */
  readonly lineweight: number;
  /** The table's scale factor when it applies to non-ISO linetypes, else 1. */
  readonly nonIsoScale?: number;
  /**
   * Whether the pen draws a zero-length dash: with butt ends a dot needs a length of its
   * own, the line's width (at least half a point), or it would not show.
   */
  readonly dotsVisible: boolean;
}

/**
 * The dash array, in points, of plot style linetype `index` (dash, gap, dash, gap, …, as PDF's
 * `d` operator takes it), or an empty array for Solid and an unknown index.
 */
export function plotDashes(index: number, o: PlotDashOptions): number[] {
  const def = PLOT_LINETYPES[index];
  if (!def || def.elements.length === 0) return [];
  const unit = def.iso
    ? Math.max(o.lineweight, ISO_MIN_D) * POINTS_PER_MM
    : (o.patternSize * (o.nonIsoScale ?? 1) * POINTS_PER_INCH) / 8;
  const dot = o.dotsVisible ? 0 : Math.max(o.lineweight * POINTS_PER_MM, 0.5);
  const out: number[] = [];
  for (const e of def.elements) {
    const len = e === 0 ? dot : Math.abs(e) * unit;
    // PDF wants dash, gap, dash, …: elements alternate already; a dot that gained a length
    // stays a dash.
    out.push(len);
  }
  return out;
}

/** One repetition of a dash array, points. */
export const dashPeriod = (dashes: readonly number[]): number => dashes.reduce((s, v) => s + v, 0);

/**
 * Adaptive adjustment: the dash array stretched or squeezed so a subpath `length` points long
 * holds a whole number of repetitions (at least one).
 */
export function adaptDashes(dashes: readonly number[], length: number): number[] {
  const period = dashPeriod(dashes);
  if (period <= 0 || length <= 0) return [...dashes];
  const count = Math.max(1, Math.round(length / period));
  const k = length / (count * period);
  return dashes.map((d) => d * k);
}
