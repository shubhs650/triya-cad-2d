// What CIRCLE, ARC and LINE (M3-01) drag while they wait for their last value: the circle or arc the
// cursor would give, drawn as the command will draw it (AutoCAD drags it, DRAGMODE Auto). The
// prompt carries the construction and what is fixed so far (`Sketch`); the front-end calls
// `sketchGeometry` with the cursor, which reads the cursor as the prompt reads a pick (a point,
// its distance from the prompt's base, or its angle from it), so the preview is the answer.
import {
  arcStartCenterAngle,
  arcStartCenterChord,
  arcStartCenterEnd,
  arcStartDirectionEnd,
  arcStartEndAngle,
  arcStartEndCenter,
  arcStartEndRadius,
  arcThrough3,
  dxfArc,
} from '../../geom/construct';
import type { Circle } from '../../geom/curves';
import {
  circleThroughItems,
  itemPoint,
  lineBetween,
  type DeferredItem,
  type DeferredPick,
} from '../../geom/deferred';
import type { BulgeArc } from '../../geom/eval';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance, midpoint, sub } from '../../geom/vec';
import type { EntityGeometry } from '../../model/types';
import { isShapeSketch, shapeSketchGeometry, type ShapeSketch } from './sketch-shapes';

/** A circle or arc being drawn, what the cursor gives it named by the construction. */
export type Sketch =
  /** CIRCLE: the cursor on the circle (`diameter`: the cursor's distance is the diameter). */
  | { readonly shape: 'circle'; readonly center: Vec2; readonly diameter?: boolean }
  /** CIRCLE 2P: the cursor is the diameter's other end. */
  | { readonly shape: 'circle2p'; readonly a: Vec2 }
  /** CIRCLE 3P: the cursor is the third point; the first two may be deferred tangents. */
  | { readonly shape: 'circle3p'; readonly a: DeferredItem; readonly b: DeferredItem }
  /** LINE from a deferred tangent or perpendicular (M3-01 part 2): the cursor is the end. */
  | { readonly shape: 'line'; readonly from: DeferredPick }
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
  /** ELLIPSE, XLINE, RAY and DONUT (M3-01 part 4, `sketch-shapes.ts`). */
  | ShapeSketch;

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
  if (isShapeSketch(s)) return shapeSketchGeometry(s, cursor);
  switch (s.shape) {
    case 'circle': {
      const d = distance(s.center, cursor);
      return circleOf(s.center, s.diameter ? d / 2 : d);
    }
    case 'circle2p':
      return circleOf(midpoint(s.a, cursor), distance(s.a, cursor) / 2);
    case 'circle3p':
      return circleThroughItems(
        [s.a, s.b, cursor],
        sketchTolerance(itemPoint(s.a), itemPoint(s.b), cursor),
      );
    case 'line': {
      const l = lineBetween(s.from, cursor, sketchTolerance(s.from.pick, cursor));
      return l && { kind: 'LINE', start: l.start, end: l.end };
    }
    default: {
      const arc = sketchArc(s, cursor);
      return arc && dxfArc(arc);
    }
  }
}

/** The arc an arc sketch makes with the cursor at `cursor`. */
export function sketchArc(
  s: Exclude<Sketch, ShapeSketch | { shape: 'circle' | 'circle2p' | 'circle3p' | 'line' }>,
  cursor: Vec2,
): BulgeArc | undefined {
  switch (s.shape) {
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
