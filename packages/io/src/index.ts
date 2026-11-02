// @triya/io: acad-ts adapter, passthrough, DXF/DWG/SVG/PNG/PDF import/export.
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
// The worker entry is exported separately as `@triya/io/worker` so importing this module never
// installs a message handler.
export { detectFormat, readCadDocument, summarizeDocument } from './read';
export type { CadFormat, ReadSummary } from './read';
export { fidelityDwgConfiguration, fidelityDxfConfiguration, writeCadDocument } from './write';
export type { WriteOptions } from './write';
export { ioApi } from './worker/api';
export type { IoApi, IoProgress, OpenResult, ProgressCallback } from './worker/api';
export { openInWorker, readInWorker } from './worker/client';
export type { AbortSignalLike, IoWorker, ReadInWorkerOptions } from './worker/client';
export { mapHeader, type MappedHeader } from './map/header';
export { mapTables, type MappedTables } from './map/tables';
export { aciOfTrueColor } from './map/common';
export { mapEntities, type MappedEntities, type UnmappedEntity } from './map/entities';
export { mapSortEnts } from './map/sortents';
export { mapLayouts } from './map/layouts';
export { documentInit, openDocument, type OpenedDocument } from './map/document';
