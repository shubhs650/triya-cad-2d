// SPLINEDIT's geometry (M3-02 part 6; AutoCAD Help, "SPLINEDIT (Command)").
//
// A spline is edited either by its fit data (fit points, end tangents, kinks) or by its control
// frame (control vertices, weights, degree). Fit edits recompute the NURBS from the fit data as
// SPLINE draws it (`fitSpline`, M1-47); a kink is a fit point where the curve is fitted in two
// runs that meet with only C0 continuity, stored the way AutoCAD stores it: a knot of full
// multiplicity there, so `kinksOf` finds it again when the drawing is reopened. Control-frame
// edits drop the fit data (AutoCAD: editing control vertices turns a spline into a CV spline).
//
// AutoCAD documents what the options do, not their numerics. Choices made here:
// - Edit vertex Add inserts a knot at the point picked (Boehm), so the shape is kept and a
//   vertex is added between the two that span it.
// - Edit vertex Delete takes the vertex out with the interior knot nearest its Greville point;
//   the curve changes only near it.
// - Elevate order is exact: the curve is put in the spline space of the higher degree (each
//   knot's multiplicity raised by the same amount) by collocation at the Greville points.
// - A periodic (closed C2) spline is clamped at its seam first for Add, Delete and Elevate
//   order; Move and Weight move a wrapped vertex together with its copy, keeping it periodic.
// - Join chains lines, arcs, open 2D polylines and open splines that meet the source's ends,
//   raised to the highest degree among them, with C0 kinks at the joins.
import { closestPoint } from '../geom/closest';
import type { Spline } from '../geom/curves';
import { ellipseAxes, polylineSegment } from '../geom/eval';
import { fitSpline } from '../geom/fit';
import {
  basisFunctions,
  findSpan,
  splineDerivative,
  splineDomain,
  splinePoint,
} from '../geom/nurbs';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { cross, distance, normalize } from '../geom/vec';
import { splineCurve } from '../model/spline';
import type { EntityGeometry, SplineGeometry } from '../model/types';
import {
  fromHomogeneous,
  insertKnot,
  joinSplines,
  subSpline,
  toHomogeneous,
  type Homogeneous,
} from './trim';

/** The highest order (degree + 1) Elevate order takes (AutoCAD: "The maximum value is 26"). */
export const MAX_SPLINE_ORDER = 26;

/** A spline has fit data that Fit data can edit. */
export const hasFitData = (g: SplineGeometry): boolean => (g.fitPoints?.length ?? 0) >= 2;

/** The spline with its fit data taken off (Fit data Purge; any control-frame edit). */
export function purgeFitData(g: SplineGeometry): SplineGeometry {
  const {
    fitPoints: _f,
    startTangent: _s,
    endTangent: _e,
    fitTolerance: _t,
    knotParameterization: _k,
    ...rest
  } = g;
  // A spline stored as fit data alone keeps the curve it draws.
  const c = splineCurve(g);
  if (!c || c === (g as Spline)) return rest;
  return { ...rest, degree: c.degree, knots: c.knots, controlPoints: c.controlPoints };
}

// ── Fit data ───────────────────────────────────────────────────────────────────────────────

/** What fit-data editing changes: the points, their kinks, the end tangents and closure. */
export interface FitEdit {
  readonly points: readonly Vec2[];
  /** Index-aligned with `points`: the curve has a corner there. */
  readonly kinks: readonly boolean[];
  readonly startTangent?: Vec2 | undefined;
  readonly endTangent?: Vec2 | undefined;
  readonly closed: boolean;
}

/** The fit data of `g` as `FitEdit` takes it (fit points, kinks, tangents, closure). */
export function fitEditOf(g: SplineGeometry, tol: Tolerance): FitEdit {
  return {
    points: g.fitPoints ?? [],
    kinks: kinksOf(g, tol),
    startTangent: g.startTangent,
    endTangent: g.endTangent,
    closed: g.closed,
  };
}

/**
 * The fit points the curve has a corner at: those on an interior knot of full multiplicity, and
 * the seam of a closed spline whose end tangents differ.
 */
