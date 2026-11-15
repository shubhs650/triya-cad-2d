// PEDIT's geometry (M3-02 part 5), as AutoCAD 2024 edits polylines (AutoCAD Help, "PEDIT
// (Command)", "2D Polyline Selection (PEDIT)", "3D Polyline Selection (PEDIT)"):
//
// - Lines, arcs and splines turn into polylines (`polylineFrom`); a spline is sampled at the
//   precision asked for, in straight segments (PLINECONVERTMODE 0, AutoCAD's default).
// - Fit makes a curve-fit polyline: a pair of arcs between each two vertices, through every
//   vertex, with the tangent the drafter gave a vertex (Edit vertex Tangent) or the tangent of
//   the circle through it and its neighbours. The vertex between each pair is an extra one, so
//   Decurve takes every other vertex back.
// - Spline makes a spline-fit polyline: the vertices are the frame of a quadratic or cubic
//   B-spline (SPLINETYPE 5 or 6) clamped to the ends of an open frame, sampled SPLINESEGS
//   times per frame segment. The frame is kept (VERTEX flag 16) for Decurve and for edits that
//   refit it. A width tapers from the first vertex's to the last segment's.
// - Fit and Spline make a heavyweight 2D POLYLINE of a lightweight one: an LWPOLYLINE has no
//   fit flags (DXF 70 bits 2 and 4) and no frame vertices.
// - Edit vertex works on the frame of a spline-fit polyline, refitting it after each change,
//   and on the vertices of any other.
import type { Spline } from '../geom/curves';
import { ccwSweep } from '../geom/angle';
import { splineDomain, splinePoint } from '../geom/nurbs';
import type { Tolerance } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { add, cross, distance, dot, length, normalize, scale, sub } from '../geom/vec';
import { circleThrough3 } from '../geom/construct';
import { splineCurve } from '../model/spline';
import type {
  EntityGeometry,
  LwPolylineGeometry,
  PolylineGeometry,
  PolylineVertex,
  SplineGeometry,
} from '../model/types';

/** A polyline PEDIT edits: lightweight, or a heavyweight 2D or 3D one. */
export type EditablePolyline = LwPolylineGeometry | PolylineGeometry;

export const isPolyline = (g: EntityGeometry): g is EditablePolyline =>
  g.kind === 'LWPOLYLINE' || g.kind === 'POLYLINE';

export const is3dPolyline = (g: EntityGeometry): boolean => g.kind === 'POLYLINE' && g.is3d;

/** A spline-fit polyline (Spline option): one with its frame kept. */
export const isSplineFit = (g: EditablePolyline): boolean =>
  g.kind === 'POLYLINE' && g.fit !== undefined && g.fit !== 'curve' && (g.frame?.length ?? 0) > 0;

export const isCurveFit = (g: EditablePolyline): boolean =>
  g.kind === 'POLYLINE' && g.fit === 'curve';

/** A vertex with its widths; a zero width is no width, as the file maps it. */
function wide(v: PolylineVertex, sw: number, ew: number): PolylineVertex {
  const { startWidth: _s, endWidth: _e, ...rest } = v;
  return { ...rest, ...(sw !== 0 && { startWidth: sw }), ...(ew !== 0 && { endWidth: ew }) };
}

/** The vertices with every width their own (the constant width or POLYLINE defaults applied). */
export function explicitVertices(g: EditablePolyline): PolylineVertex[] {
  const dsw = g.kind === 'LWPOLYLINE' ? (g.constantWidth ?? 0) : (g.startWidth ?? 0);
  const dew = g.kind === 'LWPOLYLINE' ? (g.constantWidth ?? 0) : (g.endWidth ?? 0);
  return g.vertices.map((v) => wide(v, v.startWidth ?? dsw, v.endWidth ?? dew));
}

/** `g` with `vertices` (widths their own), its default widths and fitting gone. */
export function withVertices(
  g: EditablePolyline,
  vertices: readonly PolylineVertex[],
  closed = g.closed,
): EditablePolyline {
  if (g.kind === 'LWPOLYLINE') {
    const { constantWidth: _c, ...rest } = g;
    return { ...rest, vertices, closed };
  }
  const { startWidth: _s, endWidth: _e, fit: _f, frame: _fr, ...rest } = g;
  return { ...rest, vertices: g.is3d ? vertices.map((v) => wide(v, 0, 0)) : vertices, closed };
}

