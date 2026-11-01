// HATCH boundary loops as straight segments for clipping pattern lines (M1-16). Only the
// crossings of each loop with a line matter, and their count's parity, so segment order and
// direction are irrelevant; a loop's polyline is always closed, as AutoCAD fills it.
//
// Each curve is flattened to within 1e-4 of its own size (radius, major axis, control hull),
// as the renderer flattens splines, so the result is independent of the drawing's units.

import {
  flatten,
  validateSpline,
  type BoundedCurve,
  type HatchEdge,
  type HatchLoop,
  type Vec2,
} from '@triya/engine';

const DEVIATION = 1e-4;

/** Flat x0, y0, x1, y1 per segment. */
function pushCurve(out: number[], c: BoundedCurve, size: number): void {
  const { points } = flatten(c, Math.max(size * DEVIATION, Number.MIN_VALUE));
  pushPoints(out, points);
}

function pushPoints(out: number[], points: readonly Vec2[]): void {
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    out.push(p.x, p.y, q.x, q.y);
  }
}

/** A full turn, or the stored angles of a clockwise edge (DXF stores them negated). */
function sweep(e: { startAngle: number; endAngle: number; ccw: boolean }): [number, number] {
  const a0 = e.ccw ? e.startAngle : -e.endAngle;
  const a1 = e.ccw ? e.endAngle : -e.startAngle;
  return [a0, a1];
}

const FULL = 2 * Math.PI;
const isFull = (a0: number, a1: number) => Math.abs(Math.abs(a1 - a0) - FULL) < 1e-12 * FULL;

function pushEdge(out: number[], e: HatchEdge): void {
  switch (e.type) {
    case 'line':
      out.push(e.start.x, e.start.y, e.end.x, e.end.y);
      return;
    case 'arc': {
      const [a0, a1] = sweep(e);
      pushCurve(
        out,
        isFull(a0, a1)
          ? { kind: 'CIRCLE', center: e.center, radius: e.radius }
          : { kind: 'ARC', center: e.center, radius: e.radius, startAngle: a0, endAngle: a1 },
        e.radius,
      );
      return;
    }
    case 'ellipse': {
      const [a0, a1] = sweep(e);
      const full = isFull(a0, a1);
      pushCurve(
        out,
        {
          kind: 'ELLIPSE',
          center: e.center,
          majorAxis: e.majorAxis,
          ratio: e.ratio,
          startParam: full ? 0 : a0,
          endParam: full ? FULL : a1,
        },
        Math.hypot(e.majorAxis.x, e.majorAxis.y),
      );
      return;
    }
    case 'spline': {
      const s = {
        kind: 'SPLINE' as const,
        degree: e.degree,
        knots: e.knots,
        controlPoints: e.controlPoints,
        ...(e.weights ? { weights: e.weights } : {}),
      };
      try {
        validateSpline(s);
      } catch {
        // A spline edge kept only as fit points: straight through them until the kernel
        // interpolates fit data (M1-47).
        if (e.fitPoints) pushPoints(out, e.fitPoints);
        return;
      }
      let lo = { x: Infinity, y: Infinity };
      let hi = { x: -Infinity, y: -Infinity };
      for (const p of e.controlPoints) {
        lo = { x: Math.min(lo.x, p.x), y: Math.min(lo.y, p.y) };
        hi = { x: Math.max(hi.x, p.x), y: Math.max(hi.y, p.y) };
      }
      pushCurve(out, s, Math.max(hi.x - lo.x, hi.y - lo.y));
      return;
    }
  }
}

/** A boundary loop as straight segments, flat x0, y0, x1, y1. */
export function loopSegments(loop: HatchLoop): number[] {
  const out: number[] = [];
  if (loop.polyline) {
    const v = loop.polyline.vertices;
    for (let i = 0; i < v.length; i++) {
      const p = v[i]!;
      const q = v[(i + 1) % v.length]!;
      if (v.length < 2) break;
      const bulge = p.bulge ?? 0;
      if (bulge === 0) {
        out.push(p.x, p.y, q.x, q.y);
        continue;
      }
      const chord = Math.hypot(q.x - p.x, q.y - p.y);
      const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
      pushCurve(
        out,
        {
          kind: 'LWPOLYLINE',
          closed: false,
          vertices: [
            { x: p.x, y: p.y, bulge },
            { x: q.x, y: q.y, bulge: 0 },
          ],
        },
        radius,
      );
    }
    return out;
  }
  for (const e of loop.edges ?? []) pushEdge(out, e);
  return out;
}
