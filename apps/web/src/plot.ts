// The Plot dialog's settings and the plot they make (M2-17): what AutoCAD's Plot dialog asks
// (paper size, plot area, plot offset, plot scale, plot style table, plot options, drawing
// orientation) turned into the page (`plotSetup`) and a PDF of the space's plot parts.
//
// AutoCAD 2024 help ("Plot Dialog Box") gives the defaults encoded here: a layout plots its
// Layout area at 1:1 on the paper of its page setup, model space its Display, "Fit to paper"
// and centred; "Plot object lineweights" and "Plot with plot styles" are on, "Plot paperspace
// last" and "Scale lineweights" off (the last two apply to layouts only). "Plot with plot
// styles" off plots objects with their own properties, as the table None does. The printer is
// Triya's PDF writer, which prints to the paper's edge.

import type { Box, Vec2 } from '@triya/engine';
import { PAPER_SIZES, PdfDocument, mmToPoints, plotItems, type PlotItem } from '@triya/pdf';
import {
  BUNDLED_PLOT_STYLE_TABLES,
  bundledPlotStyleTable,
  plotSetup,
  type PlotPart,
  type PlotSetup,
  type PlotStyleTable,
} from '@triya/render';

/** What the Plot dialog plots from: the space shown and what it knows of it. */
export interface PlotSpace {
  /** The tab's name: `Model` or the layout's. */
  readonly name: string;
  /** A layout's sheet (its page setup), in paper-space units. */
  readonly sheet?: { readonly paper: Box; readonly unitsPerMm: number } | undefined;
  readonly extents?: Box | undefined;
  /** The view shown on the canvas. */
  readonly display?: Box | undefined;
  readonly limits?: Box | undefined;
  /** `$PSTYLEMODE` 0: the drawing uses named plot styles (STB), else colour-dependent (CTB). */
  readonly namedPlotStyles?: boolean;
}

export type PlotArea = 'layout' | 'extents' | 'display' | 'limits';

/** The layout's own paper (its page setup), offered first for a layout. */
export const LAYOUT_PAPER = 'layout';

export interface PlotSettings {
  /** A `PAPER_SIZES` name, or `LAYOUT_PAPER`. */
  readonly paper: string;
  readonly orientation: 'portrait' | 'landscape';
  readonly upsideDown: boolean;
  readonly area: PlotArea;
  readonly fit: boolean;
  /** `mm` millimetres = `units` drawing units. */
  readonly scale: { readonly mm: number; readonly units: number };
  readonly center: boolean;
  /** Millimetres from the paper's lower-left corner. */
  readonly offset: Vec2;
  /** A bundled table's file name, or '' for None. */
  readonly table: string;
  readonly lineweights: boolean;
  readonly plotStyles: boolean;
  readonly paperspaceLast: boolean;
  readonly scaleLineweights: boolean;
}

/** The standard scales the dialog lists, `[label, mm, units]`. */
export const PLOT_SCALES: readonly (readonly [string, number, number])[] = [
  ['1:1', 1, 1],
  ['1:2', 1, 2],
  ['1:5', 1, 5],
  ['1:10', 1, 10],
  ['1:20', 1, 20],
  ['1:50', 1, 50],
  ['1:100', 1, 100],
  ['1:200', 1, 200],
  ['1:500', 1, 500],
  ['1:1000', 1, 1000],
  ['2:1', 2, 1],
  ['5:1', 5, 1],
  ['10:1', 10, 1],
];

/** The plot style tables the dialog lists for the drawing: CTBs, or STBs for named styles. */
export function plotStyleTables(space: PlotSpace): string[] {
  const ext = space.namedPlotStyles ? '.stb' : '.ctb';
  return Object.keys(BUNDLED_PLOT_STYLE_TABLES).filter((n) => n.endsWith(ext));
}

const sizeOf = (b: Box) => ({ width: b.maxX - b.minX, height: b.maxY - b.minY });

/** The layout's paper in millimetres, as its page setup turns it. */
function layoutPaper(space: PlotSpace): { width: number; height: number } | undefined {
  const s = space.sheet;
  if (!s) return undefined;
  const { width, height } = sizeOf(s.paper);
  return { width: width / s.unitsPerMm, height: height / s.unitsPerMm };
}

