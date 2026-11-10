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
//
// Part 6: named page setups (ACAD_PLOTSETTINGS). AutoCAD's Plot dialog lists them under Page
// setup Name ("<None>", "<Previous plot>" once the space has plotted, then the named page setups
// of the space's kind: model space's, flag 1024, or the layouts'); choosing one opens the dialog on
// its settings, and Apply to Layout writes them into the layout's own page setup. A layout plots
// on a named page setup's paper (`withPageSetup`), as AutoCAD's does, without the layout changing
// until it is applied.

import {
  plotSheet,
  type Box,
  type Handle,
  type Layout,
  type LayoutPlot,
  type NamedPageSetup,
  type NonGraphicalObject,
  type Vec2,
} from '@triya/engine';
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
  /** The drawing's named page setups of the space's kind, by name (part 6). */
  readonly pageSetups?: readonly NamedPageSetup[] | undefined;
  /** The named page setup `pageSetup` is, when one was chosen (part 6). */
  readonly pageSetupName?: string | undefined;
}

/** What the Plot dialog opens with from a page setup (PLOTSETTINGS). */
export interface PageSetup {
  /** DXF 7: the plot style table's file name, as the drawing names it; '' for none. */
  readonly styleSheet: string;
  /** DXF 70 plot layout flags. */
  readonly flags: number;
  /** The LAYOUT whose page setup it is, which Apply to Layout writes (part 4). */
  readonly layout?: Handle | undefined;
  /** The whole page setup: paper, area, scale, offset (part 4). */
  readonly plot?: LayoutPlot | undefined;
}

/** The DXF 70 flags of a page setup that the dialog's plot options show. */
export const PAGE_SETUP_FLAGS = {
  PLOT_STYLES: 32,
  SCALE_LINEWEIGHTS: 64,
  LINEWEIGHTS: 128,
  /** ObjectARX's drawViewportsFirst. */
  PAPERSPACE_LAST: 512,
} as const;

/** The other DXF 70 flags the dialog reads and writes (part 4). */
const PLOT_CENTERED = 4;
const USE_STANDARD_SCALE = 16;

/** A LAYOUT's page setup, as the dialog reads it. */
export function pageSetupOf(layout: Layout | undefined): PageSetup | undefined {
  const plot = layout?.plot;
  if (!plot) return undefined;
  return { styleSheet: plot.styleSheet ?? '', flags: plot.flags, layout: layout.handle, plot };
}

/**
 * The drawing's named page setups a space can plot with (part 6): model space's (flag 1024) or
 * the layouts', by name as AutoCAD lists them.
 */
