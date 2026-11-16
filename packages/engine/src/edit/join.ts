// JOIN's geometry (M3-02 part 4), as AutoCAD 2024 joins (AutoCAD Help, "JOIN (Command)"):
//
// - Collinear lines join into one line, over any gaps between them.
// - Arcs of one circle join into one arc, counterclockwise over the gaps; arcs that leave no gap
//   make a circle. Elliptical arcs of one ellipse join the same way, into an ellipse when whole.
// - Lines, arcs and open 2D polylines that meet end to end join into one 2D polyline (closed
//   when the chain comes back to its start), each segment keeping its bulge and widths.
// - With a source object only what can join it is taken: collinear lines to a line, arcs of its
//   circle to an arc (counterclockwise from it), elliptical arcs of its ellipse to an elliptical
//   arc, and the chain through it to a polyline. Without one ("multiple objects to join at
//   once") every group that can join does, and arcs leave out their largest gap.
// - A source spline takes every line, arc, elliptical arc, open 2D polyline and open spline
//   that meets it end to end (M3-12 part 2): the result is one spline, C0 at the joins, closed
//   when the chain comes back to its start. Without a source, splines and elliptical arcs join
//   whatever meets them the same way, into a spline.
// - Open 3D polylines whose ends meet in plan and in height join into one 3D polyline (M3-17),
//   closed when the chain comes back to its start; AutoCAD's "All the objects must be
//   contiguous, but can be noncoplanar". The model carries their heights (DEC-062). Nothing
//   else joins a 3D polyline yet (M3-18): a sloped line's heights are not in the model, and the
//   spline a curve makes with one would be a 3D spline, which the model does not have. Joined
//   with each other, flat 3D polylines stay a 3D polyline: AutoCAD's "a polyline object results
//   from joining coplanar ... 3D polylines" is read as joining them with 2D objects, and a
//   drafter joining two 3D polylines expects one back.
// - Closed objects, spline-fit 3D polylines, xlines, rays, helixes and everything else are not
//   joined ("discarded from the operation"); nor are objects off the plan or at another
//   elevation from the chain they meet (a spline is at elevation 0).
//
// The order of work, lines then arcs then elliptical arcs then chains then splines, means
// collinear lines that also meet other objects end to end are first made one line, which then
// chains, and a chain of lines and arcs meeting a spline is first a polyline, which the spline
// then takes.
import { ccwSweep, normalizeAngle, TAU } from '../geom/angle';
import type { Spline } from '../geom/curves';
import { ellipseSweep, polylineSegmentCount } from '../geom/eval';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { cross, distance, dot, length, normalize, sub } from '../geom/vec';
import type { EntityId } from '../model/entity-ids';
import type {
  ArcGeometry,
  EllipseGeometry,
  EntityGeometry,
  LineGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/types';
import { cleanPolyline, segmentWidths } from './offset';
import { endsOf, joinableSpline, joinCurves, reversedSpline } from './splinedit';
import { openSpline } from './trim';

export interface JoinPart {
  readonly id: EntityId;
  readonly geom: EntityGeometry;
}

/** One object made by JOIN: `keep` takes `geom`, the others of `parts` go. */
export interface Joined {
  readonly keep: EntityId;
  readonly parts: readonly EntityId[];
  readonly geom: EntityGeometry;
  readonly made: 'line' | 'arc' | 'circle' | 'ellipse' | 'polyline' | 'spline';
}

export interface JoinResult {
  readonly joined: Joined[];
  /** The objects selected that joined nothing. */
  readonly discarded: number;
}

const isPlan = (g: { normal?: { x: number; y: number; z: number } }): boolean =>
  !g.normal || (g.normal.x === 0 && g.normal.y === 0 && g.normal.z > 0);

/**
 * What JOIN can take: lines, arcs, elliptical arcs, open 2D polylines and open splines, in plan,
 * and open 3D polylines that are not spline-fit.
 */
export function joinable(g: EntityGeometry): boolean {
  switch (g.kind) {
    case 'LINE':
      return isPlan(g) && distance(g.start, g.end) > 0;
    case 'ARC':
      return isPlan(g);
    case 'ELLIPSE':
      return isPlan(g) && ellipseSweep(g) < TAU;
    case 'LWPOLYLINE':
      return isPlan(g) && !g.closed && polylineSegmentCount(cleanPolyline(g).curve) > 0;
    case 'POLYLINE':
      if (g.is3d) return !g.closed && !g.fit && g.vertices.length > 1;
      return isPlan(g) && !g.closed && polylineSegmentCount(cleanPolyline(g).curve) > 0;
    case 'SPLINE':
      return isPlan(g) && !g.closed;
    default:
      return false;
  }
}

/** An object as JOIN works on it: what it is now and which selected objects it holds. */
interface Item {
  keep: EntityId;
  parts: EntityId[];
  geom: EntityGeometry;
  made?: Joined['made'];
}

/**
 * JOIN: the objects `parts` made fewer, `source` (one of them) the object the rest join to, or
 * none for AutoCAD's "multiple objects to join at once". Objects come in selection order: the
 * first of a group keeps its handle and properties.
 */
export function joinObjects(
  parts: readonly JoinPart[],
  source: EntityId | undefined,
  tol: Tolerance,
): JoinResult {
  let items: Item[] = parts
    .filter((p) => joinable(p.geom))
    .map((p) => ({ keep: p.id, parts: [p.id], geom: p.geom }));
  // The source goes first, so that it keeps itself.
  if (source !== undefined) {
    const i = items.findIndex((it) => it.keep === source);
    if (i < 0) return { joined: [], discarded: parts.length };
    items = [items[i]!, ...items.slice(0, i), ...items.slice(i + 1)];
  }
  const src = source === undefined ? undefined : items[0]!;
  const kind = src?.geom.kind;
  if (src && is3dPolyline(src.geom)) items = chain3d(items, src, tol);
  else if (!src) items = chain3d(items, undefined, tol);

  if (!src || kind === 'LINE') items = joinLines(items, src, tol);
  if (!src || kind === 'ARC') items = joinArcs(items, src, tol);
  if (!src || kind === 'ELLIPSE') items = joinEllipses(items, src, tol);
  // A line source takes only collinear lines, an arc source only arcs of its circle.
  if (!src || kind === 'LWPOLYLINE' || kind === 'POLYLINE') items = chain(items, src, tol);
  if (!src || kind === 'SPLINE') items = splineChain(items, src, tol);
  const joined = items
    .filter((it) => it.parts.length > 1 && it.made)
    .filter((it) => !src || it.keep === src.keep)
    .map((it) => ({ keep: it.keep, parts: it.parts, geom: it.geom, made: it.made! }));
  const used = joined.reduce((n, j) => n + j.parts.length, 0);
  return { joined, discarded: parts.length - used };
}

// ── Lines ─────────────────────────────────────────────────────────────────────────────────

/** Collinear lines, each group one line over its extremes, the first's direction kept. */
function joinLines(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const out: Item[] = [];
  const taken = new Set<Item>();
  for (const it of items) {
    if (taken.has(it) || it.geom.kind !== 'LINE') continue;
    if (src && it !== src) continue;
    const l = it.geom;
    const u = normalize(sub(l.end, l.start));
    const group = items.filter(
      (o) =>
        !taken.has(o) &&
        o.geom.kind === 'LINE' &&
        (o === it || (onCarrier(o.geom, l.start, u, tol) && sameElevation(o.geom, l))),
    );
    if (group.length < 2) continue;
    let lo = 0;
    let hi = distance(l.start, l.end);
    for (const o of group) {
      const g = o.geom as LineGeometry;
      for (const p of [g.start, g.end]) {
        const s = dot(sub(p, l.start), u);
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      taken.add(o);
    }
    const geom: LineGeometry = {
      ...l,
      start: { x: l.start.x + u.x * lo, y: l.start.y + u.y * lo },
      end: { x: l.start.x + u.x * hi, y: l.start.y + u.y * hi },
    };
    out.push({ keep: it.keep, parts: group.flatMap((o) => o.parts), geom, made: 'line' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}

/** Whether both ends of `g` are on the line through `p` along unit `u`. */
function onCarrier(g: LineGeometry, p: Vec2, u: Vec2, tol: Tolerance): boolean {
  return [g.start, g.end].every((q) => Math.abs(cross(u, sub(q, p))) <= tol.linear);
}

const sameElevation = (a: { elevation?: number }, b: { elevation?: number }): boolean =>
  (a.elevation ?? 0) === (b.elevation ?? 0);

/** Keeps the original order (the first object of each group where it was). */
const byFirst =
  (order: readonly Item[]) =>
  (a: Item, b: Item): number => {
    const rank = (x: Item) => order.findIndex((o) => o.parts.includes(x.parts[0]!));
    return rank(a) - rank(b);
  };

// ── Arcs and elliptical arcs ──────────────────────────────────────────────────────────────

/** An angular span [start, start + sweep] of a circle or ellipse, by parameter. */
interface Span {
  start: number;
  sweep: number;
}

/**
 * Spans of one circle or ellipse made one: the span from the end of the gap left out round to
 * its start, or undefined when they leave no gap (whole). With `first` (a source) the gap left
 * out is the one just before it; otherwise the largest.
 */
function unite(spans: readonly Span[], first: Span | undefined, eps: number): Span | undefined {
  // Parameters relative to the source's start (or the first span's), so the walk starts there.
  const from = (first ?? spans[0]!).start;
  const rel = spans
    .map((s) => {
      const a = normalizeAngle(s.start - from);
      return { a, b: a + s.sweep };
    })
    .sort((x, y) => x.a - y.a);
  const m: { a: number; b: number }[] = [];
  for (const s of rel) {
    const last = m.at(-1);
    if (last && s.a <= last.b + eps) last.b = Math.max(last.b, s.b);
    else m.push({ ...s });
  }
  // The last span may run on past a full turn over the first ones.
  while (m.length > 1 && m.at(-1)!.b - TAU >= m[0]!.a - eps) {
    const f = m.shift()!;
    m.at(-1)!.b = Math.max(m.at(-1)!.b, f.b + TAU);
  }
  if (m.some((x) => x.b - x.a >= TAU - eps)) return undefined;
  const gaps = m.map((x, i) => {
    const next = i + 1 < m.length ? m[i + 1]!.a : m[0]!.a + TAU;
    return { at: x.b, size: next - x.b };
  });
  const open = gaps.filter((g) => g.size > eps);
  if (open.length === 0) return undefined;
  // With a source the gap left is the one that ends where the source starts.
  const atSource = (g: { at: number; size: number }) => {
    const r = normalizeAngle(g.at + g.size);
    return r <= eps || r >= TAU - eps;
  };
  const gap = (first && open.find(atSource)) ?? open.reduce((x, y) => (y.size > x.size ? y : x));
  return { start: normalizeAngle(from + gap.at + gap.size), sweep: TAU - gap.size };
}

function joinArcs(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const out: Item[] = [];
  const taken = new Set<Item>();
  for (const it of items) {
    if (taken.has(it) || it.geom.kind !== 'ARC') continue;
    if (src && it !== src) continue;
    const a = it.geom;
    const group = items.filter(
      (o) =>
        !taken.has(o) &&
        o.geom.kind === 'ARC' &&
        distance(o.geom.center, a.center) <= tol.linear &&
        Math.abs(o.geom.radius - a.radius) <= tol.linear &&
        sameElevation(o.geom, a),
    );
    if (group.length < 2) continue;
    const spans = group.map((o) => {
      const g = o.geom as ArcGeometry;
      return { start: g.startAngle, sweep: ccwSweep(g.startAngle, g.endAngle) };
    });
    for (const o of group) taken.add(o);
    const eps = tol.linear / a.radius;
    const u = unite(spans, src ? spans[0] : undefined, eps);
    const parts = group.flatMap((o) => o.parts);
    if (!u) {
      const { startAngle: _s, endAngle: _e, ...rest } = a;
      out.push({ keep: it.keep, parts, geom: { ...rest, kind: 'CIRCLE' }, made: 'circle' });
      continue;
    }
    const geom: ArcGeometry = {
      ...a,
      startAngle: u.start,
      endAngle: normalizeAngle(u.start + u.sweep),
    };
    out.push({ keep: it.keep, parts, geom, made: 'arc' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}

/** The arc of `a`'s circle closed into the circle (JOIN's Close option on a source arc). */
export function closeArc(a: ArcGeometry): EntityGeometry {
  const { startAngle: _s, endAngle: _e, ...rest } = a;
  return { ...rest, kind: 'CIRCLE' };
}

/** The elliptical arc closed into its ellipse (JOIN's Close option). */
export function closeEllipse(e: EllipseGeometry): EllipseGeometry {
  return { ...e, startParam: 0, endParam: TAU };
}

function sameEllipse(a: EllipseGeometry, b: EllipseGeometry, tol: Tolerance): boolean {
  if (distance(a.center, b.center) > tol.linear) return false;
  if (Math.abs(a.ratio - b.ratio) * length(a.majorAxis) > tol.linear) return false;
  // The same major axis, or its opposite (parameters then differ by π).
  const same = distance(a.majorAxis, b.majorAxis) <= tol.linear;
  const opposite = distance(a.majorAxis, { x: -b.majorAxis.x, y: -b.majorAxis.y }) <= tol.linear;
  return same || opposite;
}

function joinEllipses(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const out: Item[] = [];
  const taken = new Set<Item>();
  for (const it of items) {
    if (taken.has(it) || it.geom.kind !== 'ELLIPSE') continue;
    if (src && it !== src) continue;
    const e = it.geom;
    const group = items.filter(
      (o) =>
        !taken.has(o) &&
        o.geom.kind === 'ELLIPSE' &&
        sameEllipse(o.geom, e, tol) &&
        sameElevation(o.geom, e),
    );
    if (group.length < 2) continue;
    const spans = group.map((o) => {
      const g = o.geom as EllipseGeometry;
      // An opposite major axis turns the parameters by π.
      const turn = distance(g.majorAxis, e.majorAxis) <= tol.linear ? 0 : Math.PI;
      return { start: normalizeAngle(g.startParam + turn), sweep: ellipseSweep(g) };
    });
    for (const o of group) taken.add(o);
    const eps = tol.linear / length(e.majorAxis);
    const u = unite(spans, src ? spans[0] : undefined, eps);
    const parts = group.flatMap((o) => o.parts);
    const geom: EllipseGeometry = u
      ? { ...e, startParam: u.start, endParam: normalizeAngle(u.start + u.sweep) }
      : closeEllipse(e);
    out.push({ keep: it.keep, parts, geom, made: 'ellipse' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}

// ── Chains into polylines ─────────────────────────────────────────────────────────────────

/** A vertex of a chain: where a segment starts, its bulge and widths. */
interface V {
  x: number;
  y: number;
  bulge: number;
  sw: number;
  ew: number;
}

/** An item as an open path of vertices (the last one only a point), or undefined. */
function pathOf(g: EntityGeometry): V[] | undefined {
  switch (g.kind) {
    case 'LINE':
      return [
        { x: g.start.x, y: g.start.y, bulge: 0, sw: 0, ew: 0 },
        { x: g.end.x, y: g.end.y, bulge: 0, sw: 0, ew: 0 },
      ];
    case 'ARC': {
      const sweep = ccwSweep(g.startAngle, g.endAngle);
      const at = (t: number) => ({
        x: g.center.x + g.radius * Math.cos(t),
        y: g.center.y + g.radius * Math.sin(t),
      });
      return [
        { ...at(g.startAngle), bulge: Math.tan(sweep / 4), sw: 0, ew: 0 },
        { ...at(g.startAngle + sweep), bulge: 0, sw: 0, ew: 0 },
      ];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (g.closed) return undefined;
      const { curve, index } = cleanPolyline(g);
      const n = polylineSegmentCount(curve);
      const cw = g.kind === 'LWPOLYLINE' ? g.constantWidth : undefined;
      const widths = segmentWidths(g, index, n);
      return curve.vertices.map((v, k) => {
        const w: readonly [number, number] =
          k >= n ? [0, 0] : cw !== undefined ? [cw, cw] : (widths?.[k] ?? [0, 0]);
        return { x: v.x, y: v.y, bulge: k >= n ? 0 : v.bulge, sw: w[0], ew: w[1] };
      });
    }
    default:
      return undefined;
  }
}

/** A path run the other way: each segment's bulge negated and widths swapped. */
function reversed(p: readonly V[]): V[] {
  const m = p.length;
  return p.map((_, k) => {
    const v = p[m - 1 - k]!;
    if (k === m - 1) return { x: v.x, y: v.y, bulge: 0, sw: 0, ew: 0 };
    const s = p[m - 2 - k]!;
    return { x: v.x, y: v.y, bulge: s.bulge === 0 ? 0 : -s.bulge, sw: s.ew, ew: s.sw };
  });
}

const near = (a: V, b: V, tol: Tolerance): boolean => distance(a, b) <= tol.linear;

/** Lines, arcs and open polylines that meet end to end, each chain one polyline. */
function chain(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const paths = new Map<Item, V[]>();
  for (const it of items) {
    if (it.geom.kind === 'ELLIPSE' || is3dPolyline(it.geom)) continue;
    const p = pathOf(it.geom);
    if (p) paths.set(it, p);
  }
  const out: Item[] = [];
  const taken = new Set<Item>();
  const elevation = (it: Item) => (it.geom as { elevation?: number }).elevation ?? 0;
  for (const it of items) {
    if (taken.has(it) || !paths.has(it)) continue;
    if (src && it !== src) continue;
    taken.add(it);
    const group = [it];
    let path = paths.get(it)!;
    const z = elevation(it);
    const closes = () => group.length > 1 && near(path[0]!, path.at(-1)!, tol);
    // On from the end, then back from the start.
    for (const atEnd of [true, false]) {
      for (;;) {
        if (closes()) break;
        const tip = atEnd ? path.at(-1)! : path[0]!;
        let found: { o: Item; p: V[] } | undefined;
        for (const [o, p] of paths) {
          if (taken.has(o) || elevation(o) !== z) continue;
          const first = p[0]!;
          const last = p.at(-1)!;
          if (atEnd) {
            if (near(first, tip, tol)) found = { o, p };
            else if (near(last, tip, tol)) found = { o, p: reversed(p) };
          } else if (near(last, tip, tol)) found = { o, p };
          else if (near(first, tip, tol)) found = { o, p: reversed(p) };
          if (found) break;
        }
        if (!found) break;
        taken.add(found.o);
        group.push(found.o);
        path = atEnd
          ? [...path.slice(0, -1), { ...found.p[0]!, x: tip.x, y: tip.y }, ...found.p.slice(1)]
          : [...found.p.slice(0, -1), ...path];
      }
    }
    if (group.length < 2) {
      taken.delete(it);
      continue;
    }
    const closed = closes();
    if (closed) path = path.slice(0, -1);
    // The polyline that keeps itself: the first polyline of the chain in selection order, else
    // the first object.
    const order = [...group].sort(byFirst(items));
    const keeper =
      order.find((o) => o.geom.kind === 'LWPOLYLINE' || o.geom.kind === 'POLYLINE') ?? order[0]!;
    const geom = polylineOf(keeper.geom, path, closed);
    out.push({ keep: keeper.keep, parts: order.flatMap((o) => o.parts), geom, made: 'polyline' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}

/** The polyline of `path`: `base`'s kind and properties when it is one, else an LWPOLYLINE. */
function polylineOf(base: EntityGeometry, path: readonly V[], closed: boolean): EntityGeometry {
  const vertices: PolylineVertex[] = path.map((v) => ({
    x: v.x,
    y: v.y,
    bulge: v.bulge,
    // A zero width is no width, as the file maps it.
    ...((v.sw !== 0 || v.ew !== 0) && { startWidth: v.sw, endWidth: v.ew }),
  }));
  if (base.kind === 'POLYLINE') {
    const { fit: _f, frame: _fr, startWidth: _sw, endWidth: _ew, ...rest } = base;
    const out: PolylineGeometry = { ...rest, vertices, closed };
    return out;
  }
  if (base.kind === 'LWPOLYLINE') {
    const { constantWidth: _cw, ...rest } = base;
    const out: LwPolylineGeometry = { ...rest, vertices, closed };
    return out;
  }
  const planar = base as {
    elevation?: number;
    thickness?: number;
    normal?: LwPolylineGeometry['normal'];
  };
  const out: LwPolylineGeometry = {
    kind: 'LWPOLYLINE',
    vertices,
    closed,
    ...(planar.elevation !== undefined && { elevation: planar.elevation }),
    ...(planar.thickness !== undefined && { thickness: planar.thickness }),
    ...(planar.normal !== undefined && { normal: planar.normal }),
  };
  return out;
}

// ── 3D polylines ─────────────────────────────────────────────────────────────────────────────

const is3dPolyline = (g: EntityGeometry): g is PolylineGeometry => g.kind === 'POLYLINE' && g.is3d;

/** A 3D polyline's vertex in the WCS. */
interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Within the tolerance in plan and in height. */
const meets3d = (a: P3, b: P3, tol: Tolerance): boolean =>
  distance(a, b) <= tol.linear && Math.abs(a.z - b.z) <= tol.linear;

/**
 * Open 3D polylines that meet end to end, in plan and in height, each chain one 3D polyline:
 * the first of the chain in selection order (or the source) keeps itself and its properties.
 * Where two meet, the vertex already in the chain stays.
 */
function chain3d(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const paths = new Map<Item, P3[]>();
  for (const it of items) {
    if (is3dPolyline(it.geom)) {
      paths.set(
        it,
        it.geom.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z ?? 0 })),
      );
    }
  }
  const out: Item[] = [];
  const taken = new Set<Item>();
  for (const it of items) {
    if (taken.has(it) || !paths.has(it)) continue;
    if (src && it !== src) continue;
    taken.add(it);
    const group = [it];
    let path = paths.get(it)!;
    const closes = () => group.length > 1 && meets3d(path[0]!, path.at(-1)!, tol);
    // On from the end, then back from the start.
    for (const atEnd of [true, false]) {
      for (;;) {
        if (closes()) break;
        const tip = atEnd ? path.at(-1)! : path[0]!;
        let found: { o: Item; p: P3[] } | undefined;
        for (const [o, p] of paths) {
          if (taken.has(o)) continue;
          const head = atEnd ? p[0]! : p.at(-1)!;
          const tail = atEnd ? p.at(-1)! : p[0]!;
          if (meets3d(head, tip, tol)) found = { o, p };
          else if (meets3d(tail, tip, tol)) found = { o, p: [...p].reverse() };
          if (found) break;
        }
        if (!found) break;
        taken.add(found.o);
        group.push(found.o);
        path = atEnd ? [...path, ...found.p.slice(1)] : [...found.p.slice(0, -1), ...path];
      }
    }
    if (group.length < 2) {
      taken.delete(it);
      continue;
    }
    const closed = closes();
    if (closed) path = path.slice(0, -1);
    const order = [...group].sort(byFirst(items));
    const keeper = src ?? order[0]!;
    const base = keeper.geom as PolylineGeometry;
    const geom: PolylineGeometry = {
      ...base,
      vertices: path.map((v) => ({ x: v.x, y: v.y, bulge: 0, ...(v.z !== 0 && { z: v.z }) })),
      closed,
    };
    out.push({ keep: keeper.keep, parts: order.flatMap((o) => o.parts), geom, made: 'polyline' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}

// ── Splines ─────────────────────────────────────────────────────────────────────────────────

/** Elevation 0 in plan: what can be part of a spline (which has no elevation). */
const onSplinePlane = (g: EntityGeometry): boolean =>
  isPlan(g as { normal?: { x: number; y: number; z: number } }) &&
  ((g as { elevation?: number }).elevation ?? 0) === 0;

/**
 * Each spline or elliptical arc (or only the source) with everything meeting it end to end
 * joined on, chained in turn, as one spline. The first spline of the group in selection order
 * keeps itself, else the first object.
 */
function splineChain(items: Item[], src: Item | undefined, tol: Tolerance): Item[] {
  const near = (a: Vec2, b: Vec2) => distance(a, b) <= tol.linear;
  const curves = new Map<Item, Spline>();
  for (const it of items) {
    const s = onSplinePlane(it.geom) ? joinableSpline(it.geom) : undefined;
    // A spline whose ends meet is closed all the same.
    if (s && !near(...endsOf(s))) curves.set(it, s);
  }
  const seeds = items.filter(
    (it) =>
      curves.has(it) &&
      (src ? it === src : it.geom.kind === 'SPLINE' || it.geom.kind === 'ELLIPSE'),
  );
  const out: Item[] = [];
  const taken = new Set<Item>();
  for (const it of seeds) {
    if (taken.has(it)) continue;
    taken.add(it);
    const group = [it];
    let curve = curves.get(it)!;
    for (let found = true; found;) {
      found = false;
      const [head, tail] = endsOf(curve);
      if (group.length > 1 && near(head, tail)) break;
      for (const [o, s] of curves) {
        if (taken.has(o)) continue;
        const [a, b] = endsOf(s);
        if (near(a, tail)) curve = joinCurves(curve, s);
        else if (near(b, tail)) curve = joinCurves(curve, reversedSpline(s));
        else if (near(b, head)) curve = joinCurves(s, curve);
        else if (near(a, head)) curve = joinCurves(reversedSpline(s), curve);
        else continue;
        taken.add(o);
        group.push(o);
        found = true;
        break;
      }
    }
    if (group.length < 2) {
      taken.delete(it);
      continue;
    }
    const order = [...group].sort(byFirst(items));
    const keeper = order.find((o) => o.geom.kind === 'SPLINE') ?? order[0]!;
    const [head, tail] = endsOf(curve);
    const base = keeper.geom.kind === 'SPLINE' ? keeper.geom : {};
    const geom: SplineGeometry = { ...openSpline(base, curve), closed: near(head, tail) };
    out.push({ keep: keeper.keep, parts: order.flatMap((o) => o.parts), geom, made: 'spline' });
  }
  return [...out, ...items.filter((it) => !taken.has(it))].sort(byFirst(items));
}
