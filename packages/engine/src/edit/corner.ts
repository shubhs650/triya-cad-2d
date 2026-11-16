// FILLET's and CHAMFER's geometry (M3-02 part 3), as AutoCAD 2024 fillets and chamfers (AutoCAD
// 2024 Help, "FILLET (Command)", "CHAMFER (Command)", "About Filleting", "About Chamfering"):
//
// - FILLET joins two objects with an arc of the fillet radius tangent to both: lines, rays,
//   xlines, arcs, circles, ellipses, elliptical arcs, splines and the line and arc segments of
//   2D polylines (M3-12 part 5 added ellipses, splines and arc segments). Where the objects could take
//   more than one fillet, the one on the picked parts is made: its centre is on the side of
//   each object where the other object was picked, and of those the fillet nearest the picks.
//   With radius 0 (or Shift held for the second pick) the objects are trimmed or extended to
//   meet. A full ellipse and a closed spline are left whole, as a circle is; an elliptical arc
//   is cut or carried on round its ellipse as an arc is; an open spline is cut at the tangent
//   point, which must be on it (a spline is not extended for a fillet). Parallel lines (the first a line or ray, the second a line, ray or xline) take a
//   half circle as wide as the gap, at the end of the first line nearer its pick, whatever the
//   radius; the second line is trimmed or extended to it.
// - CHAMFER joins two lines (lines, rays, xlines, polyline line segments) with a line at the
//   two distances from where they meet (Distance method) or at a length on the first and an
//   angle from it (Angle method).
// - In Trim mode each object is trimmed or extended to the fillet arc (chamfer line): the part
//   on the picked side of the corner is kept. A circle is not trimmed. A line, arc or polyline
//   end segment filleted or chamfered with a 2D polyline joins it, with the arc (line), to make
//   one polyline. Two segments of one polyline next to each other (or one segment apart, which
//   segment goes) get the arc (line) inside the polyline; an arc segment is cut or carried on
//   round its circle. The first and last segments of an open polyline (neither next to nor one
//   apart from the other) close it with the arc (line), as "About Fillets and Rounds" says.
// - The Polyline option fillets (chamfers) every vertex of a 2D polyline between two line
//   segments long enough for it; FILLET first takes out an arc segment between two line
//   segments that converge, so a polyline is filleted again at a new radius (or made sharp
//   with radius 0).
//
// Everything is to the drawing's tolerance (DEC-036).
import { alongLine } from './line-heights';
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import { curveBounds } from '../geom/bounds';
import { closestPoint } from '../geom/closest';
import type { BoundedCurve, Curve, Ellipse } from '../geom/curves';
import {
  derivativeAt,
  domain,
  ellipseAxes,
  ellipseSweep,
  pointAt,
  polylineSegment,
  polylineSegmentCount,
} from '../geom/eval';
import { bulgeArc } from '../geom/eval';
import { flatten } from '../geom/flatten';
import { intersect } from '../geom/intersect';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import {
  add,
  angleOf,
  cross,
  distance,
  dot,
  fromAngle,
  length,
  midpoint,
  neg,
  normalize,
  perp,
  scale,
  sub,
} from '../geom/vec';
import type {
  ArcGeometry,
  EntityGeometry,
  LineGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
} from '../model/types';
import { cleanPolyline, offsetCurveOf, segmentWidths } from './offset';
import { isClosedCurve, subGeometry } from './trim';

type Poly = LwPolylineGeometry | PolylineGeometry;

/**
 * The straight line or circle an object (or polyline segment) lies on, or the curve itself for
 * an ellipse (its whole ellipse) or a spline.
 */
export type Carrier =
  | { readonly kind: 'line'; readonly p: Vec2; /** Unit. */ readonly d: Vec2 }
  | { readonly kind: 'circle'; readonly c: Vec2; readonly r: number }
  | { readonly kind: 'curve'; readonly curve: Curve };

/** One object picked for a fillet or chamfer. */
export interface Leg {
  readonly g: EntityGeometry;
  readonly carrier: Carrier;
  /** The point of the object nearest the pick. */
  readonly pick: Vec2;
  /** A polyline's segment picked, in the polyline without its repeated vertices. */
  readonly segment?: number;
}

/** Whether `g` is a 2D polyline FILLET and CHAMFER work on. */
export const isPolyline2d = (g: EntityGeometry): g is Poly =>
  g.kind === 'LWPOLYLINE' || (g.kind === 'POLYLINE' && !g.is3d);

type LineCarrier = Extract<Carrier, { kind: 'line' }>;

const lineCarrier = (a: Vec2, b: Vec2): LineCarrier | undefined =>
  length(sub(b, a)) > 0 ? { kind: 'line', p: a, d: normalize(sub(b, a)) } : undefined;

/** The object picked at `at`, as a leg, or undefined for an object that cannot be filleted. */
export function legOf(g: EntityGeometry, at: Vec2, tol: Tolerance): Leg | undefined {
  let carrier: Carrier | undefined;
  let segment: number | undefined;
  switch (g.kind) {
    case 'LINE':
      carrier = lineCarrier(g.start, g.end);
      break;
    case 'RAY':
    case 'XLINE':
      carrier =
        length(g.direction) > 0
          ? { kind: 'line', p: g.base, d: normalize(g.direction) }
          : undefined;
      break;
    case 'ARC':
    case 'CIRCLE':
      carrier = g.radius > 0 ? { kind: 'circle', c: g.center, r: g.radius } : undefined;
      break;
    case 'ELLIPSE': {
      const whole: Ellipse = {
        kind: 'ELLIPSE',
        center: g.center,
        majorAxis: g.majorAxis,
        ratio: g.ratio,
        startParam: 0,
        endParam: TAU,
      };
      carrier =
        g.ratio > 0 && length(g.majorAxis) > 0 ? { kind: 'curve', curve: whole } : undefined;
      break;
    }
    case 'SPLINE': {
      const c = offsetCurveOf(g);
      carrier = c ? { kind: 'curve', curve: c } : undefined;
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (!isPolyline2d(g)) return undefined;
      const p = cleanPolyline(g).curve;
      const n = polylineSegmentCount(p);
      if (n === 0) return undefined;
      const t = closestPoint(p, at, tol).t;
      segment = Math.min(Math.max(Math.floor(t), 0), n - 1);
      const seg = polylineSegment(p, segment);
      carrier =
        'line' in seg
          ? lineCarrier(seg.line.a, seg.line.b)
          : { kind: 'circle', c: seg.arc.center, r: seg.arc.radius };
      break;
    }
    default:
      return undefined;
  }
  if (!carrier) return undefined;
  return {
    g,
    carrier,
    pick: footOn(carrier, at, tol) ?? at,
    ...(segment !== undefined && { segment }),
  };
}

