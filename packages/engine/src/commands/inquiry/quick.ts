// MEASUREGEOM's Quick mode (M3-07 part 2; AutoCAD 2024 Help, "MEASUREGEOM (Command)", Quick):
// "Displays dimensions, distances, and angles within a drawing dynamically as you move your
// mouse over and between objects", and "clicking within a space enclosed by geometric objects
// highlights it in green and displays the calculated values", Shift-click adding (or taking
// away) more spaces, "the perimeters of enclosed islands … also included".
//
// The help shows pictures, not rules; what Triya measures, as a drafter reads those pictures:
// - Across the cursor: the horizontal and the vertical distance between the nearest objects on
//   either side of it (each where both sides have one), measured along the line through the
//   cursor.
// - Over an object (within the aperture): a line's (or a polyline segment's) length, and at each
//   of its ends the angle to every line or arc ending there, an angle of exactly 90° marked by a
//   square; an arc's or a circle's radius, from its centre towards the cursor.
// - A click: the smallest space enclosed by the objects that holds the point, less the islands
//   inside it (closed outlines inside it that do not touch it, nested islands' own spaces not
//   counted twice); its area, and its perimeter with the islands'. Lines that end in the open
//   (dangling) bound nothing. Gaps are not bridged (HPGAPTOL 0, AutoCAD's default).
// "Objects that aren't measured include annotations such as dimensions and hatches", and text.
// Only the objects shown in the view take part (the help: "within a drawing … in a plan view").
import { integrate } from '../../geom/arclength';
import type { Box } from '../../geom/bounds';
import { curveBounds, boxesOverlap } from '../../geom/bounds';
import { closestPoint } from '../../geom/closest';
import type { BoundedCurve, Curve } from '../../geom/curves';
import { derivativeAt, domain, pointAt } from '../../geom/eval';
import { flatten } from '../../geom/flatten';
import { intersect } from '../../geom/intersect';
import type { Vec2 } from '../../geom/types';
import { add, angleOf, cross, distance, dot, length, normalize, scale, sub } from '../../geom/vec';
import { curvesIn, type OsnapSource } from '../../input/osnap';
import type { EntityId } from '../../model/entity-ids';
import { drawingUnits, formatAngle, formatDistance } from '../units';

/** What the cursor is over, in the coordinates of the space shown. */
export interface QuickQuery {
  readonly point: Vec2;
  /** The aperture, in drawing units: what counts as over an object. */
  readonly aperture: number;
  /** The view: what is shown, and so measured. */
  readonly view: Box;
}

/** A distance drawn as a dimension line from `from` to `to`, with its value. */
export interface QuickSpan {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly text: string;
}

/** The angle at `vertex` from direction `start` counter-clockwise by `sweep` (radians). */
export interface QuickAngle {
  readonly vertex: Vec2;
  readonly start: number;
  readonly sweep: number;
  readonly text: string;
  /** Exactly 90°: drawn as a square. */
  readonly right: boolean;
}

export interface QuickMeasure {
  readonly spans: readonly QuickSpan[];
  readonly angles: readonly QuickAngle[];
}

/** Annotations, which Quick does not measure (dimensions' blocks included). */
const NOT_MEASURED = new Set([
  'DIMENSION',
  'ARC_DIMENSION',
  'LARGE_RADIAL_DIMENSION',
  'LEADER',
  'MULTILEADER',
  'TOLERANCE',
  'HATCH',
  'TEXT',
  'MTEXT',
  'ATTDEF',
  'ACAD_TABLE',
]);

function measured(src: OsnapSource, point: Vec2, box: Box): { id: EntityId; curve: Curve }[] {
  return curvesIn(src, point, box).filter((c) => {
    const kind = src.model.entity(c.id)?.geom.kind;
    return kind === undefined || !NOT_MEASURED.has(kind);
  });
}

const around = (p: Vec2, r: number): Box => ({
  minX: p.x - r,
  minY: p.y - r,
  maxX: p.x + r,
  maxY: p.y + r,
});

