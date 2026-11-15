// Deferred TANgent and PERpendicular (M3-01 part 2): AutoCAD's "Deferred Tangent" and "Deferred
// Perpendicular" object snaps. A TAN or PER pick made before the point it is taken from is
// known holds the object and where it was picked; the command solves it once its other points
// are given (AutoCAD 2024 Help, "Object Snaps": "When you use the Tangent object snap with the
// first point of a line … AutoCAD displays the Deferred Tangent snap marker"; "LINE tangent to
// two circles"; the ribbon's "Tan, Tan, Tan" circle, which is CIRCLE 3P with three of them).
//
// Objects are taken whole, as AutoCAD's TTT circle and tangent lines are: a line as the
// infinite line, an arc as its circle. Of the lines or circles that satisfy the picks, the one
// whose touching points lie closest to where the objects were picked wins, as CIRCLE Ttr
// chooses (`circleTanTanRadius`).
import type { Circle } from './curves';
import { circleThrough3, type TangentTarget } from './construct';
import type { Tolerance } from './tolerance';
import type { Vec2 } from './types';
import { add, cross, distance, dot, length, normalize, perp, scale, sub } from './vec';

/** A deferred TAN or PER pick: the object (as a line or circle) and where it was picked on it. */
export interface DeferredPick {
  readonly mode: 'TAN' | 'PER';
  readonly target: TangentTarget;
  readonly pick: Vec2;
}

/** A point given to a command that solves deferred picks: a point, or a deferred pick. */
export type DeferredItem = Vec2 | DeferredPick;

export const isDeferred = (i: DeferredItem): i is DeferredPick => 'mode' in i;

/** Where an item was given: the point, or where the object was picked. */
export const itemPoint = (i: DeferredItem): Vec2 => (isDeferred(i) ? i.pick : i);

type Segment = { readonly start: Vec2; readonly end: Vec2 };
type LineT = Extract<TangentTarget, { kind: 'line' }>;
type CircleT = Extract<TangentTarget, { kind: 'circle' }>;

/**
 * LINE from `a` to `b`, either (or both) a deferred pick: tangent to a circle or arc, or
 * perpendicular to a line, circle or arc. Undefined when no such line exists (a tangent from
 * inside the circle, two non-parallel lines to be perpendicular to, a deferred TAN on a line).
 */
