// The app's engines (M1-67): each open drawing's session runs in its own engine worker.
import { controllersOf } from '../canvas/registry';
import { Engines } from './engines';
import { EngineHost } from './host';
import EngineWorker from './worker?worker';

export const engines = new Engines(
  (init) => new EngineHost(init, () => new EngineWorker()),
  controllersOf,
);
