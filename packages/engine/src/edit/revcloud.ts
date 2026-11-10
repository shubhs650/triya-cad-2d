// Revision clouds and wipeouts as AutoCAD stores them (M2-08).
//
// A revision cloud is an LWPOLYLINE whose every segment is an arc of the same bulge, with
// `RevcloudProps` xdata that AutoCAD 2021+ uses to know it as a cloud: AutoCAD writes a bulge
// of 0.520567 (an arc of about 110°) and ezdxf's `revcloud.is_revcloud` requires it, with the
// xdata (1070 0, 1040 arc length) and a closed polyline. The arcs bulge out of the area the
// cloud encloses ("Normal"); reversing the direction turns them in. A Calligraphy cloud widens
// each arc from 0 to a tenth of the arc length, as ezdxf's `revcloud.add_entity` describes
// AutoCAD's. The arc length is the chord between an arc's ends (ezdxf's `segment_length`):
// AutoCAD's documentation says only "the length of the arcs".
//
// AutoCAD varies the arcs between the minimum and maximum arc length for a hand-drawn look. It
// does so at random; Triya uses a fixed pseudo-random sequence so a cloud drawn twice from the
// same points is the same cloud (and tests can check it).
//
// A wipeout is a WIPEOUT whose frame is a square on the boundary's lower-left corner as big as
// the boundary's larger side, the boundary given in that square's unit pixel space from -0.5 to
// 0.5 with Y down and the first vertex repeated at the end: what AutoCAD 2018 writes (the
// acadsharp sample_AC1032 wipeout) and ezdxf's `Wipeout.set_masking_area` reads.
import { flatten } from '../geom/flatten';
import type { BoundedCurve } from '../geom/curves';
import type { Vec2 } from '../geom/types';
import { distance, lerp } from '../geom/vec';
import type { DocumentModel } from '../model/document';
import type {
  Entity,
  EntityGeometry,
  ImageGeometry,
  LwPolylineGeometry,
  PolylineVertex,
} from '../model/types';

/** tan(θ/4) of AutoCAD's revision cloud arcs (θ ≈ 110°). */
export const REVCLOUD_BULGE = 0.520567050552;

/** The application AutoCAD files revision cloud xdata under. */
export const REVCLOUD_APP = 'RevcloudProps';

/** The most arcs one cloud may have: more means the arc length is far too small for it. */
export const REVCLOUD_MAX_ARCS = 10_000;

export interface CloudStyle {
  /** The arcs' chord lengths vary between these (equal for uniform arcs). */
  readonly minArc: number;
  readonly maxArc: number;
  readonly calligraphy: boolean;
}