/** A heavyweight 2D POLYLINE of `g`, its plane, PLINEGEN and widths kept. */
export function heavyweight(g: EditablePolyline): PolylineGeometry {
  if (g.kind === 'POLYLINE') return g;
  const { kind: _k, constantWidth: _c, vertices: _v, ...rest } = g;
  return { ...rest, kind: 'POLYLINE', vertices: explicitVertices(g), is3d: false };
}

// ── Lines, arcs and splines into polylines ────────────────────────────────────────────────

const planar = (g: EntityGeometry) => {
  const p = g as { elevation?: number; thickness?: number; normal?: LwPolylineGeometry['normal'] };
  return {
    ...(p.elevation !== undefined && { elevation: p.elevation }),
    ...(p.thickness !== undefined && { thickness: p.thickness }),
    ...(p.normal !== undefined && { normal: p.normal }),
  };
};

/**
 * The polyline a line, arc or spline becomes, or undefined for another object. A spline is
 * sampled `precision + 1` times per knot span (PEDIT's "Specify a precision <10>", 0–99).
 */
export function polylineFrom(g: EntityGeometry, precision = 10): LwPolylineGeometry | undefined {
  switch (g.kind) {
    case 'LINE':
      return {
        kind: 'LWPOLYLINE',
        vertices: [
          { x: g.start.x, y: g.start.y, bulge: 0 },
          { x: g.end.x, y: g.end.y, bulge: 0 },
        ],
        closed: false,
        ...planar(g),
      };
    case 'ARC': {
      const sweep = ccwSweep(g.startAngle, g.endAngle);
      const at = (t: number) => ({
        x: g.center.x + g.radius * Math.cos(t),
        y: g.center.y + g.radius * Math.sin(t),
      });
      return {
        kind: 'LWPOLYLINE',
        vertices: [
          { ...at(g.startAngle), bulge: Math.tan(sweep / 4) },
          { ...at(g.startAngle + sweep), bulge: 0 },
        ],
        closed: false,
        ...planar(g),
      };
    }
    case 'SPLINE':
      return splineToPolyline(g, precision);
    default:
      return undefined;
  }
}

function splineToPolyline(g: SplineGeometry, precision: number): LwPolylineGeometry | undefined {
  // The curve drawn: the NURBS, or the one through the fit points when there is none.
  const c = splineCurve(g);
  if (!c) return undefined;
  const { start, end } = splineDomain(c);
  const spans = new Set(c.knots.filter((k) => k > start && k < end)).size + 1;
  const n = spans * (Math.max(0, Math.min(99, Math.round(precision))) + 1);
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) points.push(splinePoint(c, start + ((end - start) * i) / n));
  const closed = g.closed || distance(points[0]!, points[n]!) === 0;
  if (closed) points.pop();
  return {
    kind: 'LWPOLYLINE',
    vertices: points.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
    closed,
    ...(g.normal && { normal: g.normal }),
  };
}

// ── Fit (arc-fit curve) ───────────────────────────────────────────────────────────────────

/** The signed angle (radians) that turns `a` onto `b`. */
const turn = (a: Vec2, b: Vec2): number => Math.atan2(cross(a, b), dot(a, b));

/**
 * The tangent direction the curve fit takes at each vertex: the one given (radians), else the
 * tangent of the circle through the vertex and its neighbours (the ends of an open polyline use
 * the circle through the first or last three), else the chord's direction.
 */
function fitTangents(
  ps: readonly Vec2[],
  closed: boolean,
  given: readonly (number | undefined)[],
  tol: Tolerance,
): Vec2[] {
  const n = ps.length;
  return ps.map((p, i) => {
    const t = given[i];
    if (t !== undefined) return { x: Math.cos(t), y: Math.sin(t) };
    let a: Vec2, b: Vec2, c: Vec2;
    if (closed) [a, b, c] = [ps[(i - 1 + n) % n]!, p, ps[(i + 1) % n]!];
    else if (n < 3) return normalize(sub(ps[n - 1]!, ps[0]!));
    else if (i === 0) [a, b, c] = [p, ps[1]!, ps[2]!];
    else if (i === n - 1) [a, b, c] = [ps[n - 3]!, ps[n - 2]!, p];
    else [a, b, c] = [ps[i - 1]!, p, ps[i + 1]!];
    const circle = circleThrough3(a, b, c, tol);
    const travel = i === 0 && !closed ? sub(b, a) : i === n - 1 && !closed ? sub(c, b) : sub(c, a);
    if (!circle) return normalize(travel);
    const radial = sub(p, circle.center);
    const t1 = normalize({ x: -radial.y, y: radial.x });
    // Along the travel through the three points.
    return dot(t1, travel) >= 0 ? t1 : scale(t1, -1);
  });
}

