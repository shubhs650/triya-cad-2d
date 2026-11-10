// Which way a canvas colour reads (M2-20): ACI 7, the AutoSnap marker and the tracking paths
// follow the background, white or bright on a dark one and black or deep on a light one, as
// AutoCAD's ACI 7 does (UI_SPEC.md §6). A background is dark when its relative luminance
// (WCAG 2.x, sRGB) is under the middle grey's.
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of `#rrggbb` (0 black … 1 white); undefined for other text. */
export function luminance(hex: string): number | undefined {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return undefined;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Whether white contrasts more than black with `hex`: the luminance where the two contrast
 * ratios are equal, (L + 0.05)² = 1.05 × 0.05, is about 0.179.
 */
export function isDarkColor(hex: string): boolean {
  const l = luminance(hex);
  return l === undefined ? true : l < Math.sqrt(1.05 * 0.05) - 0.05;
}

/** What ACI 7 draws in on `background`. */
export const foregroundOn = (background: string): string =>
  isDarkColor(background) ? '#ffffff' : '#000000';

/** The AutoSnap marker and the tracking paths on a dark and on a light background. */
export const MARKER_COLOR = { dark: '#ffd400', light: '#b06d00' } as const;
export const TRACK_COLOR = { dark: '#7fd7ff', light: '#1060c0' } as const;

/** The drafting aids' colours as drawn (M2-20 part 2). */
export interface InterfaceColours {
  /** The crosshairs, the rubber band and the ZOOM window. */
  readonly crosshair: string;
  /** The AutoSnap marker. */
  readonly autosnap: string;
  /** Polar and object snap tracking paths and acquired points (AutoCAD's AutoTrack vector). */
  readonly autotrack: string;
}

/**
 * AutoCAD's OPTIONS > Display > Colors keeps Crosshairs, Autosnap marker and Autotrack vector
 * per context; Triya keeps one each, Automatic (undefined) following the canvas behind them.
 */
export function interfaceColours(c: {
  readonly background: string;
  readonly crosshair?: string | undefined;
  readonly autosnap?: string | undefined;
  readonly autotrack?: string | undefined;
}): InterfaceColours {
  const dark = isDarkColor(c.background);
  return {
    crosshair: c.crosshair ?? foregroundOn(c.background),
    autosnap: c.autosnap ?? (dark ? MARKER_COLOR.dark : MARKER_COLOR.light),
    autotrack: c.autotrack ?? (dark ? TRACK_COLOR.dark : TRACK_COLOR.light),
  };
}

/** Half the cursor image; 31 px keeps within the 32 px every browser takes for a cursor. */
const HALF = 15;

/**
 * The crosshairs as a CSS cursor in `color`: a cross with a faint halo so it reads on anything.
 * The system crosshair stands in where a browser refuses the image. One image for every prompt:
 * AutoCAD adds a pickbox at `Command:`, but swapping cursor images as prompts change cost Chrome
 * enough main-thread time to delay the next prompt behind typed keys (CI, PR #256).
 */
export function crosshairCursor(color: string): string {
  const halo = isDarkColor(color) ? '#ffffff' : '#000000';
  const n = 2 * HALF + 1;
  const c = HALF + 0.5;
  const cross = `M0 ${c}H${n}M${c} 0V${n}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}">` +
    `<g stroke="${halo}" stroke-opacity="0.45" stroke-width="3"><path d="${cross}"/></g>` +
    `<g stroke="${color}" stroke-width="1"><path d="${cross}"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${HALF} ${HALF}, crosshair`;
}
