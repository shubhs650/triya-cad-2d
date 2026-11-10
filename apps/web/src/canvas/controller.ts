// The canvas of one space (model or a layout) of one open document (M1-22). React owns the
// chrome only; this class owns the canvas element and its RendererHost, and handles wheel and
// pointer input itself, so nothing on the pan/zoom path touches React state
// (.claude/rules/ui.md).
//
// AutoCAD's real-time navigation: the wheel zooms at the cursor, dragging with the middle
// button pans, and double-clicking the middle button zooms to the extents (ZOOM E). The
// navigation bar adds ZOOM Window, Previous, All and Scale, real-time PAN with the left button,
// and REGEN (part 2).
//
// While a command waits for a point (M2-02), a left click gives it the point under the cursor,
// and a rubber band follows the cursor from the prompt's base point, as AutoCAD draws it: a
// line, or a rectangle for a window's corners. A command's preview geometry (`ctx.preview`)
// shows on the same transient layer. The view commands (ZOOM, PAN, REGEN, VIEW; part 2) call
// the same methods as the navigation bar through the view host (view-host.ts), and add
// real-time ZOOM: dragging up with the left button zooms in, down zooms out.
//
// Selection (M2-03): every left click goes to the drawing's command engine (`onPick`), which
// decides what it is: a point, a pick, or a selection window's corner; releasing a drag ends a
// window. The engine asks back what a pick or a window takes (`pick`, `selectWindow`), and the
// canvas draws the selected objects highlighted and a selection window as AutoCAD does: blue
// with a solid edge left to right (window), green with a dashed edge right to left (crossing).
//
// Precision input (M2-04): while a command waits for a point, the cursor is the point after
// the drafting aids. SNAP rounds it to the snap spacing; from a base point ORTHO keeps it
// horizontal or vertical and POLAR locks it onto the polar angles it passes near (a dashed
// path and a "Polar:" tooltip); a running object snap under the aperture beats all of these
// (AutoSnap's marker and the mode's name). The render worker finds the snaps (`snap`), one
// request in flight at a time; a click waits for the snaps at its own point before it is
// sent, so what is marked is what is picked. Typed points are never changed.
//
// Dragging (M2-06 part 2): a prompt that drags objects (MOVE's second point, ROTATE's angle,
// STRETCH's second point…) has the renderer draw them moved to the cursor on the transient
// layer, by the same motion the answer will make (`dragMotion`).
//
// Part 2: a pause over an object snap point acquires it for object snap tracking (OTRACK: a
// small cross, paths horizontal and vertical from it), over a line's end for EXTension, over a
// line for PARallel; pausing over it again lets it go, and a command's end clears them all.
// The cursor follows the paths (`constrainCursor`), with a tooltip as AutoCAD's. Tab steps
// through the snap points under the aperture; a typed override (`END`) snaps the next point
// with its own modes, and a click it finds nothing at is sent as missed; Shift+right-click
// opens the object snap menu (`onSnapMenu`). GRID, LWT and TPY are the renderer's style.
import RenderWorker from '@triya/render/worker?worker';
import {
  MAX_ACQUIRED,
  constrainCursor,
  dragMotion,
  layoutSheet,
  polarLabel,
  trackLabel,
  type Acquired,
  unionBox,
  type Box,
  type ChangeSet,
  type EntityId,
  type Handle,
  type HeaderValue,
  type Layout,
  type EntityGeometry,
  type MTextGeometry,
  type OsnapHit,
  type Prompt,
  type UnderlaySnapPage,
  type Vec2,
  type VportRecord,
} from '@triya/engine';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  RendererHost,
  fitView,
  screenToWorld,
  tessellate,
  transformPrimitive,
  worldToScreen,
  type DrawnEntity,
  type FontSources,
  type PlotPart,
  type PlotRequest,
  type RasterPixels,
  type RenderPrimitive,
  type RenderStyle,
  type ScreenRect,
  type UnderlayRaster,
  type ViewTransform,
} from '@triya/render';
import type { OpenResult } from '@triya/io';
import { layoutsOf } from '../documents';
import { pageSetupOf, type PlotSpace } from '../plot';
import type { ImageClient } from '../images';
import type { UnderlayClient } from '../underlay/pages';
import { BUNDLED_FONTS } from '../fonts';
import { INITIAL_DRAFTING, type DraftingState } from '../drafting';
import { DEFAULT_CANVAS, type CanvasColours } from '../preferences';
import { crosshairCursor, foregroundOn, interfaceColours, type InterfaceColours } from './colours';
import {
  ACQUIRE_MS,
  MARKER_PX,
  TRACK_PX,
  acquiredPrimitives,
  markerPrimitives,
  snapLabel,
  trackingPrimitives,
} from './autosnap';
import {
  extentsView,
  panBy,
  realtimeZoomFactor,
  wheelFactor,
  zoomAt,
  type ViewportSize,
} from './navigate';
import {
  ViewHistory,
  activeVport,
  allView,
  paperSpaceView,
  paperSpaceViewport,
  limitsView,
  savedModelView,
  scaleView,
  windowView,
} from './views';

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
/** PICKBOX (M2-03): the pickbox's half size in CSS pixels, AutoCAD's default 3. */
const PICKBOX = 3;
/** A selection window's colours, its fill's opacity and a crossing edge's dash (M2-03). */
const WINDOW_COLOR = '#4da3ff';
const CROSSING_COLOR = '#5fd35f';
const SELECTION_FILL_OPACITY = 0.18;
const DASH_PX = 6;
/** A click this near a grip (CSS pixels) is on it: the grip's half size and a pixel (M2-06). */
const GRIP_PICK_PX = 5;