/**
 * The biarc from `p` (leaving along `t0`) to `q` (arriving along `t1`) with equal tangent
 * lengths: its joint and the two arcs' bulges.
 */
function biarc(p: Vec2, t0: Vec2, q: Vec2, t1: Vec2): { joint: Vec2; b0: number; b1: number } {
  const d = sub(q, p);
  const v = add(t0, t1);
  const denom = 2 * (1 - dot(t0, t1));
  const vd = dot(v, d);
  const dd = dot(d, d);
  let alpha: number;
  if (Math.abs(denom) < 1e-12) {
    const td = dot(t1, d);
    alpha = Math.abs(td) < 1e-15 ? Math.sqrt(dd) / 2 : dd / (4 * td);
  } else alpha = (-vd + Math.sqrt(vd * vd + denom * dd)) / denom;
  const joint = scale(add(add(p, scale(t0, alpha)), sub(q, scale(t1, alpha))), 0.5);
  // An arc's bulge is tan(sweep/4), and its sweep twice the turn from the tangent to the chord.
  const b0 = Math.tan(turn(t0, sub(joint, p)) / 2);
  const b1 = Math.tan(turn(sub(q, joint), t1) / 2);
  return { joint, b0: Math.abs(b0) < 1e-12 ? 0 : b0, b1: Math.abs(b1) < 1e-12 ? 0 : b1 };
}

/**
 * PEDIT Fit: the curve-fit vertices of `vertices` (their bulges ignored), each span a biarc with
 * an extra vertex at its joint; a span's widths taper across its two arcs.
 */
export function curveFit(
  vertices: readonly PolylineVertex[],
  closed: boolean,
  tangents: readonly (number | undefined)[],
  tol: Tolerance,
): PolylineVertex[] {
  const n = vertices.length;
  if (n < 2) return [...vertices];
  const t = fitTangents(vertices, closed, tangents, tol);
  const out: PolylineVertex[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const v = vertices[i]!;
    const w = vertices[(i + 1) % n]!;
    const { joint, b0, b1 } = biarc(v, t[i]!, w, t[(i + 1) % n]!);
    const sw = v.startWidth ?? 0;
    const ew = v.endWidth ?? 0;
    const mid = (sw + ew) / 2;
    const { startWidth: _s, endWidth: _e, ...base } = v;
    out.push(wide({ ...base, bulge: b0 }, sw, mid));
    out.push(wide({ x: joint.x, y: joint.y, bulge: b1 }, mid, ew));
  }
  if (!closed) out.push(wide({ ...vertices[n - 1]!, bulge: 0 }, 0, 0));
  return out;
}

// ── Spline (spline-fit curve) ─────────────────────────────────────────────────────────────

/**
 * Points along the B-spline of degree `degree` (lower for a short frame) with `frame` as its
 * control points: clamped to an open frame's ends, periodic round a closed one, `segs` segments
 * per frame segment. A closed frame's points leave out the repeated start.
 */
