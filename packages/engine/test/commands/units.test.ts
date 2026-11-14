// M2-35 part 17: lengths and angles on the command line in the drawing's units, as AutoCAD's
// RTOS and ANGTOS write them (AutoLISP Reference, "About String Conversions" and "angtos": the
// examples there are the cases marked "Help").
import { describe, expect, it } from 'vitest';
import {
  DECIMAL_UNITS,
  drawingUnits,
  formatAngle,
  formatAnswer,
  formatDistance,
  formatPrompt,
  parseAngleValue,
  parseDistance,
  prompts,
  type DrawingUnits,
} from '../../src/index';

const units = (u: Partial<DrawingUnits>): DrawingUnits => ({ ...DECIMAL_UNITS, ...u });
const deg = (d: number): number => (d * Math.PI) / 180;

describe('formatDistance', () => {
  it.each([
    // Help: x = 17.5 in each mode.
    [1, 4, 0, 17.5, '1.7500E+01'],
    [2, 2, 0, 17.5, '17.50'],
    [3, 2, 0, 17.5, `1'-5.50"`],
    [4, 1, 0, 17.5, `1'-5 1/2"`],
    [5, 1, 0, 17.5, '17 1/2'],
    // Help: UNITMODE 1 writes them as typed.
    [3, 2, 1, 17.5, `1'5.50"`],
    [4, 1, 1, 17.5, `1'5-1/2"`],
    [5, 1, 1, 17.5, '17-1/2'],
    // Both zero parts kept, as the status bar and the Properties palette show them.
    [4, 4, 0, 10, `0'-10"`],
    [4, 4, 0, 24, `2'-0"`],
    [4, 4, 0, 0.1875, `0'-0 3/16"`],
    [4, 4, 0, 0, `0'-0"`],
    [3, 4, 0, 0, `0'-0.0000"`],
    // Rounding carries into the next foot and the next whole inch.
    [4, 4, 0, 23.999, `2'-0"`],
    [3, 2, 0, 11.999, `1'-0.00"`],
    [5, 2, 0, 2.99, '3'],
    [5, 3, 0, 0.375, '0 3/8'],
    // Negative values, and a negative that rounds to zero.
    [4, 4, 0, -17.5, `-1'-5 1/2"`],
    [5, 4, 0, -0.0001, '0'],
    [2, 4, 0, -0.00001, '0.0000'],
    [1, 2, 0, 0.00125, '1.25E-03'],
    [1, 2, 0, -0, '0.00E+00'],
  ])('LUNITS %d, LUPREC %d, UNITMODE %d: %d is %s', (lunits, luprec, unitmode, value, text) => {
    expect(formatDistance(value, units({ lunits, luprec, unitmode }))).toBe(text);
  });

  it.each([1, 2, 3, 4, 5])('LUNITS %d reads back as it is shown', (lunits) => {
    for (const unitmode of [0, 1]) {
      for (const value of [0, 0.5, 3.25, 10, 17.5, 66.125, 1234.0625, -42.75]) {
        // Scientific keeps LUPREC significant digits after the first, so give it eight.
        const u = units({ lunits, luprec: lunits === 1 ? 8 : 4, unitmode });
        // At the command line a space ends the input; the palette shows `17 1/2` and reads it.
        expect(parseDistance(formatDistance(value, u), lunits)).toBeCloseTo(value, 3);
      }
    }
  });
});