/** A deterministic sequence in [0, 1) (mulberry32), so clouds are reproducible. */
export function cloudRandom(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The chords a run of `length` is cut into: about one per mean arc length, each between the
 * minimum and maximum where a whole number of them can be, and adding up to the run exactly.
 */
export function chordLengths(length: number, s: CloudStyle, next: () => number): number[] {
  if (!(length > 0)) return [];
  const { minArc: min, maxArc: max } = s;
  let n = Math.max(1, Math.round(length / ((min + max) / 2)));
  const lo = Math.max(1, Math.ceil(length / max - 1e-9));
  const hi = Math.floor(length / min + 1e-9);
  const fits = lo <= hi;
  if (fits) n = Math.min(Math.max(n, lo), hi);
  if (!fits || !(max > min)) return Array.from({ length: n }, () => length / n);
  const w = Array.from({ length: n }, () => min + (max - min) * next());
  const sum = w.reduce((a, b) => a + b, 0);
  // Pulled towards the minimum or the maximum until they add up, so each stays between them.
  if (sum > length) {
    const k = (length - n * min) / (sum - n * min);
    return w.map((x) => min + (x - min) * k);
  }
  const k = (n * max - length) / (n * max - sum);
  return w.map((x) => max - (max - x) * k);
}

/** How many arcs a cloud along these runs would have. */
export function cloudArcCount(runs: readonly (readonly Vec2[])[], s: CloudStyle): number {
  const mean = (s.minArc + s.maxArc) / 2;
  return runs.reduce((n, r) => n + Math.max(1, Math.round(runLength(r) / mean)), 0);
}

const runLength = (r: readonly Vec2[]): number => {
  let l = 0;
  for (let i = 1; i < r.length; i++) l += distance(r[i - 1]!, r[i]!);
  return l;
};

/** Twice the signed area of a closed polygon: > 0 counter-clockwise. */
export function signedArea2(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

/**
 * The cloud's vertices along `runs`: polylines that follow one another, the corners where they
 * meet kept as vertices. Each run is cut into chords on its own (`chordLengths`), measured
 * along the run. A closed cloud's last run ends where the first begins.
 */
export function cloudPoints(
  runs: readonly (readonly Vec2[])[],
  closed: boolean,
  s: CloudStyle,
  next: () => number = cloudRandom(),
): Vec2[] {
  const out: Vec2[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    out.push(run[0]!);
    const chords = chordLengths(runLength(run), s, next);
    let i = 1;
    let walked = 0; // along the run up to run[i - 1]
    let at = 0;
    for (const c of chords.slice(0, -1)) {
      at += c;
      while (i < run.length - 1 && walked + distance(run[i - 1]!, run[i]!) < at) {
        walked += distance(run[i - 1]!, run[i]!);
        i++;
      }
      const seg = distance(run[i - 1]!, run[i]!);
      out.push(lerp(run[i - 1]!, run[i]!, seg > 0 ? Math.min(1, (at - walked) / seg) : 0));
    }
  }
  if (!closed && runs.length > 0) {
    const last = runs.at(-1)!;
    if (last.length >= 2) out.push(last.at(-1)!);
  }
  return out;
}

/**
 * The LWPOLYLINE of a cloud through `points`: every segment an arc of `REVCLOUD_BULGE`, on the
 * outside of the area they enclose unless `reverse` (an open cloud as though closed).
 */
export function cloudPolyline(
  points: readonly Vec2[],
  closed: boolean,
  s: CloudStyle,
  reverse = false,
): LwPolylineGeometry {
  const outward = signedArea2(points) >= 0 ? REVCLOUD_BULGE : -REVCLOUD_BULGE;
  const bulge = reverse ? -outward : outward;
  const width = s.calligraphy ? ((s.minArc + s.maxArc) / 2) * 0.1 : 0;
  const vertices: PolylineVertex[] = points.map((p, i) => {
    const last = !closed && i === points.length - 1;
    return {
      x: p.x,
      y: p.y,
      bulge: last ? 0 : bulge,
      ...(s.calligraphy && !last && { startWidth: 0, endWidth: width }),
    };
  });
  return { kind: 'LWPOLYLINE', closed, vertices };
}

/** A closed polygon's sides as runs (rectangles, polygons): each side cut on its own. */
export function polygonRuns(corners: readonly Vec2[]): Vec2[][] {
  return corners.map((p, i) => [p, corners[(i + 1) % corners.length]!]);
}

/** A rectangle's corners from two opposite ones, counter-clockwise from the first. */
export function rectangleCorners(a: Vec2, b: Vec2): Vec2[] {
  const ccw = (b.x - a.x) * (b.y - a.y) >= 0;
  const c1 = { x: b.x, y: a.y };
  const c2 = { x: a.x, y: b.y };
  return ccw ? [a, c1, b, c2] : [a, c2, b, c1];
}

/**
 * An object REVCLOUD's Object option converts, as runs (a polyline's segments each on its own,
 * so its corners stay corners) and whether it is closed; undefined for any other object.
 * AutoCAD converts circles, ellipses, polylines and splines.
 */
export function cloudRunsOf(
  g: EntityGeometry,
  deviation: number,
): { runs: Vec2[][]; closed: boolean } | undefined {
  switch (g.kind) {
    case 'CIRCLE':
    case 'SPLINE':
      return { runs: [flatten(g, deviation).points], closed: g.kind === 'CIRCLE' || g.closed };
    case 'ELLIPSE': {
      const full = Math.abs(g.endParam - g.startParam - 2 * Math.PI) < 1e-9;
      return { runs: [flatten(g, deviation).points], closed: full };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (g.vertices.length < 2) return undefined;
      const curve: BoundedCurve = { kind: 'LWPOLYLINE', vertices: g.vertices, closed: g.closed };
      return { runs: segmentRuns(curve, deviation), closed: g.closed };
    }
    default:
      return undefined;
  }
}

/** A polyline flattened and cut at its vertices: one run per segment. */
function segmentRuns(p: BoundedCurve, deviation: number): Vec2[][] {
  const f = flatten(p, deviation);
  const runs: Vec2[][] = [];
  let run: Vec2[] = [f.points[0]!];
  for (let i = 1; i < f.points.length; i++) {
    run.push(f.points[i]!);
    if (Number.isInteger(f.params[i]!) || i === f.points.length - 1) {
      if (run.length >= 2 && runLength(run) > 0) runs.push(run);
      run = [f.points[i]!];
    }
  }
  return runs;
}

/** A boundary's vertices with consecutive duplicates (and a repeated first vertex) dropped. */
export function distinctVertices(points: readonly Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || distance(out.at(-1)!, p) > tol) out.push(p);
  while (out.length > 1 && distance(out[0]!, out.at(-1)!) <= tol) out.pop();
  return out;
}

/** A WIPEOUT masking the polygon `points` (three or more, not closed by repeating the first). */
export function wipeoutGeometry(points: readonly Vec2[]): ImageGeometry {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const side = Math.max(Math.max(...xs) - min.x, Math.max(...ys) - min.y);
  const pixel = (p: Vec2): Vec2 => ({
    x: (p.x - min.x) / side - 0.5,
    y: 0.5 - (p.y - min.y) / side,
  });
  const ring = [...points, points[0]!].map(pixel);
  return {
    kind: 'WIPEOUT',
    position: min,
    u: { x: side, y: 0 },
    v: { x: 0, y: side },
    size: { x: 1, y: 1 },
    // Show, show unaligned, clip: AutoCAD's 7.
    displayFlags: 7,
    clipping: true,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: { type: 'polygon', vertices: ring, inverted: false },
  };
}

// ── Editing a cloud (M2-24) ─────────────────────────────────────────────────────────────────
//
// REVCLOUD's Modify option and the cloud's grips (REVCLOUDGRIPS on, AutoCAD's default) change
// part of a cloud and keep the rest: the vertices of the part kept stay where they are, the new
// part is cut into arcs of the cloud's own arc length, and every arc then bulges the way the
// cloud's arcs did (out of the area for a Normal cloud, in for a reversed one).

/** What editing a cloud needs to know of it. */
export interface CloudInfo {
  /** The arc length new arcs are cut to: the RevcloudProps 1040, else the mean chord. */
  readonly arc: number;
}

/** Whether every segment of the polyline is an arc (the last vertex of an open one aside). */
export function isCloudShaped(g: EntityGeometry): g is LwPolylineGeometry {
  if (g.kind !== 'LWPOLYLINE' || g.vertices.length < 2) return false;
  const n = g.closed ? g.vertices.length : g.vertices.length - 1;
  return g.vertices.slice(0, n).every((v) => v.bulge !== 0);
}

const meanChord = (g: LwPolylineGeometry): number => {
  const v = g.vertices;
  const n = g.closed ? v.length : v.length - 1;
  let l = 0;
  for (let i = 0; i < n; i++) l += distance(v[i]!, v[(i + 1) % v.length]!);
  return l / n;
};

/** The arc length a `RevcloudProps` xdata gives, if it has one. */
function xdataArc(e: Entity, model: DocumentModel): number | undefined {
  for (const app of e.xdata ?? []) {
    const name = model.tables.appIds.get(app.appId)?.name;
    if (name?.toUpperCase() !== REVCLOUD_APP.toUpperCase()) continue;
    const arc = app.values.find((x) => x.code === 1040)?.value;
    if (typeof arc === 'number' && arc > 0) return arc;
  }
  return undefined;
}

/** A polyline AutoCAD 2021+ knows as a revision cloud (its RevcloudProps xdata), else none. */
export function revcloudOf(model: DocumentModel, e: Entity): CloudInfo | undefined {
  if (!isCloudShaped(e.geom)) return undefined;
  const arc = xdataArc(e, model);
  return arc === undefined ? undefined : { arc };
}

/** A cloud-shaped polyline's arc length: its xdata's when it has one, else its mean chord. */
export function cloudArcLength(model: DocumentModel, e: Entity & { geom: LwPolylineGeometry }) {
  return xdataArc(e, model) ?? meanChord(e.geom);
}

/** +1 when the cloud's arcs bulge out of the area it encloses (Normal), −1 when in. */
function cloudSense(g: LwPolylineGeometry): number {
  const b = g.vertices.find((v) => v.bulge !== 0)?.bulge ?? REVCLOUD_BULGE;
  return Math.sign(b) === (signedArea2(g.vertices) >= 0 ? 1 : -1) ? 1 : -1;
}

/**
 * `vertices` as a cloud bulging as `sense` says (+1 out, −1 in): each arc keeps its own size,
 * new vertices (bulge 0) take AutoCAD's; the last vertex of an open cloud has none.
 */
function rebulge(
  vertices: readonly PolylineVertex[],
  closed: boolean,
  sense: number,
): LwPolylineGeometry {
  const sign = sense * (signedArea2(vertices) >= 0 ? 1 : -1);
  const out = vertices.map((v, i) => {
    if (!closed && i === vertices.length - 1) {
      const { startWidth: _s, endWidth: _e, ...rest } = v;
      return { ...rest, bulge: 0 };
    }
    return { ...v, bulge: sign * (v.bulge !== 0 ? Math.abs(v.bulge) : REVCLOUD_BULGE) };
  });
  return { kind: 'LWPOLYLINE', closed, vertices: out };
}

/** New vertices at `points`, as wide as the cloud's calligraphy arcs when it has them. */
function newVertices(g: LwPolylineGeometry, points: readonly Vec2[]): PolylineVertex[] {
  const width = Math.max(0, ...g.vertices.map((v) => v.endWidth ?? 0));
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    bulge: 0,
    ...(width > 0 && { startWidth: 0, endWidth: width }),
  }));
}

