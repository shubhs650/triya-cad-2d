// Where a plot goes on the paper (M2-17): the Plot dialog's paper size, drawing orientation,
// plot area, plot scale and plot offset turned into the page and the drawing → page transform.
//
// AutoCAD 2024 help ("Plot Dialog Box"):
// - Plot scale "Fit to Paper scales the plot to fit within the selected paper size"; a scale is
//   "the number of inches or millimeters equal to the number of drawing units".
// - Plot offset "specifies an offset of the plot area relative to the lower-left corner of the
//   printable area or to the edge of the paper"; "Center the Plot automatically calculates the X
//   and Y offset values to center the plot on the paper".
// - Drawing orientation: Portrait and Landscape turn the paper, "Plot Upside-Down plots … rotated
//   180 degrees".
// Triya's PDF device prints to the paper's edge, so the printable area is the paper, and only
// what lies inside the plot area plots (AutoCAD clips a Window, Display or Extents plot to it).

import type { Box, Vec2 } from '@triya/engine';
import type { Affine } from '../affine';

/** PDF points per millimetre. */
export const POINTS_PER_MM = 72 / 25.4;

export interface PlotSetupOptions {
  /** The paper, millimetres, in either orientation. */
  readonly paper: { readonly width: number; readonly height: number };
  readonly orientation: 'portrait' | 'landscape';
  readonly upsideDown?: boolean;
  /** What is plotted, in the space's drawing units. */
  readonly area: Box;
  /** Millimetres on paper per drawing unit, or the largest scale that fits the paper. */
  readonly scale: number | 'fit';
  /** The area's lower-left corner from the paper's, millimetres, or centred. */
  readonly offset: Vec2 | 'center';
}

export interface PlotSetup {
  /** The page, millimetres, as it is turned. */
  readonly width: number;
  readonly height: number;
  /** Millimetres per drawing unit (what "Fit to paper" settled on). */
  readonly scale: number;
  /** The area's lower-left corner from the paper's, millimetres, before an upside-down turn. */
  readonly offset: Vec2;
  /** Drawing units → page points. */
  readonly toPaper: Affine;
  /** The part of the page the plot may draw on, points: the plot area on the page. */
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** The page and transform of a plot; throws on an empty area or paper. */
export function plotSetup(o: PlotSetupOptions): PlotSetup {
  const long = Math.max(o.paper.width, o.paper.height);
  const short = Math.min(o.paper.width, o.paper.height);
  if (!(short > 0)) throw new Error('The paper has no size.');
  const width = o.orientation === 'landscape' ? long : short;
  const height = o.orientation === 'landscape' ? short : long;
  const aw = o.area.maxX - o.area.minX;
  const ah = o.area.maxY - o.area.minY;
  if (!(aw > 0) && !(ah > 0)) throw new Error('The plot area is empty.');
  const scale =
    o.scale === 'fit'
      ? Math.min(aw > 0 ? width / aw : Infinity, ah > 0 ? height / ah : Infinity)
      : o.scale;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('The plot scale is not valid.');
  const offset =
    o.offset === 'center'
      ? { x: (width - aw * scale) / 2, y: (height - ah * scale) / 2 }
      : o.offset;
  const k = scale * POINTS_PER_MM;
  // Unturned: the area's lower-left corner at the offset.
  let m: Affine = {
    a: k,
    b: 0,
    c: 0,
    d: k,
    e: (offset.x - o.area.minX * scale) * POINTS_PER_MM,
    f: (offset.y - o.area.minY * scale) * POINTS_PER_MM,
  };
  const wp = width * POINTS_PER_MM;
  const hp = height * POINTS_PER_MM;
  if (o.upsideDown) {
    // 180° about the page centre: (x, y) → (W − x, H − y).
    m = { a: -m.a, b: -m.b, c: -m.c, d: -m.d, e: wp - m.e, f: hp - m.f };
  }
  // The area on the page, cut to the paper.
  const x0 = Math.min(m.a * o.area.minX + m.e, m.a * o.area.maxX + m.e);
  const x1 = Math.max(m.a * o.area.minX + m.e, m.a * o.area.maxX + m.e);
  const y0 = Math.min(m.d * o.area.minY + m.f, m.d * o.area.maxY + m.f);
  const y1 = Math.max(m.d * o.area.minY + m.f, m.d * o.area.maxY + m.f);
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(wp, x1);
  const cy1 = Math.min(hp, y1);
  return {
    width,
    height,
    scale,
    offset,
    toPaper: m,
    clip: { x: cx0, y: cy0, width: Math.max(0, cx1 - cx0), height: Math.max(0, cy1 - cy0) },
  };
}
