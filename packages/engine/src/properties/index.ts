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
  multiLeaderTextsToMeasure,
  patternPlacement,
  placedPatterns,
  type HatchPatterns,
  type PropertyEdit,
  type PropertyEditReport,
} from './edit';
export { CETRANSPARENCY, currentHeader, currentProps } from './current';
export { polylineArea, polylineLength } from './measure';
export { MLEADER_TEXT_OVERRIDES, type MultiLeaderWidths } from './multileader';
export { HYPERLINK_APP, hasThickness, hyperlinkOf } from './general';
export { QUICK_GENERAL, QUICK_PROPERTIES, hasQuickProperties, quickPropertySheet } from './quick';
