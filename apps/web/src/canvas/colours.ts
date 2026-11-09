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
