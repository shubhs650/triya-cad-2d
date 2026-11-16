// @triya/hatch: .pat parser, pattern generation, boundary detection.
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export { loopSegments } from './boundary';
export {
  gradientRamp,
  type GradientFrame,
  type GradientInput,
  type GradientRamp,
} from './gradient';
export { PatternLibrary, bundledPatterns, explodedHatchLines, hatchLines } from './library';
export { MATERIAL_MOTIFS, materialPatternNames, motifLines, type Motif } from './materials';
export {
  parsePat,
  patternLines,
  userDefinedLines,
  type PatFile,
  type PatIssue,
  type PatLine,
  type PatPattern,
  type PatternPlacement,
} from './pat';
export {
  HPMAXLINES,
  hatchPattern,
  type HatchFamily,
  type HatchInput,
  type HatchPattern,
  type HatchPatternOptions,
} from './pattern';
