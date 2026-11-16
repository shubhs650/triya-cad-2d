// The core edits behind ERASE, MOVE, COPY, ROTATE, SCALE and MIRROR (M2-06).
export { similarity, moveBy, turnAbout, scaleAbout, mirrorIn, type Similarity } from './similarity';
export {
  FIXED_KINDS,
  transformGeometry,
  transformProblem,
  type TransformOptions,
} from './transform';
export {
  copyObjects,
  inBox,
  inPolygon,
  stretchInside,
  planStretch,
  planGrip,
  gripObjects,
  stretchObjects,
  type StretchPlan,
  type StretchWindow,
  eraseObjects,
  reshapeObject,
  revertChanges,
  refusalMessages,
  transformObjects,
  type EditReport,
} from './edit';
export { stretchGeometry, type StretchOptions, type StretchResult } from './stretch';
export {
  gripDimensionsOf,
  gripsOf,
  moveGrip,
  sameGrip,
  type Grip,
  type GripDimensions,
  type GripKind,
} from './grips';
export * from './array-grips';
export * from './grip-functions';
export { hasDynamicColumns, withColumnCount } from './mtext-grips';
export { hatchGripPoint, viewportCorners } from './shape-grips';
export * from './revcloud';
export * from './clipboard';
export * from './clipboard-data';
export * from './picture';
export * from './draw-order';
export * from './mleader';
export * from './mleader-blocks';
export * from './arrowhead-blocks';
export {
  writeDimensionBlock,
  type DimensionRegenerator,
  type RegeneratedParts,
} from './dimension-block';
export * from './dimension';
export * from './dimstyle-preview';
export * from './dimstyle-import';
export * from './table';
export * from './table-grid';
export * from './table-format';
export * from './table-grips';
export * from './spreadsheet';
export * from './named-view';
export { offsetCurveOf, offsetGeometry, offsetSide } from './offset';
export {
  cutParams,
  edgeCurvesOf,
  extendGeometry,
  isClosedCurve,
  pickParam,
  subGeometry,
  subSpline,
  trimCurveOf,
  trimGeometry,
} from './trim';
export {
  edgeTexts,
  objectEdgeCurves,
  type EdgeOptions,
  type EdgeSource,
  type EdgeText,
} from './trim-edges';
export * from './corner';
export * from './break';
export * from './join';
export * from './line-heights';
export * from './explode';
export * from './underlay-layers';
export * from './array';
export * from './assoc-array';
export * from './dimension-records';
export * from './center-marks';
export * from './pedit';
export * from './splinedit';
export * from './overkill';
export * from './groups';
export * from './snap-grid';
export * from './mleader-align';
export {
  boundaryAt,
  boundaryOfObjects,
  boundedCurves,
  type BoundaryOptions,
  type IslandStyle,
  type PickedBoundary,
} from './hatch-boundary';
export {
  HATCH_BACKGROUND_APP,
  backgroundColorOf,
  backgroundColorValue,
  hatchBackgroundAppId,
  withHatchBackground,
  type BackgroundColor,
} from './hatch-background';
export { retainedBoundary } from './hatch-retain';
export {
  hatchAreas,
  loopCurves,
  loopSamples,
  passesThrough,
  type HatchArea,
} from './hatch-separate';
export * from './text-justify';
export * from './text-align';
export * from './find-text';
export * from './fields';
export * from './field-codes';
export * from './field-eval';
export * from './spelling';
export * from './tolerance-frame';