export function lineBetween(a: DeferredItem, b: DeferredItem, tol: Tolerance): Segment | undefined {
  let candidates: Segment[];
  if (!isDeferred(a) && !isDeferred(b)) candidates = [{ start: a, end: b }];
  else if (!isDeferred(b))
    candidates = feetFrom(a as DeferredPick, b, tol).map((s) => ({ start: s, end: b }));
  else if (!isDeferred(a)) candidates = feetFrom(b, a, tol).map((e) => ({ start: a, end: e }));
  else candidates = bothDeferred(a, b, tol);
  let best: Segment | undefined;
  let bestD = Infinity;
  for (const s of candidates) {
    if (distance(s.start, s.end) <= tol.linear) continue;
    const d =
      (isDeferred(a) ? distance(s.start, a.pick) : 0) +
      (isDeferred(b) ? distance(s.end, b.pick) : 0);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** The points on a deferred pick's object a line from `p` leaves tangent or perpendicular. */
function feetFrom(d: DeferredPick, p: Vec2, tol: Tolerance): Vec2[] {
  const t = d.target;
  if (d.mode === 'TAN') return t.kind === 'circle' ? tangentPoints(t, p, tol) : [];
  if (t.kind === 'line') return [foot(t, p)];
  const u = unitOr(sub(p, t.center), tol);
  return u ? [add(t.center, scale(u, t.radius)), sub(t.center, scale(u, t.radius))] : [];
}

/** Both ends deferred: each candidate line, as [point on a's object, point on b's]. */
function bothDeferred(a: DeferredPick, b: DeferredPick, tol: Tolerance): Segment[] {
  const swap = (s: Segment): Segment => ({ start: s.end, end: s.start });
  const ta = a.target;
  const tb = b.target;
  if (a.mode === 'TAN' && b.mode === 'TAN') {
    return ta.kind === 'circle' && tb.kind === 'circle' ? commonTangents(ta, tb, tol) : [];
  }
  if (a.mode === 'PER' && b.mode === 'TAN') return bothDeferred(b, a, tol).map(swap);
  if (a.mode === 'TAN') {
    // Tangent to a's circle, perpendicular to b.
    if (ta.kind !== 'circle') return [];
    if (tb.kind === 'line') {
      const u = normalize(tb.direction);
      return [1, -1].map((s) => {
        const start = add(ta.center, scale(u, s * ta.radius));
        return { start, end: foot(tb, start) };
      });
    }
    // Perpendicular to a circle is through its centre: the tangents to a's circle from b's centre.
    return tangentPoints(ta, tb.center, tol).flatMap((start) =>
      throughCircle(tb, sub(start, tb.center), tol).map((end) => ({ start, end })),
    );
  }
  // PER and PER.
  if (ta.kind === 'line' && tb.kind === 'line') {
    const ua = normalize(ta.direction);
    if (Math.abs(cross(ua, normalize(tb.direction))) > tol.angular) return [];
    const start = foot(ta, a.pick);
    return [{ start, end: foot(tb, start) }];
  }
  if (ta.kind === 'circle' && tb.kind === 'line') return bothDeferred(b, a, tol).map(swap);
  if (ta.kind === 'line' && tb.kind === 'circle') {
    const start = foot(ta, tb.center);
    const toward = sub(tb.center, start);
    const dir = length(toward) > tol.linear ? toward : perp(ta.direction);
    return throughCircle(tb, dir, tol).map((end) => ({ start, end }));
  }
  const ca = ta as CircleT;
  const cb = tb as CircleT;
  const dir = sub(cb.center, ca.center);
  return throughCircle(ca, dir, tol).flatMap((start) =>
    throughCircle(cb, dir, tol).map((end) => ({ start, end })),
  );
}

/** The two points of a circle on the line through its centre along `dir`. */
function throughCircle(c: CircleT, dir: Vec2, tol: Tolerance): Vec2[] {
  const u = unitOr(dir, tol);
  return u ? [add(c.center, scale(u, c.radius)), sub(c.center, scale(u, c.radius))] : [];
}

function unitOr(v: Vec2, tol: Tolerance): Vec2 | undefined {
  return length(v) > tol.linear ? normalize(v) : undefined;
}

function foot(l: LineT, p: Vec2): Vec2 {
  const u = normalize(l.direction);
  return add(l.point, scale(u, dot(sub(p, l.point), u)));
}

/** Where the tangents from `p` touch a circle; none from inside it or on it. */
function tangentPoints(c: CircleT, p: Vec2, tol: Tolerance): Vec2[] {
  const v = sub(p, c.center);
  const d = length(v);
  if (d <= c.radius + tol.linear) return [];
  const u = scale(v, 1 / d);
  const along = (c.radius * c.radius) / d;
  const side = c.radius * Math.sqrt(Math.max(0, 1 - (c.radius * c.radius) / (d * d)));
  const base = add(c.center, scale(u, along));
  return [add(base, scale(perp(u), side)), sub(base, scale(perp(u), side))];
}

/**
 * The lines tangent to two circles, as their touching points: the two outer tangents and, when
 * the circles do not overlap, the two that cross between them. A line n·x + k = 0 touches a
 * circle where its signed distance from the centre is ±radius; with c₁'s taken as +r₁, n·(c₂ −
 * c₁) = d₂ − r₁ fixes n's angle to the line of centres.
 */
function commonTangents(a: CircleT, b: CircleT, tol: Tolerance): Segment[] {
  const between = sub(b.center, a.center);
  const l = length(between);
  if (l <= tol.linear) return [];
  const u = scale(between, 1 / l);
  const out: Segment[] = [];
  for (const d2 of [b.radius, -b.radius]) {
    const cos = (d2 - a.radius) / l;
    if (Math.abs(cos) > 1 + tol.angular) continue;
    const c = Math.max(-1, Math.min(1, cos));
    const sin = Math.sqrt(1 - c * c);
    for (const s of sin === 0 ? [1] : [1, -1]) {
      const n = add(scale(u, c), scale(perp(u), s * sin));
      out.push({ start: sub(a.center, scale(n, a.radius)), end: sub(b.center, scale(n, d2)) });
    }
  }
  return out;
}

// ── Circles through points and tangent to objects (CIRCLE 3P, Tan Tan Tan) ─────────────────

/**
 * CIRCLE 3P where any of the three may be a deferred TANgent to a line, circle or arc (the
 * problem of Apollonius and its cases with points). Each tangency to a circle is external or
 * internal and each line may be touched from either side; for each choice the conditions on the
 * centre (x, y) and radius r are |c − Q| = ρ ± r for a point (ρ = 0) or circle, and n·c ∓ r = n·P
 * for a line. Any two circle-or-point conditions differ by a linear one, so with the lines'
 * there are two linear equations, leaving a line of solutions that one quadratic condition cuts
 * in at most two places (three lines: one linear system). Of all the circles found, the one
 * whose touching points lie closest to the picks wins.
 */
export function circleThroughItems(
  items: readonly [DeferredItem, DeferredItem, DeferredItem],
  tol: Tolerance,
): Circle | undefined {
  const [a, b, c] = items;
  if (!isDeferred(a) && !isDeferred(b) && !isDeferred(c)) return circleThrough3(a, b, c, tol);
  if (items.some((i) => isDeferred(i) && i.mode !== 'TAN')) return undefined;
  // Solved about the first item, so that a drawing far from the origin keeps its precision.
  const origin = itemPoint(a);
  const local = items.map((i) => localItem(i, origin));
  const size = Math.max(
    tol.linear,
    ...local.map((i) =>
      i.kind === 'point'
        ? length(i.p)
        : i.kind === 'circle'
          ? length(i.c) + i.r
          : length(i.p) + length(i.pick),
    ),
  );
  // Roots of a quadratic carry about the square root of its rounding error: checked against
  // that, scaled from the drawing's tolerance, an exact tangency still counts.
  const near = Math.max(tol.linear, Math.sqrt(tol.angular) * size);
  let best: Circle | undefined;
  let bestD = Infinity;
  for (const signs of signChoices(local)) {
    for (const s of solve(local, signs, tol)) {
      if (!(s.r > near) || !fits(local, signs, s, near)) continue;
      const d = local.reduce((sum, i) => sum + touchDistance(i, s), 0);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'CIRCLE', center: add(origin, s.c), radius: s.r };
      }
    }
  }
  return best;
}

