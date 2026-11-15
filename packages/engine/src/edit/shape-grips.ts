// Grips on ellipses, hatches and viewports (M3-05 part 3), as AutoCAD 2024 shows them ("Grips
// Reference"; "To Modify Hatch Objects Using Grips"; "To Resize a Layout Viewport"):
//
// - an ellipse's centre moves it and its axis ends set that axis's length, the axis keeping its
//   direction; an elliptical arc shows its ends (which move along the ellipse) and the axis
//   ends that lie on it. Dragged past the other axis, the axes change places (an ELLIPSE's
//   ratio is at most 1). AutoCAD's help does not say how far an axis end goes: here its
//   distance from the centre, as a circle's quadrant sets its radius.
// - a hatch shows one grip at the centre of its extents, AutoCAD's control grip, which moves
//   it; a patterned hatch's grip has the functions Origin Point, Hatch Angle and Hatch Scale
//   (`grip-functions.ts`).
// - a rectangular layout viewport shows its four corners: dragging one resizes the viewport
//   about the opposite corner, the drawing staying where it is on the sheet (the view's scale
//   is kept, its centre and height follow the frame). The layout's own paper-space viewport and
//   a clipped viewport (its clip boundary has the grips) show none.
import { ccwSweep, normalizeAngle } from '../geom/angle';
import { toleranceForSize } from '../geom/tolerance';
import type { Vec2 } from '../geom/types';
import { add, distance, dot, length, midpoint, perp, scale, sub } from '../geom/vec';
import type { EllipseGeometry, HatchGeometry, ViewportGeometry } from '../model/types';
import { hatchBounds } from '../spatial/entity-bounds';
import { sameGrip } from './grips';

/** The point of `e` at parameter `t`. */
export function ellipseAt(e: EllipseGeometry, t: number): Vec2 {
  const minor = scale(perp(e.majorAxis), e.ratio);
  return add(e.center, add(scale(e.majorAxis, Math.cos(t)), scale(minor, Math.sin(t))));
}

/** The parameter of the point of `e` in the direction of `p` from its centre (as drawn). */
export function ellipseParamOf(e: EllipseGeometry, p: Vec2): number {
  const d = sub(p, e.center);
  const m2 = dot(e.majorAxis, e.majorAxis);
  const u = dot(d, e.majorAxis) / m2;
  const v = dot(d, perp(e.majorAxis)) / (m2 * e.ratio);
  return Math.atan2(v, u);
}

const isFull = (e: EllipseGeometry) => ccwSweep(e.startParam, e.endParam) >= 2 * Math.PI;

/**
 * An ellipse's grips besides its centre: the four axis ends of a whole one; an elliptical
 * arc's ends and the axis ends between them.
 */
export function ellipseGrips(e: EllipseGeometry): { point: Vec2; end: boolean }[] {
  const quadrants = [0, 1, 2, 3].map((i) => (i * Math.PI) / 2);
  if (isFull(e)) return quadrants.map((t) => ({ point: ellipseAt(e, t), end: false }));
  const sweep = ccwSweep(e.startParam, e.endParam);
  const start = ellipseAt(e, e.startParam);
  const end = ellipseAt(e, e.endParam);
  const inside = quadrants
    .filter((t) => normalizeAngle(t - e.startParam) < sweep)
    .sort((a, b) => normalizeAngle(a - e.startParam) - normalizeAngle(b - e.startParam))
    .map((t) => ellipseAt(e, t))
    // A quadrant at an end is that end's grip.
    .filter((p) => !sameGrip(p, start) && !sameGrip(p, end));
  return [
    { point: start, end: true },
    ...inside.map((point) => ({ point, end: false })),
    { point: end, end: true },
  ];
}

