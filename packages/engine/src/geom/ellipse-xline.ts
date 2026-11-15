// Constructions for ELLIPSE, XLINE, RAY and DONUT (M3-01 part 4), as AutoCAD 2024's commands make
// them (AutoCAD 2024 Help, "ELLIPSE (Command)", "XLINE (Command)", "DONUT (Command)").
//
// An ellipse is drawn from its first axis (a half-axis vector from the centre, whichever of the
// two it turns out to be) and the other half-axis length. Its DXF form needs the major axis and
// a ratio ≤ 1, so when the second axis is the longer one the major axis turns a quarter and the
// DXF parameters shift by −π/2. Elliptical arcs are asked in the first axis's frame: an angle
// counts counter-clockwise from the first axis endpoint (ELLIPSE help: "The angle of the first
// axis determines the angle of the elliptical arc"), and a parameter u is that of
// p(u) = c + a·cos u + b·sin u with a the first half-axis and b the second, CCW from it.
import { normalizeAngle, TAU } from './angle';
import { arcThrough3 } from './construct';
import type { Ellipse, Xline } from './curves';
import { pointAt } from './eval';
import type { BulgeVertex } from './curves';
import type { Tolerance } from './tolerance';
import type { Vec2 } from './types';
import { add, angleOf, cross, length, normalize, perp, scale, sub } from './vec';

/** An ellipse being drawn: its centre, first half-axis vector and the other half-axis length. */
export interface EllipseAxes {
  readonly center: Vec2;
  /** From the centre to the first axis endpoint given. */
  readonly axis: Vec2;
  /** Half the other axis, which runs CCW a quarter turn from `axis`. */
  readonly other: number;
}

/**
 * The DXF ELLIPSE of `e`, whole or from first-axis parameter `u0` to `u1` (CCW); undefined when
 * an axis is degenerate.
 */
export function ellipseOf(e: EllipseAxes, tol: Tolerance, u0 = 0, u1 = TAU): Ellipse | undefined {
  const a = length(e.axis);
  const b = Math.abs(e.other);
  if (!(a > tol.linear) || !(b > tol.linear)) return undefined;
  const sweep = u1 - u0;
  const whole =
    sweep >= TAU - tol.angular || Math.abs(normalizeAngle(u1) - normalizeAngle(u0)) <= tol.angular;
  const shift = b > a ? -Math.PI / 2 : 0;
  const majorAxis = b > a ? scale(normalize(perp(e.axis)), b) : e.axis;
  const ratio = b > a ? a / b : b / a;
  if (whole)
    return { kind: 'ELLIPSE', center: e.center, majorAxis, ratio, startParam: 0, endParam: TAU };
  // DXF parameters in [0, 2π); the curve runs CCW from start to end, wrapping past 2π.
  const startParam = normalizeAngle(u0 + shift);
  const endParam = normalizeAngle(u1 + shift);
  return { kind: 'ELLIPSE', center: e.center, majorAxis, ratio, startParam, endParam };
}

/**
 * The first-axis parameter of the point at `angle` from the first axis (ELLIPSE Arc's Angle
 * mode): where the ray from the centre at that angle meets the ellipse.
 */
export function parameterAtAngle(e: EllipseAxes, angle: number): number {
  const a = length(e.axis);
  const b = Math.abs(e.other);
  return normalizeAngle(Math.atan2(Math.sin(angle) / b, Math.cos(angle) / a));
}

/** The world angle a typed arc angle counts from: the first axis's direction. */
export const firstAxisAngle = (e: EllipseAxes): number => angleOf(e.axis);

/** The angle from the first axis of `p` seen from the centre, in [0, 2π). */
export function angleFromAxis(e: EllipseAxes, p: Vec2): number {
  return normalizeAngle(angleOf(sub(p, e.center)) - angleOf(e.axis));
}

/**
 * ELLIPSE Rotation: the other half-axis of a circle on the first axis turned `rotation` about it
 * (cos of the rotation, either way); undefined past 89.4°, which AutoCAD refuses.
 */
export function otherFromRotation(axis: Vec2, rotation: number): number | undefined {
  const k = Math.abs(Math.cos(rotation));
  return k < Math.cos((89.4 * Math.PI) / 180) - 1e-12 ? undefined : length(axis) * k;
}

