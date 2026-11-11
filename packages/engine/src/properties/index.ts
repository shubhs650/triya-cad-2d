// The Properties palette (M2-21): the sheet of the selected objects' properties and its edits.
export * from './sheet';
export {
  applyCurrentEdit,
  applyPropertyEdit,
  type PropertyEdit,
  type PropertyEditReport,
} from './edit';
export { CETRANSPARENCY, currentHeader, currentProps } from './current';
export { polylineArea, polylineLength } from './measure';
