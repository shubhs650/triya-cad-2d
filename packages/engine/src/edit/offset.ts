// OFFSET's geometry (M3-02): the objects an offset makes, on top of the kernel's `offset`
// (geom/offset.ts), as AutoCAD 2024 makes them (AutoCAD 2024 Help, "OFFSET (Command)",
// OFFSETGAPTYPE):
//
// - a line, arc, circle, ray or xline offsets as itself; an arc or circle that would shrink to
//   nothing makes nothing;
// - a polyline (LWPOLYLINE, or a 2D POLYLINE) offsets as a polyline of its kind with OFFSETGAPTYPE
//   0's extended corners (the kernel's), its constant width or each segment's widths kept. An
//   inward offset of a tight shape can cross itself: the loops that come closer to the source
//   than the offset distance are cut out where the offset crosses itself, and what is left is
//   joined into one or more polylines, as AutoCAD returns (`untangle`). A curve-fit or
//   spline-fit 2D polyline offsets the curve it draws, as a plain polyline (AutoCAD keeps the
//   fit; the vertices it would fit through are not the drawn ones). A 3D polyline cannot be
//   offset, as in AutoCAD ("Cannot offset that object.");
// - an ellipse or spline offsets as a SPLINE, as AutoCAD returns: a cubic interpolated through
//   samples of the true offset, refined until it is within 1e-6 of the curve's size (a spline
//   stored as fit points alone offsets the cubic through them). An ellipse's elevation is not
//   kept: a SPLINE is in WCS.
import { boxOf } from '../geom/bounds';
import { closestPoint } from '../geom/closest';
import type { Arc, Curve, Ellipse, Line, Polyline, Spline } from '../geom/curves';
import {
  derivativeAt,
  domain,
  explodePolyline,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
  type BulgeArc,
} from '../geom/eval';
import { fitSpline } from '../geom/fit';
import { flatten } from '../geom/flatten';
import { intersect } from '../geom/intersect';
import { splineDomain, splinePoint } from '../geom/nurbs';
import { offset, offsetPolylineTraced, sideOf } from '../geom/offset';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2, Vec3 } from '../geom/types';
import { add, angleOf, distance, dot, fromAngle, lerp, normalize, sub } from '../geom/vec';
import { splineCurve } from '../model/spline';
import type {
  EntityGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/types';

/**
 * The curve OFFSET measures and offsets `g` as (a 2D POLYLINE as the polyline it draws, its
 * repeated vertices dropped), or undefined for an object it cannot offset.
 */
export function offsetCurveOf(g: EntityGeometry): Curve | undefined {
  switch (g.kind) {
    case 'LINE':
    case 'ARC':
    case 'CIRCLE':
    case 'ELLIPSE':
    case 'XLINE':
    case 'RAY':
      return g;
    case 'SPLINE':
      // The NURBS it draws: a spline stored as fit points alone is the cubic through them.
      return splineCurve(g);
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (g.kind === 'POLYLINE' && g.is3d) return undefined;
      const p = cleanPolyline(g).curve;
      return polylineSegmentCount(p) > 0 ? p : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The objects offsetting `g` by `d` makes (positive to the left of its direction, as the
 * kernel's `offset`): none when it collapses or cannot be offset, more than one when an inward
 * polyline offset falls apart into several.
 */
export function offsetGeometry(g: EntityGeometry, d: number, tol: Tolerance): EntityGeometry[] {
  switch (g.kind) {
    case 'LINE':
    case 'ARC':
    case 'CIRCLE':
    case 'XLINE':
    case 'RAY': {
      const o = offset(g, d, tol);
      // The kernel keeps the kind; the entity keeps its elevation, thickness and extrusion.
      return o ? [{ ...g, ...o } as EntityGeometry] : [];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      if (g.kind === 'POLYLINE' && g.is3d) return [];
      return offsetPolylineGeometry(g, d, tol);
    case 'ELLIPSE': {
      const s = offsetFitted(g, d, tol, undefined);
      return s ? [s] : [];
    }
    case 'SPLINE': {
      const c = splineCurve(g);
      const s = c && offsetFitted(c, d, tol, g.normal);
      return s ? [s] : [];
    }
    default:
      return [];
  }
}

// ── Polylines ──────────────────────────────────────────────────────────────────────────────

/** A polyline without repeated vertices, and the source vertex each of its vertices is. */
export function cleanPolyline(g: LwPolylineGeometry | PolylineGeometry): {
  curve: Polyline;
  index: number[];
} {
  const vertices: { x: number; y: number; bulge: number }[] = [];
  const index: number[] = [];
  g.vertices.forEach((v, i) => {
    const last = vertices.at(-1);
    if (last && last.x === v.x && last.y === v.y) {
      // The repeated vertex's bulge is the one its next segment has.
      last.bulge = v.bulge;
      return;
    }
    vertices.push({ x: v.x, y: v.y, bulge: v.bulge });
    index.push(i);
  });
  if (g.closed && vertices.length > 1) {
    const a = vertices[0]!;
    const z = vertices.at(-1)!;
    if (a.x === z.x && a.y === z.y) {
      vertices.pop();
      index.pop();
    }
  }
  return { curve: { kind: 'LWPOLYLINE', closed: g.closed, vertices }, index };
}

function offsetPolylineGeometry(
  g: LwPolylineGeometry | PolylineGeometry,
  d: number,
  tol: Tolerance,
): EntityGeometry[] {
  const { curve, index } = cleanPolyline(g);
  if (polylineSegmentCount(curve) === 0) return [];
  const traced = offsetPolylineTraced(curve, d, tol);
  if (!traced) return [];
  const widths = segmentWidths(g, index, polylineSegmentCount(curve));
  // Pieces straight on from one another are one segment, unless their widths may differ.
  const chains = untangle(curve, traced.polyline, traced.from, Math.abs(d), tol, !widths);
  return chains.map((c) => {
    const vertices: PolylineVertex[] = c.vertices.map((v, k) => {
      const w = k < c.segments.length ? widthsOf(widths, c.segments[k]!) : undefined;
      return {
        x: v.x,
        y: v.y,
        bulge: v.bulge,
        // A zero width is no width, as the file maps it.
        ...(w && (w[0] !== 0 || w[1] !== 0) && { startWidth: w[0], endWidth: w[1] }),
      };
    });
    if (g.kind === 'LWPOLYLINE') {
      const out: LwPolylineGeometry = { ...g, vertices, closed: c.closed };
      return out;
    }
    const { fit: _fit, frame: _frame, ...rest } = g;
    const out: PolylineGeometry = { ...rest, vertices, closed: c.closed };
    return out;
  });
}

/** Each source segment's start and end widths, or undefined when the polyline has none. */
export function segmentWidths(
  g: LwPolylineGeometry | PolylineGeometry,
  index: readonly number[],
  n: number,
): (readonly [number, number])[] | undefined {
  // A constant width is the polyline's own and stays so (LWPOLYLINE DXF 43).
  if (g.kind === 'LWPOLYLINE' && g.constantWidth !== undefined) return undefined;
  const dsw = g.kind === 'POLYLINE' ? (g.startWidth ?? 0) : 0;
  const dew = g.kind === 'POLYLINE' ? (g.endWidth ?? 0) : 0;
  const out = index.slice(0, n).map((i) => {
    const v = g.vertices[i]!;
    return [v.startWidth ?? dsw, v.endWidth ?? dew] as const;
  });
  return out.some(([a, b]) => a !== 0 || b !== 0) ? out : undefined;
}

/** A piece's widths: its source segment's, taken along it where the piece is part of it. */
function widthsOf(
  widths: readonly (readonly [number, number])[] | undefined,
  s: SubSegment,
): readonly [number, number] | undefined {
  if (!widths) return undefined;
  if (s.src < 0) return [0, 0];
  const [a, b] = widths[s.src]!;
  return [a + (b - a) * s.f0, a + (b - a) * s.f1];
}

/** A part of one segment of the raw offset, from fraction `f0` to `f1` of it. */
interface SubSegment {
  /** The raw offset's segment. */
  readonly k: number;
  /** The source segment it offsets, −1 for a bridge across a gap. */
  readonly src: number;
  readonly f0: number;
  readonly f1: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly bulge: number;
}

interface Chain {
  readonly vertices: readonly { x: number; y: number; bulge: number }[];
  readonly segments: readonly SubSegment[];
  readonly closed: boolean;
}

type Segment = { line: { a: Vec2; b: Vec2 } } | { arc: BulgeArc };

const segPoint = (s: Segment, f: number): Vec2 =>
  'line' in s
    ? lerp(s.line.a, s.line.b, f)
    : add(s.arc.center, fromAngle(s.arc.startAngle + s.arc.sweep * f, s.arc.radius));

/** Where `p`, on segment `s`, lies along it, 0 at its start and 1 at its end. */
function fractionOn(s: Segment, p: Vec2): number {
  if ('line' in s) {
    const d = sub(s.line.b, s.line.a);
    const l2 = dot(d, d);
    return l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, s.line.a), d) / l2));
  }
  const { center, startAngle, sweep } = s.arc;
  let a = (angleOf(sub(p, center)) - startAngle) * Math.sign(sweep);
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // A point just before the start reads as a whole turn round: it is at the start.
  if (a > Math.abs(sweep) && a > Math.PI + Math.abs(sweep) / 2) a = 0;
  return Math.min(1, a / Math.abs(sweep));
}

/** A segment as a curve `intersect` takes: a LINE, or the CCW ARC it runs along. */
function segCurve(s: Segment): Curve {
  if ('line' in s) return { kind: 'LINE', start: s.line.a, end: s.line.b };
  const { center, radius, startAngle, sweep } = s.arc;
  const [a0, a1] = sweep > 0 ? [startAngle, startAngle + sweep] : [startAngle + sweep, startAngle];
  return { kind: 'ARC', center, radius, startAngle: a0, endAngle: a1 };
}

/** Where `p` lies on segment `s`, within `eps` of it, as a fraction along it. */
function onSegment(s: Segment, p: Vec2, eps: number): number | undefined {
  if ('line' in s) {
    const d = sub(s.line.b, s.line.a);
    const l = Math.hypot(d.x, d.y);
    if (l === 0) return undefined;
    const f = dot(sub(p, s.line.a), d) / (l * l);
    if (f < -eps / l || f > 1 + eps / l) return undefined;
    return distance(lerp(s.line.a, s.line.b, f), p) <= eps
      ? Math.min(1, Math.max(0, f))
      : undefined;
  }
  if (Math.abs(distance(p, s.arc.center) - s.arc.radius) > eps) return undefined;
  const f = fractionOn(s, p);
  return distance(segPoint(s, f), p) <= eps ? f : undefined;
}

/**
 * The raw offset of `source` with the loops that cross back closer to it than `dist` cut out
 * (the trimming AutoCAD's OFFSET does on an inward offset of a tight polyline): the raw offset
 * is split where it crosses or touches itself, every piece of an offset segment whose middle
 * lies closer to the source than `dist` is dropped (a piece bridging a gap goes with its
 * neighbours), a piece run twice the same way is kept once and one run both ways is dropped
 * (where two offsets overlap), and the pieces left are joined end to start, each chain
 * following the raw offset where it can and closing where it comes back to its start.
 */
function untangle(
  source: Polyline,
  raw: Polyline,
  from: readonly number[],
  dist: number,
  tol: Tolerance,
  mergeAcross: boolean,
): Chain[] {
  const n = polylineSegmentCount(raw);
  const segs: Segment[] = [];
  for (let k = 0; k < n; k++) segs.push(polylineSegment(raw, k));
  const eps = Math.max(1e3 * tol.linear, 1e-9 * dist);
  // Where each segment is cut: at its ends, where another crosses it, where another ends on it.
  const cuts: number[][] = segs.map(() => [0, 1]);
  const curves = segs.map(segCurve);
  const boxes = curves.map((c) => boxOf(flatten(c as Line | Arc, Infinity).points));
  const ends = segs.map((s) => [segPoint(s, 0), segPoint(s, 1)] as const);
  // Pairs whose boxes overlap, by a sweep along x.
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i]!.minX - boxes[j]!.minX);
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi]!;
    const bi = boxes[i]!;
    for (let oj = oi + 1; oj < n; oj++) {
      const j = order[oj]!;
      const bj = boxes[j]!;
      if (bj.minX > bi.maxX + eps) break;
      if (bi.maxY < bj.minY - eps || bj.maxY < bi.minY - eps) continue;
      for (const [x, y] of [
        [i, j],
        [j, i],
      ] as const) {
        for (const p of ends[y]!) {
          const f = onSegment(segs[x]!, p, eps);
          if (f !== undefined) cuts[x]!.push(f);
        }
      }
      for (const x of intersect(curves[i]!, curves[j]!, tol)) {
        cuts[i]!.push(fractionOn(segs[i]!, x.point));
        cuts[j]!.push(fractionOn(segs[j]!, x.point));
      }
    }
  }
  const pieces: SubSegment[] = [];
  let cut = false;
  for (let k = 0; k < n; k++) {
    const s = segs[k]!;
    const len = 'line' in s ? distance(s.line.a, s.line.b) : s.arc.radius * Math.abs(s.arc.sweep);
    // Cuts closer than the tolerance along the segment are one cut.
    const fs: number[] = [];
    for (const f of [...cuts[k]!].sort((a, b) => a - b)) {
      if (fs.length === 0 || (f - fs.at(-1)!) * len > eps) fs.push(f);
      else if (f === 1) fs[fs.length - 1] = 1;
    }
    if (fs.length > 2) cut = true;
    const sweep = 'arc' in s ? s.arc.sweep : 0;
    for (let m = 0; m + 1 < fs.length; m++) {
      const f0 = fs[m]!;
      const f1 = fs[m + 1]!;
      pieces.push({
        k,
        src: from[k]!,
        f0,
        f1,
        a: segPoint(s, f0),
        b: segPoint(s, f1),
        bulge: Math.tan((sweep * (f1 - f0)) / 4),
      });
    }
  }
  // Which pieces stay: an offset piece at the offset distance; a bridge between two that stay.
  const sourceSegs = explodePolyline(source);
  const sourceBoxes = sourceSegs.map((c) => boxOf(flatten(c, Infinity).points));
  const limit = dist - Math.max(eps, 1e-7 * dist);
  const tooClose = (s: SubSegment): boolean => {
    const m = segPoint(segs[s.k]!, (s.f0 + s.f1) / 2);
    // Only a source segment whose box comes within the limit can come closer than it.
    return sourceSegs.some((c, i) => {
      const b = sourceBoxes[i]!;
      const dx = Math.max(b.minX - m.x, 0, m.x - b.maxX);
      const dy = Math.max(b.minY - m.y, 0, m.y - b.maxY);
      return Math.hypot(dx, dy) < limit && closestPoint(c, m, tol).distance < limit;
    });
  };
  if (!cut) {
    // An offset that nowhere crosses or touches itself stays whole or, gone past the source's
    // other side (a slot offset by more than half its width), not at all: its longest offset
    // piece tells which.
    let longest: SubSegment | undefined;
    for (const p of pieces) {
      if (p.src >= 0 && (!longest || distance(p.a, p.b) > distance(longest.a, longest.b))) {
        longest = p;
      }
    }
    return longest && !tooClose(longest) ? [whole(raw, from)] : [];
  }
  const offsetKept = pieces.map((s) => s.src >= 0 && !tooClose(s));
  const kept = pieces.map((s, i) => {
    if (s.src >= 0) return offsetKept[i]!;
    const prev = raw.closed ? (i - 1 + pieces.length) % pieces.length : i - 1;
    const next = raw.closed ? (i + 1) % pieces.length : i + 1;
    return prev >= 0 && next < pieces.length && offsetKept[prev]! && offsetKept[next]!;
  });
  // Overlaps: run twice the same way, once; both ways, not at all.
  const same = (p: Vec2, q: Vec2) => distance(p, q) <= eps;
  for (let i = 0; i < pieces.length; i++) {
    if (!kept[i]) continue;
    for (let j = i + 1; j < pieces.length; j++) {
      if (!kept[j]) continue;
      const a = pieces[i]!;
      const b = pieces[j]!;
      if (same(a.a, b.a) && same(a.b, b.b) && Math.abs(a.bulge - b.bulge) <= 1e-9) {
        kept[j] = false;
      } else if (same(a.a, b.b) && same(a.b, b.a) && Math.abs(a.bulge + b.bulge) <= 1e-9) {
        kept[i] = false;
        kept[j] = false;
        break;
      }
    }
  }
  const left = pieces.filter((_, i) => kept[i]);
  if (left.length === 0) return [];
  // Chains, end to start: from a piece nothing ends at (an open end) first, then any. Pieces
  // are found by where they start through a list sorted along x.
  const byX = [...left].sort((p, q) => p.a.x - q.a.x);
  const near = (p: Vec2): SubSegment[] => {
    let lo = 0;
    let hi = byX.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byX[mid]!.a.x < p.x - eps) lo = mid + 1;
      else hi = mid;
    }
    const out: SubSegment[] = [];
    for (let k = lo; k < byX.length && byX[k]!.a.x <= p.x + eps; k++) {
      if (same(byX[k]!.a, p)) out.push(byX[k]!);
    }
    return out;
  };
  const hasPredecessor = new Set<SubSegment>();
  for (const t of left) for (const s of near(t.b)) if (s !== t) hasPredecessor.add(s);
  const used = new Set<SubSegment>();
  const chains: Chain[] = [];
  const firsts = [...left.filter((s) => !hasPredecessor.has(s)), ...left];
  for (const first of firsts) {
    if (used.has(first)) continue;
    const chain: SubSegment[] = [first];
    used.add(first);
    for (;;) {
      const last = chain.at(-1)!;
      if (chain.length > 1 && same(last.b, first.a)) break;
      const next = near(last.b).filter((s) => !used.has(s));
      if (next.length === 0) break;
      // Along the raw offset where it goes on; else the next piece in its order.
      const follow =
        next.find((s) => s.k === last.k && s.f0 === last.f1) ??
        next.find((s) => s.k === (last.k + 1) % n && s.f0 === 0) ??
        next[0]!;
      chain.push(follow);
      used.add(follow);
    }
    chains.push(chainOf(chain, chain.length > 1 && same(chain.at(-1)!.b, first.a), mergeAcross));
  }
  return chains.filter((c) => c.segments.some((s) => distance(s.a, s.b) > eps));
}