type Local =
  | { readonly kind: 'point'; readonly p: Vec2 }
  | { readonly kind: 'circle'; readonly c: Vec2; readonly r: number; readonly pick: Vec2 }
  | { readonly kind: 'line'; readonly p: Vec2; readonly n: Vec2; readonly pick: Vec2 };

function localItem(i: DeferredItem, o: Vec2): Local {
  if (!isDeferred(i)) return { kind: 'point', p: sub(i, o) };
  const t = i.target;
  const pick = sub(i.pick, o);
  if (t.kind === 'circle') return { kind: 'circle', c: sub(t.center, o), r: t.radius, pick };
  return { kind: 'line', p: sub(t.point, o), n: perp(normalize(t.direction)), pick };
}

/** ±1 for each circle (r added or taken away) and line (the side touched); 1 for a point. */
function signChoices(items: readonly Local[]): number[][] {
  let out: number[][] = [[]];
  for (const i of items) {
    const options = i.kind === 'point' ? [1] : [1, -1];
    out = out.flatMap((s) => options.map((o) => [...s, o]));
  }
  return out;
}

type Solution = { readonly c: Vec2; readonly r: number };
type V3 = readonly [number, number, number];

/** The circles meeting the three conditions with these signs (unchecked). */
function solve(items: readonly Local[], signs: readonly number[], tol: Tolerance): Solution[] {
  // Each condition on u = (x, y, r): a line's is linear, row·u = rhs; a point's or circle's is
  // x² + y² − r² + q·u + k = 0 (|c − Q|² = (ρ + σr)²).
  const rows: { row: V3; rhs: number }[] = [];
  const quads: { q: V3; k: number }[] = [];
  items.forEach((i, n) => {
    const s = signs[n]!;
    if (i.kind === 'line') rows.push({ row: [i.n.x, i.n.y, -s], rhs: dot(i.n, i.p) });
    else {
      const [c, rho] = i.kind === 'point' ? [i.p, 0] : [i.c, i.r];
      quads.push({ q: [-2 * c.x, -2 * c.y, -2 * rho * s], k: dot(c, c) - rho * rho });
    }
  });
  const q0 = quads[0];
  if (!q0) return solveLinear3(rows, tol);
  for (const qi of quads.slice(1)) {
    rows.push({ row: [qi.q[0] - q0.q[0], qi.q[1] - q0.q[1], qi.q[2] - q0.q[2]], rhs: q0.k - qi.k });
  }
  const [r1, r2] = [rows[0]!, rows[1]!];
  // The solutions of the two linear equations: u0 + t·m, m along both planes.
  const m = cross3(r1.row, r2.row);
  const mm = Math.hypot(...m);
  const scaleRows = Math.hypot(...r1.row) * Math.hypot(...r2.row);
  if (!(mm > tol.angular * scaleRows)) return [];
  const g11 = dot3(r1.row, r1.row);
  const g12 = dot3(r1.row, r2.row);
  const g22 = dot3(r2.row, r2.row);
  const det = g11 * g22 - g12 * g12;
  const l1 = (r1.rhs * g22 - r2.rhs * g12) / det;
  const l2 = (r2.rhs * g11 - r1.rhs * g12) / det;
  const u0: V3 = [
    l1 * r1.row[0] + l2 * r2.row[0],
    l1 * r1.row[1] + l2 * r2.row[1],
    l1 * r1.row[2] + l2 * r2.row[2],
  ];
  const mu: V3 = [m[0] / mm, m[1] / mm, m[2] / mm];
  // x² + y² − r² along the line.
  const form = (v: V3, w: V3) => v[0] * w[0] + v[1] * w[1] - v[2] * w[2];
  const A = form(mu, mu);
  const B = 2 * form(u0, mu) + dot3(q0.q, mu);
  const C = form(u0, u0) + dot3(q0.q, u0) + q0.k;
  const ts: number[] = [];
  const big = Math.max(B * B, Math.abs(4 * A * C));
  if (A === 0) {
    if (B !== 0) ts.push(-C / B);
  } else {
    // With A near 0 one root runs off to infinity (and fails `fits`); the other stays exact.
    let disc = B * B - 4 * A * C;
    // Rounding can push an exact tangency just below zero; whether it counts is `fits`'s call.
    if (disc < 0 && disc > -Math.sqrt(tol.angular) * big) disc = 0;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      // The stable pair of roots (no cancellation between B and the root).
      const qq = -(B + (B >= 0 ? sq : -sq)) / 2;
      if (qq !== 0) ts.push(qq / A, C / qq);
      else ts.push(0);
    }
  }
  return ts.map((t) => ({
    c: { x: u0[0] + t * mu[0], y: u0[1] + t * mu[1] },
    r: u0[2] + t * mu[2],
  }));
}

