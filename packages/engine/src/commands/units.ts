// Lengths and angles as the command line shows them (M2-35 part 17): a prompt's default
// (`<10.0000>`), the echo of a picked answer and the values a command reports, in the drawing's
// units, as AutoCAD's RTOS and ANGTOS write them with LUNITS/LUPREC and AUNITS/AUPREC (AutoLISP
// Reference, "rtos", "angtos" and "About String Conversions"):
// - LUNITS 1 scientific `1.7500E+01`, 2 decimal `17.5000`, 3 engineering `1'-5.5000"`,
//   4 architectural `1'-5 1/2"`, 5 fractional `17 1/2`; LUPREC is the decimal places, or 2^LUPREC
//   the fraction's denominator. UNITMODE 1 writes them as they are typed: `1'5.5000"`,
//   `1'5-1/2"`, `17-1/2`.
// - Help says DIMZIN sets RTOS's zeros, its examples taking DIMZIN 0. The command line here keeps
//   both zero parts (`0'-10"`, `2'-0"`) and the decimal places, as the status bar's coordinates
//   and the Properties palette show lengths (DIMZIN 1), so a drafter reads one value one way
//   wherever it appears; AutoCAD's help does not say which DIMZIN its prompts use.
// - AUNITS 0 decimal degrees without a sign `45.0000`, 1 degrees/minutes/seconds `45d30'15"`
//   (AUPREC 0 degrees, 1–2 minutes, 3–4 seconds, then decimals of a second, as the UNITS
//   dialog's precision list runs: angtos 1 at precision 4 gives `180d0'0"`), 2 grads `50.0000g`,
//   3 radians `0.7854r`, 4 surveyor's units: a bearing `N 45d E`, a cardinal direction alone
//   (`W`), without the spaces under UNITMODE 1 (`N45dE`). ANGTOS first takes an angle into
//   0 to 2π (`-0.785398` gives `315.0000` and `S 45d E`) and does not apply ANGBASE.
// Every form here reads back where it is typed (`parseDistance`, `parseAngleValue`), except a
// bearing, which the angle parser does not read yet.

/** The header variables that say how lengths and angles are shown. */
export interface DrawingUnits {
  /** LUNITS: 1 scientific, 2 decimal, 3 engineering, 4 architectural, 5 fractional. */
  readonly lunits: number;
  /** LUPREC: decimal places, or 2^LUPREC as the denominator of an inch's fraction. */
  readonly luprec: number;
  /** AUNITS: 0 degrees, 1 degrees/minutes/seconds, 2 grads, 3 radians, 4 surveyor's. */
  readonly aunits: number;
  /** AUPREC: decimal places of an angle (degrees, minutes and seconds for 1 and 4). */
  readonly auprec: number;
  /** UNITMODE 1: lengths and bearings shown as they are typed. */
  readonly unitmode: number;
}

/** AutoCAD's defaults: four decimal places, whole degrees. */
export const DECIMAL_UNITS: DrawingUnits = {
  lunits: 2,
  luprec: 4,
  aunits: 0,
  auprec: 0,
  unitmode: 0,
};

const MAX_PLACES = 8;

