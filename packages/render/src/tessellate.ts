// Entity geometry → render primitives (ARCHITECTURE.md §7.2 "Scene cache"). Runs once per
// change, never per frame. Lines, arcs, circles, ellipses and bulge polylines stay exact
// (the canvas draws arcs natively, so they are smooth at any zoom); splines are flattened
// once, finely enough for deep zoom.
//
// Kinds drawn by later tasks yield nothing here, each noted where it falls through: INSERT
// (M1-14), DIMENSION (M1-15), pattern and gradient hatches (M1-16), tables (M1-17),
// viewports (M1-18), images and underlays (M1-19/20), text and MTEXT (M1-41).

import {
  bulgeArc,
  flatten,
  type EntityGeometry,
  type HatchEdge,
  type HatchLoop,
  type PolylineVertex,
  type Spline,
  type Vec2,
} from '@triya/engine';
import {
  PATH_A,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Z,
  type PrimitiveColor,
  type RenderPrimitive,
} from './types';

/** What every primitive of one entity shares, resolved from the entity and its layer. */
export interface Paint {
  readonly color: PrimitiveColor;
  /** Millimetres; undefined is the default lineweight. */
  readonly lineweight?: number;
}

/**
 * Spline flattening deviation as a fraction of the curve's size: 1e-4 keeps chords under a
 * pixel until the curve spans 10 000 px on screen.
 */
const SPLINE_DEVIATION = 1e-4;

const stroke = (path: number[], paint: Paint): RenderPrimitive => ({
  kind: 'stroke',
  path,
  color: paint.color,
  ...(paint.lineweight === undefined ? {} : { lineweight: paint.lineweight }),
});

/** Appends a polyline's segments (with bulge arcs) to a path, starting with a move. */
function polylinePath(path: number[], vertices: readonly PolylineVertex[], closed: boolean): void {
  if (vertices.length === 0) return;
  const first = vertices[0]!;
  path.push(PATH_M, first.x, first.y);
  const n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const v = vertices[i]!;
    const w = vertices[(i + 1) % vertices.length]!;
    if (v.bulge === 0 || (v.x === w.x && v.y === w.y)) {
      path.push(PATH_L, w.x, w.y);
    } else {
      const a = bulgeArc(v, w, v.bulge);
      path.push(
        PATH_A,
        a.center.x,
        a.center.y,
        a.radius,
        a.startAngle,
        a.startAngle + a.sweep,
        a.sweep > 0 ? 1 : 0,
      );
    }
  }
  if (closed) path.push(PATH_Z);
}

