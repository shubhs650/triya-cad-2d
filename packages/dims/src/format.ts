// The measurement as dimension text, by AutoCAD's DIMVARs (DIMSTYLE reference, linked in
// style.ts, and the DIMLUNIT, DIMZIN, DIMFRAC, DIMAUNIT, DIMAZIN and DIMPOST system variable
// pages):
// - DIMLFAC multiplies linear measurements; DIMRND rounds them to its nearest multiple.
// - DIMLUNIT 1 scientific, 2 decimal, 3 engineering (feet and decimal inches), 4
//   architectural (feet and fractional inches), 5 fractional, 6 Windows desktop (decimal here,
//   as the app has no Windows settings). DIMDEC is the decimal places, or 2^DIMDEC as the
//   fraction's denominator.
// - DIMZIN 0–3 choose zero feet and zero inches for feet-and-inch units; +4 drops leading and
//   +8 trailing decimal zeros.
// - DIMFRAC 0 stacks fractions horizontally, 1 diagonally, 2 not at all; a stacked fraction is
//   DIMTFAC times the text height, the MTEXT code AutoCAD writes being `{\H<f>x;\S<n>#<d>;}`.
// - DIMAUNIT 0 decimal degrees, 1 degrees/minutes/seconds, 2 grads, 3 radians; DIMADEC −1
//   takes DIMDEC; DIMAZIN 1 drops leading and 2 trailing zeros.
// - DIMDSEP is the decimal separator.
// - DIMPOST is a prefix/suffix around `<>`, or a suffix when it has none.
// - A text override (DXF 1) replaces the measurement, its first `<>` standing for it, and a
//   single space suppresses the text.

import type { DimVarValue } from '@triya/engine';
import { num, str } from './style';

type Vars = Readonly<Record<string, DimVarValue>>;

