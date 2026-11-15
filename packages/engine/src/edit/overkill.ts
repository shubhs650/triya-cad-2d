// OVERKILL's geometry (M3-02 part 6; AutoCAD Help, "Delete Duplicate Objects Dialog Box",
// "-OVERKILL (Command)"): what it deletes and what it combines among the objects chosen.
//
// 1. Duplicates: two objects of one type, with the same properties (but those ignored) and the
//    same geometry within the tolerance, are one too many; the one drawn later goes. A line
//    or polyline run the other way is the same object.
// 2. Overlaps: collinear lines and arcs of one circle with the same properties. One lying
//    within another (or within a circle) goes; one that partly overlaps (Combine co-linear
//    objects that partially overlap) or meets another end to end (… when aligned end to end)
//    is combined with it into one, the earlier one kept and stretched, arcs coming round to a
//    circle becoming one.
// 3. Optimize segments within polylines: a polyline's zero-length segments and the vertices
//    between collinear straight segments going on the same way are taken out (with equal
//    widths, unless Ignore polyline segment width); a line lying on a straight segment of a
//    polyline goes. Polylines are never broken here: what AutoCAD's "Do not break polylines"
//    turned off allows (a polyline segment deleted as the duplicate of a line) is not done.
// 4. Maintain associative objects: an associative hatch or dimension, and an object one is
//    associated with, is left alone.
//
// Numbers compare within the tolerance (0: they must match exactly, as AutoCAD says).
import type { ArcGeometry, Entity, EntityGeometry, PolylineVertex } from '../model/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { reverseGeometry } from './break';

/** The properties OVERKILL can be told to ignore (the dialog's "Ignore object property"). */
export const OVERKILL_PROPERTIES = [
  'color',
  'layer',
  'linetype',
  'ltScale',
  'lineweight',
  'thickness',
  'transparency',
  'plotStyle',
  'material',
] as const;
export type OverkillProperty = (typeof OVERKILL_PROPERTIES)[number];

export interface OverkillSettings {
  readonly tolerance: number;
  readonly ignore: readonly OverkillProperty[];
  readonly optimizePolylines: boolean;
  readonly ignoreWidths: boolean;
  readonly keepPolylines: boolean;
  readonly combinePartial: boolean;
  readonly combineEndToEnd: boolean;
  readonly keepAssociative: boolean;
}

/** AutoCAD 2024's dialog as it first opens. */
export const DEFAULT_OVERKILL: OverkillSettings = {
  tolerance: 0.000001,
  ignore: [],
  optimizePolylines: true,
  ignoreWidths: false,
  keepPolylines: false,
  combinePartial: true,
  combineEndToEnd: false,
  keepAssociative: true,
};

export interface OverkillPlan {
  readonly erase: EntityId[];
  /** Objects kept with a new shape (combined, optimized). */
  readonly reshape: Map<EntityId, EntityGeometry>;
  /** "N duplicate(s) deleted". */
  readonly duplicates: number;
  /** "N overlapping object(s) or segment(s) deleted". */
  readonly overlaps: number;
}

type Vec = { readonly x: number; readonly y: number };

/** Equal within `tol`, numbers at any depth, leaving out the fields `skip` names. */
function near(a: unknown, b: unknown, tol: number, skip: ReadonlySet<string>): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = (r: Record<string, unknown>) =>
    Object.keys(r).filter((k) => r[k] !== undefined && !skip.has(k));
  const ka = keys(ra);
  const kb = keys(rb);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => near(ra[k], rb[k], tol, skip));
}

/** The same shape, either way round for lines and polylines. */
function sameShape(a: EntityGeometry, b: EntityGeometry, tol: number, skip: ReadonlySet<string>) {
  if (near(a, b, tol, skip)) return true;
  if (a.kind !== 'LINE' && a.kind !== 'LWPOLYLINE' && a.kind !== 'POLYLINE') return false;
  const r = reverseGeometry(b);
  return r !== undefined && near(a, r, tol, skip);
}