export function splineFitPoints(
  frame: readonly Vec2[],
  closed: boolean,
  degree: 2 | 3,
  segs: number,
): Vec2[] {
  const n = frame.length;
  const k = Math.min(degree, closed ? n - 1 : n - 1);
  if (k < 1 || n < 2) return [...frame];
  let s: Spline;
  if (!closed) {
    const knots: number[] = [];
    for (let i = 0; i <= k; i++) knots.push(0);
    for (let i = 1; i < n - k; i++) knots.push(i);
    for (let i = 0; i <= k; i++) knots.push(n - k);
    s = { kind: 'SPLINE', degree: k, knots, controlPoints: frame };
  } else {
    const controlPoints = [...frame, ...frame.slice(0, k)];
    const knots = Array.from({ length: controlPoints.length + k + 1 }, (_, i) => i);
    s = { kind: 'SPLINE', degree: k, knots, controlPoints };
  }
  const { start, end } = splineDomain(s);
  const m = Math.max(1, Math.round(Math.abs(segs))) * (closed ? n : n - 1);
  const out: Vec2[] = [];
  for (let i = 0; i <= m; i++) out.push(splinePoint(s, start + ((end - start) * i) / m));
  if (closed) out.pop();
  else {
    // Exactly through the frame's ends.
    out[0] = frame[0]!;
    out[m] = frame[n - 1]!;
  }
  return out.map((p) => ({ x: p.x + 0, y: p.y + 0 }));
}

/** The frame a spline-fit polyline was fitted to, or its vertices, as PEDIT edits them. */
export function editVertices(g: EditablePolyline): PolylineVertex[] {
  if (isSplineFit(g) && g.kind === 'POLYLINE') {
    const w = g.startWidth ?? 0;
    const e = g.endWidth ?? 0;
    return g.frame!.map((p) => wide({ x: p.x, y: p.y, bulge: 0 }, w, e));
  }
  return explicitVertices(g);
}

/**
 * PEDIT Spline: `g` fitted with a spline of `type` (SPLINETYPE 5 quadratic, 6 cubic) to
 * `frame` (its vertices, or its frame when already spline-fit), `segs` (SPLINESEGS) segments per
 * frame segment. A uniform width stays the polyline's default width; another tapers from the
 * first vertex's start width to the last segment's end width.
 */
export function splineFit(
  g: EditablePolyline,
  type: 5 | 6,
  segs: number,
  frame: readonly PolylineVertex[] = editVertices(isCurveFit(g) ? decurvePolyline(g) : g),
  closed = g.closed,
): PolylineGeometry {
  const base = heavyweight(g);
  const points = splineFitPoints(frame, closed, type === 5 ? 2 : 3, segs);
  const spans = closed ? frame.length : frame.length - 1;
  const widths = frame.slice(0, spans).map((v) => [v.startWidth ?? 0, v.endWidth ?? 0] as const);
  const w0 = widths[0]?.[0] ?? 0;
  const uniform = widths.every(([a, b]) => a === w0 && b === w0);
  const wEnd = widths.at(-1)?.[1] ?? 0;
  const m = closed ? points.length : points.length - 1;
  const vertices = points.map((p, j): PolylineVertex => {
    const v = { x: p.x, y: p.y, bulge: 0 };
    if ((g.kind === 'POLYLINE' && g.is3d) || j >= m) return v;
    // A uniform width is every vertex's own too: a file's VERTEX states its widths (DXF 40/41
    // are written for each), so a vertex without them would save as 0 wide.
    if (uniform) return wide(v, w0, w0);
    return wide(v, w0 + ((wEnd - w0) * j) / m, w0 + ((wEnd - w0) * (j + 1)) / m);
  });
  const { startWidth: _s, endWidth: _e, ...rest } = base;
  return {
    ...rest,
    vertices,
    closed,
    fit: type === 5 ? 'quadratic' : 'cubic',
    frame: frame.map((v) => ({ x: v.x, y: v.y })),
    ...(uniform && w0 !== 0 && !base.is3d && { startWidth: w0, endWidth: w0 }),
  };
}

/**
 * PEDIT Fit: `g` curve-fit through its vertices (the frame of a spline-fit one, the original
 * vertices of a curve-fit one), with the tangents given by vertex.
 */
export function fitPolyline(
  g: EditablePolyline,
  tangents: readonly (number | undefined)[],
  tol: Tolerance,
): PolylineGeometry {
  const plain = decurvePolyline(g);
  const vertices = curveFit(explicitVertices(plain), plain.closed, tangents, tol);
  const { startWidth: _s, endWidth: _e, fit: _f, frame: _fr, ...rest } = heavyweight(plain);
  return { ...rest, vertices, fit: 'curve' };
}

/**
 * PEDIT Decurve: the frame of a spline-fit polyline, the original vertices of a curve-fit one
 * (every other vertex: the ones between are the extra vertices Fit added), with every segment
 * straight. The polyline stays the kind it is.
 */
