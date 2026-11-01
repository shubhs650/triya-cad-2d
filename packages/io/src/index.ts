// @triya/io: acad-ts adapter, passthrough, DXF/DWG/SVG/PNG/PDF import/export.
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
// The worker entry is exported separately as `@triya/io/worker` so importing this module never
// installs a message handler.
export { detectFormat, readCadDocument, summarizeDocument } from './read';
export type { CadFormat, ReadSummary } from './read';
export { writeCadDocument } from './write';
export type { WriteOptions } from './write';
export { handleIoRequest } from './worker/protocol';
export type { IoRequest, IoResponse, ReadRequest } from './worker/protocol';
