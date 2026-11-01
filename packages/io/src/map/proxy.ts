// Proxy graphics (the drawing an application saved with its custom object) as plan-view
// kernel curves. acad-ts decodes the primitives; this keeps the ones that have an exact plan
// view and counts the rest.
//
// Coordinates are WCS; PushModelTransform applies a 4 × 4 matrix to what follows until
// PopModelTransform. The matrix is read as AcGeMatrix3d: rows, translation in the last column
// (ODA DWG specification, proxy graphics "push model transform"). The corpus has no proxy
// graphics, so this is checked only by the unit tests.

import {
  GraphicsType,
  Matrix4,
  ProxyCircle,
  ProxyCirclePt3,
  ProxyCircularArc,
  ProxyCircularArc3Pt,
  ProxyExtents,
  ProxyModelTransform,
  ProxyPolygon,
  ProxyPolyline,
  type IProxyGeometry,
  type XYZ,
} from '@node-projects/acad-ts';
import type { ProxyGraphicsGeometry, Vec2 } from '@triya/engine';

type Curve = ProxyGraphicsGeometry['curves'][number];
type V3 = { x: number; y: number; z: number };

const ID = new Matrix4();
const mul = (a: Matrix4, b: Matrix4): Matrix4 => {
  const r = (i: number, j: number) =>
    [0, 1, 2, 3].reduce(
      (s, k) =>
        s +
        (a as unknown as Record<string, number>)[`m${i}${k}`]! *
          (b as unknown as Record<string, number>)[`m${k}${j}`]!,
      0,
    );
  return new Matrix4([0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => r(i, j))));
};
const point = (m: Matrix4, p: V3): V3 => ({
  x: m.m00 * p.x + m.m01 * p.y + m.m02 * p.z + m.m03,
  y: m.m10 * p.x + m.m11 * p.y + m.m12 * p.z + m.m13,
  z: m.m20 * p.x + m.m21 * p.y + m.m22 * p.z + m.m23,
});
const vector = (m: Matrix4, v: V3): V3 => ({
  x: m.m00 * v.x + m.m01 * v.y + m.m02 * v.z,
  y: m.m10 * v.x + m.m11 * v.y + m.m12 * v.z,
  z: m.m20 * v.x + m.m21 * v.y + m.m22 * v.z,
});
const plan = (p: V3): Vec2 => ({ x: p.x, y: p.y });
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: V3) => Math.hypot(v.x, v.y, v.z);
const alongZ = (n: V3) => len(n) > 0 && Math.hypot(n.x, n.y) <= 1e-9 * len(n);

/**
 * How the transform maps plan circles: a uniform scale with no tilt keeps a circle a circle.
 * Returns that scale, or undefined.
 */
function similarity(m: Matrix4): { scale: number } | undefined {
  const ex = vector(m, { x: 1, y: 0, z: 0 });
  const ey = vector(m, { x: 0, y: 1, z: 0 });
  const s = Math.hypot(ex.x, ex.y);
  const tol = 1e-9 * Math.max(1, s);
  if (Math.abs(ex.z) > tol || Math.abs(ey.z) > tol) return undefined;
  if (Math.abs(Math.hypot(ey.x, ey.y) - s) > tol || Math.abs(ex.x * ey.x + ex.y * ey.y) > tol * s)
    return undefined;
  return { scale: s };
}

/** The circle through three points, when they lie on a ±Z plane. */
function circleThrough(
  a: V3,
  b: V3,
  c: V3,
): { center: Vec2; radius: number; ccw: boolean } | undefined {
  const n = cross(sub(b, a), sub(c, a));
  if (!alongZ(n)) return undefined;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const s = (p: V3) => p.x * p.x + p.y * p.y;
  const center = {
    x: (s(a) * (b.y - c.y) + s(b) * (c.y - a.y) + s(c) * (a.y - b.y)) / d,
    y: (s(a) * (c.x - b.x) + s(b) * (a.x - c.x) + s(c) * (b.x - a.x)) / d,
  };
  return { center, radius: Math.hypot(a.x - center.x, a.y - center.y), ccw: d > 0 };
}

