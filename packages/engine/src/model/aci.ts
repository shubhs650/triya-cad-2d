// True colours as AutoCAD's colour index (moved from @triya/io's mappers, M2-30 part 3: the
// dimension health check on the render side needs it too).

// The ACI AutoCAD stores for a true colour: in DXF 62 beside 420, in DIMSTYLE groups 176–178
// (which hold no true colour), and in R2000 saves (M1-55). It is the nearest entry by squared RGB
// distance in the palette below, lowest index on a tie, over 1–255. This palette's hue rows have
// the values 1, 0.8, 0.6, 0.5 and 0.3 of 255 (the table published as AutoCAD's, e.g. ACI 12 =
// 204,0,0), each at full (even index) and half (odd index) saturation. It reproduces every one of
// the 21 distinct true colours AutoCAD wrote with an ACI in the public corpus
// (true-color.corpus.test.ts); the 0.65/0.5/0.3/0.15 rows acad-ts and `aciRgb` use get 7 of them
// wrong (M1-57). The greys 250–254 are the published table's; no corpus colour tests them.
const LOOKUP_VALUES = [1, 0.8, 0.6, 0.5, 0.3];
const LOOKUP_GREYS = [51, 80, 105, 130, 190, 255];
const LOOKUP_NAMED = [
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
  [192, 192, 192],
] as const;

function lookupRgb(index: number): readonly [number, number, number] {
  if (index < 10) return LOOKUP_NAMED[index - 1]!;
  if (index >= 250) {
    const g = LOOKUP_GREYS[index - 250]!;
    return [g, g, g];
  }
  const hue = (Math.floor(index / 10) - 1) * 15;
  const v = 255 * LOOKUP_VALUES[Math.floor((index % 10) / 2)]!;
  const min = index % 2 ? v / 2 : 0;
  const f = (hue % 60) / 60;
  const up = min + (v - min) * f;
  const down = v - (v - min) * f;
  const sectors = [
    [v, up, min],
    [down, v, min],
    [min, v, up],
    [min, down, v],
    [up, min, v],
    [v, min, down],
  ] as const;
  const [r, g, b] = sectors[Math.floor(hue / 60)]!;
  return [Math.floor(r), Math.floor(g), Math.floor(b)];
}

const LOOKUP: readonly (readonly [number, number, number])[] = Array.from({ length: 255 }, (_, i) =>
  lookupRgb(i + 1),
);

/** The ACI (1–255) AutoCAD writes for the true colour `r, g, b`. */
export function aciOfTrueColor(r: number, g: number, b: number): number {
  let best = 1;
  let bestDist = Infinity;
  LOOKUP.forEach(([pr, pg, pb], i) => {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i + 1;
    }
  });
  return best;
}
