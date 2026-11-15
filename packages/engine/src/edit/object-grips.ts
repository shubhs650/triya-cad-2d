// Grips on multilines, multileaders, regions and a non-associative hatch's boundary (M3-05 part
// 6), as AutoCAD 2024 shows them ("Grips Reference", "To Modify Multileaders Using Grips", "To
// Modify Hatch Objects Using Grips"):
//
// - a multiline shows a grip at each vertex, which stretches it: the segments on either side
//   turn, the vertices' miters halve the new turns and each element keeps its offset from the
//   segments (its distance along the miter, DXF 41, follows the miter's angle). MLEDIT's cuts
//   (the later DXF 41 values) stay as they are, measured from the vertex.
// - a multileader shows its leader lines' vertices (the arrowhead first), which stretch alone;
//   its landing's two ends and its content's insertion point, which move the landing and the
//   content together, the leader lines reaching them from where they were; the landing's far end
//   also Lengthens Landing (the dogleg runs to the point along its direction, the content
//   following). Help shows these grips without saying how the landing's near end differs from
//   its far end when dragged: here both move landing and content, as its far end's Stretch does.
// - a region shows one grip at the centre of its extents, which moves it: a region is a body,
//   so its edges have no grips of their own (Help lists none, as for 3D solids' centroid grip).
// - a non-associative hatch shows, besides its control grip, its boundary's vertices: a
//   polyline loop's vertices (an arc segment keeping its bulge, as a polyline's stretch does)
//   and the ends of an edge loop's lines (two lines meeting there move together). An arc,
//   ellipse or spline edge has no grips: its ends are not free to move alone. An associative
//   hatch's boundary objects have the grips, and it follows them.
import { toleranceForSize } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { add, dot, length, scale, sub } from '../geom/vec';
import type {
  HatchEdge,
  HatchGeometry,
  HatchLoop,
  MLineGeometry,
  MLineVertex,
  MultiLeaderBranch,
  MultiLeaderGeometry,
  RegionGeometry,
} from '../model/types';
import { entityBounds } from '../spatial/entity-bounds';
import { sameGrip } from './grips';

const ML_CLOSED = 2;

/** `v` turned a quarter counter-clockwise: the left of a direction. */
const left = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

const unit = (v: Vec2): Vec2 | undefined => {
  const l = length(v);
  return l > 0 ? { x: v.x / l, y: v.y / l } : undefined;
};

// ── Multilines ──────────────────────────────────────────────────────────────────────────────

/** A multiline's vertex grips. */
export const mlineGrips = (g: MLineGeometry): Vec2[] => g.vertices.map((v) => v.position);

/** The miter a vertex has between the segments coming in along `a` and going out along `b`. */
function miterOf(a: Vec2 | undefined, b: Vec2 | undefined): Vec2 | undefined {
  if (!a || !b) return left((a ?? b)!);
  return unit(add(left(a), left(b))) ?? left(b);
}

/**
 * The directions coming into and going out of each vertex of `points` (a closed multiline's
 * first comes from its last); undefined where there is no segment.
 */
function segmentDirections(
  points: readonly Vec2[],
  closed: boolean,
): { into: (Vec2 | undefined)[]; out: (Vec2 | undefined)[] } | undefined {
  const n = points.length;
  const out: (Vec2 | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === n - 1) {
      out.push(undefined);
      continue;
    }
    const d = unit(sub(points[(i + 1) % n]!, points[i]!));
    if (!d) return undefined;
    out.push(d);
  }
  const into = points.map((_, i) => (i > 0 ? out[i - 1] : closed ? out[n - 1] : undefined));
  return { into, out };
}

/**
 * The multiline with its vertex `i` at `to`: the directions and miters of the vertices beside it
 * worked out afresh, each element keeping its offset from the segments. Undefined when a segment
 * would have no length.
 */
export function moveMlineVertex(g: MLineGeometry, i: number, to: Vec2): MLineGeometry | undefined {
  const closed = (g.flags & ML_CLOSED) !== 0;
  const n = g.vertices.length;
  const before = g.vertices.map((v) => v.position);
  const after = before.map((p, k) => (k === i ? to : p));
  const was = segmentDirections(before, closed);
  const now = segmentDirections(after, closed);
  if (!now || !was) return undefined;
  const touched = new Set([i, (i - 1 + n) % n, (i + 1) % n]);
  const vertices = g.vertices.map((v, k): MLineVertex => {
    if (!touched.has(k)) return v;
    // A vertex's direction is its segment's, the last one's (open) the segment into it.
    const direction = now.out[k] ?? now.into[k]!;
    let miter = miterOf(now.into[k], now.out[k])!;
    // Keep the file's sense of the miter (AutoCAD's points to the left).
    if (dot(miterOf(was.into[k], was.out[k])!, v.miter) < 0) miter = scale(miter, -1);
    // An element's offset is t × (miter · left(direction)), the vertex's own as stored: it
    // stays, so t follows.
    const oldSin = dot(v.miter, left(v.direction));
    const newSin = dot(miter, left(direction));
    const k2 = Math.abs(newSin) > 1e-12 && Math.abs(oldSin) > 1e-12 ? oldSin / newSin : 1;
    return {
      ...v,
      position: k === i ? to : v.position,
      direction,
      miter,
      elements: v.elements.map((e) => ({
        ...e,
        parameters: e.parameters.map((t, j) => (j === 0 ? t * k2 : t)),
      })),
    };
  });
  return { ...g, ...(i === 0 && { start: to }), vertices };
}

