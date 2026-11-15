// TRIM's and EXTEND's geometry (M3-02 part 2), as AutoCAD 2024 trims and extends (AutoCAD 2024
// Help, "TRIM (Command)", "EXTEND (Command)", EDGEMODE):
//
// - Objects that can be trimmed: lines, arcs, circles, ellipses, splines, rays, xlines and 2D
//   polylines (LWPOLYLINE and 2D POLYLINE; a curve- or spline-fit one is trimmed as the curve it
//   draws and loses its fit, as OFFSET makes it). The part picked is removed up to the nearest
//   cutting edge on each side: an open object loses the stretch between the edges around the
//   pick (or from the edge to its end), a closed one (circle, ellipse, closed polyline, closed
//   spline) the stretch between the edges either side, going round. A circle is left as an arc,
//   a closed ellipse as an elliptical arc, a closed polyline or spline as an open one, an xline
//   as rays, a ray as a line and a ray.
// - Objects that can be extended: lines, arcs, elliptical arcs and open 2D polylines (their end
//   segment, straight or curved). The end nearer the pick goes on, along the line or round the
//   circle or ellipse, to the nearest boundary edge it meets. An arc stops short of closing.
// - Cutting and boundary edges are the curves of lines, arcs, circles, ellipses, splines, rays,
//   xlines and polylines (3D ones in plan). With EDGEMODE 1 (Edge Extend) an edge also cuts where
//   it would if it went on: a line or ray as an xline, an arc as its circle, an elliptical arc as
//   its ellipse, an open polyline's end segments past its ends.
// - Points where an object only touches an edge at its own end are no cut: a line already
//   ending on an edge is trimmed (or extended) to the next one.
//
// Lengths along the object come from its curve's parameter (geom/curves.ts); everything is to
// the drawing's tolerance (DEC-036).
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import type { Curve, Polyline, Spline } from '../geom/curves';
import { closestPoint } from '../geom/closest';
import {
  arcSweep,
  domain,
  ellipseSweep,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
} from '../geom/eval';
import { intersect } from '../geom/intersect';
import { findSpan } from '../geom/nurbs';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { distance, length, neg, normalize, sub } from '../geom/vec';
import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  EntityGeometry,
  LineGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/types';
import { cleanPolyline, offsetCurveOf, segmentWidths } from './offset';

type Widths = readonly (readonly [number, number])[] | undefined;

/** The curve TRIM cuts and EXTEND lengthens `g` as, or undefined for an object it cannot. */
export function trimCurveOf(g: EntityGeometry): Curve | undefined {
  return offsetCurveOf(g);
}

/**
 * The curves `g` cuts or bounds others with, as an edge: its own, and with `extend` (EDGEMODE 1)
 * those it would make if it went on. None for an object that is no edge.
 */
export function edgeCurvesOf(g: EntityGeometry, extend: boolean): Curve[] {
  let c: Curve | undefined;
  if (g.kind === 'POLYLINE' && g.is3d) {
    const p = cleanPolyline({ ...g, vertices: g.vertices.map((v) => ({ ...v, bulge: 0 })) }).curve;
    c = polylineSegmentCount(p) > 0 ? p : undefined;
  } else c = offsetCurveOf(g);
  if (!c) return [];
  if (!extend) return [c];
  switch (c.kind) {
    case 'LINE': {
      const d = sub(c.end, c.start);
      return length(d) > 0 ? [{ kind: 'XLINE', base: c.start, direction: d }] : [c];
    }
    case 'RAY':
      return [{ kind: 'XLINE', base: c.base, direction: c.direction }];
    case 'ARC':
      return [{ kind: 'CIRCLE', center: c.center, radius: c.radius }];
    case 'ELLIPSE':
      return [{ ...c, startParam: 0, endParam: TAU }];
    case 'LWPOLYLINE':
      return c.closed ? [c] : [c, ...polylineEndExtensions(c)];
    default:
      return [c];
  }
}

