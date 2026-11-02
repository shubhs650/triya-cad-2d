// Wide polyline segments (M1-46): the filled outlines AutoCAD draws for LWPOLYLINE and 2D
// POLYLINE widths.
//
// - A segment runs from its start vertex's start width to its end width (DXF 40/41, or 43 /
//   the POLYLINE's 40/41 defaults), linearly along a line and by angle along a bulge arc,
//   whose edges sit at radius ± half the width.
// - Where two wide segments meet, their edges are extended or cut back to meet (a mitre),
//   whatever the angle, so a sharp turn shows a spike as it does in AutoCAD; edges that
//   are parallel but apart (a segment doubling straight back) cannot meet and end square.
//   A segment of zero width at the shared vertex ends square too. AutoCAD documents none
//   of this; it is the common drafter expectation, to check against reference plots (M1-26).
// - A segment with no width at either end is left to the thin line (drawn at its lineweight).
// - Arcs are flattened to 1e-4 of their outer radius, as the renderer flattens curves, so the
//   renderer and the spatial index see the same outline.

import { bulgeArc } from './eval';
import { RELATIVE_EPSILON } from './tolerance';
import type { Vec2 } from './types';

/** A polyline vertex with its widths resolved (no defaults left to apply). */
export interface WideVertex {
  readonly x: number;
  readonly y: number;
  readonly bulge: number;
  readonly startWidth: number;
  readonly endWidth: number;
}

export interface WideOutlines {
  /** One counter-clockwise outline per wide segment, in segment order. */
  readonly fills: readonly (readonly Vec2[])[];
  /** Indices of the segments with no width, drawn as the thin line. */
  readonly thin: readonly number[];
}

/** Arc step whose chord strays at most 1e-4 of the radius (as the renderer's ARC_STEP). */
const ARC_STEP = 2 * Math.acos(1 - 1e-4);

/**
 * One polyline segment, as `wideSegments` lists them: its flattened centre line and, when it
 * is wide, its edges (`left` and `right` of travel, sampled beside each centre point) with the
 * ends that the mitres moved. A dash on it is `widePiece`, a dot `wideCross`.
 */
export interface WideSegment {
  readonly index: number;
  /** False for a segment of zero width at both ends (the thin line) or of zero length. */
  readonly wide: boolean;
  /** The centre line from the segment's start vertex to its end vertex. */
  readonly centre: readonly Vec2[];
  /** Distance along `centre` at each of its points; the last is `length`. */
  readonly at: readonly number[];
  readonly length: number;
  /** The edges beside each centre point, before any mitre; empty when not wide. */
  readonly left: readonly Vec2[];
  readonly right: readonly Vec2[];
  /** The edges' end points after the mitres with the neighbouring segments. */
  readonly start: { left: Vec2; right: Vec2 };
  readonly end: { left: Vec2; right: Vec2 };
  /** Half widths at the start and end, to know whether a join applies. */
  readonly a: number;
  readonly b: number;
}

export function wideOutlines(vertices: readonly WideVertex[], closed: boolean): WideOutlines {
  const fills: Vec2[][] = [];
  const thin: number[] = [];
  for (const s of wideSegments(vertices, closed)) {
    if (s.wide) fills.push(widePiece(s, 0, s.length));
    else if (s.length > 0) thin.push(s.index);
  }
  return { fills, thin };
}

/**
 * Every segment of a polyline in order (`closed` adds the one back to the first vertex), the
 * wide ones mitred where they meet as `wideOutlines` draws them.
 */
export function wideSegments(vertices: readonly WideVertex[], closed: boolean): WideSegment[] {
  const n = vertices.length;
  const count = closed ? n : n - 1;
  const segments: WideSegment[] = [];
  for (let i = 0; i < count; i++) {
    const p = vertices[i]!;
    const q = vertices[(i + 1) % n]!;
    if (p.x === q.x && p.y === q.y) {
      segments.push(segment(i, [p, q], [], [], 0, 0, false));
      continue;
    }
    const a = Math.abs(p.startWidth) / 2;
    const b = Math.abs(p.endWidth) / 2;
    segments.push(edges(i, p, q, a, b));
  }
  for (let i = 0; i < count; i++) {
    const s = segments[i];
    const t = i + 1 < count ? segments[i + 1] : closed ? segments[0] : undefined;
    if (!s || !t || s === t || !s.wide || !t.wide || !(s.b > 0 && t.a > 0)) continue;
    join(s, t, 'left');
    join(s, t, 'right');
  }
  return segments;
}

/**
 * The outline of a wide segment between distances `from` and `to` along its centre line,
 * counter-clockwise: cut straight across inside the segment, and keeping the mitre at an end
 * it reaches. A cut just short of an inner mitre can reach past the mitre line by up to half
 * the width; that overlaps the next segment's piece, which a nonzero fill shows as one.
 * Empty on a segment that is not wide.
 */
