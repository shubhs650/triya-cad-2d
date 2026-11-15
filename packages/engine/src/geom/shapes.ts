// The closed shapes RECTANG and POLYGON draw (M3-01), as the vertices of the LWPOLYLINE each
// makes (AutoCAD 2024 Help, "RECTANG (Command)", "POLYGON (Command)"), and the bulge of a drawn
// arc for PLINE's arc segments.
import type { BulgeVertex } from './curves';
import type { BulgeArc } from './eval';
import type { Tolerance } from './tolerance';
import type { Vec2 } from './types';
import { add, angleOf, distance, fromAngle, midpoint, normalize, perp, scale, sub } from './vec';

/** A polyline vertex's bulge for an arc drawn from it (`sweep` signed, |sweep| < 2π). */
export const bulgeOf = (a: BulgeArc): number => Math.tan(a.sweep / 4);

/** How RECTANG cuts its corners: rounded (Fillet) or bevelled (Chamfer). */
export type RectangleCorners =
  | { readonly kind: 'fillet'; readonly radius: number }
  | { readonly kind: 'chamfer'; readonly first: number; readonly second: number };

/**
 * A rectangle from `first`, `length` along the direction at `rotation` (radians) and `width`
 * square to it, both signed: the corners in RECTANG's order, first corner, along the length,
 * the other corner, back along the width. With `corners`, each corner is filleted or chamfered;
 * a chamfer takes its first distance on the side arriving at the corner and its second on the
 * side leaving it (AutoCAD's help does not say which side gets which: this is CHAMFER's order,
 * first line then second, going round). Corners that do not fit (a side shorter than the two
 * cuts on it) are left square, as AutoCAD draws a rectangle too small for its fillets.
 */
export function rectangleVertices(
  first: Vec2,
  length: number,
  width: number,
  rotation: number,
  corners: RectangleCorners | undefined,
  tol: Tolerance,
): BulgeVertex[] {
  const u = fromAngle(rotation);
  const v = perp(u);
  const c = [
    first,
    add(first, scale(u, length)),
    add(add(first, scale(u, length)), scale(v, width)),
    add(first, scale(v, width)),
  ];
  const plain = c.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
  const cut = cornerCuts(corners);
  if (!cut) return plain;
  const [into, out] = cut;
  const sides = [Math.abs(length), Math.abs(width)];
  if (sides.some((s) => into + out > s + tol.linear)) return plain;
  // Each corner turns the same way: left (counter-clockwise) when length and width share a sign.
  const turn = Math.sign(length * width);
  const bulge = corners?.kind === 'fillet' ? turn * Math.tan(Math.PI / 8) : 0;
  const out4: BulgeVertex[] = [];
  for (let i = 0; i < 4; i++) {
    const p = c[i]!;
    const dirIn = normalize(sub(p, c[(i + 3) % 4]!));
    const dirOut = normalize(sub(c[(i + 1) % 4]!, p));
    const a = sub(p, scale(dirIn, into));
    const b = add(p, scale(dirOut, out));
    out4.push({ x: a.x, y: a.y, bulge }, { x: b.x, y: b.y, bulge: 0 });
  }
  // A side the cuts use up whole leaves two coincident vertices: drop the straight one.
  return out4.filter((p, i) => {
    const next = out4[(i + 1) % out4.length]!;
    return p.bulge !== 0 || distance(p, next) > tol.linear;
  });
}

/** How far each corner's cut runs back along the side arriving and on along the side leaving. */
function cornerCuts(corners: RectangleCorners | undefined): [number, number] | undefined {
  if (!corners) return undefined;
  const cut: [number, number] =
    corners.kind === 'fillet' ? [corners.radius, corners.radius] : [corners.first, corners.second];
  return cut[0] > 0 || cut[1] > 0 ? cut : undefined;
}

/**
 * The area the corners take from a rectangle (RECTANG Area counts it, AutoCAD 2024 Help: "If
 * the Chamfer or Fillet option is active, the area includes the effect of the chamfers or
 * fillets on the corners"): four quarter-circle remainders or four triangles.
 */
export function cornersArea(corners: RectangleCorners | undefined): number {
  if (!corners) return 0;
  if (corners.kind === 'fillet') return (4 - Math.PI) * corners.radius ** 2;
  return 2 * corners.first * corners.second;
}

/** A regular polygon's vertices, counter-clockwise, the first `radius` from `center` at `start`. */
export function polygonVertices(
  center: Vec2,
  radius: number,
  sides: number,
  start: number,
): BulgeVertex[] {
  const out: BulgeVertex[] = [];
  for (let i = 0; i < sides; i++) {
    const p = add(center, fromAngle(start + (2 * Math.PI * i) / sides, radius));
    out.push({ x: p.x, y: p.y, bulge: 0 });
  }
  return out;
}

/**
 * POLYGON about a centre: the vertices for a circle of `radius` through `toward`'s direction,
 * inscribed (`toward`'s direction is a vertex's) or circumscribed (an edge's midpoint's). With no
 * `toward` (the radius typed) the bottom edge is horizontal (AutoCAD 2024 Help: "Specifying the
 * radius with a value draws the bottom edge of the polygon at the current snap rotation angle";
 * SNAPANG arrives with M3-06, so 0).
 */
export function polygonAbout(
  center: Vec2,
  radius: number,
  sides: number,
  inscribed: boolean,
  toward?: Vec2,
): BulgeVertex[] {
  const half = Math.PI / sides;
  const r = inscribed ? radius : radius / Math.cos(half);
  const start = toward
    ? angleOf(sub(toward, center)) - (inscribed ? 0 : half)
    : -Math.PI / 2 - half;
  return polygonVertices(center, r, sides, start);
}

/** POLYGON Edge: the polygon on the left of the edge from `a` to `b`, counter-clockwise from `a`. */
export function polygonOnEdge(a: Vec2, b: Vec2, sides: number): BulgeVertex[] {
  const half = Math.PI / sides;
  const side = distance(a, b);
  const toCenter = side / (2 * Math.tan(half));
  const center = add(midpoint(a, b), scale(perp(normalize(sub(b, a))), toCenter));
  return polygonVertices(center, side / (2 * Math.sin(half)), sides, angleOf(sub(a, center)));
}
