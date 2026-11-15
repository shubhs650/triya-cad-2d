// M3-09: the Drawing Units dialog's lists, as AutoCAD 2024's dialog shows them.
import { describe, expect, it } from 'vitest';
import {
  ANGLE_TYPES,
  LENGTH_TYPES,
  anglePrecisionFor,
  anglePrecisions,
  angleText,
  baseAngleName,
  lengthPrecisions,
  typedAngle,
} from '../src/units-dialog';

const labels = (list: readonly { label: string }[]) => list.map((c) => c.label);

describe('Drawing Units lists', () => {
  it('lists the types in AutoCAD order, every LUNITS and AUNITS once', () => {
    expect(labels(LENGTH_TYPES)).toEqual([
      'Architectural',
      'Decimal',
      'Engineering',
      'Fractional',
      'Scientific',
    ]);
    expect(LENGTH_TYPES.map((t) => t.value).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(ANGLE_TYPES.map((t) => t.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("writes each length type's precisions as samples of zero", () => {
    expect(labels(lengthPrecisions(2)).slice(0, 3)).toEqual(['0', '0.0', '0.00']);
    expect(lengthPrecisions(1)[2]!.label).toBe('0.00E+01');
    expect(lengthPrecisions(3)[1]!.label).toBe(`0'-0.0"`);
    expect(labels(lengthPrecisions(4)).slice(0, 3)).toEqual([`0'-0"`, `0'-0 1/2"`, `0'-0 1/4"`]);
    expect(lengthPrecisions(5).at(-1)).toEqual({ value: 8, label: '0 1/256' });
  });

  it("writes each angle type's precisions, degrees/minutes/seconds as AutoCAD lists them", () => {
    expect(labels(anglePrecisions(0)).slice(0, 2)).toEqual(['0', '0.0']);
    expect(labels(anglePrecisions(1))).toEqual([
      '0d',
      `0d00'`,
      `0d00'00"`,
      `0d00'00.0"`,
      `0d00'00.00"`,
      `0d00'00.000"`,
      `0d00'00.0000"`,
    ]);
    expect(anglePrecisions(2)[1]!.label).toBe('0.0g');
    expect(anglePrecisions(3)[0]!.label).toBe('0r');
    expect(anglePrecisions(4)[1]).toEqual({ value: 2, label: `N 0d00' E` });
    // The drawing's AUPREC 3 is listed, so opening the dialog does not change it.
    expect(anglePrecisions(1, 3).map((c) => c.value)).toEqual([0, 2, 3, 4, 5, 6, 7, 8]);
    expect(anglePrecisions(1, 3)[2]!.label).toBe(`0d00'00"`);
    expect(anglePrecisions(0, 3).map((c) => c.value)).toHaveLength(9);
  });

  it('keeps the angle precision across types where it can', () => {
    expect(anglePrecisionFor(2, 3)).toBe(3);
    expect(anglePrecisionFor(1, 3)).toBe(4);
    expect(anglePrecisionFor(1, 1)).toBe(2);
    expect(anglePrecisionFor(1, 8)).toBe(8);
  });

  it('names the compass directions and reads Other typed in any angle form', () => {
    expect(baseAngleName(Math.PI / 2)).toBe('North');
    expect(baseAngleName(0.3)).toBeUndefined();
    expect(angleText(Math.PI / 2, 1, 4)).toBe(`90d0'0"`);
    expect(angleText(Math.PI / 4, 4, 0)).toBe('N 45d E');
    expect(typedAngle('45')).toBeCloseTo(Math.PI / 4, 12);
    expect(typedAngle("45d30'")).toBeCloseTo((45.5 * Math.PI) / 180, 12);
    expect(typedAngle('N 45d E')).toBeCloseTo(Math.PI / 4, 12);
    expect(typedAngle('-90')).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(typedAngle('north')).toBeUndefined();
  });
});
