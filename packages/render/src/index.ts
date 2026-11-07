// @triya/render: Renderer interface, Canvas2D implementation, plot pipeline.
// Browser package: DOM types are available here. Nothing outside it may use Canvas 2D.
export * from './types';
export { patternLibrary, tessellate, type Paint, type TessellateContext } from './tessellate';
export { adjustPixels, imagePrimitives, type ImageFrames, type PixelAdjustment } from './image';
export {
  browserDecode,
  decodeBmp,
  decodeRaster,
  decodeTiff,
  rasterFormat,
  type BrowserDecode,
  type DecodeOptions,
  type RasterFormat,
} from './decode/raster';
export {
  attributeShown,
  attributeText,
  textMeasure,
  textPrimitives,
  type TextContext,
} from './text';
export { primitivesBox, textBounds } from './text-bounds';
export { createPaint, defaultPaint, type PaintFunction, type PaintOptions } from './paint';
export {
  IDENTITY,
  affineScale,
  applyAffine,
  composeAffine,
  expandInsert,
  expands,
  referenceOf,
  insertTransforms,
  transformPath,
  transformPrimitive,
  type Affine,
  type BlockExpansion,
  type BlockSource,
  type InsertContextFunction,
} from './blocks';
export {
  Canvas2DRenderer,
  DEFAULT_STYLE,
  type Canvas2D,
  type Canvas2DRendererOptions,
  type Surface,
} from './canvas2d';
export {
  RendererHost,
  type HostCanvas,
  type RenderWorker,
  type RendererHostOptions,
  type RendererMode,
} from './host';
export {
  RenderSession,
  documentTolerance,
  fontBookOf,
  type FontSources,
  type RenderDocument,
  type RenderSessionOptions,
} from './session';
export { serveRenderer, type ServeOptions } from './serve';
export { thumbnailOf, thumbnailSize, type BitmapFactory, type ThumbnailSize } from './thumbnail';
export type { Endpoint, HostMessage, WorkerMessage } from './protocol';
export * from './style/index';
