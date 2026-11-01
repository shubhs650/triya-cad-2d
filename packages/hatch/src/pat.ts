// Reader for hatch pattern files (.pat), and the pattern lines a HATCH stores for a pattern
// (M1-16 part 3). The format is AutoCAD's published one ("Overview of Hatch Pattern
// Definitions", AutoCAD help); nothing here comes from an Autodesk .pat file.
//
//   *pattern-name[, description]
//   angle, x-origin, y-origin, delta-x, delta-y [, dash-1, dash-2, ...]
//
// "AutoCAD ignores blank lines and text to the right of a semicolon." Each line is a family of
// parallel lines through the origin at the angle (degrees); the next line of the family is
// delta-x along the line and delta-y across it, measured in the line's own direction; dashes
// are positive, gaps negative, dots zero, and no dashes is a continuous line.

import type { HatchPatternLine, Vec2 } from '@triya/engine';

export interface PatLine {
  /** Degrees, as written. */
  readonly angle: number;
  readonly origin: Vec2;
  /** Along the line (x) and across it (y), in the line's direction. */
  readonly delta: Vec2;
  readonly dashes: readonly number[];
}

export interface PatPattern {
  readonly name: string;
  readonly description: string;
  readonly lines: readonly PatLine[];
}

export interface PatIssue {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly message: string;
}

export interface PatFile {
  readonly patterns: readonly PatPattern[];
  /** Definitions that could not be read; they are left out of `patterns`. */
  readonly errors: readonly PatIssue[];
  /** Definitions that were read but break a documented limit. */
  readonly warnings: readonly PatIssue[];
}

/** "Each line in a pattern definition can contain up to 80 characters." */
const MAX_LINE = 80;
/** "...must begin with a letter or number": letters, digits, _, - and $. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_\-$]*$/;

export function parsePat(source: string): PatFile {
  const patterns: PatPattern[] = [];
  const errors: PatIssue[] = [];
  const warnings: PatIssue[] = [];
  let current: { name: string; description: string; line: number; lines: PatLine[] } | undefined;
  let broken = false;
  const close = () => {
    if (current && !broken) {
      if (current.lines.length === 0)
        errors.push({ line: current.line, message: `*${current.name} has no pattern line` });
      else
        patterns.push({
          name: current.name,
          description: current.description,
          lines: current.lines,
        });
    }
    current = undefined;
    broken = false;
  };

  source.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (raw.length > MAX_LINE)
      warnings.push({ line: n, message: `line exceeds ${MAX_LINE} characters` });
    const semicolon = raw.indexOf(';');
    const line = (semicolon < 0 ? raw : raw.slice(0, semicolon)).trim();
    if (line === '') return;
    if (line.startsWith('*')) {
      close();
      const comma = line.indexOf(',');
      const name = (comma < 0 ? line.slice(1) : line.slice(1, comma)).trim();
      const description = comma < 0 ? '' : line.slice(comma + 1).trim();
      if (!NAME.test(name)) {
        errors.push({ line: n, message: `pattern name "${name}" is not valid` });
        current = { name, description, line: n, lines: [] };
        broken = true;
        return;
      }
      current = { name, description, line: n, lines: [] };
      return;
    }
    if (!current) {
      errors.push({ line: n, message: 'pattern line without a *name line' });
      return;
    }
    if (broken) return;
    const fields = line.split(',').map((f) => f.trim());
    const values = fields.map(Number);
    const bad = fields.findIndex((f, k) => f === '' || !Number.isFinite(values[k]));
    if (fields.length < 5 || bad >= 0) {
      errors.push({
        line: n,
        message:
          fields.length < 5
            ? `${current.name}: a pattern line needs angle, x-origin, y-origin, delta-x and delta-y`
            : `${current.name}: "${fields[bad]}" is not a number`,
      });
      broken = true;
      return;
    }
    const [angle, x, y, dx, dy, ...dashes] = values as [number, number, number, number, number];
    current.lines.push({ angle, origin: { x, y }, delta: { x: dx, y: dy }, dashes });
  });
  close();
  return { patterns, errors, warnings };
}

export interface PatternPlacement {
  /** The hatch's pattern angle (DXF 52), radians. */
  readonly angle: number;
  /** The hatch's pattern scale (DXF 41). */
  readonly scale: number;
  /** The hatch origin: where the pattern's (0, 0) lands. */
  readonly origin?: Vec2;
}

/**
 * A pattern's lines as a HATCH stores them (DXF 53–49): each definition line scaled, turned by
 * the hatch angle about the hatch origin, with its delta turned into the line's direction, as
 * AutoCAD writes them (an ANSI31 hatch at scale 1 stores its 45° line with offset
 * (−0.0884, 0.0884), the 0.125 delta-y across the line).
 */
export function patternLines(p: PatPattern, at: PatternPlacement): HatchPatternLine[] {
  const o = at.origin ?? { x: 0, y: 0 };
  const cos = Math.cos(at.angle);
  const sin = Math.sin(at.angle);
  const turn = (v: Vec2, c: number, s: number): Vec2 => ({
    x: v.x * c - v.y * s,
    y: v.x * s + v.y * c,
  });
  return p.lines.map((l) => {
    const a = (l.angle * Math.PI) / 180 + at.angle;
    const base = turn({ x: l.origin.x * at.scale, y: l.origin.y * at.scale }, cos, sin);
    return {
      angle: a,
      base: { x: o.x + base.x, y: o.y + base.y },
      offset: turn({ x: l.delta.x * at.scale, y: l.delta.y * at.scale }, Math.cos(a), Math.sin(a)),
      dashes: l.dashes.map((d) => d * at.scale),
    };
  });
}

/**
 * A user-defined pattern (DXF 76 = 0): continuous lines at the angle, `spacing` apart, and a
 * second family at 90° to the first when doubled (DXF 77), as AutoCAD's HATCH "User defined"
 * type makes them.
 */
export function userDefinedLines(
  angle: number,
  spacing: number,
  double: boolean,
  origin: Vec2 = { x: 0, y: 0 },
): HatchPatternLine[] {
  const family = (a: number): HatchPatternLine => ({
    angle: a,
    base: origin,
    offset: { x: -Math.sin(a) * spacing, y: Math.cos(a) * spacing },
    dashes: [],
  });
  return double ? [family(angle), family(angle + Math.PI / 2)] : [family(angle)];
}