/** The properties two objects must share (whatever their type), as one string. */
function propertyKey(e: Entity, s: OverkillSettings): string {
  const ignored = new Set(s.ignore);
  const take = (k: OverkillProperty, v: unknown) => (ignored.has(k) ? '*' : JSON.stringify(v));
  return [
    e.owner,
    String(e.visible),
    take('layer', e.layer),
    take('color', e.color),
    take('linetype', e.linetype),
    take('ltScale', e.ltScale),
    take('lineweight', e.lineweight),
    take('transparency', e.transparency),
    take('plotStyle', e.plotStyle ?? null),
    take('material', e.material ?? null),
    take('thickness', (e.geom as { thickness?: number }).thickness ?? 0),
  ].join('|');
}

/** The smallest x of any point in the geometry: duplicates have it within the tolerance. */
function anchorX(v: unknown): number {
  if (typeof v !== 'object' || v === null) return Infinity;
  const r = v as Record<string, unknown>;
  let m = typeof r.x === 'number' && typeof r.y === 'number' ? r.x : Infinity;
  for (const x of Object.values(r)) if (typeof x === 'object') m = Math.min(m, anchorX(x));
  return m;
}

/** Associative: a hatch or dimension tied to its geometry, or geometry one is tied to. */
function isAssociative(model: DocumentModel, e: Entity): boolean {
  if (e.geom.kind === 'HATCH' && e.geom.associative) return true;
  return (e.reactors ?? []).some((h) => {
    if (model.objects.get(h)?.type === 'DIMASSOC') return true;
    const id = model.ids.idOf(h);
    const r = id === undefined ? undefined : model.entity(id);
    return r?.geom.kind === 'HATCH' && r.geom.associative === true;
  });
}

/** What OVERKILL does to the objects `ids` (in drawing order), without doing it. */
export function planOverkill(
  model: DocumentModel,
  ids: readonly EntityId[],
  s: OverkillSettings,
): OverkillPlan {
  const tol = Math.max(0, s.tolerance);
  const skip = new Set(s.ignore.includes('thickness') ? ['thickness'] : []);
  const erased = new Set<EntityId>();
  const reshape = new Map<EntityId, EntityGeometry>();
  const order = new Map(ids.map((id, i) => [id, i]));
  const live = ids.flatMap((id) => {
    const e = model.entity(id);
    return e && !(s.keepAssociative && isAssociative(model, e)) ? [e] : [];
  });
  // By properties (overlaps: a line on a polyline, an arc on a circle), then also by type.
  const groups = new Map<string, Entity[]>();
  const typed = new Map<string, Entity[]>();
  const into = (m: Map<string, Entity[]>, k: string, e: Entity) => {
    const g = m.get(k);
    if (g) g.push(e);
    else m.set(k, [e]);
  };
  for (const e of live) {
    const k = propertyKey(e, s);
    into(groups, k, e);
    into(typed, `${e.type}|${k}`, e);
  }

  // 1. Duplicates: sorted by their leftmost point, only neighbours within the tolerance match.
  let duplicates = 0;
  for (const g of typed.values()) {
    const xs = g.map((e) => ({ e, x: anchorX(e.geom) })).sort((a, b) => a.x - b.x);
    for (let i = 0; i < xs.length; i++) {
      if (erased.has(xs[i]!.e.id)) continue;
      for (let j = i + 1; j < xs.length && xs[j]!.x - xs[i]!.x <= tol; j++) {
        const [a, b] = [xs[i]!.e, xs[j]!.e];
        if (erased.has(b.id) || !sameShape(a.geom, b.geom, tol, skip)) continue;
        // The one drawn later goes.
        const later = order.get(a.id)! > order.get(b.id)! ? a : b;
        erased.add(later.id);
        duplicates++;
        if (later === a) break;
      }
    }
  }

  // 2 and 3. Overlaps, by property group.
  let overlaps = 0;
  const geom = (e: Entity) => reshape.get(e.id) ?? e.geom;
  for (const g of groups.values()) {
    const left = g.filter((e) => !erased.has(e.id));
    if (s.optimizePolylines) {
      for (const e of left) {
        const r = optimizePolyline(e.geom, tol, s.ignoreWidths);
        if (r) {
          reshape.set(e.id, r.geom);
          overlaps += r.removed;
        }
      }
    }
    const lines: Segment[] = [];
    for (const e of left) {
      const x = geom(e);
      if (x.kind === 'LINE') lines.push({ id: e.id, a: x.start, b: x.end, fixed: false, line: x });
      else if (s.optimizePolylines && (x.kind === 'LWPOLYLINE' || x.kind === 'POLYLINE')) {
        if (x.kind === 'POLYLINE' && (x.is3d || x.fit)) continue;
        const n = x.vertices.length;
        for (let i = 0; i < (x.closed ? n : n - 1); i++) {
          const v = x.vertices[i]!;
          if (v.bulge === 0) {
            lines.push({ id: e.id, a: v, b: x.vertices[(i + 1) % n]!, fixed: true });
          }
        }
      }
    }
    overlaps += combineLines(lines, tol, s, erased, reshape, order);
    const arcs = left.filter((e) => e.geom.kind === 'ARC' || e.geom.kind === 'CIRCLE');
    overlaps += combineArcs(arcs, tol, s, erased, reshape, order);
  }
  for (const id of erased) reshape.delete(id);
  return {
    erase: [...erased].sort((a, b) => order.get(a)! - order.get(b)!),
    reshape,
    duplicates,
    overlaps,
  };
}

