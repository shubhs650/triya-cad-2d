// The SPLINE a SPLINE command in progress makes (M3-01 part 5), shared by the command and its
// drag preview so that what is dragged is what is drawn.
//
// Fit: AutoCAD's cubic through the fit points (`fitSpline`, M1-47), stored the way AutoCAD
// stores it, fit data and the NURBS computed from it side by side; end tangents are kept as
// unit vectors. A fit tolerance is stored but the curve still interpolates (fit.ts: AutoCAD's
// approximation is undocumented). CV: the uniform B-spline on the vertices (`controlSpline`),
// periodic when closed.
import { controlSpline } from '../../geom/control-spline';
import { fitSpline, type KnotParameterization } from '../../geom/fit';
import type { Vec2 } from '../../geom/types';
import type { SplineGeometry } from '../../model/types';

/** A spline being drawn by fit points. */
export interface FitSplineSpec {
  readonly method: 'fit';
  readonly points: readonly Vec2[];
  readonly knots: KnotParameterization;
  readonly startTangent?: Vec2 | undefined;
  readonly endTangent?: Vec2 | undefined;
  readonly tolerance: number;
  readonly closed: boolean;
}

/** A spline being drawn by control vertices. */
export interface CvSplineSpec {
  readonly method: 'cv';
  readonly points: readonly Vec2[];
  readonly degree: number;
  readonly closed: boolean;
}

export type SplineSpec = FitSplineSpec | CvSplineSpec;

const unit = (v: Vec2 | undefined): Vec2 | undefined => {
  const l = v ? Math.hypot(v.x, v.y) : 0;
  return v && l > 0 ? { x: v.x / l, y: v.y / l } : undefined;
};

/** The SPLINE entity geometry the spec makes, or undefined while it makes no curve. */
export function splineOf(s: SplineSpec): SplineGeometry | undefined {
  if (s.method === 'cv') {
    const c = controlSpline(s.points, s.degree, s.closed);
    if (!c) return undefined;
    return {
      kind: 'SPLINE',
      degree: c.degree,
      knots: c.knots,
      controlPoints: c.controlPoints,
      closed: s.closed,
      periodic: s.closed,
    };
  }
  // Points picked twice in a row add nothing (fitSpline skips them too).
  const points: Vec2[] = [];
  for (const p of s.points) {
    const q = points[points.length - 1];
    if (!q || q.x !== p.x || q.y !== p.y) points.push(p);
  }
  const startTangent = unit(s.startTangent);
  const endTangent = s.closed ? undefined : unit(s.endTangent);
  const c = fitSpline({
    fitPoints: points,
    startTangent,
    endTangent,
    closed: s.closed,
    parameterization: s.knots,
    tolerance: s.tolerance,
  });
  if (!c) return undefined;
  return {
    kind: 'SPLINE',
    degree: c.degree,
    knots: c.knots,
    controlPoints: c.controlPoints,
    fitPoints: points,
    ...(startTangent && { startTangent }),
    ...(endTangent && { endTangent }),
    ...(s.knots !== 'chord' && { knotParameterization: s.knots }),
    ...(s.tolerance > 0 && { fitTolerance: s.tolerance }),
    closed: s.closed,
    periodic: false,
  };
}

/**
 * SPLINE's drag (M3-01 part 5): the spline with the cursor as its next point, or as the
 * direction of its start or end tangent while that is asked for.
 */
export interface SplineSketch {
  readonly shape: 'spline';
  readonly spec: SplineSpec;
  readonly cursor: 'point' | 'startTangent' | 'endTangent';
}

export function splineSketch(s: SplineSketch, cursor: Vec2): SplineGeometry | undefined {
  const { spec } = s;
  const pts = spec.points;
  if (s.cursor === 'point') return splineOf({ ...spec, points: [...pts, cursor] });
  if (spec.method !== 'fit' || pts.length === 0) return undefined;
  const from = s.cursor === 'startTangent' ? pts[0]! : pts[pts.length - 1]!;
  const t = { x: cursor.x - from.x, y: cursor.y - from.y };
  return splineOf(
    s.cursor === 'startTangent' ? { ...spec, startTangent: t } : { ...spec, endTangent: t },
  );
}
