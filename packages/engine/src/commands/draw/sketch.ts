// What CIRCLE and ARC (M3-01) drag while they wait for their last value: the circle or arc the
// cursor would give, drawn as the command will draw it (AutoCAD drags it, DRAGMODE Auto); PLINE,
// RECTANG and POLYGON (part 3) drag the segment, rectangle or polygon the same way. The
// prompt carries the construction and what is fixed so far (`Sketch`); the front-end calls
// `sketchGeometry` with the cursor, which reads the cursor as the prompt reads a pick (a point,
// its distance from the prompt's base, or its angle from it), so the preview is the answer.
import {
  arcEnd,
  arcStartCenterAngle,
  arcStartCenterChord,
  arcStartCenterEnd,
  arcStartDirectionEnd,
  arcStartEndAngle,
  arcStartEndCenter,
  arcStartEndRadius,
  arcThrough3,
  circleThrough3,
  dxfArc,
} from '../../geom/construct';
import type { BulgeVertex, Circle } from '../../geom/curves';
import type { BulgeArc } from '../../geom/eval';
import {
  bulgeOf,
  polygonAbout,
  polygonOnEdge,
  rectangleVertices,
  type RectangleCorners,
} from '../../geom/shapes';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance, dot, fromAngle, midpoint, perp, sub } from '../../geom/vec';
import type { EntityGeometry, LwPolylineGeometry, PolylineVertex } from '../../model/types';

/** A circle or arc being drawn, what the cursor gives it named by the construction. */
export type Sketch =
  /** CIRCLE: the cursor on the circle (`diameter`: the cursor's distance is the diameter). */
  | { readonly shape: 'circle'; readonly center: Vec2; readonly diameter?: boolean }
  /** CIRCLE 2P: the cursor is the diameter's other end. */
  | { readonly shape: 'circle2p'; readonly a: Vec2 }
  /** CIRCLE 3P: the cursor is the third point. */
  | { readonly shape: 'circle3p'; readonly a: Vec2; readonly b: Vec2 }
  /** ARC 3P: the cursor is the end. */
  | { readonly shape: 'arc3p'; readonly a: Vec2; readonly b: Vec2 }
  /** ARC from a start and centre: the cursor gives the end, the included angle or the chord. */
  | {
      readonly shape: 'arcSC';
      readonly by: 'end' | 'angle' | 'chord';
      readonly start: Vec2;
      readonly center: Vec2;
    }
  /** ARC from a start and end: the cursor gives the centre, angle, direction or radius. */
  | {
      readonly shape: 'arcSE';
      readonly by: 'center' | 'angle' | 'direction' | 'radius';
      readonly start: Vec2;
      readonly end: Vec2;
    }
  /** ARC continuing tangent, or Start, Direction, End: the cursor is the end. */
  | { readonly shape: 'arcTangent'; readonly start: Vec2; readonly direction: Vec2 }
  /**
   * PLINE's arc from a start and an included angle (part 3): the cursor gives the end, the
   * centre, or with `radius` the chord's direction.
   */
  | {
      readonly shape: 'arcSA';
      readonly by: 'end' | 'center' | 'chord';
      readonly start: Vec2;
      readonly angle: number;
      readonly radius?: number;
    }
  /** PLINE's arc from a start and a radius: the cursor is the end. */
  | { readonly shape: 'arcSR'; readonly start: Vec2; readonly radius: number }
  /**
   * PLINE's next segment (part 3): a line from `from` to the cursor, or the arc `arc` makes
   * with it, `startWidth` wide at `from` and `endWidth` at its end.
   */
  | {
      readonly shape: 'pline';
      readonly from: Vec2;
      readonly arc?: ArcSketch;
      readonly startWidth: number;
      readonly endWidth: number;
    }
  /**
   * RECTANG: the cursor is the other corner, or with `size` picks which way from `first` the
   * rectangle of that length and width lies.
   */
  | {
      readonly shape: 'rectangle';
      readonly first: Vec2;
      readonly rotation: number;
      readonly corners?: RectangleCorners;
      readonly width?: number;
      readonly size?: { readonly length: number; readonly width: number };
    }
  /** POLYGON about a centre: the cursor gives the radius and turns it. */
  | {
      readonly shape: 'polygon';
      readonly center: Vec2;
      readonly sides: number;
      readonly inscribed: boolean;
    }
  /** POLYGON Edge: the cursor is the edge's second endpoint. */
  | { readonly shape: 'polygonEdge'; readonly a: Vec2; readonly sides: number };

/** The sketches that make an arc (their shapes start `arc`). */
export type ArcSketch = Extract<Sketch, { shape: `arc${string}` }>;

/** The tolerance for constructing from these points (their magnitude, `toleranceForSize`). */
export function sketchTolerance(...points: readonly Vec2[]): Tolerance {
  let m = 0;
  for (const p of points) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return toleranceForSize(m);
}

/**
 * The circle or arc a sketch makes with the cursor at `cursor`; undefined where none is (the
 * cursor on the start, three collinear points).
 */