function size(points: readonly Vec2[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

function splinePath(path: number[], s: Spline, move: boolean): void {
  if (s.controlPoints.length < 2) return;
  const dev = Math.max(size(s.controlPoints) * SPLINE_DEVIATION, Number.MIN_VALUE);
  const { points } = flatten(s, dev);
  points.forEach((p, i) => path.push(i === 0 && move ? PATH_M : PATH_L, p.x, p.y));
}

/** A hatch boundary edge appended to the current loop. */
function edgePath(path: number[], e: HatchEdge, first: boolean): void {
  switch (e.type) {
    case 'line':
      if (first) path.push(PATH_M, e.start.x, e.start.y);
      path.push(PATH_L, e.end.x, e.end.y);
      return;
    case 'arc': {
      // A clockwise edge stores its angles negated (DXF HATCH boundary data).
      const a0 = e.ccw ? e.startAngle : -e.startAngle;
      const a1 = e.ccw ? e.endAngle : -e.endAngle;
      if (first)
        path.push(
          PATH_M,
          e.center.x + e.radius * Math.cos(a0),
          e.center.y + e.radius * Math.sin(a0),
        );
      path.push(PATH_A, e.center.x, e.center.y, e.radius, a0, a1, e.ccw ? 1 : 0);
      return;
    }
    case 'ellipse': {
      const rx = Math.hypot(e.majorAxis.x, e.majorAxis.y);
      const rot = Math.atan2(e.majorAxis.y, e.majorAxis.x);
      const a0 = e.ccw ? e.startAngle : -e.startAngle;
      const a1 = e.ccw ? e.endAngle : -e.endAngle;
      if (first) {
        const ux = Math.cos(a0) * rx;
        const uy = Math.sin(a0) * rx * e.ratio;
        path.push(
          PATH_M,
          e.center.x + ux * Math.cos(rot) - uy * Math.sin(rot),
          e.center.y + ux * Math.sin(rot) + uy * Math.cos(rot),
        );
      }
      path.push(PATH_E, e.center.x, e.center.y, rx, rx * e.ratio, rot, a0, a1, e.ccw ? 1 : 0);
      return;
    }
    case 'spline':
      splinePath(
        path,
        {
          kind: 'SPLINE',
          degree: e.degree,
          knots: e.knots,
          controlPoints: e.controlPoints,
          ...(e.weights ? { weights: e.weights } : {}),
        },
        first,
      );
      return;
  }
}

function loopPath(path: number[], loop: HatchLoop): void {
  if (loop.polyline) {
    polylinePath(path, loop.polyline.vertices, true);
    return;
  }
  const edges = loop.edges ?? [];
  edges.forEach((e, i) => edgePath(path, e, i === 0));
  if (edges.length) path.push(PATH_Z);
}

/** The primitives that draw one entity's geometry. */
export function tessellate(g: EntityGeometry, paint: Paint): RenderPrimitive[] {
  switch (g.kind) {
    case 'LINE':
      return [stroke([PATH_M, g.start.x, g.start.y, PATH_L, g.end.x, g.end.y], paint)];
    case 'XLINE':
    case 'RAY':
      return [
        {
          kind: 'infinite',
          base: g.base,
          direction: g.direction,
          both: g.kind === 'XLINE',
          color: paint.color,
          ...(paint.lineweight === undefined ? {} : { lineweight: paint.lineweight }),
        },
      ];
    case 'CIRCLE':
      return [
        stroke(
          [
            PATH_M,
            g.center.x + g.radius,
            g.center.y,
            PATH_A,
            g.center.x,
            g.center.y,
            g.radius,
            0,
            2 * Math.PI,
            1,
            PATH_Z,
          ],
          paint,
        ),
      ];
    case 'ARC': {
      let end = g.endAngle;
      while (end <= g.startAngle) end += 2 * Math.PI;
      const sx = g.center.x + g.radius * Math.cos(g.startAngle);
      const sy = g.center.y + g.radius * Math.sin(g.startAngle);
      return [
        stroke(
          [PATH_M, sx, sy, PATH_A, g.center.x, g.center.y, g.radius, g.startAngle, end, 1],
          paint,
        ),
      ];
    }
    case 'ELLIPSE': {
      const rx = Math.hypot(g.majorAxis.x, g.majorAxis.y);
      const rot = Math.atan2(g.majorAxis.y, g.majorAxis.x);
      let end = g.endParam;
      while (end <= g.startParam) end += 2 * Math.PI;
      const ux = Math.cos(g.startParam) * rx;
      const uy = Math.sin(g.startParam) * rx * g.ratio;
      const sx = g.center.x + ux * Math.cos(rot) - uy * Math.sin(rot);
      const sy = g.center.y + ux * Math.sin(rot) + uy * Math.cos(rot);
      return [
        stroke(
          [
            PATH_M,
            sx,
            sy,
            PATH_E,
            g.center.x,
            g.center.y,
            rx,
            rx * g.ratio,
            rot,
            g.startParam,
            end,
            1,
          ],
          paint,
        ),
      ];
    }
    case 'POINT':
      return [{ kind: 'point', x: g.position.x, y: g.position.y, color: paint.color }];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      // Widths draw as centre lines until the linetype and lineweight task (M1-13) adds
      // wide segments.
      const path: number[] = [];
      polylinePath(path, g.vertices, g.closed);
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'SPLINE': {
      const path: number[] = [];
      splinePath(path, g, true);
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'SOLID':
    case 'TRACE': {
      // DXF corner order: the outline runs 1–2–4–3.
      const [a, b, c, d] = g.corners;
      return [
        {
          kind: 'fill',
          path: [PATH_M, a.x, a.y, PATH_L, b.x, b.y, PATH_L, d.x, d.y, PATH_L, c.x, c.y, PATH_Z],
          color: paint.color,
        },
      ];
    }
    case '3DFACE': {
      const path: number[] = [];
      const c = g.corners;
      for (let i = 0; i < 4; i++) {
        if (g.hiddenEdges & (1 << i)) continue;
        const p = c[i]!;
        const q = c[(i + 1) % 4]!;
        path.push(PATH_M, p.x, p.y, PATH_L, q.x, q.y);
      }
      return path.length ? [stroke(path, paint)] : [];
    }
    case 'HATCH': {
      if (!g.solid || g.gradient) return []; // pattern and gradient fills: M1-16
      const path: number[] = [];
      for (const loop of g.loops) loopPath(path, loop);
      // Style 2 (ignore) fills only the outermost loop; normal and outer use odd parity.
      return path.length
        ? [{ kind: 'fill', path, color: paint.color, evenOdd: g.style !== 2 }]
        : [];
    }
    default:
      return [];
  }
}