/** What Quick shows with the cursor at `q.point`. */
export function quickMeasure(src: OsnapSource, q: QuickQuery): QuickMeasure {
  const u = drawingUnits(src.model.header);
  const d = (v: number) => formatDistance(v, u);
  const spans: QuickSpan[] = [];
  const angles: QuickAngle[] = [];
  const p = q.point;
  const tol = src.tol.linear;

  // Across the cursor, horizontally and vertically.
  const thin = Math.max(q.aperture * 1e-3, tol);
  for (const dir of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]) {
    const strip: Box =
      dir.x !== 0
        ? { minX: q.view.minX, maxX: q.view.maxX, minY: p.y - thin, maxY: p.y + thin }
        : { minX: p.x - thin, maxX: p.x + thin, minY: q.view.minY, maxY: q.view.maxY };
    let before = -Infinity;
    let after = Infinity;
    for (const c of measured(src, p, strip)) {
      for (const hit of intersect({ kind: 'XLINE', base: p, direction: dir }, c.curve, src.tol)) {
        const t = dot(sub(hit.point, p), dir);
        if (t < -tol && t > before) before = t;
        if (t > tol && t < after) after = t;
      }
    }
    if (Number.isFinite(before) && Number.isFinite(after)) {
      spans.push({
        from: add(p, scale(dir, before)),
        to: add(p, scale(dir, after)),
        text: d(after - before),
      });
    }
  }

  // The object under the cursor.
  let over: { curve: Curve; at: Vec2 } | undefined;
  let best = q.aperture;
  for (const c of measured(src, p, around(p, q.aperture))) {
    const cp = closestPoint(c.curve, p, src.tol);
    if (cp.distance <= best) {
      best = cp.distance;
      over = { curve: c.curve, at: cp.point };
    }
  }
  if (over?.curve.kind === 'LINE') {
    const line = over.curve;
    // A distance across the cursor along the line itself is its length: shown once.
    const near = (a: Vec2, b: Vec2) => distance(a, b) <= q.aperture;
    const along = (s: QuickSpan) =>
      (near(s.from, line.start) && near(s.to, line.end)) ||
      (near(s.from, line.end) && near(s.to, line.start));
    for (let i = spans.length - 1; i >= 0; i--) if (along(spans[i]!)) spans.splice(i, 1);
    spans.push({ from: line.start, to: line.end, text: d(distance(line.start, line.end)) });
    for (const [end, other] of [
      [line.start, line.end],
      [line.end, line.start],
    ] as const) {
      angles.push(...anglesAt(src, end, sub(other, end), q.aperture, u));
    }
  } else if (over && (over.curve.kind === 'ARC' || over.curve.kind === 'CIRCLE')) {
    const c = over.curve;
    const toward = distance(p, c.center) > tol ? normalize(sub(p, c.center)) : { x: 1, y: 0 };
    const on = c.kind === 'ARC' ? over.at : add(c.center, scale(toward, c.radius));
    spans.push({ from: c.center, to: on, text: `R${d(c.radius)}` });
  }
  return { spans, angles };
}

/**
 * The angles at `vertex` between a line leaving it along `away` and each line or arc ending
 * there (the smaller side, 0 to 180°); none for one carrying straight on.
 */
function anglesAt(
  src: OsnapSource,
  vertex: Vec2,
  away: Vec2,
  aperture: number,
  u: ReturnType<typeof drawingUnits>,
): QuickAngle[] {
  const tol = src.tol;
  const near = Math.max(tol.linear * 1e3, aperture * 1e-6);
  const out: QuickAngle[] = [];
  for (const c of measured(src, vertex, around(vertex, near))) {
    const dir = leaving(c.curve, vertex, near);
    if (!dir) continue;
    const turn = Math.atan2(cross(away, dir), dot(away, dir));
    const sweep = Math.abs(turn);
    // The line itself (or one lying on it), and one going straight on, make no angle.
    if (sweep <= tol.angular * 1e3 || Math.PI - sweep <= tol.angular * 1e3) continue;
    const text = formatAngle(sweep, u);
    out.push({
      vertex,
      start: turn >= 0 ? angleOf(away) : angleOf(dir),
      sweep,
      text: u.aunits === 0 ? `${text}°` : text,
      right: Math.abs(sweep - Math.PI / 2) <= 1e-9,
    });
  }
  return out;
}

