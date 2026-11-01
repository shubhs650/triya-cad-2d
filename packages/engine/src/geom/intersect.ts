// Intersections of any two curves (osnap INT, TRIM, EXTEND, BREAK, region building).
//
// Line, circle and line–ellipse pairs are solved in closed form (an ellipse is the affine
// image of the unit circle, and affine maps keep lines straight and their parameters).
// Every other pair (circle–ellipse, ellipse–ellipse, anything–spline) is solved by flattening
// both pieces, intersecting the chords for seeds, and polishing each seed with Newton's method
// on the true curves; seeds that do not converge are dropped.
//
// Overlapping (collinear or concentric-coincident) curves have no isolated intersection and
// report none, matching AutoCAD's INT osnap, which does not snap along an overlap.

import { angleWithin } from './angle';
import { boxesOverlap, boxOf, unionBox, type Box } from './bounds';
import type { Curve } from './curves';
import {
  flattenPiece,
  pieceEval,
  piecePoint,
  piecesOf,
  toCurveParam,
  type CircularPiece,
  type EllipticPiece,
  type LinearPiece,
  type Piece,
} from './pieces';
import type { Tolerance } from './tolerance';
import { add, angleOf, cross, distance, dot, length, scale, sub } from './vec';
import type { Vec2 } from './types';

export interface Intersection {
  readonly point: Vec2;
  /** Parameter on the first curve. */
  readonly ta: number;
  /** Parameter on the second curve. */
  readonly tb: number;
}

type Hit = { point: Vec2; sa: number; sb: number };

/** Local parameter of a linear piece if s is within its range (within tolerance), clamped. */
function onLinear(pc: LinearPiece, s: number, tol: Tolerance): number | undefined {
  const eps = tol.linear / length(pc.d);
  if (s < pc.s0 - eps || s > pc.s1 + eps) return undefined;
  return Math.min(pc.s1, Math.max(pc.s0, s));
}

/** Local parameter of a point at angle θ on a circular (or unit-frame elliptic) piece. */
function onSwept(a0: number, sweep: number, theta: number, angTol: number): number | undefined {
  const lo = sweep >= 0 ? a0 : a0 + sweep;
  const t = angleWithin(theta, lo, Math.abs(sweep), { linear: 0, angular: angTol });
  if (t === undefined) return undefined;
  return (t - a0) / sweep;
}

function linearLinear(a: LinearPiece, b: LinearPiece, tol: Tolerance): Hit[] {
  const den = cross(a.d, b.d);
  if (Math.abs(den) <= tol.angular * length(a.d) * length(b.d)) return [];
  const w = sub(b.p, a.p);
  const sa = onLinear(a, cross(w, b.d) / den, tol);
  const sb = onLinear(b, cross(w, a.d) / den, tol);
  if (sa === undefined || sb === undefined) return [];
  return [{ point: pieceEval(a, sa)[0], sa, sb }];
}

/** Line p + s·d against the circle |x − c| = r: parameters along the line. */
function lineCircleParams(p: Vec2, d: Vec2, c: Vec2, r: number, linTol: number): number[] {
  const dd = dot(d, d);
  const sFoot = dot(sub(c, p), d) / dd;
  const foot = add(p, scale(d, sFoot));
  const h = distance(foot, c);
  if (h > r + linTol) return [];
  if (h >= r - linTol) return [sFoot];
  const half = Math.sqrt(r * r - h * h) / Math.sqrt(dd);
  return [sFoot - half, sFoot + half];
}

function linearCircular(a: LinearPiece, b: CircularPiece, tol: Tolerance): Hit[] {
  const out: Hit[] = [];
  for (const s of lineCircleParams(a.p, a.d, b.c, b.r, tol.linear)) {
    const sa = onLinear(a, s, tol);
    if (sa === undefined) continue;
    const point = pieceEval(a, sa)[0];
    const sb = onSwept(b.a0, b.sweep, angleOf(sub(point, b.c)), tol.angular + tol.linear / b.r);
    if (sb !== undefined) out.push({ point, sa, sb });
  }
  return out;
}