// ── Polylines ──────────────────────────────────────────────────────────────────────────────

const width = (v: PolylineVertex, k: 'startWidth' | 'endWidth', d: number) => v[k] ?? d;

/**
 * A polyline without its zero-length segments and with collinear straight segments that go on
 * the same way made one; undefined when there is nothing to take out.
 */
export function optimizePolyline(
  g: EntityGeometry,
  tol: number,
  ignoreWidths: boolean,
): { geom: EntityGeometry; removed: number } | undefined {
  if (g.kind !== 'LWPOLYLINE' && g.kind !== 'POLYLINE') return undefined;
  if (g.kind === 'POLYLINE' && (g.is3d || g.fit || g.frame)) return undefined;
  const sw = g.kind === 'POLYLINE' ? (g.startWidth ?? 0) : (g.constantWidth ?? 0);
  const ew = g.kind === 'POLYLINE' ? (g.endWidth ?? 0) : (g.constantWidth ?? 0);
  const vs = [...g.vertices];
  let removed = 0;
  const same = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  const plain = (v: PolylineVertex) =>
    ignoreWidths || width(v, 'startWidth', sw) === width(v, 'endWidth', ew);
  for (let i = 1; i < vs.length;) {
    const prev = vs[i - 1]!;
    const v = vs[i]!;
    // A zero-length segment: its vertex goes (the last one keeps its place, the one before goes).
    if (same(prev, v) && vs.length > 2) {
      vs.splice(i === vs.length - 1 ? i - 1 : i, 1);
      if (i === vs.length) vs[i - 1] = { ...vs[i - 1]!, bulge: 0 };
      removed++;
      continue;
    }
    const next = vs[i + 1];
    if (
      next &&
      prev.bulge === 0 &&
      v.bulge === 0 &&
      plain(prev) &&
      plain(v) &&
      (ignoreWidths ||
        (width(prev, 'startWidth', sw) === width(v, 'startWidth', sw) &&
          width(prev, 'endWidth', ew) === width(v, 'endWidth', ew)))
    ) {
      const d1 = { x: v.x - prev.x, y: v.y - prev.y };
      const d2 = { x: next.x - v.x, y: next.y - v.y };
      const l = Math.hypot(next.x - prev.x, next.y - prev.y);
      const off = l > 0 ? Math.abs(d1.x * (next.y - prev.y) - d1.y * (next.x - prev.x)) / l : 0;
      if (off <= tol && d1.x * d2.x + d1.y * d2.y > 0) {
        vs[i - 1] = { ...prev, ...(v.endWidth !== undefined && { endWidth: v.endWidth }) };
        vs.splice(i, 1);
        removed++;
        continue;
      }
    }
    i++;
  }
  if (removed === 0) return undefined;
  return { geom: { ...g, vertices: vs } as EntityGeometry, removed };
}

// ── Lines ──────────────────────────────────────────────────────────────────────────────────

interface Segment {
  readonly id: EntityId;
  readonly a: Vec;
  readonly b: Vec;
  /** A polyline segment: never erased or stretched. */
  readonly fixed: boolean;
  /** A LINE's own geometry (its plane and thickness kept when it is stretched). */
  readonly line?: Extract<EntityGeometry, { kind: 'LINE' }>;
}

