// M2-10: dimension text by DIMLUNIT, DIMDEC, DIMZIN, DIMRND, DIMLFAC, DIMDSEP, DIMFRAC,
// DIMAUNIT, DIMADEC, DIMAZIN, DIMPOST and the text override, as AutoCAD formats it.
import { describe, expect, it } from 'vitest';
import {
  angularText,
  dimensionText,
  formatAngle,
  formatLinear,
  linearText,
  textAlign,
} from '../src/index';

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

describe('tolerances, limits and alternate units (M2-10 part 2)', () => {
  const tol = { DIMDEC: 2, DIMTDEC: 2, DIMTFAC: 0.7, DIMTP: 0.1, DIMTM: 0.05 };

  it('DIMTOL: stacked deviations at DIMTFAC, DIMTDEC and DIMTZIN; symmetrical with %%p', () => {
    expect(linearText('', 10, { ...tol, DIMTOL: 1 })).toBe('10.00{\\H0.7x;\\S+0.10^-0.05;}');
    expect(linearText('', 10, { ...tol, DIMTOL: 1, DIMTZIN: 8 })).toBe(
      '10.00{\\H0.7x;\\S+0.1^-0.05;}',
    );
    expect(linearText('', 10, { ...tol, DIMTOL: 1, DIMTM: 0.1 })).toBe('10.00%%p0.10');
    // A negative DIMTM is a plus deviation below; zero has no sign.
    expect(linearText('', 10, { ...tol, DIMTOL: 1, DIMTP: 0, DIMTM: -0.05 })).toBe(
      '10.00{\\H0.7x;\\S0.00^+0.05;}',
    );
    // After DIMPOST and the prefix.
    expect(linearText('', 10, { ...tol, DIMTOL: 1, DIMTM: 0.1, DIMPOST: '<> mm' }, 'R')).toBe(
      'R10.00 mm%%p0.10',
    );
  });

  it('DIMLIM: the upper and lower limits stacked in place of the measurement', () => {
    expect(linearText('', 10, { ...tol, DIMLIM: 1 })).toBe('{\\H0.7x;\\S10.10^9.95;}');
  });

  it('DIMALT: the alternate measurement in brackets by DIMALTF, DIMALTU, DIMALTD, DIMALTZ, DIMALTRND, DIMAPOST', () => {
    const alt = { DIMDEC: 2, DIMALT: 1, DIMALTF: 25.4, DIMALTD: 1, DIMALTU: 2, DIMALTZ: 0 };
    expect(linearText('', 1, alt)).toBe('1.00 [25.4]');
    expect(linearText('', 1, { ...alt, DIMAPOST: '<> mm' })).toBe('1.00 [25.4 mm]');
    expect(linearText('', 1, { ...alt, DIMALTRND: 5 })).toBe('1.00 [25.0]');
    // DIMLFAC scales both.
    expect(linearText('', 1, { ...alt, DIMLFAC: 2 })).toBe('2.00 [50.8]');
    // Alternate tolerances by DIMALTTD and DIMALTTZ.
    expect(
      linearText('', 1, { ...alt, ...tol, DIMTOL: 1, DIMTM: 0.1, DIMALTTD: 1, DIMALTTZ: 0 }),
    ).toBe('1.00%%p0.10 [25.4%%p2.5]');
  });

  it('DIMALTU numbers its formats on its own: 6 and 7 unstacked, 8 Windows desktop (M2-35)', () => {
    const alt = { DIMDEC: 2, DIMALT: 1, DIMALTF: 1, DIMALTD: 3 };
    const primary = (vars: Record<string, number>) => linearText('', 1.5, { DIMDEC: 3, ...vars })!;
    const altText = (altu: number) =>
      /\[(.*)\]/.exec(linearText('', 1.5, { ...alt, DIMALTU: altu })!)![1];
    expect(altText(4)).toBe(primary({ DIMLUNIT: 4 }));
    expect(altText(5)).toBe(primary({ DIMLUNIT: 5 }));
    expect(altText(6)).toBe(primary({ DIMLUNIT: 4, DIMFRAC: 2 }));
    expect(altText(7)).toBe(primary({ DIMLUNIT: 5, DIMFRAC: 2 }));
    expect(altText(8)).toBe(primary({ DIMLUNIT: 6 }));
    expect(altText(6)).not.toBe(altText(4));
  });

  it('a text override: <> is the primary text and [] the alternate one, else <> stands for both', () => {
    const alt = { DIMDEC: 2, DIMALT: 1, DIMALTF: 25.4, DIMALTD: 1, DIMALTU: 2 };
    expect(linearText('<> TYP', 1, alt)).toBe('1.00 [25.4] TYP');
    expect(linearText('<>/[]', 1, alt)).toBe('1.00/25.4');
    expect(linearText('SEE NOTE', 1, alt)).toBe('SEE NOTE');
    expect(linearText(' ', 1, alt)).toBeUndefined();
  });
});