// ── Carriers ───────────────────────────────────────────────────────────────────────────────

/** The point of `c` nearest `q` (undefined at a circle's centre). */
function footOn(c: Carrier, q: Vec2, tol: Tolerance): Vec2 | undefined {
  if (c.kind === 'line') return add(c.p, scale(c.d, dot(sub(q, c.p), c.d)));
  if (c.kind === 'curve') return closestPoint(c.curve, q, tol).point;
  const v = sub(q, c.c);
  return length(v) === 0 ? undefined : add(c.c, scale(normalize(v), c.r));
}

/**
 * Which side of `c` `q` is: left/right of a line or of a curve where it passes nearest `q`
 * (going its own way), outside/inside a circle; 0 on it.
 */
function sideOf(c: Carrier, q: Vec2, tol: Tolerance): -1 | 0 | 1 {
  let s: number;
  if (c.kind === 'line') s = cross(c.d, sub(q, c.p));
  else if (c.kind === 'circle') s = distance(q, c.c) - c.r;
  else {
    const f = closestPoint(c.curve, q, tol);
    const d = derivativeAt(c.curve, f.t);
    s = length(d) > 0 ? cross(normalize(d), sub(q, f.point)) : 0;
  }
  return Math.abs(s) <= tol.linear ? 0 : s > 0 ? 1 : -1;
}

/** The carriers at distance `r` from a line's or circle's: its two parallels, the circles round it. */
function offsetsOf(c: Exclude<Carrier, { kind: 'curve' }>, r: number, tol: Tolerance): Carrier[] {
  if (c.kind === 'line') {
    const n = perp(c.d);
    return [
      { kind: 'line', p: add(c.p, scale(n, r)), d: c.d },
      { kind: 'line', p: sub(c.p, scale(n, r)), d: c.d },
    ];
  }
  const out: Carrier[] = [{ kind: 'circle', c: c.c, r: c.r + r }];
  if (Math.abs(c.r - r) > tol.linear) out.push({ kind: 'circle', c: c.c, r: Math.abs(c.r - r) });
  return out;
}

/** A carrier as a kernel curve: a line as an xline. */
function curveOf(c: Carrier): Curve {
  if (c.kind === 'line') return { kind: 'XLINE', base: c.p, direction: c.d };
  if (c.kind === 'circle') return { kind: 'CIRCLE', center: c.c, radius: c.r };
  return c.curve;
}

/** Where two carriers cross (a tangency once). */
export function meet(a: Carrier, b: Carrier, tol: Tolerance): Vec2[] {
  if (a.kind === 'curve' || b.kind === 'curve') {
    const out: Vec2[] = [];
    for (const x of intersect(curveOf(a), curveOf(b), tol)) {
      if (!out.some((q) => distance(q, x.point) <= tol.linear)) out.push(x.point);
    }
    return out;
  }
  if (a.kind === 'line' && b.kind === 'line') {
    const den = cross(a.d, b.d);
    if (Math.abs(den) <= tol.angular) return [];
    const t = cross(sub(b.p, a.p), b.d) / den;
    return [add(a.p, scale(a.d, t))];
  }
  if (a.kind === 'circle' && b.kind === 'line') return meet(b, a, tol);
  if (a.kind === 'line' && b.kind === 'circle') {
    const f = add(a.p, scale(a.d, dot(sub(b.c, a.p), a.d)));
    const h = distance(f, b.c);
    if (h > b.r + tol.linear) return [];
    const s = Math.sqrt(Math.max(0, b.r * b.r - h * h));
    if (s <= tol.linear) return [f];
    return [add(f, scale(a.d, -s)), add(f, scale(a.d, s))];
  }
  const ca = a as Extract<Carrier, { kind: 'circle' }>;
  const cb = b as Extract<Carrier, { kind: 'circle' }>;
  const d = distance(ca.c, cb.c);
  if (d <= tol.linear) return [];
  if (d > ca.r + cb.r + tol.linear || d < Math.abs(ca.r - cb.r) - tol.linear) return [];
  const x = (d * d + ca.r * ca.r - cb.r * cb.r) / (2 * d);
  const u = normalize(sub(cb.c, ca.c));
  const m = add(ca.c, scale(u, x));
  const y = Math.sqrt(Math.max(0, ca.r * ca.r - x * x));
  if (y <= tol.linear) return [m];
  return [add(m, scale(perp(u), y)), sub(m, scale(perp(u), y))];
}

/**
 * The direction from `x` along `c` toward `toward` (the shorter way round a circle or a whole
 * ellipse).
 */
function along(c: Carrier, x: Vec2, toward: Vec2, far: Vec2 | undefined, tol: Tolerance): Vec2 {
  if (c.kind === 'line') {
    let s = dot(sub(toward, x), c.d);
    if (Math.abs(s) <= tol.linear && far) s = dot(sub(far, x), c.d);
    return s >= 0 ? c.d : neg(c.d);
  }
  if (c.kind === 'curve') {
    const tx = closestPoint(c.curve, x, tol).t;
    let turn = closestPoint(c.curve, toward, tol).t - tx;
    if (c.curve.kind === 'ELLIPSE') turn = normalizeAngle(turn + Math.PI) - Math.PI;
    const d = normalize(derivativeAt(c.curve, tx));
    return turn >= 0 ? d : neg(d);
  }
  const t = perp(normalize(sub(x, c.c)));
  const turn = ccwSweep(angleOf(sub(x, c.c)), angleOf(sub(toward, c.c)));
  return turn <= Math.PI ? t : neg(t);
}

// ── Corners ────────────────────────────────────────────────────────────────────────────────

/** The arc or line that makes a corner, from the first object to the second. */
export interface CornerPiece {
  /** The fillet arc (as drawn from t1 to t2: CCW when `bulge` > 0) or the chamfer line. */
  readonly geom: ArcGeometry | LineGeometry;
  /** Its bulge from t1 to t2, as a polyline segment. */
  readonly bulge: number;
}

/**
 * A corner between two legs: where each is cut (t1, t2), which way from there each keeps
 * (k1, k2: unit), and the piece between, none for a sharp corner.
 */
