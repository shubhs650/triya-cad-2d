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
export { FLANGE_VIEWS, flangeParts, type FlangeView } from './flanges/draw';
export { addFlangeBlock, flangeBlockName, flangeDescription } from './flanges/block';
export type { LibraryPart, PartRole } from './parts';
export { drawingScale } from './block';
export {
  addDetailBlock,
  checkDetail,
  detailBlockName,
  detailDefaults,
  detailDescription,
  type DetailField,
  type DetailGenerator,
  type DetailSpec,
} from './details/detail';
export { NOZZLE_SET_IN, NOZZLE_SET_ON } from './details/nozzle';
export { ANCHOR_CHAIR, BRACKET, LEG, SADDLE, SKIRT, SUPPORTS } from './details/supports';
export {
  WELD_CONTOURS,
  WELD_STANDARD_NAMES,
  WELD_SYMBOL_DEFAULTS,
  WELD_TYPES,
  WELD_TYPE_NAMES,
  addWeldSymbolBlock,
  checkWeldSymbol,
  weldSymbolDefaults,
  weldSymbolDescription,
  weldSymbolName,
  weldSymbolParts,
  type WeldContour,
  type WeldSide,
  type WeldStandard,
  type WeldSymbolSpec,
  type WeldType,
} from './welds/weld';
