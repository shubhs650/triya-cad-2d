// Splines stored as fit points (M1-47): the cubic NURBS AutoCAD interpolates through them.
//
// AutoCAD's SPLINE "Fit" method always makes a cubic. Each fit point gets a parameter from
// the knot parameterization (chord length, square root of chord length, or uniform; AutoCAD
// SPLINE "Knots" option), the interior knots are those parameters, and the two extra
// conditions come from the ends: the given end tangent, or else a zero second derivative.
// That reproduces, to 1e-13, the control points and knots AutoCAD saved beside the fit points
// in the public corpus (uncommon.dxf, see fit.test.ts). How AutoCAD scales a given tangent is
// not documented and no corpus file shows it; we take its direction only and give the curve a
// derivative of (total chord length / total parameter), one unit per unit of chord with chord
// knots, which is also what ezdxf (MIT) found to match CAD output. A closed spline is closed
// C2 through its first point (periodic end conditions), with its knots clamped at the seam; a
// tangent given at that point (AutoCAD asks a closed spline for one) makes it C1 there along the
// tangent instead (M3-16).
//
// A fit tolerance above zero makes AutoCAD approximate rather than interpolate. That algorithm
// is not documented either (M1-65 waited on a sample; RULE 0 moved it here, M3-16), so ours is
// the least-squares cubic of Piegl and Tiller, "The NURBS Book" §9.4.1: knots by averaging
// (eq. 9.69), the ends kept, and the end derivatives the interpolation has when tangents are
// given or the spline is closed (so it stays closed and smooth), with the fewest control points
// (fewer than the points) that keep every fit point within the tolerance at its own parameter
// and the curve within twice the tolerance of the interpolation between them. When none do, it
// interpolates.

import { basisFunctions, findSpan } from './nurbs';
import type { Spline } from './curves';
import type { Vec2 } from './types';

export type KnotParameterization = 'chord' | 'sqrt' | 'uniform';

export interface FitData {
  readonly fitPoints: readonly Vec2[];
  readonly startTangent?: Vec2 | undefined;
  readonly endTangent?: Vec2 | undefined;
  readonly closed?: boolean | undefined;
  /** Default 'chord' (AutoCAD's initial SPLINE knot parameterization). */
  readonly parameterization?: KnotParameterization | undefined;
  /** DXF 44: how far the curve may pass from the fit points; 0 (default) interpolates. */
  readonly tolerance?: number | undefined;
}

/** The cubic through the fit points, or undefined with fewer than two distinct points. */
export function fitSpline(d: FitData): Spline | undefined {
  // Repeated points have no chord to parameterize; AutoCAD's SPLINE skips them as well.
  const pts: Vec2[] = [];
  for (const p of d.fitPoints) {
    const q = pts[pts.length - 1];
    if (!q || q.x !== p.x || q.y !== p.y) pts.push(p);
  }
  const closed = (d.closed ?? false) && pts.length >= 3;
  if (closed) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a.x === b.x && a.y === b.y) pts.pop();
    if (pts.length < 3) return undefined;
    pts.push(pts[0]!);
  }
  if (pts.length < 2) return undefined;
  const S = pts.length - 1; // segments
  const step = stepOf(d.parameterization ?? 'chord');
  const t: number[] = [0];
  let chord = 0;
  for (let k = 0; k < S; k++) {
    const l = Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y);
    chord += l;
    t.push(t[k]! + step(l));
  }
  const h = (k: number) => t[k + 1]! - t[k]!;
  const delta = (k: number): Vec2 => ({
    x: pts[k + 1]!.x - pts[k]!.x,
    y: pts[k + 1]!.y - pts[k]!.y,
  });
  const scale = chord / t[S]!;
  const start = tangent(d.startTangent, scale);
  const D = !closed
    ? openDerivatives(S, h, delta, start, tangent(d.endTangent, scale))
    : start
      ? // The rows between the seam's two visits are the periodic ones; the seam is given.
        openDerivatives(S, h, delta, start, start)
      : periodicDerivatives(S, h, delta);
  const interpolated = bspline(pts, t, D);
  const tol = d.tolerance ?? 0;
  if (!(tol > 0)) return interpolated;
  const fixStart = closed || start !== undefined;
  const fixEnd = closed || d.endTangent !== undefined;
  return (
    approximate(
      pts,
      t,
      fixStart ? D[0] : undefined,
      fixEnd ? D[S] : undefined,
      tol,
      interpolated,
    ) ?? interpolated
  );
}

// ── Approximation within a fit tolerance (M3-16) ───────────────────────────────────────────

/**
 * The cubic with the fewest control points that passes within `tol` of each point at its
 * parameter, its ends at the first and last point and, when given, its end derivatives; or
 * undefined when only the interpolation (n + 2 control points for n + 1 points) does.
 */