/** The direction a line or arc leaves `vertex` in, when it ends there. */
function leaving(c: Curve, vertex: Vec2, near: number): Vec2 | undefined {
  if (c.kind === 'LINE') {
    if (distance(c.start, vertex) <= near) return sub(c.end, c.start);
    if (distance(c.end, vertex) <= near) return sub(c.start, c.end);
    return undefined;
  }
  if (c.kind === 'ARC') {
    const dm = domain(c);
    if (distance(pointAt(c, dm.start), vertex) <= near) return derivativeAt(c, dm.start);
    if (distance(pointAt(c, dm.end), vertex) <= near) return scale(derivativeAt(c, dm.end), -1);
  }
  return undefined;
}

// --- Enclosed spaces -------------------------------------------------------------------------

/** A space a click measured: its area and perimeter, and its outline and islands to fill. */
export interface EnclosedSpace {
  readonly area: number;
  readonly perimeter: number;
  /** The outline, then each island's, as polygons (filled even-odd). */
  readonly loops: readonly (readonly Vec2[])[];
}

/** A stretch of a curve between two parameters, from one node to another. */
interface Edge {
  readonly curve: BoundedCurve;
  readonly t0: number;
  readonly t1: number;
  from: number;
  to: number;
  removed: boolean;
}

/** An edge walked one way: `forward` from `t0` to `t1`. */
interface HalfEdge {
  readonly edge: Edge;
  readonly forward: boolean;
  /** Its direction where it leaves its node, for ordering the edges around the node. */
  readonly angle: number;
  /** A little further along, where two edges leave in one direction (a line and a tangent arc). */
  readonly bend: number;
}

/** The most objects a click looks at; past it, the view is too full to measure (none found). */
const MAX_CURVES = 5000;

/** The space enclosed around `point` by the objects shown in `view`; undefined where none. */
export function enclosedSpace(src: OsnapSource, point: Vec2, view: Box): EnclosedSpace | undefined {
  const curves = measured(src, point, view)
    .map((c) => c.curve)
    .filter((c): c is BoundedCurve => c.kind !== 'XLINE' && c.kind !== 'RAY');
  if (curves.length === 0 || curves.length > MAX_CURVES) return undefined;
  const size = Math.max(view.maxX - view.minX, view.maxY - view.minY, 1);
  const merge = Math.max(src.tol.linear * 100, size * 1e-9);
  const edges = splitAtCrossings(curves, src, merge);
  const nodes = nodeEdges(edges, merge);
  dropDuplicates(edges, merge);
  prune(edges, nodes.length);
  const halves = halfEdges(edges, nodes.length);
  const faces = traceFaces(halves);
  const dev = size * 1e-4;

  // The smallest bounded face around the point.
  let chosen: Face | undefined;
  for (const f of faces) {
    if (f.area <= 0 || (chosen && f.area >= chosen.area)) continue;
    if (inside(outline(f, dev), point)) chosen = f;
  }
  if (!chosen) return undefined;
  const outer = outline(chosen, dev);

  // Islands: the other connected parts inside it, and not inside another such part.
  const component = components(edges, nodes.length);
  const own = component(chosen.halves[0]!.edge.from);
  const parts = new Map<number, Face>();
  for (const f of faces) {
    if (f.area >= 0) continue;
    const c = component(f.halves[0]!.edge.from);
    if (c === own) continue;
    // A part's outside face is its one face of negative area.
    const before = parts.get(c);
    if (!before || f.area < before.area) parts.set(c, f);
  }
  const candidates = [...parts.values()].filter((f) =>
    inside(outer, nodes[f.halves[0]!.edge.from]!),
  );
  const rings = candidates.map((f) => outline(f, dev));
  const islands = candidates.filter((f, i) => {
    const at = nodes[f.halves[0]!.edge.from]!;
    return !rings.some(
      (r, j) => j !== i && Math.abs(candidates[j]!.area) > Math.abs(f.area) && inside(r, at),
    );
  });
  return {
    area: chosen.area - islands.reduce((s, f) => s - f.area, 0),
    perimeter: chosen.perimeter + islands.reduce((s, f) => s + f.perimeter, 0),
    loops: [outer, ...islands.map((f) => outline(f, dev))],
  };
}

