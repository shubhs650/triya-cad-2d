// M2-10: dimension text by DIMLUNIT, DIMDEC, DIMZIN, DIMRND, DIMLFAC, DIMDSEP, DIMFRAC,
// DIMAUNIT, DIMADEC, DIMAZIN, DIMPOST and the text override, as AutoCAD formats it.
import { describe, expect, it } from 'vitest';
import { dimensionText, formatAngle, formatLinear } from '../src/index';

describe('linear measurement text', () => {
  it('decimal: DIMDEC places, DIMZIN leading/trailing zeros, DIMDSEP, DIMRND, DIMLFAC', () => {
    expect(formatLinear(46.7156, { DIMLUNIT: 2, DIMDEC: 2, DIMZIN: 8, DIMDSEP: ',' })).toBe(
      '46,72',
    );
    expect(formatLinear(12.5, { DIMLUNIT: 2, DIMDEC: 4, DIMZIN: 0 })).toBe('12.5000');
    expect(formatLinear(12.5, { DIMLUNIT: 2, DIMDEC: 4, DIMZIN: 8 })).toBe('12.5');
    expect(formatLinear(12, { DIMLUNIT: 2, DIMDEC: 4, DIMZIN: 8 })).toBe('12');
    expect(formatLinear(0.5, { DIMLUNIT: 2, DIMDEC: 4, DIMZIN: 4 })).toBe('.5000');
    expect(formatLinear(0.5, { DIMLUNIT: 2, DIMDEC: 4, DIMZIN: 12 })).toBe('.5');
    expect(formatLinear(2.675, { DIMLUNIT: 2, DIMDEC: 2 })).toBe('2.68');
    expect(formatLinear(12.3, { DIMLUNIT: 2, DIMDEC: 2, DIMRND: 0.25 })).toBe('12.25');
    expect(formatLinear(10, { DIMLUNIT: 2, DIMDEC: 1, DIMLFAC: 2.5 })).toBe('25.0');
  });

  it('scientific', () => {
    expect(formatLinear(48.25, { DIMLUNIT: 1, DIMDEC: 2 })).toBe('4.83E+01');
    expect(formatLinear(0.0125, { DIMLUNIT: 1, DIMDEC: 3 })).toBe('1.250E-02');
  });

  it('architectural: feet, inches and a stacked fraction of 2^DIMDEC, DIMZIN feet and inches', () => {
    // The acadsharp sample's aligned dimension (DIMFRAC 1 diagonal, DIMZIN 8).
    const arch = { DIMLUNIT: 4, DIMDEC: 2, DIMFRAC: 1, DIMZIN: 8, DIMTFAC: 1 };
    expect(formatLinear(48.25, arch)).toBe('4\'-0{\\H1x;\\S1#4;}"');
    expect(formatLinear(48.25, { ...arch, DIMFRAC: 0 })).toBe('4\'-0{\\H1x;\\S1/4;}"');
    expect(formatLinear(48.25, { ...arch, DIMFRAC: 2 })).toBe('4\'-0 1/4"');
    expect(formatLinear(48.5, { ...arch, DIMTFAC: 0.75 })).toBe('4\'-0{\\H0.75x;\\S1#2;}"');
    // DIMZIN 0 drops zero feet and exactly zero inches; 1 keeps both; 2 keeps zero feet;
    // 3 keeps zero inches.
    expect(formatLinear(48, { ...arch, DIMZIN: 0 })).toBe("4'");
    expect(formatLinear(6, { ...arch, DIMZIN: 0 })).toBe('6"');
    expect(formatLinear(48, { ...arch, DIMZIN: 1 })).toBe('4\'-0"');
    expect(formatLinear(6, { ...arch, DIMZIN: 1 })).toBe('0\'-6"');
    expect(formatLinear(6, { ...arch, DIMZIN: 2 })).toBe('0\'-6"');
    expect(formatLinear(48, { ...arch, DIMZIN: 2 })).toBe("4'");
    expect(formatLinear(48, { ...arch, DIMZIN: 3 })).toBe('4\'-0"');
    expect(formatLinear(6, { ...arch, DIMZIN: 3 })).toBe('6"');
    // Rounding up to a whole foot carries.
    expect(formatLinear(59.99, { ...arch, DIMZIN: 0 })).toBe("5'");
  });

  it('engineering: feet and decimal inches', () => {
    expect(formatLinear(48.25, { DIMLUNIT: 3, DIMDEC: 2, DIMZIN: 0 })).toBe('4\'-0.25"');
    expect(formatLinear(30, { DIMLUNIT: 3, DIMDEC: 2, DIMZIN: 1 })).toBe('2\'-6.00"');
  });

  it('fractional: whole units and a stacked fraction', () => {
    expect(formatLinear(48.25, { DIMLUNIT: 5, DIMDEC: 2, DIMFRAC: 0 })).toBe('48{\\H1x;\\S1/4;}');
    expect(formatLinear(48, { DIMLUNIT: 5, DIMDEC: 2 })).toBe('48');
    expect(formatLinear(0.5, { DIMLUNIT: 5, DIMDEC: 3, DIMFRAC: 2 })).toBe('0 1/2');
  });
});

describe('angular measurement text', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  it('decimal degrees with DIMADEC and DIMAZIN', () => {
    expect(formatAngle(deg(94.3), { DIMAUNIT: 0, DIMADEC: 0 })).toBe('94%%d');
    expect(formatAngle(deg(36.5), { DIMAUNIT: 0, DIMADEC: 2 })).toBe('36.50%%d');
    expect(formatAngle(deg(36.5), { DIMAUNIT: 0, DIMADEC: 2, DIMAZIN: 2 })).toBe('36.5%%d');
    expect(formatAngle(deg(0.5), { DIMAUNIT: 0, DIMADEC: 1, DIMAZIN: 1 })).toBe('.5%%d');
    // DIMADEC −1 takes DIMDEC.
    expect(formatAngle(deg(45), { DIMAUNIT: 0, DIMADEC: -1, DIMDEC: 1 })).toBe('45.0%%d');
  });

  it('degrees/minutes/seconds, grads and radians', () => {
    const a = deg(30 + 15 / 60 + 30 / 3600);
    expect(formatAngle(a, { DIMAUNIT: 1, DIMADEC: 0 })).toBe('30%%d');
    expect(formatAngle(a, { DIMAUNIT: 1, DIMADEC: 2 })).toBe("30%%d16'");
    expect(formatAngle(a, { DIMAUNIT: 1, DIMADEC: 4 })).toBe('30%%d15\'30"');
    expect(formatAngle(Math.PI / 2, { DIMAUNIT: 2, DIMADEC: 0 })).toBe('100g');
    expect(formatAngle(1.5, { DIMAUNIT: 3, DIMADEC: 2 })).toBe('1.50r');
  });
});

describe('dimension text', () => {
  it('applies DIMPOST and the override with <> for the measurement; a space hides it', () => {
    expect(dimensionText('', '12.5', { DIMPOST: '' })).toBe('12.5');
    expect(dimensionText('', '12.5', { DIMPOST: ' mm' })).toBe('12.5 mm');
    expect(dimensionText('', '12.5', { DIMPOST: '<> TYP' })).toBe('12.5 TYP');
    expect(dimensionText('2x <>', '12.5', { DIMPOST: '' })).toBe('2x 12.5');
    expect(dimensionText('SEE NOTE', '12.5', { DIMPOST: '' })).toBe('SEE NOTE');
    expect(dimensionText(' ', '12.5', { DIMPOST: '' })).toBeUndefined();
  });
});
