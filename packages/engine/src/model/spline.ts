// The curve a SPLINE entity or a hatch spline edge draws (M1-47): the NURBS it stores, or,
// for one stored as fit data alone (R2013+ DWGs, spline leaders), the cubic AutoCAD
// interpolates through its fit points (`fitSpline`). Shared by the spatial index, the
// renderer and hatch boundaries so all three see the same curve.

import type { Spline } from '../geom/curves';
import { fitSpline, type KnotParameterization } from '../geom/fit';
import { validateSpline } from '../geom/nurbs';
import type { Vec2 } from '../geom/types';

/** What SplineGeometry and a hatch spline edge have in common. */
export interface SplineData {
  readonly degree: number;
  readonly knots: readonly number[];
  readonly controlPoints: readonly Vec2[];
  readonly weights?: readonly number[] | undefined;
  readonly fitPoints?: readonly Vec2[] | undefined;
  readonly startTangent?: Vec2 | undefined;
  readonly endTangent?: Vec2 | undefined;
  readonly closed?: boolean | undefined;
  readonly knotParameterization?: KnotParameterization | undefined;
}

// Geometry is immutable, so one interpolation per stored spline is enough.
const fitted = new WeakMap<SplineData, Spline | null>();

/** The NURBS to draw and bound, or undefined when neither the NURBS nor the fit data is usable. */
export function splineCurve(s: SplineData): Spline | undefined {
  const own: Spline = {
    kind: 'SPLINE',
    degree: s.degree,
    knots: s.knots,
    controlPoints: s.controlPoints,
    ...(s.weights ? { weights: s.weights } : {}),
  };
  try {
    validateSpline(own);
    return own;
  } catch {
    // Not a NURBS: fall through to the fit data.
  }
  if (!s.fitPoints || s.fitPoints.length < 2) return undefined;
  let curve = fitted.get(s);
  if (curve === undefined) {
    curve =
      fitSpline({
        fitPoints: s.fitPoints,
        startTangent: s.startTangent,
        endTangent: s.endTangent,
        closed: s.closed,
        parameterization: s.knotParameterization,
      }) ?? null;
    fitted.set(s, curve);
  }
  return curve ?? undefined;
}