function circularCircular(a: CircularPiece, b: CircularPiece, tol: Tolerance): Hit[] {
  const d = distance(a.c, b.c);
  if (d <= tol.linear) return [];
  if (d > a.r + b.r + tol.linear || d < Math.abs(a.r - b.r) - tol.linear) return [];
  // Distance from a's centre to the radical line, and half the common chord.
  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const tangent =
    Math.abs(d - (a.r + b.r)) <= tol.linear || Math.abs(d - Math.abs(a.r - b.r)) <= tol.linear;
  const h = tangent ? 0 : Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const u = scale(sub(b.c, a.c), 1 / d);
  const base = add(a.c, scale(u, x));
  const pts =
    h === 0
      ? [base]
      : [add(base, scale({ x: -u.y, y: u.x }, h)), add(base, scale({ x: u.y, y: -u.x }, h))];
  const out: Hit[] = [];
  for (const point of pts) {
    const sa = onSwept(a.a0, a.sweep, angleOf(sub(point, a.c)), tol.angular + tol.linear / a.r);
    const sb = onSwept(b.a0, b.sweep, angleOf(sub(point, b.c)), tol.angular + tol.linear / b.r);
    if (sa !== undefined && sb !== undefined) out.push({ point, sa, sb });
  }
  return out;
}

/** Ellipse frame: x = c + A·X + B·Y maps the unit circle onto the ellipse. */
function toUnitFrame(e: EllipticPiece, v: Vec2): Vec2 {
  const det = cross(e.A, e.B);
  return { x: cross(v, e.B) / det, y: cross(e.A, v) / det };
}

function linearElliptic(a: LinearPiece, b: EllipticPiece, tol: Tolerance): Hit[] {
  const p = toUnitFrame(b, sub(a.p, b.c));
  const d = toUnitFrame(b, a.d);
  // Tolerances shrink by the minor radius going into the unit frame.
  const minor = length(b.B);
  const out: Hit[] = [];
  for (const s of lineCircleParams(p, d, { x: 0, y: 0 }, 1, tol.linear / minor)) {
    const sa = onLinear(a, s, tol);
    if (sa === undefined) continue;
    const q = add(p, scale(d, sa));
    const sb = onSwept(b.u0, b.sweep, angleOf(q), tol.angular + tol.linear / minor);
    if (sb !== undefined) out.push({ point: pieceEval(b, sb)[0], sa, sb });
  }
  return out;
}

/** A box containing a finite piece (loose for arcs and splines; used for sizing and clipping). */
function pieceBox(pc: Piece): Box {
  switch (pc.kind) {
    case 'linear':
      return boxOf([pieceEval(pc, pc.s0)[0], pieceEval(pc, pc.s1)[0]]);
    case 'circular':
      return { minX: pc.c.x - pc.r, minY: pc.c.y - pc.r, maxX: pc.c.x + pc.r, maxY: pc.c.y + pc.r };
    case 'elliptic': {
      const r = length(pc.A) + length(pc.B);
      return { minX: pc.c.x - r, minY: pc.c.y - r, maxX: pc.c.x + r, maxY: pc.c.y + r };
    }
    case 'spline':
      return boxOf(pc.spline.controlPoints);
  }
}

/** Clips an infinite linear piece to a box (plus margin) so it can be flattened. */
function clipLinear(pc: LinearPiece, box: Box): LinearPiece | undefined {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
  ];
  const dd = dot(pc.d, pc.d);
  const ss = corners.map((q) => dot(sub(q, pc.p), pc.d) / dd);
  const s0 = Math.max(pc.s0, Math.min(...ss) - 1);
  const s1 = Math.min(pc.s1, Math.max(...ss) + 1);
  return s1 > s0 ? { ...pc, s0, s1 } : undefined;
}

/** Extent of a box: the flattening deviation scales with a piece's own size, not its position. */
const extentOf = (b: Box): number => Math.max(b.maxX - b.minX, b.maxY - b.minY);

/**
 * Newton's method on F(sa, sb) = A(sa) − B(sb), kept inside the windows `wa` and `wb` so it
 * cannot wander off to a different (already found) intersection elsewhere on the piece.
 */