/** The raw offset whole, when it does not cross itself. */
function whole(raw: Polyline, from: readonly number[]): Chain {
  const n = polylineSegmentCount(raw);
  const segments: SubSegment[] = [];
  for (let k = 0; k < n; k++) {
    const s = polylineSegment(raw, k);
    segments.push({
      k,
      src: from[k]!,
      f0: 0,
      f1: 1,
      a: segPoint(s, 0),
      b: segPoint(s, 1),
      bulge: raw.vertices[k]!.bulge,
    });
  }
  return { vertices: raw.vertices, segments, closed: raw.closed };
}

/** Two pieces in a row that are one: the same segment's, or straight on in one line. */
function continues(a: SubSegment, b: SubSegment, across: boolean): boolean {
  if (a.k === b.k && a.f1 === b.f0) return true;
  if (a.bulge !== 0 || b.bulge !== 0 || (a.src !== b.src && !across)) return false;
  const u = sub(a.b, a.a);
  const v = sub(b.b, b.a);
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  return dot(u, v) > 0 && Math.abs(u.x * v.y - u.y * v.x) <= 1e-12 * lu * lv;
}

/** A chain's polyline vertices: each piece's start, and the last piece's end when open. */
function chainOf(pieces: readonly SubSegment[], closed: boolean, across: boolean): Chain {
  const merged: SubSegment[] = [];
  for (const s of pieces) {
    const last = merged.at(-1);
    if (last && continues(last, s, across)) {
      const sweep = 4 * Math.atan(last.bulge) + 4 * Math.atan(s.bulge);
      const f1 = last.k === s.k ? s.f1 : last.f1;
      merged[merged.length - 1] = { ...last, f1, b: s.b, bulge: Math.tan(sweep / 4) };
    } else merged.push(s);
  }
  // A closed chain's last piece may go straight on into its first.
  if (closed && merged.length > 2 && continues(merged.at(-1)!, merged[0]!, across)) {
    const last = merged.pop()!;
    merged[0] = { ...merged[0]!, a: last.a, f0: last.k === merged[0]!.k ? last.f0 : merged[0]!.f0 };
  }
  const vertices = merged.map((s) => ({ x: s.a.x, y: s.a.y, bulge: s.bulge }));
  if (!closed) {
    const e = merged.at(-1)!.b;
    vertices.push({ x: e.x, y: e.y, bulge: 0 });
  }
  return { vertices, segments: merged, closed };
}

