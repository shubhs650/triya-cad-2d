// What the inquiry commands measure (M3-07): the area and perimeter of an object AREA's Object
// option takes, and of the polygon its points give, and how areas and volumes are written.
//
// AutoCAD 2024 Help, "AREA (Command)", Object: "You can calculate the area of circles, ellipses,
// splines, polylines, polygons, regions, and AutoCAD 3D solids." An open polyline or spline is
// measured "as if a line segment connects the start point and endpoint", that segment's length
// left out (AutoCAD then reports a Length, not a Perimeter). Regions (ACIS bodies Triya keeps
// unread) and solids are not measured here.
import { integrate, smoothSpans } from '../../geom/arclength';
import type { Curve, Polyline } from '../../geom/curves';
import { derivativeAt, domain, endPoint, pointAt, startPoint } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import type { EntityGeometry } from '../../model/types';
import { polylineArea, polylineLength } from '../../properties/measure';
import { formatDistance, formatNumber, type DrawingUnits } from '../units';

export interface Measured {
  readonly area: number;
  /** The perimeter, circumference, or an open object's length. */
  readonly perimeter: number;
  /** The word AutoCAD reports the perimeter under. */
  readonly label: 'Perimeter' | 'Circumference' | 'Length';
}

/** The polygon through `points`, closed back to the first. */
export function measurePolygon(points: readonly Vec2[]): Measured {
  const p: Polyline = {
    kind: 'LWPOLYLINE',
    closed: true,
    vertices: points.map((v) => ({ x: v.x, y: v.y, bulge: 0 })),
  };
  return { area: polylineArea(p), perimeter: polylineLength(p), label: 'Perimeter' };
}

/**
 * Length and enclosed area of a curve by Green's theorem (A = ½∮ x dy − y dx), closed by the
 * chord from its end back to its start when it is open.
 */
function measureCurve(c: Curve): { area: number; length: number } {
  let area = 0;
  let length = 0;
  for (const [a, b] of smoothSpans(c)) {
    length += integrate((t) => Math.hypot(derivativeAt(c, t).x, derivativeAt(c, t).y), a, b, 4);
    area += integrate(
      (t) => {
        const p = pointAt(c, t);
        const d = derivativeAt(c, t);
        return p.x * d.y - p.y * d.x;
      },
      a,
      b,
      4,
    );
  }
  const s = startPoint(c);
  const e = endPoint(c);
  area += e.x * s.y - s.x * e.y;
  return { area: Math.abs(area / 2), length };
}

/** A heavy polyline's drawn vertices as a lightweight polyline's. */
function asPolyline(g: { vertices: readonly Polyline['vertices'][number][]; closed: boolean }) {
  const p: Polyline = { kind: 'LWPOLYLINE', vertices: g.vertices, closed: g.closed };
  return p;
}

/** The area AREA Object reports for `g`, or undefined when it has none. */
export function measureObject(g: EntityGeometry): Measured | undefined {
  switch (g.kind) {
    case 'CIRCLE':
      return {
        area: Math.PI * g.radius * g.radius,
        perimeter: 2 * Math.PI * g.radius,
        label: 'Circumference',
      };
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const p = asPolyline(g);
      if (p.vertices.length < 2) return undefined;
      return {
        area: polylineArea(p),
        perimeter: polylineLength(p),
        label: p.closed ? 'Perimeter' : 'Length',
      };
    }
    case 'ELLIPSE': {
      const m = measureCurve(g);
      const full = Math.abs(domain(g).end - domain(g).start - 2 * Math.PI) < 1e-12;
      return { area: m.area, perimeter: m.length, label: full ? 'Perimeter' : 'Length' };
    }
    case 'SPLINE': {
      const m = measureCurve(g);
      return { area: m.area, perimeter: m.length, label: g.closed ? 'Perimeter' : 'Length' };
    }
    default:
      return undefined;
  }
}

/**
 * An area as AREA writes it: in square inches and square feet when lengths are feet and inches
 * (LUNITS 3 and 4: `288.0000 square in. (2.0000 square ft.)`), in the drawing's decimal places
 * otherwise (AutoCAD's help shows no fractional or scientific area; RTOS's decimal form at
 * LUPREC is taken, a fractional drawing's LUPREC counting places).
 */
export function areaText(area: number, u: DrawingUnits): string {
  if (u.lunits === 3 || u.lunits === 4) {
    return `${formatNumber(area, 4)} square in. (${formatNumber(area / 144, 4)} square ft.)`;
  }
  if (u.lunits === 1) return formatDistance(area, u);
  return formatNumber(area, u.luprec);
}

/** A volume as MEASUREGEOM Volume writes it, in cubic inches and feet as `areaText`. */
export function volumeText(volume: number, u: DrawingUnits): string {
  if (u.lunits === 3 || u.lunits === 4) {
    return `${formatNumber(volume, 4)} cubic in. (${formatNumber(volume / 1728, 4)} cubic ft.)`;
  }
  if (u.lunits === 1) return formatDistance(volume, u);
  return formatNumber(volume, u.luprec);
}
