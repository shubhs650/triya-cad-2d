// Renderer-independent drawing style (M1-13): linetype patterns and their fitting, the ACI
// palette, ByLayer/ByBlock resolution and lineweight display. Pure functions; no Canvas2D.
export { aciRgb, rgbHex, type Rgb } from './aci';
export {
  dashPath,
  dashPolyline,
  type DashedPath,
  type DashOptions,
  type EmbedPlacement,
} from './dash';
export { parseLin, type LinFile, type LinIssue } from './lin';
export {
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
  resolveLinetype,
  type BlockContext,
  type LineweightDisplay,
  type PaintColor,
  type StyleSource,
  type Styled,
} from './resolve';
