// How POINT objects show (M3-01 part 4): PDMODE picks the figure and PDSIZE its size (AutoCAD
// 2024 Help, "PDMODE (System Variable)", "PDSIZE (System Variable)"):
//   PDMODE 0 a dot, 1 nothing, 2 a plus, 3 a cross (X), 4 a short line up from the point;
//   adding 32 draws a circle round it, 64 a square, 96 both.
//   PDSIZE > 0 is an absolute size in drawing units; 0 is 5% of the drawing area's height;
//   < 0 is that percentage of the drawing area's (viewport's) height.
// The figure is as wide as the size: the circle's diameter, the square's side and the arms of
// the plus and cross reach half of it from the point (AutoCAD's help does not give the arms'
// length; ours touch the circle, our reading of the Point Style dialog's pictures). The figure
// turns with the point's DXF 50 angle (the UCS X axis when it was drawn).
//
// AutoCAD sizes relative points when it regenerates, so they keep their size on the screen
// only until the next REGEN; Triya sizes them every frame, which is how they look after a
// REGEN in AutoCAD. A plot sizes them by the view the plot is made from (`PlotSource`).
import type { DocumentModel } from '@triya/engine';
import { PATH_A, PATH_L, PATH_M, PATH_Z, type PointFigure } from './types';

/** PDMODE and PDSIZE as the renderer takes them. */
export interface PointStyle {
  readonly mode: number;
  readonly size: number;
}

/** The drawing's PDMODE and PDSIZE; AutoCAD's 0 and 0 when the header has none. */
export function pointStyle(model: DocumentModel): PointStyle {
  const mode = model.header.get('$PDMODE');
  const size = model.header.get('$PDSIZE');
  return {
    mode: typeof mode === 'number' ? mode : 0,
    size: typeof size === 'number' ? size : 0,
  };
}

/** The figure a point shows with `style`, or undefined for a plain dot (PDMODE 0). */
export function figureOf(style: PointStyle | undefined, angle?: number): PointFigure | undefined {
  if (!style || style.mode === 0) return undefined;
  return { mode: style.mode, size: style.size, ...(angle ? { angle } : {}) };
}

/** Whether PDMODE shows the dot at the point (its base figure is 0). */
export const pointHasDot = (mode: number): boolean => (mode & 31) === 0;

/** The figure's size in drawing units for a view `viewHeight` drawing units tall. */
export function figureSize(size: number, viewHeight: number): number {
  if (size > 0) return size;
  return ((size === 0 ? 5 : -size) / 100) * viewHeight;
}

/**
 * The figure's lines as a renderer path (world coordinates) around (x, y), `size` wide; empty
 * when it has none (PDMODE 0 or 1 alone).
 */
export function pointFigurePath(
  x: number,
  y: number,
  mode: number,
  size: number,
  angle = 0,
): number[] {
  const h = size / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out: number[] = [];
  /** A point (u, v) of the figure's own frame, turned and placed. */
  const at = (u: number, v: number): [number, number] => [x + u * c - v * s, y + u * s + v * c];
  const segment = (u0: number, v0: number, u1: number, v1: number): void => {
    out.push(PATH_M, ...at(u0, v0), PATH_L, ...at(u1, v1));
  };
  switch (mode & 31) {
    case 2:
      segment(-h, 0, h, 0);
      segment(0, -h, 0, h);
      break;
    case 3: {
      const d = h * Math.SQRT1_2;
      segment(-d, -d, d, d);
      segment(-d, d, d, -d);
      break;
    }
    case 4:
      segment(0, 0, 0, h);
      break;
  }
  if (mode & 32) {
    out.push(PATH_M, ...at(h, 0), PATH_A, x, y, h, angle, angle + 2 * Math.PI, 1, PATH_Z);
  }
  if (mode & 64) {
    out.push(PATH_M, ...at(-h, -h), PATH_L, ...at(h, -h), PATH_L, ...at(h, h));
    out.push(PATH_L, ...at(-h, h), PATH_Z);
  }
  return out;
}