export function kinksOf(g: SplineGeometry, tol: Tolerance): boolean[] {
  const pts = g.fitPoints ?? [];
  const out = pts.map(() => false);
  const c = splineCurve(g);
  if (!c || pts.length < 3) return out;
  const near = Math.max(tol.linear * 1e3, 1e-9);
  const mark = (q: Vec2) => {
    const k = pts.findIndex((f) => distance(f, q) <= near);
    if (k >= 0) out[k] = true;
  };
  const { start, end } = splineDomain(c);
  const U = c.knots;
  for (let i = 0; i < U.length;) {
    let j = i;
    while (j < U.length && U[j] === U[i]) j++;
    const u = U[i]!;
    if (u > start && u < end && j - i >= c.degree) mark(splinePoint(c, u));
    i = j;
  }
  if (g.closed) {
    const a = normalize(splineDerivative(c, start));
    const b = normalize(splineDerivative(c, end));
    if (Math.abs(cross(a, b)) > 1e-6 || a.x * b.x + a.y * b.y < 0) mark(splinePoint(c, start));
  }
  return out;
}

const unit = (v: Vec2 | undefined): Vec2 | undefined => {
  const l = v ? Math.hypot(v.x, v.y) : 0;
  return v && l > 0 ? { x: v.x / l, y: v.y / l } : undefined;
};

/**
 * `g` refitted to the fit data `f`, its other fields (knot parameterization, tolerance, plane)
 * kept; undefined when the points make no curve.
 */
export function withFitData(g: SplineGeometry, f: FitEdit): SplineGeometry | undefined {
  const parameterization = g.knotParameterization;
  const n = f.points.length;
  const closed = f.closed && n >= 3;
  const startTangent = unit(f.startTangent);
  const endTangent = closed ? undefined : unit(f.endTangent);
  const kinks = f.kinks.flatMap((k, i) => (k && (closed || (i > 0 && i < n - 1)) ? [i] : []));
  let c: Spline | undefined;
  if (kinks.length === 0) {
    c = fitSpline({ fitPoints: f.points, startTangent, endTangent, closed, parameterization });
  } else {
    // Runs from kink to kink, each fitted on its own (natural ends at the kinks); a closed
    // spline starts at its first kink and goes round to it again.
    const ring = closed
      ? [...f.points.slice(kinks[0]!), ...f.points.slice(0, kinks[0]! + 1)]
      : [...f.points];
    const cuts = closed ? [...kinks.map((k) => (k - kinks[0]! + n) % n), n] : [0, ...kinks, n - 1];
    for (let r = 0; r + 1 < cuts.length; r++) {
      const run = fitSpline({
        fitPoints: ring.slice(cuts[r]!, cuts[r + 1]! + 1),
        startTangent: !closed && r === 0 ? startTangent : undefined,
        endTangent: !closed && r === cuts.length - 2 ? endTangent : undefined,
        parameterization,
      });
      if (!run) return undefined;
      c = joinSplines(c, run);
    }
  }
  if (!c) return undefined;
  const { startTangent: _s, endTangent: _e, weights: _w, fitPoints: _f, ...rest } = g;
  return {
    ...rest,
    degree: c.degree,
    knots: c.knots,
    controlPoints: c.controlPoints,
    fitPoints: [...f.points],
    ...(startTangent && { startTangent }),
    ...(endTangent && { endTangent }),
    closed,
    periodic: false,
  };
}

/** Where a point on the curve falls among the fit points: the index it goes in at. */
export function fitInsertIndex(g: SplineGeometry, at: Vec2, tol: Tolerance): number {
  const pts = g.fitPoints ?? [];
  const c = splineCurve(g);
  if (!c) return pts.length;
  const u = closestPoint(c, at, tol).t;
  let k = 0;
  while (k < pts.length && closestPoint(c, pts[k]!, tol).t <= u) k++;
  // A closed spline's first fit point is its seam: a point past the last goes after it.
  return Math.max(1, k);
}

/** The index of the fit point (or control vertex) nearest `p`. */
export function nearestIndex(points: readonly Vec2[], p: Vec2): number {
  let best = 0;
  points.forEach((q, i) => {
    if (distance(q, p) < distance(points[best]!, p)) best = i;
  });
  return best;
}

/** The point on the curve nearest `p`. */
export function pointOnSpline(g: SplineGeometry, p: Vec2, tol: Tolerance): Vec2 | undefined {
  const c = splineCurve(g);
  return c && closestPoint(c, p, tol).point;
}

// ── Control frame ──────────────────────────────────────────────────────────────────────────

