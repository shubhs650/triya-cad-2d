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

interface Edges {
  readonly index: number;
  readonly left: Vec2[];
  readonly right: Vec2[];
  /** Half widths at the start and end, to know whether a join applies. */
  readonly a: number;
  readonly b: number;
}

export function wideOutlines(vertices: readonly WideVertex[], closed: boolean): WideOutlines {
  const n = vertices.length;
  const count = closed ? n : n - 1;
  const segments: (Edges | undefined)[] = [];
  const thin: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = vertices[i]!;
    const q = vertices[(i + 1) % n]!;
    if (p.x === q.x && p.y === q.y) {
      segments.push(undefined);
      continue;
    }
    const a = Math.abs(p.startWidth) / 2;
    const b = Math.abs(p.endWidth) / 2;
    if (a === 0 && b === 0) {
      thin.push(i);
      segments.push(undefined);
      continue;
    }
    segments.push(edges(i, p, q, a, b));
  }
  for (let i = 0; i < count; i++) {
    const s = segments[i];
    const t = i + 1 < count ? segments[i + 1] : closed ? segments[0] : undefined;
    if (!s || !t || s === t || !(s.b > 0 && t.a > 0)) continue;
    join(s.left, t.left);
    join(s.right, t.right);
  }
  const fills: Vec2[][] = [];
  for (const s of segments) {
    if (!s) continue;
    const outline = [...s.left, ...[...s.right].reverse()];
    fills.push(signedArea(outline) < 0 ? outline.reverse() : outline);
  }
  return { fills, thin };
}

function edges(index: number, p: WideVertex, q: WideVertex, a: number, b: number): Edges {
  if (p.bulge === 0) {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    return {
      index,
      a,
      b,
      left: [
        { x: p.x + nx * a, y: p.y + ny * a },
        { x: q.x + nx * b, y: q.y + ny * b },
      ],
      right: [
        { x: p.x - nx * a, y: p.y - ny * a },
        { x: q.x - nx * b, y: q.y - ny * b },
      ],
    };
  }
  const arc = bulgeArc(p, q, p.bulge);
  const steps = Math.max(1, Math.ceil(Math.abs(arc.sweep) / ARC_STEP));
  // Left of travel is toward the centre on a counter-clockwise arc, away on a clockwise one.
  const side = arc.sweep > 0 ? -1 : 1;
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
    left.push({ x: cx + side * h * ux, y: cy + side * h * uy });
    right.push({ x: cx - side * h * ux, y: cy - side * h * uy });
  }
  return { index, a, b, left, right };
}

/**
 * Meets the end of edge `e` and the start of edge `f` where their end lines cross. Parallel
 * lines that are apart (a segment doubling back) keep their square ends.
 */
function join(e: Vec2[], f: Vec2[]): void {
  const p0 = e[e.length - 2]!;
  const p1 = e[e.length - 1]!;
  const q0 = f[0]!;
  const q1 = f[1]!;
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) <= RELATIVE_EPSILON * Math.hypot(rx, ry) * Math.hypot(sx, sy)) {
    // Collinear edges already meet (or nearly so); parallel ones apart cannot.
    return;
  }
  const t = ((q0.x - p0.x) * sy - (q0.y - p0.y) * sx) / cross;
  const x = { x: p0.x + rx * t, y: p0.y + ry * t };
  e[e.length - 1] = x;
  f[0] = x;
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