export function proxyCurves(
  primitives: readonly IProxyGeometry[],
): Pick<ProxyGraphicsGeometry, 'curves' | 'extents' | 'skipped'> {
  const curves: Curve[] = [];
  let extents: ProxyGraphicsGeometry['extents'];
  let skipped = 0;
  const stack: Matrix4[] = [ID];
  const top = () => stack[stack.length - 1]!;
  const angle = (c: Vec2, p: V3) => Math.atan2(p.y - c.y, p.x - c.x);

  for (const g of primitives) {
    const m = top();
    if (g instanceof ProxyModelTransform) {
      stack.push(mul(m, g.matrix));
    } else if (g.graphicsType === GraphicsType.PopModelTransform) {
      if (stack.length > 1) stack.pop();
    } else if (g instanceof ProxyExtents) {
      const a = point(m, g.min);
      const b = point(m, g.max);
      extents = {
        min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
      };
    } else if (g instanceof ProxyPolyline) {
      // Straight segments have an exact plan view whatever their Z (polygons included).
      curves.push({
        kind: 'LWPOLYLINE',
        closed: g instanceof ProxyPolygon,
        vertices: g.points.map((p: XYZ) => ({ ...plan(point(m, p)), bulge: 0 })),
      });
    } else if (g instanceof ProxyCircle || g instanceof ProxyCircularArc) {
      const sim = similarity(m);
      if (!sim || !alongZ(g.normal)) {
        skipped++;
        continue;
      }
      const center = plan(point(m, g.center));
      const radius = g.radius * sim.scale;
      if (g instanceof ProxyCircle || Math.abs(g.sweepAngle) >= 2 * Math.PI) {
        curves.push({ kind: 'CIRCLE', center, radius });
        continue;
      }
      // The arc sweeps from its start vector u toward n × u. Mapped by the transform, those two
      // give its plan direction, mirrors included (a mapped normal would miss a reflection).
      const u = vector(m, g.startVectorDirection);
      const w = vector(m, cross(g.normal, g.startVectorDirection));
      const a0 = Math.atan2(u.y, u.x);
      const sweep = u.x * w.y - u.y * w.x > 0 ? g.sweepAngle : -g.sweepAngle;
      const [startAngle, endAngle] = sweep >= 0 ? [a0, a0 + sweep] : [a0 + sweep, a0];
      curves.push({ kind: 'ARC', center, radius, startAngle, endAngle });
    } else if (g instanceof ProxyCirclePt3 || g instanceof ProxyCircularArc3Pt) {
      const [p1, p2, p3] = [g.point1, g.point2, g.point3].map((p) => point(m, p)) as [V3, V3, V3];
      const c = circleThrough(p1, p2, p3);
      if (!c) {
        skipped++;
        continue;
      }
      if (g instanceof ProxyCirclePt3) {
        curves.push({ kind: 'CIRCLE', center: c.center, radius: c.radius });
        continue;
      }
      const [from, to] = c.ccw ? [p1, p3] : [p3, p1];
      curves.push({
        kind: 'ARC',
        center: c.center,
        radius: c.radius,
        startAngle: angle(c.center, from),
        endAngle: angle(c.center, to),
      });
    } else if (
      g.graphicsType === GraphicsType.Text ||
      g.graphicsType === GraphicsType.Text2 ||
      g.graphicsType === GraphicsType.UnicodeText ||
      g.graphicsType === GraphicsType.UnicodeText2 ||
      g.graphicsType === GraphicsType.Mesh ||
      g.graphicsType === GraphicsType.Shell ||
      g.graphicsType === GraphicsType.XLine ||
      g.graphicsType === GraphicsType.Ray ||
      g.graphicsType === GraphicsType.LwPolyine
    ) {
      skipped++;
    }
    // Everything else sets traits (colour, layer, linetype, …) or clips and draws nothing.
  }
  return { curves, ...(extents ? { extents } : {}), skipped };
}
