// The Plot dialog's settings and the plot they make (M2-17): what AutoCAD's Plot dialog asks
// (paper size, plot area, plot offset, plot scale, plot style table, plot options, drawing
// orientation) turned into the page (`plotSetup`) and a PDF of the space's plot parts.
//
// AutoCAD 2024 help ("Plot Dialog Box") gives the defaults encoded here: a layout plots its
// Layout area at 1:1 on the paper of its page setup, model space its Display, "Fit to paper"
// and centred; "Plot object lineweights" and "Plot with plot styles" are on, "Plot paperspace
// last" and "Scale lineweights" off (the last two apply to layouts only). "Plot with plot
// styles" off plots objects with their own properties, as the table None does. The printers are
// Triya's own, which print to the paper's edge: the PDF writer, the SVG writer (M2-18: the same
// plot, each drawing layer an Inkscape layer) and a PNG of that SVG at a chosen resolution, as
// AutoCAD's "PublishToWeb PNG.pc3" plots a raster (its background colour too).
//
// Part 2: the Window plot area ("Window<" picks two corners in the space shown; AutoCAD lists
// Window in "What to plot" always) and the partial preview ("Shows an accurate representation of
// the effective plot area relative to the paper size and printable area"; a red line marks a plot
// area that runs off the paper).
//
// Part 3: page setups and the drafter's own plot style tables. AutoCAD's Plot dialog opens on the
// space's page setup (its LAYOUT object's PLOTSETTINGS; model space's is the Model layout's): here
// its plot style table (DXF 7) and the plot options its flags hold (DXF 70: 32 "Plot with plot
// styles", 128 "Plot object lineweights", 64 "Scale lineweights", 512 "Plot paperspace last",
// which ObjectARX names drawViewportsFirst). The tables listed are the bundled ones, then those
// added in Settings (M2-20 part 2) of the drawing's kind, by name; AutoCAD's own names (acad.ctb,
// monochrome.ctb, …) open on the bundled table of that meaning unless the drafter added a file of
// that name. A page setup naming a table this device lacks keeps the name, says so and plots
// without one: AutoCAD's help does not say what its dialog does then, and plotting each object
// with its own properties is what the table None does.

import type { Box, Layout, Vec2 } from '@triya/engine';
import {
  PAPER_SIZES,
  PdfDocument,
  encodePng,
  mmToPoints,
  plotItems,
  plotSvg,
  type PlotItem,
  type PlotPageOptions,
} from '@triya/pdf';
import {
  BUNDLED_PLOT_STYLE_TABLES,
  POINTS_PER_MM,
  bundledPlotStyleTable,
  rasterSize,
  rasterizeSvg,
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
  /** A layout whose page setup is in inches: the dialog shows the scale in inches. */
  readonly inches?: boolean;
  /** `$PSTYLEMODE` 0: the drawing uses named plot styles (STB), else colour-dependent (CTB). */
  readonly namedPlotStyles?: boolean;
  /** The space's page setup (part 3): a layout's own, model space's the Model layout's. */
  readonly pageSetup?: PageSetup | undefined;
  /** The plot style tables added in Settings, by file name (part 3). */
  readonly userTables?: ReadonlyMap<string, PlotStyleTable> | undefined;
}

/** What the Plot dialog opens with from a page setup (PLOTSETTINGS). */
export interface PageSetup {
  /** DXF 7: the plot style table's file name, as the drawing names it; '' for none. */
  readonly styleSheet: string;
  /** DXF 70 plot layout flags. */
  readonly flags: number;
}

/** The DXF 70 flags of a page setup that the dialog's plot options show. */
export const PAGE_SETUP_FLAGS = {
  PLOT_STYLES: 32,
  SCALE_LINEWEIGHTS: 64,
  LINEWEIGHTS: 128,
  /** ObjectARX's drawViewportsFirst. */
  PAPERSPACE_LAST: 512,
} as const;

/** A LAYOUT's page setup, as the dialog reads it. */
export function pageSetupOf(layout: Layout | undefined): PageSetup | undefined {
  const plot = layout?.plot;
  if (!plot) return undefined;
  return { styleSheet: plot.styleSheet ?? '', flags: plot.flags };
}

export type PlotArea = 'layout' | 'extents' | 'display' | 'limits' | 'window';

/** The layout's own paper (its page setup), offered first for a layout. */
export const LAYOUT_PAPER = 'layout';

/** The plotters (AutoCAD's Printer/plotter Name list). */
export type PlotDevice = 'pdf' | 'svg' | 'png';

export const PLOT_DEVICES: readonly { readonly id: PlotDevice; readonly name: string }[] = [
  { id: 'pdf', name: 'Triya PDF (vector, to file)' },
  { id: 'svg', name: 'Triya SVG (vector, to file)' },
  { id: 'png', name: 'Triya PNG (raster, to file)' },
];