/** An open polyline's end segments carried on past its ends: rays, or the circles of arcs. */
function polylineEndExtensions(p: Polyline): Curve[] {
  const n = polylineSegmentCount(p);
  const out: Curve[] = [];
  for (const [i, back] of [
    [0, true],
    [n - 1, false],
  ] as const) {
    const seg = polylineSegment(p, i);
    if ('arc' in seg) {
      out.push({ kind: 'CIRCLE', center: seg.arc.center, radius: seg.arc.radius });
      continue;
    }
    const d = sub(seg.line.b, seg.line.a);
    if (length(d) === 0) continue;
    out.push(
      back
        ? { kind: 'RAY', base: seg.line.a, direction: neg(d) }
        : { kind: 'RAY', base: seg.line.b, direction: d },
    );
  }
  return out;
}

/** Whether `c` closes on itself (and so is trimmed going round). */
export function isClosedCurve(c: Curve, tol: Tolerance): boolean {
  switch (c.kind) {
    case 'CIRCLE':
      return true;
    case 'ELLIPSE':
      return ellipseSweep(c) === TAU;
    case 'LWPOLYLINE':
      return c.closed;
    case 'SPLINE': {
      const d = domain(c);
      return distance(pointAt(c, d.start), pointAt(c, d.end)) <= tol.linear;
    }
    default:
      return false;
  }
}

/**
 * Where the edges cut `c`: the parameters of its crossings with them, sorted and each once,
 * leaving out the ends of an open curve (an object ending on an edge is not cut there). A
 * polyline's cut within the tolerance of a vertex is at the vertex.
 */
export function cutParams(c: Curve, edges: readonly Curve[], tol: Tolerance): number[] {
  const d = domain(c);
  const closed = isClosedCurve(c, tol);
  const ends: Vec2[] = [];
  if (!closed && Number.isFinite(d.start)) ends.push(pointAt(c, d.start));
  if (!closed && Number.isFinite(d.end)) ends.push(pointAt(c, d.end));
  const found: { t: number; p: Vec2 }[] = [];
  for (const e of edges) {
    for (const x of intersect(c, e, tol)) {
      if (ends.some((q) => distance(q, x.point) <= tol.linear)) continue;
      if (found.some((f) => distance(f.p, x.point) <= tol.linear)) continue;
      let t = x.ta;
      if (c.kind === 'LWPOLYLINE') {
        const k = Math.round(t);
        if (distance(pointAt(c, k), x.point) <= tol.linear) t = k;
      }
      found.push({ t, p: x.point });
    }
  }
  return found.map((f) => f.t).sort((a, b) => a - b);
}

/** The parameter on `c` nearest the point picked. */
export function pickParam(c: Curve, p: Vec2, tol: Tolerance): number {
  return closestPoint(c, p, tol).t;
}

/**
 * TRIM: `g` (whose curve is `c`) without the part around parameter `t` between the cuts either
 * side: what is left of it (empty when nothing is), or undefined when no cut bounds that part
 * (no cut at all, or a closed object cut only once).
 */
export function trimGeometry(
  g: EntityGeometry,
  c: Curve,
  cuts: readonly number[],
  t: number,
  tol: Tolerance,
): EntityGeometry[] | undefined {
  const d = domain(c);
  if (isClosedCurve(c, tol)) {
    if (cuts.length < 2) return undefined;
    const lo = [...cuts].reverse().find((x) => x < t) ?? cuts.at(-1)!;
    const hi = cuts.find((x) => x > t) ?? cuts[0]!;
    const piece = subGeometry(g, c, hi, lo, tol);
    return piece ? [piece] : [];
  }
  const lo = [...cuts].reverse().find((x) => x < t);
  const hi = cuts.find((x) => x > t);
  if (lo === undefined && hi === undefined) return undefined;
  const out: EntityGeometry[] = [];
  if (lo !== undefined) {
    const piece = subGeometry(g, c, d.start, lo, tol);
    if (piece) out.push(piece);
  }
  if (hi !== undefined) {
    const piece = subGeometry(g, c, hi, d.end, tol);
    if (piece) out.push(piece);
  }
  return out;
}

/**
 * The part of `g` (whose curve is `c`) from parameter `t0` to `t1`; on a closed curve `t1` before
 * `t0` goes round through the curve's start. Undefined when nothing is left (a point).
 */
