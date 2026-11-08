// The canvas of one space (model or a layout) of one open document (M1-22). React owns the
// chrome only; this class owns the canvas element and its RendererHost, and handles wheel and
// pointer input itself, so nothing on the pan/zoom path touches React state
// (.claude/rules/ui.md).
//
// AutoCAD's real-time navigation: the wheel zooms at the cursor, dragging with the middle
// button pans, and double-clicking the middle button zooms to the extents (ZOOM E). The
// navigation bar adds ZOOM Window, Previous, All and Scale, real-time PAN with the left button,
// and REGEN (part 2).
import RenderWorker from '@triya/render/worker?worker';
import {
  layoutSheet,
  unionBox,
  type Box,
  type ChangeSet,
  type Handle,
  type HeaderValue,
  type Layout,
  type VportRecord,
} from '@triya/engine';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  RendererHost,
  screenToWorld,
  type FontSources,
  type RenderStyle,
  type ViewTransform,
} from '@triya/render';
import type { OpenResult } from '@triya/io';
import { layoutsOf } from '../documents';
import { BUNDLED_FONTS } from '../fonts';
import { extentsView, panBy, wheelFactor, zoomAt, type ViewportSize } from './navigate';
import {
  ViewHistory,
  activeVport,
  allView,
  paperSpaceView,
  paperSpaceViewport,
  savedModelView,
  scaleView,
  windowView,
} from './views';

/** The dark model canvas, and the paper and its surround in a layout (UI_SPEC.md §6). */
export const MODEL_CANVAS = '#212830';
export const PAPER = '#ffffff';
export const PAPER_SURROUND = '#8a8f98';

/** Two middle-button presses this close in time and place are a double click. */
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 4;
/**
 * Wheel events closer together than this are one zoom gesture, recorded once for ZOOM
 * Previous. AutoCAD records wheel zooms but documents no grouping; ours, so one roll of the
 * wheel steps back in one go.
 */
const WHEEL_GESTURE_MS = 400;
/** A press that moves less than this is a click, not a drag. */
const CLICK_PX = 4;

/** What the left button does: select (nothing yet), real-time PAN, or pick ZOOM Window corners. */
export type CanvasMode = 'none' | 'pan' | 'window';

export interface CanvasHooks {
  /** The world point under the cursor, or undefined when it leaves the canvas. */
  readonly onCursor: (p: { readonly x: number; readonly y: number } | undefined) => void;
  readonly onError: (e: Error) => void;
  /** The left-button mode changed (a window was picked, or Esc ended it). */
  readonly onMode?: (mode: CanvasMode) => void;
  /** The user's .pat files when a renderer is made (M1-50); later changes come by `setPatterns`. */
  readonly patterns?: () => readonly string[];
  /**
   * The fonts when a renderer is made: the bundled ones and the user's files (M1-72, M1-38);
   * later changes come by `setFonts`. Defaults to the bundled fonts.
   */
  readonly fonts?: () => FontSources;
  /**
   * The changes the drawing's engine applied since it opened (M1-67): a renderer is built from
   * the drawing as opened, so a new one (first show, REGEN) applies these to catch up.
   */
  readonly changes?: () => readonly ChangeSet[];
  /**
   * One of model space's tiled viewports (M1-22 part 4): the `*Active` VPORT it opens in, its
   * name for assistive technology, whether it is the current viewport, and how a press or a
   * wheel roll in it makes it current. Without it the canvas is the space's only viewport.
   */
  readonly tile?: {
    readonly vport: VportRecord | undefined;
    readonly label: string;
    readonly isCurrent: () => boolean;
    readonly activate: () => void;
  };
}

type Point = { readonly x: number; readonly y: number };