/** The settings the dialog opens with for a space. */
export function defaultPlotSettings(space: PlotSpace): PlotSettings {
  const common = {
    upsideDown: false,
    center: false,
    offset: { x: 0, y: 0 },
    table: '',
    lineweights: true,
    plotStyles: true,
    paperspaceLast: false,
    scaleLineweights: false,
  };
  const paper = layoutPaper(space);
  if (space.sheet && paper) {
    return {
      ...common,
      paper: LAYOUT_PAPER,
      orientation: paper.width >= paper.height ? 'landscape' : 'portrait',
      area: 'layout',
      fit: false,
      // The page setup's scale: 1 mm of paper is `unitsPerMm` paper-space units.
      scale: { mm: 1, units: space.sheet.unitsPerMm },
    };
  }
  return {
    ...common,
    paper: 'ISO A4',
    orientation: 'landscape',
    area: space.display ? 'display' : 'extents',
    fit: true,
    scale: { mm: 1, units: 1 },
    center: true,
  };
}

/** The plot areas the dialog offers for a space, with whether each is known. */
export function plotAreas(space: PlotSpace): PlotArea[] {
  const out: PlotArea[] = [];
  if (space.sheet) out.push('layout');
  if (space.extents) out.push('extents');
  if (space.display) out.push('display');
  if (space.limits && !space.sheet) out.push('limits');
  return out;
}

/** The paper's size in millimetres. */
export function paperMm(
  settings: PlotSettings,
  space: PlotSpace,
): { width: number; height: number } {
  if (settings.paper === LAYOUT_PAPER) {
    const p = layoutPaper(space);
    if (p) return p;
  }
  const p = PAPER_SIZES.find((s) => s.name === settings.paper) ?? PAPER_SIZES[4]!;
  return { width: p.width, height: p.height };
}

/** The box the plot area names, or undefined when the space does not know it. */
export function plotAreaBox(settings: PlotSettings, space: PlotSpace): Box | undefined {
  switch (settings.area) {
    case 'layout':
      return space.sheet?.paper;
    case 'extents':
      return space.extents;
    case 'display':
      return space.display;
    case 'limits':
      return space.limits;
  }
}

/** Where the plot goes on the page; throws a message the dialog shows. */
export function plotPage(settings: PlotSettings, space: PlotSpace): PlotSetup {
  const area = plotAreaBox(settings, space);
  if (!area) throw new Error('There is nothing to plot in this plot area.');
  const scale = settings.fit ? 'fit' : settings.scale.mm / settings.scale.units;
  if (scale !== 'fit' && !(scale > 0 && Number.isFinite(scale)))
    throw new Error('The plot scale must be positive.');
  return plotSetup({
    paper: paperMm(settings, space),
    orientation: settings.orientation,
    upsideDown: settings.upsideDown,
    area,
    scale,
    offset: settings.center ? 'center' : settings.offset,
  });
}

/** The plot style table the settings plot with, if any. */
export function plotTable(settings: PlotSettings): PlotStyleTable | undefined {
  return settings.plotStyles && settings.table ? bundledPlotStyleTable(settings.table) : undefined;
}

/** A plot of one space as a one-page PDF. */
export function plotPdf(
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
): Uint8Array {
  const doc = new PdfDocument({ title, creator: 'Triya CAD 2D' });
  const pdfPage = doc.addPage(mmToPoints(page.width), mmToPoints(page.height), {
    label: space.name,
    bookmark: space.name,
  });
  const table = plotTable(settings);
  // "Scale lineweights" (layouts): lineweights grow with the plot scale against the page setup's.
  const lineweightScale =
    settings.scaleLineweights && space.sheet ? page.scale * space.sheet.unitsPerMm : 1;
  plotItems(pdfPage, parts as readonly PlotItem[], {
    toPaper: page.toPaper,
    lineweights: settings.lineweights || settings.plotStyles,
    lineweightScale,
    nonIsoScale: table?.applyFactor ? table.scaleFactor : 1,
    area: page.clip,
  });
  return doc.bytes();
}

/** The PDF's file name: the drawing's name and the space plotted. */
export function plotFileName(drawing: string, space: PlotSpace): string {
  const base = drawing.replace(/\.[^.]+$/, '');
  return `${base}-${space.name}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
}