export function decurvePolyline(g: EditablePolyline): EditablePolyline {
  if (isSplineFit(g) && g.kind === 'POLYLINE') {
    const { fit: _f, frame, ...rest } = g;
    return { ...rest, vertices: frame!.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) };
  }
  const vs = explicitVertices(g);
  if (isCurveFit(g)) {
    const n = vs.length;
    const paired = g.closed ? n % 2 === 0 : n % 2 === 1;
    const { fit: _f, ...rest } = g as PolylineGeometry;
    if (paired && n >= 2) {
      const originals = vs
        .filter((_, i) => i % 2 === 0)
        .map((v, i) => {
          const next = vs[2 * i + 1];
          return wide({ ...v, bulge: 0 }, v.startWidth ?? 0, next?.endWidth ?? 0);
        });
      return withVertices({ ...rest }, originals);
    }
    return withVertices(
      { ...rest },
      vs.map((v) => ({ ...v, bulge: 0 })),
    );
  }
  if (g.kind === 'POLYLINE' && g.fit) {
    // Spline-fit without a frame (cut by BREAK or TRIM): its curve is all there is.
    const { fit: _f, ...rest } = g;
    return rest;
  }
  return withVertices(
    g,
    vs.map((v) => ({ ...v, bulge: 0 })),
  );
}

/** PEDIT Width: every segment `w` wide; a spline-fit polyline keeps its frame. */
export function widthPolyline(g: EditablePolyline, w: number): EditablePolyline {
  const plain = g.vertices.map(({ startWidth: _s, endWidth: _e, ...v }) => v);
  if (g.kind === 'LWPOLYLINE') return { ...g, vertices: plain, constantWidth: w };
  if (g.is3d) return g;
  // Each VERTEX states its widths in a file, so they are the vertices' own as well.
  const { startWidth: _s, endWidth: _e, ...rest } = g;
  return {
    ...rest,
    vertices: plain.map((v) => wide(v, w, w)),
    ...(w !== 0 && { startWidth: w, endWidth: w }),
  };
}

/** PEDIT Close and Open: a spline-fit polyline is fitted again to its frame, a curve fit too. */
export function closePolyline(
  g: EditablePolyline,
  closed: boolean,
  spline: { type: 5 | 6; segs: number },
  tol: Tolerance,
): EditablePolyline {
  if (isSplineFit(g) && g.kind === 'POLYLINE') {
    const type = g.fit === 'quadratic' ? 5 : g.fit === 'cubic' ? 6 : spline.type;
    return splineFit(g, type, spline.segs, editVertices(g), closed);
  }
  if (isCurveFit(g)) {
    const plain = decurvePolyline(g);
    return fitPolyline({ ...plain, closed } as EditablePolyline, [], tol);
  }
  return { ...g, closed };
}

// ── Edit vertex ───────────────────────────────────────────────────────────────────────────

/**
 * `g` with its editing vertices (`editVertices`) replaced: a spline-fit polyline refitted to the
 * new frame, any other given the vertices (its curve fit kept).
 */
export function withEditVertices(
  g: EditablePolyline,
  vertices: readonly PolylineVertex[],
  segs: number,
  closed = g.closed,
): EditablePolyline {
  if (isSplineFit(g) && g.kind === 'POLYLINE') {
    return splineFit(g, g.fit === 'quadratic' ? 5 : 6, segs, vertices, closed);
  }
  const out = withVertices(g, vertices, closed);
  return isCurveFit(g) ? { ...(out as PolylineGeometry), fit: 'curve' } : out;
}

/** Edit vertex Insert: a new vertex after `i`, the segment from `i` now two straight ones. */
export function insertVertex(vs: readonly PolylineVertex[], i: number, p: Vec2): PolylineVertex[] {
  const v = vs[i]!;
  const sw = v.startWidth ?? 0;
  const ew = v.endWidth ?? 0;
  const mid = (sw + ew) / 2;
  return [
    ...vs.slice(0, i),
    wide({ ...v, bulge: 0 }, sw, mid),
    wide({ x: p.x, y: p.y, bulge: 0 }, mid, ew),
    ...vs.slice(i + 1),
  ];
}

