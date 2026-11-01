// @triya/render: Renderer interface, Canvas2D implementation, plot pipeline.
// Browser package: DOM types are available here. Nothing outside it may use Canvas 2D.
export * from './types';
export { tessellate, type Paint } from './tessellate';
export { colorOf, defaultPaint, lineweightOf } from './paint';