/** Distance from `p` to the infinite line through `a` and `b`. */
function offLine(p: Vec, a: Vec, b: Vec): number {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l > 0 ? Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / l : Infinity;
}

function combineLines(
  segs: readonly Segment[],
  tol: number,
  s: OverkillSettings,
  erased: Set<EntityId>,
  reshape: Map<EntityId, EntityGeometry>,
  order: ReadonlyMap<EntityId, number>,
): number {
  // Collinear sets: by direction (mod π), then by distance of the line from the origin.
  const keyed = segs.flatMap((g) => {
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const l = Math.hypot(dx, dy);
    if (!(l > tol)) return [];
    let theta = Math.atan2(dy, dx);
    if (theta < 0) theta += Math.PI;
    if (theta >= Math.PI - 1e-9) theta -= Math.PI;
    const c = (-Math.sin(theta) * g.a.x + Math.cos(theta) * g.a.y) as number;
    return [{ g, theta, c, l }];
  });
  keyed.sort((p, q) => p.theta - q.theta || p.c - q.c);
  let removed = 0;
  for (let i = 0; i < keyed.length;) {
    // A run of near-equal directions, then split by offset.
    let j = i + 1;
    while (j < keyed.length && keyed[j]!.theta - keyed[j - 1]!.theta <= 1e-6) j++;
    const run = keyed.slice(i, j).sort((p, q) => p.c - q.c);
    for (let a = 0; a < run.length;) {
      let b = a + 1;
      while (b < run.length && run[b]!.c - run[b - 1]!.c <= tol) b++;
      if (b - a > 1)
        removed += sweep(
          run.slice(a, b).map((k) => k.g),
          tol,
          s,
          erased,
          reshape,
          order,
        );
      a = b;
    }
    i = j;
  }
  return removed;
}

/** One set of (nearly) collinear segments: contained ones go, touching ones combine. */
function sweep(
  segs: readonly Segment[],
  tol: number,
  s: OverkillSettings,
  erased: Set<EntityId>,
  reshape: Map<EntityId, EntityGeometry>,
  order: ReadonlyMap<EntityId, number>,
): number {
  const base = segs[0]!;
  const o = base.a;
  const L = Math.hypot(base.b.x - o.x, base.b.y - o.y);
  const d = { x: (base.b.x - o.x) / L, y: (base.b.y - o.y) / L };
  const t = (p: Vec) => (p.x - o.x) * d.x + (p.y - o.y) * d.y;
  const items = segs
    .filter((g) => offLine(g.a, base.a, base.b) <= tol && offLine(g.b, base.a, base.b) <= tol)
    .map((g) => {
      const [t0, t1] = [t(g.a), t(g.b)].sort((x, y) => x - y) as [number, number];
      return { g, t0, t1 };
    })
    .sort((p, q) => p.t0 - q.t0 || q.t1 - p.t1 || order.get(p.g.id)! - order.get(q.g.id)!);
  let removed = 0;
  let cover: (typeof items)[number] | undefined;
  for (const it of items) {
    if (cover && it.t1 <= cover.t1 + tol) {
      // Within another: a line goes; a polyline segment stays.
      if (!it.g.fixed && !(cover.g.id === it.g.id)) {
        erased.add(it.g.id);
        removed++;
      }
      continue;
    }
    if (cover && it.t0 <= cover.t1 + tol) {
      const partial = it.t0 < cover.t1 - tol;
      if (!it.g.fixed && !cover.g.fixed && (partial ? s.combinePartial : s.combineEndToEnd)) {
        // The line drawn first is kept, its own way round, now spanning the two.
        const first = order.get(it.g.id)! < order.get(cover.g.id)!;
        const [keep, gone] = first ? [it, cover] : [cover, it];
        erased.add(gone.g.id);
        removed++;
        cover = { g: keep.g, t0: cover.t0, t1: it.t1 };
        const own = keep.g;
        const forward = t(own.b) >= t(own.a);
        const at = (u: number) => ({ x: o.x + d.x * u, y: o.y + d.y * u });
        const [p0, p1] = forward ? [cover.t0, cover.t1] : [cover.t1, cover.t0];
        reshape.set(own.id, { ...own.line!, start: at(p0), end: at(p1) });
        continue;
      }
    }
    cover = it;
  }
  return removed;
}