/** The NURBS of `g` as the control frame edits see it (a fit-only spline's computed one). */
function frameOf(g: SplineGeometry): SplineGeometry | undefined {
  const c = splineCurve(g);
  if (!c) return undefined;
  return purgeFitData(c === (g as Spline) ? g : { ...g, ...c });
}

/** The knots are clamped (an end knot repeated degree + 1 times) at both ends. */
function isClamped(s: Spline): boolean {
  const U = s.knots;
  const p = s.degree;
  return U[0] === U[p] && U.at(-1) === U.at(-1 - p);
}

/** `g` with a clamped knot vector, the same curve (a periodic spline opened at its seam). */
export function clampedSpline(g: SplineGeometry): SplineGeometry | undefined {
  const f = frameOf(g);
  if (!f) return undefined;
  if (isClamped(f)) return f;
  const { start, end } = splineDomain(f);
  const s = subSpline(f, start, end);
  if (!s) return undefined;
  const { weights: _w, ...rest } = f;
  return {
    ...rest,
    degree: s.degree,
    knots: s.knots,
    controlPoints: s.controlPoints,
    ...(s.weights && { weights: s.weights }),
    periodic: false,
  };
}

/**
 * The control vertices a drafter edits, each with the stored vertices it is: a periodic
 * spline's first `degree` vertices are stored again at its end, a closed clamped spline's first
 * at its end.
 */
export function controlVertices(g: SplineGeometry): number[][] {
  const P = g.controlPoints;
  const n = P.length;
  const p = g.degree;
  const w = (i: number) => g.weights?.[i] ?? 1;
  const same = (i: number, j: number) =>
    P[i]!.x === P[j]!.x && P[i]!.y === P[j]!.y && w(i) === w(j);
  if (g.closed && !isClamped(g) && n > 2 * p) {
    let wrapped = true;
    for (let i = 0; i < p; i++) wrapped &&= same(i, n - p + i);
    if (wrapped) {
      return Array.from({ length: n - p }, (_, i) => (i < p ? [i, n - p + i] : [i]));
    }
  }
  if (g.closed && n > 2 && same(0, n - 1)) {
    return Array.from({ length: n - 1 }, (_, i) => (i === 0 ? [0, n - 1] : [i]));
  }
  return Array.from({ length: n }, (_, i) => [i]);
}

/** The positions of the editable control vertices. */
export const controlPositions = (g: SplineGeometry): Vec2[] =>
  controlVertices(g).map((ix) => g.controlPoints[ix[0]!]!);

/** The weight of editable control vertex `k`. */
export const controlWeight = (g: SplineGeometry, k: number): number =>
  g.weights?.[controlVertices(g)[k]![0]!] ?? 1;

/** Editable control vertex `k` moved to `to` (Edit vertex Move). */
export function moveControlVertex(g: SplineGeometry, k: number, to: Vec2): SplineGeometry {
  const f = frameOf(g) ?? g;
  const ix = controlVertices(f)[k] ?? [];
  const controlPoints = f.controlPoints.map((q, i) => (ix.includes(i) ? { x: to.x, y: to.y } : q));
  return { ...f, controlPoints };
}

/** Editable control vertex `k` given weight `w` > 0 (Edit vertex Weight). */
export function weightControlVertex(g: SplineGeometry, k: number, w: number): SplineGeometry {
  const f = frameOf(g) ?? g;
  const ix = controlVertices(f)[k] ?? [];
  const weights = f.controlPoints.map((_, i) => (ix.includes(i) ? w : (f.weights?.[i] ?? 1)));
  // All weights 1 is a plain B-spline, as the file stores it.
  if (weights.every((x) => x === 1)) {
    const { weights: _w, ...rest } = f;
    return rest;
  }
  return { ...f, weights };
}

const withFrame = (g: SplineGeometry, s: Spline): SplineGeometry => {
  const { weights: _w, ...rest } = g;
  return {
    ...rest,
    degree: s.degree,
    knots: s.knots,
    controlPoints: s.controlPoints,
    ...(s.weights && { weights: s.weights }),
  };
};

/**
 * A control vertex added where the curve passes nearest `at` (Edit vertex Add), the curve
 * unchanged; undefined at an end of the curve or at a knot that cannot take another.
 */