export interface Corner {
  readonly t1: Vec2;
  readonly t2: Vec2;
  readonly k1: Vec2;
  readonly k2: Vec2;
  readonly piece?: CornerPiece;
}

export type CornerProblem = 'parallel' | 'too-large' | 'no-fillet' | 'not-lines';

/** A far point of a leg's object, to tell the way along it when the pick is on the corner. */
function farPoint(l: Leg, x: Vec2): Vec2 | undefined {
  const g = l.g;
  if (g.kind !== 'LINE') return undefined;
  return distance(g.start, x) > distance(g.end, x) ? g.start : g.end;
}

/** The two legs made to meet, trimmed or extended (radius or distances 0). */
export function sharpCorner(a: Leg, b: Leg, tol: Tolerance): Corner | CornerProblem {
  const xs = meet(a.carrier, b.carrier, tol);
  if (xs.length === 0)
    return a.carrier.kind === 'line' && b.carrier.kind === 'line' ? 'parallel' : 'no-fillet';
  const x = nearest(xs, (p) => distance(p, a.pick) + distance(p, b.pick));
  return {
    t1: x,
    t2: x,
    k1: along(a.carrier, x, a.pick, farPoint(a, x), tol),
    k2: along(b.carrier, x, b.pick, farPoint(b, x), tol),
  };
}

const nearest = <T>(xs: readonly T[], cost: (x: T) => number): T =>
  xs.reduce((best, x) => (cost(x) < cost(best) ? x : best));

/** The fillet of radius `r` > 0 between two legs (not two parallel lines: `parallelFillet`). */
export function filletCorner(a: Leg, b: Leg, r: number, tol: Tolerance): Corner | CornerProblem {
  if (!(r > tol.linear)) return sharpCorner(a, b, tol);
  if (a.carrier.kind === 'line' && b.carrier.kind === 'line') {
    if (Math.abs(cross(a.carrier.d, b.carrier.d)) <= tol.angular) return 'parallel';
  }
  interface Candidate {
    c: Vec2;
    t1: Vec2;
    t2: Vec2;
  }
  const all: Candidate[] = [];
  const ca = a.carrier;
  const cb = b.carrier;
  const add3 = (c: Vec2, la: Carrier, lb: Carrier, o: Vec2) => {
    const t1 = footOn(la, c, tol);
    const t2 = footOn(lb, c, tol);
    if (!t1 || !t2 || distance(t1, t2) <= tol.linear) return;
    all.push({ c: add(c, o), t1: add(t1, o), t2: add(t2, o) });
  };
  if (ca.kind !== 'curve' && cb.kind !== 'curve') {
    for (const oa of offsetsOf(ca, r, tol)) {
      for (const ob of offsetsOf(cb, r, tol)) {
        for (const c of meet(oa, ob, tol)) add3(c, ca, cb, { x: 0, y: 0 });
      }
    }
  } else {
    // Worked out near the origin: the nearest point of a curve to a point off it is found by
    // a search on a distance that is flat at its minimum, so far from the origin (a drawing at
    // 1,000,000) rounding would leave the centre short of its tolerance.
    const o = a.pick;
    const la = shifted(ca, o);
    const lb = shifted(cb, o);
    for (const c of curveCentres(la, lb, r, tol)) add3(c, la, lb, o);
  }
  if (all.length === 0) return 'no-fillet';
  // The centre is on the side of each object where the other was picked.
  const sa = sideOf(a.carrier, b.pick, tol);
  const sb = sideOf(b.carrier, a.pick, tol);
  const fits = all.filter(
    (k) =>
      (sa === 0 || sideOf(a.carrier, k.c, tol) === sa) &&
      (sb === 0 || sideOf(b.carrier, k.c, tol) === sb),
  );
  const pick = nearest(
    fits.length > 0 ? fits : all,
    (k) => distance(k.t1, a.pick) + distance(k.t2, b.pick),
  );
  return arcCorner(pick.c, r, pick.t1, pick.t2);
}

/**
 * The centres of the circles of radius `r` tangent to two carriers, one of them (or both) an
 * ellipse or a spline: the crossings of the curves' offsets, flattened, each polished by
 * Newton's method on the distances to the two carriers (a distance's gradient is the unit
 * normal from the nearest point), kept only where the circle touches each carrier square to it
 * (not past a spline's end).
 */
function curveCentres(a: Carrier, b: Carrier, r: number, tol: Tolerance): Vec2[] {
  const seeds: Vec2[] = [];
  const pa = offsetPaths(a, r, tol);
  const pb = offsetPaths(b, r, tol);
  for (const x of pa) for (const y of pb) seeds.push(...pathCrossings(x, y, tol));
  const out: Vec2[] = [];
  const same = Math.max(tol.linear, r * 1e-7);
  for (const seed of seeds) {
    const c = polishCentre(a, b, r, seed, tol);
    if (c && !out.some((q) => distance(q, c) <= same)) out.push(c);
  }
  return out;
}

/** A carrier moved by −`o`. */
function shifted(c: Carrier, o: Vec2): Carrier {
  if (c.kind === 'line') return { ...c, p: sub(c.p, o) };
  if (c.kind === 'circle') return { ...c, c: sub(c.c, o) };
  const k = c.curve;
  if (k.kind === 'ELLIPSE') return { kind: 'curve', curve: { ...k, center: sub(k.center, o) } };
  if (k.kind === 'SPLINE') {
    return { kind: 'curve', curve: { ...k, controlPoints: k.controlPoints.map((p) => sub(p, o)) } };
  }
  return c;
}

/** An offset of a carrier: exact for a line or circle, a flattened path for a curve. */
type OffsetPath = { readonly carrier: Carrier } | { readonly points: readonly Vec2[] };

function offsetPaths(c: Carrier, r: number, tol: Tolerance): OffsetPath[] {
  if (c.kind !== 'curve') return offsetsOf(c, r, tol).map((carrier) => ({ carrier }));
  // Fine enough that Newton's method starts near each centre, coarse enough on a long curve.
  const box = curveBounds(c.curve, tol);
  const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const f = flatten(c.curve as BoundedCurve, Math.max(r * 0.02, size * 1e-4));
  const normals = f.params.map((t) => {
    const d = derivativeAt(c.curve, t);
    return length(d) > 0 ? perp(normalize(d)) : undefined;
  });
  return [1, -1].map((side) => ({
    points: f.points.flatMap((p, i) => {
      const n = normals[i];
      return n ? [add(p, scale(n, side * r))] : [];
    }),
  }));
}