function polish(
  a: Piece,
  b: Piece,
  sa: number,
  sb: number,
  wa: readonly [number, number],
  wb: readonly [number, number],
  tol: Tolerance,
): Hit | undefined {
  for (let i = 0; i < 50; i++) {
    const [pa, da] = pieceEval(a, sa);
    const [pb, db] = pieceEval(b, sb);
    const f = sub(pa, pb);
    if (length(f) <= tol.linear * 1e-3) break;
    const det = cross(db, da);
    if (det === 0) return undefined;
    // Solve da·Δa − db·Δb = −f by Cramer's rule.
    const dA = cross(f, db) / det;
    const dB = cross(f, da) / det;
    sa = Math.min(wa[1], Math.max(wa[0], sa + dA));
    sb = Math.min(wb[1], Math.max(wb[0], sb + dB));
  }
  const pa = pieceEval(a, sa)[0];
  const pb = pieceEval(b, sb)[0];
  if (distance(pa, pb) > tol.linear) return undefined;
  return { point: scale(add(pa, pb), 0.5), sa, sb };
}

/** Closest point of segment a0→a1 to q, as a fraction in [0, 1]. */
function fractionOn(a0: Vec2, a1: Vec2, q: Vec2): number {
  const d = sub(a1, a0);
  const dd = dot(d, d);
  return dd === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(q, a0), d) / dd));
}

/**
 * Seed fractions (u on chord a, v on chord b) where two chords cross, or come within `band`
 * of each other: each curve is within its own deviation of its chords, so a crossing of the
 * curves can hide in that band (shallow crossings, or a short piece against a long chord).
 */
function chordSeed(
  a0: Vec2,
  a1: Vec2,
  b0: Vec2,
  b1: Vec2,
  band: number,
): [number, number] | undefined {
  const da = sub(a1, a0);
  const db = sub(b1, b0);
  const den = cross(da, db);
  if (den !== 0) {
    const w = sub(b0, a0);
    const u = cross(w, db) / den;
    const v = cross(w, da) / den;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return [u, v];
  }
  // Nearest approach of the two segments is at an end of one of them.
  let best: [number, number] | undefined;
  let bestD = band;
  const consider = (u: number, v: number): void => {
    const d = distance(add(a0, scale(da, u)), add(b0, scale(db, v)));
    if (d <= bestD) {
      bestD = d;
      best = [u, v];
    }
  };
  consider(0, fractionOn(b0, b1, a0));
  consider(1, fractionOn(b0, b1, a1));
  consider(fractionOn(a0, a1, b0), 0);
  consider(fractionOn(a0, a1, b1), 1);
  return best;
}

function numeric(a: Piece, b: Piece, tol: Tolerance): Hit[] {
  // Size the flattening from the finite piece(s); infinite lines are clipped to the other's box.
  const isFinite = (p: Piece): boolean => Number.isFinite(p.s0) && Number.isFinite(p.s1);
  // At most one side is an infinite line here: line–line pairs are solved analytically.
  const box = [a, b].filter(isFinite).map(pieceBox).reduce(unionBox);
  const clip = (p: Piece): Piece | undefined =>
    p.kind === 'linear' && !isFinite(p) ? clipLinear(p, box) : p;
  const ca = clip(a);
  const cb = clip(b);
  if (!ca || !cb) return [];
  // Each piece is flattened relative to its own size, so a small fillet against a large
  // circle is still sampled finely; the seed band is the sum of both chord deviations.
  const devOf = (p: Piece): number => Math.max(tol.linear, 1e-3 * extentOf(pieceBox(p)));
  const da = devOf(ca);
  const db = devOf(cb);
  const dev = da + db;
  const fa = flattenPiece(ca, da);
  const fb = flattenPiece(cb, db);
  const hits: Hit[] = [];
  for (let i = 1; i < fa.points.length; i++) {
    for (let j = 1; j < fb.points.length; j++) {
      seedPair(ca, cb, [fa.s[i - 1]!, fa.s[i]!], [fb.s[j - 1]!, fb.s[j]!], dev, 5, tol, hits);
    }
  }
  return hits;
}

/** Largest angle between the tangent directions of a piece at the given parameters. */
function turning(p: Piece, ss: readonly number[]): number {
  const ds = ss.map((s) => pieceEval(p, s)[1]);
  let worst = 0;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      worst = Math.max(worst, Math.abs(Math.atan2(cross(ds[i]!, ds[j]!), dot(ds[i]!, ds[j]!))));
    }
  }
  return worst;
}

