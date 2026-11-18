// An IMAGE's clip boundary (M5-04 part 4, IMAGECLIP): DXF 71 (1 rectangular, 2 polygonal), 91 and
// 14 (the vertices), 280 (clipping on) and 290 (inverted). The vertices are in the image's pixel
// coordinates centred on pixels, V counted down from the top edge, so pixel coordinate (x, y) is
// bitmap point (x + ½, y + ½) and the whole image is (−½, −½)–(width − ½, height − ½), the
// boundary AutoCAD writes for an unclipped image (render/src/image.ts pins the origin on the
// public corpus). A rectangle states two opposite corners; a polygon repeats its first vertex at
// the end, as AutoCAD writes it.
//
// Ambiguity: AutoCAD's help does not say what happens to a boundary drawn partly beyond the
// image; it is cut at the image's edges here (the common drafter expectation: the frame stays on
// the picture), and one that misses the image is refused.
import type { Vec2 } from '../geom/types';
import { toleranceForSize } from '../geom/tolerance';
import type { ImageGeometry } from '../model/types';
import { distinctVertices, signedArea2 } from './revcloud';

export type ImageClip = ImageGeometry['clip'];

/** DXF 70 bit 4: use the clipping boundary. */
const USE_CLIP = 4;

/** The whole image, as AutoCAD writes an unclipped one's boundary. */
export function fullImageClip(g: Pick<ImageGeometry, 'size'>): ImageClip {
  return {
    type: 'rectangle',
    vertices: [
      { x: -0.5, y: -0.5 },
      { x: g.size.x - 0.5, y: g.size.y - 0.5 },
    ],
    inverted: false,
  };
}

/**
 * A world point in the image's clip coordinates, or undefined when the image has no area
 * (its U and V parallel). World = position + U·X + V·(height − Y), X = x + ½, Y = y + ½.
 */
export function toImageClipCoordinates(g: ImageGeometry, p: Vec2): Vec2 | undefined {
  const { u, v } = g;
  const det = u.x * v.y - u.y * v.x;
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const dx = p.x - g.position.x;
  const dy = p.y - g.position.y;
  const x = (dx * v.y - dy * v.x) / det;
  const down = (u.x * dy - u.y * dx) / det;
  return { x: x - 0.5, y: g.size.y - down - 0.5 };
}

/** `poly` cut to where `keep` is not negative, `keep` linear (Sutherland–Hodgman). */
function cut(poly: readonly Vec2[], keep: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = keep(a);
    const db = keep(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * The clip a boundary drawn in the world gives the image: its points in the image's clip
 * coordinates, cut at the image's edges. `rectangle`: the boundary is IMAGECLIP's Rectangular,
 * stored as two corners when it runs along the image's pixel axes (AutoCAD's rectangular clip)
 * and as the polygon it is otherwise. Undefined when nothing of it lies on the image.
 */
export function imageClipFrom(
  g: ImageGeometry,
  world: readonly Vec2[],
  o: { rectangle: boolean; inverted: boolean },
): ImageClip | undefined {
  const pts: Vec2[] = [];
  for (const p of world) {
    const q = toImageClipCoordinates(g, p);
    if (!q) return undefined;
    pts.push(q);
  }
  const x0 = -0.5;
  const y0 = -0.5;
  const x1 = g.size.x - 0.5;
  const y1 = g.size.y - 0.5;
  let poly = cut(pts, (p) => p.x - x0);
  poly = cut(poly, (p) => x1 - p.x);
  poly = cut(poly, (p) => p.y - y0);
  poly = cut(poly, (p) => y1 - p.y);
  const tol = toleranceForSize(Math.max(1, g.size.x, g.size.y)).linear;
  poly = distinctVertices(poly, tol);
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
    if (onAxes) return { type: 'rectangle', vertices: [lo, hi], inverted: o.inverted };
  }
  return { type: 'polygon', vertices: [...poly, poly[0]!], inverted: o.inverted };
}

/** The image clipped to `clip`, clipping on and its display flags using the boundary. */
export function withImageClip(g: ImageGeometry, clip: ImageClip): ImageGeometry {
  return { ...g, clip, clipping: true, displayFlags: g.displayFlags | USE_CLIP };
}

/** The image with clipping on or off, its boundary kept. */
export function withImageClipping(g: ImageGeometry, on: boolean): ImageGeometry {
  return { ...g, clipping: on, displayFlags: on ? g.displayFlags | USE_CLIP : g.displayFlags };
}

/** The whole image shown again (IMAGECLIP Delete). */
export function withoutImageClip(g: ImageGeometry): ImageGeometry {
  return { ...g, clip: fullImageClip(g), clipping: false };
}
