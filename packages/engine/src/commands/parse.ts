// Command-line text to values (M2-01, ARCHITECTURE.md §5.1): numbers with `'cal`-lite arithmetic,
// angles, and AutoCAD's coordinate forms. Everything here is in world coordinates: there is no
// UCS yet, so AutoCAD's `*` (WCS) prefix means the same as `#` (absolute).
import type { Vec2 } from '../geom/types';
import { OSNAP, type OsnapMode } from '../input/osnap';

/**
 * A number, allowing `+ - * / ( )` between numbers (`'cal`-lite, ARCHITECTURE.md §5.1), so
 * `12.5*2-1` is 24. Undefined for anything else, including division by zero.
 */
export function parseNumber(text: string): number | undefined {
  const tokens = text.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\S/g);
  if (!tokens || tokens.length === 0) return undefined;
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := ('+'|'-') unary | atom
  const expr = (): number | undefined => {
    let v = term();
    while (v !== undefined && (peek() === '+' || peek() === '-')) {
      const op = tokens[i++];
      const r = term();
      if (r === undefined) return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number | undefined => {
    let v = unary();
    while (v !== undefined && (peek() === '*' || peek() === '/')) {
      const op = tokens[i++];
      const r = unary();
      if (r === undefined || (op === '/' && r === 0)) return undefined;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number | undefined => {
    const t = peek();
    if (t === '+' || t === '-') {
      i++;
      const v = unary();
      return v === undefined ? undefined : t === '-' ? -v : v;
    }
    if (t === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return undefined;
      i++;
      return v;
    }
    if (t === undefined || !/^(\d|\.\d)/.test(t)) return undefined;
    i++;
    return Number(t);
  };
  const value = expr();
  return value !== undefined && i === tokens.length && Number.isFinite(value) ? value : undefined;
}

// A number as lengths are typed in feet and inches or fractions: a whole number and a fraction
// (`2-3/8`, or `2 3/8` as the Properties palette shows one), a fraction, or a decimal.
const LENGTH = String.raw`(?:\d+(?:-|\s+)\d+/\d+|\d+/\d+|\d+(?:\.\d*)?|\.\d+)`;
const FEET_INCHES = new RegExp(
  String.raw`^([+-]?)\s*(?:(${LENGTH})\s*')?(?:\s*(-)?\s*(${LENGTH})\s*("?))?$`,
);

/** One `LENGTH`: undefined for a fraction over zero. */
function lengthValue(text: string): number | undefined {
  const mixed = /^(\d+)(?:-|\s+)(\d+)\/(\d+)$/.exec(text) ?? /^()(\d+)\/(\d+)$/.exec(text);
  if (!mixed) return Number(text);
  const den = Number(mixed[3]);
  return den === 0 ? undefined : Number(mixed[1] || 0) + Number(mixed[2]) / den;
}

/**
 * A typed length in drawing units, as AutoCAD reads one in the drawing's LUNITS (Help, "UNITS
 * (Command)"): in Engineering (3) and Architectural (4), whose drawing unit is the inch, feet and
 * inches (`5'6-1/2"`, `5'-6 1/2"`, `5.5'`, `6"`; a number without a mark is inches); in
 * Architectural and Fractional (5) a whole number and a fraction (`6-1/2`). Otherwise, and in
 * Decimal (2) and Scientific (1) always, a number as `parseNumber` reads it, so `1-1/2` there is
 * the sum it spells. AutoCAD types a fraction's hyphen at the command line, where a space ends the
 * input; the palette shows the space (M2-35 part 7).
 */
export function parseDistance(text: string, lunits: number): number | undefined {
  const t = text.trim();
  const feetAndInches = lunits === 3 || lunits === 4;
  const fractions = feetAndInches || lunits === 5;
  const m = fractions ? FEET_INCHES.exec(t) : null;
  if (m) {
    const [, sign, feet, dash, inches, mark] = m;
    // The hyphen parts feet from inches (`5'-6"`); feet and the inch mark are LUNITS 3 and 4's.
    const ok =
      (feet !== undefined || inches !== undefined) &&
      (dash === undefined || feet !== undefined) &&
      (feetAndInches || (feet === undefined && mark === ''));
    if (ok) {
      const f = feet === undefined ? 0 : lengthValue(feet);
      const i = inches === undefined ? 0 : lengthValue(inches);
      if (f === undefined || i === undefined) return undefined;
      const v = f * 12 + i;
      return sign === '-' ? -v : v;
    }
    return undefined;
  }
  return parseNumber(t);
}

/** How the drawing measures typed angles: ANGBASE (radians, the 0 direction) and ANGDIR. */
export interface AngleConvention {
  readonly base: number;
  readonly clockwise: boolean;
}

export const DEFAULT_ANGLES: AngleConvention = { base: 0, clockwise: false };

const DMS = /^([+-]?)(\d+(?:\.\d*)?)d(?:(\d+(?:\.\d*)?)')?(?:(\d+(?:\.\d*)?)")?$/i;

/** Degrees typed as degrees/minutes/seconds (`45d30'15"`), or undefined. */
function dmsDegrees(text: string): number | undefined {
  const dms = DMS.exec(text);
  if (!dms) return undefined;
  const deg = Number(dms[2]) + Number(dms[3] ?? 0) / 60 + Number(dms[4] ?? 0) / 3600;
  return dms[1] === '-' ? -deg : deg;
}

const BEARING = /^([ns])\s*(\d.*?)\s*([ew])$/i;
const CARDINAL: Readonly<Record<string, number>> = { e: 0, n: 90, w: 180, s: 270 };

/**
 * A surveyor's bearing as a world direction (radians, counter-clockwise from +X), or undefined
 * (M2-35 part 18; AutoCAD 2024 Help, "UNITS (Command)", Surveyor's Units): N or S, the angle
 * from that axis, 0 to 90 degrees (`45d30'`, or decimal degrees `45.5`), then E or W
 * (`N 45d30' E`, `N45d30'E`), or a cardinal direction alone (`N`, `E`, `S`, `W`), letters in
 * either case. It is what `formatAngle` writes for AUNITS 4, so a default shown as a bearing
 * reads back. A bearing names a direction from north, so ANGBASE and ANGDIR do not turn it:
 * Help is silent on them for bearings, and N 45d E meaning north-east is what a drafter (and
 * a surveyor's plat) expects. Like the other angle forms it is read whatever AUNITS says.
 */
export function parseBearing(text: string): number | undefined {
  const t = text.trim();
  const cardinal = CARDINAL[t.toLowerCase()];
  if (cardinal !== undefined) return (cardinal * Math.PI) / 180;
  const m = BEARING.exec(t);
  if (!m) return undefined;
  const a = m[2]!;
  const deg = dmsDegrees(a) ?? (/^\d+(?:\.\d*)?$/.test(a) ? Number(a) : undefined);
  if (deg === undefined || deg < 0 || deg > 90) return undefined;
  const north = m[1]!.toLowerCase() === 'n';
  const east = m[3]!.toLowerCase() === 'e';
  const direction = north ? (east ? 90 - deg : 90 + deg) : east ? 270 + deg : 270 - deg;
  return (direction * Math.PI) / 180;
}

/**
 * A typed angle as the drafter means it, in radians before ANGBASE and ANGDIR: decimal degrees
 * (an expression), degrees/minutes/seconds (`45d30'15"`), radians (`1.2r`) or grads (`50g`),
 * which AutoCAD accepts whatever AUNITS says; or a surveyor's bearing (`parseBearing`), which
 * is already a direction.
 */
export function parseAngleValue(text: string): number | undefined {
  const t = text.trim();
  const dms = dmsDegrees(t);
  if (dms !== undefined) return (dms * Math.PI) / 180;
  const bearing = parseBearing(t);
  if (bearing !== undefined) return bearing;
  const unit = /^(.*\d\.?)([rg])$/i.exec(t);
  if (unit) {
    const v = parseNumber(unit[1]!);
    if (v === undefined) return undefined;
    return unit[2]!.toLowerCase() === 'r' ? v : (v * Math.PI) / 200;
  }
  const deg = parseNumber(t);
  return deg === undefined ? undefined : (deg * Math.PI) / 180;
}

/** A typed angle turned into a world angle (radians, counter-clockwise from +X). */
export function worldAngle(typed: number, angles: AngleConvention): number {
  return angles.base + (angles.clockwise ? -typed : typed);
}

/** A typed angle in world radians, or undefined. A bearing is a world direction already. */
export function parseAngle(
  text: string,
  angles: AngleConvention = DEFAULT_ANGLES,
): number | undefined {
  const bearing = parseBearing(text);
  if (bearing !== undefined) return bearing;
  const a = parseAngleValue(text);
  return a === undefined ? undefined : worldAngle(a, angles);
}

export interface CoordinateContext {
  /** LASTPOINT: what `@` is relative to; the origin when no point has been given yet. */
  readonly lastPoint?: Vec2 | undefined;
  readonly angles?: AngleConvention;
  /** LUNITS: how a coordinate's lengths read (`parseDistance`); Decimal when not given. */
  readonly lunits?: number;
}

/**
 * A typed coordinate: `x,y` (a third value, Z, is accepted and dropped), `d<a` polar, either
 * with `@` (relative to the last point) or `#`/`*` (absolute), and `@` alone for the last point.
 * `'invalid'` when it is shaped like a coordinate but does not read; undefined when it is not
 * a coordinate at all.
 */
export function parseCoordinate(
  text: string,
  ctx: CoordinateContext = {},
): Vec2 | 'invalid' | undefined {
  // Spaces may stand around the values (`3, 4`), and inside a palette-style `2'-6 1/2"`.
  let t = text.trim();
  let relative = false;
  if (t.startsWith('@')) {
    relative = true;
    t = t.slice(1).trim();
  } else if (t.startsWith('#') || t.startsWith('*')) {
    t = t.slice(1).trim();
  }
  const lunits = ctx.lunits ?? 2;
  const from = ctx.lastPoint ?? { x: 0, y: 0 };
  if (relative && t === '') return from;
  let p: Vec2;
  if (t.includes('<')) {
    const [d, a, ...rest] = t.split('<');
    if (rest.length > 0) return 'invalid';
    const dist = parseDistance(d!, lunits);
    const ang = parseAngle(a!.replace(/\s+/g, ''), ctx.angles);
    if (dist === undefined || ang === undefined) return 'invalid';
    p = { x: dist * Math.cos(ang), y: dist * Math.sin(ang) };
  } else if (t.includes(',')) {
    const parts = t.split(',');
    if (parts.length > 3) return 'invalid';
    const values = parts.map((v) => parseDistance(v, lunits));
    if (values.some((v) => v === undefined)) return 'invalid';
    p = { x: values[0]!, y: values[1]! };
  } else {
    return relative ? 'invalid' : undefined;
  }
  return relative ? { x: from.x + p.x, y: from.y + p.y } : p;
}

/** The point modifiers typed at any point prompt: `FROM`, `M2P` and `.x`-style point filters. */
export type PointModifier =
  | { readonly kind: 'from' }
  | { readonly kind: 'm2p' }
  /** The coordinates taken from the next point; the rest come from the one after. */
  | { readonly kind: 'filter'; readonly take: '' | 'x' | 'y' | 'xy' };

/**
 * `FROM` (or `FRO`), `M2P` (or `MTP`), and the point filters `.X .Y .XY`; `.Z`, `.XZ` and `.YZ`
 * are taken as their 2D part (`.z` takes nothing, so the next point gives X and Y).
 */
export function parsePointModifier(text: string): PointModifier | undefined {
  const t = text.trim().toUpperCase();
  if (t === 'FROM' || t === 'FRO') return { kind: 'from' };
  if (t === 'M2P' || t === 'MTP') return { kind: 'm2p' };
  const filter = /^\.(X|Y|Z|XY|XZ|YZ)$/.exec(t);
  if (!filter) return undefined;
  const take = filter[1]!.replace('Z', '').toLowerCase() as '' | 'x' | 'y' | 'xy';
  return { kind: 'filter', take };
}

/**
 * Each object snap mode's override keyword written out (AutoCAD 2024 Help, "Object Snap
 * Overrides"): a typed override is at least its first three letters (`END`, `ENDP`, `ENDPOINT`).
 * APParent intersection is AutoCAD's `APPINT`; `APPARENT` is taken too, and INSert as
 * `INSERTION`, as the Drafting Settings dialog names it.
 */
const OVERRIDES: readonly (readonly [OsnapMode | 'NON', readonly string[]])[] = [
  ['END', ['ENDPOINT']],
  ['MID', ['MIDPOINT']],
  ['INT', ['INTERSECTION']],
  ['APP', ['APPINT', 'APPARENT']],
  ['EXT', ['EXTENSION']],
  ['CEN', ['CENTER']],
  ['GCE', ['GCENTER']],
  ['QUA', ['QUADRANT']],
  ['TAN', ['TANGENT']],
  ['PER', ['PERPENDICULAR']],
  ['PAR', ['PARALLEL']],
  ['NOD', ['NODE']],
  ['INS', ['INSERTION']],
  ['NEA', ['NEAREST']],
  ['NON', ['NONE']],
];

/**
 * A one-shot object snap override typed at a point prompt (M2-04): the OSMODE bits the next
 * point snaps with, 0 for `NONe` (no object snap for it). Several modes may be given at once,
 * separated by commas (`END,MID`), as AutoCAD takes them; NONe stands alone.
 */
export function parseOsnapOverride(text: string): number | undefined {
  const tokens = text
    .trim()
    .toUpperCase()
    .split(',')
    .map((t) => t.trim());
  let modes = 0;
  for (const token of tokens) {
    if (token.length < 3) return undefined;
    const found = OVERRIDES.find(([, names]) => names.some((n) => n.startsWith(token)));
    if (!found) return undefined;
    if (found[0] === 'NON') {
      if (tokens.length > 1) return undefined;
      return 0;
    }
    modes |= OSNAP[found[0]];
  }
  return modes;
}
