// RendererHost: the main thread's handle on the renderer (ARCHITECTURE.md §3, §15).
//
// Where the browser can transfer a canvas to a worker, the host does so and forwards every
// call to the render worker, which runs a RenderSession on the OffscreenCanvas. Where it cannot
// (older Safari and Firefox), the host runs the same RenderSession on the main thread. Both
// paths draw with the same code, so they render identically; the Playwright pixel test checks
// that. Calls are fire-and-forget either way; the two that need an answer return promises.

import type { ChangeSet, EntityId } from '@triya/engine';
import type { Surface } from './canvas2d';
import type { Endpoint, HostMessage, WorkerMessage } from './protocol';
import { RenderSession, type RenderDocument } from './session';
import { offscreenLayer, surfaceOf } from './surface';
import type { RenderPrimitive, RenderStyle, ViewTransform } from './types';

/** The canvas element the host draws into, typed by the members it uses. */
export interface HostCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
  transferControlToOffscreen?: () => unknown;
}

export type RenderWorker = Endpoint<WorkerMessage, HostMessage> & { terminate(): void };

export type RendererMode = 'worker' | 'main';

export interface RendererHostOptions {
  readonly canvas: HostCanvas;
  readonly document: RenderDocument;
  /** `auto` (default) uses the worker when the browser can transfer the canvas. */
  readonly mode?: RendererMode | 'auto';
  /**
   * Spawns the render worker, e.g.
   * `() => new Worker(new URL('@triya/render/worker', import.meta.url), { type: 'module' })`.
   * Without it the host runs on the main thread.
   */
  readonly createWorker?: () => RenderWorker;
  readonly style?: RenderStyle;
  /** The user's .pat files (M1-50), in the order added. */
  readonly patterns?: readonly string[];
  /** Main-thread layers; defaults to OffscreenCanvas, as in the worker. */
  readonly createLayer?: () => Surface;
  /** A failure in the render worker that no pending request was waiting for. */
  readonly onError?: (error: Error) => void;
}

interface Pending {
  resolve(ids: readonly EntityId[]): void;
  reject(e: Error): void;
}

export class RendererHost {
  readonly mode: RendererMode;
  readonly #worker: RenderWorker | undefined;
  readonly #session: RenderSession | undefined;
  readonly #pending = new Map<number, Pending>();
  readonly #onError: (error: Error) => void;
  #nextId = 1;

  /** Whether `auto` would pick the worker for this canvas. */
  static canUseWorker(canvas: HostCanvas, createWorker?: () => RenderWorker): boolean {
    return (
      createWorker !== undefined &&
      typeof canvas.transferControlToOffscreen === 'function' &&
      typeof OffscreenCanvas !== 'undefined'
    );
  }

  constructor(o: RendererHostOptions) {
    this.#onError =
      o.onError ??
      ((e) => {
        throw e;
      });
    const wanted = o.mode ?? 'auto';
    const worker = wanted === 'main' ? false : RendererHost.canUseWorker(o.canvas, o.createWorker);
    if (wanted === 'worker' && !worker) {
      throw new Error('the render worker needs createWorker and OffscreenCanvas transfer');
    }
    this.mode = worker ? 'worker' : 'main';

    if (worker && o.createWorker && o.canvas.transferControlToOffscreen) {
      const offscreen = o.canvas.transferControlToOffscreen();
      const w = o.createWorker();
      this.#worker = w;
      w.addEventListener('message', ({ data }) => this.#receive(data));
      w.postMessage(
        {
          type: 'init',
          canvas: offscreen,
          document: o.document,
          ...(o.style && { style: o.style }),
          ...(o.patterns && { patterns: o.patterns }),
        },
        [offscreen as Transferable],
      );
    } else {
      this.#session = new RenderSession({
        document: o.document,
        surface: surfaceOf(o.canvas),
        createLayer: o.createLayer ?? offscreenLayer,
        ...(o.style && { style: o.style }),
        ...(o.patterns && { patterns: o.patterns }),
      });
    }
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.#session) this.#session.renderer.resize(width, height, dpr);
    else this.#post({ type: 'resize', width, height, dpr });
  }

  setView(view: ViewTransform): void {
    if (this.#session) this.#session.renderer.setView(view);
    else this.#post({ type: 'view', view });
  }

  /** Forwards a ChangeSet the engine has applied. */
  apply(change: ChangeSet): void {
    if (this.#session) this.#session.apply(change);
    else this.#post({ type: 'apply', change });
  }

  setTransient(primitives: readonly RenderPrimitive[]): void {
    if (this.#session) this.#session.renderer.setTransient(primitives);
    else this.#post({ type: 'transient', primitives });
  }

  setStyle(style: RenderStyle): void {
    if (this.#session) this.#session.renderer.setStyle(style);
    else this.#post({ type: 'style', style });
  }

  /** Replaces the user's .pat files; open hatches stored without lines redraw from them. */
  setPatterns(sources: readonly string[]): void {
    if (this.#session) this.#session.renderer.setPatterns(sources);
    else this.#post({ type: 'patterns', sources });
  }

  frame(): void {
    if (this.#session) this.#session.renderer.frame();
    else this.#post({ type: 'frame' });
  }

  /** Entities within `aperture` CSS pixels of a screen point, nearest first. */
  hitTest(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
  ): Promise<EntityId[]> {
    if (this.#session) return Promise.resolve(this.#session.renderer.hitTest(screen, aperture));
    return this.#request((id) => ({ type: 'hitTest', id, screen, aperture })).then((ids) => [
      ...ids,
    ]);
  }

  /** Resolves once everything sent so far has been handled (drawn, for a `frame`). */
  flush(): Promise<void> {
    if (this.#session) return Promise.resolve();
    return this.#request((id) => ({ type: 'flush', id })).then(() => undefined);
  }

  dispose(): void {
    this.#worker?.terminate();
    const gone = new Error('the renderer was disposed');
    for (const p of this.#pending.values()) p.reject(gone);
    this.#pending.clear();
  }

  #post(m: HostMessage): void {
    this.#worker?.postMessage(m);
  }

  #request(make: (id: number) => HostMessage): Promise<readonly EntityId[]> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#post(make(id));
    });
  }

  #receive(m: WorkerMessage): void {
    const p = m.id === undefined ? undefined : this.#pending.get(m.id);
    if (m.id !== undefined) this.#pending.delete(m.id);
    if (m.type === 'reply') {
      p?.resolve(m.ids ?? []);
      return;
    }
    const error = new Error(`render worker: ${m.message}`);
    if (p) p.reject(error);
    else this.#onError(error);
  }
}