/** Where two offset paths cross. */
function pathCrossings(x: OffsetPath, y: OffsetPath, tol: Tolerance): Vec2[] {
  if ('carrier' in x && 'carrier' in y) return meet(x.carrier, y.carrier, tol);
  if ('carrier' in x) return pathCrossings(y, x, tol);
  const out: Vec2[] = [];
  const pts = x.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const seg = lineCarrier(p, q);
    if (!seg) continue;
    const len = distance(p, q);
    const within = (z: Vec2) => {
      const s = dot(sub(z, p), seg.d);
      return s >= -tol.linear && s <= len + tol.linear;
    };
    if ('carrier' in y) {
      for (const z of meet(seg, y.carrier, tol)) if (within(z)) out.push(z);
      continue;
    }
    const ys = y.points;
    for (let j = 0; j + 1 < ys.length; j++) {
      const other = lineCarrier(ys[j]!, ys[j + 1]!);
      if (!other) continue;
      const olen = distance(ys[j]!, ys[j + 1]!);
      for (const z of meet(seg, other, tol)) {
        const s = dot(sub(z, ys[j]!), other.d);
        if (within(z) && s >= -tol.linear && s <= olen + tol.linear) out.push(z);
      }
    }
  }
  return out;
}

/** A centre at distance `r` from both carriers near `seed`, or undefined when none is. */
function polishCentre(
  a: Carrier,
  b: Carrier,
  r: number,
  seed: Vec2,
  tol: Tolerance,
): Vec2 | undefined {
  let c = seed;
  // Once within the tolerance, two more steps (Newton's method doubles the digits each step).
  let polish = 0;
  for (let k = 0; k < 50; k++) {
    const fa = footOn(a, c, tol);
    const fb = footOn(b, c, tol);
    if (!fa || !fb) return undefined;
    const va = sub(c, fa);
    const vb = sub(c, fb);
    const da = length(va);
    const db = length(vb);
    if (da === 0 || db === 0) return undefined;
    const ea = da - r;
    const eb = db - r;
    if (Math.abs(ea) <= tol.linear && Math.abs(eb) <= tol.linear && polish++ === 2) {
      return squareTo(a, fa, va, tol) && squareTo(b, fb, vb, tol) ? c : undefined;
    }
    const na = scale(va, 1 / da);
    const nb = scale(vb, 1 / db);
    const det = cross(na, nb);
    if (Math.abs(det) <= tol.angular) return undefined;
    c = add(c, { x: (-ea * nb.y + eb * na.y) / det, y: (-eb * na.x + ea * nb.x) / det });
  }
  return undefined;
}

/** Whether `v` (from the nearest point `f` of the carrier) is square to it there: no end. */
function squareTo(c: Carrier, f: Vec2, v: Vec2, tol: Tolerance): boolean {
  if (c.kind !== 'curve') return true;
  const d = derivativeAt(c.curve, closestPoint(c.curve, f, tol).t);
  if (length(d) === 0) return false;
  return Math.abs(dot(normalize(d), normalize(v))) <= 1e-6;
}

/** The corner made by the arc round `c` from `t1` to `t2`, the shorter way. */
function arcCorner(c: Vec2, r: number, t1: Vec2, t2: Vec2): Corner {
  const a1 = angleOf(sub(t1, c));
  const a2 = angleOf(sub(t2, c));
  const ccw = ccwSweep(a1, a2) <= Math.PI;
  const sweep = ccw ? ccwSweep(a1, a2) : -ccwSweep(a2, a1);
  const tan1 = perp(normalize(sub(t1, c)));
  const tan2 = perp(normalize(sub(t2, c)));
  // Leaving t1 the arc runs CCW when `ccw`; each object keeps the other way.
  const k1 = ccw ? neg(tan1) : tan1;
  const k2 = ccw ? tan2 : neg(tan2);
  const geom: ArcGeometry = {
    kind: 'ARC',
    center: c,
    radius: r,
    startAngle: normalizeAngle(ccw ? a1 : a2),
    endAngle: normalizeAngle(ccw ? a2 : a1),
  };
  return { t1, t2, k1, k2, piece: { geom, bulge: Math.tan(sweep / 4) } };
}

/**
 * Parallel lines' fillet: a half circle as wide as the gap at the end of the first line (or the
 * base of a ray) nearer its pick, the second line cut where it meets it.
 */
export function parallelFillet(a: Leg, b: Leg, tol: Tolerance): Corner | 'not-lines' | 'too-large' {
  const g = a.g;
  if (g.kind !== 'LINE' && g.kind !== 'RAY') return 'not-lines';
  if (b.carrier.kind !== 'line' || !['LINE', 'RAY', 'XLINE'].includes(b.g.kind)) return 'not-lines';
  let e1: Vec2;
  let out: Vec2;
  if (g.kind === 'LINE') {
    const atEnd = distance(g.end, a.pick) < distance(g.start, a.pick);
    e1 = atEnd ? g.end : g.start;
    out = normalize(atEnd ? sub(g.end, g.start) : sub(g.start, g.end));
  } else {
    e1 = g.base;
    out = neg(normalize(g.direction));
  }
  const t2 = footOn(b.carrier, e1, tol)!;
  if (distance(e1, t2) <= tol.linear) return 'too-large';
  const c = midpoint(e1, t2);
  const r = distance(e1, t2) / 2;
  // The half circle bulges on past the end: CCW from e1 when that way is to its left.
  const ccw = cross(sub(e1, c), out) > 0;
  const a1 = angleOf(sub(e1, c));
  const geom: ArcGeometry = {
    kind: 'ARC',
    center: c,
    radius: r,
    startAngle: normalizeAngle(ccw ? a1 : a1 + Math.PI),
    endAngle: normalizeAngle(ccw ? a1 + Math.PI : a1),
  };
  const back = neg(out);
  return {
    t1: e1,
    t2,
    k1: back,
    k2: back,
    piece: { geom, bulge: ccw ? 1 : -1 },
  };
}

/** How CHAMFER measures its line: two distances, or a length and an angle (CHAMMODE). */
export type ChamferSize =
  | { readonly method: 'distance'; readonly d1: number; readonly d2: number }
  | { readonly method: 'angle'; readonly length: number; readonly angle: number };