function solveLinear3(rows: readonly { row: V3; rhs: number }[], tol: Tolerance): Solution[] {
  const [a, b, c] = rows.map((r) => r.row) as [V3, V3, V3];
  const det = dot3(a, cross3(b, c));
  if (!(Math.abs(det) > tol.angular)) return [];
  const d = rows.map((r) => r.rhs);
  // Cramer's rule: unknown k is the determinant with column k replaced by the right-hand sides.
  const unknown = (k: number): number => {
    const row = (v: V3, i: number): V3 => [
      k === 0 ? d[i]! : v[0],
      k === 1 ? d[i]! : v[1],
      k === 2 ? d[i]! : v[2],
    ];
    return dot3(row(a, 0), cross3(row(b, 1), row(c, 2))) / det;
  };
  return [{ c: { x: unknown(0), y: unknown(1) }, r: unknown(2) }];
}

/** Whether a solution meets every condition with its signs. */
function fits(
  items: readonly Local[],
  signs: readonly number[],
  s: Solution,
  near: number,
): boolean {
  return items.every((i, n) => {
    const sign = signs[n]!;
    if (i.kind === 'point') return Math.abs(distance(s.c, i.p) - s.r) <= near;
    if (i.kind === 'line') return Math.abs(dot(i.n, sub(s.c, i.p)) - sign * s.r) <= near;
    // |c − C| = R + r outside it, |R − r| inside it or around it; r = R about the same centre
    // is the object itself, not a circle touching it.
    if (distance(s.c, i.c) <= near) return false;
    return Math.abs(distance(s.c, i.c) - Math.abs(i.r + sign * s.r)) <= near;
  });
}

/** How far the circle touches an object from where it was picked (0 for a point). */
function touchDistance(i: Local, s: Solution): number {
  if (i.kind === 'point') return 0;
  if (i.kind === 'line') return distance(sub(s.c, scale(i.n, dot(i.n, sub(s.c, i.p)))), i.pick);
  // Of the object's two points on the line of centres, the one on the circle.
  const u = normalize(sub(s.c, i.c));
  const touch = [add(i.c, scale(u, i.r)), sub(i.c, scale(u, i.r))].reduce((p, q) =>
    Math.abs(distance(p, s.c) - s.r) <= Math.abs(distance(q, s.c) - s.r) ? p : q,
  );
  return distance(touch, i.pick);
}

const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