/** The vertices strictly between the ends of a cloud run through `path` (straight sides). */
function between(path: readonly Vec2[], arc: number): Vec2[] {
  const runs = path.slice(1).map((p, i) => [path[i]!, p]);
  return cloudPoints(runs, false, { minArc: arc, maxArc: arc, calligraphy: false }).slice(1, -1);
}

/** Vertex indices from `from` to `to` going forward, both included (round a closed cloud). */
function forward(n: number, from: number, to: number): number[] {
  const out = [from];
  for (let i = from; i !== to;) {
    i = (i + 1) % n;
    out.push(i);
  }
  return out;
}

/**
 * The cloud's corners, as REVCLOUDGRIPS shows them: the vertices where its chords turn (a
 * rectangular or polygonal cloud's corners), and an open cloud's ends. AutoCAD's help says
 * only that a cloud shows "the minimal number of grips required"; Triya reads the corners from
 * the chords, which REVCLOUD lays straight along each side, so a curved cloud (from a circle,
 * an ellipse, freehand) keeps a grip at every vertex.
 */
export function cloudCorners(g: LwPolylineGeometry): number[] {
  const v = g.vertices;
  const n = v.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!g.closed && (i === 0 || i === n - 1)) {
      out.push(i);
      continue;
    }
    const a = v[(i - 1 + n) % n]!;
    const b = v[i]!;
    const c = v[(i + 1) % n]!;
    const d1 = { x: b.x - a.x, y: b.y - a.y };
    const d2 = { x: c.x - b.x, y: c.y - b.y };
    const l = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y);
    const cross = d1.x * d2.y - d1.y * d2.x;
    const dot = d1.x * d2.x + d1.y * d2.y;
    if (!(l > 0) || Math.abs(cross) > 1e-9 * l || dot < 0) out.push(i);
  }
  return out;
}