export function addControlVertex(
  g: SplineGeometry,
  at: Vec2,
  tol: Tolerance,
): SplineGeometry | undefined {
  const f = clampedSpline(g);
  if (!f) return undefined;
  const u = closestPoint(f, at, tol).t;
  const { start, end } = splineDomain(f);
  const span = end - start;
  if (u - start <= 1e-9 * span || end - u <= 1e-9 * span) return undefined;
  if (f.knots.filter((x) => x === u).length >= f.degree) return undefined;
  const h = toHomogeneous(f);
  insertKnot(h, u);
  return withFrame(f, fromHomogeneous(h, f.weights !== undefined));
}

/**
 * Editable control vertex `k` taken out (Edit vertex Delete), with the interior knot nearest
 * its Greville point; undefined when the spline would have fewer vertices than its order.
 */
export function deleteControlVertex(g: SplineGeometry, k: number): SplineGeometry | undefined {
  const f = clampedSpline(g);
  if (!f) return undefined;
  const p = f.degree;
  const n = f.controlPoints.length;
  // A closed clamped spline stores its seam vertex twice.
  const seam = f.closed && controlVertices(f)[0]!.length === 2;
  if (n - 1 < p + 1 || (seam && n - 1 < p + 2)) return undefined;
  const at = seam && k === 0 ? 0 : Math.min(k, n - 1);
  const U = [...f.knots];
  // Interior knots are U[p+1..n-1]; take the one nearest the vertex's Greville abscissa.
  let greville = 0;
  for (let j = 1; j <= p; j++) greville += U[at + j]!;
  greville /= p;
  let drop = p + 1;
  for (let j = p + 1; j <= n - 1; j++) {
    if (Math.abs(U[j]! - greville) < Math.abs(U[drop]! - greville)) drop = j;
  }
  U.splice(drop, 1);
  const controlPoints = f.controlPoints.filter((_, i) => i !== at);
  const weights = f.weights?.filter((_, i) => i !== at);
  // The seam vertex taken out: the curve now starts and ends at the next one.
  if (seam && at === 0) {
    controlPoints[controlPoints.length - 1] = controlPoints[0]!;
    if (weights) weights[weights.length - 1] = weights[0]!;
  }
  return withFrame(f, {
    kind: 'SPLINE',
    degree: p,
    knots: U,
    controlPoints,
    ...(weights && { weights }),
  });
}

/** Homogeneous point (x·w, y·w, w) of `s` at `u`. */
function homogeneousAt(h: Homogeneous, u: number): [number, number, number] {
  const p = h.degree;
  const span = findSpan(h.points.length - 1, p, u, h.knots);
  const N = basisFunctions(span, u, p, h.knots, 0)[0]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let j = 0; j <= p; j++) {
    const q = h.points[span - p + j]!;
    out[0] += N[j]! * q[0];
    out[1] += N[j]! * q[1];
    out[2] += N[j]! * q[2];
  }
  return out;
}

/** Solves A·x = b (n × n, three right-hand sides) by Gaussian elimination with pivoting. */
function solve(A: number[][], b: [number, number, number][]): [number, number, number][] {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    const d = A[c]![c]!;
    for (let r = c + 1; r < n; r++) {
      const m = A[r]![c]! / d;
      if (m === 0) continue;
      for (let k = c; k < n; k++) A[r]![k]! -= m * A[c]![k]!;
      for (let k = 0; k < 3; k++) b[r]![k]! -= m * b[c]![k]!;
    }
  }
  const x: [number, number, number][] = Array.from({ length: n }, () => [0, 0, 0]);
  for (let r = n - 1; r >= 0; r--) {
    for (let k = 0; k < 3; k++) {
      let s = b[r]![k]!;
      for (let c = r + 1; c < n; c++) s -= A[r]![c]! * x[c]![k]!;
      x[r]![k] = s / A[r]![r]!;
    }
  }
  return x;
}

/** The clamped NURBS `s` raised to `degree` (≥ its own), the same curve. */
export function elevateDegree(s: Spline, degree: number): Spline {
  const d = degree - s.degree;
  if (d <= 0) return s;
  const h = toHomogeneous(s);
  const knots: number[] = [];
  const U = s.knots;
  for (let i = 0; i < U.length;) {
    let j = i;
    while (j < U.length && U[j] === U[i]) j++;
    for (let r = 0; r < j - i + d; r++) knots.push(U[i]!);
    i = j;
  }
  const n = knots.length - degree - 1;
  const A: number[][] = [];
  const b: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let xi = 0;
    for (let j = 1; j <= degree; j++) xi += knots[i + j]!;
    xi /= degree;
    const row = new Array<number>(n).fill(0);
    const span = findSpan(n - 1, degree, xi, knots);
    const N = basisFunctions(span, xi, degree, knots, 0)[0]!;
    for (let j = 0; j <= degree; j++) row[span - degree + j] = N[j]!;
    A.push(row);
    b.push(homogeneousAt(h, xi));
  }
  return fromHomogeneous({ degree, knots, points: solve(A, b) }, s.weights !== undefined);
}