/** Every curve cut where it crosses or touches another, into edges between those points. */
function splitAtCrossings(
  curves: readonly BoundedCurve[],
  src: OsnapSource,
  merge: number,
): Edge[] {
  const cuts = curves.map((c) => {
    const dm = domain(c);
    return [dm.start, dm.end];
  });
  const boxes = curves.map((c) => curveBounds(c, src.tol));
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      if (!boxesOverlap(boxes[i]!, boxes[j]!, merge)) continue;
      for (const hit of intersect(curves[i]!, curves[j]!, src.tol)) {
        cuts[i]!.push(hit.ta);
        cuts[j]!.push(hit.tb);
      }
      // Where one ends on the other: lines lying on each other (a polyline drawn over a
      // line) cross nowhere, but each is cut where the other ends.
      for (const [a, b] of [
        [i, j],
        [j, i],
      ] as const) {
        const dm = domain(curves[a]!);
        for (const t of [dm.start, dm.end]) {
          const on = closestPoint(curves[b]!, pointAt(curves[a]!, t), src.tol);
          if (on.distance <= merge) cuts[b]!.push(on.t);
        }
      }
    }
  }
  const edges: Edge[] = [];
  curves.forEach((c, i) => {
    const dm = domain(c);
    const closed = distance(pointAt(c, dm.start), pointAt(c, dm.end)) <= merge;
    const ts = cuts[i]!.filter((t) => t >= dm.start && t <= dm.end).sort((a, b) => a - b);
    // Cuts at one point are one cut; the domain's ends stay (a closed curve's both do).
    const keep = [ts[0]!];
    for (const t of ts.slice(1)) {
      const last = keep.at(-1)!;
      const whole = closed && last === dm.start && t === dm.end;
      if (!whole && distance(pointAt(c, last), pointAt(c, t)) <= merge) {
        if (t === dm.end && keep.length > 1) keep[keep.length - 1] = t;
        continue;
      }
      keep.push(t);
    }
    for (let k = 1; k < keep.length; k++) {
      edges.push({ curve: c, t0: keep[k - 1]!, t1: keep[k]!, from: -1, to: -1, removed: false });
    }
  });
  return edges;
}

