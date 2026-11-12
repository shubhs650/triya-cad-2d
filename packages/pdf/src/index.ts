// @triya/pdf: Vector PDF writer (CTB-aware); PDF underlay pages copied into plots (reader.ts).
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export { ContentStream, pdfNumber, type LineCap, type LineJoin, type Rgb } from './content';
export {
  PdfDocument,
  PdfPage,
  pdfDate,
  pdfString,
  type PdfDocumentOptions,
  type PdfPageOptions,
} from './document';
export {
  IDENTITY,
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  emitSegments,
  pathSegments,
  subpathLength,
  subpaths,
  sweepOf,
  type Affine,
  type Segment,
} from './path';
export {
  PLOT_LINETYPES,
  POINTS_PER_INCH,
  POINTS_PER_MM,
  adaptDashes,
  dashPeriod,
  plotDashes,
  type PlotDashOptions,
  type PlotLinetypeDef,
} from './linetypes';
export {
  paperTransform,
  plotItems,
  type PlotGlyph,
  type PlotGradient,
  type PlotImage,
  type PlotInfiniteItem,
  type PlotItem,
  type PlotPageOptions,
  type PlotPaint,
  type PlotPathItem,
  type PlotPointItem,
  type PlotUnderlay,
} from './plot';
export {
  PdfImports,
  pageView,
  underlayPageIndex,
  type ImportedForm,
  type ObjectBody,
  type ObjectWriter,
  type PageView,
  type UnderlayLook,
} from './import';
export {
  PdfName,
  PdfReadError,
  PdfRef,
  PdfSource,
  PdfStream,
  PdfString,
  pdfReal,
  writeValue,
  type PdfDict,
  type PdfPageEntry,
  type PdfValue,
} from './reader';
export {
  FILL_CELL,
  FILL_STYLES,
  encodeImage,
  gradientFunction,
  type EncodedImage,
  type FillStyle,
  type GradientStop,
  type PlotPixels,
} from './fills';
export { PAPER_SIZES, mmToPoints, paperSize, type PaperSize } from './paper';
export { EmbeddedFont, PdfFonts, type PlotFont } from './fonts';
export { TrueTypeFont } from './truetype';
export { SFNT_CFF, SFNT_TRUETYPE, SfntFont, cmapTable, readSfnt, writeSfnt } from './sfnt';
export { SvgFont, SvgFonts, svgText } from './svg-text';
export { CffFont, cffDict, cffIndex, readDict, readIndex } from './cff';
export { base64, crc32, encodePng, type PngOptions } from './png';
export {
  plotSvg,
  underlayRasterPlan,
  UNDERLAY_MAX_PIXELS,
  xmlEscape,
  type PageRegion,
  type SvgPlotOptions,
  type SvgUnderlayRaster,
  type UnderlayRasterPlan,
} from './svg';
