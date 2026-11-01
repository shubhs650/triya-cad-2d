// Pattern hatch generation (M1-16, ARCHITECTURE.md §10): a HATCH's pattern definition lines,
// as the file stores them (DXF 53 angle, 43/44 base point, 45/46 offset, 79/49 dashes, already
// scaled and rotated by the hatch's pattern scale and angle), clipped to its boundary loops.
//
// AutoCAD rules encoded here:
// - Each definition line is a family of parallel lines through base + n·offset for every
//   integer n. The offset's component across the lines is the spacing; its component along
//   them shifts each line's dash pattern, which starts at that line's own origin.
// - Dashes: positive is a dash, negative a gap, zero a dot; an empty list is a continuous line.
// - Island detection (DXF 75): normal (0) hatches where a point is inside an odd number of
//   loops, outer (1) only where it is inside exactly one (the outermost level), ignore (2)
//   wherever it is inside any loop.
// - HPMAXLINES (default 1,000,000) caps the hatch lines AutoCAD generates; a denser pattern is
//   not generated ("too-dense"), and the renderer shows its area filled instead.
// Boundary curves are flattened to within 1e-4 of each curve's size (`loopSegments`), so a
// pattern line ends within that distance of an arc boundary.

import { toleranceForSize, type HatchLoop, type HatchPatternLine } from '@triya/engine';
import { loopSegments } from './boundary';

/** What pattern generation reads from a HATCH. */
export interface HatchInput {
  readonly loops: readonly HatchLoop[];
  readonly patternLines: readonly HatchPatternLine[];
  /** DXF 75: 0 normal, 1 outer, 2 ignore. */
  readonly style: number;
}

/**
 * The lines one pattern definition line generates inside the boundary, with what the renderer
 * needs to draw them as an average tint once they are under a pixel apart (LOD, ARCHITECTURE.md
 * §7.2): their spacing and how much of each line is ink.
 */
export interface HatchFamily {
  /** Dash segments, flat: x0, y0, x1, y1 per segment. */
  readonly segments: readonly number[];
  /** Dots, flat: x, y per dot. */
  readonly dots: readonly number[];
  /** The distance between neighbouring lines, drawing units. */
  readonly spacing: number;
  /** One repetition of the dash pattern; 0 for a continuous line. */
  readonly period: number;
  /** The dashes' total length in one repetition. */
  readonly dashLength: number;
  /**
   * The dashes and dots in one repetition: each is drawn with round caps, so it inks a line
   * width more than its length.
   */
  readonly marks: number;
}

export type HatchPattern =
  | {
      readonly kind: 'lines';
      /** One entry per definition line that draws anything inside the boundary. */
      readonly families: readonly HatchFamily[];
    }
  | { readonly kind: 'too-dense'; readonly lines: number };

export interface HatchPatternOptions {
  /** HPMAXLINES: the most lines generated for one hatch. */
  readonly maxLines?: number;
}

/** AutoCAD's initial HPMAXLINES. */
export const HPMAXLINES = 1_000_000;

/** Whether a point inside `k` boundary loops is hatched, by island style. */
function hatched(style: number, k: number): boolean {
  if (style === 1) return k === 1;
  if (style === 2) return k >= 1;
  return k % 2 === 1;
}

export function hatchPattern(g: HatchInput, options: HatchPatternOptions = {}): HatchPattern {
  const maxLines = options.maxLines ?? HPMAXLINES;
  const empty: HatchPattern = { kind: 'lines', families: [] };
  if (g.loops.length === 0 || g.patternLines.length === 0) return empty;

  // The boundary's extents give the tolerance below which a family has no spacing (the
  // document epsilon for geometry of this size).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (pts: readonly number[]) => {
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minY = Math.min(minY, pts[i + 1]!);
      maxY = Math.max(maxY, pts[i + 1]!);
    }
  };
  const loops = g.loops.map(loopSegments);
  loops.forEach(extend);
  const size = Math.max(maxX - minX, maxY - minY);
  if (!(size > 0)) return empty;
  const tol = toleranceForSize(
    Math.max(size, Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)),
  );

  // Count first, so a pattern over the limit costs nothing.
  const families = g.patternLines.map((pl) => family(pl, loops, tol.linear));
  const lines = families.reduce((n, f) => n + (f ? f.last - f.first + 1 : 0), 0);
  if (lines > maxLines) return { kind: 'too-dense', lines };

  const out: HatchFamily[] = [];
  families.forEach((f, i) => {
    if (!f) return;
    const pl = g.patternLines[i]!;
    const segments: number[] = [];
    const dots: number[] = [];
    clip(f, pl, loops, g.style, segments, dots);
    if (segments.length === 0 && dots.length === 0) return;
    out.push({
      segments,
      dots,
      spacing: f.spacing,
      period: pl.dashes.reduce((s, d) => s + Math.abs(d), 0),
      dashLength: pl.dashes.reduce((s, d) => s + Math.max(d, 0), 0),
      marks: pl.dashes.filter((d) => d >= 0).length,
    });
  });
  return { kind: 'lines', families: out };
}

