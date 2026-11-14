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
//
// PDF layers (M2-56 part 3): AutoCAD snaps only to the geometry of an underlay's layers that
// show. A path drawn inside optional content (`/OC … BDC`, or a form XObject or image with an
// /OC entry) records that content, so osnap can leave it out for an underlay whose page hides
// it: the PDF's own default visibility, with the layers the underlay's ULAYERS xdata names
// (`layersOff`) turned off, which is how the app's pdf.js draws that underlay's page.
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
  /** The optional content each item is drawn in; absent when the page draws none. */
  readonly layers?: UnderlaySnapLayers;
}

/**
 * A PDF visibility expression (PDF 32000-1 §8.11.2.2 /VE) as pdf.js reads it: an operator
 * (`And`, `Or`, `Not`) then group ids and nested expressions.
 */
export type UnderlayVisibility = readonly (string | UnderlayVisibility)[];

/** One level of a path's optional content: pdf.js's marked-content properties for `OC`. */
export type UnderlayContent =
  | { readonly type: 'OCG'; readonly id: string }
  | {
      readonly type: 'OCMD';
      readonly id?: string;
      readonly ids?: readonly string[];
      /** /P: AnyOn (the default), AllOn, AnyOff or AllOff. */
      readonly policy?: string | null;
      readonly expression?: UnderlayVisibility | null;
    };

/** One optional content group of the page's document. */
export interface UnderlaySnapGroup {
  /** pdf.js's id for it (its object reference, `5R`). */
  readonly id: string;
  /** Its /Name, the name ULAYERS keeps; null when it has none. */
  readonly name: string | null;
  /** Whether the document shows it by default. */
  readonly on: boolean;
}

/** Which optional content each item of a page is drawn in. */
export interface UnderlaySnapLayers {
  readonly groups: readonly UnderlaySnapGroup[];
  /**
   * The nestings of optional content the page draws in, each every level a path is inside
   * (all must show for it to show); the first is the empty one, content that always shows.
   */
  readonly conditions: readonly (readonly UnderlayContent[])[];
  /** The condition of each segment, arc and Bézier, by index into `conditions`. */
  readonly lines: Uint32Array;
  readonly arcs: Uint32Array;
  readonly beziers: Uint32Array;
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
  readonly #lineIn: number[] = [];
  readonly #arcIn: number[] = [];
  readonly #bezierIn: number[] = [];
  #groups: readonly UnderlaySnapGroup[] = [];
  readonly #conditions: (readonly UnderlayContent[])[] = [[]];
  readonly #conditionKeys = new Map<string, number>([['[]', 0]]);
  #condition = 0;
  #count = 0;

  /** The document's optional content groups, by which `within` content is judged. */
  groups(groups: readonly UnderlaySnapGroup[]): void {
    this.#groups = groups.map((g) => ({ id: g.id, name: g.name, on: g.on }));
  }

  /** The optional content the paths that follow are drawn in, outermost first. */
  within(content: readonly UnderlayContent[]): void {
    const key = JSON.stringify(content);
    let n = this.#conditionKeys.get(key);
    if (n === undefined) {
      n = this.#conditions.length;
      this.#conditions.push(content);
      this.#conditionKeys.set(key, n);
    }
    this.#condition = n;
  }

  /** Whether the page has reached `UNDERLAY_SNAP_LIMIT` and takes no more. */
  get full(): boolean {
    return this.#count >= UNDERLAY_SNAP_LIMIT;
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    if (this.full || (x0 === x1 && y0 === y1)) return;
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    this.#lines.push(x0, y0, x1, y1);
    this.#lineIn.push(this.#condition);
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
    if (arc) {
      this.#arcs.push(...arc);
      this.#arcIn.push(this.#condition);
    } else {
      this.#beziers.push(...v);
      this.#bezierIn.push(this.#condition);
    }
    this.#count++;
  }

