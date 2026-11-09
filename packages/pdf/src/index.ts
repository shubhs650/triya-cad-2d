// @triya/pdf: Vector PDF writer (CTB-aware), PDF underlay via pdf.js.
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
  type PlotItem,
  type PlotPageOptions,
  type PlotPaint,
} from './plot';
export { PAPER_SIZES, mmToPoints, paperSize, type PaperSize } from './paper';