// ── Multileaders ────────────────────────────────────────────────────────────────────────────

/** A branch's landing: its far end is a grip of its own when the dogleg is drawn. */
function landingEnd(g: MultiLeaderGeometry, b: MultiLeaderBranch): Vec2 | undefined {
  const drawn =
    g.textAttachmentDirection === 0 &&
    g.dogleg &&
    g.pathType === 1 &&
    b.doglegLength !== 0 &&
    b.lines.length > 0;
  if (!drawn) return undefined;
  const dir = unit(b.direction) ?? { x: 1, y: 0 };
  return add(b.connection, scale(dir, b.doglegLength));
}

/**
 * Where a branch's leader lines end without a dogleg drawn: on the landing's far end for a
 * straight horizontally attached leader (the renderer's), else at the connection.
 */
function lineEnd(g: MultiLeaderGeometry, b: MultiLeaderBranch): Vec2 {
  if (g.textAttachmentDirection !== 0 || g.pathType === 2) return b.connection;
  const dir = unit(b.direction) ?? { x: 1, y: 0 };
  return add(b.connection, scale(dir, b.doglegLength));
}

/** Where a multileader's content is placed: its text's or its block's insertion point. */
const contentPoint = (g: MultiLeaderGeometry): Vec2 | undefined =>
  g.contentType === 2 ? g.text?.position : g.contentType === 1 ? g.block?.position : undefined;

/** A multileader's grips: its leader vertices, then its landings' ends and its content. */
export function multileaderGrips(g: MultiLeaderGeometry): {
  vertices: Vec2[];
  landing: Vec2[];
} {
  const vertices = g.branches.flatMap((b) => b.lines.flatMap((l) => l.vertices));
  const landing: Vec2[] = [];
  for (const b of g.branches) {
    const end = landingEnd(g, b);
    if (end) landing.push(b.connection, end);
    else landing.push(lineEnd(g, b));
  }
  const content = contentPoint(g);
  if (content) landing.push(content);
  return { vertices, landing };
}

/** The multileader with its leader vertices at `grip` moved by `d`. */
export function moveLeaderVertex(g: MultiLeaderGeometry, grip: Vec2, d: Vec2): MultiLeaderGeometry {
  const branches = g.branches.map((b) => ({
    ...b,
    lines: b.lines.map((l) => ({
      ...l,
      vertices: l.vertices.map((p) => (sameGrip(p, grip) ? add(p, d) : p)),
    })),
  }));
  return { ...g, branches };
}

/** The content and the landings moved by `d`, `except` one branch's connection. */
function moveContent(
  g: MultiLeaderGeometry,
  d: Vec2,
  except?: MultiLeaderBranch,
): MultiLeaderGeometry {
  return {
    ...g,
    contentBase: add(g.contentBase, d),
    ...(g.text && { text: { ...g.text, position: add(g.text.position, d) } }),
    ...(g.block && { block: { ...g.block, position: add(g.block.position, d) } }),
    branches: g.branches.map((b) =>
      b === except ? b : { ...b, connection: add(b.connection, d) },
    ),
  };
}

/** The landing grip dragged by `d`: the landings and the content move, the leader lines stay. */
export const moveLanding = (g: MultiLeaderGeometry, d: Vec2): MultiLeaderGeometry =>
  moveContent(g, d);

/** The branch whose landing's far end is at `grip`, if one is. */
export function landingEndAt(g: MultiLeaderGeometry, grip: Vec2): MultiLeaderBranch | undefined {
  return g.branches.find((b) => {
    const end = landingEnd(g, b);
    return end !== undefined && sameGrip(end, grip);
  });
}

/**
 * Lengthen Landing: the branch's dogleg runs from its connection to `to` along its direction,
 * the content (and the other branches' landings) following. Undefined behind the connection.
 */