/** The resolutions the PNG plotter offers, dots per inch. */
export const PNG_RESOLUTIONS: readonly number[] = [72, 96, 150, 200, 300, 600];

export interface PlotSettings {
  readonly device: PlotDevice;
  /** The PNG plotter's resolution, dots per inch. */
  readonly dpi: number;
  /** What an SVG or PNG plot lies on: a white sheet, or nothing (transparent). */
  readonly background: 'white' | 'none';
  /** A `PAPER_SIZES` name, or `LAYOUT_PAPER`. */
  readonly paper: string;
  readonly orientation: 'portrait' | 'landscape';
  readonly upsideDown: boolean;
  readonly area: PlotArea;
  /** The Window plot area, in the space's units, once one is picked. */
  readonly window?: Box | undefined;
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

/**
 * The plot style tables the dialog lists for the drawing: CTBs, or STBs for named styles; the
 * bundled ones, then the drafter's own in name order.
 */
export function plotStyleTables(space: PlotSpace): string[] {
  const ext = space.namedPlotStyles ? '.stb' : '.ctb';
  const bundled = Object.keys(BUNDLED_PLOT_STYLE_TABLES).filter((n) => n.endsWith(ext));
  const own = [...(space.userTables?.keys() ?? [])]
    .filter((n) => n.toLowerCase().endsWith(ext))
    .filter((n) => !bundled.includes(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [...bundled, ...own];
}

/** The listed table a page setup's table name stands for, or the name itself when none does. */
function tableNamed(sheet: string, space: PlotSpace): string {
  if (!sheet) return '';
  const file = sheet.split(/[\\/]/).pop()!;
  const lower = file.toLowerCase();
  const own = [...(space.userTables?.keys() ?? [])].find((n) => n.toLowerCase() === lower);
  if (own) return own;
  const bundled = bundledPlotStyleTable(file);
  const name = Object.keys(BUNDLED_PLOT_STYLE_TABLES).find(
    (n) => BUNDLED_PLOT_STYLE_TABLES[n] === bundled,
  );
  return name ?? file;
}

/** The table chosen is not one this device has for the drawing (a page setup named it). */
export function missingPlotStyleTable(settings: PlotSettings, space: PlotSpace): boolean {
  return settings.table !== '' && !plotStyleTables(space).includes(settings.table);
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
  const setup = space.pageSetup;
  const flag = (bit: number, otherwise: boolean) => (setup ? (setup.flags & bit) !== 0 : otherwise);
  const { PLOT_STYLES, LINEWEIGHTS, SCALE_LINEWEIGHTS, PAPERSPACE_LAST } = PAGE_SETUP_FLAGS;
  const common = {
    device: 'pdf' as const,
    dpi: 150,
    background: 'white' as const,
    upsideDown: false,
    center: false,
    offset: { x: 0, y: 0 },
    table: tableNamed(setup?.styleSheet ?? '', space),
    lineweights: flag(LINEWEIGHTS, true),
    plotStyles: flag(PLOT_STYLES, true),
    // Layouts only: model space has no paper space, nor a page setup scale to scale against.
    paperspaceLast: space.sheet !== undefined && flag(PAPERSPACE_LAST, false),
    scaleLineweights: space.sheet !== undefined && flag(SCALE_LINEWEIGHTS, false),
  };
  const paper = layoutPaper(space);
  if (space.sheet && paper) {
    return {
      ...common,
      paper: LAYOUT_PAPER,
      orientation: paper.width >= paper.height ? 'landscape' : 'portrait',
      area: 'layout',
      fit: false,
      // The page setup's scale: 1 mm of paper is `unitsPerMm` paper-space units (1 inch is
      // 25.4 × that for a page setup in inches, kept exact so the dialog shows 1 = 1).
      scale: space.inches
        ? { mm: 25.4, units: Math.round(space.sheet.unitsPerMm * 25.4 * 1e12) / 1e12 }
        : { mm: 1, units: space.sheet.unitsPerMm },
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
  out.push('window');
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
    case 'window':
      return settings.window;
  }
}

/** The window between two picked corners. */
export function windowBox(a: Vec2, b: Vec2): Box {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** The partial preview: the paper as turned and the plot area on it, millimetres from its corner. */
export interface PlotPreview {
  readonly width: number;
  readonly height: number;
  readonly area: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Part of the plot area lies off the paper (and is not plotted). */
  readonly offPaper: boolean;
}

/** What the dialog's partial preview shows, or undefined while the settings cannot plot. */
export function plotPreview(settings: PlotSettings, space: PlotSpace): PlotPreview | undefined {
  let page: PlotSetup;
  try {
    page = plotPage(settings, space);
  } catch {
    return undefined;
  }
  const box = plotAreaBox(settings, space)!;
  const m = page.toPaper;
  const k = 1 / POINTS_PER_MM;
  const xs = [m.a * box.minX + m.e, m.a * box.maxX + m.e].map((v) => v * k);
  const ys = [m.d * box.minY + m.f, m.d * box.maxY + m.f].map((v) => v * k);
  const area = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.abs(xs[1]! - xs[0]!),
    height: Math.abs(ys[1]! - ys[0]!),
  };
  // A hair of tolerance: a fitted plot touches the paper's edges exactly.
  const eps = 1e-6 * Math.max(page.width, page.height);
  const offPaper =
    area.x < -eps ||
    area.y < -eps ||
    area.x + area.width > page.width + eps ||
    area.y + area.height > page.height + eps;
  return { width: page.width, height: page.height, area, offPaper };
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
export function plotTable(settings: PlotSettings, space: PlotSpace): PlotStyleTable | undefined {
  if (!settings.plotStyles || missingPlotStyleTable(settings, space) || !settings.table) {
    return undefined;
  }
  return space.userTables?.get(settings.table) ?? bundledPlotStyleTable(settings.table);
}

/** How the parts lie on the page and plot there: what every plotter draws with. */
function pageOptions(page: PlotSetup, settings: PlotSettings, space: PlotSpace): PlotPageOptions {
  const table = plotTable(settings, space);
  // "Scale lineweights" (layouts): lineweights grow with the plot scale against the page setup's.
  const lineweightScale =
    settings.scaleLineweights && space.sheet ? page.scale * space.sheet.unitsPerMm : 1;
  return {
    toPaper: page.toPaper,
    lineweights: settings.lineweights || settings.plotStyles,
    lineweightScale,
    nonIsoScale: table?.applyFactor ? table.scaleFactor : 1,
    area: page.clip,
  };
}

/** A plot of one space as a one-page PDF. */
export function plotPdf(
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
  /** The PDF file a PDF underlay names; an underlay without one plots its boundary only. */
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): Uint8Array {
  const doc = new PdfDocument({ title, creator: 'Triya CAD 2D' });
  addPlotPage(doc, parts, page, settings, space, space.name, underlayFile);
  return doc.bytes();
}

/**
 * Plots one space as the next page of a PDF, labelled with the space's name and bookmarked with
 * `bookmark` (PUBLISH's sheet name).
 */
export function addPlotPage(
  doc: PdfDocument,
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  bookmark: string,
  /** The PDF file a PDF underlay names; an underlay without one plots its boundary only. */
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): void {
  const pdfPage = doc.addPage(mmToPoints(page.width), mmToPoints(page.height), {
    label: space.name,
    bookmark,
  });
  plotItems(pdfPage, parts as readonly PlotItem[], {
    ...pageOptions(page, settings, space),
    ...(underlayFile && { underlays: (u) => underlayFile(u.fileName) }),
  });
}

/** A plot of one space as an SVG file (Triya SVG). */
export function plotSvgFile(
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
): string {
  return plotSvg(parts as readonly PlotItem[], {
    ...pageOptions(page, settings, space),
    width: mmToPoints(page.width),
    height: mmToPoints(page.height),
    title,
    ...(settings.background === 'white' && { background: [255, 255, 255] as const }),
  });
}

/** A plot of one space as a PNG file (Triya PNG): its SVG drawn at the resolution chosen. */
export async function plotPng(
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
  rasterize: typeof rasterizeSvg = rasterizeSvg,
): Promise<Uint8Array> {
  // The sheet is the canvas's own fill, so the SVG carries none.
  const svg = plotSvgFile(parts, page, { ...settings, background: 'none' }, space, title);
  const size = rasterSize(page, settings.dpi);
  const pixels = await rasterize(svg, {
    ...size,
    ...(settings.background === 'white' && { background: '#ffffff' }),
  });
  return encodePng(pixels, { dpi: settings.dpi });
}

/** A plot of one space in the plotter's format, with its media type. */
export async function plotFile(
  parts: readonly PlotPart[],
  page: PlotSetup,
  settings: PlotSettings,
  space: PlotSpace,
  title: string,
  underlayFile?: (fileName: string) => Uint8Array | undefined,
): Promise<{ readonly bytes: Uint8Array; readonly type: string }> {
  switch (settings.device) {
    case 'svg':
      return {
        bytes: new TextEncoder().encode(plotSvgFile(parts, page, settings, space, title)),
        type: 'image/svg+xml',
      };
    case 'png':
      return { bytes: await plotPng(parts, page, settings, space, title), type: 'image/png' };
    case 'pdf':
      return {
        bytes: plotPdf(parts, page, settings, space, title, underlayFile),
        type: 'application/pdf',
      };
  }
}

/** The PDF's file name: the drawing's name and the space plotted. */
export function plotFileName(
  drawing: string,
  space: PlotSpace,
  device: PlotDevice = 'pdf',
): string {
  const base = drawing.replace(/\.[^.]+$/, '');
  return `${base}-${space.name}.${device}`.replace(/[\\/:*?"<>|]/g, '_');
}
