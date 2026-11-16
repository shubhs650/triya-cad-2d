// HATCH's Retain boundary (M4-07 part 2; AutoCAD 2024 Help, "-HATCH (Command)", Advanced,
// "Retain Boundary": "Specifies whether to add the temporary boundary objects to the drawing
// after hatching is completed"; HPBOUNDRETAIN): each loop a pick point found becomes an object.
// A loop of lines and arcs is a closed polyline, as BOUNDARY makes with its Polyline object
// type (a whole circle as two half circles, a polyline needing two vertices). A loop with an
// elliptical or spline edge cannot be one polyline; AutoCAD makes a region of it, which Triya
// cannot write (a REGION holds ACIS data, PRD non-goal 1), so its edges are kept as objects of
// their own (ellipse, spline, line, arc), which still outline the area.
import { TAU } from '../geom/angle';
import type { Vec2 } from '../geom/types';
import type { EntityGeometry, HatchEdge, HatchLoop, PolylineVertex } from '../model/types';
import { hatchEdgeCurve } from './trim-edges';

type ArcEdge = Extract<HatchEdge, { type: 'arc' }>;

const norm = (a: number): number => {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
};

/** Where an arc edge starts as the loop walks it, and the angle it sweeps (signed). */
function arcWalk(e: ArcEdge): { start: Vec2; sweep: number } {
  // A clockwise edge stores its angles negated (DXF 73 = 0): it is walked from −start.
  const from = e.ccw ? e.startAngle : -e.startAngle;
  const full = Math.abs(e.endAngle - e.startAngle) >= TAU - 1e-12;
  const sweep = full ? TAU : norm(e.endAngle - e.startAngle);
  return {
    start: { x: e.center.x + e.radius * Math.cos(from), y: e.center.y + e.radius * Math.sin(from) },
    sweep: e.ccw ? sweep : -sweep,
  };
}

/** The objects that keep a loop's outline once the hatch is made. */
export function retainedBoundary(loop: HatchLoop): EntityGeometry[] {
  if (loop.polyline) {
    return [{ kind: 'LWPOLYLINE', closed: true, vertices: loop.polyline.vertices }];
  }
  const edges = loop.edges ?? [];
  if (edges.length === 0) return [];
  if (!edges.every((e) => e.type === 'line' || e.type === 'arc')) {
    return edges.flatMap((e): EntityGeometry[] => {
      const c = hatchEdgeCurve(e);
      if (!c) return [];
      return c.kind === 'SPLINE' ? [{ ...c, closed: false, periodic: false }] : [c];
    });
  }
  const vertices: PolylineVertex[] = [];
  for (const e of edges) {
    if (e.type === 'line') {
      vertices.push({ x: e.start.x, y: e.start.y, bulge: 0 });
      continue;
    }
    const { start, sweep } = arcWalk(e);
    if (Math.abs(sweep) < TAU - 1e-12) {
      vertices.push({ x: start.x, y: start.y, bulge: Math.tan(sweep / 4) });
      continue;
    }
    // A whole circle: two half circles.
    const s = Math.sign(sweep);
    const opposite = { x: 2 * e.center.x - start.x, y: 2 * e.center.y - start.y };
    vertices.push({ x: start.x, y: start.y, bulge: s }, { ...opposite, bulge: s });
  }
  return [{ kind: 'LWPOLYLINE', closed: true, vertices }];
}