export function subGeometry(
  g: EntityGeometry,
  c: Curve,
  t0: number,
  t1: number,
  tol: Tolerance,
): EntityGeometry | undefined {
  if (t0 === t1) return undefined;
  switch (c.kind) {
    case 'LINE': {
      const a = pointAt(c, t0);
      const b = pointAt(c, t1);
      if (distance(a, b) <= tol.linear) return undefined;
      return { ...(g as LineGeometry), start: a, end: b };
    }
    case 'RAY':
    case 'XLINE': {
      const dir = normalize(c.direction);
      if (t0 === -Infinity && t1 === Infinity) return g;
      if (t1 === Infinity) return { kind: 'RAY', base: pointAt(c, t0), direction: dir };
      if (t0 === -Infinity) {
        // (+ 0: no −0 in the file.)
        const back = { x: -dir.x + 0, y: -dir.y + 0 };
        return { kind: 'RAY', base: pointAt(c, t1), direction: back };
      }
      const a = pointAt(c, t0);
      const b = pointAt(c, t1);
      return distance(a, b) <= tol.linear ? undefined : { kind: 'LINE', start: a, end: b };
    }
    case 'CIRCLE':
    case 'ARC': {
      const startAngle = normalizeAngle(t0);
      const endAngle = normalizeAngle(t1);
      if (c.radius * Math.abs(ccwSweep(startAngle, endAngle) % TAU) <= tol.linear) return undefined;
      const out: ArcGeometry = { ...(g as CircleGeometry), kind: 'ARC', startAngle, endAngle };
      return out;
    }
    case 'ELLIPSE': {
      const startParam = normalizeAngle(t0);
      const endParam = normalizeAngle(t1);
      if (distance(pointAt(c, t0), pointAt(c, t1)) <= tol.linear) return undefined;
      return { ...(g as EllipseGeometry), startParam, endParam };
    }
    case 'LWPOLYLINE':
      return subPolyline(g as LwPolylineGeometry | PolylineGeometry, c, t0, t1, tol);
    case 'SPLINE': {
      const d = domain(c);
      const s =
        t1 > t0
          ? subSpline(c, t0, t1)
          : joinSplines(subSpline(c, t0, d.end), subSpline(c, d.start, t1));
      if (!s) return undefined;
      const src = g as SplineGeometry;
      const out: SplineGeometry = {
        kind: 'SPLINE',
        degree: s.degree,
        knots: s.knots,
        controlPoints: s.controlPoints,
        ...(s.weights && { weights: s.weights }),
        closed: false,
        periodic: false,
        ...(src.normal && { normal: src.normal }),
      };
      return out;
    }
  }
}

// ── Polylines ──────────────────────────────────────────────────────────────────────────────

/** A polyline's segment `i` from fraction `s0` to `s1` of it: its start point and bulge. */
function segmentPart(p: Polyline, i: number, s0: number, s1: number): { a: Vec2; bulge: number } {
  const v = p.vertices[i]!;
  const a = pointAt(p, i + s0);
  return { a, bulge: v.bulge === 0 ? 0 : Math.tan(Math.atan(v.bulge) * (s1 - s0)) };
}

/** The part of a polyline from `t0` to `t1` (going round a closed one when `t1 < t0`). */
function subPolyline(
  g: LwPolylineGeometry | PolylineGeometry,
  c: Polyline,
  t0: number,
  t1: number,
  tol: Tolerance,
): EntityGeometry | undefined {
  const n = polylineSegmentCount(c);
  const end = t1 > t0 ? t1 : t1 + n;
  const widths = segmentWidths(g, cleanPolyline(g).index, n);
  const vertices: PolylineVertex[] = [];
  for (let k = Math.floor(t0); k < end; k++) {
    const s0 = Math.max(t0, k) - k;
    const s1 = Math.min(end, k + 1) - k;
    if (s1 - s0 <= 0) continue;
    const i = k % n;
    const { a, bulge } = segmentPart(c, i, s0, s1);
    const w = widths?.[i];
    const sw = w ? w[0] + (w[1] - w[0]) * s0 : 0;
    const ew = w ? w[0] + (w[1] - w[0]) * s1 : 0;
    // A zero width is no width, as the file maps it.
    vertices.push({
      x: a.x,
      y: a.y,
      bulge,
      ...((sw !== 0 || ew !== 0) && { startWidth: sw, endWidth: ew }),
    });
  }
  const last = pointAt(c, end > n ? end - n : end);
  vertices.push({ x: last.x, y: last.y, bulge: 0 });
  // A part that is no longer than the tolerance is nothing.
  if (vertices.length === 2 && distance(vertices[0]!, vertices[1]!) <= tol.linear) return undefined;
  if (g.kind === 'LWPOLYLINE') return { ...g, vertices, closed: false };
  const { fit: _fit, frame: _frame, ...rest } = g;
  return { ...rest, vertices, closed: false };
}

