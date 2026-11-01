// Render worker entry (ARCHITECTURE.md §3): owns the transferred OffscreenCanvas and draws the
// scene from the ChangeSets the main thread forwards. Spawn it with
// `new Worker(new URL('@triya/render/worker', import.meta.url), { type: 'module' })`.

import type { Endpoint, HostMessage, WorkerMessage } from './protocol';
import { serveRenderer } from './serve';
import { offscreenLayer, surfaceOf } from './surface';

serveRenderer(self as unknown as Endpoint<HostMessage, WorkerMessage>, {
  surfaceOf: (canvas) => surfaceOf(canvas as OffscreenCanvas),
  createLayer: offscreenLayer,
});
