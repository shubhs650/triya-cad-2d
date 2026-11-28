// @triya/library: Pressure-vessel symbol generators (B16.5/B16.47, nozzles, supports, welds,
// surface texture symbols and standard notes).
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
export {
  SURFACE_FINISH_DEFAULTS,
  SURFACE_LAYS,
  SURFACE_LAY_SYMBOLS,
  SURFACE_PROCESSES,
  SURFACE_PROCESS_NAMES,
  SURFACE_STANDARD_NAMES,
  addSurfaceFinishBlock,
  checkSurfaceFinish,
  surfaceFinishDefaults,
  surfaceFinishDescription,
  surfaceFinishName,
  surfaceFinishParts,
  type SurfaceFinishSpec,
  type SurfaceLay,
  type SurfaceProcess,
  type SurfaceStandard,
} from './surface/surface';
export {
  STANDARD_NOTES,
  STANDARD_NOTES_DEFAULTS,
  STANDARD_NOTE_GROUPS,
  addStandardNotes,
  addStandardNotesBlock,
  checkStandardNotes,
  drawingUnits,
  standardNoteText,
  standardNotesBlockName,
  standardNotesContents,
  standardNotesDefaults,
  standardNotesGeometry,
  type DrawingUnits,
  type StandardNote,
  type StandardNoteField,
  type StandardNoteGroup,
  type StandardNoteId,
  type StandardNoteItem,
  type StandardNotesSpec,
} from './notes/notes';
export {
  DETAIL_GENERATORS,
  LIBRARY_ENTRIES,
  LIBRARY_GROUPS,
  addLibraryBlock,
  checkLibraryItem,
  detailGenerator,
  libraryAnswer,
  libraryBlock,
  libraryContext,
  libraryEntry,
  libraryItemDescription,
  libraryItemName,
  rescaleLibraryItem,
  searchLibrary,
  type LibraryAnswer,
  type LibraryBlock,
  type LibraryContext,
  type LibraryEntry,
  type LibraryGroup,
  type LibraryItem,
} from './catalogue';
export { libraryDrawingBlock, libraryDrawingBlocks } from './user-blocks';