/** Edit vertex Move: vertex `i` at `p`, its segments' bulges kept. */
export function moveVertex(vs: readonly PolylineVertex[], i: number, p: Vec2): PolylineVertex[] {
  return vs.map((v, k) => (k === i ? { ...v, x: p.x, y: p.y } : v));
}

/** Edit vertex Width: the segment after vertex `i` from `sw` to `ew` wide. */
export function segmentWidth(
  vs: readonly PolylineVertex[],
  i: number,
  sw: number,
  ew: number,
): PolylineVertex[] {
  return vs.map((v, k) => (k === i ? wide(v, sw, ew) : v));
}

/**
 * Edit vertex Straighten: the vertices between `i` and `j` gone and one straight segment
 * between them (the segment after `i` straightened when they are one vertex). Undefined when
 * there is nothing to straighten.
 */
export function straightenVertices(
  vs: readonly PolylineVertex[],
  i: number,
  j: number,
): PolylineVertex[] | undefined {
  const [a, b] = i <= j ? [i, j] : [j, i];
  if (a === b) {
    if (vs[a]!.bulge === 0) return undefined;
    return vs.map((v, k) => (k === a ? { ...v, bulge: 0 } : v));
  }
  return [...vs.slice(0, a), { ...vs[a]!, bulge: 0 }, ...vs.slice(b)];
}

export type BreakVertexProblem = 'at an end' | 'both ends';

/**
 * Edit vertex Break: the segments between vertices `i` and `j` taken out, leaving one or two
 * open polylines' vertices (one vertex: split there). A closed polyline opens: what is left
 * runs from the later vertex round to the earlier. Breaking at an end, or between both ends,
 * leaves nothing to break.
 */
export function breakVertices(
  vs: readonly PolylineVertex[],
  closed: boolean,
  i: number,
  j: number,
): PolylineVertex[][] | BreakVertexProblem {
  const n = vs.length;
  const [a, b] = i <= j ? [i, j] : [j, i];
  const end = (v: PolylineVertex): PolylineVertex => wide({ ...v, bulge: 0 }, 0, 0);
  if (closed) {
    // From b round to a; one vertex: the whole ring opened there.
    const ring = [...vs.slice(b), ...vs.slice(0, a + 1)];
    return [[...ring.slice(0, -1), end(ring.at(-1)!)]];
  }
  const last = n - 1;
  if (a === b && (a === 0 || a === last)) return 'at an end';
  if (a === 0 && b === last) return 'both ends';
  const pieces: PolylineVertex[][] = [];
  if (a > 0) pieces.push([...vs.slice(0, a), end(vs[a]!)]);
  if (b < last) pieces.push(vs.slice(b));
  return pieces;
}

// ── Join (Multiple, with a fuzz distance) ─────────────────────────────────────────────────

export type JoinType = 'Extend' | 'Add' | 'Both';

/** One polyline Multiple's Join made: `keep` (first in selection order) takes `geom`. */
export interface FuzzyJoined<Id> {
  readonly keep: Id;
  readonly parts: readonly Id[];
  readonly geom: EditablePolyline;
  /** Segments the others brought, and segments added between ends. */
  readonly added: number;
}

/** `vs` run the other way, as REVERSE runs a polyline. */
function reversedVertices(vs: readonly PolylineVertex[]): PolylineVertex[] {
  const n = vs.length;
  return vs.map((_, k) => {
    const v = vs[n - 1 - k]!;
    if (k === n - 1) return wide({ ...v, bulge: 0 }, 0, 0);
    const s = vs[n - 2 - k]!;
    return wide({ ...v, bulge: s.bulge === 0 ? 0 : -s.bulge }, s.endWidth ?? 0, s.startWidth ?? 0);
  });
}

/** Where the last segment of `a` and the first of `b`, both straight, meet when extended. */
function extendedMeet(
  a: readonly PolylineVertex[],
  b: readonly PolylineVertex[],
): Vec2 | undefined {
  if (a.length < 2 || b.length < 2) return undefined;
  const p0 = a[a.length - 2]!;
  const p1 = a[a.length - 1]!;
  const q0 = b[0]!;
  const q1 = b[1]!;
  if (p0.bulge !== 0 || q0.bulge !== 0) return undefined;
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const den = cross(d1, d2);
  if (Math.abs(den) <= 1e-12 * length(d1) * length(d2)) return undefined;
  const s = cross(sub(q0, p0), d2) / den;
  return add(p0, scale(d1, s));
}

