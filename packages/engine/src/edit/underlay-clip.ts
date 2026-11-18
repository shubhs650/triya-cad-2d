// A PDF underlay's clip boundary (M5-04 part 9, PDFCLIP): DXF 11 (the vertices) and DXF 280 bit 1
// (clipping on). The vertices are in the underlay's own space, the page in inches before the
// underlay's scale and rotation (render/underlay.ts, input/underlay-snap.ts `underlayMatrix`):
// two vertices are opposite corners of a rectangle along the page, more a polygon.
//
// Settled for the common drafter expectation (AutoCAD's help does not say; noted in the PR):
// - a polygon is written without repeating its first vertex (AutoCAD's DXF reference counts
//   "more than 2" vertices as a polygon; every reader closes it, render and osnap included);
// - the boundary is not cut at the page's edges: the page's size is only in the PDF, which the
//   engine does not read, and what of the page lies outside a boundary shows nothing anyway;
// - Invert clip is left out: an underlay has no DXF group for an inverted boundary (neither
//   acad-ts nor ezdxf know one), so the save could not keep it.
import type { Vec2 } from '../geom/types';
import { toleranceForSize } from '../geom/tolerance';
import { applyPoint, invert } from '../geom/transform';
import { underlayMatrix } from '../input/underlay-snap';
import type { UnderlayGeometry } from '../model/types';
import { distinctVertices, signedArea2 } from './revcloud';

/** DXF 280 bit 1: clipping on. */
const UNDERLAY_CLIPPING = 1;

/** A point of the underlay's owner in the underlay's own space, or undefined when it is flat. */
export function toUnderlayCoordinates(g: UnderlayGeometry, p: Vec2): Vec2 | undefined {
  try {
    const q = applyPoint(invert(underlayMatrix(g)), p);
    return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The clip a boundary drawn in the world gives the underlay: its points in the underlay's
 * space. `rectangle`: the boundary is PDFCLIP's Rectangular, stored as two corners when it runs
 * along the page's axes and as the polygon it is otherwise (a turned underlay). Undefined when
 * the boundary encloses no area.
 */
export function underlayClipFrom(
  g: UnderlayGeometry,
  world: readonly Vec2[],
  o: { rectangle: boolean },
): Vec2[] | undefined {
  const pts: Vec2[] = [];
  for (const p of world) {
    const q = toUnderlayCoordinates(g, p);
    if (!q) return undefined;
    pts.push(q);
  }
  const size = Math.max(1, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const tol = toleranceForSize(size).linear;
  const poly = distinctVertices(pts, tol);
  if (poly.length < 3 || Math.abs(signedArea2(poly)) <= tol * tol) return undefined;
  if (o.rectangle && poly.length === 4) {
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const lo = { x: Math.min(...xs), y: Math.min(...ys) };
    const hi = { x: Math.max(...xs), y: Math.max(...ys) };
    const onAxes = poly.every(
      (p) =>
        (Math.abs(p.x - lo.x) <= tol || Math.abs(p.x - hi.x) <= tol) &&
        (Math.abs(p.y - lo.y) <= tol || Math.abs(p.y - hi.y) <= tol),
    );
    if (onAxes) return [lo, hi];
  }
  return poly;
}

/** The underlay clipped to `clip`, clipping on. */
export function withUnderlayClip(g: UnderlayGeometry, clip: readonly Vec2[]): UnderlayGeometry {
  return { ...g, clip, flags: g.flags | UNDERLAY_CLIPPING };
}

/** The underlay with clipping on or off, its boundary kept. */
export function withUnderlayClipping(g: UnderlayGeometry, on: boolean): UnderlayGeometry {
  return {
    ...g,
    flags: on ? g.flags | UNDERLAY_CLIPPING : g.flags & ~UNDERLAY_CLIPPING,
  };
}

/** The whole page shown again (PDFCLIP Delete): no boundary, clipping off. */
export function withoutUnderlayClip(g: UnderlayGeometry): UnderlayGeometry {
  return { ...g, clip: [], flags: g.flags & ~UNDERLAY_CLIPPING };
}
