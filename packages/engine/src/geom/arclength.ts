// Arc length along a curve (M3-03): how long a curve is, and where along it a given distance
// from its start lands. ARRAYPATH spaces its items by distance along the path curve (and
// DIVIDE/MEASURE, M3-01, place points the same way); AREA's lengths (M3-07) integrate the same.
//
// A curve is cut into smooth spans (a polyline's segments, an ellipse's quarter turns, a
// spline's knot spans, where the speed may jump) and each span's length is integrated by
// Gauss–Legendre quadrature, exact for the constant speed of lines and arcs.

import type { BoundedCurve, Curve } from './curves';
import { derivativeAt, domain, pointAt } from './eval';
import type { Vec2 } from './types';

// 16-point Gauss–Legendre nodes and weights on [−1, 1] (Abramowitz and Stegun, table 25.4).
const GL_X = [
  0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003,
  0.8656312023878318, 0.9445750230732326, 0.9894009349916499,
];
const GL_W = [
  0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541,
];

/** ∫ f over [a, b], split in `pieces` 16-point Gauss–Legendre panels. */
export function integrate(f: (t: number) => number, a: number, b: number, pieces: number): number {
  let sum = 0;
  const h = (b - a) / pieces;
  for (let k = 0; k < pieces; k++) {
    const mid = a + h * (k + 0.5);
    for (let i = 0; i < GL_X.length; i++) {
      const dx = (h / 2) * GL_X[i]!;
      sum += GL_W[i]! * (f(mid - dx) + f(mid + dx));
    }
  }
  return (sum * h) / 2;
}

/**
 * The smooth stretches of a curve's parameter domain: a polyline's segments, a spline's knot
 * spans (its derivative may jump at a knot), an ellipse's quarter turns; a line, circle or arc
 * is one.
 */
export function smoothSpans(c: Curve): [number, number][] {
  const d = domain(c);
  const cuts = new Set<number>([d.start, d.end]);
  if (c.kind === 'SPLINE') {
    for (const k of c.knots) if (k > d.start && k < d.end) cuts.add(k);
  } else if (c.kind === 'LWPOLYLINE') {
    for (let i = 1; i < d.end; i++) cuts.add(i);
  } else if (c.kind === 'ELLIPSE') {
    const n = Math.max(1, Math.ceil((d.end - d.start) / (Math.PI / 2)));
    for (let i = 1; i < n; i++) cuts.add(d.start + ((d.end - d.start) * i) / n);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  return sorted.slice(1).map((b, i) => [sorted[i]!, b]);
}

const speed = (c: Curve, t: number): number => {
  const d = derivativeAt(c, t);
  return Math.hypot(d.x, d.y);
};

const spanLength = (c: Curve, a: number, b: number): number =>
  integrate((t) => speed(c, t), a, b, 4);

/** A curve measured span by span, for repeated lookups along it. */
export interface ArcLengthTable {
  readonly curve: BoundedCurve;
  readonly spans: readonly { readonly a: number; readonly b: number; readonly length: number }[];
  readonly length: number;
}

export function arcLengthTable(c: BoundedCurve): ArcLengthTable {
  let length = 0;
  const spans = smoothSpans(c).map(([a, b]) => {
    const l = spanLength(c, a, b);
    length += l;
    return { a, b, length: l };
  });
  return { curve: c, spans, length };
}

export const curveLength = (c: BoundedCurve): number => arcLengthTable(c).length;

/**
 * The parameter at distance `s` along the curve from its start, `s` clamped to the curve.
 * Newton's method on the span's length, kept inside the span; one step for constant speed.
 */
export function paramAtLength(table: ArcLengthTable, s: number): number {
  const { curve, spans } = table;
  let rest = Math.min(Math.max(s, 0), table.length);
  let span = spans[spans.length - 1]!;
  for (const sp of spans) {
    if (rest <= sp.length) {
      span = sp;
      break;
    }
    rest -= sp.length;
  }
  if (span.length === 0) return span.a;
  rest = Math.min(rest, span.length);
  const tol = 1e-13 * Math.max(table.length, 1);
  let lo = span.a;
  let hi = span.b;
  let t = span.a + ((span.b - span.a) * rest) / span.length;
  for (let k = 0; k < 50; k++) {
    const f = integrate((u) => speed(curve, u), span.a, t, 4) - rest;
    if (Math.abs(f) <= tol) break;
    if (f > 0) hi = t;
    else lo = t;
    const v = speed(curve, t);
    let next = v > 0 ? t - f / v : NaN;
    // Newton left the bracket (or stalled on a cusp): bisect instead.
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    t = next;
  }
  return t;
}

/** The point and unit direction of travel at distance `s` along the curve. */
export function frameAtLength(table: ArcLengthTable, s: number): { point: Vec2; direction: Vec2 } {
  const t = paramAtLength(table, s);
  const c = table.curve;
  let d = derivativeAt(c, t);
  let n = Math.hypot(d.x, d.y);
  if (n === 0) {
    // A cusp or a spline's stalled end: look a hair inward for a direction.
    const { start, end } = domain(c);
    const h = (end - start) * 1e-7;
    d = derivativeAt(c, t + (t + h <= end ? h : -h));
    n = Math.hypot(d.x, d.y) || 1;
  }
  return { point: pointAt(c, t), direction: { x: d.x / n, y: d.y / n } };
}