// ── Splines ────────────────────────────────────────────────────────────────────────────────

interface Homogeneous {
  readonly degree: number;
  knots: number[];
  /** x·w, y·w, w. */
  points: [number, number, number][];
}

const toHomogeneous = (s: Spline): Homogeneous => ({
  degree: s.degree,
  knots: [...s.knots],
  points: s.controlPoints.map((p, i) => {
    const w = s.weights?.[i] ?? 1;
    return [p.x * w, p.y * w, w];
  }),
});

function fromHomogeneous(h: Homogeneous, rational: boolean): Spline {
  const weights = h.points.map((q) => q[2]);
  return {
    kind: 'SPLINE',
    degree: h.degree,
    knots: h.knots,
    controlPoints: h.points.map((q) => ({ x: q[0] / q[2], y: q[1] / q[2] })),
    ...(rational && { weights }),
  };
}

/** Inserts knot `u` once (Boehm; The NURBS Book A5.1 with r = 1). */
function insertKnot(h: Homogeneous, u: number): void {
  const p = h.degree;
  const U = h.knots;
  const P = h.points;
  const k = findSpan(P.length - 1, p, u, U);
  const Q: [number, number, number][] = [];
  for (let i = 0; i <= k - p; i++) Q.push(P[i]!);
  for (let i = k - p + 1; i <= k; i++) {
    const alpha = (u - U[i]!) / (U[i + p]! - U[i]!);
    const a = P[i]!;
    const b = P[i - 1]!;
    Q.push([
      alpha * a[0] + (1 - alpha) * b[0],
      alpha * a[1] + (1 - alpha) * b[1],
      alpha * a[2] + (1 - alpha) * b[2],
    ]);
  }
  for (let i = k; i < P.length; i++) Q.push(P[i]!);
  U.splice(k + 1, 0, u);
  h.points = Q;
}

/** `u` snapped to a knot within rounding of it, so that inserting it does not split a hair. */
function snapKnot(U: readonly number[], u: number): number {
  const span = U.at(-1)! - U[0]!;
  const near = U.find((x) => Math.abs(x - u) <= 1e-12 * (span || 1));
  return near ?? u;
}

/** Inserts `u` until it is a knot of multiplicity `degree` at least. */
function makeBreak(h: Homogeneous, u: number): void {
  const m = h.knots.filter((x) => x === u).length;
  for (let r = m; r < h.degree; r++) insertKnot(h, u);
}

/** The NURBS of `s` from `a` to `b` (a < b, both in its domain), clamped at both ends. */
export function subSpline(s: Spline, a: number, b: number): Spline | undefined {
  const h = toHomogeneous(s);
  const ua = snapKnot(h.knots, a);
  const ub = snapKnot(h.knots, b);
  if (!(ub > ua)) return undefined;
  makeBreak(h, ua);
  makeBreak(h, ub);
  const p = h.degree;
  const U = h.knots;
  const ka = U.lastIndexOf(ua) - p + 1;
  const kb = U.indexOf(ub);
  const out: Homogeneous = {
    degree: p,
    knots: [ua, ...U.slice(ka, kb + p), ub],
    points: h.points.slice(ka - 1, kb),
  };
  return fromHomogeneous(out, s.weights !== undefined);
}