export class CanvasController {
  readonly block: Handle;
  readonly #opened: OpenResult;
  /** The layout shown as it is now (renamed or given a new page setup since, M1-97). */
  #layout: Layout | undefined;
  /** The header as it is now: model space's LIMMIN and LIMMAX are read from it. */
  readonly #header: Map<string, HeaderValue>;
  readonly #hooks: CanvasHooks;
  readonly #observer: ResizeObserver;
  readonly #history = new ViewHistory();
  #canvas: HTMLCanvasElement;
  #host: RendererHost;
  #listeners = new AbortController();
  #size: ViewportSize = { width: 0, height: 0 };
  #view: ViewTransform | undefined;
  #pending = 0;
  /** A frame was sent to the renderer and is not drawn yet. */
  #drawing = false;
  /** A view change arrived while a frame was in flight. */
  #again = false;
  #mode: CanvasMode = 'none';
  #drag: { readonly pointer: number; x: number; y: number } | undefined;
  #lastMiddle: { readonly t: number; readonly x: number; readonly y: number } | undefined;
  #lastWheel = -Infinity;
  #corner: { readonly world: Point; readonly screen: Point; dragged: boolean } | undefined;
  /** Where the pointer is over the canvas (offset), or undefined when it is not. */
  #pointer: { readonly offsetX: number; readonly offsetY: number } | undefined;
  /**
   * The space's extents as its renderer last measured them (M1-35 part 2): text by its glyphs
   * once the fonts load, and edits followed, which the extents the drawing opened with (from
   * the I/O worker, which has no fonts) are not. `measured` is false until the first answer.
   */
  #measured: { readonly done: boolean; readonly box: Box | undefined } = {
    done: false,
    box: undefined,
  };
  #measuring = 0;
  /** Settles once the renderer first answered (or failed to): the opening view waits on it. */
  #firstMeasure: Promise<void> = Promise.resolve();

  constructor(container: HTMLElement, opened: OpenResult, block: Handle, hooks: CanvasHooks) {
    this.#opened = opened;
    this.block = block;
    // A canvas made after edits (a layout first shown) starts from the drawing as it is now.
    const changes = hooks.changes?.() ?? [];
    this.#layout =
      block === opened.modelSpace
        ? undefined
        : layoutsOf(opened.init, changes).find((l) => l.blockRecord === block);
    this.#header = new Map(opened.init.header ?? []);
    for (const cs of changes) this.#followHeader(cs);
    this.#hooks = hooks;
    const canvas = document.createElement('canvas');
    canvas.className = 'drawing-canvas';
    canvas.setAttribute(
      'aria-label',
      this.#layout ? `Layout ${this.#layout.name}` : (hooks.tile?.label ?? 'Model'),
    );
    container.append(canvas);
    this.#canvas = canvas;
    this.#host = this.#createHost();
    this.#firstMeasure = this.#measure();

    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    this.#listen();
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get isLayout(): boolean {
    return this.#layout !== undefined;
  }

  get mode(): CanvasMode {
    return this.#mode;
  }

  /**
   * The canvas as last drawn, fitted inside `max` CSS pixels (the document tab hover preview);
   * undefined before the canvas is first sized.
   */
  thumbnail(max: { width: number; height: number }): Promise<ImageBitmap | undefined> {
    const dpr = devicePixelRatio;
    return this.#host.thumbnail({ width: max.width * dpr, height: max.height * dpr });
  }

  /** ZOOM Extents. A layout without entities shows its sheet. */
  zoomExtents(): void {
    this.#go(extentsView(this.#extents() ?? this.#paper(), this.#size));
  }

  /** ZOOM All: the limits or the extents, whichever reaches further. */
  zoomAll(): void {
    this.#go(allView(this.#limits(), this.#extents(), this.#size));
  }

  /** ZOOM Scale nX, about the view's centre. */
  zoomScale(factor: number): void {
    if (this.#view) this.#go(scaleView(this.#view, factor));
  }

  /** ZOOM Previous: back to the view before the last zoom or pan. */
  zoomPrevious(): void {
    const v = this.#history.previous();
    if (v) this.#setView(v);
  }

  /** Shows `view`, recording the current one for ZOOM Previous (VIEW restore). */
  show(view: ViewTransform): void {
    this.#go(view);
  }

  get view(): ViewTransform | undefined {
    return this.#view;
  }

  get size(): ViewportSize {
    return this.#size;
  }

  /** Real-time PAN with the left button, or ZOOM Window's corner picks; `none` ends either. */
  setMode(mode: CanvasMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#corner = undefined;
    this.#host.setTransient([]);
    this.#requestFrame();
    this.canvas.dataset['mode'] = mode;
    this.#hooks.onMode?.(mode);
  }

  /**
   * REGEN: rebuilds the display from the document, keeping the view. The renderer caches its
   * tessellation, so regenerating is a new renderer built from the same document.
   */
  regen(): void {
    const view = this.#view;
    this.#host.dispose();
    const canvas = document.createElement('canvas');
    canvas.className = this.canvas.className;
    for (const [k, v] of Object.entries(this.canvas.dataset)) canvas.dataset[k] = v;
    canvas.setAttribute('aria-label', this.canvas.getAttribute('aria-label') ?? '');
    // A canvas handed to the render worker cannot be handed over again, so swap in a new one.
    this.#listeners.abort();
    this.#canvas.replaceWith(canvas);
    this.#canvas = canvas;
    this.#listeners = new AbortController();
    this.#host = this.#createHost();
    this.#measure();
    this.#drawing = this.#again = false;
    this.#listen();
    this.#size = { width: 0, height: 0 };
    this.#view = view;
    this.#resize();
  }

  /** A change the drawing's engine applied (M1-67): the renderer applies it and redraws. */
  apply(change: ChangeSet): void {
    this.#host.apply(change);
    this.#measure();
    // The layout renamed or given a new page setup or limits (M1-97): its sheet frames ZOOM
    // Extents and All from now on, and the canvas takes its new name.
    const layout = this.#layout;
    const after =
      layout && change.layouts?.updated?.find((u) => u.after.handle === layout.handle)?.after;
    if (after) {
      this.#layout = after;
      this.#canvas.setAttribute('aria-label', `Layout ${after.name}`);
    }
    this.#followHeader(change);
    // Drawn now rather than on the next animation frame, so `flush` resolves once the change
    // is on screen (the palette measures toggle → canvas, M1-23).
    if (this.#view && this.#size.width > 0) {
      this.#host.setView(this.#view);
      this.#host.frame();
    }
  }

  /** Resolves once the renderer has handled everything sent to it so far. */
  flush(): Promise<void> {
    return this.#host.flush();
  }

  /** The user's .pat files changed (M1-50): hatches stored without lines redraw from them. */
  setPatterns(sources: readonly string[]): void {
    this.#host.setPatterns(sources);
    this.#requestFrame();
  }

  /** The user's font files changed (M1-38): text redraws with them. */
  setFonts(fonts: FontSources): void {
    this.#host.setFonts(fonts);
    this.#measure();
    this.#requestFrame();
  }

  dispose(): void {
    this.#listeners.abort();
    this.#observer.disconnect();
    cancelAnimationFrame(this.#pending);
    this.#host.dispose();
    this.canvas.remove();
  }

  #createHost(): RendererHost {
    const patterns = this.#hooks.patterns?.() ?? [];
    const host = new RendererHost({
      canvas: this.canvas,
      document: { init: this.#opened.init, block: this.block },
      createWorker: () => new RenderWorker(),
      style: this.#style(),
      onError: this.#hooks.onError,
      fonts: this.#hooks.fonts?.() ?? BUNDLED_FONTS,
      ...(patterns.length > 0 && { patterns }),
    });
    for (const change of this.#hooks.changes?.() ?? []) host.apply(change);
    this.canvas.dataset['renderer'] = host.mode;
    return host;
  }

  #followHeader(change: ChangeSet): void {
    for (const h of change.header ?? []) {
      if (h.after === undefined) this.#header.delete(h.name);
      else this.#header.set(h.name, h.after);
    }
  }

  /**
   * The renderer's measure, else the extents the drawing opened with: those also hold the
   * header's $EXTMIN/$EXTMAX for a model space with nothing of known extent (text no loaded
   * font serves).
   */
  #extents(): Box | undefined {
    return (
      (this.#measured.done ? this.#measured.box : undefined) ?? this.#opened.extents[this.block]
    );
  }

  /**
   * Asks the renderer for the space's extents, after everything sent to it so far; only the
   * latest request's answer is kept. A failure (the renderer disposed) keeps the last measure.
   */
  #measure(): Promise<void> {
    const n = ++this.#measuring;
    return this.#host.extents().then(
      (box) => {
        if (n === this.#measuring) this.#measured = { done: true, box };
      },
      () => undefined,
    );
  }

  /**
   * The view a space was saved in, as AutoCAD reopens a drawing: model space in the `*Active`
   * VPORT's view, a layout in its paper-space viewport's view (M1-22 part 3). Without one (no
   * VPORT table, a 3D view, a layout never shown) model space opens at its extents and a
   * layout with its whole sheet in view (`#opening`).
   */
  #savedView(): ViewTransform | undefined {
    return this.#layout
      ? paperSpaceView(paperSpaceViewport(this.#opened.init.entities, this.block), this.#size)
      : savedModelView(
          this.#hooks.tile ? this.#hooks.tile.vport : activeVport(this.#opened.init.tables?.vports),
          this.#size,
        );
  }

  /** The extents, and a layout's sheet with anything drawn off it. */
  #opening(): Box | undefined {
    const e = this.#extents();
    const p = this.#paper();
    return e && p ? unionBox(e, p) : (e ?? p);
  }

  #paper(): Box | undefined {
    return this.#layout ? layoutSheet(this.#layout)?.paper : undefined;
  }

  /** LIMMIN/LIMMAX: the header's for model space, the layout's own for a layout. */
  #limits(): Box | undefined {
    if (this.#layout) {
      const l = this.#layout.limits;
      return l ? { minX: l.min.x, minY: l.min.y, maxX: l.max.x, maxY: l.max.y } : this.#paper();
    }
    const min = this.#header.get('$LIMMIN');
    const max = this.#header.get('$LIMMAX');
    if (typeof min !== 'object' || typeof max !== 'object') return undefined;
    return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
  }

  /** Model space on the dark canvas; a layout's white paper on a grey surround. */
  #style(): RenderStyle {
    const lw = new Map(this.#opened.init.header ?? []).get('$LWDISPLAY');
    const showLineweights = lw === true || lw === 1;
    return this.#layout
      ? {
          background: PAPER,
          foreground: '#000000',
          layoutBackground: PAPER_SURROUND,
          showLineweights,
        }
      : { background: MODEL_CANVAS, foreground: '#ffffff', showLineweights };
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    // A hidden tab's canvas measures 0: keep its view until it shows again.
    if (width === 0 || height === 0) return;
    if (width === this.#size.width && height === this.#size.height) return;
    this.#size = { width, height };
    this.#host.resize(width, height, devicePixelRatio);
    if (this.#view) {
      this.#setView(this.#view);
      return;
    }
    const saved = this.#savedView();
    if (saved) {
      this.#setView(saved);
      return;
    }
    // Without a saved view the space opens at its extents, text included, so the first view
    // waits for the renderer's measure; it answers once it has built the drawing, which the
    // first frame waits for anyway.
    void this.#firstMeasure.then(() => {
      if (!this.#view && this.#size.width > 0) {
        this.#setView(extentsView(this.#opening(), this.#size));
        // A cursor that came onto the canvas before there was a view showed no coordinates;
        // show them now rather than after it next moves.
        if (this.#pointer) this.#hooks.onCursor(this.#world(this.#pointer));
      }
    });
  }

  /** A discrete view change (a ZOOM option, VIEW restore): recorded for ZOOM Previous. */
  #go(view: ViewTransform): void {
    if (this.#size.width === 0) return;
    if (this.#view) this.#history.push(this.#view);
    this.#setView(view);
  }

  #setView(view: ViewTransform): void {
    this.#view = view;
    this.#requestFrame();
  }

  #requestFrame(): void {
    // One frame per animation frame however many wheel or pointer events arrive.
    if (this.#pending) return;
    this.#pending = requestAnimationFrame(() => {
      this.#pending = 0;
      if (!this.#view) return;
      // One frame in flight: while the render worker is still drawing (building the drawing
      // after open, or a full redraw once a pan settles), later views are not queued behind
      // it to be drawn one by one; the latest is drawn once it is free (M1-60).
      if (this.#drawing) {
        this.#again = true;
        return;
      }
      this.#host.setView(this.#view);
      this.#host.frame();
      this.#drawing = true;
      const canvas = this.#canvas;
      this.#host.flush().then(
        () => {
          this.#drawing = false;
          // Nothing in the app listens; the T3 spec counts the frames that were drawn.
          canvas.dispatchEvent(new Event('framedrawn'));
          if (this.#again) {
            this.#again = false;
            this.#requestFrame();
          }
        },
        // The renderer was disposed (REGEN, closing the drawing).
        () => undefined,
      );
    });
  }

  #world(e: { offsetX: number; offsetY: number }): Point | undefined {
    if (!this.#view) return undefined;
    const { width, height } = this.#size;
    return screenToWorld(this.#view, width, height, { x: e.offsetX, y: e.offsetY });
  }

  /** The ZOOM Window rubber band from the first corner to the cursor. */
  #band(a: Point, b: Point): void {
    this.#host.setTransient([
      {
        kind: 'stroke',
        color: 'foreground',
        path: [PATH_M, a.x, a.y, PATH_L, b.x, a.y, PATH_L, b.x, b.y, PATH_L, a.x, b.y, PATH_Z],
      },
    ]);
    this.#requestFrame();
  }

  #finishWindow(b: Point): void {
    const a = this.#corner?.world;
    if (!a) return;
    const v = windowView(a, b, this.#size);
    this.setMode('none');
    if (v) this.#go(v);
  }

  #listen(): void {
    const c = this.canvas;
    const opts = { signal: this.#listeners.signal };
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.#view) return;
        // The wheel zooms the viewport under the cursor, which becomes current (as a press
        // would), so the navigation bar then acts on the viewport just zoomed.
        this.#activate();
        if (e.timeStamp - this.#lastWheel > WHEEL_GESTURE_MS) this.#history.push(this.#view);
        this.#lastWheel = e.timeStamp;
        const factor = wheelFactor(e.deltaY, e.deltaMode);
        this.#setView(zoomAt(this.#view, this.#size, { x: e.offsetX, y: e.offsetY }, factor));
        this.#hooks.onCursor(this.#world(e));
      },
      { ...opts, passive: false },
    );
    c.addEventListener(
      'pointerdown',
      (e) => {
        // A press in a viewport that is not current makes it current; AutoCAD takes the
        // left-button click that does so for nothing else.
        if (this.#activate() && e.button === 0) return;
        if (e.button === 1) {
          // No autoscroll or paste on middle click.
          e.preventDefault();
          const last = this.#lastMiddle;
          if (
            last &&
            e.timeStamp - last.t < DOUBLE_CLICK_MS &&
            Math.hypot(e.offsetX - last.x, e.offsetY - last.y) <= DOUBLE_CLICK_PX
          ) {
            this.#lastMiddle = undefined;
            this.#drag = undefined;
            this.zoomExtents();
            return;
          }
          this.#lastMiddle = { t: e.timeStamp, x: e.offsetX, y: e.offsetY };
          this.#startDrag(e);
          return;
        }
        if (e.button !== 0) return;
        if (this.#mode === 'pan') this.#startDrag(e);
        else if (this.#mode === 'window') {
          const world = this.#world(e);
          if (!world) return;
          if (this.#corner) this.#finishWindow(world);
          else {
            this.#corner = { world, screen: { x: e.offsetX, y: e.offsetY }, dragged: false };
            c.setPointerCapture(e.pointerId);
          }
        }
      },
      opts,
    );
    c.addEventListener(
      'pointermove',
      (e) => {
        const drag = this.#drag;
        if (drag && drag.pointer === e.pointerId && this.#view) {
          this.#setView(panBy(this.#view, e.clientX - drag.x, e.clientY - drag.y));
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        this.#pointer = { offsetX: e.offsetX, offsetY: e.offsetY };
        const world = this.#world(e);
        const corner = this.#corner;
        if (corner && world) {
          const moved = Math.hypot(e.offsetX - corner.screen.x, e.offsetY - corner.screen.y);
          if (moved > CLICK_PX && e.buttons & 1) corner.dragged = true;
          this.#band(corner.world, world);
        }
        this.#hooks.onCursor(world);
      },
      opts,
    );
    const endDrag = (e: PointerEvent) => {
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      if (this.#drag?.pointer === e.pointerId) this.#drag = undefined;
      // A window dragged out ends on release; one clicked waits for the second click.
      const world = this.#world(e);
      if (e.button === 0 && this.#corner?.dragged && world) this.#finishWindow(world);
    };
    c.addEventListener('pointerup', endDrag, opts);
    c.addEventListener('pointercancel', endDrag, opts);
    c.addEventListener(
      'pointerleave',
      () => {
        this.#pointer = undefined;
        this.#hooks.onCursor(undefined);
      },
      opts,
    );
    c.addEventListener('auxclick', (e) => e.preventDefault(), opts);
  }

  /** Makes this tiled viewport current; true when it was not. */
  #activate(): boolean {
    const tile = this.#hooks.tile;
    if (!tile || tile.isCurrent()) return false;
    tile.activate();
    return true;
  }

  #startDrag(e: PointerEvent): void {
    if (this.#view) this.#history.push(this.#view);
    this.#drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
  }
}