/** The second distance of a chamfer whose corner between the lines is `theta`. */
function secondDistance(size: ChamferSize, theta: number): number | undefined {
  if (size.method === 'distance') return size.d2;
  const s = Math.sin(size.angle + theta);
  if (size.angle + theta >= Math.PI || s <= 0) return undefined;
  return (size.length * Math.sin(size.angle)) / s;
}

/** The chamfer between two straight legs. */
export function chamferCorner(
  a: Leg,
  b: Leg,
  size: ChamferSize,
  tol: Tolerance,
): Corner | CornerProblem {
  if (a.carrier.kind !== 'line' || b.carrier.kind !== 'line') return 'not-lines';
  const sharp = sharpCorner(a, b, tol);
  if (typeof sharp === 'string') return sharp;
  const x = sharp.t1;
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(sharp.k1, sharp.k2))));
  const d1 = size.method === 'distance' ? size.d1 : size.length;
  const d2 = secondDistance(size, theta);
  if (d2 === undefined) return 'too-large';
  if (d1 <= tol.linear && d2 <= tol.linear) return sharp;
  const t1 = add(x, scale(sharp.k1, d1));
  const t2 = add(x, scale(sharp.k2, d2));
  const geom: LineGeometry = { kind: 'LINE', start: t1, end: t2 };
  return { t1, t2, k1: sharp.k1, k2: sharp.k2, piece: { geom, bulge: 0 } };
}

// ── Cutting the objects ────────────────────────────────────────────────────────────────────

/**
 * A line, ray, xline or arc cut (trimmed or extended) at `t`, keeping the way `k`: its new
 * shape, the object itself for a circle (which is not cut), or undefined when nothing of it
 * would be left that way (the radius or distance is too large for it).
 */
export function cutLeg(
  g: EntityGeometry,
  t: Vec2,
  k: Vec2,
  tol: Tolerance,
): EntityGeometry | undefined {
  switch (g.kind) {
    case 'LINE': {
      const ds = dot(sub(g.start, t), k);
      const de = dot(sub(g.end, t), k);
      const keepEnd = de >= ds;
      if (Math.max(ds, de) <= tol.linear) return undefined;
      // A line already ending exactly there is left as it is.
      const end = keepEnd ? g.start : g.end;
      if (end.x === t.x && end.y === t.y) return g;
      return keepEnd ? alongLine(g, t, g.end) : alongLine(g, g.start, t);
    }
    case 'RAY': {
      if (dot(g.direction, k) > 0) return { ...g, base: t };
      if (dot(sub(g.base, t), k) <= tol.linear) return undefined;
      const line: LineGeometry = { kind: 'LINE', start: g.base, end: t };
      return line;
    }
    case 'XLINE': {
      const d = normalize(g.direction);
      const dir = dot(d, k) >= 0 ? d : neg(d);
      return { kind: 'RAY', base: t, direction: { x: dir.x + 0, y: dir.y + 0 } };
    }
    case 'CIRCLE':
      return g;
    case 'ELLIPSE':
      return cutEllipse(g, t, k, tol);
    case 'SPLINE': {
      const c = offsetCurveOf(g);
      if (!c || isClosedCurve(c, tol)) return g;
      const d = domain(c);
      const u = closestPoint(c, t, tol).t;
      const forward = dot(derivativeAt(c, u), k) > 0;
      // A spline already ending there is left as it is (with its fit data).
      if (distance(pointAt(c, forward ? d.start : d.end), t) <= tol.linear) return g;
      return forward ? subGeometry(g, c, u, d.end, tol) : subGeometry(g, c, d.start, u, tol);
    }
    case 'ARC': {
      const phi = normalizeAngle(angleOf(sub(t, g.center)));
      const sweep = ccwSweep(g.startAngle, g.endAngle);
      const within = ccwSweep(g.startAngle, phi) <= sweep;
      // Kept CCW from t: t is the new start, the end stays.
      const ccw = dot(perp(sub(t, g.center)), k) > 0;
      if (ccw) {
        // Beyond the end the arc would have to turn the long way round to the start.
        if (!within && ccwSweep(phi, g.startAngle) > ccwSweep(g.endAngle, phi)) return undefined;
        if (g.radius * ccwSweep(phi, g.endAngle) <= tol.linear) return undefined;
        return { ...g, startAngle: phi };
      }
      if (!within && ccwSweep(g.endAngle, phi) > ccwSweep(phi, g.startAngle)) return undefined;
      if (g.radius * ccwSweep(g.startAngle, phi) <= tol.linear) return undefined;
      return { ...g, endAngle: phi };
    }
    default:
      return undefined;
  }
}

/** The eccentric anomaly of the point of ellipse `e` nearest `p` along its own axes. */
function ellipseParam(e: Ellipse, p: Vec2): number {
  const { major, minor } = ellipseAxes(e);
  const v = sub(p, e.center);
  return normalizeAngle(
    Math.atan2(dot(v, minor) / dot(minor, minor), dot(v, major) / dot(major, major)),
  );
}

/**
 * An ellipse cut at `t` keeping the way `k`: a whole one is left (as a circle is), an
 * elliptical arc is trimmed or carried on round its ellipse as an arc is.
 */
function cutEllipse(
  g: Extract<EntityGeometry, { kind: 'ELLIPSE' }>,
  t: Vec2,
  k: Vec2,
  tol: Tolerance,
): EntityGeometry | undefined {
  if (ellipseSweep(g) === TAU) return g;
  const phi = ellipseParam(g, t);
  const sweep = ccwSweep(g.startParam, g.endParam);
  const within = ccwSweep(g.startParam, phi) <= sweep;
  const ccw = dot(derivativeAt(g, phi), k) > 0;
  // Nothing left: a sweep shorter than the tolerance even along the major axis.
  const gone = (a: number, b: number) => ccwSweep(a, b) * length(g.majorAxis) <= tol.linear;
  if (ccw) {
    if (!within && ccwSweep(phi, g.startParam) > ccwSweep(g.endParam, phi)) return undefined;
    if (gone(phi, g.endParam)) return undefined;
    return { ...g, startParam: phi };
  }
  if (!within && ccwSweep(g.endParam, phi) > ccwSweep(phi, g.startParam)) return undefined;
  if (gone(g.startParam, phi)) return undefined;
  return { ...g, endParam: phi };
}

// ── Polylines ──────────────────────────────────────────────────────────────────────────────

