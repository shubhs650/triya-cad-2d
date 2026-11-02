// A layout's sheet (M1-18): where its paper and printable area sit in paper space, from the
// page setup the LAYOUT object carries (ARCHITECTURE.md §7.2 Layouts).
//
// AutoCAD puts the paper-space origin at the printable area's lower-left corner moved by the
// plot offset, so the paper's lower-left corner is at minus the displayed left and bottom
// margins (and the offset). The margins are stated on the paper as the device feeds it; a
// rotated plot turns them with the paper. Every corpus layout AutoCAD set up has LIMMIN/LIMMAX
// equal to the sheet this gives (`layouts.corpus.test.ts`), which fixes the 90° case:
// the displayed left margin is the stated top one and the displayed bottom the stated left.
// The 180° and 270° cases continue the same turn; no corpus file has one.

import type { Box } from '../geom/bounds';
import type { Layout, LayoutPlot } from '../model/types';

export interface LayoutSheet {
  /** The paper, in paper-space drawing units. */
  readonly paper: Box;
  /** The part of the paper the device can print on. */
  readonly printable: Box;
  /** Paper-space drawing units per millimetre of paper. */
  readonly unitsPerMm: number;
}

const MM_PER_INCH = 25.4;

/**
 * Paper-space drawing units per millimetre: `numerator` paper units (inches, or millimetres)
 * plot `denominator` drawing units. A missing or non-positive scale counts as 1:1. Pixel units
 * (raster devices) are taken as millimetres; AutoCAD states no size for a pixel.
 */
export function paperUnitsPerMm(plot: LayoutPlot): number {
  const { numerator, denominator } = plot.scale;
  const ratio = numerator > 0 && denominator > 0 ? denominator / numerator : 1;
  return plot.paperUnits === 'inches' ? ratio / MM_PER_INCH : ratio;
}

/** The margins as seen on the displayed (rotated) sheet: left, bottom, right, top. */
function displayedMargins(plot: LayoutPlot): [number, number, number, number] {
  const { left: l, bottom: b, right: r, top: t } = plot.margins;
  switch (plot.rotation) {
    case 1:
      return [t, l, b, r];
    case 2:
      return [r, t, l, b];
    case 3:
      return [b, r, t, l];
    default:
      return [l, b, r, t];
  }
}

/**
 * The layout's sheet, or undefined when its page setup states no paper (a layout never set up
 * in AutoCAD, which picks a device the first time the tab is opened).
 */
export function layoutSheet(layout: Layout): LayoutSheet | undefined {
  const plot = layout.plot;
  if (!plot || !(plot.paperWidth > 0) || !(plot.paperHeight > 0)) return undefined;
  const turned = plot.rotation === 1 || plot.rotation === 3;
  const width = turned ? plot.paperHeight : plot.paperWidth;
  const height = turned ? plot.paperWidth : plot.paperHeight;
  const [l, b, r, t] = displayedMargins(plot).map((m) => Math.max(0, m)) as [
    number,
    number,
    number,
    number,
  ];
  const k = paperUnitsPerMm(plot);
  // The plot offset is taken along the displayed sheet; DXF 46/47 do not say which frame
  // they are in, and every corpus layout has it at 0.
  const x0 = -(l + plot.origin.x);
  const y0 = -(b + plot.origin.y);
  const paper = { minX: x0 * k, minY: y0 * k, maxX: (x0 + width) * k, maxY: (y0 + height) * k };
  const printable = {
    minX: (x0 + l) * k,
    minY: (y0 + b) * k,
    maxX: Math.max(x0 + l, x0 + width - r) * k,
    maxY: Math.max(y0 + b, y0 + height - t) * k,
  };
  return { paper, printable, unitsPerMm: k };
}
