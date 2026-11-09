// RendererHost: the main thread's handle on the renderer (ARCHITECTURE.md §3, §15).
//
// Where the browser can transfer a canvas to a worker, the host does so and forwards every
// call to the render worker, which runs a RenderSession on the OffscreenCanvas. Where it cannot
// (older Safari and Firefox), the host runs the same RenderSession on the main thread. Both
// paths draw with the same code, so they render identically; the Playwright pixel test checks
// that. Calls are fire-and-forget either way; those that need an answer return promises.

import type {
  Box,
  ChangeSet,
  DragMotion,
  EntityId,
  MTextGeometry,
  OsnapHit,
  OsnapQuery,
  Vec2,
} from '@triya/engine';
import type { Surface } from './canvas2d';
import type { Endpoint, HostMessage, WorkerMessage } from './protocol';
import { RenderSession, type FontSources, type RenderDocument } from './session';
import { offscreenLayer, surfaceOf } from './surface';
import type { BitmapFactory, ThumbnailSize } from './thumbnail';
import type {
  DrawnEntity,
  RasterPixels,
  RenderPrimitive,
  RenderStyle,
  ScreenRect,
  SelectQuery,
  UnderlayRaster,
  UnderlayRequest,
  ViewTransform,
} from './types';

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
  /** Fonts for text (M1-72), loaded where the session runs. */
  readonly fonts?: FontSources;
  /** Main-thread layers; defaults to OffscreenCanvas, as in the worker. */
  readonly createLayer?: () => Surface;
  /** A failure in the render worker that no pending request was waiting for. */
  readonly onError?: (error: Error) => void;
  /** Main-thread thumbnails; `createImageBitmap` by default (the worker uses its own). */
  readonly createBitmap?: BitmapFactory;
  /**
   * A PDF underlay page the view needs drawn (M1-20), asked after a scene is drawn; the app
   * answers, when it can, with `setUnderlay`.
   */
  readonly onUnderlayRequest?: (request: UnderlayRequest) => void;
}

interface Pending {
  resolve(m: WorkerMessage): void;
  reject(e: Error): void;
}

export class RendererHost {
  readonly mode: RendererMode;
  readonly #worker: RenderWorker | undefined;
  readonly #session: RenderSession | undefined;
  readonly #pending = new Map<number, Pending>();
  readonly #onError: (error: Error) => void;
  readonly #createBitmap: BitmapFactory | undefined;
  readonly #onUnderlayRequest: ((request: UnderlayRequest) => void) | undefined;
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
    this.#createBitmap = o.createBitmap;
    this.#onUnderlayRequest = o.onUnderlayRequest;

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
          ...(o.fonts && { fonts: o.fonts }),
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
        ...(o.fonts && { fonts: o.fonts }),
        ...(o.onUnderlayRequest && { onUnderlayRequest: o.onUnderlayRequest }),
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

