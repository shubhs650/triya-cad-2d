// @triya/library: Pressure-vessel symbol generators (B16.5/B16.47, nozzles, supports, welds).
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export { B16_5_TABLES, type B165Row } from './flanges/b16-5-tables';
export {
  PIPE_SCHEDULES,
  pipeBore,
  pipeOutsideDiameter,
  type PipeSchedule,
} from './flanges/pipe-bores';
export {
  B16_5_CLASSES,
  B16_5_SIZES,
  FLANGE_TYPES,
  FLANGE_TYPE_NAMES,
  b165Flange,
  b165Sizes,
  npsLabel,
  raisedFaceHeight,
  type B165Class,
  type B165Spec,
  type FlangeDimensions,
  type FlangeType,
} from './flanges/b16-5';
export {
  FLANGE_VIEWS,
  flangeParts,
  type FlangeView,
  type LibraryPart,
  type PartRole,
} from './flanges/draw';
export { addFlangeBlock, drawingScale, flangeBlockName, flangeDescription } from './flanges/block';
