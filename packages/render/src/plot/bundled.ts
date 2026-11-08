// The bundled plot style tables (M2-15; PRD FR-P1: "bundled monochrome/grayscale/default"),
// authored here and written to assets/plotstyles by `pnpm plotstyles:build` (a test keeps the
// files and these definitions equal). They are Triya's own, not copies of Autodesk's files:
// each says only what its name means.
//
// - triya-default: every style uses the object's properties, as plotting with no table does.
// - triya-monochrome: every style plots black; all else is the object's.
// - triya-grayscale: every style converts the object's colour to grey.
// - The named tables hold Normal and Style 1, the two a new STB starts with. AutoCAD's editor
//   does not let Normal be changed; triya-monochrome.stb sets it black all the same, since a
//   monochrome table whose Normal plots in colour would not be monochrome.
//
// A drawing's page setup names its table by file name; `bundledPlotStyleTable` answers the
// names AutoCAD gives its own (monochrome.ctb, acad.ctb, …) with these.

import {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  newPlotStyle,
  type PlotStyle,
  type PlotStyleTable,
} from './plot-style-table';

function ctb(description: string, edit: Partial<PlotStyle>): PlotStyleTable {
  return {
    kind: 'ctb',
    description,
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: DEFAULT_PLOT_LINEWEIGHTS,
    styles: Array.from({ length: CTB_STYLE_COUNT }, (_, i) => ({
      ...newPlotStyle(`Color_${i + 1}`),
      ...edit,
    })),
  };
}

function stb(description: string, edit: Partial<PlotStyle>): PlotStyleTable {
  return {
    kind: 'stb',
    description,
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: DEFAULT_PLOT_LINEWEIGHTS,
    // AutoCAD sets color_policy bit 4 on a named table's styles.
    styles: ['Normal', 'Style 1'].map((name) => ({
      ...newPlotStyle(name),
      namedColor: true,
      ...edit,
    })),
  };
}

const BLACK = { color: [0, 0, 0] as const };

/** By file name, as shipped in assets/plotstyles. */
export const BUNDLED_PLOT_STYLE_TABLES: Readonly<Record<string, PlotStyleTable>> = {
  'triya-default.ctb': ctb('Triya: plot every object as it is', {}),
  'triya-monochrome.ctb': ctb('Triya: plot every object black', BLACK),
  'triya-grayscale.ctb': ctb('Triya: plot every colour as its grey', { grayscale: true }),
  'triya-default.stb': stb('Triya: plot every object as it is', {}),
  'triya-monochrome.stb': stb('Triya: plot every object black', BLACK),
};

/** The names AutoCAD gives its own tables, answered with the bundled table of that meaning. */
const ALIASES: Readonly<Record<string, string>> = {
  'acad.ctb': 'triya-default.ctb',
  'acadlt.ctb': 'triya-default.ctb',
  'default.ctb': 'triya-default.ctb',
  'monochrome.ctb': 'triya-monochrome.ctb',
  'grayscale.ctb': 'triya-grayscale.ctb',
  'acad.stb': 'triya-default.stb',
  'acadlt.stb': 'triya-default.stb',
  'default.stb': 'triya-default.stb',
  'monochrome.stb': 'triya-monochrome.stb',
};

/**
 * The bundled table for the plot style table a layout or page setup names (DXF 1 of
 * PLOTSETTINGS, `VIEWPORT` 1), by its file name in any case and folder; undefined when Triya
 * bundles none of that name (a table the user drops is looked up by the app, M2-20).
 */
export function bundledPlotStyleTable(sheet: string): PlotStyleTable | undefined {
  const file = sheet.split(/[\\/]/).pop()!.toLowerCase();
  return BUNDLED_PLOT_STYLE_TABLES[ALIASES[file] ?? file];
}