// ── Ellipses and splines ───────────────────────────────────────────────────────────────────

/** The point `d` to the left of `c` at parameter `t`. */
function offsetPoint(c: Ellipse | Spline, t: number, d: number, chord: Vec2): Vec2 {
  let dir = derivativeAt(c, t);
  // Where the derivative vanishes (coincident control points), the chord through the
  // neighbouring samples gives the direction, as the kernel's sampled offset does.
  if (dir.x === 0 && dir.y === 0) dir = chord;
  const n = normalize(dir);
  return add(pointAt(c, t), { x: -n.y * d, y: n.x * d });
}

/**
 * The SPLINE AutoCAD returns for an ellipse's or spline's offset: a cubic through samples of
 * the true offset (each the curve's point moved `d` along its normal, at parameters the
 * curve's flattening picks), its end tangents the curve's. Between each two samples the cubic
 * is checked against the true offset there; the samples are made denser, up to four times,
 * until it is within 1e-6 of the curve's size everywhere. Where the offset itself has a cusp
 * (inward past the curve's tightest radius) it never is, and the densest fit stands.
 */
function offsetFitted(
  c: Ellipse | Spline,
  d: number,
  tol: Tolerance,
  normal: Vec3 | undefined,
): SplineGeometry | undefined {
  const box = boxOf(flatten(c, Infinity).points);
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, tol.linear);
  const accuracy = Math.max(1e-6 * size, 1e3 * tol.linear);
  const dm = domain(c);
  const startTangent = normalize(derivativeAt(c, dm.start));
  const endTangent = normalize(derivativeAt(c, dm.end));
  const closed = distance(pointAt(c, dm.start), pointAt(c, dm.end)) <= tol.linear;
  let best: Spline | undefined;
  for (let dev = 1e-3 * size, round = 0; round < 4; dev /= 4, round++) {
    const f = flatten(c, dev);
    const ts: number[] = [];
    for (const t of f.params) if (ts.length === 0 || t > ts.at(-1)!) ts.push(t);
    const chord = (i: number): Vec2 =>
      sub(pointAt(c, ts[Math.min(i + 1, ts.length - 1)]!), pointAt(c, ts[Math.max(i - 1, 0)]!));
    const samples = ts.map((t, i) => offsetPoint(c, t, d, chord(i)));
    if (closed) samples.pop();
    const s = fitSpline({
      fitPoints: samples,
      ...(!closed && { startTangent, endTangent }),
      closed,
    });
    if (!s) return best && splineOf(best, closed, normal);
    best = s;
    if (fittedError(s, c, ts, d, samples.length) <= accuracy) break;
  }
  return best && splineOf(best, closed, normal);
}