/** A vertex of a polyline being rebuilt, with its segment's widths. */
interface PVert {
  readonly x: number;
  readonly y: number;
  readonly bulge: number;
  readonly w?: readonly [number, number];
}

/** A 2D polyline's vertices without repeats, each with its segment's widths. */
function pvertsOf(g: Poly): { vs: PVert[]; closed: boolean } {
  const { curve, index } = cleanPolyline(g);
  const n = polylineSegmentCount(curve);
  const widths = segmentWidths(g, index, n);
  return {
    vs: curve.vertices.map((v, i) => ({
      x: v.x,
      y: v.y,
      bulge: v.bulge,
      ...(widths?.[i] && { w: widths[i] }),
    })),
    closed: curve.closed,
  };
}

/** `g` with vertices `vs`; its fit is dropped, a zero width written as none. */
function polylineWith(g: Poly, vs: readonly PVert[], closed: boolean): EntityGeometry {
  const vertices: PolylineVertex[] = vs.map((v) => ({
    x: v.x,
    y: v.y,
    bulge: v.bulge,
    ...(v.w && (v.w[0] !== 0 || v.w[1] !== 0) && { startWidth: v.w[0], endWidth: v.w[1] }),
  }));
  if (g.kind === 'LWPOLYLINE') return { ...g, vertices, closed };
  const { fit: _fit, frame: _frame, ...rest } = g;
  return { ...rest, vertices, closed };
}

/** An open polyline's vertices the other way round. */
function reversed(vs: readonly PVert[]): PVert[] {
  const m = vs.length - 1;
  return vs.map((_, j) => {
    const v = vs[m - j]!;
    const src = vs[m - j - 1];
    return {
      x: v.x,
      y: v.y,
      bulge: src ? -src.bulge : 0,
      ...(src?.w && { w: [src.w[1], src.w[0]] as const }),
    };
  });
}

const at = (p: Vec2, bulge = 0): PVert => ({ x: p.x, y: p.y, bulge });

/** A polyline segment cut by a corner: its ends, its bulge, and whether its start moved. */
interface SegmentCut {
  readonly bulge: number;
  readonly movedStart: boolean;
}

/**
 * The segment from `a` (with its bulge) to `b` cut at `t`, keeping the way `k`: a line segment
 * trimmed or extended along its line, an arc segment round its circle (as `cutLeg` cuts an
 * arc), its bulge the same way round; undefined when nothing of it is left that way.
 */
function cutSegment(a: PVert, b: Vec2, t: Vec2, k: Vec2, tol: Tolerance): SegmentCut | undefined {
  if (a.bulge === 0) {
    const da = dot(sub(a, t), k);
    const db = dot(sub(b, t), k);
    if (Math.max(da, db) <= tol.linear) return undefined;
    return { bulge: 0, movedStart: da < db };
  }
  const arc = bulgeArc(a, b, a.bulge);
  const ccw = a.bulge > 0;
  const sa = angleOf(sub(a, arc.center));
  const sb = angleOf(sub(b, arc.center));
  const g: ArcGeometry = {
    kind: 'ARC',
    center: arc.center,
    radius: arc.radius,
    startAngle: normalizeAngle(ccw ? sa : sb),
    endAngle: normalizeAngle(ccw ? sb : sa),
  };
  const cut = cutLeg(g, t, k, tol) as ArcGeometry | undefined;
  if (!cut) return undefined;
  // `cutLeg` moves the arc's start (its CCW-first end) when it keeps CCW from t.
  const movedArcStart = dot(perp(sub(t, arc.center)), k) > 0;
  const sweep = ccwSweep(cut.startAngle, cut.endAngle);
  return { bulge: (ccw ? 1 : -1) * Math.tan(sweep / 4), movedStart: ccw === movedArcStart };
}

/**
 * A polyline leg cut at `t` (kept the way `k`) at a free end of its picked segment: its
 * vertices with that end moved to `t` (an arc segment's bulge changed with it), and whether the
 * end is its last vertex (else its first). 'polyline-segment' when the cut is not at a free
 * end, undefined when nothing of the segment is left.
 */
function polylineCut(
  l: Leg,
  t: Vec2,
  k: Vec2,
  tol: Tolerance,
): { vs: PVert[]; atEnd: boolean } | 'polyline-segment' | undefined {
  const { vs, closed } = pvertsOf(l.g as Poly);
  const n = vs.length - 1;
  const i = l.segment!;
  if (closed) return 'polyline-segment';
  const cut = cutSegment(vs[i]!, vs[i + 1]!, t, k, tol);
  if (!cut) return undefined;
  const replaced = cut.movedStart ? i : i + 1;
  if (!((replaced === n && i === n - 1) || (replaced === 0 && i === 0))) return 'polyline-segment';
  vs[i] = { ...vs[i]!, bulge: cut.bulge };
  vs[replaced] = { ...vs[replaced]!, x: t.x, y: t.y };
  return { vs, atEnd: replaced === n };
}

/**
 * A leg's object from its far end to the cut `t` (kept the way `k`), as polyline vertices
 * ending at `t`; a string or undefined as `polylineCut` when it cannot be.
 */
function chainTo(
  l: Leg,
  t: Vec2,
  k: Vec2,
  tol: Tolerance,
): PVert[] | 'polyline-segment' | undefined {
  const g = l.g;
  if (g.kind === 'LINE') {
    const cut = cutLeg(g, t, k, tol) as LineGeometry | undefined;
    if (!cut) return undefined;
    const far = distance(cut.start, t) <= distance(cut.end, t) ? cut.end : cut.start;
    return [at(far), at(t)];
  }
  if (g.kind === 'ARC') {
    const cut = cutLeg(g, t, k, tol) as ArcGeometry | undefined;
    if (!cut) return undefined;
    const sweep = ccwSweep(cut.startAngle, cut.endAngle);
    const startAtT = dot(perp(sub(t, g.center)), k) > 0;
    const far = add(cut.center, fromAngle(startAtT ? cut.endAngle : cut.startAngle, cut.radius));
    // From the far end to t: CW when t is the arc's start.
    return [at(far, (startAtT ? -1 : 1) * Math.tan(sweep / 4)), at(t)];
  }
  const cut = polylineCut(l, t, k, tol);
  if (!cut || cut === 'polyline-segment') return cut;
  const vs = cut.atEnd ? cut.vs : reversed(cut.vs);
  // The last vertex starts no segment: it has no bulge or widths.
  vs[vs.length - 1] = at(t);
  return vs;
}

