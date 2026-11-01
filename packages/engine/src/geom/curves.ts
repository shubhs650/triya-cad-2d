// Curve shapes the geometry kernel works on. They are the planar part of the model's entity
// geometry (model/types.ts extends them with out-of-plane data), so an entity's `geom` can be
// passed to every kernel function as is.
//
// Every curve has a parameter domain (see `domain` in eval.ts):
//   LINE        t ∈ [0, 1]                    start + t·(end − start)
//   RAY         t ∈ [0, ∞)                    base + t·unit(direction)
//   XLINE       t ∈ (−∞, ∞)                   base + t·unit(direction)
//   CIRCLE      t ∈ [0, 2π]                   angle from +X
//   ARC         t ∈ [startAngle, startAngle + sweep]   angle, CCW, not wrapped
//   ELLIPSE     t ∈ [startParam, startParam + sweep]   eccentric anomaly, CCW
//   LWPOLYLINE  t ∈ [0, segmentCount]         segment i spans [i, i + 1]
//   SPLINE      t ∈ [knots[degree], knots[controlPoints.length]]

import type { Vec2 } from './types';

export interface Line {
  readonly kind: 'LINE';
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface Ray {
  readonly kind: 'RAY';
  readonly base: Vec2;
  readonly direction: Vec2;
}

export interface Xline {
  readonly kind: 'XLINE';
  readonly base: Vec2;
  readonly direction: Vec2;
}

export interface Circle {
  readonly kind: 'CIRCLE';
  readonly center: Vec2;
  readonly radius: number;
}

/** Angles in radians; the arc runs counter-clockwise from start to end (DXF ARC). */
export interface Arc {
  readonly kind: 'ARC';
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/**
 * DXF ELLIPSE: `majorAxis` is the vector from the centre to the end of the major axis, `ratio`
 * is minor/major (0 < ratio ≤ 1); the minor axis is `ratio · perp(majorAxis)`, perp being a
 * 90° CCW turn. Parameters are eccentric anomalies, counter-clockwise.
 */
export interface Ellipse {
  readonly kind: 'ELLIPSE';
  readonly center: Vec2;
  readonly majorAxis: Vec2;
  readonly ratio: number;
  readonly startParam: number;
  readonly endParam: number;
}

export interface BulgeVertex {
  readonly x: number;
  readonly y: number;
  /** tan(θ/4) of the included angle θ of the arc to the next vertex; > 0 is CCW, 0 straight. */
  readonly bulge: number;
}

export interface Polyline {
  readonly kind: 'LWPOLYLINE';
  readonly vertices: readonly BulgeVertex[];
  readonly closed: boolean;
}

/** NURBS: knots.length = controlPoints.length + degree + 1; weights only if rational. */
export interface Spline {
  readonly kind: 'SPLINE';
  readonly degree: number;
  readonly knots: readonly number[];
  readonly controlPoints: readonly Vec2[];
  readonly weights?: readonly number[];
}

export type Curve = Line | Ray | Xline | Circle | Arc | Ellipse | Polyline | Spline;

/** Curves with a finite length (everything but RAY and XLINE). */
export type BoundedCurve = Exclude<Curve, Ray | Xline>;