/**
 * The cloud with its corner `index` dragged to `to`: the sides from the corners on either side
 * cut into arcs afresh, every other vertex kept.
 */
export function moveCloudCorner(
  g: LwPolylineGeometry,
  index: number,
  to: Vec2,
  arc: number,
): LwPolylineGeometry {
  const v = g.vertices;
  const n = v.length;
  const corners = cloudCorners(g);
  const k = corners.indexOf(index);
  const sense = cloudSense(g);
  const at = (i: number) => v[i]!;
  if (g.closed) {
    if (corners.length < 2) {
      return rebulge(newVertices(g, [to]), true, sense);
    }
    const prev = corners[(k - 1 + corners.length) % corners.length]!;
    const next = corners[(k + 1) % corners.length]!;
    const kept = forward(n, next, prev).map(at);
    const fresh = newVertices(g, [
      ...between([at(prev), to], arc),
      to,
      ...between([to, at(next)], arc),
    ]);
    return rebulge([...kept, ...fresh], true, sense);
  }
  const before = k > 0 ? corners[k - 1]! : undefined;
  const after = k < corners.length - 1 ? corners[k + 1]! : undefined;
  const head = before === undefined ? [] : v.slice(0, before + 1);
  const tail = after === undefined ? [] : v.slice(after);
  const fresh = newVertices(g, [
    ...(before === undefined ? [] : between([at(before), to], arc)),
    to,
    ...(after === undefined ? [] : between([to, at(after)], arc)),
  ]);
  return rebulge([...head, ...fresh, ...tail], false, sense);
}