  /** The fonts changed (the user added or removed a font file, M1-38): text redraws. */
  setFonts(fonts: FontSources): void {
    if (this.#session) this.#session.setFonts(fonts);
    else this.#post({ type: 'fonts', fonts });
  }

  frame(): void {
    if (this.#session) this.#session.renderer.frame();
    else this.#post({ type: 'frame' });
  }

  /**
   * An IMAGEDEF's decoded bitmap (`decodeRaster`), or undefined to forget it. To the worker
   * the pixel buffer is transferred, not copied, so `pixels` is unusable here afterwards.
   */
  setImage(definition: string, pixels: RasterPixels | undefined): void {
    if (this.#session) this.#session.setImage(definition, pixels);
    else
      this.#post(
        { type: 'image', definition, pixels: pixels ?? null },
        pixels ? [pixels.data.buffer as ArrayBuffer] : [],
      );
  }

  /**
   * A PDFDEFINITION's page as the app drew it for an `UnderlayRequest`, or undefined to forget
   * it. The worker gets a copy (the app keeps its pages cached), so `raster` stays usable.
   */
  setUnderlay(definition: string, raster: UnderlayRaster | undefined): void {
    if (this.#session) this.#session.setUnderlay(definition, raster);
    else this.#post({ type: 'underlay', definition, raster: raster ?? null });
  }

  /** Entities within `aperture` CSS pixels of a screen point, nearest first. */
  hitTest(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
  ): Promise<EntityId[]> {
    if (this.#session) return Promise.resolve(this.#session.renderer.hitTest(screen, aperture));
    return this.#request((id) => ({ type: 'hitTest', id, screen, aperture })).then((m) => [
      ...(m.type === 'reply' ? (m.ids ?? []) : []),
    ]);
  }

  /** The entities a selection window takes (M2-03). */
  select(query: SelectQuery): Promise<EntityId[]> {
    if (this.#session) return Promise.resolve(this.#session.renderer.select(query));
    return this.#request((id) => ({ type: 'select', id, query })).then((m) => [
      ...(m.type === 'reply' ? (m.ids ?? []) : []),
    ]);
  }

  /** The entities to draw selected (M2-03). */
  setHighlight(ids: readonly EntityId[]): void {
    if (this.#session) this.#session.renderer.setHighlight(ids);
    else this.#post({ type: 'highlight', ids });
  }

  /** The objects a command drags with the cursor (M2-06 part 2); undefined ends the drag. */
  setDrag(motion: DragMotion | undefined): void {
    if (this.#session) this.#session.renderer.setDrag(motion);
    else this.#post({ type: 'drag', motion: motion ?? null });
  }

  /** The objects to show grips on and the hot grip (M2-06 part 2). */
  setGrips(ids: readonly EntityId[], hot?: Vec2): void {
    if (this.#session) this.#session.renderer.setGrips(ids, hot);
    else this.#post({ type: 'grips', ids, hot: hot ?? null });
  }

  /** The extents of some entities (ZOOM Object, M2-03); undefined when none is known. */
  boundsOf(ids: readonly EntityId[]): Promise<Box | undefined> {
    if (this.#session) return Promise.resolve(this.#session.boundsOf(ids));
    return this.#request((id) => ({ type: 'bounds', id, ids })).then((m) =>
      m.type === 'extents' && m.box ? m.box : undefined,
    );
  }

  /** The box an MTEXT's glyphs fill in the fonts loaded (M2-09); undefined when none draws it. */
  textBox(text: MTextGeometry): Promise<Box | undefined> {
    if (this.#session) return Promise.resolve(this.#session.textBox(text));
    return this.#request((id) => ({ type: 'textBox', id, text })).then((m) =>
      m.type === 'extents' && m.box ? m.box : undefined,
    );
  }

  /** The widths MTEXTs are laid out at (M2-10 part 3); null for one no loaded font draws. */
  textWidths(texts: readonly MTextGeometry[]): Promise<(number | null)[]> {
    if (this.#session) return Promise.resolve(this.#session.textWidths(texts));
    return this.#request((id) => ({ type: 'textWidths', id, texts })).then((m) =>
      m.type === 'widths' ? [...m.widths] : texts.map(() => null),
    );
  }

  /** The object snap points under the aperture, best first (M2-04). */
  snap(query: OsnapQuery): Promise<OsnapHit[]> {
    if (this.#session) return Promise.resolve(this.#session.snap(query));
    return this.#request((id) => ({ type: 'snap', id, query })).then((m) =>
      m.type === 'snap' ? [...m.hits] : [],
    );
  }

  /**
   * The entities drawn in a rectangle of the canvas, in handle order: what the fidelity harness
   * names where a golden image differs (M1-106).
   */
  entitiesIn(rect: ScreenRect): Promise<DrawnEntity[]> {
    if (this.#session) return Promise.resolve(this.#session.renderer.entitiesIn(rect));
    return this.#request((id) => ({ type: 'entitiesIn', id, rect })).then((m) => [
      ...(m.type === 'entities' ? m.entities : []),
    ]);
  }

  /** Resolves once everything sent so far has been handled (drawn, for a `frame`). */
  flush(): Promise<void> {
    if (this.#session) return Promise.resolve();
    return this.#request((id) => ({ type: 'flush', id })).then(() => undefined);
  }

  /**
   * The last frame drawn, fitted inside `max` (canvas pixels), taken after everything
   * sent so far; undefined while the canvas has never been sized.
   */
  thumbnail(max: ThumbnailSize): Promise<ImageBitmap | undefined> {
    if (this.#session) return this.#session.thumbnail(max, this.#createBitmap);
    return this.#request((id) => ({ type: 'thumbnail', id, ...max })).then((m) =>
      m.type === 'thumbnail' && m.bitmap ? m.bitmap : undefined,
    );
  }

  /**
   * ZOOM Extents of the space drawn, text bounded by its glyphs (M1-35 part 2), measured
   * after everything sent so far; undefined when nothing drawn has a known extent.
   */
  extents(): Promise<Box | undefined> {
    if (this.#session) return Promise.resolve(this.#session.extents());
    return this.#request((id) => ({ type: 'extents', id })).then((m) =>
      m.type === 'extents' && m.box ? m.box : undefined,
    );
  }

  dispose(): void {
    this.#worker?.terminate();
    const gone = new Error('the renderer was disposed');
    for (const p of this.#pending.values()) p.reject(gone);
    this.#pending.clear();
  }

  #post(m: HostMessage, transfer?: Transferable[]): void {
    if (transfer?.length) this.#worker?.postMessage(m, transfer);
    else this.#worker?.postMessage(m);
  }

  #request(make: (id: number) => HostMessage): Promise<WorkerMessage> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#post(make(id));
    });
  }

  #receive(m: WorkerMessage): void {
    if (m.type === 'underlayRequest') {
      this.#onUnderlayRequest?.(m.request);
      return;
    }
    const p = m.id === undefined ? undefined : this.#pending.get(m.id);
    if (m.id !== undefined) this.#pending.delete(m.id);
    if (m.type !== 'error') {
      p?.resolve(m);
      return;
    }
    const error = new Error(`render worker: ${m.message}`);
    if (p) p.reject(error);
    else this.#onError(error);
  }
}