function approximate(
  pts: readonly Vec2[],
  t: readonly number[],
  d0: Vec2 | undefined,
  d1: Vec2 | undefined,
  tol: number,
  interpolated: Spline,
): Spline | undefined {
  const m = pts.length - 1;
  // Fewer control points than points (Piegl and Tiller's m > n), so that the averaged knots
  // leave points in every span and the least squares cannot swing between them.
  const most = m + 1;
  const least = 4;
  if (most <= least) return undefined;
  const within = (n: number): Spline | undefined => {
    const s = leastSquares(pts, t, n, d0, d1);
    return s && furthest(s, pts, t) <= tol && hugs(s, interpolated, t, tol) ? s : undefined;
  };
  // Few points: every count in turn, as fits are not monotonic in the count. Many: doubling,
  // then halving the gap, so a fit within the tolerance is kept (a few dense solves only).
  if (m <= 60) {
    for (let n = least; n < most; n++) {
      const s = within(n);
      if (s) return s;
    }
    return undefined;
  }
  let failed = least - 1;
  let found: { n: number; s: Spline } | undefined;
  for (let n = least; n < most; n = Math.min(most - 1, 2 * n - 2)) {
    const s = within(n);
    if (s) {
      found = { n, s };
      break;
    }
    failed = n;
    if (n === most - 1) break;
  }
  if (!found) return undefined;
  while (found.n - failed > 1) {
    const n = Math.floor((failed + found.n) / 2);
    const s = within(n);
    if (s) found = { n, s };
    else failed = n;
  }
  return found.s;
}

/**
 * Whether the approximation keeps near the interpolation between the points as well: within
 * twice the tolerance at the quarter points of each span (a guard against a fit that passes
 * near the points but swings away between them; the factor is ours).
 */
function hugs(s: Spline, interpolated: Spline, t: readonly number[], tol: number): boolean {
  for (let k = 0; k + 1 < t.length; k++) {
    for (const f of [0.25, 0.5, 0.75]) {
      const u = t[k]! + (t[k + 1]! - t[k]!) * f;
      const a = point(s, u);
      const b = point(interpolated, u);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 2 * tol) return false;
    }
  }
  return true;
}

/** How far the curve passes from the points at their parameters. */
function furthest(s: Spline, pts: readonly Vec2[], t: readonly number[]): number {
  let out = 0;
  pts.forEach((q, k) => {
    const c = point(s, t[k]!);
    out = Math.max(out, Math.hypot(c.x - q.x, c.y - q.y));
  });
  return out;
}

/** A point of the clamped cubic (de Boor through the basis, no weights). */
function point(s: Spline, u: number): Vec2 {
  const n = s.controlPoints.length - 1;
  const span = findSpan(n, s.degree, u, s.knots);
  const N = basisFunctions(span, u, s.degree, s.knots, 0)[0]!;
  let x = 0;
  let y = 0;
  N.forEach((b, j) => {
    const P = s.controlPoints[span - s.degree + j]!;
    x += b * P.x;
    y += b * P.y;
  });
  return { x, y };
}

/**
 * The least-squares cubic with `count` control points through the first and last point (and
 * with the derivatives `d0`, `d1` there when given), its knots averaged over the parameters
 * (Piegl and Tiller eq. 9.69); undefined when the normal equations are singular.
 */
function leastSquares(
  pts: readonly Vec2[],
  t: readonly number[],
  count: number,
  d0: Vec2 | undefined,
  d1: Vec2 | undefined,
): Spline | undefined {
  const p = 3;
  const m = pts.length - 1;
  const n = count - 1;
  const a = t[0]!;
  const b = t[m]!;
  const knots: number[] = [a, a, a, a];
  const d = (m + 1) / (n - p + 1);
  for (let j = 1; j <= n - p; j++) {
    const i = Math.floor(j * d);
    const alpha = j * d - i;
    knots.push((1 - alpha) * t[i - 1]! + alpha * t[i]!);
  }
  knots.push(b, b, b, b);
  const P: (Vec2 | undefined)[] = new Array(count).fill(undefined);
  P[0] = pts[0]!;
  P[n] = pts[m]!;
  // C'(a) = p / (U[p+1] − U[1]) · (P1 − P0), and at the end likewise.
  if (d0) {
    const k = (knots[p + 1]! - knots[1]!) / p;
    P[1] = { x: P[0].x + d0.x * k, y: P[0].y + d0.y * k };
  }
  if (d1) {
    const k = (knots[n + p]! - knots[n]!) / p;
    P[n - 1] = { x: P[n].x - d1.x * k, y: P[n].y - d1.y * k };
  }
  const unknown: number[] = [];
  for (let j = 0; j <= n; j++) if (!P[j]) unknown.push(j);
  const column = new Map(unknown.map((j, c) => [j, c]));
  const u = unknown.length;
  if (u > 0) {
    // Normal equations NᵀN x = NᵀR over the inner points, the fixed points moved right.
    const A = Array.from({ length: u }, () => new Float64Array(u));
    const rx = new Float64Array(u);
    const ry = new Float64Array(u);
    for (let k = 1; k < m; k++) {
      const span = findSpan(n, p, t[k]!, knots);
      const N = basisFunctions(span, t[k]!, p, knots, 0)[0]!;
      let qx = pts[k]!.x;
      let qy = pts[k]!.y;
      const row: [number, number][] = [];
      N.forEach((v, jj) => {
        const j = span - p + jj;
        const c = column.get(j);
        if (c === undefined) {
          qx -= v * P[j]!.x;
          qy -= v * P[j]!.y;
        } else row.push([c, v]);
      });
      for (const [c1, v1] of row) {
        rx[c1] = rx[c1]! + v1 * qx;
        ry[c1] = ry[c1]! + v1 * qy;
        for (const [c2, v2] of row) A[c1]![c2] = A[c1]![c2]! + v1 * v2;
      }
    }
    const x = solveDense(A, rx, ry);
    if (!x) return undefined;
    unknown.forEach((j, c) => (P[j] = x[c]!));
  }
  return { kind: 'SPLINE', degree: p, knots, controlPoints: P as Vec2[] };
}