function headerInt(
  header: ReadonlyMap<string, unknown>,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const v = header.get(name);
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** The drawing's units from its header, AutoCAD's defaults for what it lacks or has out of range. */
export function drawingUnits(header: ReadonlyMap<string, unknown>): DrawingUnits {
  return {
    lunits: headerInt(header, '$LUNITS', 1, 5, DECIMAL_UNITS.lunits),
    luprec: headerInt(header, '$LUPREC', 0, MAX_PLACES, DECIMAL_UNITS.luprec),
    aunits: headerInt(header, '$AUNITS', 0, 4, DECIMAL_UNITS.aunits),
    auprec: headerInt(header, '$AUPREC', 0, MAX_PLACES, DECIMAL_UNITS.auprec),
    unitmode: headerInt(header, '$UNITMODE', 0, 1, DECIMAL_UNITS.unitmode),
  };
}

/** `value` with `places` decimals, never `-0.00`. */
export function formatNumber(value: number, places = 4): string {
  const s = value.toFixed(places);
  return s === `-${(0).toFixed(places)}` ? s.slice(1) : s;
}

/** `value` rounded at its decimal value (`toFixed` alone takes 2.675 to 2.67). */
function rounded(value: number, places: number): number {
  const k = 10 ** places;
  return Math.round((value + Number.EPSILON * Math.abs(value)) * k) / k;
}

/** Whole inches and a reduced fraction over 2^`luprec`, as numerator and denominator. */
function inchesAndFraction(inches: number, luprec: number): [number, number, number] {
  const den = 2 ** luprec;
  let units = Math.round(inches * den);
  const whole = Math.floor(units / den);
  units -= whole * den;
  let d = den;
  while (units > 0 && units % 2 === 0) {
    units /= 2;
    d /= 2;
  }
  return [whole, units, d];
}

/** A whole number and a fraction: `5 1/2`, or `5-1/2` as typed (UNITMODE 1); `5` alone. */
function mixed(whole: number, num: number, den: number, typed: boolean): string {
  if (num === 0) return String(whole);
  return `${whole}${typed ? '-' : ' '}${num}/${den}`;
}

/** Feet and inches, both parts always shown (`0'-10"`, `2'-0"`). */
function feetInches(value: number, u: DrawingUnits, architectural: boolean): string {
  const typed = u.unitmode === 1;
  const v = Math.abs(value);
  let feet = Math.floor(v / 12);
  let inches: string;
  if (architectural) {
    const [inch, num, den] = inchesAndFraction(v - feet * 12, u.luprec);
    let whole = inch;
    if (whole >= 12) {
      feet += 1;
      whole -= 12;
    }
    inches = mixed(whole, num, den, typed);
  } else {
    let i = rounded(v - feet * 12, u.luprec);
    if (i >= 12) {
      feet += 1;
      i -= 12;
    }
    inches = formatNumber(i, u.luprec);
  }
  const text = `${feet}'${typed ? '' : '-'}${inches}"`;
  return value < 0 && /[1-9]/.test(text) ? `-${text}` : text;
}

/** A length in drawing units as RTOS writes it in the drawing's LUNITS and LUPREC. */
export function formatDistance(value: number, u: DrawingUnits = DECIMAL_UNITS): string {
  switch (u.lunits) {
    case 1: {
      const [mant, exp] = value.toExponential(u.luprec).split('e');
      const e = Number(exp);
      const m = mant === `-${(0).toFixed(u.luprec)}` ? mant.slice(1) : mant!;
      return `${m}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
    }
    case 3:
      return feetInches(value, u, false);
    case 4:
      return feetInches(value, u, true);
    case 5: {
      const [whole, num, den] = inchesAndFraction(Math.abs(value), u.luprec);
      const text = mixed(whole, num, den, u.unitmode === 1);
      return value < 0 && text !== '0' ? `-${text}` : text;
    }
    default:
      return formatNumber(value, u.luprec);
  }
}

/**
 * Degrees, minutes and seconds of `degrees` (0 to 360) at AUPREC: 0 whole degrees `45d`, 1–2
 * minutes `45d30'`, 3–4 seconds `45d30'15"`, 5–8 seconds with AUPREC − 4 decimals.
 */
function dms(degrees: number, places: number): string {
  const secondDecimals = Math.max(0, places - 4);
  const step = places <= 0 ? 3600 : places <= 2 ? 60 : 1 / 10 ** secondDecimals;
  let total = rounded(Math.round((degrees * 3600) / step) * step, secondDecimals);
  const d = Math.floor(total / 3600 + 1e-9);
  total -= d * 3600;
  if (places <= 0) return `${d}d`;
  const m = Math.floor(total / 60 + 1e-9);
  if (places <= 2) return `${d}d${m}'`;
  const s = Math.max(0, total - m * 60);
  return `${d}d${m}'${formatNumber(s, secondDecimals)}"`;
}

/**
 * A bearing: N or S, the angle from that axis, E or W (`N 45d E`), or a cardinal direction
 * alone. `degrees` is the direction, 0 to 360 counter-clockwise from east.
 */
function bearing(degrees: number, u: DrawingUnits): string {
  const north = degrees <= 180;
  const fromAxis = north ? Math.abs(90 - degrees) : Math.abs(270 - degrees);
  const angle = dms(fromAxis, u.auprec);
  // A direction that rounds onto an axis is that axis's letter, as angtos gives `W` for π.
  if (/^0d(0')?(0(\.0+)?")?$/.test(angle)) return north ? 'N' : 'S';
  if (/^90d(0')?(0(\.0+)?")?$/.test(angle)) {
    return degrees < 90 || degrees > 270 ? 'E' : 'W';
  }
  const east = north ? degrees < 90 : degrees > 270;
  const parts = [north ? 'N' : 'S', angle, east ? 'E' : 'W'];
  return parts.join(u.unitmode === 1 ? '' : ' ');
}

/** An angle in radians as ANGTOS writes it in the drawing's AUNITS and AUPREC, 0 to 2π. */
export function formatAngle(radians: number, u: DrawingUnits = DECIMAL_UNITS): string {
  const turn = 2 * Math.PI;
  let r = radians % turn;
  if (r < 0) r += turn;
  const degrees = (r * 180) / Math.PI;
  // A value that rounds up to a full turn reads as 0, as the turn it is.
  const wrap = (text: string, full: string) => (text === full ? formatNumber(0, u.auprec) : text);
  switch (u.aunits) {
    case 1: {
      const text = dms(degrees, u.auprec);
      return text.startsWith('360d') ? dms(0, u.auprec) : text;
    }
    case 2: {
      const grads = (r * 200) / Math.PI;
      return `${wrap(formatNumber(rounded(grads, u.auprec), u.auprec), formatNumber(400, u.auprec))}g`;
    }
    case 3:
      return `${wrap(formatNumber(rounded(r, u.auprec), u.auprec), formatNumber(rounded(turn, u.auprec), u.auprec))}r`;
    case 4:
      return bearing(degrees, u);
    default:
      return wrap(formatNumber(rounded(degrees, u.auprec), u.auprec), formatNumber(360, u.auprec));
  }
}