// ── Arcs ───────────────────────────────────────────────────────────────────────────────────

const TAU = 2 * Math.PI;
const sweepOf = (a: ArcGeometry) => (((a.endAngle - a.startAngle) % TAU) + TAU) % TAU || TAU;
/** `x` counterclockwise from `from`, in [0, 2π). */
const ccw = (from: number, x: number) => (((x - from) % TAU) + TAU) % TAU;

function combineArcs(
  shapes: readonly Entity[],
  tol: number,
  s: OverkillSettings,
  erased: Set<EntityId>,
  reshape: Map<EntityId, EntityGeometry>,
  order: ReadonlyMap<EntityId, number>,
): number {
  const items = shapes
    .filter((e) => !erased.has(e.id))
    .map((e) => ({ e, g: e.geom as ArcGeometry | Extract<EntityGeometry, { kind: 'CIRCLE' }> }))
    .sort((a, b) => a.g.radius - b.g.radius);
  let removed = 0;
  for (let i = 0; i < items.length;) {
    let j = i + 1;
    while (j < items.length && items[j]!.g.radius - items[j - 1]!.g.radius <= tol) j++;
    const run = items.slice(i, j);
    i = j;
    if (run.length < 2) continue;
    // Pairwise within one radius: concentric ones share a circle.
    const done = new Set<EntityId>();
    for (const a of run) {
      if (done.has(a.e.id)) continue;
      const circle = run.filter(
        (b) =>
          !done.has(b.e.id) &&
          Math.hypot(b.g.center.x - a.g.center.x, b.g.center.y - a.g.center.y) <= tol,
      );
      for (const b of circle) done.add(b.e.id);
      if (circle.length > 1)
        removed += onOneCircle(
          circle.map((c) => c.e),
          tol,
          s,
          erased,
          reshape,
          order,
        );
    }
  }
  return removed;
}

/** Arcs (and circles) of one circle: contained ones go, touching ones combine. */
function onOneCircle(
  es: readonly Entity[],
  tol: number,
  s: OverkillSettings,
  erased: Set<EntityId>,
  reshape: Map<EntityId, EntityGeometry>,
  order: ReadonlyMap<EntityId, number>,
): number {
  let removed = 0;
  const shape = (e: Entity) =>
    (reshape.get(e.id) ?? e.geom) as ArcGeometry | Extract<EntityGeometry, { kind: 'CIRCLE' }>;
  const sorted = [...es].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  for (let changed = true; changed;) {
    changed = false;
    for (const a of sorted) {
      if (erased.has(a.id)) continue;
      for (const b of sorted) {
        if (a === b || erased.has(b.id) || erased.has(a.id)) continue;
        const ga = shape(a);
        const gb = shape(b);
        const atol = tol / Math.max(ga.radius, 1e-12);
        if (gb.kind === 'CIRCLE') {
          if (ga.kind === 'ARC') {
            erased.add(a.id);
            removed++;
            changed = true;
          }
          continue;
        }
        if (ga.kind === 'CIRCLE') continue;
        const sa = sweepOf(ga);
        const sb = sweepOf(gb);
        const off = ccw(ga.startAngle, gb.startAngle); // where b starts, along a
        // b within a.
        if (
          (off <= sa + atol && off + sb <= sa + atol) ||
          (TAU - off <= atol && sb - (TAU - off) <= sa + atol)
        ) {
          erased.add(b.id);
          removed++;
          changed = true;
          continue;
        }
        // b starts within a (or at its end) and runs on past it.
        if (off <= sa + atol) {
          const partial = off < sa - atol;
          if (!(partial ? s.combinePartial : s.combineEndToEnd)) continue;
          const total = off + sb;
          erased.add(b.id);
          removed++;
          changed = true;
          if (total >= TAU - atol) {
            const { startAngle: _s, endAngle: _e, ...rest } = ga;
            reshape.set(a.id, { ...rest, kind: 'CIRCLE' } as EntityGeometry);
          } else reshape.set(a.id, { ...ga, endAngle: (ga.startAngle + total) % TAU });
        }
      }
    }
  }
  return removed;
}
