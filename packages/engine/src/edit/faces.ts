// The faces a set of curves divides the plane into (M3-07 part 2's MEASUREGEOM Quick spaces,
// moved here for HATCH's pick points, M4-07): every curve is cut where it crosses or touches
// another, ends within `merge` of each other are one node, edges ending in the open are taken
// away again and again (they bound nothing), and each face is walked with it on the left, so a
// bounded face runs counter-clockwise (positive area) and the outside of each connected part
// clockwise (its one face of negative area).
import { integrate } from '../geom/arclength';
import { boxesOverlap, curveBounds } from '../geom/bounds';
import { closestPoint } from '../geom/closest';
import type { BoundedCurve } from '../geom/curves';
import { derivativeAt, domain, pointAt } from '../geom/eval';
import { flatten } from '../geom/flatten';
import { intersect } from '../geom/intersect';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { angleOf, cross, distance, dot, length, scale, sub } from '../geom/vec';

/** The curves' faces, and which connected part each node is in. */
export interface Arrangement {
  readonly nodes: readonly Vec2[];
  readonly edges: readonly Edge[];
  readonly faces: readonly Face[];
  readonly component: (node: number) => number;
}

export function arrangement(
  curves: readonly BoundedCurve[],
  tol: Tolerance,
  merge: number,
): Arrangement {
  const edges = splitAtCrossings(curves, tol, merge);
  const nodes = nodeEdges(edges, merge);
  dropDuplicates(edges, merge);
  prune(edges, nodes.length);
  const faces = traceFaces(halfEdges(edges, nodes.length));
  return { nodes, edges, faces, component: components(edges, nodes.length) };
}

/** The smallest bounded face around `point`, with its outline within `dev`. */
export function faceAround(
  arr: Arrangement,
  point: Vec2,
  dev: number,
): { readonly face: Face; readonly ring: Vec2[] } | undefined {
  let chosen: Face | undefined;
  for (const f of arr.faces) {
    if (f.area <= 0 || (chosen && f.area >= chosen.area)) continue;
    if (insideRing(faceOutline(f, dev), point)) chosen = f;
  }
  return chosen && { face: chosen, ring: faceOutline(chosen, dev) };
}

/** A connected part inside a face: its outside face, and how many other such parts hold it. */
export interface Island {
  readonly face: Face;
  readonly ring: readonly Vec2[];
  /** 0 for a part directly inside the face, 1 for one inside such a part, … */
  readonly depth: number;
}

/** The other connected parts inside `face` (whose outline is `ring`), each by its outside. */
export function islandsIn(
  arr: Arrangement,
  face: Face,
  ring: readonly Vec2[],
  dev: number,
): Island[] {
  const own = arr.component(face.halves[0]!.edge.from);
  const parts = new Map<number, Face>();
  for (const f of arr.faces) {
    if (f.area >= 0) continue;
    const c = arr.component(f.halves[0]!.edge.from);
    if (c === own) continue;
    // A part's outside face is its one face of negative area.
    const before = parts.get(c);
    if (!before || f.area < before.area) parts.set(c, f);
  }
  const startOf = (f: Face) => arr.nodes[f.halves[0]!.edge.from]!;
  const candidates = [...parts.values()].filter((f) => insideRing(ring, startOf(f)));
  const rings = candidates.map((f) => faceOutline(f, dev));
  return candidates.map((f, i) => ({
    face: f,
    ring: rings[i]!,
    depth: rings.filter(
      (r, j) =>
        j !== i && Math.abs(candidates[j]!.area) > Math.abs(f.area) && insideRing(r, startOf(f)),
    ).length,
  }));
}

/** A stretch of a curve between two parameters, from one node to another. */
export interface Edge {
  readonly curve: BoundedCurve;
  readonly t0: number;
  readonly t1: number;
  from: number;
  to: number;
  removed: boolean;
}

/** An edge walked one way: `forward` from `t0` to `t1`. */
export interface HalfEdge {
  readonly edge: Edge;
  readonly forward: boolean;
  /** Its direction where it leaves its node, for ordering the edges around the node. */
  readonly angle: number;
  /** A little further along, where two edges leave in one direction (a line and a tangent arc). */
  readonly bend: number;
}

/** Every curve cut where it crosses or touches another, into edges between those points. */
function splitAtCrossings(curves: readonly BoundedCurve[], tol: Tolerance, merge: number): Edge[] {
  const cuts = curves.map((c) => {
    const dm = domain(c);
    return [dm.start, dm.end];
  });
  const boxes = curves.map((c) => curveBounds(c, tol));
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      if (!boxesOverlap(boxes[i]!, boxes[j]!, merge)) continue;
      for (const hit of intersect(curves[i]!, curves[j]!, tol)) {
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
          const on = closestPoint(curves[b]!, pointAt(curves[a]!, t), tol);
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

export interface Face {
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
export function faceOutline(f: Face, dev: number): Vec2[] {
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
export function insideRing(ring: readonly Vec2[], p: Vec2): boolean {
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
