// The plot preview's canvas (M2-18 part 2): pan and zoom on the sheet as AutoCAD's preview window
// has them (its cursor is real-time Zoom: drag up to zoom in, down to zoom out; Pan drags the
// sheet; Zoom Window zooms to two corners; Zoom Original shows the whole sheet; the wheel zooms
// about the cursor and the middle button pans whatever the cursor is), and the plot PDF drawn by
// pdf.js for exactly the device pixels of the sheet on screen, a moment after the view stops
// moving, the latest view winning. No React state on this path (UI rules): the component hands
// the canvas over and reads the mode back.
import {
  PlotPreviewSurface,
  fitPreview,
  panPreview,
  windowPreview,
  zoomPreview,
  type PreviewPoint,
  type PreviewRegion,
} from '@triya/render';
import { regionInches } from '../plot-preview';
import type { OpenPdf, PdfFile } from '../underlay/pages';

export type PreviewMode = 'zoom' | 'pan' | 'window';

/** How long the view rests before the sheet is drawn again at its new zoom. */
const SETTLE_MS = 60;
/** Real-time zoom: doubling per this many pixels dragged up. */
const ZOOM_DRAG_PX = 150;
/** One wheel notch (deltaY 100). */
const WHEEL_STEP = 1.25;

export class PreviewController {
  readonly #canvas: HTMLCanvasElement;
  readonly #surface: PlotPreviewSurface;
  readonly #paper: { readonly width: number; readonly height: number };
  readonly #observer: ResizeObserver;
  readonly #listeners: [string, EventListener][] = [];
  #file: PdfFile | undefined;
  #mode: PreviewMode = 'zoom';
  #fitted = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The region of the raster shown or on its way, as a key. */
  #drawn = '';
  #token = 0;
  #drawCount = 0;
  #drag:
    | { kind: 'pan' | 'zoom'; id: number; last: PreviewPoint; start: PreviewPoint }
    | { kind: 'window'; id: number; start: PreviewPoint; end: PreviewPoint }
    | undefined;
  #disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    o: {
      readonly pdf: Uint8Array;
      readonly paper: { readonly width: number; readonly height: number };
      readonly openPdf: OpenPdf;
      readonly onError: (message: string) => void;
    },
  ) {
    this.#canvas = canvas;
    this.#paper = o.paper;
    this.#surface = new PlotPreviewSurface(canvas, o.paper);
    canvas.dataset['state'] = 'opening';
    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(canvas);
    this.#on('pointerdown', (e) => this.#down(e as PointerEvent));
    this.#on('pointermove', (e) => this.#move(e as PointerEvent));
    this.#on('pointerup', (e) => this.#up(e as PointerEvent));
    this.#on('pointercancel', () => (this.#drag = undefined));
    this.#on('wheel', (e) => this.#wheel(e as WheelEvent));
    this.#on('auxclick', (e) => e.preventDefault());
    o.openPdf(o.pdf).then(
      (file) => {
        if (this.#disposed) return;
        this.#file = file;
        this.#schedule(0);
      },
      (e: unknown) => {
        if (!this.#disposed) o.onError(e instanceof Error ? e.message : String(e));
      },
    );
  }

  get mode(): PreviewMode {
    return this.#mode;
  }

  /** The cursor's job: Zoom (real time), Pan or Zoom Window. */
  setMode(mode: PreviewMode): void {
    this.#mode = mode;
    this.#canvas.dataset['mode'] = mode;
  }

  /** Zoom Original: the whole sheet. */
  zoomOriginal(): void {
    const { size, dpr } = this.#surface;
    this.#surface.setView(fitPreview(this.#paper, size, dpr));
    this.#changed();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#observer.disconnect();
    for (const [type, l] of this.#listeners) this.#canvas.removeEventListener(type, l);
    this.#surface.dispose();
  }

  #on(type: string, l: EventListener): void {
    this.#canvas.addEventListener(type, l, type === 'wheel' ? { passive: false } : undefined);
    this.#listeners.push([type, l]);
  }

  #resize(): void {
    const r = this.#canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.#surface.resize({ width: r.width, height: r.height }, devicePixelRatio);
    if (!this.#fitted) {
      this.#fitted = true;
      this.#surface.setView(fitPreview(this.#paper, this.#surface.size, devicePixelRatio));
    }
    this.#drawn = '';
    this.#changed();
  }

  #point(e: MouseEvent): PreviewPoint {
    const r = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #down(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    const p = this.#point(e);
    this.#canvas.setPointerCapture?.(e.pointerId);
    const kind = e.button === 1 ? 'pan' : this.#mode;
    this.#drag =
      kind === 'window'
        ? { kind, id: e.pointerId, start: p, end: p }
        : { kind, id: e.pointerId, last: p, start: p };
  }

  #move(e: PointerEvent): void {
    const d = this.#drag;
    if (!d || d.id !== e.pointerId) return;
    const p = this.#point(e);
    const v = this.#surface.view;
    if (d.kind === 'window') {
      d.end = p;
      this.#surface.draw();
      this.#surface.drawWindow(d.start, d.end);
      return;
    }
    if (d.kind === 'pan') this.#surface.setView(panPreview(v, p.x - d.last.x, p.y - d.last.y));
    else {
      // AutoCAD's real-time zoom: up zooms in, about where the drag started.
      const factor = Math.pow(2, (d.last.y - p.y) / ZOOM_DRAG_PX);
      this.#surface.setView(zoomPreview(v, factor, d.start, this.#paper));
    }
    d.last = p;
    this.#changed();
  }

  #up(e: PointerEvent): void {
    const d = this.#drag;
    if (!d || d.id !== e.pointerId) return;
    this.#drag = undefined;
    if (d.kind === 'window') {
      this.#surface.setView(windowPreview(this.#surface.view, d.start, d.end, this.#surface.size));
      this.#changed();
    }
  }

  #wheel(e: WheelEvent): void {
    e.preventDefault();
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    const factor = Math.pow(WHEEL_STEP, -notches);
    this.#surface.setView(zoomPreview(this.#surface.view, factor, this.#point(e), this.#paper));
    this.#changed();
  }

  /** The view moved: shown at once with the raster there is, drawn afresh once it rests. */
  #changed(): void {
    this.#surface.draw();
    this.#schedule(SETTLE_MS);
  }

  #schedule(ms: number): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#render(), ms);
  }

  async #render(): Promise<void> {
    const file = this.#file;
    if (!file || this.#disposed) return;
    const region = this.#surface.region();
    const key = region ? regionKey(region) : 'none';
    if (key === this.#drawn) return;
    this.#drawn = key;
    if (!region) {
      this.#surface.draw();
      return;
    }
    const token = ++this.#token;
    this.#canvas.dataset['state'] = 'drawing';
    try {
      const pixels = await file.render(
        1,
        regionInches(region, this.#paper),
        region.px.width,
        region.px.height,
      );
      if (token !== this.#token || this.#disposed) return;
      await this.#surface.setRaster(pixels, region);
      if (token !== this.#token || this.#disposed) return;
      this.#surface.draw();
      const d = this.#drag;
      if (d?.kind === 'window') this.#surface.drawWindow(d.start, d.end);
      const { px } = region;
      this.#canvas.dataset['raster'] = `${px.x} ${px.y} ${px.width} ${px.height}`;
      this.#canvas.dataset['drawn'] = String(++this.#drawCount);
      this.#canvas.dataset['state'] = 'ready';
    } catch {
      if (token === this.#token) {
        this.#drawn = '';
        this.#canvas.dataset['state'] = 'failed';
      }
    }
  }
}

const regionKey = (r: PreviewRegion) =>
  `${r.px.x} ${r.px.y} ${r.px.width} ${r.px.height} ${r.x.toPrecision(12)} ${r.y.toPrecision(12)} ${r.width.toPrecision(12)}`;
