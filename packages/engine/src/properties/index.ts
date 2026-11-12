// The Properties palette (M2-21): the sheet of the selected objects' properties and its edits.
export * from './sheet';
export {
  DIMVAR_DEFAULTS,
  DIMVAR_ROWS,
  rowVars,
  type DimvarRow,
  type DimvarSection,
} from './dimension';
export {
  applyCurrentEdit,
  applyPropertyEdit,
  hatchesToPattern,
  patternPlacement,
  placedPatterns,
  type HatchPatterns,
  type PropertyEdit,
  type PropertyEditReport,
} from './edit';
export { CETRANSPARENCY, currentHeader, currentProps } from './current';
export { polylineArea, polylineLength } from './measure';