export function pageSetupsOf(
  objects: readonly NonGraphicalObject[] | undefined,
  model: boolean,
): NamedPageSetup[] {
  return (objects ?? [])
    .filter((o): o is NamedPageSetup => o.type === 'PLOTSETTINGS')
    .filter((o) => o.model === model)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The space as a named page setup plots it (part 6): its settings in place of the space's own
 * page setup (whose layout Apply to Layout still writes), and a layout's sheet on its paper.
 * Undefined `name` (AutoCAD's "<None>") is the space's own. Throws for a name it lacks.
 */
export function withPageSetup(space: PlotSpace, name: string | undefined): PlotSpace {
  if (name === undefined) return { ...space, pageSetupName: undefined };
  const named = space.pageSetups?.find((p) => p.name.toUpperCase() === name.toUpperCase());
  if (!named) throw new Error(`Page setup "${name}" not found.`);
  const plot = named.plot;
  const sheet = space.sheet && plotSheet(plot);
  return {
    ...space,
    sheet: sheet ? { paper: sheet.paper, unitsPerMm: sheet.unitsPerMm } : space.sheet,
    inches: plot.paperUnits === 'inches',
    pageSetup: {
      styleSheet: plot.styleSheet ?? '',
      flags: plot.flags,
      layout: space.pageSetup?.layout,
      plot,
    },
    pageSetupName: named.name,
  };
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

/**
 * The page setup's own paper in millimetres, as it turns it: a layout's sheet, or (part 4) the
 * paper model space's page setup states.
 */
function layoutPaper(space: PlotSpace): { width: number; height: number } | undefined {
  const s = space.sheet;
  if (!s) {
    const plot = space.pageSetup?.plot;
    if (!plot || !(plot.paperWidth > 0 && plot.paperHeight > 0)) return undefined;
    const turned = plot.rotation === 1 || plot.rotation === 3;
    return turned
      ? { width: plot.paperHeight, height: plot.paperWidth }
      : { width: plot.paperWidth, height: plot.paperHeight };
  }
  const { width, height } = sizeOf(s.paper);
  return { width: width / s.unitsPerMm, height: height / s.unitsPerMm };
}

/**
 * The paper the dialog lists as the page setup's own: a layout's, or the one model space's page
 * setup states when the dialog's list lacks its size (part 4).
 */
export function ownPaper(space: PlotSpace): { width: number; height: number } | undefined {
  const paper = layoutPaper(space);
  if (space.sheet || !paper) return paper;
  return listedPaper(space.pageSetup!.plot!) ? undefined : paper;
}

/** The listed paper of a page setup's size, either way round (to a tenth of a millimetre). */
function listedPaper(plot: LayoutPlot): string | undefined {
  const [w, h] = [plot.paperWidth, plot.paperHeight].sort((a, b) => a - b) as [number, number];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.15;
  return PAPER_SIZES.find((p) => near(p.width, w) && near(p.height, h))?.name;
}

/** DXF 74 plot types and the dialog's plot areas (View, 3, is not offered). */
const PLOT_TYPES: Readonly<Record<PlotArea, number>> = {
  display: 0,
  extents: 1,
  limits: 2,
  window: 4,
  layout: 5,
};

/**
 * What the rest of the page setup sets in the dialog (part 4): the paper (a listed one by its
 * size, else the page setup's own), orientation (DXF 73 turns the paper as the device feeds it),
 * the plot area (DXF 74, a window's from 48/49 and 140/141), Fit to paper (flag 16 with DXF 75 =
 * 0) or the scale (142/143 in the page setup's paper units), centring (flag 4) and the offset
 * (46/47). A plot area the space cannot plot (View; Layout or a missing window in model space)
 * leaves the dialog's own. Triya's plotters print to the paper's edge, so the offset is from the
 * paper's corner, where AutoCAD's PLOTOFFSET 0 measures it from the device's printable area.
 * A layout's sheet already sits by its page setup's offset, so its Layout area opens at none.
 */
function fromPageSetup(
  plot: LayoutPlot,
  space: PlotSpace,
  base: PlotSettings,
): Partial<PlotSettings> {
  const out: { -readonly [K in keyof PlotSettings]?: PlotSettings[K] } = {};
  const paper = layoutPaper(space);
  if (paper) {
    if (!space.sheet) out.paper = listedPaper(plot) ?? LAYOUT_PAPER;
    out.orientation = paper.width >= paper.height ? 'landscape' : 'portrait';
  }
  out.upsideDown = plot.rotation === 2 || plot.rotation === 3;
  const w = plot.window;
  const window = w && windowBox(w.min, w.max);
  const area = (Object.keys(PLOT_TYPES) as PlotArea[]).find((a) => PLOT_TYPES[a] === plot.plotType);
  const areas = plotAreas(space);
  if (area && areas.includes(area) && (area !== 'window' || window)) out.area = area;
  if (window) out.window = window;
  out.fit = (plot.flags & USE_STANDARD_SCALE) !== 0 && plot.standardScaleType === 0;
  const { numerator, denominator } = plot.scale;
  if (!space.sheet && numerator > 0 && denominator > 0) {
    out.scale = { mm: numerator * (plot.paperUnits === 'inches' ? 25.4 : 1), units: denominator };
  }
  out.center = (plot.flags & PLOT_CENTERED) !== 0;
  out.offset = (out.area ?? base.area) === 'layout' ? { x: 0, y: 0 } : plot.origin;
  return out;
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
  const settings = plainDefaults(space, common);
  const plot = space.pageSetup?.plot;
  return plot ? { ...settings, ...fromPageSetup(plot, space, settings) } : settings;
}

/** The dialog's own defaults for a space, before the rest of its page setup (part 4). */
function plainDefaults(
  space: PlotSpace,
  common: Omit<PlotSettings, 'paper' | 'orientation' | 'area' | 'fit' | 'scale'>,
): PlotSettings {
  const paper = space.sheet && layoutPaper(space);
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

/** A paper's canonical media name (DXF 4), as AutoCAD's PDF plotters name an edge-to-edge one. */
function mediaName(p: { name: string; width: number; height: number }): string {
  const iso = p.name.startsWith('ISO ');
  const k = iso ? 1 : 25.4;
  const n = (v: number) => (v / k).toFixed(2);
  const [series, size] = p.name.split(' ') as [string, string];
  return `${series}_full_bleed_${size}_(${n(p.width)}_x_${n(p.height)}_${iso ? 'MM' : 'Inches'})`;
}

const setFlag = (flags: number, bit: number, on: boolean) => (on ? flags | bit : flags & ~bit);

/**
 * The page setup the settings make (part 4: AutoCAD's Apply to Layout, "Saves the current
 * settings in the Plot dialog box to the current layout"), from the space's own: what the dialog
 * shows is written, and what it does not show (the device's name, model space's layout-only
 * options, a window not plotted) is kept. A scale the drafter left as it opened stays the
 * standard scale it was; another is a custom one (flag 16 off); Fit to paper is flag 16 with
 * DXF 75 = 0, keeping the scale fitted last. A listed paper is written edge to edge, as Triya's
 * plotters print. Throws when the space has no page setup.
 */
export function appliedPageSetup(settings: PlotSettings, space: PlotSpace): LayoutPlot {
  const base = space.pageSetup?.plot;
  if (!base) throw new Error('This space has no page setup to apply the settings to.');
  const s = settings;
  const { PLOT_STYLES, LINEWEIGHTS, SCALE_LINEWEIGHTS, PAPERSPACE_LAST } = PAGE_SETUP_FLAGS;
  // The paper as the device feeds it.
  let paper = {
    paperSize: base.paperSize,
    paperWidth: base.paperWidth,
    paperHeight: base.paperHeight,
    margins: base.margins,
  };
  const listed = PAPER_SIZES.find((p) => p.name === s.paper);
  if (listed && !(space.sheet === undefined && listedPaper(base) === s.paper)) {
    paper = {
      paperSize: mediaName(listed),
      paperWidth: listed.width,
      paperHeight: listed.height,
      margins: { left: 0, bottom: 0, right: 0, top: 0 },
    };
  }
  const fedLandscape = paper.paperWidth > paper.paperHeight;
  const turned = (s.orientation === 'landscape') !== fedLandscape;
  const rotation = ((turned ? 1 : 0) + (s.upsideDown ? 2 : 0)) as LayoutPlot['rotation'];

  // The scale, in the page setup's paper units.
  const k = base.paperUnits === 'inches' ? 25.4 : 1;
  const wasFit = (base.flags & USE_STANDARD_SCALE) !== 0 && base.standardScaleType === 0;
  const was = (base.scale.numerator * k) / base.scale.denominator;
  const now = s.scale.mm / s.scale.units;
  let flags = base.flags;
  let scale = base.scale;
  let standardScaleType: number | undefined = base.standardScaleType;
  if (s.fit) {
    flags |= USE_STANDARD_SCALE;
    standardScaleType = 0;
  } else if (wasFit || Math.abs(now - was) > 1e-12 * Math.max(now, was)) {
    flags &= ~USE_STANDARD_SCALE;
    standardScaleType = undefined;
    scale = { numerator: s.scale.mm / k, denominator: s.scale.units };
  }
  flags = setFlag(flags, PLOT_CENTERED, s.center);
  flags = setFlag(flags, PLOT_STYLES, s.plotStyles);
  flags = setFlag(flags, LINEWEIGHTS, s.lineweights || s.plotStyles);
  if (space.sheet) {
    flags = setFlag(flags, SCALE_LINEWEIGHTS, s.scaleLineweights);
    flags = setFlag(flags, PAPERSPACE_LAST, s.paperspaceLast);
  }

  // A layout's Layout area: its sheet moves by the offset (layoutSheet places it by DXF 46/47).
  const origin =
    s.center && s.area !== 'layout'
      ? base.origin
      : s.area === 'layout'
        ? { x: base.origin.x + s.offset.x, y: base.origin.y + s.offset.y }
        : s.offset;
  const window =
    s.area === 'window' && s.window
      ? { min: { x: s.window.minX, y: s.window.minY }, max: { x: s.window.maxX, y: s.window.maxY } }
      : base.window;
  // The table: the page setup's own name while it is the table the dialog opened on.
  const styleSheet =
    tableNamed(base.styleSheet ?? '', space) === s.table ? base.styleSheet : s.table;

  const { window: _w, styleSheet: _t, standardScaleType: _s, ...rest } = base;
  return {
    ...rest,
    ...paper,
    rotation,
    origin,
    scale,
    ...(standardScaleType !== undefined && { standardScaleType }),
    plotType: PLOT_TYPES[s.area],
    ...(window && { window }),
    flags,
    ...(styleSheet && { styleSheet }),
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