describe('DIMTOLJ and angular tolerances (M2-30)', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  const tol = { DIMADEC: 0, DIMTDEC: 1, DIMTFAC: 0.7, DIMTP: 0.5, DIMTM: 0.2, DIMTZIN: 0 };

  it('DIMTOLJ is the alignment code a text with deviations starts with (\\A0; bottom, 1 middle, 2 top)', () => {
    // AutoCAD's default DIMTOLJ is 1 (middle).
    expect(textAlign(false, { DIMTOL: 1 })).toBe('\\A1;');
    expect(textAlign(false, { DIMTOL: 1, DIMTOLJ: 0 })).toBe('\\A0;');
    expect(textAlign(true, { DIMTOL: 1, DIMTOLJ: 2 })).toBe('\\A2;');
    // Out of range values are clamped.
    expect(textAlign(false, { DIMTOL: 1, DIMTOLJ: 7 })).toBe('\\A2;');
    // No effect unless DIMTOL is on (DIMTOLJ system variable); limits are not deviations.
    expect(textAlign(true, { DIMTOLJ: 0 })).toBe('\\A1;');
    expect(textAlign(false, { DIMTOLJ: 0 })).toBe('');
    expect(textAlign(true, { DIMLIM: 1, DIMTOLJ: 0 })).toBe('\\A1;');
  });

  it('angular DIMTOL: deviations in the angle unit at DIMTDEC with DIMTZIN, stacked or %%p', () => {
    expect(angularText('', deg(90), { ...tol, DIMTOL: 1 })).toBe(
      '90%%d{\\H0.7x;\\S+0.5%%d^-0.2%%d;}',
    );
    expect(angularText('', deg(90), { ...tol, DIMTOL: 1, DIMTM: 0.5 })).toBe('90%%d%%p0.5%%d');
    // DIMTZIN 8 drops trailing zeros, 4 leading ones (DIMAZIN's 2 and 1 for the deviations).
    expect(angularText('', deg(90), { ...tol, DIMTDEC: 2, DIMTZIN: 12, DIMTOL: 1 })).toBe(
      '90%%d{\\H0.7x;\\S+.5%%d^-.2%%d;}',
    );
    // Grads: DIMTP is in grads.
    expect(angularText('', Math.PI / 2, { ...tol, DIMAUNIT: 2, DIMTOL: 1, DIMTM: 0.5 })).toBe(
      '100g%%p0.5g',
    );
    // A zero deviation has no sign.
    expect(angularText('', deg(90), { ...tol, DIMTOL: 1, DIMTP: 0 })).toBe(
      '90%%d{\\H0.7x;\\S0.0%%d^-0.2%%d;}',
    );
  });

  it('angular DIMLIM: the limits stacked in place of the measurement; overrides and DIMPOST as before', () => {
    expect(angularText('', deg(90), { ...tol, DIMLIM: 1 })).toBe('{\\H0.7x;\\S90.5%%d^89.8%%d;}');
    expect(angularText('<> TYP', deg(90), { ...tol, DIMTOL: 1, DIMTM: 0.5 })).toBe(
      '90%%d%%p0.5%%d TYP',
    );
    expect(angularText('SEE NOTE', deg(90), { ...tol, DIMTOL: 1 })).toBe('SEE NOTE');
    expect(angularText(' ', deg(90), tol)).toBeUndefined();
    expect(angularText('', deg(90), { ...tol, DIMPOST: '<> REF' })).toBe('90%%d REF');
  });
});
