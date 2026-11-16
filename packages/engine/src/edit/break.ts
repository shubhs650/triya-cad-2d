// BREAK's, BREAKATPOINT's, LENGTHEN's and REVERSE's geometry (M3-02 part 4), as AutoCAD 2024
// does them (AutoCAD Help, "BREAK (Command)", "LENGTHEN (Command)", "REVERSE (Command)"):
//
// - BREAK erases the part of an object between two points on it and leaves the rest as one or
//   two objects of its kind (an xline as rays, a ray as a line and a ray). On a circle the part
//   removed runs counterclockwise from the first point to the second, leaving an arc; on an
//   ellipse, a closed polyline or a closed spline it runs the object's own way round, leaving an
//   open one. Two equal points split an open object in two (BREAKATPOINT); a closed object
//   cannot be broken at a single point.
// - LENGTHEN changes the length of lines, arcs, open polylines, elliptical arcs and open
//   splines at the end nearer the pick; the other end stays. A lengthened polyline's end segment
//   goes on, straight or round its arc, a spline by a straight piece tangent to its end (as
//   EXTEND adds, M3-12 part 2); a shortened one loses what lies past the new length. Closed
//   objects are not lengthened.
// - REVERSE runs lines, polylines (2D and 3D) and splines the other way: the same shape, its
//   vertices (control points, fit points) in the opposite order, each segment keeping its bulge
//   (negated) and widths (swapped).
//
// The curve each works on is TRIM's (`trimCurveOf`): parameters are its parameters.
import { alongLine } from './line-heights';
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import { arcLengthTable, curveLength, paramAtLength } from '../geom/arclength';
import type { BoundedCurve, Curve, Ellipse, Polyline } from '../geom/curves';
import { closestPoint } from '../geom/closest';
import {
  domain,
  ellipseAxes,
  ellipseSweep,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
} from '../geom/eval';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, dot, length, normalize, scale, sub } from '../geom/vec';
import type {
  ArcGeometry,
  EllipseGeometry,
  EntityGeometry,
  LineGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/types';
import { cleanPolyline } from './offset';
import {
  extendSpline,
  isClosedCurve,
  openSpline,
  splineEnd,
  subGeometry,
  subSpline,
  trimCurveOf,
  withVertices,
} from './trim';

// ── BREAK ──────────────────────────────────────────────────────────────────────────────────

/** Why BREAK could not break an object, in AutoCAD's words where AutoCAD has them. */
export type BreakProblem = 'full circle' | 'closed at a point' | 'nothing left';

/**
 * `g` (whose curve is `c`) with the part between parameters `t1` (the first point) and `t2`
 * (the second) removed: the pieces left, the first being what keeps the object. A problem when
 * it cannot be broken there; the pieces are `[g]` when the points leave it whole (both at one
 * end of an open object).
 */
export function breakGeometry(
  g: EntityGeometry,
  c: Curve,
  t1: number,
  t2: number,
  tol: Tolerance,
): EntityGeometry[] | BreakProblem {
  const d = domain(c);
  if (isClosedCurve(c, tol)) {
    // Points within the tolerance of each other are one point.
    const p1 = pointAt(c, t1);
    const p2 = pointAt(c, t2);
    if (distance(p1, p2) <= tol.linear || t1 === t2) {
      return c.kind === 'CIRCLE' ? 'full circle' : 'closed at a point';
    }
    // What is left runs from the second point round to the first (subGeometry goes round a
    // circle or ellipse counterclockwise, a polyline or spline its own way, through its start).
    const piece = subGeometry(g, c, t2, t1, tol);
    return piece ? [piece] : 'nothing left';
  }
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  const out: EntityGeometry[] = [];
  const before = lo > d.start ? subGeometry(g, c, d.start, lo, tol) : undefined;
  const after = hi < d.end ? subGeometry(g, c, hi, d.end, tol) : undefined;
  if (before) out.push(before);
  if (after) out.push(after);
  if (out.length === 0) return 'nothing left';
  return out;
}

// ── LENGTHEN ───────────────────────────────────────────────────────────────────────────────

/** Why LENGTHEN could not change an object. */
export type LengthenProblem = 'closed' | 'invalid' | 'too long' | 'not an arc';

/** What LENGTHEN reports of an object: its length, and an arc's included angle. */
export function measureLength(c: Curve): { length: number; angle?: number } | undefined {
  if (c.kind === 'RAY' || c.kind === 'XLINE') return undefined;
  const l = curveLength(c);
  if (c.kind === 'ARC') return { length: l, angle: ccwSweep(c.startAngle, c.endAngle) };
  return { length: l };
}

/**
 * Whether the end LENGTHEN changes is the curve's end (else its start): the one nearer, along
 * the curve, to the pick at parameter `t`.
 */
export function movesEnd(c: BoundedCurve, t: number): boolean {
  return lengthUpTo(c, t) > curveLength(c) / 2;
}

/** The length of `c` from its start to parameter `t`. */
function lengthUpTo(c: BoundedCurve, t: number): number {
  const d = domain(c);
  if (t <= d.start) return 0;
  if (t >= d.end) return curveLength(c);
  switch (c.kind) {
    case 'LINE':
      return distance(c.start, c.end) * t;
    case 'CIRCLE':
    case 'ARC':
      return c.radius * (t - d.start);
    case 'ELLIPSE':
      return curveLength({ ...c, endParam: t });
    case 'LWPOLYLINE': {
      const k = Math.floor(t);
      let sum = 0;
      for (let i = 0; i < k; i++) sum += segLength(c, i);
      return sum + segLength(c, k) * (t - k);
    }
    case 'SPLINE': {
      const s = subSpline(c, d.start, t);
      return s ? curveLength(s) : 0;
    }
  }
}

/**
 * `g` (whose curve is `c`) changed to `newLength`, the end (`atEnd`) or start moving and the
 * other staying: shortened by cutting off, lengthened by carrying the end on. A problem when it
 * cannot be: a closed object, a length not above the tolerance, an arc that would close.
 */
export function lengthenGeometry(
  g: EntityGeometry,
  c: Curve,
  atEnd: boolean,
  newLength: number,
  tol: Tolerance,
): EntityGeometry | LengthenProblem {
  if (c.kind === 'RAY' || c.kind === 'XLINE') return 'invalid';
  if (isClosedCurve(c, tol)) return 'closed';
  if (!(newLength > tol.linear) || !Number.isFinite(newLength)) return 'invalid';
  const table = arcLengthTable(c);
  const d = domain(c);
  const current = table.length;
  if (Math.abs(newLength - current) <= tol.linear) return g;
  if (newLength < current) {
    const piece = atEnd
      ? subGeometry(g, c, d.start, paramAtLength(table, newLength), tol)
      : subGeometry(g, c, paramAtLength(table, current - newLength), d.end, tol);
    return piece ?? 'invalid';
  }
  const more = newLength - current;
  switch (c.kind) {
    case 'LINE': {
      const l = g as LineGeometry;
      const dir = normalize(sub(c.end, c.start));
      return atEnd
        ? alongLine(l, l.start, add(c.end, scale(dir, more)))
        : alongLine(l, sub(c.start, scale(dir, more)), l.end);
    }
    case 'ARC': {
      const sweep = newLength / c.radius;
      if (sweep >= TAU - tol.angular) return 'too long';
      const a = g as ArcGeometry;
      return atEnd
        ? { ...a, endAngle: normalizeAngle(c.startAngle + sweep) }
        : { ...a, startAngle: normalizeAngle(c.endAngle - sweep) };
    }
    case 'ELLIPSE':
      return lengthenEllipse(g as EllipseGeometry, c, atEnd, newLength, tol);
    case 'LWPOLYLINE':
      return lengthenPolyline(g as LwPolylineGeometry | PolylineGeometry, c, atEnd, more, tol);
    case 'SPLINE':
      return openSpline(
        g as SplineGeometry,
        extendSpline(subSpline(c, d.start, d.end)!, atEnd, more),
      );
    default:
      return 'invalid';
  }
}

/**
 * An elliptical arc grown round its ellipse to `newLength` from its fixed end: the new end is
 * found by length along the whole ellipse from the fixed end, going the arc's way.
 */
function lengthenEllipse(
  g: EllipseGeometry,
  c: Ellipse,
  atEnd: boolean,
  newLength: number,
  tol: Tolerance,
): EntityGeometry | LengthenProblem {
  const sweep = ellipseSweep(c);
  const fixed = atEnd ? c.startParam : c.startParam + sweep;
  // The whole ellipse, from the fixed end round (counterclockwise) to it again, a hair short.
  const whole: Ellipse = { ...c, startParam: fixed, endParam: fixed + TAU * (1 - 1e-12) };
  const table = arcLengthTable(whole);
  if (newLength >= table.length - tol.linear) return 'too long';
  if (atEnd) {
    return { ...g, endParam: normalizeAngle(paramAtLength(table, newLength)) };
  }
  // Going clockwise from the end: the counterclockwise length from the end is the rest.
  return { ...g, startParam: normalizeAngle(paramAtLength(table, table.length - newLength)) };
}

/** An open polyline's end (or start) segment carried on by `more`, straight or round. */
function lengthenPolyline(
  g: LwPolylineGeometry | PolylineGeometry,
  c: Polyline,
  atEnd: boolean,
  more: number,
  tol: Tolerance,
): EntityGeometry | LengthenProblem {
  const n = polylineSegmentCount(c);
  const i = atEnd ? n - 1 : 0;
  const seg = polylineSegment(c, i);
  const vs = c.vertices.map((v) => ({ ...v }));
  const moving = atEnd ? vs[n]! : vs[0]!;
  if ('line' in seg) {
    const dir = normalize(sub(seg.line.b, seg.line.a));
    const p = atEnd ? add(seg.line.b, scale(dir, more)) : sub(seg.line.a, scale(dir, more));
    moving.x = p.x;
    moving.y = p.y;
  } else {
    const { center, radius, startAngle, sweep } = seg.arc;
    const grown = Math.abs(sweep) + more / radius;
    if (grown >= TAU - tol.angular) return 'too long';
    const signed = Math.sign(sweep) * grown;
    const p = atEnd
      ? add(center, fromAngle(startAngle + signed, radius))
      : add(center, fromAngle(startAngle + sweep - signed, radius));
    moving.x = p.x;
    moving.y = p.y;
    vs[i]!.bulge = Math.tan(signed / 4);
  }
  return withVertices(g, cleanPolyline(g).index, vs, n);
}

const fromAngle = (theta: number, r: number): Vec2 => ({
  x: r * Math.cos(theta),
  y: r * Math.sin(theta),
});

/**
 * LENGTHEN DYnamic: the length `c` would have with its moving end (`atEnd`) dragged to `p`,
 * measured along the line, arc, elliptical arc or end segment it would follow; undefined when
 * `p` gives no length (on the fixed end, or behind it).
 */
export function lengthTo(c: Curve, atEnd: boolean, p: Vec2, tol: Tolerance): number | undefined {
  if (c.kind === 'RAY' || c.kind === 'XLINE' || c.kind === 'CIRCLE') return undefined;
  const positive = (v: number) => (v > tol.linear ? v : undefined);
  switch (c.kind) {
    case 'LINE': {
      const [from, to] = atEnd ? [c.start, c.end] : [c.end, c.start];
      return positive(dot(sub(p, from), normalize(sub(to, from))));
    }
    case 'ARC': {
      const a = angleOf(sub(p, c.center));
      const sweep = atEnd ? ccwSweep(c.startAngle, a) : ccwSweep(a, c.endAngle);
      return positive(c.radius * (sweep % TAU));
    }
    case 'ELLIPSE': {
      const t = ellipseParamOf(c, p);
      const sweep = atEnd ? ccwSweep(c.startParam, t) : ccwSweep(t, c.startParam + ellipseSweep(c));
      if (!(sweep > 0) || sweep >= TAU) return undefined;
      const part: Ellipse = atEnd
        ? { ...c, endParam: c.startParam + sweep }
        : { ...c, startParam: t, endParam: c.startParam + ellipseSweep(c) };
      return positive(curveLength(part));
    }
    case 'LWPOLYLINE': {
      const n = polylineSegmentCount(c);
      const total = curveLength(c);
      const i = atEnd ? n - 1 : 0;
      const seg = polylineSegment(c, i);
      const lengths = Array.from({ length: n }, (_, k) => segLength(c, k));
      const rest = total - lengths[i]!;
      let along: number;
      if ('line' in seg) {
        const [from, to] = atEnd ? [seg.line.a, seg.line.b] : [seg.line.b, seg.line.a];
        along = dot(sub(p, from), normalize(sub(to, from)));
      } else {
        const { center, radius, startAngle, sweep } = seg.arc;
        const a = angleOf(sub(p, center));
        const end = startAngle + sweep;
        // Round the arc's way from its fixed end.
        const turn = atEnd
          ? sweep > 0
            ? ccwSweep(startAngle, a)
            : ccwSweep(a, startAngle)
          : sweep > 0
            ? ccwSweep(a, end)
            : ccwSweep(end, a);
        along = radius * (turn % TAU);
      }
      return positive(rest + along);
    }
    case 'SPLINE': {
      // Past the moving end, along the straight piece LENGTHEN would add there.
      const end = splineEnd(c, atEnd);
      const past = dot(sub(p, end.point), end.direction);
      if (past > tol.linear) return curveLength(c) + past;
      const t = closestPoint(c, p, tol).t;
      const to = lengthUpTo(c, t);
      return positive(atEnd ? to : curveLength(c) - to);
    }
  }
}

function segLength(c: Polyline, i: number): number {
  const seg = polylineSegment(c, i);
  return 'line' in seg
    ? distance(seg.line.a, seg.line.b)
    : seg.arc.radius * Math.abs(seg.arc.sweep);
}

/** The parameter of the ellipse point in the direction of `p` from the centre. */
function ellipseParamOf(e: Ellipse, p: Vec2): number {
  const { major, minor } = ellipseAxes(e);
  const v = sub(p, e.center);
  const a = length(major);
  const b = length(minor);
  return normalizeAngle(Math.atan2(dot(v, minor) / (b * b), dot(v, major) / (a * a)));
}

// ── REVERSE ────────────────────────────────────────────────────────────────────────────────

/** `g` run the other way (REVERSE), or undefined for an object REVERSE leaves alone. */
export function reverseGeometry(g: EntityGeometry): EntityGeometry | undefined {
  switch (g.kind) {
    case 'LINE': {
      const turned = { ...g, start: g.end, end: g.start };
      return g.heights ? { ...turned, heights: [g.heights[1], g.heights[0]] } : turned;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return g.vertices.length < 2 ? undefined : reversePolyline(g);
    case 'SPLINE':
      return reverseSpline(g);
    default:
      return undefined;
  }
}

function reversePolyline(g: LwPolylineGeometry | PolylineGeometry): EntityGeometry {
  const n = g.vertices.length;
  const dsw = g.kind === 'POLYLINE' ? (g.startWidth ?? 0) : 0;
  const dew = g.kind === 'POLYLINE' ? (g.endWidth ?? 0) : 0;
  const vertices: PolylineVertex[] = [];
  for (let k = 0; k < n; k++) {
    const v = g.vertices[n - 1 - k]!;
    // The segment from the new vertex k is the old segment j = n − 2 − k run backwards (the
    // closing one, from the old last vertex, for k = n − 1 of a closed polyline).
    const j = (n - 2 - k + n) % n;
    const last = k === n - 1 && !g.closed;
    const s = g.vertices[j]!;
    const sw = last ? 0 : (s.endWidth ?? dew);
    const ew = last ? 0 : (s.startWidth ?? dsw);
    const { startWidth: _sw, endWidth: _ew, bulge: _b, tangent, ...rest } = v;
    const bulge = last || s.bulge === 0 ? 0 : -s.bulge;
    // A zero width is no width, as the file maps it (and as TRIM writes it).
    vertices.push({
      ...rest,
      // A curve-fit tangent (M3-16) turns round with the travel, kept in (−π, π].
      ...(tangent !== undefined && {
        tangent: tangent > 0 ? tangent - Math.PI : tangent + Math.PI,
      }),
      bulge,
      ...((sw !== 0 || ew !== 0) && { startWidth: sw, endWidth: ew }),
    });
  }
  if (g.kind === 'LWPOLYLINE') return { ...g, vertices };
  const { startWidth: _sw, endWidth: _ew, ...rest } = g;
  return {
    ...rest,
    vertices,
    ...(g.frame && { frame: [...g.frame].reverse() }),
  };
}

function reverseSpline(g: SplineGeometry): SplineGeometry {
  const lo = g.knots[0] ?? 0;
  const hi = g.knots.at(-1) ?? 0;
  const negate = (v: Vec2 | undefined) => v && { x: -v.x + 0, y: -v.y + 0 };
  const { startTangent: _st, endTangent: _et, fitPoints: _fp, weights: _w, ...rest } = g;
  const start = negate(g.endTangent);
  const end = negate(g.startTangent);
  return {
    ...rest,
    knots: g.knots.map((k) => lo + hi - k).reverse(),
    controlPoints: [...g.controlPoints].reverse(),
    ...(g.weights && { weights: [...g.weights].reverse() }),
    ...(g.fitPoints && { fitPoints: [...g.fitPoints].reverse() }),
    ...(start && { startTangent: start }),
    ...(end && { endTangent: end }),
  };
}

/** The curve BREAK, BREAKATPOINT and LENGTHEN work on: TRIM's. */
export const breakCurveOf = trimCurveOf;