/** The distance from `p` to the chain of chords through `points` (Infinity when none). */
function chainDistance(p: Vec2, points: readonly Vec2[]): number {
  let best = points.length === 1 ? distance(p, points[0]!) : Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const l2 = d.x * d.x + d.y * d.y;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2)) : 0;
    best = Math.min(best, distance(p, { x: a.x + t * d.x, y: a.y + t * d.y }));
  }
  return best;
}

/**
 * REVCLOUD Modify: the cloud with a new stretch from vertex `start` through `points` to vertex
 * `end`, the part of the cloud between them that lies nearer `side` erased. A closed cloud has
 * two parts between the vertices; an open one the part between them and the parts outside
 * them (erasing those closes the cloud: the part kept and the new stretch go round). AutoCAD's
 * help describes only the closed case ("Pick a side to erase").
 */
export function modifyCloud(
  g: LwPolylineGeometry,
  start: number,
  points: readonly Vec2[],
  end: number,
  side: Vec2,
  arc: number,
): LwPolylineGeometry {
  const v = g.vertices;
  const n = v.length;
  const sense = cloudSense(g);
  const at = (i: number) => v[i]!;
  if (g.closed) {
    const ahead = forward(n, start, end).map(at); // erased when picked: start → end
    const behind = forward(n, end, start).map(at);
    const path = [at(start), ...points, at(end)];
    if (chainDistance(side, ahead) <= chainDistance(side, behind)) {
      // Kept: end → start; the stretch goes on from start to end.
      const fresh = newVertices(g, stretch(path, arc));
      return rebulge([...behind, ...fresh], true, sense);
    }
    const fresh = newVertices(g, stretch([...path].reverse(), arc));
    return rebulge([...ahead, ...fresh], true, sense);
  }
  const [a, b, path] =
    start < end
      ? [start, end, [at(start), ...points, at(end)]]
      : [end, start, [at(start), ...points, at(end)].reverse()];
  const inside = v.slice(a, b + 1);
  const outside = Math.min(
    a > 0 ? chainDistance(side, v.slice(0, a + 1)) : Infinity,
    b < n - 1 ? chainDistance(side, v.slice(b)) : Infinity,
  );
  if (chainDistance(side, inside) <= outside) {
    const fresh = newVertices(g, stretch(path, arc));
    return rebulge([...v.slice(0, a + 1), ...fresh, ...v.slice(b)], false, sense);
  }
  const fresh = newVertices(g, stretch([...path].reverse(), arc));
  return rebulge([...inside, ...fresh], true, sense);
}

/** A stretch's own vertices: its corners and its arcs' ends, without its two ends. */
function stretch(path: readonly Vec2[], arc: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < path.length; i++) {
    out.push(...between([path[i - 1]!, path[i]!], arc));
    if (i < path.length - 1) out.push(path[i]!);
  }
  return out;
}
