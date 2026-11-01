// Colour mixing for gradient fills (M1-16 part 2): the stops between a gradient's two colours,
// and a one-colour gradient's second colour. Mixing happens per frame on resolved colours,
// because a gradient colour may be the foreground, which follows the background.

import { rgbHex, type Rgb } from './aci';

/** `#rgb` or `#rrggbb` as channels; undefined for any other CSS colour. */
export function parseHex(css: string): Rgb | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (!m) return undefined;
  const h = m[1]!;
  const n = (i: number, len: number) => parseInt(h.slice(i, i + len), 16);
  return h.length === 3 ? [n(0, 1) * 17, n(1, 1) * 17, n(2, 1) * 17] : [n(0, 2), n(2, 2), n(4, 2)];
}

/**
 * `a` and `b` mixed: `t` is b's weight. A colour that is not hex (which every colour the
 * renderer makes is) cannot be mixed, so the nearer one is kept.
 */
export function mixColors(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const p = parseHex(a);
  const q = parseHex(b);
  if (!p || !q) return t < 0.5 ? a : b;
  return rgbHex([0, 1, 2].map((i) => Math.round(p[i]! + (q[i]! - p[i]!) * t)) as unknown as Rgb);
}

/**
 * A one-colour gradient's second colour (GFCLRLUM, DXF 462): "the selected color mixed with
 * white" (tint) or "with black" (shade). AutoCAD's help names the two ends, darkest and
 * lightest, but not the middle; 0.5 is taken as the colour itself, 0 black and 1 white.
 */
export function tintColor(color: string, tint: number): string {
  const t = Math.min(Math.max(tint, 0), 1);
  return t >= 0.5 ? mixColors(color, '#ffffff', 2 * t - 1) : mixColors(color, '#000000', 1 - 2 * t);
}
