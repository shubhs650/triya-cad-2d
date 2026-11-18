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
export * from './image-clip';
export * from './clipboard';
export * from './clipboard-data';
export * from './picture';
export * from './underlay-attach';
export * from './draw-order';
export * from './mleader';
export * from './mleader-blocks';
export * from './arrowhead-blocks';
export * from './refedit';
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
export * from './table-data';
export * from './table-locks';
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
export * from './leader-breaks';
export * from './center-marks';
export * from './layer-states';
export * from './linetypes';
export * from './center-mark-grips';
export * from './center-settings';
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
export { detachXrefs, xrefDetachChange, xrefDetachProblem } from './xrefs';
export { bindXrefs, xrefBindChange, xrefBindProblem } from './xref-bind';
export {
  XBIND_TABLES,
  xbindChange,
  xbindDefinition,
  xbindDefinitions,
  xbindXrefs,
  type XbindDefinition,
  type XbindKind,
  type XbindReport,
  type XbindXref,
} from './xbind';
export {
  attachXref,
  xrefFileName,
  xrefNameFor,
  xrefOfFile,
  type XrefAttachFile,
} from './xref-attach';
export {
  clipOf,
  clipOutline,
  inverseInsertMatrix,
  selfIntersecting,
  setClip,
  setClipEnabled,
  xclipProblem,
} from './xclip';
export {
  currentLayerChange,
  deleteLayersChange,
  mergeLayersChange,
  mergeLayers,
  deleteLayersWithObjects,
  layerRemovalProblem,
  layerPropsChange,
  layersInUse,
  newLayerChange,
  newLayerName,
  type LayerProps,
} from './layer-manager';
export {
  PURGE_CATEGORIES,
  PURGE_RULES,
  emptyTextObjects,
  isEmptyText,
  isZeroLength,
  purgeClosure,
  purgeInto,
  purgeState,
  zeroLengthObjects,
  type InUseItem,
  type PurgeCategory,
  type PurgeItem,
  type PurgeState,
} from './purge';
