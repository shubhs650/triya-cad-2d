// The Select Color dialog's colour arithmetic (M2-35 part 4; AutoCAD 2024 Help, "Select Color
// Dialog Box"): the Index Color tab's palette layout, what the Color field reads, and the True
// Color tab's HSL model. The dialog itself is SelectColorDialog.tsx.
import { colorText, parseColor, parseTrueColor, type Color, type ColorBook } from '@triya/engine';
import { aciRgb } from '@triya/render';

export type Rgb = readonly [number, number, number];

/**
 * The Index Color tab's large palette, ACI 10–249: one column per hue (10, 20, … 240) and one
 * row per shade. AutoCAD's dialog shows the full-saturation shades (even indices) brightest at
 * the top and the half-saturation shades (odd indices) palest at the bottom, the darkest
 * meeting in the middle; its help shows the palette but does not list the order, so this
 * follows the dialog as drafters see it.
 */
export const ACI_PALETTE: readonly (readonly number[])[] = [0, 2, 4, 6, 8, 9, 7, 5, 3, 1].map(
  (shade) => Array.from({ length: 24 }, (_, hue) => (hue + 1) * 10 + shade),
);

/** The nine standard colours, and the six greys, below the palette. */
export const ACI_STANDARD: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const ACI_GREYS: readonly number[] = [250, 251, 252, 253, 254, 255];

/** A colour as the dialog's Color field shows it (AutoCAD's spelling: "ByLayer", "red"). */
export function colorFieldText(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'ByLayer';
    case 'byBlock':
      return 'ByBlock';
    case 'aci':
      return c.index <= 7 ? colorText(c).toLowerCase() : String(c.index);
    case 'rgb':
      return colorText(c);
  }
}

/**
 * What the Color field reads: ByLayer, ByBlock, a colour name or an ACI number 1–255 (as
 * -COLOR takes them), a true colour `r,g,b`, or `BOOK$COLOR` from one of the drawing's books.
 */
export function parseColorField(text: string, books: readonly ColorBook[]): Color | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const plain = parseColor(t) ?? parseTrueColor(t);
  if (plain) return plain;
  const dollar = t.indexOf('$');
  if (dollar < 0) return undefined;
  const [book, name] = [t.slice(0, dollar).trim(), t.slice(dollar + 1).trim()].map((s) =>
    s.toUpperCase(),
  );
  const found = books.find((b) => b.name.toUpperCase() === book);
  const color = found?.colors.find((c) => c.name.toUpperCase() === name);
  if (!found || !color) return undefined;
  const [r, g, b] = color.rgb;
  return { kind: 'rgb', r, g, b, bookName: found.name, colorName: color.name };
}

/** The colour shown for `c`: an ACI's palette entry, a true colour's own; none for ByLayer. */
export function colorRgb(c: Color): Rgb | undefined {
  if (c.kind === 'aci') return aciRgb(c.index);
  if (c.kind === 'rgb') return [c.r, c.g, c.b];
  return undefined;
}

export const cssOf = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`;

/** The True Color tab's HSL: hue 0–360°, saturation and luminance 0–100 %. */
export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  const sector =
    max === rf ? ((gf - bf) / d + 6) % 6 : max === gf ? (bf - rf) / d + 2 : (rf - gf) / d + 4;
  return { h: Math.round(sector * 60) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sf = s / 100;
  const lf = l / 100;
  const c = (1 - Math.abs(2 * lf - 1)) * sf;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lf - c / 2;
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255)) as unknown as Rgb;
}
