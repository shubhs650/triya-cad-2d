// Parametric evaluation of every curve type (parameter domains are listed in curves.ts).

import { ccwSweep, TAU } from './angle';
import type { Arc, Curve, Ellipse, Line, Polyline } from './curves';
import { splineDerivative, splineDomain, splinePoint } from './nurbs';
import {
  add,
  angleOf,
  distance,
  fromAngle,
  lerp,
  midpoint,
  normalize,
  perp,
  scale,
  sub,
} from './vec';
import type { Vec2 } from './types';

export interface Domain {
  readonly start: number;
  readonly end: number;
}

export const arcSweep = (a: Arc): number => ccwSweep(a.startAngle, a.endAngle);
export const ellipseSweep = (e: Ellipse): number => ccwSweep(e.startParam, e.endParam);

/** Major and minor semi-axis vectors; the minor one is 90° CCW of the major. */
export function ellipseAxes(e: Ellipse): { major: Vec2; minor: Vec2 } {
  return { major: e.majorAxis, minor: scale(perp(e.majorAxis), e.ratio) };
}

export function polylineSegmentCount(p: Polyline): number {
  const n = p.vertices.length;
  if (n < 2) return 0;
  return p.closed ? n : n - 1;
}

/** An arc segment of a polyline: signed sweep (> 0 CCW), from the segment's start vertex. */
export interface BulgeArc {
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly sweep: number;
}

/** The arc a polyline bulge describes between `p1` and `p2` (bulge ≠ 0). */
export function bulgeArc(p1: Vec2, p2: Vec2, bulge: number): BulgeArc {
  const sweep = 4 * Math.atan(bulge);
  const chord = distance(p1, p2);
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // The centre sits on the chord's perpendicular bisector, at signed distance
  // (chord/2)·cot(θ/2) to the left of p1→p2 (CCW arcs bulge to the right).
  const h = (chord / 2) * (1 / Math.tan(sweep / 2));
  const center = add(midpoint(p1, p2), scale(perp(normalize(sub(p2, p1))), h));
  return { center, radius, startAngle: angleOf(sub(p1, center)), sweep };
}

/** Segment i of a polyline as a straight segment or a bulge arc. */
export function polylineSegment(
  p: Polyline,
  i: number,
): { line: { a: Vec2; b: Vec2 } } | { arc: BulgeArc } {
  const v = p.vertices[i]!;
  const w = p.vertices[(i + 1) % p.vertices.length]!;
  if (v.bulge === 0) return { line: { a: v, b: w } };
  return { arc: bulgeArc(v, w, v.bulge) };
}

/** Splits a polyline parameter into segment index and local parameter in [0, 1]. */
function locate(p: Polyline, t: number): { i: number; s: number } {
  const n = polylineSegmentCount(p);
  if (n === 0) throw new Error('polyline has no segments');
  const c = Math.min(Math.max(t, 0), n);
  const i = Math.min(Math.floor(c), n - 1);
  return { i, s: c - i };
}

export function domain(c: Curve): Domain {
  switch (c.kind) {
    case 'LINE':
      return { start: 0, end: 1 };
    case 'RAY':
      return { start: 0, end: Infinity };
    case 'XLINE':
      return { start: -Infinity, end: Infinity };
    case 'CIRCLE':
      return { start: 0, end: TAU };
    case 'ARC':
      return { start: c.startAngle, end: c.startAngle + arcSweep(c) };
    case 'ELLIPSE':
      return { start: c.startParam, end: c.startParam + ellipseSweep(c) };
    case 'LWPOLYLINE':
      return { start: 0, end: polylineSegmentCount(c) };
    case 'SPLINE':
      return splineDomain(c);
  }
}

export function pointAt(c: Curve, t: number): Vec2 {
  switch (c.kind) {
    case 'LINE':
      return lerp(c.start, c.end, t);
    case 'RAY':
    case 'XLINE':
      return add(c.base, scale(normalize(c.direction), t));
    case 'CIRCLE':
    case 'ARC':
      return add(c.center, fromAngle(t, c.radius));
    case 'ELLIPSE': {
      const { major, minor } = ellipseAxes(c);
      return add(c.center, add(scale(major, Math.cos(t)), scale(minor, Math.sin(t))));
    }
    case 'LWPOLYLINE': {
      const { i, s } = locate(c, t);
      const seg = polylineSegment(c, i);
      if ('line' in seg) return lerp(seg.line.a, seg.line.b, s);
      const { center, radius, startAngle, sweep } = seg.arc;
      return add(center, fromAngle(startAngle + s * sweep, radius));
    }
    case 'SPLINE':
      return splinePoint(c, t);
  }
}

/** First derivative with respect to the curve's own parameter. */
export function derivativeAt(c: Curve, t: number): Vec2 {
  switch (c.kind) {
    case 'LINE':
      return sub(c.end, c.start);
    case 'RAY':
    case 'XLINE':
      return normalize(c.direction);
    case 'CIRCLE':
    case 'ARC':
      return fromAngle(t + Math.PI / 2, c.radius);
    case 'ELLIPSE': {
      const { major, minor } = ellipseAxes(c);
      return add(scale(major, -Math.sin(t)), scale(minor, Math.cos(t)));
    }
    case 'LWPOLYLINE': {
      const { i, s } = locate(c, t);
      const seg = polylineSegment(c, i);
      if ('line' in seg) return sub(seg.line.b, seg.line.a);
      const { radius, startAngle, sweep } = seg.arc;
      return fromAngle(startAngle + s * sweep + Math.PI / 2, radius * sweep);
    }
    case 'SPLINE':
      return splineDerivative(c, t);
  }
}

/** First point; a RAY starts at its base, an XLINE has no start. */
export function startPoint(c: Curve): Vec2 {
  if (c.kind === 'XLINE') throw new Error('XLINE is unbounded');
  return pointAt(c, domain(c).start);
}

export function endPoint(c: Curve): Vec2 {
  if (c.kind === 'RAY' || c.kind === 'XLINE') throw new Error(`${c.kind} is unbounded`);
  return pointAt(c, domain(c).end);
}

/** A polyline as separate LINEs and CCW ARCs (what EXPLODE produces), in vertex order. */
export function explodePolyline(p: Polyline): (Line | Arc)[] {
  const out: (Line | Arc)[] = [];
  for (let i = 0; i < polylineSegmentCount(p); i++) {
    const seg = polylineSegment(p, i);
    if ('line' in seg) {
      out.push({
        kind: 'LINE',
        start: { x: seg.line.a.x, y: seg.line.a.y },
        end: { x: seg.line.b.x, y: seg.line.b.y },
      });
      continue;
    }
    const { center, radius, startAngle, sweep } = seg.arc;
    // A clockwise segment is the CCW arc from its end vertex back to its start vertex.
    const [a0, a1] =
      sweep > 0 ? [startAngle, startAngle + sweep] : [startAngle + sweep, startAngle];
    out.push({ kind: 'ARC', center, radius, startAngle: a0, endAngle: a1 });
  }
  return out;
}
