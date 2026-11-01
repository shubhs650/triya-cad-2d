// Module Web Worker entry for file I/O (ARCHITECTURE.md §3): parses DWG/DXF off the main thread.
// Spawn one per job through `readInWorker`, which terminates it when the job ends:
// `new Worker(new URL('…/io.worker.ts', import.meta.url), { type: 'module' })`.
import * as Comlink from 'comlink';
import { ioApi } from './api';

Comlink.expose(ioApi);
