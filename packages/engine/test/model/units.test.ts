// M2-32: the length each $INSUNITS code names (AutoCAD 2024 Help, "INSUNITS (System
// Variable)"), which pasting and inserting between drawings of other units scale by.
import { describe, expect, it } from 'vitest';
import { insUnitsScale, metresPerUnit } from '../../src/index';

describe('metresPerUnit', () => {
  it('knows every unit INSUNITS lists, and nothing for unitless or unknown codes', () => {
    expect(metresPerUnit(0)).toBeUndefined();
    for (let code = 1; code <= 24; code++)
      expect(metresPerUnit(code), `${code}`).toBeGreaterThan(0);
    expect(metresPerUnit(25)).toBeUndefined();
    expect(metresPerUnit(-1)).toBeUndefined();
    expect(metresPerUnit(1.5)).toBeUndefined();
  });

  it('measures the common units exactly', () => {
    expect(metresPerUnit(1)).toBe(0.0254);
    expect(metresPerUnit(2)).toBe(0.3048);
    expect(metresPerUnit(4)).toBe(0.001);
    expect(metresPerUnit(6)).toBe(1);
    expect(metresPerUnit(10)).toBe(0.9144);
    // The US survey foot is 1200/3937 m.
    expect(metresPerUnit(21)).toBe(1200 / 3937);
  });
});

describe('insUnitsScale', () => {
  it('is the ratio of the units, 1 between equal ones', () => {
    expect(insUnitsScale(4, 4)).toBe(1);
    expect(insUnitsScale(1, 4)).toBeCloseTo(25.4, 12);
    expect(insUnitsScale(2, 1)).toBeCloseTo(12, 12);
    expect(insUnitsScale(4, 6)).toBeCloseTo(0.001, 15);
  });

  it('is 1 when either drawing is unitless or its unit unknown', () => {
    expect(insUnitsScale(0, 4)).toBe(1);
    expect(insUnitsScale(4, 0)).toBe(1);
    expect(insUnitsScale(99, 4)).toBe(1);
  });
});