/** The ellipse with the axis whose end is at `grip` as long as `to` is far from the centre. */
export function moveEllipseAxis(
  e: EllipseGeometry,
  grip: Vec2,
  to: Vec2,
): EllipseGeometry | undefined {
  const major = length(e.majorAxis);
  const minor = major * e.ratio;
  // The major axis's ends lie a major semi-axis along it, the minor axis's ends none.
  const isMajor = Math.abs(dot(sub(grip, e.center), e.majorAxis)) / major > major / 2;
  const l = distance(e.center, to);
  if (!(l > 0)) return undefined;
  const [a, b] = isMajor ? [l, minor] : [major, l];
  if (a >= b) {
    return { ...e, majorAxis: scale(e.majorAxis, a / major), ratio: b / a };
  }
  // The other axis is the major one now: the parameters turn a quarter back with it.
  const full = isFull(e);
  return {
    ...e,
    majorAxis: scale(perp(e.majorAxis), b / major),
    ratio: a / b,
    startParam: full ? e.startParam : normalizeAngle(e.startParam - Math.PI / 2),
    endParam: full ? e.endParam : normalizeAngle(e.endParam - Math.PI / 2),
  };
}

/** The elliptical arc with its end at `grip` moved to the point of the ellipse towards `to`. */
export function moveEllipseEnd(
  e: EllipseGeometry,
  grip: Vec2,
  to: Vec2,
): EllipseGeometry | undefined {
  if (distance(to, e.center) === 0) return undefined;
  const t = normalizeAngle(ellipseParamOf(e, to));
  const atStart =
    distance(grip, ellipseAt(e, e.startParam)) <= distance(grip, ellipseAt(e, e.endParam));
  const next = atStart ? { ...e, startParam: t } : { ...e, endParam: t };
  // Both ends on one point would make a whole ellipse of an arc.
  return normalizeAngle(next.endParam - next.startParam) === 0 ? undefined : next;
}

const centres = new WeakMap<HatchGeometry, Vec2 | null>();

/** Where a hatch's control grip is: the centre of its extents; none without a boundary. */
export function hatchGripPoint(g: HatchGeometry): Vec2 | undefined {
  const known = centres.get(g);
  if (known !== undefined) return known ?? undefined;
  let m = 1;
  const see = (p: Vec2) => (m = Math.max(m, Math.abs(p.x), Math.abs(p.y)));
  for (const l of g.loops) {
    l.polyline?.vertices.forEach(see);
    for (const e of l.edges ?? []) {
      if (e.type === 'line') see(e.start);
      else if (e.type === 'spline') e.controlPoints.forEach(see);
      else see(e.center);
    }
  }
  const b = hatchBounds(g, toleranceForSize(m));
  const at =
    b.kind === 'box'
      ? { x: (b.box.minX + b.box.maxX) / 2, y: (b.box.minY + b.box.maxY) / 2 }
      : null;
  centres.set(g, at);
  return at ?? undefined;
}

/** A viewport's corners, counter-clockwise from the lower left; none where it has no grips. */
export function viewportCorners(v: ViewportGeometry): Vec2[] {
  if (v.id === 1 || v.clipBoundary !== undefined || !(v.width > 0 && v.height > 0)) return [];
  const w = v.width / 2;
  const h = v.height / 2;
  return [
    { x: v.center.x - w, y: v.center.y - h },
    { x: v.center.x + w, y: v.center.y - h },
    { x: v.center.x + w, y: v.center.y + h },
    { x: v.center.x - w, y: v.center.y + h },
  ];
}

/** The viewport with its corner `i` at `to`, the opposite corner and the drawing kept. */
export function moveViewportCorner(
  v: ViewportGeometry,
  i: number,
  to: Vec2,
): ViewportGeometry | undefined {
  const fixed = viewportCorners(v)[(i + 2) % 4];
  if (!fixed) return undefined;
  const width = Math.abs(to.x - fixed.x);
  const height = Math.abs(to.y - fixed.y);
  if (!(width > 0 && height > 0)) return undefined;
  const center = midpoint(fixed, to);
  // Paper units per drawing unit; the view's display coordinates run along the sheet's axes.
  const k = v.viewHeight > 0 ? v.height / v.viewHeight : 1;
  return {
    ...v,
    center,
    width,
    height,
    viewHeight: height / k,
    viewCenter: add(v.viewCenter, scale(sub(center, v.center), 1 / k)),
  };
}
