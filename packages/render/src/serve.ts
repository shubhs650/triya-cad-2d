// The render worker's message loop, kept apart from the worker entry so tests can drive it
// with an in-process endpoint. Messages are handled in order, so a hit test or flush answers
// after every change, view and frame posted before it.

import type { Surface } from './canvas2d';
import type { Endpoint, HostMessage, WorkerMessage } from './protocol';
import { RenderSession } from './session';

export interface ServeOptions {
  /** The surface for the transferred canvas. */
  readonly surfaceOf: (canvas: unknown) => Surface;
  readonly createLayer: () => Surface;
  readonly now?: () => number;
  readonly requestIdle?: (cb: () => void) => void;
}

export function serveRenderer(port: Endpoint<HostMessage, WorkerMessage>, o: ServeOptions): void {
  let session: RenderSession | undefined;

  const handle = (m: HostMessage): void => {
    if (m.type === 'init') {
      session = new RenderSession({
        document: m.document,
        surface: o.surfaceOf(m.canvas),
        createLayer: o.createLayer,
        ...(m.style && { style: m.style }),
        ...(m.patterns && { patterns: m.patterns }),
        ...(o.now && { now: o.now }),
        ...(o.requestIdle && { requestIdle: o.requestIdle }),
      });
      return;
    }
    if (!session) throw new Error(`render worker got '${m.type}' before 'init'`);
    const r = session.renderer;
    switch (m.type) {
      case 'resize':
        r.resize(m.width, m.height, m.dpr);
        break;
      case 'view':
        r.setView(m.view);
        break;
      case 'apply':
        session.apply(m.change);
        break;
      case 'transient':
        r.setTransient(m.primitives);
        break;
      case 'style':
        r.setStyle(m.style);
        break;
      case 'patterns':
        r.setPatterns(m.sources);
        break;
      case 'frame':
        r.frame();
        break;
      case 'hitTest':
        port.postMessage({ type: 'reply', id: m.id, ids: r.hitTest(m.screen, m.aperture) });
        break;
      case 'flush':
        port.postMessage({ type: 'reply', id: m.id });
        break;
    }
  };

  port.addEventListener('message', ({ data }) => {
    try {
      handle(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const id = 'id' in data ? data.id : undefined;
      port.postMessage(
        id === undefined ? { type: 'error', message } : { type: 'error', message, id },
      );
    }
  });
}