export function lengthenLanding(
  g: MultiLeaderGeometry,
  b: MultiLeaderBranch,
  to: Vec2,
): MultiLeaderGeometry | undefined {
  const dir = unit(b.direction) ?? { x: 1, y: 0 };
  const len = dot(sub(to, b.connection), dir);
  if (!(len > 0)) return undefined;
  const moved = moveContent(g, scale(dir, len - b.doglegLength), b);
  return {
    ...moved,
    branches: moved.branches.map((x) => (x === b ? { ...b, doglegLength: len } : x)),
  };
}

// ── Regions ─────────────────────────────────────────────────────────────────────────────────

const regionCentres = new WeakMap<RegionGeometry, Vec2 | null>();

/** A region's grip: the centre of its extents; none without edges. */
export function regionGripPoint(g: RegionGeometry): Vec2 | undefined {
  const known = regionCentres.get(g);
  if (known !== undefined) return known ?? undefined;
  let m = 1;
  for (const l of g.loops) {
    for (const e of l.edges) {
      const p = e.kind === 'LINE' ? e.start : e.center;
      m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
    }
  }
  const b = entityBounds(g, { tol: toleranceForSize(m), blockExtents: () => undefined });
  const at =
    b.kind === 'box' && g.loops.some((l) => l.edges.length > 0)
      ? { x: (b.box.minX + b.box.maxX) / 2, y: (b.box.minY + b.box.maxY) / 2 }
      : null;
  regionCentres.set(g, at);
  return at ?? undefined;
}

// ── Hatch boundaries ────────────────────────────────────────────────────────────────────────

/** An edge loop's points that move: the ends of its lines, none of an arc's, ellipse's or spline's. */
function freeEnds(edges: readonly HatchEdge[]): Vec2[] {
  const fixed: Vec2[] = [];
  const out: Vec2[] = [];
  for (const e of edges) {
    if (e.type !== 'line') {
      if (e.type === 'spline') fixed.push(...e.controlPoints);
      else fixed.push(...curveEnds(e));
      continue;
    }
    for (const p of [e.start, e.end]) {
      if (!out.some((q) => sameGrip(q, p))) out.push(p);
    }
  }
  return out.filter((p) => !fixed.some((q) => sameGrip(p, q)));
}

/** An arc or ellipse edge's ends, in the hatch's plane. */
function curveEnds(e: Extract<HatchEdge, { type: 'arc' | 'ellipse' }>): Vec2[] {
  // Stored clockwise, the angles are negated (DXF 73 = 0).
  const [a0, a1] = e.ccw ? [e.startAngle, e.endAngle] : [-e.startAngle, -e.endAngle];
  if (e.type === 'arc') {
    return [a0, a1].map((a) =>
      add(e.center, { x: e.radius * Math.cos(a), y: e.radius * Math.sin(a) }),
    );
  }
  const minor = scale(left(e.majorAxis), e.ratio);
  return [a0, a1].map((t) =>
    add(e.center, add(scale(e.majorAxis, Math.cos(t)), scale(minor, Math.sin(t)))),
  );
}

const hatchVertices = new WeakMap<HatchGeometry, Vec2[]>();

/** A non-associative hatch's boundary grips; none for an associative one. */
export function hatchBoundaryGrips(g: HatchGeometry): Vec2[] {
  if (g.associative) return [];
  const known = hatchVertices.get(g);
  if (known) return known;
  const out: Vec2[] = [];
  const see = (p: Vec2) => {
    if (!out.some((q) => sameGrip(q, p))) out.push(p);
  };
  for (const l of g.loops) {
    if (l.polyline) l.polyline.vertices.forEach((v) => see({ x: v.x, y: v.y }));
    else freeEnds(l.edges ?? []).forEach(see);
  }
  hatchVertices.set(g, out);
  return out;
}

/** The hatch with its boundary points at `grip` moved by `d`. */
export function moveHatchVertex(g: HatchGeometry, grip: Vec2, d: Vec2): HatchGeometry {
  const at = (p: Vec2) => sameGrip(p, grip);
  const loops = g.loops.map((l): HatchLoop => {
    if (l.polyline) {
      if (!l.polyline.vertices.some(at)) return l;
      const vertices = l.polyline.vertices.map((v) =>
        at(v) ? { ...v, x: v.x + d.x, y: v.y + d.y } : v,
      );
      return { ...l, polyline: { ...l.polyline, vertices } };
    }
    const edges = l.edges ?? [];
    if (!edges.some((e) => e.type === 'line' && (at(e.start) || at(e.end)))) return l;
    return {
      ...l,
      edges: edges.map((e) =>
        e.type === 'line' && (at(e.start) || at(e.end))
          ? {
              ...e,
              start: at(e.start) ? add(e.start, d) : e.start,
              end: at(e.end) ? add(e.end, d) : e.end,
            }
          : e,
      ),
    };
  });
  return { ...g, loops };
}
