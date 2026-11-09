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
  planStretch,
  planGrip,
  gripObjects,
  stretchObjects,
  type StretchPlan,
  type StretchWindow,
  eraseObjects,
  refusalMessages,
  transformObjects,
  type EditReport,
} from './edit';
export { stretchGeometry, type StretchOptions, type StretchResult } from './stretch';
export { gripsOf, moveGrip, sameGrip, type Grip, type GripKind } from './grips';
export * from './revcloud';
export * from './clipboard';
export * from './draw-order';
export * from './mleader';
export {
  writeDimensionBlock,
  type DimensionRegenerator,
  type RegeneratedParts,
} from './dimension-block';
