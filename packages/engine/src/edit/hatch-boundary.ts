// HATCH's boundaries (M4-07), as AutoCAD 2024 finds them (AutoCAD 2024 Help, "HATCH (Command)",
// "About Hatch Boundaries and Islands", HPISLANDDETECTION, HPGAPTOL):
// - Pick points: "Determines a boundary from existing objects that form an enclosed area around
//   the specified point": the smallest face the objects divide the plane into around the point
//   (`edit/faces.ts`), objects that touch it taking part in its outline. "Enclosed areas within
//   the hatch boundary are known as islands": the other closed parts inside it. Normal "hatches
//   inward from the outer boundary. If an internal island is encountered, hatching is turned off
//   until another island within the island is encountered" (every island kept, filled by
//   parity); Outer "hatches inward from the outer boundary … does not affect any internal
//   islands" (the outermost islands only); Ignore "ignores all internal objects".
// - HPGAPTOL: "Treats a set of objects that almost enclose an area as a closed hatch boundary";
//   an end left in the open is joined to the nearest other open end within the tolerance, else
//   to the nearest object within it (AutoCAD documents no order; nearest first is our reading).
// - Select objects: "Determines a boundary from selected objects that form an enclosed area";
//   each closed object is a loop, those inside others islands by the same style. Open objects
//   make no loop.
// The loops keep their edges' types (lines, arcs, elliptical arcs, splines; DXF 72), walked end
// to end, a clockwise arc or ellipse edge with its angles negated (DXF 73 = 0), as AutoCAD writes
// them. The outer loop is flagged external (DXF 92 bit 1), the outermost islands bit 16.
import { TAU } from '../geom/angle';
import { boxesOverlap, curveBounds, type Box } from '../geom/bounds';
import { closestPoint } from '../geom/closest';
import type { Arc, BoundedCurve, Curve, Ellipse, Spline } from '../geom/curves';
import { domain, explodePolyline, pointAt } from '../geom/eval';
import { flatten } from '../geom/flatten';
import { toleranceForSize, type Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { distance } from '../geom/vec';
import type { HatchEdge, HatchLoop } from '../model/types';
import { arrangement, faceAround, insideRing, islandsIn, type Face } from './faces';
import { isClosedCurve, subSpline } from './trim';

/** HPISLANDDETECTION 0 Normal, 1 Outer, 2 Ignore (DXF 75 on the hatch). */
export type IslandStyle = 'normal' | 'outer' | 'ignore';

export interface BoundaryOptions {
  readonly style: IslandStyle;
  /** HPGAPTOL: gaps up to this wide are closed (0: none). */
  readonly gap: number;
}

/** What a pick point found: the loops to store, and their outlines as polygons. */
export interface PickedBoundary {
  /** The outer loop, then the islands kept. */
  readonly loops: readonly HatchLoop[];
  readonly rings: readonly (readonly Vec2[])[];
  /**
   * Each loop's curves, as indices into the curves given: what the hatch is drawn behind
   * (HPDRAWORDER) and what remove Boundaries takes out. A gap's bridge is none of them.
   */
  readonly sources: readonly (readonly number[])[];
}

/** DXF 92 bits. */
const EXTERNAL = 1;
const POLYLINE = 2;
const OUTERMOST = 16;

/**
 * The curves within `box`: an xline or a ray as the line across the box (none when it misses),
 * the rest as they are. A pick point's area is looked for among what the view shows.
 */
export function boundedCurves(curves: readonly Curve[], box: Box): BoundedCurve[] {
  const out: BoundedCurve[] = [];
  for (const c of curves) {
    if (c.kind !== 'XLINE' && c.kind !== 'RAY') {
      out.push(c);
      continue;
    }
    // Liang–Barsky: the part of base + t·d inside the box.
    let t0 = c.kind === 'RAY' ? 0 : -Infinity;
    let t1 = Infinity;
    const d = c.direction;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      return t0 <= t1;
    };
    if (
      clip(-d.x, c.base.x - box.minX) &&
      clip(d.x, box.maxX - c.base.x) &&
      clip(-d.y, c.base.y - box.minY) &&
      clip(d.y, box.maxY - c.base.y) &&
      t1 > t0
    ) {
      const at = (t: number) => ({ x: c.base.x + d.x * t, y: c.base.y + d.y * t });
      out.push({ kind: 'LINE', start: at(t0), end: at(t1) });
    }
  }
  return out;
}

