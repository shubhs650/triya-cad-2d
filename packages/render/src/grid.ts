// GRID (F7) display (M2-04 part 2). AutoCAD 2024 draws the 2D grid as lines (GRIDSTYLE 0) at
// the viewport's GRIDUNIT from the grid base, every GRIDMAJOR-th line a major one, and its
// adaptive display (GRIDDISPLAY bit 2) leaves out lines that would come too close on screen,
// showing every GRIDMAJOR-th line in their place. The grid runs past the limits (GRIDDISPLAY
// bit 1, as AutoCAD's own template has it). Help, "GRID (Command)", "GRIDDISPLAY",
// "GRIDMAJOR". The renderer draws it under the drawing (`RenderStyle.grid`).
import type { Box } from '@triya/engine';

export interface GridSpec {
  /** GRIDUNIT: the spacing in X and Y, drawing units. */
  readonly spacing: { readonly x: number; readonly y: number };
  /** Where a line of each direction passes (the snap base, as AutoCAD's grid follows it). */
  readonly base?: { readonly x: number; readonly y: number };
  /** GRIDMAJOR: every this-many lines one is a major line (AutoCAD's default 5). */
  readonly major: number;
}

/** The grid's lines in the box, drawing coordinates. */
export interface GridLines {
  /** Every vertical line's X and horizontal line's Y, the major ones included. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly majorXs: readonly number[];
  readonly majorYs: readonly number[];
}

/** Grid lines closer than this on screen, CSS pixels, are left out (adaptive display). */
export const GRID_MIN_PX = 8;
/** More lines than this across the view shows no grid at all, rather than a solid wash. */
const MAX_LINES = 1000;
const MAX_COARSEN = 12;

/** The lines of `spec` within `box` at `scale` CSS pixels a unit; undefined when none can show. */
export function gridLines(spec: GridSpec, box: Box, scale: number): GridLines | undefined {
  const majorEvery = spec.major >= 2 ? Math.round(spec.major) : 0;
  // Coarsening shows every GRIDMAJOR-th line (every 5th with no major lines of its own).
  const factor = majorEvery || 5;
  const axis = (min: number, max: number, base: number, spacing: number) => {
    let step = spacing;
    for (let n = 0; step * scale < GRID_MIN_PX && n < MAX_COARSEN; n++) step *= factor;
    if (!(step > 0) || !Number.isFinite(step) || step * scale < GRID_MIN_PX) return undefined;
    const first = Math.ceil((min - base) / step);
    const last = Math.floor((max - base) / step);
    if (last - first > MAX_LINES) return undefined;
    const all: number[] = [];
    const major: number[] = [];
    for (let i = first; i <= last; i++) {
      const v = +(base + i * step).toPrecision(15);
      all.push(v);
      if (majorEvery > 0 && i % majorEvery === 0) major.push(v);
    }
    return { all, major };
  };
  const x = axis(box.minX, box.maxX, spec.base?.x ?? 0, spec.spacing.x);
  const y = axis(box.minY, box.maxY, spec.base?.y ?? 0, spec.spacing.y);
  if (!x || !y) return undefined;
  return { xs: x.all, ys: y.all, majorXs: x.major, majorYs: y.major };
}