/** `g` with its order (degree + 1) raised to `order` (Edit vertex Elevate order). */
export function elevateOrder(g: SplineGeometry, order: number): SplineGeometry | undefined {
  const f = clampedSpline(g);
  if (!f) return undefined;
  if (order - 1 <= f.degree) return f;
  return withFrame(f, elevateDegree(f, order - 1));
}

// ── Close, Open ────────────────────────────────────────────────────────────────────────────

/**
 * A CV spline closed (periodic, C2 all round, on the same control vertices) or opened (the
 * clamped spline on its editable vertices, the closing span taken out).
 */
export function closeControlFrame(g: SplineGeometry, close: boolean): SplineGeometry | undefined {
  const f = frameOf(g);
  if (!f) return undefined;
  const vs = controlVertices(f);
  const pts = vs.map((ix) => f.controlPoints[ix[0]!]!);
  const ws = vs.map((ix) => f.weights?.[ix[0]!] ?? 1);
  const p = Math.min(f.degree, pts.length - 1);
  const n = pts.length;
  if (close) {
    if (n < 3) return undefined;
    // Uniform periodic knots; the vertices wrap by the degree.
    const controlPoints = [...pts, ...pts.slice(0, p)];
    const weights = [...ws, ...ws.slice(0, p)];
    const knots = Array.from({ length: controlPoints.length + p + 1 }, (_, i) => i);
    return {
      ...withFrame(f, {
        kind: 'SPLINE',
        degree: p,
        knots,
        controlPoints,
        ...(f.weights && { weights }),
      }),
      closed: true,
      periodic: true,
    };
  }
  const inner = n - p - 1;
  const knots = [
    ...Array<number>(p + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => i + 1),
    ...Array<number>(p + 1).fill(inner + 1),
  ];
  return {
    ...withFrame(f, {
      kind: 'SPLINE',
      degree: p,
      knots,
      controlPoints: pts,
      ...(f.weights && { weights: ws }),
    }),
    closed: false,
    periodic: false,
  };
}

// ── Join ───────────────────────────────────────────────────────────────────────────────────

/** `s` run the other way: the same curve. */
export const reversedSpline = (s: Spline): Spline => {
  const lo = s.knots[0]!;
  const hi = s.knots.at(-1)!;
  return {
    kind: 'SPLINE',
    degree: s.degree,
    knots: s.knots.map((k) => lo + hi - k).reverse(),
    controlPoints: [...s.controlPoints].reverse(),
    ...(s.weights && { weights: [...s.weights].reverse() }),
  };
};

/** An arc as rational quadratic pieces of at most 90°, as one clamped NURBS. */
function arcSpline(center: Vec2, r: number, a0: number, sweep: number): Spline {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const at = (t: number): Vec2 => ({
    x: center.x + r * Math.cos(t),
    y: center.y + r * Math.sin(t),
  });
  const w = Math.cos(step / 2);
  const controlPoints: Vec2[] = [at(a0)];
  const weights = [1];
  const knots = [0, 0, 0];
  for (let i = 0; i < pieces; i++) {
    const t0 = a0 + i * step;
    const mid = t0 + step / 2;
    controlPoints.push({
      x: center.x + (r / w) * Math.cos(mid),
      y: center.y + (r / w) * Math.sin(mid),
    });
    controlPoints.push(at(t0 + step));
    weights.push(w, 1);
    const k = r * Math.abs(step) * (i + 1);
    if (i < pieces - 1) knots.push(k, k);
    else knots.push(k, k, k);
  }
  return { kind: 'SPLINE', degree: 2, knots, controlPoints, weights };
}