describe('formatAngle', () => {
  it.each([
    // Help: angtos examples.
    [0, 4, 0, 0.785398, '45.0000'],
    [0, 4, 0, -0.785398, '315.0000'],
    [4, 0, 0, -0.785398, 'S 45d E'],
    [0, 0, 0, 3.14159, '180'],
    // Help's 3.14159 is π: 3.14159 itself is 179d59'59" and 199.9998g.
    [1, 4, 0, Math.PI, `180d0'0"`],
    [2, 4, 0, Math.PI, '200.0000g'],
    [3, 4, 0, 3.14159, '3.1416r'],
    [4, 2, 0, 3.14159, 'W'],
    // Help: UNITMODE 1 drops a bearing's spaces.
    [4, 0, 1, deg(45), 'N45dE'],
    // Degrees, minutes and seconds by AUPREC, as the UNITS dialog's precision list.
    [1, 0, 0, deg(45.5), '46d'],
    [1, 1, 0, deg(45.5), `45d30'`],
    [1, 3, 0, deg(45 + 30 / 60 + 15 / 3600), `45d30'15"`],
    [1, 5, 0, deg(45 + 30 / 60 + 15.25 / 3600), `45d30'15.3"`],
    // Bearings in every quadrant and on the axes.
    [4, 0, 0, deg(30), 'N 60d E'],
    [4, 2, 0, deg(120.5), `N 30d30' W`],
    [4, 0, 0, deg(200), 'S 70d W'],
    [4, 0, 0, deg(90), 'N'],
    [4, 0, 0, deg(270), 'S'],
    [4, 0, 0, 0, 'E'],
    [4, 0, 0, deg(359.9), 'E'],
    // A value that rounds to a full turn reads as 0.
    [0, 0, 0, deg(359.9), '0'],
    [1, 0, 0, deg(359.9), '0d'],
    [2, 2, 0, deg(359.9999), '0.00g'],
    [3, 2, 0, deg(359.9999), '0.00r'],
  ])('AUNITS %d, AUPREC %d, UNITMODE %d: %d is %s', (aunits, auprec, unitmode, value, text) => {
    expect(formatAngle(value, units({ aunits, auprec, unitmode }))).toBe(text);
  });

  it.each([0, 1, 2, 3, 4])('AUNITS %d reads back as it is shown', (aunits) => {
    for (const d of [0, 12.5, 45, 90, 90.25, 181, 270, 300.75]) {
      const text = formatAngle(deg(d), units({ aunits, auprec: 4 }));
      expect(parseAngleValue(text)! * (180 / Math.PI)).toBeCloseTo(d, 1);
    }
  });

  // M2-35 part 18: a bearing reads back with or without UNITMODE 1's spaces.
  it('a bearing reads back under UNITMODE 1', () => {
    for (const d of [30, 120.5, 200, 330]) {
      const text = formatAngle(deg(d), units({ aunits: 4, auprec: 4, unitmode: 1 }));
      expect(parseAngleValue(text)! * (180 / Math.PI)).toBeCloseTo(d, 1);
    }
  });
});

describe('drawingUnits', () => {
  it('reads the header, keeping AutoCAD defaults for what is missing or out of range', () => {
    expect(drawingUnits(new Map())).toEqual(DECIMAL_UNITS);
    expect(
      drawingUnits(
        new Map<string, unknown>([
          ['$LUNITS', 4],
          ['$LUPREC', 5],
          ['$AUNITS', 1],
          ['$AUPREC', 3],
          ['$UNITMODE', 1],
        ]),
      ),
    ).toEqual({ lunits: 4, luprec: 5, aunits: 1, auprec: 3, unitmode: 1 });
    expect(
      drawingUnits(
        new Map<string, unknown>([
          ['$LUNITS', 6],
          ['$LUPREC', 9],
          ['$AUNITS', '1'],
          ['$AUPREC', -1],
          ['$UNITMODE', 2],
        ]),
      ),
    ).toEqual(DECIMAL_UNITS);
  });
});

describe('prompts in the drawing units', () => {
  const architectural = units({ lunits: 4, luprec: 4, aunits: 1, auprec: 2 });

  it('shows a distance default, a point default and an angle default in them', () => {
    expect(
      formatPrompt(
        prompts.distance({
          message: 'Specify radius of circle or',
          options: ['Diameter'],
          default: { kind: 'distance', value: 18 },
        }),
        architectural,
      ),
    ).toBe(`Specify radius of circle or [Diameter] <1'-6">:`);
    expect(
      formatPrompt(
        prompts.distance({ message: 'Specify height', default: { kind: 'number', value: 0.1875 } }),
        architectural,
      ),
    ).toBe(`Specify height <0'-0 3/16">:`);
    expect(
      formatPrompt(
        prompts.point({
          message: 'Specify base point',
          default: { kind: 'point', point: { x: 12, y: 30 } },
        }),
        architectural,
      ),
    ).toBe(`Specify base point <1'-0",2'-6">:`);
    expect(
      formatPrompt(
        prompts.angle({
          message: 'Specify rotation angle',
          default: { kind: 'angle', value: deg(-30.5) },
        }),
        architectural,
      ),
    ).toBe(`Specify rotation angle <329d30'>:`);
  });

  it('keeps reals and integers plain numbers', () => {
    expect(
      formatPrompt(
        prompts.real({ message: 'Scale factor', default: { kind: 'number', value: 1.5 } }),
        architectural,
      ),
    ).toBe('Scale factor <1.5000>:');
    expect(
      formatPrompt(
        prompts.integer({ message: 'Sides', default: { kind: 'number', value: 6 } }),
        architectural,
      ),
    ).toBe('Sides <6>:');
  });

  it('echoes answers in them, a whole decimal distance as typed', () => {
    expect(formatAnswer({ kind: 'distance', value: 18 }, architectural)).toBe(`1'-6"`);
    expect(formatAnswer({ kind: 'distance', value: 18 })).toBe('18');
    expect(formatAnswer({ kind: 'distance', value: 1.5 })).toBe('1.5000');
    expect(formatAnswer({ kind: 'angle', value: deg(90) }, architectural)).toBe(`90d0'`);
    expect(formatAnswer({ kind: 'point', point: { x: 6.5, y: -3 } }, architectural)).toBe(
      `0'-6 1/2",-0'-3"`,
    );
  });
});