/** Gives each edge's ends a node, ends within `merge` of each other sharing one. */
function nodeEdges(edges: Edge[], merge: number): Vec2[] {
  const nodes: Vec2[] = [];
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / (merge * 4));
  const nodeAt = (p: Vec2): number => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (distance(nodes[n]!, p) <= merge) return n;
        }
      }
    }
    nodes.push(p);
    const key = `${cx},${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1]);
    return nodes.length - 1;
  };
  for (const e of edges) {
    e.from = nodeAt(pointAt(e.curve, e.t0));
    e.to = nodeAt(pointAt(e.curve, e.t1));
  }
  return nodes;
}

/** Keeps one of the edges lying on each other between the same two nodes. */
function dropDuplicates(edges: Edge[], merge: number): void {
  const byNodes = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = e.from < e.to ? `${e.from},${e.to}` : `${e.to},${e.from}`;
    const same = byNodes.get(key) ?? [];
    const mid = pointAt(e.curve, (e.t0 + e.t1) / 2);
    if (same.some((o) => distance(pointAt(o.curve, (o.t0 + o.t1) / 2), mid) <= merge)) {
      e.removed = true;
      continue;
    }
    same.push(e);
    byNodes.set(key, same);
  }
}

/** Takes away edges that end in the open, again and again: they bound nothing. */
function prune(edges: Edge[], count: number): void {
  const degree = new Array<number>(count).fill(0);
  for (const e of edges) {
    if (e.removed) continue;
    degree[e.from]!++;
    degree[e.to]!++;
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) {
      if (e.removed || (degree[e.from]! > 1 && degree[e.to]! > 1)) continue;
      e.removed = true;
      degree[e.from]!--;
      degree[e.to]!--;
      changed = true;
    }
  }
}

/** Each node's half-edges leaving it, counter-clockwise. */
function halfEdges(edges: readonly Edge[], count: number): HalfEdge[][] {
  const out: HalfEdge[][] = Array.from({ length: count }, () => []);
  for (const edge of edges) {
    if (edge.removed) continue;
    for (const forward of [true, false]) {
      const t = forward ? edge.t0 : edge.t1;
      const sign = forward ? 1 : -1;
      const tangent = scale(derivativeAt(edge.curve, t), sign);
      const start = pointAt(edge.curve, t);
      const further = pointAt(edge.curve, t + sign * (edge.t1 - edge.t0) * 1e-3);
      const angle = length(tangent) > 0 ? angleOf(tangent) : angleOf(sub(further, start));
      const bend = Math.atan2(
        cross(tangent, sub(further, start)),
        dot(tangent, sub(further, start)),
      );
      out[forward ? edge.from : edge.to]!.push({ edge, forward, angle: norm(angle), bend });
    }
  }
  for (const list of out) {
    list.sort((a, b) => (Math.abs(a.angle - b.angle) > 1e-9 ? a.angle - b.angle : a.bend - b.bend));
  }
  return out;
}

const norm = (a: number): number => {
  const t = 2 * Math.PI;
  const r = a % t;
  return r < 0 ? r + t : r;
};

interface Face {
  readonly halves: readonly HalfEdge[];
  /** Signed: positive for a face walked counter-clockwise (bounded), negative for outside. */
  readonly area: number;
  readonly perimeter: number;
}

/** The faces the edges divide the plane into, each walked with it on the left. */
function traceFaces(around: readonly HalfEdge[][]): Face[] {
  const seen = new Set<HalfEdge>();
  const faces: Face[] = [];
  const endNode = (h: HalfEdge) => (h.forward ? h.edge.to : h.edge.from);
  const twin = (h: HalfEdge): HalfEdge =>
    around[endNode(h)]!.find((o) => o.edge === h.edge && o.forward !== h.forward)!;
  for (const list of around) {
    for (const first of list) {
      if (seen.has(first)) continue;
      const halves: HalfEdge[] = [];
      let h = first;
      while (!seen.has(h)) {
        seen.add(h);
        halves.push(h);
        // Next: the edge leaving h's end just clockwise of the way back.
        const at = around[endNode(h)]!;
        const back = at.indexOf(twin(h));
        h = at[(back - 1 + at.length) % at.length]!;
      }
      let area = 0;
      let perimeter = 0;
      for (const half of halves) {
        const { curve, t0, t1 } = half.edge;
        const sign = half.forward ? 1 : -1;
        area +=
          (sign / 2) *
          integrate(
            (t) => {
              const p = pointAt(curve, t);
              const dv = derivativeAt(curve, t);
              return p.x * dv.y - p.y * dv.x;
            },
            t0,
            t1,
            curve.kind === 'LINE' ? 1 : 4,
          );
        perimeter += integrate(
          (t) => length(derivativeAt(curve, t)),
          t0,
          t1,
          curve.kind === 'LINE' ? 1 : 4,
        );
      }
      faces.push({ halves, area, perimeter });
    }
  }
  return faces;
}

/** A face's outline as a polygon, arcs and curves within `dev`. */
function outline(f: Face, dev: number): Vec2[] {
  const out: Vec2[] = [];
  for (const h of f.halves) {
    const { curve, t0, t1 } = h.edge;
    let pts: Vec2[];
    if (curve.kind === 'LINE') pts = [pointAt(curve, t0), pointAt(curve, t1)];
    else {
      const flat = flatten(curve, dev);
      pts = [
        pointAt(curve, t0),
        ...flat.points.filter((_, i) => flat.params[i]! > t0 && flat.params[i]! < t1),
        pointAt(curve, t1),
      ];
    }
    if (!h.forward) pts.reverse();
    out.push(...pts.slice(0, -1));
  }
  return out;
}

/** Whether `p` is inside the polygon `ring` (non-zero winding). */
function inside(ring: readonly Vec2[], p: Vec2): boolean {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y <= p.y) {
      if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) winding++;
    } else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) winding--;
  }
  return winding !== 0;
}

/** Which connected part of the edges each node is in. */
function components(edges: readonly Edge[], count: number): (node: number) => number {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (n: number): number => {
    while (parent[n] !== n) n = parent[n] = parent[parent[n]!]!;
    return n;
  };
  for (const e of edges) if (!e.removed) parent[find(e.from)] = find(e.to);
  return find;
}
