// NURBS evaluation (Piegl & Tiller, "The NURBS Book", 2nd ed., algorithms A2.1, A2.3, A4.2).
//
// AutoCAD stores splines as degree, knot vector, control points and optional weights. Clamped
// splines have degree+1 repeated end knots; closed/periodic ones are stored with an unclamped
// knot vector and wrapped control points. Both evaluate over [knots[p], knots[n]] with the
// same formulas, so there is no separate periodic code path.

import type { Spline } from './curves';
import type { Vec2 } from './types';

export function validateSpline(s: Spline): void {
  const p = s.degree;
  const n = s.controlPoints.length;
  if (!Number.isInteger(p) || p < 1) throw new Error(`spline degree ${p} must be an integer ≥ 1`);
  if (s.knots.length !== n + p + 1) {
    throw new Error(
      `spline has ${s.knots.length} knots; degree ${p} with ${n} control points needs ${n + p + 1}`,
    );
  }
  for (let i = 1; i < s.knots.length; i++) {
    if (s.knots[i]! < s.knots[i - 1]!) throw new Error('spline knots must be non-decreasing');
  }
  if (s.weights) {
    if (s.weights.length !== n)
      throw new Error(`spline has ${s.weights.length} weights for ${n} control points`);
    if (s.weights.some((w) => !(w > 0))) throw new Error('spline weights must be positive');
  }
  if (!(s.knots[n]! > s.knots[p]!)) throw new Error('spline has an empty domain');
}

export function splineDomain(s: Spline): { start: number; end: number } {
  return { start: s.knots[s.degree]!, end: s.knots[s.controlPoints.length]! };
}

/** Index of the knot span holding u (A2.1); n is the last control point index. */
export function findSpan(n: number, p: number, u: number, U: readonly number[]): number {
  if (u >= U[n + 1]!) {
    // At (or past) the end of the domain: the last non-empty span.
    let k = n;
    while (k > p && U[k]! === U[k + 1]!) k--;
    return k;
  }
  if (u <= U[p]!) {
    let k = p;
    while (k < n && U[k]! === U[k + 1]!) k++;
    return k;
  }
  let lo = p;
  let hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (u < U[mid]! || u >= U[mid + 1]!) {
    if (u < U[mid]!) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/**
 * Non-zero basis functions N[span-p..span] at u and their derivatives up to order `d` (A2.3).
 * Returns ders[k][j] = k-th derivative of N(span-p+j).
 */
export function basisFunctions(
  span: number,
  u: number,
  p: number,
  U: readonly number[],
  d: number,
): number[][] {
  const ndu: number[][] = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0));
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  ndu[0]![0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j]!;
    right[j] = U[span + j]! - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j]![r] = right[r + 1]! + left[j - r]!;
      const temp = ndu[r]![j - 1]! / ndu[j]![r]!;
      ndu[r]![j] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    ndu[j]![j] = saved;
  }
  const ders: number[][] = Array.from({ length: d + 1 }, () => new Array<number>(p + 1).fill(0));
  for (let j = 0; j <= p; j++) ders[0]![j] = ndu[j]![p]!;
  const a: number[][] = [new Array<number>(p + 1).fill(0), new Array<number>(p + 1).fill(0)];
  for (let r = 0; r <= p; r++) {
    let s1 = 0;
    let s2 = 1;
    a[0]![0] = 1;
    for (let k = 1; k <= d; k++) {
      let dd = 0;
      const rk = r - k;
      const pk = p - k;
      if (r >= k) {
        a[s2]![0] = a[s1]![0]! / ndu[pk + 1]![rk]!;
        dd = a[s2]![0]! * ndu[rk]![pk]!;
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        a[s2]![j] = (a[s1]![j]! - a[s1]![j - 1]!) / ndu[pk + 1]![rk + j]!;
        dd += a[s2]![j]! * ndu[rk + j]![pk]!;
      }
      if (r <= pk) {
        a[s2]![k] = -a[s1]![k - 1]! / ndu[pk + 1]![r]!;
        dd += a[s2]![k]! * ndu[r]![pk]!;
      }
      ders[k]![r] = dd;
      const t = s1;
      s1 = s2;
      s2 = t;
    }
  }
  let f = p;
  for (let k = 1; k <= d; k++) {
    for (let j = 0; j <= p; j++) ders[k]![j]! *= f;
    f *= p - k;
  }
  return ders;
}

/** Point and first derivative at u, for rational and non-rational splines (A4.2). */
function evaluate(s: Spline, u: number): { point: Vec2; derivative: Vec2 } {
  const p = s.degree;
  const n = s.controlPoints.length - 1;
  const span = findSpan(n, p, u, s.knots);
  const N = basisFunctions(span, u, p, s.knots, 1);
  let x = 0;
  let y = 0;
  let w = 0;
  let dx = 0;
  let dy = 0;
  let dw = 0;
  for (let j = 0; j <= p; j++) {
    const i = span - p + j;
    const cp = s.controlPoints[i]!;
    const wi = s.weights ? s.weights[i]! : 1;
    const n0 = N[0]![j]! * wi;
    const n1 = N[1]![j]! * wi;
    x += n0 * cp.x;
    y += n0 * cp.y;
    w += n0;
    dx += n1 * cp.x;
    dy += n1 * cp.y;
    dw += n1;
  }
  // Quotient rule on the homogeneous curve: C = A/w, C' = (A' − w'C)/w.
  const point = { x: x / w, y: y / w };
  return { point, derivative: { x: (dx - dw * point.x) / w, y: (dy - dw * point.y) / w } };
}

export function splinePoint(s: Spline, u: number): Vec2 {
  return evaluate(s, u).point;
}

export function splineDerivative(s: Spline, u: number): Vec2 {
  return evaluate(s, u).derivative;
}
