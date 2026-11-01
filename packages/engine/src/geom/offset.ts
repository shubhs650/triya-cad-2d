// Offset curves (OFFSET command geometry).
//
// Sign convention: a positive distance offsets to the left of the direction of travel. For
// a CCW circle or arc that is towards the centre. The OFFSET command picks the sign from the
// side point the user gives (`sideOf`), so the kernel never guesses a side.
//
// Polylines follow OFFSETGAPTYPE = 0 (AutoCAD's default): each segment is offset on its own
// and neighbours are extended or trimmed to the intersection of their offset carriers; where
// the carriers do not meet, a straight segment closes the gap. Arc segments that collapse
// (offset radius ≤ 0) are dropped. Removing the self-intersecting loops an inward offset of a
// tight polyline can produce is left to the OFFSET command (M3), which owns that behaviour.
//
// Ellipses and splines have no exact offset of their own kind; AutoCAD returns a spline. The
// kernel returns a polyline through offset samples within the requested deviation; M3 OFFSET
// fits a spline through them when it lands.

import { boxOf } from './bounds';
import type { Arc, BoundedCurve, BulgeVertex, Curve, Polyline } from './curves';
import {
  derivativeAt,
  domain,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
  type BulgeArc,
} from './eval';
import { flatten } from './flatten';
import { intersect } from './intersect';
import type { Tolerance } from './tolerance';
import {
  add,
  angleOf,
  cross,
  distance,
  fromAngle,
  length,
  normalize,
  perp,
  scale,
  sub,
} from './vec';
import type { Vec2 } from './types';

const left = (dir: Vec2, d: number): Vec2 => scale(perp(normalize(dir)), d);

/** Which side of the curve `p` is on: +1 left (positive offset), −1 right, 0 on it. */
export function sideOf(c: Curve, t: number, p: Vec2, tol: Tolerance): -1 | 0 | 1 {
  const z = cross(derivativeAt(c, t), sub(p, pointAt(c, t)));
  if (Math.abs(z) <= tol.linear * length(derivativeAt(c, t))) return 0;
  return z > 0 ? 1 : -1;
}

type Seg =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; a0: number; sweep: number };

const segStart = (s: Seg): Vec2 => (s.kind === 'line' ? s.a : add(s.c, fromAngle(s.a0, s.r)));
const segEnd = (s: Seg): Vec2 =>
  s.kind === 'line' ? s.b : add(s.c, fromAngle(s.a0 + s.sweep, s.r));

function offsetSeg(
  seg: { line: { a: Vec2; b: Vec2 } } | { arc: BulgeArc },
  d: number,
  tol: Tolerance,
): Seg | undefined {
  if ('line' in seg) {
    const n = left(sub(seg.line.b, seg.line.a), d);
    return { kind: 'line', a: add(seg.line.a, n), b: add(seg.line.b, n) };
  }
  const { center, radius, startAngle, sweep } = seg.arc;
  // Left of a CCW arc is the centre side; of a CW arc, the outside.
  const r = sweep > 0 ? radius - d : radius + d;
  if (r <= tol.linear) return undefined;
  return { kind: 'arc', c: center, r, a0: startAngle, sweep };
}

const carrier = (s: Seg): Curve =>
  s.kind === 'line'
    ? { kind: 'XLINE', base: s.a, direction: sub(s.b, s.a) }
    : { kind: 'CIRCLE', center: s.c, radius: s.r };

/** The corner between two consecutive offset segments, or both ends if a gap must be bridged. */
function join(a: Seg, b: Seg, tol: Tolerance): Vec2[] {
  const ea = segEnd(a);
  const sb = segStart(b);
  if (distance(ea, sb) <= tol.linear) return [ea];
  const mid = scale(add(ea, sb), 0.5);
  let best: Vec2 | undefined;
  for (const x of intersect(carrier(a), carrier(b), tol)) {
    if (!best || distance(x.point, mid) < distance(best, mid)) best = x.point;
  }
  return best ? [best] : [ea, sb];
}

/** Signed difference a − b wrapped to (−π, π]. */
function wrapPi(x: number): number {
  const r = x % (2 * Math.PI);
  if (r > Math.PI) return r - 2 * Math.PI;
  if (r <= -Math.PI) return r + 2 * Math.PI;
  return r;
}

