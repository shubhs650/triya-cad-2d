// Plot pipeline (ARCHITECTURE.md §12): plot style tables and the resolver (M2-15).
export {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  OBJECT_COLOR,
  OBJECT_END_STYLE,
  OBJECT_FILL_STYLE,
  OBJECT_JOIN_STYLE,
  OBJECT_LINETYPE,
  OBJECT_LINEWEIGHT,
  PlotStyleTableError,
  newPlotStyle,
  parsePlotStyleTable,
  parsePlotStyleText,
  plotStyleText,
  writePlotStyleTable,
  type PlotStyle,
  type PlotStyleTable,
} from './plot-style-table';
export {
  PlotResolver,
  type PlotEndStyle,
  type PlotFillStyle,
  type PlotJoinStyle,
  type PlotLinetype,
  type PlotObject,
  type PlotProperties,
} from './resolver';
export { BUNDLED_PLOT_STYLE_TABLES, bundledPlotStyleTable } from './bundled';
export {
  pathPolygons,
  plotObject,
  plotParts,
  type PlotGlyphPart,
  type PlotInfinitePart,
  type PlotPart,
  type PlotPathPart,
  type PlotUnderlayPart,
  type PlotPointPart,
  type PlotRgb,
  type PlotSource,
} from './job';
export { POINTS_PER_MM, plotSetup, type PlotSetup, type PlotSetupOptions } from './setup';
export { MAX_RASTER_PIXELS, rasterSize, rasterizeSvg, type RasterizeOptions } from './raster';