/** `b` joined on to the end of `a` (where it starts), as one clamped NURBS of their degree. */
function joinSplines(a: Spline | undefined, b: Spline | undefined): Spline | undefined {
  if (!a || !b) return a ?? b;
  const ha = toHomogeneous(a);
  const hb = toHomogeneous(b);
  const p = ha.degree;
  const end = ha.knots.at(-1)!;
  const shift = end - hb.knots[0]!;
  // Scaling a piece's homogeneous points keeps its curve: make the shared point's weights agree.
  const k = ha.points.at(-1)![2] / hb.points[0]![2];
  const points = [
    ...ha.points,
    ...hb.points.slice(1).map((q): [number, number, number] => [q[0] * k, q[1] * k, q[2] * k]),
  ];
  const knots = [...ha.knots.slice(0, -1), ...hb.knots.slice(p + 1).map((x) => x + shift)];
  const rational = a.weights !== undefined || b.weights !== undefined;
  return fromHomogeneous({ degree: p, knots, points }, rational);
}

// ── EXTEND ─────────────────────────────────────────────────────────────────────────────────

/**
 * EXTEND: `g` (whose curve is `c`) with its end nearer the pick parameter `t` carried on to the
 * nearest point where it meets one of the edges; undefined when it cannot be extended or meets
 * none that way.
 */
export function extendGeometry(
  g: EntityGeometry,
  c: Curve,
  edges: readonly Curve[],
  t: number,
  tol: Tolerance,
): EntityGeometry | undefined {
  if (isClosedCurve(c, tol)) return undefined;
  switch (c.kind) {
    case 'LINE': {
      const atEnd = t > 0.5;
      const from = atEnd ? c.end : c.start;
      const to = reachAlong(from, atEnd ? sub(c.end, c.start) : sub(c.start, c.end), edges, tol);
      if (!to) return undefined;
      const l = g as LineGeometry;
      return atEnd ? { ...l, end: to } : { ...l, start: to };
    }
    case 'ARC': {
      const sweep = arcSweep(c);
      const atEnd = t - c.startAngle > sweep / 2;
      const turn = reachRound(
        { kind: 'CIRCLE', center: c.center, radius: c.radius },
        atEnd ? c.startAngle + sweep : c.startAngle,
        atEnd ? 1 : -1,
        TAU - sweep,
        edges,
        tol,
      );
      if (turn === undefined) return undefined;
      const a = g as ArcGeometry;
      return atEnd
        ? { ...a, endAngle: normalizeAngle(c.endAngle + turn) }
        : { ...a, startAngle: normalizeAngle(c.startAngle - turn) };
    }
    case 'ELLIPSE': {
      const sweep = ellipseSweep(c);
      const atEnd = t - c.startParam > sweep / 2;
      const turn = reachRound(
        { ...c, startParam: 0, endParam: TAU },
        atEnd ? c.startParam + sweep : c.startParam,
        atEnd ? 1 : -1,
        TAU - sweep,
        edges,
        tol,
      );
      if (turn === undefined) return undefined;
      const e = g as EllipseGeometry;
      return atEnd
        ? { ...e, endParam: normalizeAngle(c.endParam + turn) }
        : { ...e, startParam: normalizeAngle(c.startParam - turn) };
    }
    case 'LWPOLYLINE':
      return extendPolyline(g as LwPolylineGeometry | PolylineGeometry, c, edges, t, tol);
    default:
      return undefined;
  }
}

/** The nearest point beyond `from`, going in direction `d`, where an edge is met. */
function reachAlong(
  from: Vec2,
  d: Vec2,
  edges: readonly Curve[],
  tol: Tolerance,
): Vec2 | undefined {
  if (length(d) === 0) return undefined;
  const ray: Curve = { kind: 'RAY', base: from, direction: d };
  let best: { t: number; p: Vec2 } | undefined;
  for (const e of edges) {
    for (const x of intersect(ray, e, tol)) {
      if (distance(x.point, from) <= tol.linear) continue;
      if (!best || x.ta < best.t) best = { t: x.ta, p: x.point };
    }
  }
  return best?.p;
}

/**
 * How far round `whole` (a circle or full ellipse, parameter = angle) from parameter `from`, in
 * direction `dir`, the nearest edge is met, less than `room`; undefined when none is.
 */
