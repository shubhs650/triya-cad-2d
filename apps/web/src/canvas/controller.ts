// The canvas of one open document (M1-22). React owns the chrome only; this class owns the
// canvas element and its RendererHost, and handles wheel and pointer input itself, so nothing
// on the pan/zoom path touches React state (.claude/rules/ui.md).
//
// AutoCAD's real-time navigation: the wheel zooms at the cursor, dragging with the middle
// button pans, and double-clicking the middle button zooms to the extents (ZOOM E).
import RenderWorker from '@triya/render/worker?worker';
import { RendererHost, screenToWorld, type RenderStyle, type ViewTransform } from '@triya/render';
import type { OpenResult } from '@triya/io';
import { extentsView, panBy, wheelFactor, zoomAt, type ViewportSize } from './navigate';

/** The dark model canvas (UI_SPEC.md §6). */
export const MODEL_CANVAS = '#212830';

/** Two middle-button presses this close in time and place are a double click. */
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 4;

export interface CanvasHooks {
  /** The world point under the cursor, or undefined when it leaves the canvas. */
  readonly onCursor: (p: { readonly x: number; readonly y: number } | undefined) => void;
  readonly onError: (e: Error) => void;
}

export class CanvasController {
  readonly canvas: HTMLCanvasElement;
  readonly #host: RendererHost;
  readonly #opened: OpenResult;
  readonly #hooks: CanvasHooks;
  readonly #observer: ResizeObserver;
  readonly #abort = new AbortController();
  #size: ViewportSize = { width: 0, height: 0 };
  #view: ViewTransform | undefined;
  #pending = 0;
  #pan: { readonly pointer: number; x: number; y: number } | undefined;
  #lastMiddle: { readonly t: number; readonly x: number; readonly y: number } | undefined;

  constructor(container: HTMLElement, opened: OpenResult, block: string, hooks: CanvasHooks) {
    this.#opened = opened;
    this.#hooks = hooks;
    const canvas = document.createElement('canvas');
    canvas.className = 'drawing-canvas';
    canvas.setAttribute('aria-label', 'Drawing');
    container.append(canvas);
    this.canvas = canvas;
    this.#host = new RendererHost({
      canvas,
      document: { init: opened.init, block },
      createWorker: () => new RenderWorker(),
      style: modelStyle(opened),
      onError: hooks.onError,
    });
    canvas.dataset['renderer'] = this.#host.mode;

    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    this.#listen();
  }

  /** ZOOM Extents. */
  zoomExtents(): void {
    if (this.#size.width === 0) return;
    this.#setView(extentsView(this.#opened.extents, this.#size));
  }

  dispose(): void {
    this.#abort.abort();
    this.#observer.disconnect();
    cancelAnimationFrame(this.#pending);
    this.#host.dispose();
    this.canvas.remove();
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    // A hidden tab's canvas measures 0: keep its view until it shows again.
    if (width === 0 || height === 0) return;
    if (width === this.#size.width && height === this.#size.height) return;
    this.#size = { width, height };
    this.#host.resize(width, height, devicePixelRatio);
    if (this.#view) this.#setView(this.#view);
    else this.zoomExtents();
  }

  #setView(view: ViewTransform): void {
    this.#view = view;
    // One frame per animation frame however many wheel or pointer events arrive.
    if (this.#pending) return;
    this.#pending = requestAnimationFrame(() => {
      this.#pending = 0;
      if (!this.#view) return;
      this.#host.setView(this.#view);
      this.#host.frame();
    });
  }

  #cursor(e: { offsetX: number; offsetY: number }): void {
    if (!this.#view) return;
    const { width, height } = this.#size;
    this.#hooks.onCursor(screenToWorld(this.#view, width, height, { x: e.offsetX, y: e.offsetY }));
  }

  #listen(): void {
    const c = this.canvas;
    const opts = { signal: this.#abort.signal };
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.#view) return;
        const factor = wheelFactor(e.deltaY, e.deltaMode);
        this.#setView(zoomAt(this.#view, this.#size, { x: e.offsetX, y: e.offsetY }, factor));
        this.#cursor(e);
      },
      { ...opts, passive: false },
    );
    c.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 1) return;
        // No autoscroll or paste on middle click.
        e.preventDefault();
        const last = this.#lastMiddle;
        if (
          last &&
          e.timeStamp - last.t < DOUBLE_CLICK_MS &&
          Math.hypot(e.offsetX - last.x, e.offsetY - last.y) <= DOUBLE_CLICK_PX
        ) {
          this.#lastMiddle = undefined;
          this.#pan = undefined;
          this.zoomExtents();
          return;
        }
        this.#lastMiddle = { t: e.timeStamp, x: e.offsetX, y: e.offsetY };
        this.#pan = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
        c.setPointerCapture(e.pointerId);
      },
      opts,
    );
    c.addEventListener(
      'pointermove',
      (e) => {
        const pan = this.#pan;
        if (pan && pan.pointer === e.pointerId && this.#view) {
          this.#setView(panBy(this.#view, e.clientX - pan.x, e.clientY - pan.y));
          pan.x = e.clientX;
          pan.y = e.clientY;
        }
        this.#cursor(e);
      },
      opts,
    );
    const endPan = (e: PointerEvent) => {
      if (this.#pan?.pointer !== e.pointerId) return;
      this.#pan = undefined;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', endPan, opts);
    c.addEventListener('pointercancel', endPan, opts);
    c.addEventListener('pointerleave', () => this.#hooks.onCursor(undefined), opts);
    c.addEventListener('auxclick', (e) => e.preventDefault(), opts);
  }
}

/** The model canvas: ACI 7 white on the dark background, lineweights as the file's LWDISPLAY. */
function modelStyle(opened: OpenResult): RenderStyle {
  const lw = new Map(opened.init.header ?? []).get('$LWDISPLAY');
  return {
    background: MODEL_CANVAS,
    foreground: '#ffffff',
    showLineweights: lw === true || lw === 1,
  };
}
