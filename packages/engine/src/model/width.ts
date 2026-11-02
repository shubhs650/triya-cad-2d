// Polyline widths with their defaults applied (M1-46): an LWPOLYLINE vertex without its own
// widths takes the constant width (DXF 43), a POLYLINE vertex the POLYLINE's 40/41 defaults.
// A 3D polyline has no width.

import type { WideVertex } from '../geom/width';
import type { LwPolylineGeometry, PolylineGeometry } from './types';

/** The vertices with resolved widths, or undefined when no segment has any width. */
export function polylineWidths(
  g: LwPolylineGeometry | PolylineGeometry,
): readonly WideVertex[] | undefined {
  if (g.kind === 'POLYLINE' && g.is3d) return undefined;
  const start = g.kind === 'LWPOLYLINE' ? (g.constantWidth ?? 0) : (g.startWidth ?? 0);
  const end = g.kind === 'LWPOLYLINE' ? (g.constantWidth ?? 0) : (g.endWidth ?? 0);
  let wide = false;
  const out = g.vertices.map((v) => {
    const w: WideVertex = {
      x: v.x,
      y: v.y,
      bulge: v.bulge,
      startWidth: v.startWidth ?? start,
      endWidth: v.endWidth ?? end,
    };
    if (w.startWidth !== 0 || w.endWidth !== 0) wide = true;
    return w;
  });
  return wide ? out : undefined;
}