/**
 * True when the hit is the only crossing of the two ranges: if each curve turns by less, in
 * total, than the angle at which they cross, a second crossing would need one of them to
 * turn back (the cone test of Bézier clipping, with the ends and the hit as samples).
 */
function singleCrossing(
  a: Piece,
  b: Piece,
  ra: readonly [number, number],
  rb: readonly [number, number],
  hit: Hit,
): boolean {
  const da = pieceEval(a, hit.sa)[1];
  const db = pieceEval(b, hit.sb)[1];
  const angle = Math.atan2(Math.abs(cross(da, db)), Math.abs(dot(da, db)));
  return turning(a, [ra[0], hit.sa, ra[1]]) + turning(b, [rb[0], hit.sb, rb[1]]) < angle;
}

/**
 * Newton from the seed of one chord pair; when it does not converge (the chords are too
 * coarse for a shallow crossing on a tight bend), or a second crossing may hide in the same
 * pair, halve both ranges and retry, up to `depth` times. Halving a chord quarters its deviation, so the band shrinks by four each level.
 */
function seedPair(
  a: Piece,
  b: Piece,
  ra: readonly [number, number],
  rb: readonly [number, number],
  band: number,
  depth: number,
  tol: Tolerance,
  hits: Hit[],
): void {
  const a0 = piecePoint(a, ra[0]);
  const a1 = piecePoint(a, ra[1]);
  const b0 = piecePoint(b, rb[0]);
  const b1 = piecePoint(b, rb[1]);
  if (!boxesOverlap(boxOf([a0, a1]), boxOf([b0, b1]), band)) return;
  const seed = chordSeed(a0, a1, b0, b1, band);
  if (!seed) return;
  const sa = ra[0] + seed[0] * (ra[1] - ra[0]);
  const sb = rb[0] + seed[1] * (rb[1] - rb[0]);
  // Newton stays inside this chord pair's ranges; a crossing just beyond them belongs to a
  // neighbouring pair, which seeds it itself.
  const hit = polish(a, b, sa, sb, ra, rb, tol);
  if (hit) hits.push(hit);
  if (depth === 0 || (hit && singleCrossing(a, b, ra, rb, hit))) return;
  const am = (ra[0] + ra[1]) / 2;
  const bm = (rb[0] + rb[1]) / 2;
  const next = Math.max(band / 4, 2 * tol.linear);
  for (const ha of [
    [ra[0], am],
    [am, ra[1]],
  ] as const) {
    for (const hb of [
      [rb[0], bm],
      [bm, rb[1]],
    ] as const) {
      seedPair(a, b, ha, hb, next, depth - 1, tol, hits);
    }
  }
}

function pieceHits(a: Piece, b: Piece, tol: Tolerance): Hit[] {
  if (a.kind === 'linear' && b.kind === 'linear') return linearLinear(a, b, tol);
  if (a.kind === 'linear' && b.kind === 'circular') return linearCircular(a, b, tol);
  if (a.kind === 'circular' && b.kind === 'linear') return swap(linearCircular(b, a, tol));
  if (a.kind === 'circular' && b.kind === 'circular') return circularCircular(a, b, tol);
  if (a.kind === 'linear' && b.kind === 'elliptic') return linearElliptic(a, b, tol);
  if (a.kind === 'elliptic' && b.kind === 'linear') return swap(linearElliptic(b, a, tol));
  return numeric(a, b, tol);
}

const swap = (hs: Hit[]): Hit[] => hs.map((h) => ({ point: h.point, sa: h.sb, sb: h.sa }));

/** All isolated intersections of a and b, sorted along a; points closer than tol.linear merge. */
export function intersect(a: Curve, b: Curve, tol: Tolerance): Intersection[] {
  const out: Intersection[] = [];
  for (const pa of piecesOf(a)) {
    for (const pb of piecesOf(b)) {
      for (const h of pieceHits(pa, pb, tol)) {
        if (out.some((o) => distance(o.point, h.point) <= tol.linear)) continue;
        out.push({ point: h.point, ta: toCurveParam(pa, h.sa), tb: toCurveParam(pb, h.sb) });
      }
    }
  }
  return out.sort((x, y) => x.ta - y.ta);
}