/** What a fillet or chamfer does: the objects' new shapes and the piece it adds. */
export interface CornerEdit {
  /** The first object's new shape; null erases it (joined to the second); undefined leaves it. */
  readonly first?: EntityGeometry | null;
  /** The second object's new shape; null erases it (joined to the first); undefined leaves it. */
  readonly second?: EntityGeometry | null;
  /** The fillet arc or chamfer line, as an object of its own. */
  readonly added?: EntityGeometry;
}

export type CornerFailure = 'too-large' | 'polyline-segment';

const JOINS = new Set(['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE']);

/**
 * The edit a corner makes of two different objects. With `trim` (TRIMMODE 1) the objects are
 * cut to it, and a polyline joins the other object (a line, arc or polyline) and the piece;
 * without, only the piece is added. A string when it cannot be made: 'too-large' (nothing left
 * of an object) or 'polyline-segment' (a polyline not cut at a free end of a line segment).
 */
export function cornerEdit(
  a: Leg,
  b: Leg,
  corner: Corner,
  trim: boolean,
  tol: Tolerance,
): CornerEdit | CornerFailure {
  const piece = corner.piece?.geom;
  if (!trim) return piece ? { added: piece } : {};
  const pa = isPolyline2d(a.g);
  const pb = isPolyline2d(b.g);
  if ((pa || pb) && JOINS.has(a.g.kind) && JOINS.has(b.g.kind)) {
    const head = chainTo(a, corner.t1, corner.k1, tol);
    const tail = chainTo(b, corner.t2, corner.k2, tol);
    if (head === 'polyline-segment' || tail === 'polyline-segment') return 'polyline-segment';
    if (!head || !tail) return 'too-large';
    const sharp = distance(corner.t1, corner.t2) <= tol.linear;
    const vs = [...head];
    vs[vs.length - 1] = at(corner.t1, sharp ? 0 : (corner.piece?.bulge ?? 0));
    const rest = reversed(tail);
    vs.push(...(sharp ? rest.slice(1) : rest));
    // The polyline (the first one picked) is the object that stays, with its handle.
    const joined = polylineWith((pa ? a.g : b.g) as Poly, vs, false);
    return pa ? { first: joined, second: null } : { first: null, second: joined };
  }
  const first = cutObject(a, corner.t1, corner.k1, tol);
  const second = cutObject(b, corner.t2, corner.k2, tol);
  if (first === 'polyline-segment' || second === 'polyline-segment') return 'polyline-segment';
  if (!first || !second || first === 'too-large' || second === 'too-large') return 'too-large';
  return {
    ...(first !== a.g && { first }),
    ...(second !== b.g && { second }),
    ...(piece && { added: piece }),
  };
}

/** One object cut at `t` keeping `k`: a polyline only at a free end of a line segment. */
function cutObject(
  l: Leg,
  t: Vec2,
  k: Vec2,
  tol: Tolerance,
): EntityGeometry | CornerFailure | undefined {
  if (!isPolyline2d(l.g)) return cutLeg(l.g, t, k, tol);
  const cut = polylineCut(l, t, k, tol);
  if (!cut || cut === 'polyline-segment') return cut;
  return polylineWith(l.g, cut.vs, false);
}

/**
 * A corner between two segments `a.segment` and `b.segment` of the same polyline, next to each
 * other or one segment apart (that segment goes), or an open polyline's first and last segments
 * (it closes): the polyline with the piece in it, or a string when it cannot be made. Arc
 * segments are cut round their circles.
 */
