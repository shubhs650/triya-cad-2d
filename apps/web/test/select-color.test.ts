// M2-35 part 4: the Select Color dialog's colour arithmetic (AutoCAD 2024 Help, "Select Color
// Dialog Box"): the Index Color palette holds every ACI once, the Color field reads what
// AutoCAD's does, and the True Color tab's HSL turns back into the RGB it came from.
import { describe, expect, it } from 'vitest';
import type { ColorBook } from '@triya/engine';
import {
  ACI_GREYS,
  ACI_PALETTE,
  ACI_STANDARD,
  colorFieldText,
  hslToRgb,
  parseColorField,
  rgbToHsl,
} from '../src/select-color';

const BOOKS: ColorBook[] = [
  {
    name: 'RAL CLASSIC',
    colors: [{ name: 'RAL 3020', value: 'rgb:204,6,5;RAL CLASSIC;RAL 3020', rgb: [204, 6, 5] }],
  },
];

describe('the Index Color palette', () => {
  it('shows ACI 1–255 once each', () => {
    const all = [...ACI_PALETTE.flat(), ...ACI_STANDARD, ...ACI_GREYS].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 255 }, (_, i) => i + 1));
  });

  it('has a column per hue, 24 of them, full saturation above half saturation', () => {
    expect(ACI_PALETTE).toHaveLength(10);
    expect(ACI_PALETTE.every((row) => row.length === 24)).toBe(true);
    expect(ACI_PALETTE.map((row) => row[0])).toEqual([10, 12, 14, 16, 18, 19, 17, 15, 13, 11]);
  });
});

describe('the Color field', () => {
  it('reads ByLayer, ByBlock, names and index numbers as -COLOR does', () => {
    expect(parseColorField('bylayer', [])).toEqual({ kind: 'byLayer' });
    expect(parseColorField('ByBlock', [])).toEqual({ kind: 'byBlock' });
    expect(parseColorField('blue', [])).toEqual({ kind: 'aci', index: 5 });
    expect(parseColorField(' 142 ', [])).toEqual({ kind: 'aci', index: 142 });
    expect(parseColorField('256', [])).toEqual({ kind: 'byLayer' });
  });

  it('reads a true colour r,g,b', () => {
    expect(parseColorField('12, 34,56', [])).toEqual({ kind: 'rgb', r: 12, g: 34, b: 56 });
    expect(parseColorField('12,34,256', [])).toBeUndefined();
  });

  it('reads BOOK$COLOR from the drawing’s books, in any case', () => {
    expect(parseColorField('ral classic$ral 3020', BOOKS)).toEqual({
      kind: 'rgb',
      r: 204,
      g: 6,
      b: 5,
      bookName: 'RAL CLASSIC',
      colorName: 'RAL 3020',
    });
    expect(parseColorField('RAL CLASSIC$RAL 9999', BOOKS)).toBeUndefined();
    expect(parseColorField('PANTONE$100 C', BOOKS)).toBeUndefined();
  });

  it('refuses what is not a colour', () => {
    for (const t of ['', 'purple', '0.5', '1,2', '300'])
      expect(parseColorField(t, BOOKS)).toBeUndefined();
  });

  it('shows a colour as it reads it back', () => {
    for (const t of ['ByLayer', 'ByBlock', 'red', '142', '12,34,56', 'RAL CLASSIC$RAL 3020']) {
      expect(colorFieldText(parseColorField(t, BOOKS)!)).toBe(t);
    }
  });
});

describe('the True Color tab’s HSL', () => {
  it('converts AutoCAD’s examples both ways', () => {
    expect(rgbToHsl([255, 0, 0])).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl([128, 128, 128])).toEqual({ h: 0, s: 0, l: 50 });
    expect(hslToRgb({ h: 120, s: 100, l: 25 })).toEqual([0, 128, 0]);
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual([0, 0, 255]);
  });

  it('turns every whole HSL back into an RGB within rounding', () => {
    for (const rgb of [
      [204, 6, 5],
      [12, 34, 56],
      [255, 255, 255],
      [0, 0, 0],
      [226, 144, 0],
    ] as const) {
      const back = hslToRgb(rgbToHsl(rgb));
      back.forEach((v, i) => expect(Math.abs(v - rgb[i]!)).toBeLessThanOrEqual(3));
    }
  });
});