/** Leading and trailing decimal zeros dropped as asked. */
function suppressZeros(text: string, leading: boolean, trailing: boolean): string {
  let t = text;
  if (trailing && t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  if (leading) t = t.replace(/^(-?)0\./, '$1.');
  return t;
}

/** `value` with `places` decimals (0–8), zeros dropped as asked, `.` as the separator. */
function decimal(value: number, places: number, leading: boolean, trailing: boolean): string {
  const p = Math.min(8, Math.max(0, Math.round(places)));
  // `toFixed` rounds the binary value: 2.675 → "2.67". Round the decimal value first.
  const k = 10 ** p;
  const rounded = Math.round((value + Number.EPSILON * Math.abs(value)) * k) / k;
  const text = suppressZeros(rounded.toFixed(p), leading, trailing);
  return text === '-0' || text === '' ? '0' : text === '-.' ? '0' : text;
}

/** A fraction of an inch with denominator `den`, as DIMFRAC writes it. */
function fraction(n: number, den: number, vars: Vars): string {
  const frac = num(vars.DIMFRAC);
  if (frac === 2) return `${n}/${den}`;
  const tfac = num(vars.DIMTFAC, 1);
  return `{\\H${+tfac.toFixed(6)}x;\\S${n}${frac === 1 ? '#' : '/'}${den};}`;
}

/** Whole inches and a reduced fraction of 2^DIMDEC, the fraction empty when it is 0. */
function inchesAndFraction(
  inches: number,
  vars: Vars,
): { whole: number; frac: string } {
  const den = 2 ** Math.min(8, Math.max(0, Math.round(num(vars.DIMDEC))));
  let units = Math.round(inches * den);
  const whole = Math.floor(units / den);
  units -= whole * den;
  let d = den;
  while (units > 0 && units % 2 === 0) {
    units /= 2;
    d /= 2;
  }
  if (units === 0) return { whole, frac: '' };
  return { whole, frac: fraction(units, d, vars) };
}

/** Feet and inches (engineering or architectural), with DIMZIN's zero feet and inches. */
function feetInches(value: number, vars: Vars, architectural: boolean): string {
  const zin = num(vars.DIMZIN);
  const mode = zin & 3;
  const sep = str(vars.DIMDSEP) || '.';
  const negative = value < 0;
  const v = Math.abs(value);
  let feet = Math.floor(v / 12);
  let inchText: string;
  let zeroInches: boolean;
  if (architectural) {
    let { whole, frac } = inchesAndFraction(v - feet * 12, vars);
    if (whole >= 12) {
      feet += 1;
      whole -= 12;
    }
    zeroInches = whole === 0 && frac === '';
    inchText = `${whole}${frac === '' ? '' : (num(vars.DIMFRAC) === 2 ? ' ' : '') + frac}`;
  } else {
    const places = num(vars.DIMDEC);
    let inches = Number(decimal(v - feet * 12, places, false, false));
    if (inches >= 12) {
      feet += 1;
      inches -= 12;
    }
    zeroInches = inches === 0;
    inchText = decimal(inches, places, (zin & 4) !== 0, (zin & 8) !== 0).replace('.', sep);
  }
  // DIMZIN 0 drops zero feet and exactly zero inches, 1 keeps both, 2 keeps zero feet and drops
  // zero inches, 3 keeps zero inches and drops zero feet.
  const showFeet = feet !== 0 || mode === 1 || mode === 2;
  const showInches = !zeroInches || mode === 1 || mode === 3 || feet === 0;
  const parts: string[] = [];
  if (showFeet) parts.push(`${feet}'`);
  if (showInches) parts.push(`${inchText}"`);
  return (negative ? '-' : '') + parts.join('-');
}

/** A linear measurement (drawing units) as text, before prefixes, DIMPOST and overrides. */
export function formatLinear(measurement: number, vars: Vars): string {
  let v = measurement * Math.abs(num(vars.DIMLFAC, 1) || 1);
  const rnd = num(vars.DIMRND);
  if (rnd > 0) v = Math.round(v / rnd) * rnd;
  const zin = num(vars.DIMZIN);
  const places = num(vars.DIMDEC, 4);
  const sep = str(vars.DIMDSEP) || '.';
  switch (num(vars.DIMLUNIT, 2)) {
    case 1: {
      const [mant, exp] = v.toExponential(Math.min(8, Math.max(0, places))).split('e');
      const e = Number(exp);
      const m = suppressZeros(mant!, (zin & 4) !== 0, (zin & 8) !== 0).replace('.', sep);
      return `${m}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
    }
    case 3:
      return feetInches(v, vars, false);
    case 4:
      return feetInches(v, vars, true);
    case 5: {
      const { whole, frac } = inchesAndFraction(Math.abs(v), vars);
      const sign = v < 0 ? '-' : '';
      if (frac === '') return `${sign}${whole}`;
      const space = num(vars.DIMFRAC) === 2 ? ' ' : '';
      return whole === 0 && (zin & 4) !== 0 ? `${sign}${frac}` : `${sign}${whole}${space}${frac}`;
    }
    default:
      return decimal(v, places, (zin & 4) !== 0, (zin & 8) !== 0).replace('.', sep);
  }
}

/** An angle (radians) as text, by DIMAUNIT, DIMADEC and DIMAZIN. */
export function formatAngle(radians: number, vars: Vars): string {
  let places = num(vars.DIMADEC);
  if (places < 0) places = num(vars.DIMDEC, 4);
  const azin = num(vars.DIMAZIN);
  const leading = (azin & 1) !== 0;
  const trailing = (azin & 2) !== 0;
  const sep = str(vars.DIMDSEP) || '.';
  const deg = (radians * 180) / Math.PI;
  switch (num(vars.DIMAUNIT)) {
    case 1: {
      // Degrees/minutes/seconds: precision 0 degrees, 1–2 minutes, 3–4 seconds, then
      // decimals of a second.
      const secDecimals = Math.max(0, places - 4);
      const unit = places <= 0 ? 3600 : places <= 2 ? 60 : 1 / 10 ** secDecimals;
      let total = Math.round((deg * 3600) / unit) * unit;
      const d = Math.floor(total / 3600 + 1e-9);
      total -= d * 3600;
      if (places <= 0) return `${d}%%d`;
      const m = Math.floor(total / 60 + 1e-9);
      if (places <= 2) return `${d}%%d${m}'`;
      const s = total - m * 60;
      return `${d}%%d${m}'${decimal(s, secDecimals, false, false).replace('.', sep)}"`;
    }
    case 2:
      return `${decimal((radians * 200) / Math.PI, places, leading, trailing).replace('.', sep)}g`;
    case 3:
      return `${decimal(radians, places, leading, trailing).replace('.', sep)}r`;
    default:
      return `${decimal(deg, places, leading, trailing).replace('.', sep)}%%d`;
  }
}

/** DIMPOST around (or after) the measurement text. */
export function applyPost(text: string, post: string): string {
  if (post === '') return text;
  return post.includes('<>') ? post.replace('<>', text) : text + post;
}

/**
 * The dimension's text: the override (DXF 1) with its first `<>` as the measurement, or the
 * measurement with DIMPOST. `undefined` when a single space suppresses the text.
 */
export function dimensionText(override: string, measured: string, vars: Vars): string | undefined {
  if (override === ' ') return undefined;
  const value = applyPost(measured, str(vars.DIMPOST));
  if (override === '') return value;
  return override.includes('<>') ? override.replace('<>', value) : override;
}