function reachRound(
  whole: Curve,
  from: number,
  dir: 1 | -1,
  room: number,
  edges: readonly Curve[],
  tol: Tolerance,
): number | undefined {
  const start = pointAt(whole, from);
  let best: number | undefined;
  for (const e of edges) {
    for (const x of intersect(whole, e, tol)) {
      if (distance(x.point, start) <= tol.linear) continue;
      const turn = normalizeAngle(dir * (x.ta - from));
      if (turn <= 0 || turn >= room) continue;
      if (best === undefined || turn < best) best = turn;
    }
  }
  return best;
}

/** An open polyline with its end segment nearer the pick carried on to the nearest edge. */
function extendPolyline(
  g: LwPolylineGeometry | PolylineGeometry,
  c: Polyline,
  edges: readonly Curve[],
  t: number,
  tol: Tolerance,
): EntityGeometry | undefined {
  const n = polylineSegmentCount(c);
  // The end nearer the pick along the polyline.
  const lengths = Array.from({ length: n }, (_, i) => segmentLength(c, i));
  const k = Math.min(Math.floor(t), n - 1);
  const before = lengths.slice(0, k).reduce((s, l) => s + l, 0) + lengths[k]! * (t - k);
  const total = lengths.reduce((s, l) => s + l, 0);
  const atEnd = before > total / 2;
  const i = atEnd ? n - 1 : 0;
  const seg = polylineSegment(c, i);
  const vs = c.vertices.map((v) => ({ ...v }));
  if ('line' in seg) {
    const from = atEnd ? seg.line.b : seg.line.a;
    const d = atEnd ? sub(seg.line.b, seg.line.a) : sub(seg.line.a, seg.line.b);
    const to = reachAlong(from, d, edges, tol);
    if (!to) return undefined;
    const v = atEnd ? vs[n]! : vs[0]!;
    v.x = to.x;
    v.y = to.y;
  } else {
    const { center, radius, startAngle, sweep } = seg.arc;
    const dir = sweep > 0 === atEnd ? 1 : -1;
    const turn = reachRound(
      { kind: 'CIRCLE', center, radius },
      atEnd ? startAngle + sweep : startAngle,
      dir,
      TAU - Math.abs(sweep),
      edges,
      tol,
    );
    if (turn === undefined) return undefined;
    const grown = sweep + Math.sign(sweep) * turn;
    if (atEnd) {
      const p = pointAt({ kind: 'CIRCLE', center, radius }, startAngle + grown);
      vs[n]!.x = p.x;
      vs[n]!.y = p.y;
    } else {
      const p = pointAt({ kind: 'CIRCLE', center, radius }, startAngle + sweep - grown);
      vs[0]!.x = p.x;
      vs[0]!.y = p.y;
    }
    vs[i]!.bulge = Math.tan(grown / 4);
  }
  return withVertices(g, cleanPolyline(g).index, vs, n);
}

function segmentLength(c: Polyline, i: number): number {
  const seg = polylineSegment(c, i);
  return 'line' in seg
    ? distance(seg.line.a, seg.line.b)
    : seg.arc.radius * Math.abs(seg.arc.sweep);
}

/**
 * `g` with the cleaned polyline's vertices `vs` (each segment keeping the widths of the source
 * vertex it starts at) and its fit dropped.
 */
export function withVertices(
  g: LwPolylineGeometry | PolylineGeometry,
  index: readonly number[],
  vs: readonly { x: number; y: number; bulge: number }[],
  n: number,
): EntityGeometry {
  const widths: Widths = segmentWidths(g, index, n);
  const vertices: PolylineVertex[] = vs.map((v, k) => {
    const w = widths?.[k];
    const wide = w && (w[0] !== 0 || w[1] !== 0);
    return { x: v.x, y: v.y, bulge: v.bulge, ...(wide && { startWidth: w[0], endWidth: w[1] }) };
  });
  if (g.kind === 'LWPOLYLINE') return { ...g, vertices };
  const { fit: _fit, frame: _frame, ...rest } = g;
  return { ...rest, vertices };
}
