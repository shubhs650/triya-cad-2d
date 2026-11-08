// Renderer-independent drawing style (M1-13): linetype patterns and their fitting, the ACI
// palette, ByLayer/ByBlock resolution, lineweight display and draw order. Pure functions; no
// Canvas2D.
export { aciRgb, rgbHex, type Rgb } from './aci';
export { drawOrder } from './draw-order';
export {
  dashPath,
  dashPolyline,
  type DashedPath,
  type DashOptions,
  type EmbedPlacement,
} from './dash';
export { parseLin, type LinFile, type LinIssue } from './lin';
export {
  annotationLinetypeScale,
  linetypeScale,
  patternLength,
  patternOf,
  type EmbedRotation,
  type LinePattern,
  type LinetypeScaleInput,
  type PatternElement,
  type PatternEmbed,
} from './pattern';
export {
  blockContext,
  colorValue,
  effectiveLayer,
  lineweightPixels,
  resolveColor,
  resolveLineweight,
  resolveTransparency,
  resolveLinetype,
  type BlockContext,
  type LineweightDisplay,
  type PaintColor,
  type StyleSource,
  type Styled,
} from './resolve';
