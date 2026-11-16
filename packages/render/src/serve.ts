// The render worker's message loop, kept apart from the worker entry so tests can drive it
// with an in-process endpoint. Messages are handled in order, so a hit test, flush, thumbnail or
// extents request answers after every change, view and frame posted before it.
//
// The drawing's engine also posts each change set it applies straight to the worker, on the
// change port it was handed at init (M2-62): after a click Chromium holds the main thread's
// tasks until its next frame, so the change drawn from there reaches the screen up to a frame
// earlier than the main thread's copy would. Both copies carry the change's number in the
// drawing's change log; one from the port is applied only when it is the next number, so a
// renderer that was linked after the engine applied a change (or replays the log on creation)
// waits for the main thread's copies, which always come, and none is applied twice.

import type { Surface } from './canvas2d';
import type { ChangeMessage, Endpoint, HostMessage, WorkerMessage } from './protocol';
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
  /** Whether the canvas has a size and a view: what a change from the engine needs to draw. */
  let sized = false;
  let viewed = false;

  const fail = (e: unknown, id?: number): void => {
    const message = e instanceof Error ? e.message : String(e);
    port.postMessage(
      id === undefined ? { type: 'error', message } : { type: 'error', message, id },
    );
  };

  /** A change set from the drawing's engine (M2-62): applied and drawn when it is next. */
  const fromEngine = (m: ChangeMessage): void => {
    try {
      if (!session || m.seq !== session.applied + 1) return;
      session.apply(m.change, m.seq);
      if (sized && viewed) session.frame();
    } catch (e) {
      fail(e);
    }
  };

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
        onUnderlayRequest: (request) => port.postMessage({ type: 'underlayRequest', request }),
      });
      if (m.changes) {
        const changes = m.changes as Endpoint<ChangeMessage, never> & { start?(): void };
        changes.addEventListener('message', ({ data }) => fromEngine(data));
        // A MessagePort listened to with addEventListener delivers only once started.
        changes.start?.();
      }
      return;
    }
    if (!session) throw new Error(`render worker got '${m.type}' before 'init'`);
    const r = session.renderer;
    switch (m.type) {
      case 'resize':
        r.resize(m.width, m.height, m.dpr);
        sized = m.width > 0 && m.height > 0;
        break;
      case 'view':
        r.setView(m.view);
        viewed = true;
        break;
      case 'apply':
        session.apply(m.change, m.seq);
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
        session.frame();
        break;
      case 'image':
        session.setImage(m.definition, m.pixels ?? undefined);
        break;
      case 'underlay':
        session.setUnderlay(m.definition, m.raster ?? undefined);
        break;
      case 'underlayPage':
        session.setUnderlayPage(m.definition, m.page ?? undefined);
        break;
      case 'underlaySnap':
        session.setUnderlaySnap(m.definition, m.page ?? undefined);
        break;
      case 'hitTest':
        port.postMessage({ type: 'reply', id: m.id, ids: r.hitTest(m.screen, m.aperture) });
        break;
      case 'select':
        port.postMessage({ type: 'reply', id: m.id, ids: r.select(m.query) });
        break;
      case 'highlight':
        r.setHighlight(m.ids);
        break;
      case 'drag':
        r.setDrag(m.motion ?? undefined);
        break;
      case 'grips':
        r.setGrips(m.ids, m.hot ?? undefined, m.groups);
        break;
      case 'grip-hover':
        r.setGripHover(m.at ?? undefined, m.within);
        break;
      case 'selection-preview':
        r.setSelectionPreview(m.preview ?? undefined);
        break;
      case 'bounds':
        port.postMessage({ type: 'extents', id: m.id, box: session.boundsOf(m.ids) ?? null });
        break;
      case 'textBox':
        port.postMessage({ type: 'extents', id: m.id, box: session.textBox(m.text) ?? null });
        break;
      case 'textWidths':
        port.postMessage({ type: 'widths', id: m.id, widths: session.textWidths(m.texts) });
        break;
      case 'textPieces':
        port.postMessage({ type: 'pieces', id: m.id, pieces: session.textPieces(m.texts) });
        break;
      case 'columnCounts':
        port.postMessage({ type: 'counts', id: m.id, counts: session.columnCounts(m.texts) });
        break;
      case 'dimensionHealth':
        port.postMessage({ type: 'dimensionHealth', id: m.id, health: session.dimensionHealth() });
        break;
      case 'textOutlines':
        port.postMessage({ type: 'outlines', id: m.id, outlines: session.textOutlines(m.texts) });
        break;
      case 'snap':
        port.postMessage({ type: 'snap', id: m.id, hits: session.snap(m.query) });
        break;
      case 'quick':
        port.postMessage({ type: 'quick', id: m.id, measure: session.quickMeasure(m.query) });
        break;
      case 'enclosed':
        port.postMessage({
          type: 'enclosed',
          id: m.id,
          space: session.enclosedSpace(m.point, m.view) ?? null,
        });
        break;
      case 'entitiesIn':
        port.postMessage({ type: 'entities', id: m.id, entities: r.entitiesIn(m.rect) });
        break;
      case 'flush':
        port.postMessage({ type: 'reply', id: m.id });
        break;
      case 'drawnAt':
        port.postMessage({ type: 'drawnAt', id: m.id, at: session.drawnAt(m.seq) ?? null });
        break;
      case 'plot':
        port.postMessage({ type: 'plot', id: m.id, parts: session.plot(m.request) });
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
      fail(e, 'id' in data ? data.id : undefined);
    }
  });
}