/** An XLINE through `base` along `direction` (normalised), or undefined for a zero direction. */
export function xlineThrough(base: Vec2, direction: Vec2, tol: Tolerance): Xline | undefined {
  if (!(length(direction) > tol.linear)) return undefined;
  return { kind: 'XLINE', base, direction: normalize(direction) };
}

/**
 * XLINE Bisect: the line through `vertex` halving the angle from `start` to `end` (the one
 * AutoCAD draws: between the two rays from the vertex); undefined when a point is the vertex.
 */
export function bisector(vertex: Vec2, start: Vec2, end: Vec2, tol: Tolerance): Xline | undefined {
  const u = sub(start, vertex);
  const v = sub(end, vertex);
  if (!(length(u) > tol.linear) || !(length(v) > tol.linear)) return undefined;
  const s = add(normalize(u), normalize(v));
  // Rays pointing opposite ways: the bisector is square to them.
  const d = length(s) > 1e-9 ? s : perp(normalize(u));
  return { kind: 'XLINE', base: vertex, direction: normalize(d) };
}

/** A straight line an XLINE can be drawn from: a point on it and its direction. */
export interface StraightLine {
  readonly point: Vec2;
  readonly direction: Vec2;
}

/**
 * XLINE Offset: the xline parallel to `line` at `distance` on the side of `side`, or through
 * `side` when no distance is given (Through); undefined when `side` is on the line.
 */
export function offsetXline(
  line: StraightLine,
  side: Vec2,
  distance: number | undefined,
  tol: Tolerance,
): Xline | undefined {
  const d = normalize(line.direction);
  const off = cross(d, sub(side, line.point));
  if (distance === undefined) {
    return { kind: 'XLINE', base: side, direction: d };
  }
  if (Math.abs(off) <= tol.linear) return undefined;
  const n = scale(perp(d), Math.sign(off) * distance);
  // The base stays across from the line's own point, as an offset of it.
  return { kind: 'XLINE', base: add(line.point, n), direction: d };
}

/**
 * DONUT: a closed two-arc polyline round `center` whose width covers `inside` to `outside`
 * diameter, as AutoCAD draws one (a zero inside diameter fills the circle). The vertices run
 * left then right of the centre with bulge 1 (half circles).
 */
export function donutOf(
  center: Vec2,
  inside: number,
  outside: number,
): { vertices: BulgeVertex[]; width: number } {
  const lo = Math.min(inside, outside);
  const hi = Math.max(inside, outside);
  const r = (lo + hi) / 4;
  return {
    vertices: [
      { x: center.x - r, y: center.y, bulge: 1 },
      { x: center.x + r, y: center.y, bulge: 1 },
    ],
    width: (hi - lo) / 2,
  };
}

/** How many arcs a polyline ellipse is made of (PELLIPSE 1): four to each quadrant. */
export const POLYLINE_ELLIPSE_ARCS = 16;

/**
 * A whole ellipse as the closed polyline of arcs PELLIPSE 1 draws (M3-01 part 6; AutoCAD 2024
 * Help, "PELLIPSE (System Variable)": "Creates a polyline representation of an ellipse"). The
 * help says no more: the vertices are at equal steps of the DXF parameter from the major axis
 * end, sixteen of them, and each arc passes through the ellipse at its middle parameter too,
 * which keeps it within 0.08% of the major radius at a ratio of a half, 0.35% at any ratio. Undefined when the
 * ellipse is too flat to make arcs of.
 */
export function ellipsePolyline(e: Ellipse, tol: Tolerance): BulgeVertex[] | undefined {
  const n = POLYLINE_ELLIPSE_ARCS;
  const vertices: BulgeVertex[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = (TAU * i) / n;
    const p = pointAt(e, t0);
    const arc = arcThrough3(p, pointAt(e, t0 + Math.PI / n), pointAt(e, t0 + TAU / n), tol);
    if (!arc) return undefined;
    vertices.push({ x: p.x, y: p.y, bulge: Math.tan(arc.sweep / 4) });
  }
  return vertices;
}
