// Module Web Worker entry for file I/O (ARCHITECTURE.md §3): parses DWG/DXF off the main thread.
// Spawn with `new Worker(new URL('…/io.worker.ts', import.meta.url), { type: 'module' })`.
// This package compiles without the DOM/WebWorker libs, so the worker scope is typed locally.
import { handleIoRequest, type IoRequest, type IoResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: { data: IoRequest }) => void) | null;
  postMessage(message: IoResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(handleIoRequest(event.data));
};