  build(): UnderlaySnapPage {
    const page = {
      lines: this.#lines.build(),
      arcs: this.#arcs.build(),
      beziers: this.#beziers.build(),
    };
    const used = [this.#lineIn, this.#arcIn, this.#bezierIn].some((c) => c.some((n) => n > 0));
    if (!used) return page;
    return {
      ...page,
      layers: {
        groups: this.#groups,
        conditions: this.#conditions,
        lines: Uint32Array.from(this.#lineIn),
        arcs: Uint32Array.from(this.#arcIn),
        beziers: Uint32Array.from(this.#bezierIn),
      },
    };
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

/**
 * Whether each of the page's content conditions shows (1) or not (0) for an underlay with the
 * layers `layersOff` turned off, or undefined when the page draws no optional content. A group
 * shows when the document shows it by default and its name is not off; the rest follows
 * pdf.js's `OptionalContentConfig.isVisible`, which draws the page: a document without groups,
 * a group it does not list and a policy it does not know all show.
 */
export function underlaySnapShown(
  page: UnderlaySnapPage,
  layersOff: readonly string[] | undefined,
): Uint8Array | undefined {
  const layers = page.layers;
  if (!layers) return undefined;
  const off = new Set(layersOff);
  const groups = new Map(
    layers.groups.map((g) => [g.id, g.on && !(g.name !== null && off.has(g.name))]),
  );
  const shown = (c: UnderlayContent): boolean => {
    if (groups.size === 0) return true;
    if (c.type === 'OCG') return groups.get(c.id) ?? true;
    if (c.expression) return expression(c.expression, groups);
    // pdf.js keeps an OCMD's single group reference as `id`, its array as `ids`.
    const ids = c.ids ?? (c.id !== undefined ? [c.id] : []);
    if (ids.some((id) => !groups.has(id))) return true;
    const on = ids.map((id) => groups.get(id)!);
    switch (c.policy ?? 'AnyOn') {
      case 'AnyOn':
        return on.some(Boolean);
      case 'AllOn':
        return on.every(Boolean);
      case 'AnyOff':
        return on.some((v) => !v);
      case 'AllOff':
        return on.every((v) => !v);
      default:
        return true;
    }
  };
  return Uint8Array.from(layers.conditions, (levels) => (levels.every(shown) ? 1 : 0));
}

/** A visibility expression's value, as pdf.js evaluates it (a group it lacks shows all). */
function expression(e: UnderlayVisibility, groups: ReadonlyMap<string, boolean>): boolean {
  if (e.length < 2) return true;
  const op = e[0];
  for (let i = 1; i < e.length; i++) {
    const el = e[i]!;
    let state: boolean;
    if (typeof el !== 'string') state = expression(el, groups);
    else if (groups.has(el)) state = groups.get(el)!;
    else return true;
    if (op === 'And') {
      if (!state) return false;
    } else if (op === 'Or') {
      if (state) return true;
    } else if (op === 'Not') return !state;
    else return true;
  }
  return op === 'And';
}

/**
 * The page's curves whose boxes meet `box` (page inches), as engine curves in page inches;
 * with `shown` (`underlaySnapShown`), only those of content that shows.
 */
export function underlaySnapCurves(page: UnderlaySnapPage, box: Box, shown?: Uint8Array): Curve[] {
  const out: Curve[] = [];
  const layers = shown && page.layers;
  const hidden = (of: Uint32Array, i: number): boolean => shown![of[i]!] === 0;
  const l = page.lines;
  for (let i = 0; i + 3 < l.length; i += 4) {
    if (layers && hidden(layers.lines, i / 4)) continue;
    const x0 = l[i]!;
    const y0 = l[i + 1]!;
    const x1 = l[i + 2]!;
    const y1 = l[i + 3]!;
    if (overlaps(box, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)))
      out.push({ kind: 'LINE', start: { x: x0, y: y0 }, end: { x: x1, y: y1 } });
  }
  const a = page.arcs;
  for (let i = 0; i + 4 < a.length; i += 5) {
    if (layers && hidden(layers.arcs, i / 5)) continue;
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
    if (layers && hidden(layers.beziers, i / 8)) continue;
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
