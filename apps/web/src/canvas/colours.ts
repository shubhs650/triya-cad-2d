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

/**
 * Dynamic dimensional constraints (M9-03 part 4): AutoCAD draws them in a colour of their own,
 * not their objects'; a light blue on a dark background, a deep one on a light background.
 */
export const CONSTRAINT_COLOR = { dark: '#5ab4ff', light: '#1565c0' } as const;

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

/**
 * MATCHPROP's paintbrush (M3-16; AutoCAD 2024 Help, "MATCHPROP (Command)": "The cursor changes
 * to a Match Properties paintbrush"), in the quarter above and right of the crosshairs, upright
 * whatever their turn: a handle down to the left and bristles at its end, haloed as they are.
 */
function paintbrush(color: string, halo: string): string {
  const handle = 'M30 1L24.5 6.5';
  const bristles = 'M23 6L26 9L22.5 12.5Q20 14 18.5 12.5Q19 10.5 19.5 9.5Z';
  return (
    `<g class="paintbrush">` +
    `<g stroke="${halo}" stroke-opacity="0.45" stroke-width="4" fill="${halo}" fill-opacity="0.45">` +
    `<path d="${handle}"/><path d="${bristles}"/></g>` +
    `<path d="${handle}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="${bristles}" fill="${color}"/></g>`
  );
}

/**
 * The lock by the crosshairs over a locked table cell (M4-16 part 11), in the corner MATCHPROP's
 * paintbrush takes: a shackle over a body with a keyhole, haloed as the crosshairs are.
 */
function padlock(color: string, halo: string): string {
  const shackle = 'M21.5 7.5V5.5A3 3 0 0 1 27.5 5.5V7.5';
  const body = 'M19.5 7.5H29.5V14.5H19.5Z';
  return (
    `<g class="padlock">` +
    `<path d="${shackle}" fill="none" stroke="${halo}" stroke-opacity="0.45" stroke-width="3.5"/>` +
    `<path d="${body}" fill="${halo}" fill-opacity="0.45" stroke="${halo}" stroke-opacity="0.45" stroke-width="2"/>` +
    `<path d="${shackle}" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<path d="${body}" fill="${color}"/>` +
    `<path d="M24.5 10V12" stroke="${halo}" stroke-width="1.5" stroke-linecap="round"/></g>`
  );
}

/** Half the cursor image; 31 px keeps within the 32 px every browser takes for a cursor. */
const HALF = 15;

/**
 * The crosshairs as a CSS cursor in `color`: a cross with a faint halo so it reads on anything.
 * The system crosshair stands in where a browser refuses the image. One image for every prompt:
 * AutoCAD adds a pickbox at `Command:`, but swapping cursor images as prompts change cost Chrome
 * enough main-thread time to delay the next prompt behind typed keys (CI, PR #256). `badge`
 * adds MATCHPROP's paintbrush, changed once as its destination prompt comes and goes, or the
 * lock of a locked table cell under the cursor (M4-16 part 11), changed as it enters and leaves.
 */
export function crosshairCursor(color: string, angle = 0, badge?: 'paintbrush' | 'lock'): string {
  const halo = isDarkColor(color) ? '#ffffff' : '#000000';
  const n = 2 * HALF + 1;
  const c = HALF + 0.5;
  const cross = `M0 ${c}H${n}M${c} 0V${n}`;
  // Turned with the UCS and SNAPANG (M3-06 part 8): counter-clockwise on screen, whose Y runs
  // down, so the other way in the SVG; the arms keep within the image, clipped at its edges.
  const deg = Math.round(((-angle * 180) / Math.PI) * 1000) / 1000;
  const turn = deg % 90 === 0 ? '' : ` transform="rotate(${deg} ${c} ${c})"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><g${turn}>` +
    `<g stroke="${halo}" stroke-opacity="0.45" stroke-width="3"><path d="${cross}"/></g>` +
    `<g stroke="${color}" stroke-width="1"><path d="${cross}"/></g></g>` +
    (badge === 'paintbrush' ? paintbrush(color, halo) : '') +
    (badge === 'lock' ? padlock(color, halo) : '') +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${HALF} ${HALF}, crosshair`;
}