/** Gaussian elimination with partial pivoting for two right-hand sides; undefined if singular. */
function solveDense(A: Float64Array[], bx: Float64Array, by: Float64Array): Vec2[] | undefined {
  const n = A.length;
  const M = A.map((r) => Float64Array.from(r));
  const x = Float64Array.from(bx);
  const y = Float64Array.from(by);
  const size = Math.max(...M.map((r) => Math.max(...r.map(Math.abs))));
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    if (!(Math.abs(M[pivot]![c]!) > 1e-14 * size)) return undefined;
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    [x[c], x[pivot]] = [x[pivot]!, x[c]!];
    [y[c], y[pivot]] = [y[pivot]!, y[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
      x[r] = x[r]! - f * x[c]!;
      y[r] = y[r]! - f * y[c]!;
    }
  }
  const out: Vec2[] = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sx = x[r]!;
    let sy = y[r]!;
    for (let k = r + 1; k < n; k++) {
      sx -= M[r]![k]! * out[k]!.x;
      sy -= M[r]![k]! * out[k]!.y;
    }
    out[r] = { x: sx / M[r]![r]!, y: sy / M[r]![r]! };
  }
  return out;
}

function stepOf(p: KnotParameterization): (chord: number) => number {
  if (p === 'sqrt') return Math.sqrt;
  if (p === 'uniform') return () => 1;
  return (l) => l;
}

/** The end derivative for a tangent direction, or undefined for a natural end. */
function tangent(v: Vec2 | undefined, scale: number): Vec2 | undefined {
  const l = v ? Math.hypot(v.x, v.y) : 0;
  if (!v || !(l > 0)) return undefined;
  return { x: (v.x / l) * scale, y: (v.y / l) * scale };
}

/**
 * Derivatives at the fit points of the C2 cubic through them (the classic spline equations,
 * one row per point, tridiagonal), with a given or a natural (C″ = 0) condition at each end.
 */
function openDerivatives(
  S: number,
  h: (k: number) => number,
  delta: (k: number) => Vec2,
  start: Vec2 | undefined,
  end: Vec2 | undefined,
): Vec2[] {
  const n = S + 1;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const r: Vec2[] = [];
  if (start) {
    b[0] = 1;
    r.push(start);
  } else {
    b[0] = 2;
    c[0] = 1;
    r.push(times(delta(0), 3 / h(0)));
  }
  for (let k = 1; k < S; k++) {
    a[k] = h(k);
    b[k] = 2 * (h(k - 1) + h(k));
    c[k] = h(k - 1);
    r.push(interiorRight(k, k - 1, h, delta));
  }
  if (end) {
    b[S] = 1;
    r.push(end);
  } else {
    a[S] = 1;
    b[S] = 2;
    r.push(times(delta(S - 1), 3 / h(S - 1)));
  }
  return solveTridiagonal(a, b, c, r);
}

/** As `openDerivatives` for a closed curve: the rows wrap, D at the seam is shared. */
function periodicDerivatives(
  S: number,
  h: (k: number) => number,
  delta: (k: number) => Vec2,
): Vec2[] {
  const a = new Float64Array(S);
  const b = new Float64Array(S);
  const c = new Float64Array(S);
  const r: Vec2[] = [];
  for (let k = 0; k < S; k++) {
    const prev = (k + S - 1) % S;
    a[k] = h(k);
    b[k] = 2 * (h(prev) + h(k));
    c[k] = h(prev);
    r.push(interiorRight(k, prev, h, delta));
  }
  const D = solveCyclic(a, b, c, r);
  D.push(D[0]!);
  return D;
}

