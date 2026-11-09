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

/** How the drawing measures typed angles: ANGBASE (radians, the 0 direction) and ANGDIR. */
export interface AngleConvention {
  readonly base: number;
  readonly clockwise: boolean;
}

export const DEFAULT_ANGLES: AngleConvention = { base: 0, clockwise: false };

const DMS = /^([+-]?)(\d+(?:\.\d*)?)d(?:(\d+(?:\.\d*)?)')?(?:(\d+(?:\.\d*)?)")?$/i;

/**
 * A typed angle as the drafter means it, in radians before ANGBASE and ANGDIR: decimal degrees
 * (an expression), degrees/minutes/seconds (`45d30'15"`), radians (`1.2r`) or grads (`50g`),
 * which AutoCAD accepts whatever AUNITS says.
 */
export function parseAngleValue(text: string): number | undefined {
  const t = text.trim();
  const dms = DMS.exec(t);
  if (dms) {
    const deg = Number(dms[2]) + Number(dms[3] ?? 0) / 60 + Number(dms[4] ?? 0) / 3600;
    return ((dms[1] === '-' ? -deg : deg) * Math.PI) / 180;
  }
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

/** A typed angle in world radians, or undefined. */
export function parseAngle(
  text: string,
  angles: AngleConvention = DEFAULT_ANGLES,
): number | undefined {
  const a = parseAngleValue(text);
  return a === undefined ? undefined : worldAngle(a, angles);
}

export interface CoordinateContext {
  /** LASTPOINT: what `@` is relative to; the origin when no point has been given yet. */
  readonly lastPoint?: Vec2 | undefined;
  readonly angles?: AngleConvention;
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
  let t = text.trim().replace(/\s+/g, '');
  let relative = false;
  if (t.startsWith('@')) {
    relative = true;
    t = t.slice(1);
  } else if (t.startsWith('#') || t.startsWith('*')) {
    t = t.slice(1);
  }
  const from = ctx.lastPoint ?? { x: 0, y: 0 };
  if (relative && t === '') return from;
  let p: Vec2;
  if (t.includes('<')) {
    const [d, a, ...rest] = t.split('<');
    if (rest.length > 0) return 'invalid';
    const dist = parseNumber(d!);
    const ang = parseAngle(a!, ctx.angles);
    if (dist === undefined || ang === undefined) return 'invalid';
    p = { x: dist * Math.cos(ang), y: dist * Math.sin(ang) };
  } else if (t.includes(',')) {
    const parts = t.split(',');
    if (parts.length > 3) return 'invalid';
    const values = parts.map(parseNumber);
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