/**
 * The curves as the pieces a boundary is made of: polylines by segment, no empty ones; each
 * piece mapped to the index of the curve it is part of.
 */
function piecesOf(
  curves: readonly Curve[],
  box?: Box,
): { pieces: BoundedCurve[]; from: Map<BoundedCurve, number> } {
  const from = new Map<BoundedCurve, number>();
  const area = box ?? extentsOf(curves.filter(isBounded));
  curves.forEach((curve, i) => {
    for (const c of boundedCurves([curve], area)) {
      for (const p of c.kind === 'LWPOLYLINE' ? explodePolyline(c) : [c]) {
        if (p.kind !== 'LINE' || distance(p.start, p.end) > 0) from.set(p, i);
      }
    }
  });
  return { pieces: [...from.keys()], from };
}

const isBounded = (c: Curve): c is BoundedCurve => c.kind !== 'XLINE' && c.kind !== 'RAY';

const ROUGH = toleranceForSize(1);

function extentsOf(curves: readonly BoundedCurve[]): Box {
  let box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of curves) {
    const b = curveBounds(c, ROUGH);
    box = {
      minX: Math.min(box.minX, b.minX),
      minY: Math.min(box.minY, b.minY),
      maxX: Math.max(box.maxX, b.maxX),
      maxY: Math.max(box.maxY, b.maxY),
    };
  }
  if (box.minX > box.maxX) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // Xlines and rays reach a little past what the rest spans.
  const m = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  return { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
}

/** The drawing's scale for these curves: tolerance, node merging and flattening. */
function scaleOf(curves: readonly BoundedCurve[]): { tol: Tolerance; merge: number; dev: number } {
  let magnitude = 1;
  let size = 0;
  for (const c of curves) {
    const b = curveBounds(c, ROUGH);
    magnitude = Math.max(
      magnitude,
      Math.abs(b.minX),
      Math.abs(b.maxX),
      Math.abs(b.minY),
      Math.abs(b.maxY),
    );
    size = Math.max(size, b.maxX - b.minX, b.maxY - b.minY);
  }
  const tol = toleranceForSize(magnitude);
  size = Math.max(size, tol.linear * 1e6);
  return { tol, merge: Math.max(tol.linear * 100, size * 1e-9), dev: size * 1e-4 };
}

/**
 * The boundary around `point` the curves enclose, its islands kept by `o.style`, or undefined
 * when the point is in no closed area ("Valid hatch boundary not found.").
 * `box`: where xlines and rays are cut (the view); the curves' extents when not given.
 */
export function boundaryAt(
  curves: readonly Curve[],
  point: Vec2,
  o: BoundaryOptions,
  box?: Box,
): PickedBoundary | undefined {
  const { pieces, from } = piecesOf(curves, box);
  if (pieces.length === 0) return undefined;
  const { tol, merge, dev } = scaleOf(pieces);
  const all = o.gap > 0 ? [...pieces, ...gapBridges(pieces, o.gap, merge, tol)] : pieces;
  const arr = arrangement(all, tol, merge);
  const around = faceAround(arr, point, dev);
  if (!around) return undefined;
  const islands =
    o.style === 'ignore'
      ? []
      : islandsIn(arr, around.face, around.ring, dev).filter(
          (i) => o.style === 'normal' || i.depth === 0,
        );
  return {
    loops: [
      { flags: EXTERNAL, edges: faceEdges(around.face) },
      ...islands.map((i) => ({ flags: i.depth === 0 ? OUTERMOST : 0, edges: faceEdges(i.face) })),
    ],
    rings: [around.ring, ...islands.map((i) => i.ring)],
    sources: [around.face, ...islands.map((i) => i.face)].map((f) => faceSources(f, from)),
  };
}

/** The curves (by index) a face is walked along, each once. */
function faceSources(f: Face, from: ReadonlyMap<BoundedCurve, number>): number[] {
  const out = new Set<number>();
  for (const h of f.halves) {
    const i = from.get(h.edge.curve);
    if (i !== undefined) out.add(i);
  }
  return [...out];
}

