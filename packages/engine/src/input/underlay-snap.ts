// PDF underlay snap geometry (M2-22): what of a PDF page running object snaps can snap to while
// PDFOSNAP is on, as AutoCAD 2024 snaps to the vector geometry of an attached PDF ("PDFOSNAP
// (System Variable)", initial value 1).
//
// The app reads each page's drawing operators through pdf.js and hands the paths here in page
// inches (72 PDF points each, origin at the displayed page's lower-left corner, y up): the
// underlay's own space, which `underlayMatrix` places in the drawing. Straight segments stay
// lines; a cubic Bézier that is a circular arc (as PDF writers draw arcs and circles, a
// quarter or less at a time) becomes an ARC, so CENter and QUAdrant find it; any other Bézier
// is kept as a cubic SPLINE. The page's raster text and images offer nothing.
//
// The geometry is three flat arrays, so it costs one structured clone to reach the render
// worker that runs osnap, and a query scans them for the boxes under the aperture.
import type { Arc, Curve, Spline } from '../geom/curves';
import type { Box } from '../geom/bounds';
import type { Matrix2D } from '../geom/transform';
import type { Vec2 } from '../geom/types';
import type { UnderlayGeometry } from '../model/types';

/** A page's snap geometry, in page inches. */
export interface UnderlaySnapPage {
  /** x0 y0 x1 y1 per segment. */
  readonly lines: Float64Array;
  /** cx cy r start end per arc: counter-clockwise from `start` to `end`, radians in [0, 2π). */
  readonly arcs: Float64Array;
  /** The four control points (x y each) of every other cubic Bézier. */
  readonly beziers: Float64Array;
}

/** DXF 280 bits, as the renderer reads them (render/underlay.ts). */
const UNDERLAY_CLIPPING = 1;
const UNDERLAY_ON = 2;

/**
 * How far from a circle a Bézier may stray, relative to its radius, and still be that arc. The
 * usual quarter-circle cubic is within 2.7e-4 of its circle; a writer drawing up to a half
 * circle per curve strays further, and those are better kept as curves than given a centre.
 */
const ARC_FIT = 1e-3;
/** Above this many segments, curves and arcs a page offers no more (memory, not time). */
export const UNDERLAY_SNAP_LIMIT = 1_000_000;

const TAU = 2 * Math.PI;
const norm = (a: number): number => {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
};

