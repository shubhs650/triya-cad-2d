// What ELLIPSE, XLINE, RAY and DONUT (M3-01 part 4) drag while they wait for a value: the shape
// the cursor would give, made by the same construction the command makes on the answer
// (`geom/shapes.ts`), so the preview is the answer. Kept apart from `sketch.ts`'s circles and
// arcs; `sketchGeometry` hands these shapes here.
import { TAU } from '../../geom/angle';
import {
  angleFromAxis,
  bisector,
  donutOf,
  ellipseOf,
  offsetXline,
  otherFromRotation,
  parameterAtAngle,
  xlineThrough,
  type EllipseAxes,
  type StraightLine,
} from '../../geom/ellipse-xline';
import { toleranceForSize, type Tolerance } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance, sub } from '../../geom/vec';
import type { EntityGeometry } from '../../model/types';

export type ShapeSketch =
  /**
   * ELLIPSE's second axis: the cursor's distance from the centre is half of it (`distance`), or
   * its angle from the centre the rotation about the first axis (`rotation`).
   */
  | {
      readonly shape: 'ellipse';
      readonly center: Vec2;
      readonly axis: Vec2;
      readonly by: 'distance' | 'rotation';
    }
  /**
   * ELLIPSE Arc's angles: the whole ellipse while the start is asked; from `start` (first-axis
   * parameter, and its angle `startAngle`) to the cursor's end angle, end parameter or included
   * angle after it.
   */
  | {
      readonly shape: 'ellipseArc';
      readonly axes: EllipseAxes;
      readonly start?: { readonly u: number; readonly angle: number };
      readonly by?: 'angle' | 'parameter' | 'included';
    }
  /** XLINE through `base` and the cursor. */
  | { readonly shape: 'xline'; readonly base: Vec2 }
  /** XLINE Hor, Ver, Ang and Offset Through: along `direction` through the cursor. */
  | { readonly shape: 'xlineDirection'; readonly direction: Vec2 }
  /** XLINE Bisect: halving the angle at `vertex` from `start` to the cursor. */
  | { readonly shape: 'xlineBisect'; readonly vertex: Vec2; readonly start: Vec2 }
  /** XLINE Offset: parallel to `line` at `distance`, on the cursor's side. */
  | { readonly shape: 'xlineOffset'; readonly line: StraightLine; readonly distance: number }
  /** RAY from `base` through the cursor. */
  | { readonly shape: 'ray'; readonly base: Vec2 }
  /** DONUT centred on the cursor. */
  | { readonly shape: 'donut'; readonly inside: number; readonly outside: number };

const SHAPES: ReadonlySet<string> = new Set([
  'ellipse',
  'ellipseArc',
  'xline',
  'xlineDirection',
  'xlineBisect',
  'xlineOffset',
  'ray',
  'donut',
]);

export const isShapeSketch = (s: { readonly shape: string }): s is ShapeSketch =>
  SHAPES.has(s.shape);

function tolOf(...points: readonly Vec2[]): Tolerance {
  let m = 0;
  for (const p of points) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return toleranceForSize(m);
}

/** The ellipse ELLIPSE makes from its axes, with `other` from the cursor as the prompt reads it. */
export function ellipseOther(
  s: Extract<ShapeSketch, { shape: 'ellipse' }>,
  cursor: Vec2,
): number | undefined {
  return s.by === 'distance'
    ? distance(s.center, cursor)
    : otherFromRotation(s.axis, angleOf(sub(cursor, s.center)));
}

/**
 * ELLIPSE Arc's end parameter for an answer: an angle from the first axis, a parameter, or an
 * included angle from the start angle.
 */
export function arcEndParameter(
  axes: EllipseAxes,
  start: { readonly u: number; readonly angle: number },
  by: 'angle' | 'parameter' | 'included',
  value: number,
): number {
  if (by === 'parameter') return value;
  const angle = by === 'included' ? start.angle + value : value;
  return parameterAtAngle(axes, angle);
}

export function shapeSketchGeometry(s: ShapeSketch, cursor: Vec2): EntityGeometry | undefined {
  switch (s.shape) {
    case 'ellipse': {
      const other = ellipseOther(s, cursor);
      return other === undefined
        ? undefined
        : ellipseOf({ center: s.center, axis: s.axis, other }, tolOf(s.center, cursor));
    }
    case 'ellipseArc': {
      const tol = tolOf(s.axes.center, cursor);
      if (!s.start || !s.by) return ellipseOf(s.axes, tol);
      // The cursor reads as the prompt reads a pick: its angle from the first axis (an end
      // angle or parameter), or its world angle from the centre (an included angle).
      const value =
        s.by === 'included' ? angleOf(sub(cursor, s.axes.center)) : angleFromAxis(s.axes, cursor);
      const u1 = arcEndParameter(s.axes, s.start, s.by, value);
      return ellipseOf(s.axes, tol, s.start.u, u1 <= s.start.u ? u1 + TAU : u1);
    }
    case 'xline':
      return xlineThrough(s.base, sub(cursor, s.base), tolOf(s.base, cursor));
    case 'xlineDirection':
      return xlineThrough(cursor, s.direction, tolOf(cursor));
    case 'xlineBisect':
      return bisector(s.vertex, s.start, cursor, tolOf(s.vertex, s.start, cursor));
    case 'xlineOffset':
      return offsetXline(s.line, cursor, s.distance, tolOf(s.line.point, cursor));
    case 'ray': {
      const x = xlineThrough(s.base, sub(cursor, s.base), tolOf(s.base, cursor));
      return x && { kind: 'RAY', base: x.base, direction: x.direction };
    }
    case 'donut': {
      const d = donutOf(cursor, s.inside, s.outside);
      return {
        kind: 'LWPOLYLINE',
        vertices: d.vertices,
        closed: true,
        constantWidth: d.width,
      };
    }
  }
}