export function sketchGeometry(s: Sketch, cursor: Vec2): EntityGeometry | undefined {
  switch (s.shape) {
    case 'circle': {
      const d = distance(s.center, cursor);
      return circleOf(s.center, s.diameter ? d / 2 : d);
    }
    case 'circle2p':
      return circleOf(midpoint(s.a, cursor), distance(s.a, cursor) / 2);
    case 'circle3p':
      return circleThrough3(s.a, s.b, cursor, sketchTolerance(s.a, s.b, cursor));
    case 'pline':
      return plineSegment(s, cursor);
    case 'rectangle':
      return rectangleSketch(s, cursor);
    case 'polygon': {
      const r = distance(s.center, cursor);
      if (r <= sketchTolerance(s.center, cursor).linear) return undefined;
      return closed(polygonAbout(s.center, r, s.sides, s.inscribed, cursor));
    }
    case 'polygonEdge':
      if (distance(s.a, cursor) <= sketchTolerance(s.a, cursor).linear) return undefined;
      return closed(polygonOnEdge(s.a, cursor, s.sides));
    default: {
      const arc = sketchArc(s, cursor);
      return arc && dxfArc(arc);
    }
  }
}

/** The arc an arc sketch makes with the cursor at `cursor`. */
export function sketchArc(s: ArcSketch, cursor: Vec2): BulgeArc | undefined {
  switch (s.shape) {
    case 'arcSA': {
      const tol = sketchTolerance(s.start, cursor);
      if (s.by === 'end') return arcStartEndAngle(s.start, cursor, s.angle, tol);
      if (s.by === 'center') return arcStartCenterAngle(s.start, cursor, s.angle, tol);
      const end = chordEnd(s.start, s.angle, s.radius ?? 0, angleOf(sub(cursor, s.start)));
      return arcStartEndAngle(s.start, end, s.angle, tol);
    }
    case 'arcSR':
      return arcStartEndRadius(s.start, cursor, s.radius, sketchTolerance(s.start, cursor));
    case 'arc3p':
      return arcThrough3(s.a, s.b, cursor, sketchTolerance(s.a, s.b, cursor));
    case 'arcTangent':
      return arcStartDirectionEnd(s.start, s.direction, cursor, sketchTolerance(s.start, cursor));
    case 'arcSC': {
      const tol = sketchTolerance(s.start, s.center, cursor);
      if (s.by === 'end') return arcStartCenterEnd(s.start, s.center, cursor, tol);
      if (s.by === 'angle') {
        return arcStartCenterAngle(s.start, s.center, angleOf(sub(cursor, s.center)), tol);
      }
      return arcStartCenterChord(s.start, s.center, distance(s.start, cursor), tol);
    }
    case 'arcSE': {
      const tol = sketchTolerance(s.start, s.end, cursor);
      switch (s.by) {
        case 'center':
          return arcStartEndCenter(s.start, s.end, cursor, tol);
        case 'angle':
          return arcStartEndAngle(s.start, s.end, angleOf(sub(cursor, s.start)), tol);
        case 'direction':
          return arcStartDirectionEnd(s.start, sub(cursor, s.start), s.end, tol);
        case 'radius':
          return arcStartEndRadius(s.start, s.end, distance(s.end, cursor), tol);
      }
    }
  }
}

function circleOf(center: Vec2, radius: number): Circle | undefined {
  return radius > 0 ? { kind: 'CIRCLE', center, radius } : undefined;
}

/**
 * Where an arc of `radius` turning through `angle` from `start` ends when its chord runs at
 * `direction` (PLINE's arc Angle then Radius: "Specify direction of chord for arc").
 */
export function chordEnd(start: Vec2, angle: number, radius: number, direction: number): Vec2 {
  const chord = 2 * Math.abs(radius) * Math.abs(Math.sin(angle / 2));
  const d = fromAngle(direction, chord);
  return { x: start.x + d.x, y: start.y + d.y };
}

/** PLINE's segment to the cursor as a two-vertex polyline, as it will be drawn. */
function plineSegment(s: Extract<Sketch, { shape: 'pline' }>, cursor: Vec2) {
  let bulge = 0;
  let end = cursor;
  if (s.arc) {
    const arc = sketchArc(s.arc, cursor);
    if (!arc) return undefined;
    bulge = bulgeOf(arc);
    end = arcEnd(arc).point;
  } else if (distance(s.from, cursor) <= sketchTolerance(s.from, cursor).linear) return undefined;
  const widths =
    s.startWidth > 0 || s.endWidth > 0
      ? { startWidth: s.startWidth, endWidth: s.endWidth }
      : undefined;
  const vertices: PolylineVertex[] = [
    { x: s.from.x, y: s.from.y, bulge, ...widths },
    { x: end.x, y: end.y, bulge: 0, ...widths },
  ];
  const g: LwPolylineGeometry = { kind: 'LWPOLYLINE', vertices, closed: false };
  return g;
}

function rectangleSketch(s: Extract<Sketch, { shape: 'rectangle' }>, cursor: Vec2) {
  const u = fromAngle(s.rotation);
  const d = sub(cursor, s.first);
  let length = dot(d, u);
  let width = dot(d, perp(u));
  if (s.size) {
    length = (length < 0 ? -1 : 1) * s.size.length;
    width = (width < 0 ? -1 : 1) * s.size.width;
  }
  const tol = sketchTolerance(s.first, cursor);
  if (Math.abs(length) <= tol.linear || Math.abs(width) <= tol.linear) return undefined;
  return closed(rectangleVertices(s.first, length, width, s.rotation, s.corners, tol), s.width);
}

/** A closed LWPOLYLINE through `vertices`, `width` wide throughout when given. */
export function closed(vertices: readonly BulgeVertex[], width?: number): LwPolylineGeometry {
  return {
    kind: 'LWPOLYLINE',
    vertices,
    closed: true,
    ...(width !== undefined && width > 0 && { constantWidth: width }),
  };
}