class Growable {
  #data = new Float64Array(64);
  length = 0;
  push(...v: number[]): void {
    if (this.length + v.length > this.#data.length) {
      const next = new Float64Array(Math.max(this.#data.length * 2, this.length + v.length));
      next.set(this.#data);
      this.#data = next;
    }
    this.#data.set(v, this.length);
    this.length += v.length;
  }
  build(): Float64Array {
    return this.#data.slice(0, this.length);
  }
}

/** Collects a page's paths, in page inches, into an `UnderlaySnapPage`. */
export class UnderlaySnapBuilder {
  readonly #lines = new Growable();
  readonly #arcs = new Growable();
  readonly #beziers = new Growable();
  #count = 0;

  /** Whether the page has reached `UNDERLAY_SNAP_LIMIT` and takes no more. */
  get full(): boolean {
    return this.#count >= UNDERLAY_SNAP_LIMIT;
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    if (this.full || (x0 === x1 && y0 === y1)) return;
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    this.#lines.push(x0, y0, x1, y1);
    this.#count++;
  }

  /** A quadratic Bézier, raised to the cubic it is. */
  quadratic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void {
    this.cubic(
      x0,
      y0,
      x0 + (2 / 3) * (x1 - x0),
      y0 + (2 / 3) * (y1 - y0),
      x2 + (2 / 3) * (x1 - x2),
      y2 + (2 / 3) * (y1 - y2),
      x2,
      y2,
    );
  }

  cubic(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void {
    if (this.full) return;
    const v = [x0, y0, x1, y1, x2, y2, x3, y3];
    if (!v.every(Number.isFinite)) return;
    if (straight(v)) {
      this.line(x0, y0, x3, y3);
      return;
    }
    const arc = arcOf(v);
    if (arc) this.#arcs.push(...arc);
    else this.#beziers.push(...v);
    this.#count++;
  }

  build(): UnderlaySnapPage {
    return { lines: this.#lines.build(), arcs: this.#arcs.build(), beziers: this.#beziers.build() };
  }
}

/**
 * Whether a cubic is a straight segment from its first point to its last: its handles on that
 * segment, between its ends. A cubic whose ends meet is never straight.
 */
function straight(v: readonly number[]): boolean {
  const [x0, y0, , , , , x3, y3] = v as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const dx = x3 - x0;
  const dy = y3 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const len = Math.sqrt(len2);
  for (const i of [2, 4]) {
    const px = v[i]! - x0;
    const py = v[i + 1]! - y0;
    const t = (px * dx + py * dy) / len2;
    if (t < -1e-9 || t > 1 + 1e-9) return false;
    if (Math.abs(px * dy - py * dx) / len > len * 1e-9) return false;
  }
  return true;
}

/** A cubic's point at `t`. */
function bezierAt(v: readonly number[], t: number): Vec2 {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return {
    x: a * v[0]! + b * v[2]! + c * v[4]! + d * v[6]!,
    y: a * v[1]! + b * v[3]! + c * v[5]! + d * v[7]!,
  };
}

/**
 * The circular arc a cubic draws, as cx cy r start end, or undefined. The centre is where the
 * normals at its two ends meet (a Bézier arc is tangent to its circle at both ends); the arc
 * holds when both ends and three inner points lie on that circle within `ARC_FIT`, sweeping
 * less than a half turn the way its first handle points.
 */
function arcOf(v: readonly number[]): number[] | undefined {
  const p0 = { x: v[0]!, y: v[1]! };
  const p3 = { x: v[6]!, y: v[7]! };
  let d0 = { x: v[2]! - p0.x, y: v[3]! - p0.y };
  if (d0.x === 0 && d0.y === 0) d0 = { x: v[4]! - p0.x, y: v[5]! - p0.y };
  let d3 = { x: p3.x - v[4]!, y: p3.y - v[5]! };
  if (d3.x === 0 && d3.y === 0) d3 = { x: p3.x - v[2]!, y: p3.y - v[3]! };
  // Normals n = (-d.y, d.x); solve p0 + s·n0 = p3 + t·n3.
  const n0 = { x: -d0.y, y: d0.x };
  const n3 = { x: -d3.y, y: d3.x };
  const det = n0.x * -n3.y - n0.y * -n3.x;
  const scale = Math.hypot(d0.x, d0.y) * Math.hypot(d3.x, d3.y);
  if (!(scale > 0) || Math.abs(det) <= scale * 1e-9) return undefined;
  const rx = p3.x - p0.x;
  const ry = p3.y - p0.y;
  const s = (rx * -n3.y - ry * -n3.x) / det;
  const c = { x: p0.x + s * n0.x, y: p0.y + s * n0.y };
  const r = Math.hypot(p0.x - c.x, p0.y - c.y);
  if (!(r > 0) || !Number.isFinite(r)) return undefined;
  const off = (p: Vec2) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
  if (off(p3) > r * ARC_FIT) return undefined;
  for (const t of [0.25, 0.5, 0.75]) if (off(bezierAt(v, t)) > r * ARC_FIT) return undefined;
  // Counter-clockwise when the first handle turns left of the radius out to the first point.
  const ccw = (p0.x - c.x) * d0.y - (p0.y - c.y) * d0.x > 0;
  const a0 = norm(Math.atan2(p0.y - c.y, p0.x - c.x));
  const a3 = norm(Math.atan2(p3.y - c.y, p3.x - c.x));
  const [start, end] = ccw ? [a0, a3] : [a3, a0];
  const sweep = norm(end - start);
  if (!(sweep > 0) || sweep > Math.PI + 1e-9) return undefined;
  // The middle of the curve lies in the sweep (not on the circle's other side).
  const m = bezierAt(v, 0.5);
  if (norm(Math.atan2(m.y - c.y, m.x - c.x) - start) > sweep) return undefined;
  return [c.x, c.y, r, start, end];
}

const overlaps = (b: Box, minX: number, minY: number, maxX: number, maxY: number): boolean =>
  minX <= b.maxX && maxX >= b.minX && minY <= b.maxY && maxY >= b.minY;

/** The page's curves whose boxes meet `box` (page inches), as engine curves in page inches. */
export function underlaySnapCurves(page: UnderlaySnapPage, box: Box): Curve[] {
  const out: Curve[] = [];
  const l = page.lines;
  for (let i = 0; i + 3 < l.length; i += 4) {
    const x0 = l[i]!;
    const y0 = l[i + 1]!;
    const x1 = l[i + 2]!;
    const y1 = l[i + 3]!;
    if (overlaps(box, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)))
      out.push({ kind: 'LINE', start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
  }
  const a = page.arcs;
  for (let i = 0; i + 4 < a.length; i += 5) {
    const cx = a[i]!;
    const cy = a[i + 1]!;
    const r = a[i + 2]!;
    if (!overlaps(box, cx - r, cy - r, cx + r, cy + r)) continue;
    const arc: Arc = {
      kind: 'ARC',
      center: { x: cx, y: cy },
      radius: r,
      startAngle: a[i + 3]!,
      endAngle: a[i + 4]!,
    };
    out.push(arc);
  }
  const z = page.beziers;
  for (let i = 0; i + 7 < z.length; i += 8) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      minX = Math.min(minX, z[i + k]!);
      maxX = Math.max(maxX, z[i + k]!);
      minY = Math.min(minY, z[i + k + 1]!);
      maxY = Math.max(maxY, z[i + k + 1]!);
    }
    if (!overlaps(box, minX, minY, maxX, maxY)) continue;
    const spline: Spline = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [0, 2, 4, 6].map((k) => ({ x: z[i + k]!, y: z[i + k + 1]! })),
    };
    out.push(spline);
  }
  return out;
}

/** Underlay space (page inches) → the underlay's owner (render/underlay.ts `underlayFrame`). */
export function underlayMatrix(g: UnderlayGeometry): Matrix2D {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const sx = g.scale.x;
  const sy = g.scale.y * (g.upsideDown ? -1 : 1);
  return { a: sx * cos, b: sx * sin, c: -sy * sin, d: sy * cos, e: g.position.x, f: g.position.y };
}

/** Whether the underlay shows (DXF 280 bit 2). */
export const underlayShown = (g: UnderlayGeometry): boolean => (g.flags & UNDERLAY_ON) !== 0;

/**
 * The clip boundary in underlay space while clipping is on, or undefined (no clip, or one that
 * states no area): two vertices are opposite corners of a rectangle, more a polygon.
 */
export function underlayClipRing(g: UnderlayGeometry): Vec2[] | undefined {
  if ((g.flags & UNDERLAY_CLIPPING) === 0) return undefined;
  const v = g.clip;
  if (v.length === 2) {
    const [p, q] = [v[0]!, v[1]!];
    return [p, { x: q.x, y: p.y }, q, { x: p.x, y: q.y }];
  }
  const last = v.length - 1;
  const closed = v.length > 3 && v[0]!.x === v[last]!.x && v[0]!.y === v[last]!.y;
  const pts = closed ? v.slice(0, last) : [...v];
  return pts.length >= 3 ? pts : undefined;
}

/** Whether `p` is inside the ring or within `eps` of its edge. */
export function insideRing(ring: readonly Vec2[], p: Vec2, eps: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= eps) return true;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * dx) inside = !inside;
  }
  return inside;
}
