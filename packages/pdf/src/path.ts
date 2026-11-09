// Render paths → PDF path operators. A plot hands over the renderer's packed paths
// (`RenderPrimitive.path`, ARCHITECTURE.md §7.1) in world units with the affine that puts the
// world on paper. PDF paths have lines and cubic Béziers only (§8.5.2), so arcs and elliptical
// arcs become cubics of at most 90° each (deviation under 3e-4 of the radius) and quadratics
// are raised to cubics exactly. An affine map carries a Bézier by its control points, so the
// curves are built in world units and mapped point by point: a plot turned or scaled
// non-uniformly stays exact.

import type { ContentStream } from './content';

// The renderer's path opcodes (packages/render/src/types.ts). They are repeated here because
// this package runs without the DOM and the render package's entry point needs it;
// packages/testkit/src/pdf/plot.test.ts holds the two lists equal.
export const PATH_M = 0;
export const PATH_L = 1;
export const PATH_A = 2;
export const PATH_E = 3;
export const PATH_Z = 4;
export const PATH_Q = 5;
export const PATH_C = 6;

/** (x, y) → (a·x + c·y + e, b·x + d·y + f), the renderer's `PrimitiveFrame`. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** The curve segments of a path in paper space: what `emitPath` writes and `subpathLengths` measures. */
export type Segment =
  | { readonly op: 'M' | 'L'; readonly x: number; readonly y: number }
  | {
      readonly op: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'Z' };

const TAU = 2 * Math.PI;

/**
 * The signed sweep the canvas draws from `a0` to `a1` (HTML canvas `arc`/`ellipse`): positive
 * for a counter-clockwise arc in the world (the renderer's flag 1), a whole turn when the
 * angles are a turn or more apart, else the difference wrapped into one turn.
 */
export function sweepOf(a0: number, a1: number, ccw: boolean): number {
  if (ccw) {
    if (a1 - a0 >= TAU) return TAU;
    let s = (a1 - a0) % TAU;
    if (s < 0) s += TAU;
    return s;
  }
  if (a0 - a1 >= TAU) return -TAU;
  let s = (a0 - a1) % TAU;
  if (s < 0) s += TAU;
  return -s;
}