/** Lines closing the gaps up to `gap` wide between ends left in the open. */
function gapBridges(
  curves: readonly BoundedCurve[],
  gap: number,
  merge: number,
  tol: Tolerance,
): BoundedCurve[] {
  interface End {
    readonly p: Vec2;
    readonly curve: number;
  }
  const boxes = curves.map((c) => curveBounds(c, tol));
  const near = (i: number, p: Vec2, r: number) =>
    boxesOverlap(boxes[i]!, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, r);
  const free: End[] = [];
  curves.forEach((c, i) => {
    const d = domain(c);
    const a = pointAt(c, d.start);
    const b = pointAt(c, d.end);
    if (distance(a, b) <= merge) return; // closed
    for (const p of [a, b]) {
      const touches = curves.some(
        (o, j) => j !== i && near(j, p, merge) && closestPoint(o, p, tol).distance <= merge,
      );
      if (!touches) free.push({ p, curve: i });
    }
  });
  const out: BoundedCurve[] = [];
  const used = new Set<End>();
  for (const e of free) {
    if (used.has(e)) continue;
    // The nearest other open end within the gap…
    let best: { to: Vec2; end?: End; d: number } | undefined;
    for (const f of free) {
      if (f === e || used.has(f)) continue;
      const d = distance(e.p, f.p);
      if (d <= gap && (!best || d < best.d)) best = { to: f.p, end: f, d };
    }
    // …else the nearest point on another object within it.
    if (!best) {
      curves.forEach((c, j) => {
        if (j === e.curve || !near(j, e.p, gap)) return;
        const cp = closestPoint(c, e.p, tol);
        if (cp.distance <= gap && (!best || cp.distance < best.d)) {
          best = { to: cp.point, d: cp.distance };
        }
      });
    }
    if (!best) continue;
    used.add(e);
    if (best.end) used.add(best.end);
    out.push({ kind: 'LINE', start: e.p, end: best.to });
  }
  return out;
}

/** A stretch of one curve a face is walked along. */
interface Span {
  readonly curve: BoundedCurve;
  t0: number;
  t1: number;
  readonly forward: boolean;
}

/**
 * A face's outline as hatch edges, each walked the way the face is. Neighbouring stretches of
 * one curve are one edge: a circle cut where its domain starts and at one crossing is still one
 * arc between crossings, not two.
 */
function faceEdges(f: Face): HatchEdge[] {
  const spans: Span[] = [];
  for (const h of f.halves) {
    const { curve, t0, t1 } = h.edge;
    const s: Span = { curve, t0, t1, forward: h.forward };
    const last = spans.at(-1);
    if (!(last && extend(last, s))) spans.push(s);
  }
  if (spans.length > 1 && extend(spans.at(-1)!, spans[0]!)) {
    const last = spans.pop()!;
    spans[0] = last;
  }
  return spans.flatMap((s) => edgeOf(s.curve, s.t0, s.t1, s.forward) ?? []);
}

/**
 * Takes `next` into `s` when it goes on along the same curve: from where `s` ends, or round a
 * circle's or ellipse's start (its parameters then run past the period).
 */
function extend(s: Span, next: Span): boolean {
  if (next.curve !== s.curve || next.forward !== s.forward) return false;
  const period = s.curve.kind === 'CIRCLE' || s.curve.kind === 'ELLIPSE' || s.curve.kind === 'ARC';
  const d = domain(s.curve);
  const full = d.end - d.start;
  const closedRound = period && Math.abs(full - TAU) < 1e-12 * TAU;
  if (s.forward) {
    if (next.t0 === s.t1) s.t1 = next.t1;
    else if (closedRound && s.t1 === d.end && next.t0 === d.start) s.t1 = next.t1 + TAU;
    else return false;
  } else if (next.t1 === s.t0) s.t0 = next.t0;
  else if (closedRound && s.t0 === d.start && next.t1 === d.end) s.t0 = next.t0 - TAU;
  else return false;
  return true;
}

const norm = (a: number): number => {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
};