export function samePolylineCorner(
  a: Leg,
  b: Leg,
  corner: Corner,
  tol: Tolerance,
): EntityGeometry | CornerFailure {
  const g = a.g as Poly;
  const { vs, closed } = pvertsOf(g);
  const n = closed ? vs.length : vs.length - 1;
  let i = a.segment!;
  let j = b.segment!;
  let c = corner;
  const gap = (from: number, to: number) => (closed ? (to - from + n) % n : to - from);
  const flip = () => {
    [i, j] = [j, i];
    c = {
      t1: corner.t2,
      t2: corner.t1,
      k1: corner.k2,
      k2: corner.k1,
      ...(corner.piece && { piece: { ...corner.piece, bulge: -corner.piece.bulge } }),
    };
  };
  // In vertex order: the first segment, then the second.
  let ends = false;
  if (!(gap(i, j) === 1 || gap(i, j) === 2)) {
    if (gap(j, i) === 1 || gap(j, i) === 2) flip();
    else if (!closed && ((i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
      // The last segment, then the first: the piece closes the polyline.
      if (i === 0) flip();
      ends = true;
    } else return 'polyline-segment';
  }
  const sharp = distance(c.t1, c.t2) <= tol.linear;
  if (ends) {
    const last = cutSegment(vs[n - 1]!, vs[n]!, c.t1, c.k1, tol);
    const first = cutSegment(vs[0]!, vs[1]!, c.t2, c.k2, tol);
    if (!last || last.movedStart || !first || !first.movedStart) return 'too-large';
    const out: PVert[] = [
      { ...vs[0]!, ...at(c.t2, first.bulge) },
      ...vs.slice(1, n - 1),
      { ...vs[n - 1]!, bulge: last.bulge },
      ...(sharp ? [] : [at(c.t1, c.piece?.bulge ?? 0)]),
    ];
    return polylineWith(g, dedupe(out, true, tol), true);
  }
  const skip = gap(i, j);
  // Put the first segment's start at vertex 0 of a closed one, so nothing wraps.
  const ring = closed ? [...vs.slice(i), ...vs.slice(0, i)] : vs;
  const s = closed ? 0 : i;
  const e = s + skip; // the second segment's start vertex
  // Each segment keeps its far vertex: the piece goes in at the corner side.
  const first = cutSegment(ring[s]!, ring[s + 1]!, c.t1, c.k1, tol);
  const second = cutSegment(ring[e]!, ring[(e + 1) % ring.length]!, c.t2, c.k2, tol);
  if (!first || first.movedStart || !second || !second.movedStart) return 'too-large';
  const w = ring[e]!.w;
  const mid: PVert[] = sharp
    ? [{ ...at(c.t1, second.bulge), ...(w && { w }) }]
    : [at(c.t1, c.piece?.bulge ?? 0), { ...at(c.t2, second.bulge), ...(w && { w }) }];
  const out = [
    ...ring.slice(0, s),
    { ...ring[s]!, bulge: first.bulge },
    ...mid,
    ...ring.slice(e + 1),
  ];
  return polylineWith(g, dedupe(out, closed, tol), closed);
}

/** Vertices without repeats (the later one's bulge and widths kept). */
function dedupe(vs: readonly PVert[], closed: boolean, tol: Tolerance): PVert[] {
  const out: PVert[] = [];
  for (const v of vs) {
    const last = out.at(-1);
    if (last && distance(last, v) <= tol.linear)
      out[out.length - 1] = { ...v, x: last.x, y: last.y };
    else out.push(v);
  }
  if (closed && out.length > 2 && distance(out[0]!, out.at(-1)!) <= tol.linear) out.pop();
  return out;
}

/** What the Polyline option did. */
export interface PolylineCorners {
  readonly geom: EntityGeometry;
  /** Vertices filleted (chamfered). */
  readonly done: number;
  /** Vertices whose segments were too short. */
  readonly tooShort: number;
}

type CornerSize = { readonly fillet: number } | { readonly chamfer: ChamferSize };

/**
 * FILLET's (CHAMFER's) Polyline option on `g`: every vertex between two line segments, or
 * undefined for no 2D polyline.
 */
export function polylineCorners(
  g: EntityGeometry,
  size: CornerSize,
  tol: Tolerance,
): PolylineCorners | undefined {
  if (!isPolyline2d(g)) return undefined;
  let { vs } = pvertsOf(g);
  const { closed } = pvertsOf(g);
  if ('fillet' in size) vs = withoutFilletArcs(vs, closed, tol);
  const n = closed ? vs.length : vs.length - 1;
  if (n < 1) return undefined;
  const v = (i: number) => vs[((i % vs.length) + vs.length) % vs.length]!;
  const isLine = (s: number) => v(s).bulge === 0;
  const len = (s: number) => distance(v(s), v(s + 1));
  const startUse = new Array<number>(n).fill(0);
  const endUse = new Array<number>(n).fill(0);
  const bulgeAt = new Array<number>(n).fill(0);
  let done = 0;
  let tooShort = 0;
  const corners = closed
    ? Array.from({ length: n }, (_, k) => k)
    : Array.from({ length: n - 1 }, (_, k) => k + 1);
  for (const k of corners) {
    const prev = (k - 1 + n) % n;
    if (!isLine(prev) || !isLine(k) || len(prev) <= tol.linear || len(k) <= tol.linear) continue;
    const uin = normalize(sub(v(k - 1), v(k)));
    const uout = normalize(sub(v(k + 1), v(k)));
    const turn = cross(sub(v(k), v(k - 1)), sub(v(k + 1), v(k)));
    if (Math.abs(cross(uin, uout)) <= tol.angular) continue; // straight on (or back)
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(uin, uout))));
    let din: number;
    let dout: number;
    let bulge = 0;
    if ('fillet' in size) {
      din = dout = size.fillet / Math.tan(theta / 2);
      bulge = Math.sign(turn) * Math.tan((Math.PI - theta) / 4);
    } else {
      const d2 = secondDistance(size.chamfer, theta);
      din = size.chamfer.method === 'distance' ? size.chamfer.d1 : size.chamfer.length;
      if (d2 === undefined) {
        tooShort++;
        continue;
      }
      dout = d2;
    }
    if (startUse[prev]! + din > len(prev) + tol.linear || dout + endUse[k]! > len(k) + tol.linear) {
      tooShort++;
      continue;
    }
    endUse[prev] = din;
    startUse[k] = dout;
    bulgeAt[prev] = din > tol.linear || dout > tol.linear ? bulge : 0;
    done++;
  }
  const out: PVert[] = [];
  for (let s = 0; s < n; s++) {
    const a = v(s);
    const b = v(s + 1);
    const l = len(s);
    const u = l > 0 ? normalize(sub(b, a)) : { x: 0, y: 0 };
    const f0 = l > 0 ? startUse[s]! / l : 0;
    const f1 = l > 0 ? 1 - endUse[s]! / l : 1;
    const w = a.w && ([a.w[0] + (a.w[1] - a.w[0]) * f0, a.w[0] + (a.w[1] - a.w[0]) * f1] as const);
    out.push({ ...at(add(a, scale(u, startUse[s]!)), a.bulge), ...(w && { w }) });
    if (endUse[s]! > tol.linear || startUse[(s + 1) % n]! > tol.linear) {
      const we = w?.[1];
      out.push({
        ...at(sub(b, scale(u, endUse[s]!)), bulgeAt[s]!),
        ...(we !== undefined && { w: [we, we] as const }),
      });
    }
  }
  if (!closed) out.push(at(v(n)));
  return { geom: polylineWith(g, dedupe(out, closed, tol), closed), done, tooShort };
}

/**
 * The polyline with each arc segment between two line segments that converge taken out, the
 * lines meeting instead (FILLET's Polyline option fillets them again).
 */
function withoutFilletArcs(vs: readonly PVert[], closed: boolean, tol: Tolerance): PVert[] {
  const n = closed ? vs.length : vs.length - 1;
  const v = (i: number) => vs[((i % vs.length) + vs.length) % vs.length]!;
  const replace = new Map<number, Vec2>();
  const drop = new Set<number>();
  for (let j = 0; j < n; j++) {
    if (v(j).bulge === 0) continue;
    if (!closed && (j === 0 || j === n - 1)) continue;
    if (v(j - 1).bulge !== 0 || v(j + 1).bulge !== 0) continue;
    const a = v(j - 1);
    const b = v(j);
    const c = v(j + 1);
    const d = v(j + 2);
    const ca = lineCarrier(a, b);
    const cb = lineCarrier(c, d);
    if (!ca || !cb) continue;
    const x = meet(ca, cb, tol)[0];
    if (!x) continue;
    if (dot(sub(x, b), sub(b, a)) <= 0 || dot(sub(c, x), sub(d, c)) <= 0) continue;
    replace.set(j, x);
    drop.add((j + 1) % vs.length);
  }
  const out: PVert[] = [];
  vs.forEach((p, i) => {
    if (drop.has(i)) return;
    const x = replace.get(i);
    const next = vs[(i + 1) % vs.length]!;
    out.push(x ? { ...at(x), ...(next.w && { w: next.w }) } : p);
  });
  // The corner that took the place of a closed polyline's first vertex stays first.
  if (drop.has(0) && out.length > 0) out.unshift(out.pop()!);
  return out;
}