/** A path's segments with `m` applied: arcs and quadratics already cubics. */
export function pathSegments(path: readonly number[], m: Affine): Segment[] {
  const out: Segment[] = [];
  const at = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  // The current point and subpath start in world units, for quadratics and closes.
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let open = false;
  // After a close the canvas starts a new subpath at the closed one's start.
  let closed = false;
  const point = (op: 'M' | 'L', x: number, y: number) => {
    if (op === 'L' && closed) {
      const s = at(sx, sy);
      out.push({ op: 'M', x: s.x, y: s.y });
    }
    closed = false;
    const p = at(x, y);
    out.push({ op, x: p.x, y: p.y });
    cx = x;
    cy = y;
    if (op === 'M') {
      sx = x;
      sy = y;
    }
    open = true;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const p1 = at(x1, y1);
    const p2 = at(x2, y2);
    if (closed) {
      const s = at(sx, sy);
      out.push({ op: 'M', x: s.x, y: s.y });
      closed = false;
    }
    const p = at(x, y);
    out.push({ op: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y });
    cx = x;
    cy = y;
  };
  /** An elliptical arc: centre, radii, rotation, start parameter and signed sweep. */
  const arc = (
    ox: number,
    oy: number,
    rx: number,
    ry: number,
    rot: number,
    t0: number,
    sweep: number,
  ) => {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const pt = (t: number) => {
      const u = rx * Math.cos(t);
      const v = ry * Math.sin(t);
      return [ox + u * cr - v * sr, oy + u * sr + v * cr] as const;
    };
    const tangent = (t: number) => {
      const u = -rx * Math.sin(t);
      const v = ry * Math.cos(t);
      return [u * cr - v * sr, u * sr + v * cr] as const;
    };
    const [x0, y0] = pt(t0);
    // The canvas joins an arc to the current point with a line, or starts a subpath there.
    point(open ? 'L' : 'M', x0, y0);
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / pieces;
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < pieces; i++) {
      const a = t0 + i * step;
      const b = a + step;
      const [ax, ay] = pt(a);
      const [bx, by] = pt(b);
      const [dax, day] = tangent(a);
      const [dbx, dby] = tangent(b);
      cubic(ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by);
    }
  };
  for (let i = 0; i < path.length;) {
    switch (path[i]) {
      case PATH_M:
        point('M', path[i + 1]!, path[i + 2]!);
        i += 3;
        break;
      case PATH_L:
        point(open ? 'L' : 'M', path[i + 1]!, path[i + 2]!);
        i += 3;
        break;
      case PATH_A: {
        const r = path[i + 3]!;
        const a0 = path[i + 4]!;
        arc(path[i + 1]!, path[i + 2]!, r, r, 0, a0, sweepOf(a0, path[i + 5]!, path[i + 6] !== 0));
        i += 7;
        break;
      }
      case PATH_E: {
        const t0 = path[i + 6]!;
        const sweep = sweepOf(t0, path[i + 7]!, path[i + 8] !== 0);
        arc(path[i + 1]!, path[i + 2]!, path[i + 3]!, path[i + 4]!, path[i + 5]!, t0, sweep);
        i += 9;
        break;
      }
      case PATH_Z:
        if (open) {
          if (!closed) out.push({ op: 'Z' });
          cx = sx;
          cy = sy;
          closed = true;
        }
        i += 1;
        break;
      case PATH_Q: {
        const qx = path[i + 1]!;
        const qy = path[i + 2]!;
        const x = path[i + 3]!;
        const y = path[i + 4]!;
        if (!open) point('M', qx, qy);
        cubic(
          cx + (2 / 3) * (qx - cx),
          cy + (2 / 3) * (qy - cy),
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          x,
          y,
        );
        i += 5;
        break;
      }
      case PATH_C:
        if (!open) point('M', path[i + 1]!, path[i + 2]!);
        cubic(path[i + 1]!, path[i + 2]!, path[i + 3]!, path[i + 4]!, path[i + 5]!, path[i + 6]!);
        i += 7;
        break;
      default:
        throw new Error(`unknown path opcode ${path[i]} at ${i}`);
    }
  }
  return out;
}

/** Writes segments as path construction operators (no painting operator). */
export function emitSegments(cs: ContentStream, segments: readonly Segment[]): void {
  for (const s of segments) {
    if (s.op === 'M') cs.moveTo(s.x, s.y);
    else if (s.op === 'L') cs.lineTo(s.x, s.y);
    else if (s.op === 'C') cs.curveTo(s.x1, s.y1, s.x2, s.y2, s.x, s.y);
    else cs.closePath();
  }
}

/** The segments split into subpaths, each starting at its move. */
export function subpaths(segments: readonly Segment[]): Segment[][] {
  const out: Segment[][] = [];
  for (const s of segments) {
    if (s.op === 'M' || out.length === 0) out.push([]);
    out[out.length - 1]!.push(s);
  }
  return out;
}

/** A subpath's length in paper units, cubics measured on 16 chords each. */
export function subpathLength(sub: readonly Segment[]): number {
  let len = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const s of sub) {
    if (s.op === 'M') {
      x = sx = s.x;
      y = sy = s.y;
    } else if (s.op === 'L') {
      len += Math.hypot(s.x - x, s.y - y);
      x = s.x;
      y = s.y;
    } else if (s.op === 'C') {
      let px = x;
      let py = y;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const u = 1 - t;
        const qx = u * u * u * x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x;
        const qy = u * u * u * y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y;
        len += Math.hypot(qx - px, qy - py);
        px = qx;
        py = qy;
      }
      x = s.x;
      y = s.y;
    } else {
      len += Math.hypot(sx - x, sy - y);
      x = sx;
      y = sy;
    }
  }
  return len;
}
