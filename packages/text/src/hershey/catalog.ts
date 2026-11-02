// The bundled stroke fonts (M1-09, DEC-044): which Hershey glyphs each one draws for which
// character, and which SHX font names each one stands in for. Hershey data only; LibreCAD
// fonts are GPL and stay out (issue #32).
//
// This file has no imports, so `scripts/build-fonts.ts` can run it under Node type stripping.
//
// The glyph numbers are the original Hershey occidental numbers (assets/fonts/hershey). The
// printable-ASCII layouts are the ones the Hershey distribution's own mapped fonts use
// (rowmans, rowmand, rowmant, scripts, scriptc, and the complex, italic and gothic sets),
// checked glyph for glyph against the occidental file. Everything past ASCII is ours:
// Unicode Greek where Hershey has the weight, a few symbols, and the Latin-1 accented letters
// built from a base letter and an accent (`ACCENTED`).

/** Numbers n, n+1, …, n+count−1. */
function run(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

/** Hershey's underscore: a plain baseline-low rule (999), the same in every set. */
const UNDERSCORE = 999;

/** Unicode Greek capitals and small letters in alphabetical order (no U+03A2). */
const GREEK_CAPITALS = [...run(0x391, 17), ...run(0x3a3, 7)];
const GREEK_SMALL = [...run(0x3b1, 17), ...run(0x3c3, 7)];

/** Greek letters at their Unicode code points, from a Hershey Greek set's first capital and small letter. */
function greek(capital: number, small: number): Record<number, number> {
  const out: Record<number, number> = {};
  GREEK_CAPITALS.forEach((c, i) => (out[c] = capital + i));
  GREEK_SMALL.forEach((c, i) => (out[c] = small + i));
  out[0x3c2] = small + 17; // final sigma draws as sigma
  out[0xb5] = small + 11; // micro sign draws as mu
  return out;
}

/** Simplex-weight symbols: ° ± × ÷ · and §. */
const SIMPLEX_SYMBOLS = { 0xb0: 718, 0xb1: 2233, 0xd7: 727, 0xf7: 2237, 0xb7: 729, 0xa7: 2276 };
/** The same symbols from the complex set, for the heavier fonts. */
const COMPLEX_SYMBOLS = { 0xb0: 2218, 0xb1: 2233, 0xd7: 2235, 0xf7: 2237, 0xb7: 2236, 0xa7: 2276 };

export interface HersheyFontDef {
  /** The bundled font's name, as FontBook knows it. */
  readonly name: string;
  /** What it is, for the font file and the health report. */
  readonly description: string;
  /** Hershey glyph numbers for code points 32–126, in order. */
  readonly ascii: readonly number[];
  /** Further code points and their Hershey glyph numbers. */
  readonly extra: Readonly<Record<number, number>>;
}

export const HERSHEY_FONTS: readonly HersheyFontDef[] = [
  {
    name: 'oet-simplex',
    description: 'Hershey Roman Simplex, with Hershey Greek Simplex',
    // prettier-ignore
    ascii: [
      699, 714, 717, 733, 719, 2271, 734, 731, 721, 722, 2219, 725, 711, 724, 710, 720,
      ...run(700, 10), 712, 713, 2241, 726, 2242, 715, 2273, ...run(501, 26), 2223, 804, 2224,
      2262, UNDERSCORE, 730, ...run(601, 26), 2225, 723, 2226, 2246,
    ],
    extra: { ...SIMPLEX_SYMBOLS, ...greek(527, 627) },
  },
  {
    name: 'oet-duplex',
    description: 'Hershey Roman Duplex',
    // prettier-ignore
    ascii: [
      2699, 2714, 2728, 2275, 2719, 2271, 2718, 2717, 2721, 2722, 2723, 2725, 2711, 2724, 2710,
      2720, ...run(2700, 10), 2712, 2713, 2241, 2726, 2242, 2715, 2273, ...run(2501, 26), 2223, 804,
      2224, 2262, UNDERSCORE, 2716, ...run(2601, 26), 2225, 2229, 2226, 2246,
    ],
    extra: COMPLEX_SYMBOLS,
  },
  {
    name: 'oet-complex',
    description: 'Hershey Roman Complex, with Hershey Greek Complex',
    // prettier-ignore
    ascii: [
      699, 2214, 2728, 733, 2274, 2271, 2272, 2216, 1403, 1404, 728, 725, 1211, 724, 1210, 720,
      ...run(2200, 10), 1212, 1213, 2241, 726, 2242, 2215, 2273, ...run(2001, 26), 1405, 804, 1406,
      2247, UNDERSCORE, 2249, ...run(2101, 26), 1407, 723, 1408, 2246,
    ],
    extra: { ...COMPLEX_SYMBOLS, ...greek(2027, 2127) },
  },
  {
    name: 'oet-triplex',
    description: 'Hershey Roman Triplex',
    // prettier-ignore
    ascii: [
      3199, 3214, 3228, 2275, 3219, 2271, 3218, 3217, 3221, 3222, 3223, 3225, 3211, 3224, 3210,
      3220, ...run(3200, 10), 3212, 3213, 2241, 3226, 2242, 3215, 2273, ...run(3001, 26), 2223, 804,
      2224, 2262, UNDERSCORE, 3216, ...run(3101, 26), 2225, 2229, 2226, 2246,
    ],
    extra: COMPLEX_SYMBOLS,
  },
  {
    name: 'oet-italic',
    description: 'Hershey Italic Complex',
    // prettier-ignore
    ascii: [
      699, 2764, 2778, 733, 2769, 2271, 2272, 2777, 2771, 2772, 728, 725, 2761, 724, 2760, 720,
      ...run(2750, 10), 2762, 2763, 2241, 726, 2242, 2765, 2273, ...run(2051, 26), 1405, 804, 1406,
      2247, UNDERSCORE, 2249, ...run(2151, 26), 1407, 723, 1408, 2246,
    ],
    extra: COMPLEX_SYMBOLS,
  },
  {
    name: 'oet-script',
    description: 'Hershey Script Simplex',
    // prettier-ignore
    ascii: [
      699, 2764, 2778, 733, 2769, 2271, 2768, 2767, 2771, 2772, 2773, 725, 2761, 724, 710, 2770,
      ...run(2750, 10), 2762, 2763, 2241, 726, 2242, 2765, 2273, ...run(551, 26), 2223, 804, 2224,
      2262, UNDERSCORE, 2766, ...run(651, 26), 2225, 723, 2226, 2246,
    ],
    extra: SIMPLEX_SYMBOLS,
  },
  {
    name: 'oet-scriptc',
    description: 'Hershey Script Complex',
    // prettier-ignore
    ascii: [
      2749, 2764, 2778, 2275, 2769, 2271, 2768, 2767, 2771, 2772, 2773, 2775, 2761, 2774, 2760,
      2770, ...run(2750, 10), 2762, 2763, 2241, 2776, 2242, 2765, 2273, ...run(2551, 26), 2223, 804,
      2224, 2262, UNDERSCORE, 2766, ...run(2651, 26), 2225, 2229, 2226, 2246,
    ],
    extra: COMPLEX_SYMBOLS,
  },
  ...(
    [
      ['oet-gothice', 'Hershey Gothic English', 3501, 3601],
      ['oet-gothicg', 'Hershey Gothic German', 3301, 3401],
      ['oet-gothici', 'Hershey Gothic Italian', 3801, 3901],
    ] as const
  ).map(([name, description, capital, small]) => ({
    name,
    description,
    // prettier-ignore
    ascii: [
      699, 3714, 2728, 733, 3719, 2271, 3718, 2727, 3221, 3222, 2723, 2725, 3711, 724, 3710, 2720,
      ...run(3700, 10), 3712, 3713, 2241, 2726, 2242, 3715, 2273, ...run(capital, 26), 1405, 804,
      1406, 2247, UNDERSCORE, 2249, ...run(small, 26), 1407, 723, 1408, 2246,
    ],
    extra: COMPLEX_SYMBOLS,
  })),
];

/** The font every text falls back to when nothing closer is loaded (ARCHITECTURE.md §8). */
export const DEFAULT_BUNDLED_FONT = 'oet-simplex';

/**
 * SHX font names (file name without folder or extension, lower case) → the bundled font that
 * draws them when the drawing's own font is not loaded. Each maps to the nearest Hershey
 * design: AutoCAD's Roman, Italic, Script and Gothic fonts descend from Hershey's, and the
 * ISO and TXT fonts are single-stroke sans faces closest to Roman Simplex. Widths still
 * differ from the real fonts, so the health report lists every substitution.
 */
export const SHX_EQUIVALENTS: Readonly<Record<string, string>> = {
  romans: 'oet-simplex',
  simplex: 'oet-simplex',
  txt: 'oet-simplex',
  monotxt: 'oet-simplex',
  isocp: 'oet-simplex',
  isocp2: 'oet-simplex',
  isocp3: 'oet-simplex',
  isoct: 'oet-simplex',
  isoct2: 'oet-simplex',
  isoct3: 'oet-simplex',
  isocpeur: 'oet-simplex',
  isocteur: 'oet-simplex',
  romand: 'oet-duplex',
  romanc: 'oet-complex',
  romant: 'oet-triplex',
  italic: 'oet-italic',
  italicc: 'oet-italic',
  italict: 'oet-italic',
  scripts: 'oet-script',
  scriptc: 'oet-scriptc',
  gothice: 'oet-gothice',
  gothicg: 'oet-gothicg',
  gothici: 'oet-gothici',
};