interface Family {
  /** Unit direction along the lines and across them, with the spacing positive across. */
  readonly dx: number;
  readonly dy: number;
  readonly nx: number;
  readonly ny: number;
  readonly spacing: number;
  /** The offset's component along the lines: how far each next line's pattern is shifted. */
  readonly shift: number;
  readonly first: number;
  readonly last: number;
}

/** The lines n = first..last of a definition line that can cross the boundary. */
function family(
  pl: HatchPatternLine,
  loops: readonly (readonly number[])[],
  eps: number,
): Family | undefined {
  const dx = Math.cos(pl.angle);
  const dy = Math.sin(pl.angle);
  let nx = -dy;
  let ny = dx;
  let spacing = pl.offset.x * nx + pl.offset.y * ny;
  if (!(Math.abs(spacing) > eps)) return undefined;
  if (spacing < 0) {
    nx = -nx;
    ny = -ny;
    spacing = -spacing;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const segs of loops) {
    for (let i = 0; i < segs.length; i += 2) {
      const u = (segs[i]! - pl.base.x) * nx + (segs[i + 1]! - pl.base.y) * ny;
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
  }
  const first = Math.ceil(lo / spacing);
  const last = Math.ceil(hi / spacing) - 1;
  if (last < first) return undefined;
  const shift = pl.offset.x * dx + pl.offset.y * dy;
  return { dx, dy, nx, ny, spacing, shift, first, last };
}

/** Each line of the family clipped to the hatched area and dashed into `segments`/`dots`. */
function clip(
  f: Family,
  pl: HatchPatternLine,
  loops: readonly (readonly number[])[],
  style: number,
  segments: number[],
  dots: number[],
): void {
  // Crossings per line: [t along the line from its origin, loop index] pairs. A segment
  // crosses line n when its ends lie on either side of it, the end exactly on the line
  // counting as above, so a vertex on a line is counted once. A pattern line exactly along a
  // boundary edge is therefore drawn along a bottom edge (as seen across the lines) and not
  // along a top one; AutoCAD documents neither, and either draws on the boundary itself.
  const count = f.last - f.first + 1;
  const hits: number[][] = Array.from({ length: count }, () => []);
  loops.forEach((segs, loop) => {
    for (let i = 0; i < segs.length; i += 4) {
      const x1 = segs[i]! - pl.base.x;
      const y1 = segs[i + 1]! - pl.base.y;
      const x2 = segs[i + 2]! - pl.base.x;
      const y2 = segs[i + 3]! - pl.base.y;
      const u1 = x1 * f.nx + y1 * f.ny;
      const u2 = x2 * f.nx + y2 * f.ny;
      if (u1 === u2) continue;
      const a1 = x1 * f.dx + y1 * f.dy;
      const a2 = x2 * f.dx + y2 * f.dy;
      const n0 = Math.max(f.first, Math.ceil(Math.min(u1, u2) / f.spacing));
      const n1 = Math.min(f.last, Math.ceil(Math.max(u1, u2) / f.spacing) - 1);
      for (let n = n0; n <= n1; n++) {
        const lambda = (n * f.spacing - u1) / (u2 - u1);
        hits[n - f.first]!.push(a1 + lambda * (a2 - a1) - n * f.shift, loop);
      }
    }
  });

  const period = pl.dashes.reduce((s, d) => s + Math.abs(d), 0);
  const inside = new Array<boolean>(loops.length);
  for (let k = 0; k < count; k++) {
    const h = hits[k]!;
    if (h.length < 4) continue;
    const order = Array.from({ length: h.length / 2 }, (_, i) => i).sort(
      (a, b) => h[2 * a]! - h[2 * b]!,
    );
    inside.fill(false);
    let depth = 0;
    const n = f.first + k;
    const ox = pl.base.x + n * pl.offset.x;
    const oy = pl.base.y + n * pl.offset.y;
    let start = 0;
    for (const j of order) {
      const t = h[2 * j]!;
      const loop = h[2 * j + 1]!;
      const was = hatched(style, depth);
      depth += inside[loop] ? -1 : 1;
      inside[loop] = !inside[loop];
      const now = hatched(style, depth);
      if (!was && now) start = t;
      else if (was && !now) dash(ox, oy, f, start, t, pl.dashes, period, segments, dots);
    }
  }
}

/** The dashes and dots of the pattern on [ta, tb] of the line through (ox, oy). */
function dash(
  ox: number,
  oy: number,
  f: Family,
  ta: number,
  tb: number,
  dashes: readonly number[],
  period: number,
  segments: number[],
  dots: number[],
): void {
  if (!(tb > ta)) return;
  const at = (t: number, out: number[]) => out.push(ox + t * f.dx, oy + t * f.dy);
  if (dashes.length === 0 || !(period > 0)) {
    at(ta, segments);
    at(tb, segments);
    return;
  }
  for (let p = Math.floor(ta / period) * period; p <= tb; p += period) {
    let t = p;
    for (const d of dashes) {
      if (d > 0) {
        const a = Math.max(t, ta);
        const b = Math.min(t + d, tb);
        if (b > a) {
          at(a, segments);
          at(b, segments);
        }
      } else if (d === 0 && t >= ta && t <= tb) {
        at(t, dots);
      }
      t += Math.abs(d);
    }
  }
}
