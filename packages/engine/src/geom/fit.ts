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
// C2 through its first point (periodic end conditions), with its knots clamped at the seam.
// A fit tolerance above zero makes AutoCAD approximate rather than interpolate; that
// algorithm is not documented either, so the curve interpolates (M1-65 tracks the sample).

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
  const D = closed
    ? periodicDerivatives(S, h, delta)
    : openDerivatives(S, h, delta, tangent(d.startTangent, scale), tangent(d.endTangent, scale));
  return bspline(pts, t, D);
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