function splineOf(s: Spline, closed: boolean, normal: Vec3 | undefined): SplineGeometry {
  return {
    kind: 'SPLINE',
    degree: s.degree,
    knots: s.knots,
    controlPoints: s.controlPoints,
    closed,
    periodic: false,
    ...(normal && { normal }),
  };
}

/**
 * How far the fitted spline strays from the true offset: at the middle of each span between
 * fit points, its distance from the nearest offset point of the source's span between the same
 * samples (a golden-section search on that span), less the offset distance. The fitted
 * spline's knots run through the fit points in order, so span i of each is the same stretch.
 */
function fittedError(
  s: Spline,
  source: Ellipse | Spline,
  ts: readonly number[],
  d: number,
  count: number,
): number {
  const { start, end } = splineDomain(s);
  const knots = [...new Set(s.knots.filter((k) => k >= start && k <= end))];
  let worst = 0;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i + 1 < knots.length && i + 1 < ts.length && i < count; i++) {
    const q = splinePoint(s, (knots[i]! + knots[i + 1]!) / 2);
    // The source point nearest q on its span: distance from q, less |d|, is the error.
    const f = (t: number) => distance(pointAt(source, t), q);
    let a = ts[i]!;
    let b = ts[i + 1]!;
    let x1 = b - g * (b - a);
    let x2 = a + g * (b - a);
    let f1 = f(x1);
    let f2 = f(x2);
    for (let k = 0; k < 40 && b - a > 1e-12 * Math.max(1, Math.abs(b)); k++) {
      if (f1 < f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - g * (b - a);
        f1 = f(x1);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + g * (b - a);
        f2 = f(x2);
      }
    }
    worst = Math.max(worst, Math.abs(Math.min(f1, f2) - Math.abs(d)));
  }
  return worst;
}

/**
 * Where `p` lies from `c`: its distance (OFFSET Through's offset distance) and side, +1 left of
 * the curve's direction (a positive kernel offset), −1 right, 0 on the curve.
 */
export function offsetSide(
  c: Curve,
  p: Vec2,
  tol: Tolerance,
): { distance: number; side: -1 | 0 | 1 } {
  const cp = closestPoint(c, p, tol);
  return { distance: cp.distance, side: cp.distance <= tol.linear ? 0 : sideOf(c, cp.t, p, tol) };
}