/** Bulge of a segment once its ends moved to `s` and `e`. */
function bulgeFor(seg: Seg, s: Vec2, e: Vec2): number {
  if (seg.kind === 'line') return 0;
  const a1 = seg.a0 + seg.sweep;
  const start = seg.a0 + wrapPi(angleOf(sub(s, seg.c)) - seg.a0);
  const end = a1 + wrapPi(angleOf(sub(e, seg.c)) - a1);
  return Math.tan((end - start) / 4);
}

function offsetPolyline(p: Polyline, d: number, tol: Tolerance): Polyline | undefined {
  const segs: Seg[] = [];
  for (let i = 0; i < polylineSegmentCount(p); i++) {
    const s = offsetSeg(polylineSegment(p, i), d, tol);
    if (s) segs.push(s);
  }
  if (segs.length === 0) return undefined;
  const n = segs.length;
  // starts[k] / ends[k]: where segment k begins and ends after joining; gaps hold bridge ends.
  const starts: Vec2[] = segs.map(segStart);
  const ends: Vec2[] = segs.map(segEnd);
  const gap: boolean[] = new Array<boolean>(n).fill(false);
  const joints = p.closed ? n : n - 1;
  for (let k = 0; k < joints; k++) {
    const next = (k + 1) % n;
    const j = join(segs[k]!, segs[next]!, tol);
    if (j.length === 1) {
      ends[k] = j[0]!;
      starts[next] = j[0]!;
    } else {
      gap[k] = true;
    }
  }
  const vertices: BulgeVertex[] = [];
  for (let k = 0; k < n; k++) {
    const s = starts[k]!;
    vertices.push({ x: s.x, y: s.y, bulge: bulgeFor(segs[k]!, s, ends[k]!) });
    if (gap[k]) vertices.push({ x: ends[k]!.x, y: ends[k]!.y, bulge: 0 });
  }
  if (!p.closed) {
    const e = ends[n - 1]!;
    vertices.push({ x: e.x, y: e.y, bulge: 0 });
  }
  return { kind: 'LWPOLYLINE', closed: p.closed, vertices };
}

/** Sampled offset of an ellipse or spline, as a polyline. */
function offsetSampled(c: BoundedCurve, d: number, dev: number): Polyline {
  const f = flatten(c, dev);
  const vertices: BulgeVertex[] = f.params.map((t, i) => {
    let dir = derivativeAt(c, t);
    // At a cusp in parameter (coincident control points) the derivative vanishes; the
    // chord through the neighbouring samples gives the direction instead.
    if (length(dir) === 0) {
      dir = sub(f.points[Math.min(i + 1, f.points.length - 1)]!, f.points[Math.max(i - 1, 0)]!);
    }
    const q = add(f.points[i]!, left(dir, d));
    return { x: q.x, y: q.y, bulge: 0 };
  });
  const dm = domain(c);
  const closed = distance(pointAt(c, dm.start), pointAt(c, dm.end)) <= dev;
  if (closed) vertices.pop();
  return { kind: 'LWPOLYLINE', closed, vertices };
}

/**
 * The curve offset by `distance` (positive = left of travel), or undefined when it collapses.
 * `maxDeviation` bounds the sampled ellipse/spline approximation (default 1e-4 of the size).
 */
export function offset(
  c: Curve,
  distance: number,
  tol: Tolerance,
  maxDeviation?: number,
): Curve | undefined {
  if (distance === 0) return c;
  switch (c.kind) {
    case 'LINE': {
      const n = left(sub(c.end, c.start), distance);
      return { kind: 'LINE', start: add(c.start, n), end: add(c.end, n) };
    }
    case 'RAY':
    case 'XLINE':
      return {
        kind: c.kind,
        base: add(c.base, left(c.direction, distance)),
        direction: c.direction,
      };
    case 'CIRCLE': {
      const r = c.radius - distance;
      return r > tol.linear ? { kind: 'CIRCLE', center: c.center, radius: r } : undefined;
    }
    case 'ARC': {
      const r = c.radius - distance;
      if (r <= tol.linear) return undefined;
      const a: Arc = {
        kind: 'ARC',
        center: c.center,
        radius: r,
        startAngle: c.startAngle,
        endAngle: c.endAngle,
      };
      return a;
    }
    case 'LWPOLYLINE':
      return offsetPolyline(c, distance, tol);
    case 'ELLIPSE':
    case 'SPLINE': {
      const box = boxOf(flatten(c, Infinity).points);
      const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, tol.linear);
      return offsetSampled(c, distance, maxDeviation ?? Math.max(tol.linear, 1e-4 * size));
    }
  }
}