/**
 * PEDIT Multiple's Join: open polylines whose ends lie within `fuzz` of each other joined, the
 * nearest ends first, by `type`: Extend moves both ends to where their straight end segments
 * meet, Add joins them with a straight segment, Both extends where it can and adds elsewhere.
 * Ends that touch (within `tol`) simply join. 3D polylines and closed ones take no part.
 */
export function fuzzyJoin<Id>(
  parts: readonly { id: Id; geom: EditablePolyline }[],
  fuzz: number,
  type: JoinType,
  tol: Tolerance,
): FuzzyJoined<Id>[] {
  interface Item {
    keep: Id;
    order: number;
    parts: Id[];
    base: EditablePolyline;
    vs: PolylineVertex[];
    added: number;
  }
  let items: Item[] = parts
    .map((p, order) => ({ p, order }))
    .filter(({ p }) => !p.geom.closed && !is3dPolyline(p.geom) && p.geom.vertices.length >= 2)
    .map(({ p, order }) => {
      const plain = decurvePolyline(p.geom);
      return {
        keep: p.id,
        order,
        parts: [p.id],
        base: plain,
        vs: explicitVertices(plain),
        added: 0,
      };
    });
  const elevation = (g: EditablePolyline) => g.elevation ?? 0;
  const refused = new Set<string>();
  const limit = Math.max(fuzz, tol.linear);
  for (;;) {
    let best: { a: Item; b: Item; ea: boolean; eb: boolean; d: number } | undefined;
    for (const a of items) {
      for (const b of items) {
        if (a.order >= b.order || elevation(a.base) !== elevation(b.base)) continue;
        for (const ea of [true, false]) {
          for (const eb of [true, false]) {
            const key = `${a.order}:${b.order}:${ea}:${eb}`;
            if (refused.has(key)) continue;
            const pa = ea ? a.vs.at(-1)! : a.vs[0]!;
            const pb = eb ? b.vs.at(-1)! : b.vs[0]!;
            const d = distance(pa, pb);
            if (d <= limit && (!best || d < best.d)) best = { a, b, ea, eb, d };
          }
        }
      }
    }
    if (!best) break;
    const { a, b, ea, eb, d } = best;
    // a then b: a's end meets b's start.
    const first = ea ? a.vs : reversedVertices(a.vs);
    const second = eb ? reversedVertices(b.vs) : b.vs;
    let joined: PolylineVertex[] | undefined;
    let added = b.added + countSegments(second);
    if (d <= tol.linear) {
      joined = [...first.slice(0, -1), { ...second[0]!, x: first.at(-1)!.x, y: first.at(-1)!.y }];
      joined.push(...second.slice(1));
    } else {
      const meet = type === 'Add' ? undefined : extendedMeet(first, second);
      if (meet) {
        joined = [
          ...first.slice(0, -1),
          { ...second[0]!, x: meet.x, y: meet.y },
          ...second.slice(1),
        ];
      } else if (type !== 'Extend') {
        joined = [...first.slice(0, -1), wide({ ...first.at(-1)!, bulge: 0 }, 0, 0), ...second];
        added++;
      }
    }
    if (!joined) {
      refused.add(`${a.order}:${b.order}:${ea}:${eb}`);
      continue;
    }
    const keeper = a.order < b.order ? a : b;
    const merged: Item = {
      keep: keeper.keep,
      order: keeper.order,
      parts: [...a.parts, ...b.parts],
      base: keeper.base,
      vs: joined,
      added: a.added + added,
    };
    items = [...items.filter((it) => it !== a && it !== b), merged].sort(
      (x, y) => x.order - y.order,
    );
  }
  return items
    .filter((it) => it.parts.length > 1)
    .map((it) => {
      const closes = distance(it.vs[0]!, it.vs.at(-1)!) <= tol.linear && it.vs.length > 2;
      const vs = closes ? it.vs.slice(0, -1) : it.vs;
      return {
        keep: it.keep,
        parts: it.parts,
        geom: withVertices(it.base, vs, closes),
        added: it.added,
      };
    });
}

const countSegments = (vs: readonly PolylineVertex[]): number => Math.max(0, vs.length - 1);