function interiorRight(
  k: number,
  prev: number,
  h: (k: number) => number,
  delta: (k: number) => Vec2,
): Vec2 {
  const dp = delta(prev);
  const dk = delta(k);
  const f = h(k) / h(prev);
  const g = h(prev) / h(k);
  return { x: 3 * (f * dp.x + g * dk.x), y: 3 * (f * dp.y + g * dk.y) };
}

const times = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });

/** Thomas algorithm: row k is a[k]·x[k−1] + b[k]·x[k] + c[k]·x[k+1] = r[k]. */
function solveTridiagonal(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  r: readonly Vec2[],
): Vec2[] {
  const n = b.length;
  const cp = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let m = b[0]!;
  cp[0] = c[0]! / m;
  x[0] = r[0]!.x / m;
  y[0] = r[0]!.y / m;
  for (let k = 1; k < n; k++) {
    m = b[k]! - a[k]! * cp[k - 1]!;
    cp[k] = c[k]! / m;
    x[k] = (r[k]!.x - a[k]! * x[k - 1]!) / m;
    y[k] = (r[k]!.y - a[k]! * y[k - 1]!) / m;
  }
  for (let k = n - 2; k >= 0; k--) {
    x[k] = x[k]! - cp[k]! * x[k + 1]!;
    y[k] = y[k]! - cp[k]! * y[k + 1]!;
  }
  return Array.from(x, (xk, k) => ({ x: xk, y: y[k]! }));
}

/**
 * Cyclic tridiagonal system (a[0] couples to x[n−1], c[n−1] to x[0]) by Sherman–Morrison
 * (Numerical Recipes §2.7). The spline rows are diagonally dominant, so no pivoting is needed.
 */
function solveCyclic(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  r: readonly Vec2[],
): Vec2[] {
  const n = b.length;
  const alpha = c[n - 1]!; // row n−1, column 0
  const beta = a[0]!; // row 0, column n−1
  const gamma = -b[0]!;
  const bb = Float64Array.from(b);
  bb[0] = b[0]! - gamma;
  bb[n - 1] = b[n - 1]! - (alpha * beta) / gamma;
  const aa = Float64Array.from(a);
  const cc = Float64Array.from(c);
  aa[0] = 0;
  cc[n - 1] = 0;
  const x = solveTridiagonal(aa, bb, cc, r);
  const u = r.map((_, k) => ({ x: k === 0 ? gamma : k === n - 1 ? alpha : 0, y: 0 }));
  const z = solveTridiagonal(aa, bb, cc, u).map((p) => p.x);
  const den = 1 + z[0]! + (beta * z[n - 1]!) / gamma;
  const fx = (x[0]!.x + (beta * x[n - 1]!.x) / gamma) / den;
  const fy = (x[0]!.y + (beta * x[n - 1]!.y) / gamma) / den;
  return x.map((p, k) => ({ x: p.x - fx * z[k]!, y: p.y - fy * z[k]! }));
}

/**
 * The clamped cubic B-spline of the piecewise cubic with points `pts` and derivatives `D` at
 * parameters `t`: knots at the parameters, de Boor points from each segment's Bézier inner
 * points (Farin, "Curves and Surfaces for CAGD", §7.2: b₁ and b₂ of segment j divide
 * d₍j+1₎d₍j+2₎ in the ratio of the neighbouring intervals).
 */
function bspline(pts: readonly Vec2[], t: readonly number[], D: readonly Vec2[]): Spline {
  const S = pts.length - 1;
  const h = (k: number) => (k >= 0 && k < S ? t[k + 1]! - t[k]! : 0);
  const control: Vec2[] = [pts[0]!];
  for (let j = 0; j < S; j++) {
    const hj = h(j);
    const p = pts[j]!;
    const q = pts[j + 1]!;
    const b1 = { x: p.x + (hj * D[j]!.x) / 3, y: p.y + (hj * D[j]!.y) / 3 };
    const b2 = { x: q.x - (hj * D[j + 1]!.x) / 3, y: q.y - (hj * D[j + 1]!.y) / 3 };
    const hp = h(j - 1);
    control.push({
      x: ((hp + hj) * b1.x - hp * b2.x) / hj,
      y: ((hp + hj) * b1.y - hp * b2.y) / hj,
    });
    if (j === S - 1) control.push(b2);
  }
  control.push(pts[S]!);
  const start = t[0]!;
  const end = t[S]!;
  return {
    kind: 'SPLINE',
    degree: 3,
    knots: [start, start, start, start, ...t.slice(1, S), end, end, end, end],
    controlPoints: control,
  };
}
