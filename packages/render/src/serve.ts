// The render worker's message loop, kept apart from the worker entry so tests can drive it
// with an in-process endpoint. Messages are handled in order, so a hit test, flush, thumbnail or
// extents request answers after every change, view and frame posted before it.

import type { Surface } from './canvas2d';
import type { Endpoint, HostMessage, WorkerMessage } from './protocol';
import { RenderSession } from './session';
import type { BitmapFactory } from './thumbnail';

export interface ServeOptions {
  /** The surface for the transferred canvas. */
  readonly surfaceOf: (canvas: unknown) => Surface;
  readonly createLayer: () => Surface;
  readonly now?: () => number;
  readonly requestIdle?: (cb: () => void) => void;
  /** `createImageBitmap` by default (thumbnails, M1-22). */
  readonly createBitmap?: BitmapFactory;
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
        ...(m.fonts && { fonts: m.fonts }),
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
      case 'fonts':
        session.setFonts(m.fonts);
        break;
      case 'frame':
        r.frame();
        break;
      case 'image':
        session.setImage(m.definition, m.pixels ?? undefined);
        break;
      case 'hitTest':
        port.postMessage({ type: 'reply', id: m.id, ids: r.hitTest(m.screen, m.aperture) });
        break;
      case 'flush':
        port.postMessage({ type: 'reply', id: m.id });
        break;
      case 'extents':
        port.postMessage({ type: 'extents', id: m.id, box: session.extents() ?? null });
        break;
      case 'thumbnail': {
        // The copy is taken now, in message order; only the answer waits for the bitmap.
        const id = m.id;
        session.thumbnail({ width: m.width, height: m.height }, o.createBitmap).then(
          (bitmap) =>
            bitmap
              ? port.postMessage({ type: 'thumbnail', id, bitmap }, [bitmap])
              : port.postMessage({ type: 'thumbnail', id, bitmap: null }),
          (e: unknown) =>
            port.postMessage({
              type: 'error',
              id,
              message: e instanceof Error ? e.message : String(e),
            }),
        );
        break;
      }
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