/**
 * What the left button does: select (nothing yet), real-time PAN or ZOOM, or pick ZOOM Window
 * corners.
 */
export type CanvasMode = 'none' | 'pan' | 'zoom' | 'window';

export interface CanvasHooks {
  /** The world point under the cursor, or undefined when it leaves the canvas. */
  readonly onCursor: (p: { readonly x: number; readonly y: number } | undefined) => void;
  readonly onError: (e: Error) => void;
  /**
   * A left click (M2-02, M2-03): the world point under it, in this canvas's space, for the
   * command engine to take as a point, a pick or a window's corner. `release` is the end of a
   * drag that began with a click.
   */
  readonly onPick?: (
    p: Vec2 | Promise<PickedPoint>,
    o: {
      readonly shift: boolean;
      readonly release: boolean;
      /** At `Command:`: how near a grip, in drawing units, counts as on it (M2-06). */
      readonly grip?: number;
    },
  ) => void;
  /**
   * A left double click (M2-07 part 2): the world point under it, for the command engine to
   * edit the object there (TEXTEDIT on a text, AutoCAD's DBLCLKEDIT).
   */
  readonly onDoubleClick?: (p: Vec2) => void;
  /** Shift+right-click at a point prompt (M2-04 part 2): the object snap menu, at client px. */
  readonly onSnapMenu?: (at: { readonly x: number; readonly y: number }) => void;
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
   * PDF underlay pages (M1-20): the canvas's link to the PDF files supplied, which draws the
   * pages its renderer asks for and hands them back through `deliver`.
   */
  readonly underlays?: (
    deliver: (definition: string, raster: UnderlayRaster | undefined) => void,
    /** A definition's page geometry for running object snaps (M2-22). */
    deliverSnap?: (definition: string, page: UnderlaySnapPage | undefined) => void,
  ) => UnderlayClient;
  /**
   * Raster images (M1-19 part 3): the canvas's link to the image files supplied, which hands
   * over the bitmap of each IMAGEDEF whose file it has, now and as files arrive.
   */
  readonly images?: (
    deliver: (definition: string, pixels: RasterPixels | undefined) => void,
  ) => ImageClient;
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

/** A click's point at a point prompt; `missed` when its object snap override found nothing. */
export interface PickedPoint {
  readonly point: Vec2;
  readonly missed?: boolean;
}

const sameHit = (a: OsnapHit | undefined, b: OsnapHit | undefined): boolean =>
  a === b ||
  (!!a && !!b && a.mode === b.mode && a.point.x === b.point.x && a.point.y === b.point.y);

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
  readonly #underlays: UnderlayClient | undefined;
  readonly #images: ImageClient | undefined;
  #listeners = new AbortController();
  #size: ViewportSize = { width: 0, height: 0 };
  #view: ViewTransform | undefined;
  #pending = 0;
  /** A frame was sent to the renderer and is not drawn yet. */
  #drawing = false;
  /** A view change arrived while a frame was in flight. */
  #again = false;
  #mode: CanvasMode = 'none';
  /** The prompt the drawing's command waits at, when it takes points; undefined otherwise. */
  #prompt: Prompt | undefined;
  /** The freehand prompt shown has been answered by the cursor (one answer per prompt). */
  #traced = false;
  /** The running command's preview geometry, drawn with the rubber band. */
  #preview: readonly RenderPrimitive[] = [];
  /** The renderer is drawing objects dragged with the cursor (M2-06 part 2). */
  #dragging = false;
  #drag: { readonly pointer: number; readonly zoom: boolean; x: number; y: number } | undefined;
  #lastMiddle: { readonly t: number; readonly x: number; readonly y: number } | undefined;
  #lastWheel = -Infinity;
  #corner: { readonly world: Point; readonly screen: Point; dragged: boolean } | undefined;
  /** A left press sent to the command engine, and whether it has since been dragged. */
  #press:
    | { readonly pointer: number; readonly x: number; readonly y: number; dragged: boolean }
    | undefined;
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
  /** The PDF page size last sent per PDFDEFINITION, so only a new size re-measures (M1-20). */
  readonly #pages = new Map<Handle, string>();
  /** Settles once the renderer first answered (or failed to): the opening view waits on it. */
  #firstMeasure: Promise<void> = Promise.resolve();
  /** OSNAP, ORTHO, POLAR and SNAP as the status bar has them (M2-04). */
  #drafting: DraftingState = INITIAL_DRAFTING;
  /** The canvas colours from Settings (M2-20). */
  #colours: CanvasColours = DEFAULT_CANVAS;
  /** The object snap at the cursor as the renderer last answered, if any (M2-04). */
  #hit: OsnapHit | undefined;
  /** Every snap point under the aperture, best first, and which one Tab stepped to. */
  #hits: readonly OsnapHit[] = [];
  #cycle = 0;
  /** What the cursor pauses over to acquire, and the timer that acquires it (part 2). */
  #candidate: { readonly key: string; readonly items: readonly Acquired[] } | undefined;
  #acquireTimer = 0;
  /** The points and lines acquired for tracking, oldest first. */
  #acquired: Acquired[] = [];
  /** A snap request is in flight, and whether the cursor moved since it was sent. */
  #snapping = false;
  #snapAgain = false;
  /** AutoSnap markers and the polar tracking path, drawn over the rubber band. */
  #overlay: readonly RenderPrimitive[] = [];
  /** The AutoSnap and polar tracking tooltip. */
  readonly #tip: HTMLDivElement;

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
    this.#underlays = hooks.underlays?.(
      (definition, raster) => {
        this.#host.setUnderlay(definition, raster);
        // An unclipped underlay's page joins the extents once its PDF gives its size (M1-20).
        const page = raster ? `${raster.page.width}x${raster.page.height}` : undefined;
        if (this.#pages.get(definition) !== page) {
          if (page) this.#pages.set(definition, page);
          else this.#pages.delete(definition);
          void this.#measure();
        }
        this.#requestFrame();
      },
      (definition, page) => this.#host.setUnderlaySnap(definition, page),
    );
    const canvas = document.createElement('canvas');
    canvas.className = 'drawing-canvas';
    canvas.setAttribute(
      'aria-label',
      this.#layout ? `Layout ${this.#layout.name}` : (hooks.tile?.label ?? 'Model'),
    );
    container.append(canvas);
    this.#canvas = canvas;
    this.#paintCursor();
    this.#tip = document.createElement('div');
    this.#tip.className = 'autosnap-tip';
    this.#tip.dataset['testid'] = 'autosnap-tip';
    this.#tip.hidden = true;
    container.append(this.#tip);
    this.#host = this.#createHost();
    this.#images = hooks.images?.((definition, pixels) => {
      this.#host.setImage(definition, pixels);
      this.#requestFrame();
    });
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
  /** The entities drawn in a rectangle of the canvas, CSS pixels (M1-106 fidelity triage). */
  entitiesIn(rect: ScreenRect): Promise<DrawnEntity[]> {
    return this.#host.entitiesIn(rect);
  }

  /**
   * What the Plot dialog plots from this canvas (M2-17): the space's name, a layout's sheet, and
   * the extents (measured afresh), the view shown and the limits; the space's page setup (part
   * 3), model space's from the Model layout.
   */
  async plotSpace(): Promise<PlotSpace> {
    await this.#measure();
    const layout = this.#layout;
    const sheet = layout ? layoutSheet(layout) : undefined;
    const v = this.#view;
    const { width, height } = this.#size;
    const display =
      v && width > 0 && height > 0
        ? {
            minX: v.center.x - width / 2 / v.scale,
            minY: v.center.y - height / 2 / v.scale,
            maxX: v.center.x + width / 2 / v.scale,
            maxY: v.center.y + height / 2 / v.scale,
          }
        : undefined;
    // Model space's page setup is the Model layout's (in its paper units too, part 4).
    const setup =
      layout ??
      layoutsOf(this.#opened.init, this.#hooks.changes?.() ?? []).find(
        (l) => l.blockRecord === this.block,
      );
    return {
      name: layout?.name ?? 'Model',
      sheet: sheet && { paper: sheet.paper, unitsPerMm: sheet.unitsPerMm },
      inches: setup?.plot?.paperUnits === 'inches',
      extents: this.#extents(),
      display,
      limits: this.#limits(),
      namedPlotStyles: this.#header.get('$PSTYLEMODE') === 0,
      pageSetup: pageSetupOf(setup),
    };
  }

  /**
   * What plotting this canvas's space draws (M2-17), from its renderer; with `block`, another
   * space of the drawing (PUBLISH's sheets not shown, M2-17 part 2): the renderer's replica holds
   * the whole drawing.
   */
  plot(request: PlotRequest): Promise<PlotPart[]> {
    return this.#host.plot({ block: this.block, ...request });
  }

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

  /** ZOOM Previous: back to the view before the last zoom or pan; false with none left. */
  zoomPrevious(): boolean {
    const v = this.#history.previous();
    if (v) this.#setView(v);
    return v !== undefined;
  }

  /** ZOOM Window from the command: the box between two world points fills the window. */
  zoomWindow(a: Vec2, b: Vec2): void {
    const v = windowView(a, b, this.#size);
    if (v) this.#go(v);
  }

  /** ZOOM Center: `center` in the middle with `height` world units from top to bottom. */
  zoomCenter(center: Vec2, height: number): void {
    if (height > 0 && this.#size.height > 0)
      this.#go({ center, scale: this.#size.height / height });
  }

  /**
   * ZOOM n: `factor` relative to the limits (1 fits them, 2 shows half as much) about the view's
   * centre; the extents stand in for limits a space does not have.
   */
  zoomLimits(factor: number): void {
    const v = limitsView(this.#limits() ?? this.#extents(), this.#size, factor, this.#view);
    if (v) this.#go(v);
  }

  /** -PAN: moves the drawing by `by` world units. */
  panWorld(by: Vec2): void {
    const v = this.#view;
    if (v) this.#go({ scale: v.scale, center: { x: v.center.x - by.x, y: v.center.y - by.y } });
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
    this.#drag = undefined;
    this.#rubberBand(undefined);
    this.canvas.dataset['mode'] = mode;
    this.#hooks.onMode?.(mode);
  }

  /**
   * The prompt the drawing's command engine waits at (M2-02). One that takes points makes a
   * left click a pick and shows the crosshairs; with a base point, a rubber band follows the
   * cursor from it.
   */
  setPrompt(prompt: Prompt | undefined): void {
    const picking =
      prompt && (prompt.kind === 'point' || prompt.kind === 'distance' || prompt.kind === 'angle');
    this.#prompt = picking ? prompt : undefined;
    this.#traced = false;
    this.canvas.dataset['picking'] = String(!!picking);
    // A new prompt has a new base point, which PER and TAN are drawn from.
    this.#hit = undefined;
    this.#hits = [];
    this.#cycle = 0;
    // Acquired points last while the command runs (AutoCAD clears them when it ends).
    if (!prompt) this.#acquired = [];
    if (this.#mode !== 'none') return;
    if (this.#prompt) this.#requestSnap();
    this.#track();
  }

  /** The status bar's drafting aids changed (M2-04). */
  setDrafting(state: DraftingState): void {
    const before = this.#drafting;
    this.#drafting = state;
    this.#hit = undefined;
    if (!state.otrack) this.#acquired = this.#acquired.filter((a) => a.kind !== 'point');
    if (before.grid !== state.grid || before.lwt !== state.lwt || before.tpy !== state.tpy) {
      this.#host.setStyle(this.#style());
      this.#requestFrame();
    }
    if (this.#prompt && this.#mode === 'none') {
      this.#requestSnap();
      this.#track();
    }
  }

  /** The canvas colours changed in Settings (M2-20). */
  setColours(colours: CanvasColours): void {
    if (colours === this.#colours) return;
    this.#colours = colours;
    this.#paintCursor();
    this.#host.setStyle(this.#style());
    this.#requestFrame();
    if (this.#prompt && this.#mode === 'none') this.#track();
  }

  /** The objects to show grips on, and the hot grip (M2-06 part 2). */
  setGrips(ids: readonly EntityId[], hot?: Vec2): void {
    this.#host.setGrips(ids, hot);
    this.#requestFrame();
  }

  /** The objects to draw selected (M2-03). */
  setHighlight(ids: readonly EntityId[]): void {
    this.#host.setHighlight(ids);
    this.#requestFrame();
  }

  /** The objects within the pickbox of a world point, nearest first (M2-03). */
  pick(point: Vec2): Promise<EntityId[]> {
    const v = this.#view;
    if (!v) return Promise.resolve([]);
    const screen = worldToScreen(v, this.#size.width, this.#size.height, point);
    return this.#host.hitTest(screen, PICKBOX);
  }

  /** The objects a selection window between two world points takes (M2-03). */
  selectWindow(a: Vec2, b: Vec2, crossing: boolean): Promise<EntityId[]> {
    const box = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
    return this.#host.select({ kind: crossing ? 'crossing' : 'window', box });
  }

  /** ZOOM Object: the objects' extents fill the window; false when none has a known extent. */
  async zoomObjects(ids: readonly EntityId[]): Promise<boolean> {
    const box = await this.#host.boundsOf(ids);
    if (!box || !(this.#size.width > 0)) return false;
    const fit = fitView(box, this.#size.width, this.#size.height, 0);
    // A single point keeps the magnification and centres on it.
    const flat = box.maxX === box.minX && box.maxY === box.minY;
    this.#go(flat && this.#view ? { ...fit, scale: this.#view.scale } : fit);
    return true;
  }

  /** The objects' extents as drawn (M2-14 part 2: COPYCLIP's base point). */
  boundsOf(ids: readonly EntityId[]): Promise<Box | undefined> {
    return this.#host.boundsOf(ids);
  }

  /** The widths MTEXTs are laid out at (M2-10 part 3: dimension regeneration). */
  textWidths(texts: readonly MTextGeometry[]): Promise<(number | null)[]> {
    return this.#host.textWidths(texts);
  }

  /** How many dynamic columns MTEXTs take (M2-26 part 2: a column grip recounts them). */
  columnCounts(texts: readonly MTextGeometry[]): Promise<(number | null)[]> {
    return this.#host.columnCounts(texts);
  }

  /** The box an MTEXT's glyphs fill in the fonts loaded (M2-09, MLEADEREDIT). */
  textBox(text: MTextGeometry): Promise<Box | undefined> {
    return this.#host.textBox(text);
  }

  /** The running command's preview (`ctx.preview`), or none: drawn in the foreground colour. */
  setPreview(geometry: readonly EntityGeometry[]): void {
    this.#preview = geometry.flatMap((g) => tessellate(g, { color: this.#ui().crosshair }));
    const world = this.#mode === 'none' && this.#pointer ? this.#world(this.#pointer) : undefined;
    this.#rubberBand(world);
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
    this.#paintCursor();
    this.#listeners = new AbortController();
    this.#host = this.#createHost();
    // The new renderer has none of the bitmaps the old one was given.
    this.#images?.resend();
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
    // An IMAGEDEF brought in or changed (a loaded xref's images, a new path): its bitmap.
    const o = change.objects;
    if (
      [...(o?.added ?? []), ...(o?.updated ?? []).map((u) => u.after)].some(
        (d) => d.type === 'IMAGEDEF',
      )
    )
      this.#images?.resend();
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
    clearTimeout(this.#acquireTimer);
    this.#listeners.abort();
    this.#observer.disconnect();
    cancelAnimationFrame(this.#pending);
    this.#underlays?.dispose();
    this.#images?.dispose();
    this.#host.dispose();
    this.canvas.remove();
    this.#tip.remove();
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
      ...(this.#underlays && { onUnderlayRequest: (r) => this.#underlays?.request(r) }),
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

  /**
   * Model space on its canvas colour (dark by default); a layout's paper on its surround. ACI 7
   * draws white on a dark background and black on a light one (UI_SPEC.md §6).
   */
  /** The crosshairs', AutoSnap's and AutoTrack's colours on this canvas (M2-20 part 2). */
  #ui(): InterfaceColours {
    const c = this.#colours;
    return interfaceColours({ ...c, background: this.#layout ? c.paper : c.model });
  }

  /** The crosshairs in their colour as the canvas's cursor (styles.css reads `--crosshair`). */
  #paintCursor(): void {
    this.#canvas.style.setProperty('--crosshair', crosshairCursor(this.#ui().crosshair));
  }

  #style(): RenderStyle {
    const lw = this.#header.get('$LWDISPLAY');
    // LWT and TPY from the status bar (M2-04 part 2): LWT is the drawing's until turned.
    const d = this.#drafting;
    const showLineweights = d.lwt ?? (lw === true || lw === 1);
    const c = this.#colours;
    const shared = {
      showLineweights,
      selection: c.selection,
      ...(!d.tpy && { showTransparency: false }),
      ...(d.grid && { grid: { ...this.#grid(), ...(c.grid && { color: c.grid }) } }),
    };
    const background = this.#layout ? c.paper : c.model;
    return {
      background,
      foreground: foregroundOn(background),
      ...(this.#layout && { layoutBackground: c.surround }),
      ...shared,
    };
  }

  /** GRIDUNIT and GRIDMAJOR of the viewport shown (10 × 10 and 5 when it has none). */
  #grid(): { spacing: Vec2; base?: Vec2; major: number } {
    const vport = this.#vport();
    const g = vport?.gridSpacing;
    const s = this.#snapSpacing();
    // A GRIDUNIT of 0 follows the snap spacing, as AutoCAD's does.
    const spacing = g && g.x > 0 && g.y > 0 ? g : s;
    return {
      spacing,
      ...(vport?.snapBase && { base: vport.snapBase }),
      major: vport?.gridMajor && vport.gridMajor > 0 ? vport.gridMajor : 5,
    };
  }

  /** The `*Active` VPORT of model space, or this tile's; none in a layout. */
  #vport(): VportRecord | undefined {
    if (this.#layout) return undefined;
    return this.#hooks.tile
      ? this.#hooks.tile.vport
      : activeVport(this.#opened.init.tables?.vports);
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
        color: this.#ui().crosshair,
        path: [PATH_M, a.x, a.y, PATH_L, b.x, a.y, PATH_L, b.x, b.y, PATH_L, a.x, b.y, PATH_Z],
      },
    ]);
    this.#requestFrame();
  }

  /**
   * The command's rubber band from its base point to the cursor (a rectangle for a window's
   * corners), or none, over the command's preview.
   */
  #rubberBand(cursor: Point | undefined): void {
    const p = this.#prompt;
    // The objects the prompt drags follow the cursor as the drafting aids place it (M2-06).
    const motion =
      p?.drag && cursor && this.#mode === 'none' ? dragMotion(p.drag, cursor) : undefined;
    if (motion || this.#dragging) {
      this.#host.setDrag(motion);
      this.#dragging = motion !== undefined;
    }
    // PASTECLIP's objects are not in the drawing yet: its preview follows the cursor (M2-14).
    const ghost = p?.drag?.kind === 'preview' && this.#mode === 'none' ? p.drag.from : undefined;
    const preview = ghost
      ? !cursor
        ? []
        : this.#preview.map((q) =>
            transformPrimitive(q, {
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              e: cursor.x - ghost.x,
              f: cursor.y - ghost.y,
            }),
          )
      : this.#preview;
    const from = p?.kind === 'point' ? p.rubberBand?.from : p && 'base' in p ? p.base : undefined;
    const box = p?.kind === 'point' && p.rubberBand?.box;
    const selection = p?.kind === 'point' ? p.rubberBand?.selection : undefined;
    if (from && cursor && selection && this.#mode === 'none') {
      const crossing = selection === 'auto' ? cursor.x < from.x : selection === 'crossing';
      this.#host.setTransient([...preview, ...this.#selectionBand(from, cursor, crossing)]);
      this.#requestFrame();
      return;
    }
    const band: RenderPrimitive[] =
      from && cursor && this.#mode === 'none'
        ? [
            {
              kind: 'stroke',
              color: this.#ui().crosshair,
              path: box
                ? [
                    PATH_M,
                    from.x,
                    from.y,
                    PATH_L,
                    cursor.x,
                    from.y,
                    PATH_L,
                    cursor.x,
                    cursor.y,
                    PATH_L,
                    from.x,
                    cursor.y,
                    PATH_Z,
                  ]
                : [PATH_M, from.x, from.y, PATH_L, cursor.x, cursor.y],
            },
          ]
        : [];
    this.#host.setTransient([...preview, ...band, ...this.#overlay]);
    this.#requestFrame();
  }

  /** A selection window: a translucent fill and its edge, dashed when it is a crossing one. */
  #selectionBand(a: Point, b: Point, crossing: boolean): RenderPrimitive[] {
    const color = crossing ? CROSSING_COLOR : WINDOW_COLOR;
    const corners: [number, number][] = [
      [a.x, a.y],
      [b.x, a.y],
      [b.x, b.y],
      [a.x, b.y],
    ];
    const outline = [
      PATH_M,
      a.x,
      a.y,
      PATH_L,
      b.x,
      a.y,
      PATH_L,
      b.x,
      b.y,
      PATH_L,
      a.x,
      b.y,
      PATH_Z,
    ];
    let edge = outline;
    const scale = this.#view?.scale ?? 1;
    if (crossing) {
      // Dashes of DASH_PX on and off along each side, in world units at this zoom.
      const step = DASH_PX / scale;
      edge = [];
      corners.forEach(([x0, y0], i) => {
        const [x1, y1] = corners[(i + 1) % 4]!;
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let t = 0; t < len; t += 2 * step) {
          const u = Math.min(t + step, len);
          edge.push(PATH_M, x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len);
          edge.push(PATH_L, x0 + ((x1 - x0) * u) / len, y0 + ((y1 - y0) * u) / len);
        }
      });
    }
    return [
      { kind: 'fill', color, path: outline, opacity: SELECTION_FILL_OPACITY },
      { kind: 'stroke', color, path: edge },
    ];
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
        if (this.#mode === 'none') {
          const world = this.#world(e);
          if (!world) return;
          this.#press = { pointer: e.pointerId, x: e.offsetX, y: e.offsetY, dragged: false };
          c.setPointerCapture(e.pointerId);
          const shift = e.shiftKey;
          if (!this.#precise()) {
            this.#hooks.onPick?.(world, { shift, release: false, grip: GRIP_PICK_PX * this.#px() });
            return;
          }
          // At a point prompt the click gives the point the drafting aids make of it.
          this.#hooks.onPick?.(this.#pointAt(world), { shift, release: false });
          return;
        }
        if (this.#mode === 'pan' || this.#mode === 'zoom') this.#startDrag(e);
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
          const factor = realtimeZoomFactor(e.clientY - drag.y, this.#size.height);
          // Real-time ZOOM is about the window's centre, as AutoCAD's.
          this.#setView(
            drag.zoom
              ? scaleView(this.#view, factor)
              : panBy(this.#view, e.clientX - drag.x, e.clientY - drag.y),
          );
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        this.#pointer = { offsetX: e.offsetX, offsetY: e.offsetY };
        const press = this.#press;
        if (
          press?.pointer === e.pointerId &&
          Math.hypot(e.offsetX - press.x, e.offsetY - press.y) > CLICK_PX
        )
          press.dragged = true;
        const world = this.#world(e);
        const corner = this.#corner;
        if (corner && world) {
          const moved = Math.hypot(e.offsetX - corner.screen.x, e.offsetY - corner.screen.y);
          if (moved > CLICK_PX && e.buttons & 1) corner.dragged = true;
          this.#band(corner.world, world);
        } else if (this.#prompt && this.#mode === 'none') {
          this.#traceTo(world);
          this.#requestSnap();
          this.#track();
          return;
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
      // A drag begun with a click at the command engine ends its selection window.
      const press = this.#press;
      if (press?.pointer === e.pointerId) {
        this.#press = undefined;
        if (press.dragged && world && e.type === 'pointerup') {
          this.#hooks.onPick?.(world, { shift: e.shiftKey, release: true });
        }
      }
    };
    c.addEventListener('pointerup', endDrag, opts);
    c.addEventListener('pointercancel', endDrag, opts);
    c.addEventListener(
      'pointerleave',
      () => {
        this.#pointer = undefined;
        this.#hit = undefined;
        this.#hits = [];
        this.#cycle = 0;
        this.#candidate = undefined;
        clearTimeout(this.#acquireTimer);
        if (this.#prompt && this.#mode === 'none') this.#track();
        this.#hooks.onCursor(undefined);
      },
      opts,
    );
    c.addEventListener('auxclick', (e) => e.preventDefault(), opts);
    // A double click edits the object under it (M2-07 part 2).
    c.addEventListener(
      'dblclick',
      (e) => {
        if (e.button !== 0 || this.#mode !== 'none') return;
        const world = this.#world(e);
        if (world) this.#hooks.onDoubleClick?.(world);
      },
      opts,
    );
    // Shift+right-click: AutoCAD's object snap menu, at a point prompt (M2-04 part 2).
    c.addEventListener(
      'contextmenu',
      (e) => {
        if (!e.shiftKey || !this.#precise() || this.#mode !== 'none') return;
        e.preventDefault();
        this.#hooks.onSnapMenu?.({ x: e.clientX, y: e.clientY });
      },
      opts,
    );
  }

  /**
   * Tab over the canvas (M2-04 part 2): AutoSnap's next snap point under the aperture, as
   * AutoCAD steps through them; false when there is no other to step to.
   */
  cycleSnap(): boolean {
    if (!this.#pointer || !this.#prompt || this.#mode !== 'none' || this.#hits.length < 2)
      return false;
    this.#cycle = (this.#cycle + 1) % this.#hits.length;
    this.#hit = this.#hits[this.#cycle];
    this.#track();
    return true;
  }

  /**
   * Whether the drafting aids apply: a command waits for a point, not for a selection
   * window's corner (AutoCAD snaps no selection window).
   */
  #precise(): boolean {
    const p = this.#prompt;
    return !!p && !(p.kind === 'point' && p.rubberBand?.selection);
  }

  /** One CSS pixel in drawing units at the current zoom. */
  #px(): number {
    return 1 / (this.#view?.scale ?? 1);
  }

  /** The point the cursor is measured from: a rubber band's start (not a window's corner). */
  #base(): Vec2 | undefined {
    const p = this.#prompt;
    if (p?.kind === 'point')
      return p.rubberBand && !p.rubberBand.box ? p.rubberBand.from : undefined;
    return p && 'base' in p ? p.base : undefined;
  }

  /** SNAPUNIT of the viewport shown (10 × 10 when it has none). */
  #snapSpacing(): Vec2 {
    const s = this.#vport()?.snapSpacing;
    return s && s.x > 0 && s.y > 0 ? s : { x: 10, y: 10 };
  }

  /** SNAP, then ORTHO or POLAR, applied to a cursor point (M2-04). */
  #constrain(world: Vec2): ReturnType<typeof constrainCursor> {
    const d = this.#drafting;
    const base = this.#base();
    const vport = this.#vport();
    return constrainCursor(world, {
      ...(base && { base }),
      ...(d.snap && {
        snap: this.#snapSpacing(),
        ...(vport?.snapBase && { snapBase: vport.snapBase }),
      }),
      ortho: d.ortho,
      ...(d.polar && { polar: { increment: (d.polarAngle * Math.PI) / 180 } }),
      tolerance: TRACK_PX * this.#px(),
      ...(this.#acquired.length > 0 && { acquired: this.#acquired }),
    });
  }

  /** The modes the next point snaps with: a typed override's, else the running ones. */
  #modes(): number {
    const p = this.#prompt;
    return p?.kind === 'point' && p.osnap !== undefined ? p.osnap : this.#drafting.osmode;
  }

  /** The object snaps at a point, best first, then what may be acquired; none with OSNAP off. */
  #snapAt(world: Vec2): Promise<OsnapHit[]> {
    const base = this.#base();
    const modes = this.#modes();
    if (modes === 0 || !this.#view) return Promise.resolve([]);
    return this.#host
      .snap({
        point: world,
        aperture: this.#drafting.aperture * this.#px(),
        modes,
        underlays: this.#drafting.pdfOsnap,
        ...(base && { from: base }),
      })
      .catch(() => []);
  }

  /** Asks for the snaps at the cursor: one request in flight, the latest cursor asked next. */
  #requestSnap(): void {
    if (this.#snapping) {
      this.#snapAgain = true;
      return;
    }
    const world = this.#pointer && this.#world(this.#pointer);
    if (!world || !this.#precise()) return;
    this.#snapping = true;
    void this.#snapAt(world).then((hits) => {
      this.#snapping = false;
      const at = this.#pointer && this.#world(this.#pointer);
      // An answer for where the cursor was a moment ago still shows; it is replaced next.
      const points = at && this.#prompt ? hits.filter((h) => !h.track) : [];
      // Tab's choice stays while the same points are under the aperture.
      if (!sameHit(points[0], this.#hits[0]) || points.length !== this.#hits.length)
        this.#cycle = 0;
      this.#hits = points;
      this.#hit = points[this.#cycle];
      this.#watchAcquire(at && this.#prompt ? hits : []);
      this.#track();
      if (this.#snapAgain) {
        this.#snapAgain = false;
        this.#requestSnap();
      }
    });
  }

  /**
   * What the cursor pauses over to acquire (part 2): an object snap point for OTRACK, a line's
   * end for EXT, a line for PAR. Held still for ACQUIRE_MS, it is acquired, or let go if it
   * was; moving onto something else restarts the wait.
   */
  #watchAcquire(hits: readonly OsnapHit[]): void {
    const items: Acquired[] = [];
    const point = this.#hit;
    if (point && this.#drafting.otrack && this.#prompt?.kind === 'point' && !this.#prompt.osnap)
      items.push({ kind: 'point', point: point.point, mode: point.mode });
    for (const h of hits) {
      if (!h.track || !h.direction) continue;
      if (h.mode === 'EXT' && (!point || sameAt(h.point, point.point)))
        items.push({ kind: 'extension', point: h.point, direction: h.direction });
      else if (h.mode === 'PAR' && !point && !items.some((i) => i.kind === 'parallel'))
        items.push({ kind: 'parallel', point: h.point, direction: h.direction });
    }
    const key = items.map((i) => `${i.kind}:${i.point.x},${i.point.y}`).join('|');
    if (key === this.#candidate?.key) return;
    clearTimeout(this.#acquireTimer);
    this.#candidate = key ? { key, items } : undefined;
    if (!key) return;
    this.#acquireTimer = window.setTimeout(() => {
      if (this.#candidate?.key !== key) return;
      this.#acquire(items);
      this.#track();
    }, ACQUIRE_MS);
  }

  /** Acquires what the cursor paused over, or lets it go if it was acquired already. */
  #acquire(items: readonly Acquired[]): void {
    const has = (i: Acquired) =>
      this.#acquired.findIndex((a) => a.kind === i.kind && sameAt(a.point, i.point));
    const known = items.filter((i) => i.kind !== 'parallel' && has(i) >= 0);
    if (known.length > 0) {
      this.#acquired = this.#acquired.filter(
        (a) => !known.some((k) => k.kind === a.kind && sameAt(a.point, k.point)),
      );
      return;
    }
    for (const i of items) {
      // One parallel line at a time: a new one replaces the last.
      if (i.kind === 'parallel')
        this.#acquired = this.#acquired.filter((a) => a.kind !== 'parallel');
      this.#acquired.push(i);
    }
    while (this.#acquired.length > MAX_ACQUIRED) this.#acquired.shift();
  }

  /**
   * The point a click at `world` gives a point prompt: the object snap marked (Tab's choice),
   * else the constrained cursor; missed when the prompt's override found nothing there.
   */
  async #pointAt(world: Vec2): Promise<PickedPoint> {
    const hits = (await this.#snapAt(world)).filter((h) => !h.track);
    const hit = hits[this.#cycle < hits.length ? this.#cycle : 0];
    if (hit) return { point: hit.point };
    const p = this.#prompt;
    const missed = p?.kind === 'point' && p.osnap !== undefined && p.osnap !== 0;
    return { point: this.#constrain(world).point, ...(missed && { missed: true }) };
  }

  /**
   * REVCLOUD Freehand (M2-08): at a prompt that traces, the cursor answers once it has moved the
   * prompt's spacing from its last point, without a click, as AutoCAD follows the crosshairs.
   */
  #traceTo(world: Vec2 | undefined): void {
    const p = this.#prompt;
    const trace = p?.kind === 'point' ? p.trace : undefined;
    if (!trace || !world || this.#traced) return;
    if (Math.hypot(world.x - trace.from.x, world.y - trace.from.y) < trace.spacing) return;
    this.#traced = true;
    this.#hooks.onPick?.(world, { shift: false, release: false });
  }

  /**
   * Redraws the rubber band to the cursor as the drafting aids place it, with AutoSnap's
   * marker or polar tracking's path, and the tooltip; the status bar shows that point.
   */
  #track(): void {
    const world = this.#pointer && this.#mode === 'none' ? this.#world(this.#pointer) : undefined;
    if (!world || !this.#precise()) {
      this.#overlay = [];
      this.#tip.hidden = true;
      this.#rubberBand(world);
      if (world) this.#hooks.onCursor(world);
      return;
    }
    const ui = this.#ui();
    const px = this.#px();
    // AUTOSNAPSIZE scales the marker from AutoCAD's default 5 px (M2-20).
    const marker = (px * this.#drafting.markerSize) / MARKER_PX;
    const c = this.#constrain(world);
    const hit = this.#hit;
    let point: Vec2 = c.point;
    let tip = '';
    const reach = Math.hypot(this.#size.width, this.#size.height) * px;
    const acquired = acquiredPrimitives(
      this.#acquired.map((a) => a.point),
      px,
      ui.autotrack,
    );
    if (hit) {
      point = hit.point;
      this.#overlay = [...acquired, ...markerPrimitives(hit.mode, hit.point, marker, ui.autosnap)];
      tip = snapLabel(hit.mode);
    } else if (c.polar) {
      const base = this.#base()!;
      this.#overlay = [
        ...acquired,
        ...trackingPrimitives(base, c.polar.angle, reach + c.polar.distance, px, ui.autotrack),
      ];
      tip = polarLabel(c.polar, this.#precision());
    } else if (c.track) {
      // Each path from where it starts to past the cursor, and a cross where it ends.
      this.#overlay = [
        ...acquired,
        ...c.track.paths.flatMap((t) => {
          const to = Math.hypot(c.point.x - t.from.x, c.point.y - t.from.y);
          return trackingPrimitives(t.from, t.angle, to + reach, px, ui.autotrack);
        }),
        ...markerPrimitives('INT', c.point, marker * 0.6, ui.autosnap),
      ];
      tip = trackLabel(c.track, this.#precision());
    } else this.#overlay = acquired;
    this.#rubberBand(point);
    this.#tip.hidden = tip === '';
    if (tip) {
      this.#tip.textContent = tip;
      this.#tip.dataset['mode'] = hit?.mode ?? (c.polar ? 'polar' : 'track');
      // How many snap points Tab steps through here (tests wait on it).
      this.#tip.dataset['candidates'] = String(hit ? this.#hits.length : 0);
      this.#tip.style.left = `${this.#pointer!.offsetX + 16}px`;
      this.#tip.style.top = `${this.#pointer!.offsetY - 34}px`;
    }
    this.#hooks.onCursor(point);
  }

  /** LUPREC, for the tooltips. */
  #precision(): number {
    const v = this.#header.get('$LUPREC');
    return typeof v === 'number' && v >= 0 && v <= 8 ? v : 4;
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
    this.#drag = {
      pointer: e.pointerId,
      zoom: e.button === 0 && this.#mode === 'zoom',
      x: e.clientX,
      y: e.clientY,
    };
    this.canvas.setPointerCapture(e.pointerId);
  }
}

const sameAt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