/** The open curve `g` as one clamped NURBS, or undefined for what SPLINEDIT Join leaves. */
export function joinableSpline(g: EntityGeometry): Spline | undefined {
  switch (g.kind) {
    case 'LINE': {
      const l = distance(g.start, g.end);
      if (!(l > 0)) return undefined;
      return { kind: 'SPLINE', degree: 1, knots: [0, 0, l, l], controlPoints: [g.start, g.end] };
    }
    case 'ARC': {
      const sweep = (((g.endAngle - g.startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return sweep > 0 ? arcSpline(g.center, g.radius, g.startAngle, sweep) : undefined;
    }
    case 'ELLIPSE': {
      // The unit circle's arc mapped onto the ellipse's axes: NURBS are affinely invariant.
      const sweep = (((g.endParam - g.startParam) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (!(sweep > 0)) return undefined;
      const { major, minor } = ellipseAxes(g);
      const unit = arcSpline({ x: 0, y: 0 }, 1, g.startParam, sweep);
      return {
        ...unit,
        controlPoints: unit.controlPoints.map((q) => ({
          x: g.center.x + major.x * q.x + minor.x * q.y,
          y: g.center.y + major.y * q.x + minor.y * q.y,
        })),
      };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (g.closed || (g.kind === 'POLYLINE' && g.is3d) || g.vertices.length < 2) return undefined;
      const poly = { kind: 'LWPOLYLINE' as const, vertices: g.vertices, closed: false };
      let out: Spline | undefined;
      for (let i = 0; i + 1 < g.vertices.length; i++) {
        const seg = polylineSegment(poly, i);
        const s =
          'line' in seg
            ? joinableSpline({ kind: 'LINE', start: seg.line.a, end: seg.line.b })
            : arcSpline(seg.arc.center, seg.arc.radius, seg.arc.startAngle, seg.arc.sweep);
        if (s) out = joinCurves(out, s);
      }
      return out;
    }
    case 'SPLINE': {
      if (g.closed) return undefined;
      const c = clampedSpline(g);
      return (
        c && {
          kind: 'SPLINE',
          degree: c.degree,
          knots: c.knots,
          controlPoints: c.controlPoints,
          ...(c.weights && { weights: c.weights }),
        }
      );
    }
    default:
      return undefined;
  }
}

/** `b` joined on to the end of `a`, the lower degree raised to the higher. */
export function joinCurves(a: Spline | undefined, b: Spline): Spline {
  if (!a) return b;
  const p = Math.max(a.degree, b.degree);
  return joinSplines(elevateDegree(a, p), elevateDegree(b, p))!;
}

/** A spline's start and end points. */
export const endsOf = (s: Spline): [Vec2, Vec2] => {
  const { start, end } = splineDomain(s);
  return [splinePoint(s, start), splinePoint(s, end)];
};

/**
 * The source spline with every curve of `others` that meets its ends joined on (SPLINEDIT
 * Join), chained in turn; closed when the chain comes round. `joined` lists what was used.
 */
export function joinToSpline<Id>(
  source: SplineGeometry,
  others: readonly { id: Id; geom: EntityGeometry }[],
  tol: Tolerance,
): { geom: SplineGeometry; joined: Id[] } | undefined {
  if (source.closed) return undefined;
  const base = clampedSpline(source);
  if (!base) return undefined;
  let curve: Spline = base;
  const pool = others.flatMap((o) => {
    const s = joinableSpline(o.geom);
    return s ? [{ id: o.id, s }] : [];
  });
  const joined: Id[] = [];
  const near = (a: Vec2, b: Vec2) => distance(a, b) <= tol.linear;
  for (let found = true; found;) {
    found = false;
    const [head, tail] = endsOf(curve);
    if (near(head, tail) && joined.length > 0) break;
    for (let i = 0; i < pool.length; i++) {
      const { id, s } = pool[i]!;
      const [a, b] = endsOf(s);
      if (near(a, tail)) curve = joinCurves(curve, s);
      else if (near(b, tail)) curve = joinCurves(curve, reversedSpline(s));
      else if (near(b, head)) curve = joinCurves(s, curve);
      else if (near(a, head)) curve = joinCurves(reversedSpline(s), curve);
      else continue;
      joined.push(id);
      pool.splice(i, 1);
      found = true;
      break;
    }
  }
  if (joined.length === 0) return undefined;
  const [head, tail] = endsOf(curve);
  return {
    geom: { ...withFrame(base, curve), closed: near(head, tail), periodic: false },
    joined,
  };
}