/** The edge from `t0` to `t1` of `c` (a piece: no polyline), walked forward or back. */
function edgeOf(c: BoundedCurve, t0: number, t1: number, forward: boolean): HatchEdge | undefined {
  switch (c.kind) {
    case 'LINE': {
      const a = pointAt(c, t0);
      const b = pointAt(c, t1);
      return forward ? { type: 'line', start: a, end: b } : { type: 'line', start: b, end: a };
    }
    case 'CIRCLE':
    case 'ARC':
      return { type: 'arc', center: c.center, radius: c.radius, ...angles(t0, t1, forward) };
    case 'ELLIPSE':
      return {
        type: 'ellipse',
        center: c.center,
        majorAxis: c.majorAxis,
        ratio: c.ratio,
        ...angles(t0, t1, forward),
      };
    case 'SPLINE': {
      const s = subSpline(c, t0, t1);
      if (!s) return undefined;
      return splineEdge(forward ? s : reversed(s));
    }
    case 'LWPOLYLINE':
      return undefined; // split into its segments before
  }
}

/**
 * An arc's or ellipse's angles (parameters) from `t0` to `t1` counter-clockwise, as DXF stores
 * the edge: walked back (clockwise), AutoCAD stores them negated with DXF 73 = 0.
 */
function angles(
  t0: number,
  t1: number,
  forward: boolean,
): { startAngle: number; endAngle: number; ccw: boolean } {
  if (Math.abs(t1 - t0 - TAU) < 1e-12 * TAU) return { startAngle: 0, endAngle: TAU, ccw: forward };
  return forward
    ? { startAngle: norm(t0), endAngle: norm(t1), ccw: true }
    : { startAngle: norm(-t1), endAngle: norm(-t0), ccw: false };
}

/** The spline run the other way: knots mirrored, control points and weights reversed. */
function reversed(s: Spline): Spline {
  const a = s.knots[0]!;
  const b = s.knots.at(-1)!;
  return {
    kind: 'SPLINE',
    degree: s.degree,
    knots: s.knots.map((u) => a + b - u).reverse(),
    controlPoints: [...s.controlPoints].reverse(),
    ...(s.weights && { weights: [...s.weights].reverse() }),
  };
}

function splineEdge(s: Spline): HatchEdge {
  return {
    type: 'spline',
    degree: s.degree,
    knots: s.knots,
    controlPoints: s.controlPoints,
    ...(s.weights && { weights: s.weights }),
    periodic: false,
  };
}

/**
 * The loops of objects selected for a hatch (Select objects): each closed object's own, in
 * the order given, islands kept by `o.style` (gaps are not closed: HPGAPTOL applies to pick
 * points). Each entry is one object's curves; only an object of one closed curve makes a loop.
 */
export function boundaryOfObjects(
  objects: readonly (readonly Curve[])[],
  o: BoundaryOptions,
): HatchLoop[] {
  const closed: BoundedCurve[] = [];
  for (const curves of objects) {
    if (curves.length !== 1) continue;
    const c = curves[0]!;
    if (isBounded(c) && isClosedCurve(c, scaleOf([c]).tol)) closed.push(c);
  }
  if (closed.length === 0) return [];
  const { dev } = scaleOf(closed);
  const rings = closed.map((c) => flatten(c, dev).points);
  const areas = rings.map((r) => Math.abs(ringArea(r)));
  const depths = rings.map(
    (r, i) =>
      rings.filter((q, j) => j !== i && areas[j]! > areas[i]! && insideRing(q, r[0]!)).length,
  );
  const keep = (d: number) => o.style === 'normal' || d <= (o.style === 'outer' ? 1 : 0);
  return closed.flatMap((c, i) =>
    keep(depths[i]!)
      ? [objectLoop(c, depths[i] === 0 ? EXTERNAL : depths[i] === 1 ? OUTERMOST : 0)]
      : [],
  );
}

function ringArea(r: readonly Vec2[]): number {
  let s = 0;
  r.forEach((p, i) => {
    const q = r[(i + 1) % r.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
}

/** A closed object as a loop: a polyline as one (DXF 92 bit 2), anything else as its edge. */
function objectLoop(c: BoundedCurve, flags: number): HatchLoop {
  if (c.kind === 'LWPOLYLINE') {
    return {
      flags: flags | POLYLINE,
      polyline: {
        vertices: c.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge })),
        closed: true,
      },
    };
  }
  const d = domain(c);
  const edge =
    c.kind === 'SPLINE' ? splineEdge(c) : edgeOf(c as Arc | Ellipse, d.start, d.end, true)!;
  return { flags, edges: [edge] };
}
