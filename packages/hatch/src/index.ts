// @triya/hatch: .pat parser, pattern generation, boundary detection.
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export { loopSegments } from './boundary';
export {
  HPMAXLINES,
  hatchPattern,
  type HatchInput,
  type HatchPattern,
  type HatchPatternOptions,
} from './pattern';