export function widePiece(s: WideSegment, from: number, to: number): Vec2[] {
  if (!s.wide) return [];
  const a = Math.max(0, Math.min(from, s.length));
  const b = Math.max(a, Math.min(to, s.length));
  const left = [a <= 0 ? s.start.left : along(s, s.left, a)];
  const right = [a <= 0 ? s.start.right : along(s, s.right, a)];
  for (let k = 1; k < s.centre.length - 1; k++) {
    const d = s.at[k]!;
    if (d <= a) continue;
    if (d >= b) break;
    left.push(s.left[k]!);
    right.push(s.right[k]!);
  }
  left.push(b >= s.length ? s.end.left : along(s, s.left, b));
  right.push(b >= s.length ? s.end.right : along(s, s.right, b));
  const outline = [...left, ...right.reverse()];
  return signedArea(outline) < 0 ? outline.reverse() : outline;
}

/** The cut across a wide segment at distance `d` along it, left edge first; none when thin. */
export function wideCross(s: WideSegment, d: number): [Vec2, Vec2] | undefined {
  if (!s.wide) return undefined;
  return [along(s, s.left, d), along(s, s.right, d)];
}

/** The point of an edge beside centre distance `d`, between the samples on either side. */
function along(s: WideSegment, edge: readonly Vec2[], d: number): Vec2 {
  const at = s.at;
  let k = 0;
  while (k < at.length - 2 && at[k + 1]! < d) k++;
  const span = at[k + 1]! - at[k]!;
  const t = span > 0 ? Math.max(0, Math.min(1, (d - at[k]!) / span)) : 0;
  const p = edge[k]!;
  const q = edge[k + 1]!;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

function segment(
  index: number,
  centre: Vec2[],
  left: Vec2[],
  right: Vec2[],
  a: number,
  b: number,
  wide: boolean,
): WideSegment {
  const at = [0];
  for (let k = 1; k < centre.length; k++)
    at.push(
      at[k - 1]! + Math.hypot(centre[k]!.x - centre[k - 1]!.x, centre[k]!.y - centre[k - 1]!.y),
    );
  const first = { left: left[0] ?? centre[0]!, right: right[0] ?? centre[0]! };
  const last = { left: left.at(-1) ?? centre.at(-1)!, right: right.at(-1) ?? centre.at(-1)! };
  return {
    index,
    wide,
    centre,
    at,
    length: at.at(-1)!,
    left,
    right,
    start: first,
    end: last,
    a,
    b,
  };
}

function edges(index: number, p: WideVertex, q: WideVertex, a: number, b: number): WideSegment {
  const wide = a > 0 || b > 0;
  if (p.bulge === 0) {
    const centre = [
      { x: p.x, y: p.y },
      { x: q.x, y: q.y },
    ];
    if (!wide) return segment(index, centre, [], [], a, b, false);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    return segment(
      index,
      centre,
      [
        { x: p.x + nx * a, y: p.y + ny * a },
        { x: q.x + nx * b, y: q.y + ny * b },
      ],
      [
        { x: p.x - nx * a, y: p.y - ny * a },
        { x: q.x - nx * b, y: q.y - ny * b },
      ],
      a,
      b,
      true,
    );
  }
  const arc = bulgeArc(p, q, p.bulge);
  const steps = Math.max(1, Math.ceil(Math.abs(arc.sweep) / ARC_STEP));
  // Left of travel is toward the centre on a counter-clockwise arc, away on a clockwise one.
  const side = arc.sweep > 0 ? -1 : 1;
  const centre: Vec2[] = [];
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const angle = arc.startAngle + arc.sweep * t;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const h = a + (b - a) * t;
    // The ends sit exactly on the vertices' offsets, not on a recomputed angle.
    const cx = k === 0 ? p.x : k === steps ? q.x : arc.center.x + arc.radius * ux;
    const cy = k === 0 ? p.y : k === steps ? q.y : arc.center.y + arc.radius * uy;
    centre.push({ x: cx, y: cy });
    if (!wide) continue;
    left.push({ x: cx + side * h * ux, y: cy + side * h * uy });
    right.push({ x: cx - side * h * ux, y: cy - side * h * uy });
  }
  return segment(index, centre, left, right, a, b, wide);
}

/**
 * Meets the end of `s`'s edge on `side` and the start of `t`'s where their end lines cross.
 * Parallel lines that are apart (a segment doubling back) keep their square ends.
 */
function join(s: WideSegment, t: WideSegment, side: 'left' | 'right'): void {
  const e = s[side];
  const p0 = e[e.length - 2]!;
  const p1 = e[e.length - 1]!;
  const q0 = t[side][0]!;
  const q1 = t[side][1]!;
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) <= RELATIVE_EPSILON * Math.hypot(rx, ry) * Math.hypot(sx, sy)) {
    // Collinear edges already meet (or nearly so); parallel ones apart cannot.
    return;
  }
  const u = ((q0.x - p0.x) * sy - (q0.y - p0.y) * sx) / cross;
  const x = { x: p0.x + rx * u, y: p0.y + ry * u };
  s.end[side] = x;
  t.start[side] = x;
}

function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}
