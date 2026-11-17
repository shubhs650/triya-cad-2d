// The app's engines (M1-67): each open drawing's session runs in its own engine worker.
import { controllersOf } from '../canvas/registry';
import { SpareWorker } from '../spare-worker';
import { Engines } from './engines';
import { EngineHost } from './host';
import EngineWorker from './worker?worker';

/**
 * The engine worker of the drawing being read (M4-22): started with the read, so its modules
 * load while the I/O worker reads the file; the drawing's engine takes it once the file is read.
 */
export const nextEngineWorker = new SpareWorker(() => new EngineWorker());

export const engines = new Engines(
  (init, changes) => new EngineHost(init, () => nextEngineWorker.take(), changes),
  controllersOf,
);
