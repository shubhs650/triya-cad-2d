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
import type { DrawingDimensionHealth } from '@triya/dims';
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
  type TextGeometry,
  type TextOutline,
  type DeferredPick,
  type EnclosedSpace,
  type OsnapHit,
  type Lasso,
  type Prompt,
  type QuickMeasure,
  type UnderlaySnapPage,
  type UndoView,
  type Vec2,
  type VportRecord,
} from '@triya/engine';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  RendererHost,
  fitView,
  gripHalfSize,
  screenToWorld,
  tessellate,
  transformPrimitive,
  worldToScreen,
  type ChangeLink,
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
import { ROLLOVER_DELAY_MS, type RestAt } from '../rollover';
import { RestWatch } from './rest';
import { previewsSelection } from '../selection-preview';
import { layoutsOf } from '../documents';
import { appliedPageSetupName, pageSetupOf, pageSetupsOf, type PlotSpace } from '../plot';
import type { ImageClient } from '../images';
import type { UnderlayClient } from '../underlay/pages';
import { BUNDLED_FONTS } from '../fonts';
import {
  AUTOSNAP_MAGNET,
  AUTOSNAP_MARKER,
  AUTOSNAP_TIP,
  AUTOSNAP_TRACK_TIP,
  INITIAL_DRAFTING,
  POLARMODE_SHIFT_ACQUIRE,
  polarSnapDistance,
  trackingSettings,
  type DraftingState,
} from '../drafting';
import { DEFAULT_CANVAS, type CanvasColours } from '../preferences';
import { heldOverrides, withOverrides } from '../temp-overrides';
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
/** PICKAUTO 4 (M3-04 part 4): a drag that starts on nothing draws a lasso, not a rectangle. */
const PICKAUTO_LASSO = 4;
/** A selection window's colours, its fill's opacity and a crossing edge's dash (M2-03). */
const WINDOW_COLOR = '#4da3ff';
const CROSSING_COLOR = '#5fd35f';
const SELECTION_FILL_OPACITY = 0.18;
const DASH_PX = 6;
/**
 * A click this near a grip (CSS pixels) is on it: the grip's half size at GRIPSIZE and a pixel
 * (M2-06; M2-59 part 3 sizes it).
 */
const gripPickPx = (gripSize: number): number => gripHalfSize(gripSize) + 1;
/**
 * MEASUREGEOM Quick (M3-07): the green a space clicked is filled with, the orange square that
 * marks a right angle (the help's "orange squares … at precisely 90 degrees"), the size of the
 * ticks ending a measured distance and of an angle's arc, and how far the cursor goes from a
 * click before the spaces shown clear ("simply move the mouse a small distance"), CSS pixels.
 */
const QUICK_FILL = '#2fb344';
const QUICK_FILL_OPACITY = 0.35;
const QUICK_RIGHT = '#ff8c1a';
const QUICK_TICK_PX = 5;
const QUICK_ARC_PX = 18;
const QUICK_CLEAR_PX = 8;

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
      /** Ctrl was held: an arc's direction switched where the prompt says so (M3-01 part 6). */
      readonly ctrl?: boolean;
      /** With `release`: the lasso dragged from the window's first corner (M3-04 part 2). */
      readonly lasso?: Lasso;
    },
  ) => void;
  /**
   * A lasso is dragged (M3-04 part 2): its kind, for the command line to say, as AutoCAD's
   * does; undefined when it ends.
   */
  readonly onLasso?: (kind: Lasso['kind'] | undefined) => void;
  /**
   * A left double click (M2-07 part 2): the world point under it, for the command engine to
   * edit the object there (TEXTEDIT on a text, AutoCAD's DBLCLKEDIT).
   */
  readonly onDoubleClick?: (p: Vec2) => void;
  /**
   * A tap of Ctrl at a prompt that `ctrlCycles` (M3-05): the hot multi-functional grip's next
   * function, as AutoCAD's Ctrl cycles them.
   */
  readonly onCtrlCycle?: () => void;
  /** Shift+right-click at a point prompt (M2-04 part 2): the object snap menu, at client px. */
  readonly onSnapMenu?: (at: { readonly x: number; readonly y: number }) => void;
  /** The left-button mode changed (a window was picked, or Esc ended it). */
  readonly onMode?: (mode: CanvasMode) => void;
  /**
   * The cursor rests on the canvas (M2-35 part 21, rollover tooltips): no button held and no
   * window, PAN or ZOOM under way, still for `ROLLOVER_DELAY_MS`. Undefined when the rest ends:
   * the cursor moves on, a button is pressed, the wheel rolls or the cursor leaves.
   */
  readonly onRest?: (at: RestAt | undefined) => void;
  /**
   * The drawing waits at `Command:` with no command running, where SELECTIONPREVIEW's bit 1
   * previews the object under the pickbox (M3-04 part 5).
   */
  readonly atCommand?: () => boolean;
  /**
   * The drafter changed the view (M2-47 part 4): a ZOOM or PAN (a command's, the navigation
   * bar's, the wheel's at the start of a roll, a drag's at its first move) or a named view
   * restored (VIEW). `before` is the view left, for the drawing's undo history.
   */
  readonly onViewStep?: (label: 'ZOOM' | 'PAN' | 'VIEW', before: UndoView) => void;
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
   * Links a new render worker to the drawing's engine (M2-62), so the engine's change sets
   * reach it without waiting on the main thread; see `RendererHostOptions.connect`.
   */
  readonly connect?: () => ChangeLink | undefined;
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

/**
 * A click's point at a point prompt; `missed` when its object snap override found nothing;
 * `deferred` when it was snapped to a Deferred Tangent or Perpendicular (M3-01 part 2).
 */
export interface PickedPoint {
  readonly point: Vec2;
  readonly missed?: boolean;
  readonly deferred?: DeferredPick;
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
  /**
   * VPORT records as edited since the drawing opened (M3-06 part 2: the Snap and Grid tab, SNAP
   * and GRID edit the `*Active` one's spacing), by handle; the opened ones otherwise.
   */
  readonly #vports = new Map<Handle, VportRecord>();
  readonly #hooks: CanvasHooks;
  readonly #observer: ResizeObserver;
  /** The view shown is still the saved one the space opened in (`#resize` fits it again). */
  #openedSaved = false;
  readonly #history = new ViewHistory();
  #canvas: HTMLCanvasElement;
  #host: RendererHost;
  readonly #underlays: UnderlayClient | undefined;
  readonly #images: ImageClient | undefined;
  #listeners = new AbortController();
  #size: ViewportSize = { width: 0, height: 0 };
  #view: ViewTransform | undefined;
  /** The view last given to the renderer; a new renderer has none (M2-62). */
  #sentView: ViewTransform | undefined;
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
  #drag:
    | { readonly pointer: number; readonly zoom: boolean; x: number; y: number; moved: boolean }
    | undefined;
  #lastMiddle: { readonly t: number; readonly x: number; readonly y: number } | undefined;
  #lastWheel = -Infinity;
  #corner: { readonly world: Point; readonly screen: Point; dragged: boolean } | undefined;
  /**
   * A left press sent to the command engine, and whether it has since been dragged; the world
   * points it was dragged through, and the kind of lasso they make (M3-04 part 2: dragged left
   * a crossing, right a window, as AutoCAD's; Spacebar cycles them and Fence).
   */
  #press:
    | {
        readonly pointer: number;
        readonly x: number;
        readonly y: number;
        dragged: boolean;
        readonly path: Point[];
        lasso: Lasso['kind'] | undefined;
        shown: boolean;
      }
    | undefined;
  /** Where the pointer is over the canvas (offset), or undefined when it is not. */
  #pointer: { readonly offsetX: number; readonly offsetY: number } | undefined;
  /**
   * Ctrl is held (M3-01 part 6): at a prompt that switches an arc's direction with it
   * (`switchDirection`), the dragged arc goes the other way round, as AutoCAD's does.
   */
  #ctrl = false;
  /**
   * Ctrl went down and nothing else has been pressed since (M3-05): let go, it is a tap, which
   * cycles a hot multi-functional grip's functions at a prompt that says so (`ctrlCycles`).
   */
  #ctrlTap = false;
  /** Shift is held: it acquires tracking points or keeps them from being acquired (POLARMODE 8). */
  #shift = false;
  /** Grips show with none hot: the one under the cursor takes GRIPHOVER (M3-05 part 2). */
  #gripsHoverable = false;
  /** The renderer was last told a cursor for GRIPHOVER. */
  #gripHovering = false;
  /** The prompt the drawing waits at, as told (`#prompt` keeps only those that take points). */
  #asked: Prompt | undefined;
  /** The renderer was last told a pickbox for the selection preview (M3-04 part 5). */
  #previewing = false;
  /** Where the cursor rests, for rollover tooltips (M2-35 part 21). */
  readonly #rest = new RestWatch<{
    readonly x: number;
    readonly y: number;
    readonly offsetX: number;
    readonly offsetY: number;
  }>(ROLLOVER_DELAY_MS, (p) => {
    const world = p && this.#world(p);
    this.#hooks.onRest?.(p && world ? { world, clientX: p.x, clientY: p.y } : undefined);
  });
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
  /** The PDF page sizes last read from the files for a plot, by PDFDEFINITION (M2-68). */
  #pageSizes = new Map<Handle, { readonly width: number; readonly height: number }>();
  /** Settles once the renderer first answered (or failed to): the opening view waits on it. */
  #firstMeasure: Promise<void> = Promise.resolve();
  /** Settles when the canvas first shows a view (`whenViewed`). */
  #viewed!: () => void;
  #firstView = new Promise<void>((resolve) => (this.#viewed = resolve));
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
  /** The Properties palette's current polyline vertex, while marked (`markVertex`). */
  #vertexMark: Vec2 | undefined;
  /** The AutoSnap and polar tracking tooltip. */
  readonly #tip: HTMLDivElement;
  /** MEASUREGEOM Quick's prompt (M3-07): the spaces clicked, while it waits. */
  #quick: { readonly loops: readonly (readonly Vec2[])[] } | undefined;
  /** What Quick measured at the cursor last. */
  #quickMeasure: QuickMeasure | undefined;
  #quickAsking = false;
  #quickAgain = false;
  /** Where the last Quick click was (CSS pixels), while the spaces clicked show. */
  #quickClick: { readonly x: number; readonly y: number } | undefined;
  #quickOverlay: readonly RenderPrimitive[] = [];
  /** Quick's values, written beside what they measure. */
  readonly #quickLabels: HTMLDivElement;

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
    for (const cs of changes) {
      this.#followHeader(cs);
      this.#followVports(cs);
    }
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
    this.#quickLabels = document.createElement('div');
    this.#quickLabels.className = 'quick-measure';
    this.#quickLabels.dataset['testid'] = 'quick-measure';
    container.append(this.#quickLabels);
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
    await this.#readPageSizes();
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
      pageSetups: pageSetupsOf(this.#opened.init.objects, layout === undefined),
      pageSetupName: appliedPageSetupName(setup),
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

  /**
   * ZOOM Extents. A layout without entities shows its sheet. Until the renderer first measured
   * the space, which it answers a moment after the drawing first shows (its text bounded by its
   * glyphs), this zooms to the extents the drawing opened with, which guess text without fonts,
   * and zooms again to the measured extents once they come, unless the view has moved since
   * (M2-37).
   */
  zoomExtents(): void {
    const view = () => extentsView(this.#extents() ?? this.#paper(), this.#size);
    this.#go(view());
    this.#againOnceMeasured(view);
  }

  /** ZOOM All: the limits or the extents, whichever reaches further. */
  zoomAll(): void {
    const view = () => allView(this.#limits(), this.#extents(), this.#size);
    this.#go(view());
    this.#againOnceMeasured(view);
  }

  /** Shows `view()` again once the renderer first measured, if the view shown is still as is. */
  #againOnceMeasured(view: () => ViewTransform): void {
    if (this.#measured.done) return;
    const shown = this.#view;
    void this.#firstMeasure.then(() => {
      if (shown && this.#view === shown && this.#size.width > 0) this.#setView(view());
    });
  }

  /** ZOOM Scale nX, about the view's centre. */
  zoomScale(factor: number): void {
    if (this.#view) this.#go(scaleView(this.#view, factor));
  }

  /** ZOOM Previous: back to the view before the last zoom or pan; false with none left. */
  zoomPrevious(): boolean {
    const v = this.#history.previous();
    if (v) {
      this.#step('ZOOM');
      this.#setView(v);
    }
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
    if (v) {
      this.#go({ scale: v.scale, center: { x: v.center.x - by.x, y: v.center.y - by.y } }, 'PAN');
    }
  }

  /** Shows `view`, recording the current one for ZOOM Previous (VIEW restore). */
  show(view: ViewTransform): void {
    this.#go(view, 'VIEW');
  }

  /**
   * A view step undone or redone (M2-47 part 4): shows `view` without a ZOOM Previous entry or
   * another step, and answers with the view it replaced.
   */
  swapView(view: UndoView): UndoView | undefined {
    const old = this.#view;
    const { height } = this.#size;
    if (!old || !(height > 0) || !(view.height > 0)) return undefined;
    this.#setView({ center: view.center, scale: height / view.height });
    return { center: old.center, height: height / old.scale };
  }

  get view(): ViewTransform | undefined {
    return this.#view;
  }

  /** True once the canvas shows a view; false if none comes within `ms` (a hidden tab). */
  whenViewed(ms = 5000): Promise<boolean> {
    if (this.#view) return Promise.resolve(true);
    return Promise.race([
      this.#firstView.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
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
    // An object pick (TRIM's "Select object to trim") is a click with the pickbox, as at
    // `Command:`: no snaps, no tracking, its own point.
    const picking =
      prompt &&
      ((prompt.kind === 'point' && !prompt.pickbox) ||
        prompt.kind === 'distance' ||
        prompt.kind === 'angle');
    this.#prompt = picking ? prompt : undefined;
    this.#asked = prompt;
    this.#previewAgain();
    this.#quick = prompt?.kind === 'point' ? prompt.quick : undefined;
    if (!this.#quick) {
      this.#quickMeasure = undefined;
      this.#quickClick = undefined;
    }
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
    if (this.#quick) this.#requestQuick();
    else this.#drawQuick();
  }

  /** What the view shows, in drawing units; undefined before it has a size. */
  #viewBox(): Box | undefined {
    const v = this.#view;
    const { width, height } = this.#size;
    if (!v || !(width > 0) || !(height > 0)) return undefined;
    const a = screenToWorld(v, width, height, { x: 0, y: 0 });
    const b = screenToWorld(v, width, height, { x: width, y: height });
    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
  }

  /** The space enclosed around a point by the objects shown (MEASUREGEOM Quick's click). */
  enclosed(point: Vec2): Promise<EnclosedSpace | undefined> {
    const view = this.#viewBox();
    return view ? this.#host.enclosedSpace(point, view) : Promise.resolve(undefined);
  }

  /** Asks what Quick measures at the cursor: one request in flight, the latest cursor next. */
  #requestQuick(): void {
    if (this.#quickAsking) {
      this.#quickAgain = true;
      return;
    }
    const world = this.#pointer && this.#world(this.#pointer);
    const view = this.#viewBox();
    if (!this.#quick || !world || !view || this.#mode !== 'none') {
      this.#quickMeasure = undefined;
      this.#drawQuick();
      return;
    }
    this.#quickAsking = true;
    const aperture = this.#drafting.aperture * this.#px();
    void this.#host
      .quickMeasure({ point: world, aperture, view })
      .catch(() => undefined)
      .then((m) => {
        this.#quickAsking = false;
        this.#quickMeasure = this.#quick ? m : undefined;
        this.#drawQuick();
        if (this.#quickAgain) {
          this.#quickAgain = false;
          this.#requestQuick();
        }
      });
  }

  /**
   * Draws Quick's measurements: each distance as a line with ticks at its ends, each angle as
   * an arc (a square at 90°), the spaces clicked filled green, and the values as labels.
   */
  #drawQuick(): void {
    const prims: RenderPrimitive[] = [];
    const labels: { at: Vec2; text: string; kind: string }[] = [];
    const v = this.#view;
    if (this.#quick && v) {
      const px = this.#px();
      const color = this.#ui().autotrack;
      const loops = this.#quickClick ? this.#quick.loops : [];
      if (loops.length > 0) {
        const path: number[] = [];
        for (const loop of loops) {
          loop.forEach((p, i) => path.push(i === 0 ? PATH_M : PATH_L, p.x, p.y));
          path.push(PATH_Z);
        }
        prims.push({
          kind: 'fill',
          color: QUICK_FILL,
          path,
          opacity: QUICK_FILL_OPACITY,
          evenOdd: true,
        });
      }
      for (const s of this.#quickMeasure?.spans ?? []) {
        const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
        if (!(len > 0)) continue;
        // Ticks across each end, as a dimension's.
        const nx = (-(s.to.y - s.from.y) / len) * QUICK_TICK_PX * px;
        const ny = ((s.to.x - s.from.x) / len) * QUICK_TICK_PX * px;
        const path = [PATH_M, s.from.x, s.from.y, PATH_L, s.to.x, s.to.y];
        for (const p of [s.from, s.to])
          path.push(PATH_M, p.x - nx, p.y - ny, PATH_L, p.x + nx, p.y + ny);
        prims.push({ kind: 'stroke', color, path });
        labels.push({
          at: { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 },
          text: s.text,
          kind: 'distance',
        });
      }
      for (const a of this.#quickMeasure?.angles ?? []) {
        const r = QUICK_ARC_PX * px;
        const { x, y } = a.vertex;
        const dir = (t: number) => ({ x: Math.cos(t), y: Math.sin(t) });
        const u = dir(a.start);
        const w = dir(a.start + a.sweep);
        if (a.right) {
          const h = r / 2;
          prims.push({
            kind: 'stroke',
            color: QUICK_RIGHT,
            path: [
              PATH_M,
              x + u.x * h,
              y + u.y * h,
              PATH_L,
              x + (u.x + w.x) * h,
              y + (u.y + w.y) * h,
              PATH_L,
              x + w.x * h,
              y + w.y * h,
            ],
          });
        } else {
          const path: number[] = [];
          const steps = Math.max(4, Math.ceil(a.sweep / (Math.PI / 24)));
          for (let i = 0; i <= steps; i++) {
            const p = dir(a.start + (a.sweep * i) / steps);
            path.push(i === 0 ? PATH_M : PATH_L, x + p.x * r, y + p.y * r);
          }
          prims.push({ kind: 'stroke', color, path });
        }
        const m = dir(a.start + a.sweep / 2);
        labels.push({
          at: { x: x + m.x * r * 1.8, y: y + m.y * r * 1.8 },
          text: a.text,
          kind: 'angle',
        });
      }
    }
    this.#quickOverlay = prims;
    this.#quickLabels.replaceChildren(
      ...labels.map((l) => {
        const s = worldToScreen(v!, this.#size.width, this.#size.height, l.at);
        const el = document.createElement('div');
        el.className = 'quick-measure-label';
        el.dataset['kind'] = l.kind;
        el.textContent = l.text;
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        return el;
      }),
    );
    this.#rubberBand(undefined);
  }

  /** The status bar's drafting aids changed (M2-04). */
  setDrafting(state: DraftingState): void {
    const before = this.#drafting;
    this.#drafting = state;
    this.#hit = undefined;
    this.#previewAgain();
    if (!state.otrack) this.#acquired = this.#acquired.filter((a) => a.kind !== 'point');
    if (
      before.grid !== state.grid ||
      before.lwt !== state.lwt ||
      before.tpy !== state.tpy ||
      before.gripSize !== state.gripSize
    ) {
      this.#host.setStyle(this.#style());
      this.#requestFrame();
    }
    if (this.#prompt && this.#mode === 'none') {
      this.#requestSnap();
      this.#track();
    }
  }

  /**
   * The drafting aids the cursor follows: the status bar's, with the temporary override keys
   * held applied (M3-06 part 5).
   */
  #aids(): DraftingState {
    return withOverrides(this.#drafting, heldOverrides.active());
  }

  /** A temporary override key was pressed or let go: snap and track anew at a point prompt. */
  #overridden(): void {
    if (!this.#prompt || this.#mode !== 'none') return;
    this.#hit = undefined;
    this.#requestSnap();
    this.#track();
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

  /**
   * The polyline vertex the Properties palette shows, marked on the canvas while one of its
   * vertex rows has the focus (M2-35 part 8; AutoCAD marks the current vertex the same way), or
   * undefined for none.
   */
  markVertex(point: Vec2 | undefined): void {
    const same =
      point === this.#vertexMark ||
      (point &&
        this.#vertexMark &&
        point.x === this.#vertexMark.x &&
        point.y === this.#vertexMark.y);
    if (same) return;
    this.#vertexMark = point;
    this.#rubberBand(
      this.#pointer && this.#mode === 'none' ? this.#world(this.#pointer) : undefined,
    );
  }

  /** The current vertex's marker, AutoSnap's size (AUTOSNAPSIZE) whatever the zoom. */
  #vertexMarker(): RenderPrimitive[] {
    if (!this.#vertexMark || !this.#view) return [];
    const marker = (this.#px() * this.#drafting.markerSize) / MARKER_PX;
    return markerPrimitives('INT', this.#vertexMark, marker, this.#ui().autosnap);
  }

  /** The objects to show grips on, and the hot grip (M2-06 part 2). */
  setGrips(ids: readonly EntityId[], hot?: Vec2): void {
    this.#host.setGrips(ids, hot);
    this.#gripsHoverable = ids.length > 0 && !hot;
    if (!this.#gripsHoverable) this.#hoverGrip(undefined);
    this.#requestFrame();
  }

  /** How near a grip, in drawing units, the cursor counts as on it at this zoom (M2-06). */
  gripReach(): number {
    return gripPickPx(this.#drafting.gripSize) * this.#px();
  }

  /**
   * GRIPHOVER (M3-05 part 2): the grip under the cursor at `Command:` takes the hover colour,
   * as AutoCAD's does the moment the cursor is on it; not while a grip is hot or a button held.
   */
  #hoverGrip(world: Point | undefined): void {
    const at = this.#gripsHoverable ? world : undefined;
    if (!at && !this.#gripHovering) return;
    this.#gripHovering = at !== undefined;
    this.#host.setGripHover(at, this.gripReach());
    this.#requestFrame();
  }

  /**
   * SELECTIONPREVIEW (M3-04 part 5): the pickbox at `screen` (CSS pixels on the canvas) lights
   * up the object a click there would select, when the prompt the drawing waits at previews;
   * undefined, nothing does. Only a change, or a pickbox shown, asks for a frame.
   */
  #hoverPreview(screen: { readonly x: number; readonly y: number } | undefined): void {
    const d = this.#drafting;
    const on =
      screen &&
      previewsSelection(d.selectionPreview, this.#asked, this.#hooks.atCommand?.() ?? false);
    if (!on && !this.#previewing) return;
    this.#previewing = !!on;
    this.#host.setSelectionPreview(
      on
        ? {
            screen,
            aperture: d.pickbox,
            filter: d.previewFilter,
            groups: (d.pickStyle & 1) !== 0,
          }
        : undefined,
    );
    this.#requestFrame();
  }

  /** The prompt or the settings changed: the preview follows them where the cursor rests. */
  #previewAgain(): void {
    const p = this.#pointer;
    const resting = p && !this.#drag && !this.#corner && !this.#press && this.#mode === 'none';
    this.#hoverPreview(resting ? { x: p.offsetX, y: p.offsetY } : undefined);
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
    // PICKBOX (M3-04 part 4): the pickbox's half size in CSS pixels, AutoCAD's initial 3.
    return this.#host.hitTest(screen, this.#drafting.pickbox);
  }

  /** Where a world point is shown, in window pixels (M3-04 part 3: the Selection list). */
  clientOf(point: Vec2): Vec2 | undefined {
    const v = this.#view;
    if (!v) return undefined;
    const s = worldToScreen(v, this.#size.width, this.#size.height, point);
    const r = this.#canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
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

  /** What a selection polygon (WPolygon, CPolygon) or fence takes (M3-04). */
  selectPath(points: readonly Vec2[], kind: 'window' | 'crossing' | 'fence'): Promise<EntityId[]> {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const box = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
    return this.#host.select({ kind, box, polygon: points });
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

  /** The drawing's dimensions against their stored blocks (M2-30 part 3: the Health palette). */
  dimensionHealth(): Promise<DrawingDimensionHealth | undefined> {
    return this.#host.dimensionHealth();
  }

  /** Where texts lie as drawn (M2-27: EATTEDIT's attribute under a pick). */
  textOutlines(texts: readonly (TextGeometry | MTextGeometry)[]): Promise<(TextOutline | null)[]> {
    return this.#host.textOutlines(texts);
  }

  /** The pickbox's half size in world units (M2-27). */
  get pickbox(): number {
    return this.#drafting.pickbox * this.#px();
  }

  /**
   * The colour behind the drawing: model space's canvas or a layout's paper, which a background
   * mask in the drawing window colour fills with (M2-44, the MTEXT editor).
   */
  get background(): string {
    return this.#style().background;
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
    // The new canvas has drawn nothing yet.
    delete canvas.dataset['drawn'];
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

  /**
   * A change the drawing's engine applied (M1-67): the renderer applies it and redraws. `seq`
   * is its place in the drawing's change log: a render worker that already took it from the
   * engine (M2-62) skips it and only redraws, which finds the scene already drawn.
   */
  apply(change: ChangeSet, seq?: number): void {
    this.#host.apply(change, seq);
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
    // The snap and grid spacing, or the snap type, changed: the grid shows them.
    if (this.#followVports(change)) this.#host.setStyle(this.#style());
    // Drawn now rather than on the next animation frame, so `flush` resolves once the change
    // is on screen (the palette measures toggle → canvas, M1-23). The view is sent only when it
    // is not the one the renderer has: setting a view redraws the whole scene, and a render
    // worker that took the change from the engine (M2-62) has drawn it already, so this frame
    // only shows what it drew.
    if (this.#view && this.#size.width > 0) {
      if (this.#view !== this.#sentView) this.#host.setView(this.#view);
      this.#sentView = this.#view;
      this.#host.frame();
    }
  }

  /** Resolves once the renderer has handled everything sent to it so far. */
  flush(): Promise<void> {
    return this.#host.flush();
  }

  /**
   * When the renderer first drew the drawing's change number `seq` (M2-62), in milliseconds
   * since the epoch; undefined while it has not. What the Layers palette measures a toggle by.
   */
  drawnAt(seq: number): Promise<number | undefined> {
    return this.#host.drawnAt(seq);
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
    this.#rest.cancel();
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
    this.#sentView = undefined;
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
      ...(this.#hooks.connect && { connect: this.#hooks.connect }),
    });
    // Numbered as the change log: the engine's copies of later changes follow on from these.
    (this.#hooks.changes?.() ?? []).forEach((change, i) => host.apply(change, i + 1));
    this.canvas.dataset['renderer'] = host.mode;
    return host;
  }

  /** Keeps the VPORT records `change` edits; true when it edited any. */
  #followVports(change: ChangeSet): boolean {
    const v = change.tables?.vports;
    for (const r of [...(v?.added ?? []), ...(v?.updated ?? []).map((u) => u.after)])
      this.#vports.set(r.handle, r);
    return (v?.added?.length ?? 0) + (v?.updated?.length ?? 0) > 0;
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
   * Reads each PDF underlay's page size from its file and hands the renderer any that changed
   * (M2-68), so a plot's extents hold the pages whether or not the screen has drawn them yet:
   * the size a drawn page brings comes only once the canvas asked for it and pdf.js drew it.
   */
  async #readPageSizes(): Promise<void> {
    if (!this.#underlays) return;
    const sizes = await this.#underlays.pageSizes();
    for (const [definition, size] of sizes) {
      const was = this.#pageSizes.get(definition);
      if (was?.width !== size.width || was?.height !== size.height)
        this.#host.setUnderlayPage(definition, size);
    }
    for (const definition of this.#pageSizes.keys())
      if (!sizes.has(definition)) this.#host.setUnderlayPage(definition, undefined);
    this.#pageSizes = new Map(sizes);
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
      gripSize: d.gripSize,
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

  /** The `*Active` VPORT of model space, or this tile's, as edited; none in a layout. */
  #vport(): VportRecord | undefined {
    if (this.#layout) return undefined;
    const opened = this.#hooks.tile
      ? this.#hooks.tile.vport
      : activeVport(this.#opened.init.tables?.vports);
    return opened && (this.#vports.get(opened.handle) ?? opened);
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    // A hidden tab's canvas measures 0: keep its view until it shows again.
    if (width === 0 || height === 0) return;
    if (width === this.#size.width && height === this.#size.height) return;
    this.#size = { width, height };
    this.#host.resize(width, height, devicePixelRatio);
    if (this.#view) {
      // Until something else moves it, the view a space opened in is its saved one, a height
      // (VIEWSIZE) fitted to the canvas as it settles: a notice bar that comes or goes while
      // the drawing opens must not change how much of it shows (M2-55).
      const saved = this.#openedSaved;
      this.#setView((saved && this.#savedView()) || this.#view);
      this.#openedSaved = saved;
      return;
    }
    const saved = this.#savedView();
    if (saved) {
      this.#setView(saved);
      this.#openedSaved = true;
      return;
    }
    // Without a saved view the space opens at its extents, text included, so the first view
    // waits for the renderer's measure; it answers once it has built the drawing, which the
    // first frame waits for anyway.
    void this.#firstMeasure.then(() => {
      if (!this.#view && this.#size.width > 0) {
        this.#setView(extentsView(this.#opening(), this.#size));
      }
    });
  }

  /**
   * A discrete view change (a ZOOM option, -PAN, VIEW restore): recorded for ZOOM Previous, and
   * an undo step when it changes the view.
   */
  #go(view: ViewTransform, label: 'ZOOM' | 'PAN' | 'VIEW' = 'ZOOM'): void {
    if (this.#size.width === 0) return;
    const old = this.#view;
    if (old) this.#history.push(old);
    if (!old || !sameTransform(old, view)) this.#step(label);
    this.#setView(view);
  }

  /** Tells the drawing's undo history the view shown is about to change (M2-47 part 4). */
  #step(label: 'ZOOM' | 'PAN' | 'VIEW'): void {
    const v = this.#view;
    const { height } = this.#size;
    if (v && height > 0)
      this.#hooks.onViewStep?.(label, { center: v.center, height: height / v.scale });
  }

  #setView(view: ViewTransform): void {
    this.#openedSaved = false;
    this.#view = view;
    this.#viewed();
    this.#requestFrame();
    // Quick's values sit on the screen where what they measure was: measured again.
    if (this.#quick) this.#requestQuick();
    // The point under a cursor that has not moved is another one now: the status bar (and a
    // prompt's rubber band) follow it, as the cursor that came onto the canvas before there was
    // a view (a layout's first, M2-37) showed no coordinates until it next moved.
    const hovered = this.#pointer && !this.#drag && this.#canvas.matches(':hover');
    if (hovered && this.#prompt && this.#mode === 'none') this.#track();
    else {
      if (hovered) this.#hooks.onCursor(this.#world(this.#pointer!));
      // The current vertex's marker keeps its size in pixels (M2-35 part 8).
      if (this.#vertexMark) this.#rubberBand(undefined);
    }
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
      this.#sentView = this.#view;
      this.#host.frame();
      this.#drawing = true;
      const canvas = this.#canvas;
      const size = `${this.#size.width}x${this.#size.height}`;
      this.#host.flush().then(
        () => {
          this.#drawing = false;
          // The size of the last frame on screen (M2-50): a canvas whose CSS size differs has
          // been cleared by a resize, or not drawn at all yet, and will show the drawing at its
          // next frame. The UI specs wait for it before they measure the canvas.
          if (canvas.dataset['drawn'] !== size) canvas.dataset['drawn'] = size;
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
    const ctrl = this.#ctrl && p?.switchDirection === true;
    const motion =
      p?.drag && cursor && this.#mode === 'none' ? dragMotion(p.drag, cursor, { ctrl }) : undefined;
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
      const lasso = this.#lasso();
      const path =
        lasso && lasso.points.length > 1
          ? { points: lasso.points, open: lasso.kind === 'fence' }
          : p?.kind === 'point'
            ? p.rubberBand?.path
            : undefined;
      this.#host.setTransient([
        ...preview,
        ...(path
          ? this.#selectionPath(
              [...path.points, cursor],
              lasso ? lasso.kind !== 'window' : crossing,
              path.open !== true,
            )
          : this.#selectionBand(from, cursor, crossing)),
        ...this.#vertexMarker(),
      ]);
      this.#requestFrame();
      return;
    }
    // A band the prompt does not draw (RECTANG's: its drag is the rectangle, M3-01 part 3).
    const drawn = !(p?.kind === 'point' && p.rubberBand?.drawn === false);
    const band: RenderPrimitive[] =
      from && cursor && drawn && this.#mode === 'none'
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
    this.#host.setTransient([
      ...preview,
      ...band,
      ...this.#overlay,
      ...this.#quickOverlay,
      ...this.#vertexMarker(),
    ]);
    this.#requestFrame();
  }

  /**
   * A selection polygon (M3-04: WPolygon blue and solid, CPolygon green and dashed, as windows
   * are), closed and filled, or a fence: its lines alone, dashed.
   */
  #selectionPath(points: readonly Point[], crossing: boolean, closed: boolean): RenderPrimitive[] {
    const color = crossing ? CROSSING_COLOR : WINDOW_COLOR;
    const ring = closed ? [...points, points[0]!] : points;
    const outline: number[] = [];
    ring.forEach((q, i) => outline.push(i === 0 ? PATH_M : PATH_L, q.x, q.y));
    let edge = outline;
    if (crossing) {
      const step = DASH_PX / (this.#view?.scale ?? 1);
      edge = [];
      for (let i = 0; i + 1 < ring.length; i++) {
        const { x: x0, y: y0 } = ring[i]!;
        const { x: x1, y: y1 } = ring[i + 1]!;
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let t = 0; t < len; t += 2 * step) {
          const u = Math.min(t + step, len);
          edge.push(PATH_M, x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len);
          edge.push(PATH_L, x0 + ((x1 - x0) * u) / len, y0 + ((y1 - y0) * u) / len);
        }
      }
    }
    return [
      ...(closed
        ? [{ kind: 'fill', color, path: outline, opacity: SELECTION_FILL_OPACITY } as const]
        : []),
      { kind: 'stroke', color, path: edge },
    ];
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
    // A temporary override key pressed or let go (M3-06 part 5): the cursor snaps anew.
    const stopOverrides = heldOverrides.subscribe(() => this.#overridden());
    this.#listeners.signal.addEventListener('abort', stopOverrides);
    // Ctrl pressed or let go with the cursor still (M3-01 part 6): the dragged arc switches.
    const ctrlKey = (e: KeyboardEvent) => {
      if (e.key !== 'Control') {
        this.#ctrlTap = false;
        return;
      }
      if (e.type === 'keydown' && !e.repeat) this.#ctrlTap = true;
      if (e.type === 'keyup' && this.#ctrlTap) {
        this.#ctrlTap = false;
        if (this.#prompt?.ctrlCycles) this.#hooks.onCtrlCycle?.();
      }
      if (this.#ctrl === e.ctrlKey) return;
      this.#ctrl = e.ctrlKey;
      if (this.#prompt?.switchDirection && this.#pointer && this.#mode === 'none') this.#track();
    };
    // A button pressed while Ctrl is down makes it no tap.
    window.addEventListener('pointerdown', () => (this.#ctrlTap = false), opts);
    window.addEventListener('keydown', ctrlKey, opts);
    window.addEventListener('keyup', ctrlKey, opts);
    const shiftKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') this.#shiftKey(e.type === 'keydown');
    };
    window.addEventListener('keydown', shiftKey, opts);
    window.addEventListener('keyup', shiftKey, opts);
    window.addEventListener('blur', () => (this.#shift = false), opts);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#rest.cancel();
        this.#hoverPreview(undefined);
        if (!this.#view) return;
        // The wheel zooms the viewport under the cursor, which becomes current (as a press
        // would), so the navigation bar then acts on the viewport just zoomed.
        this.#activate();
        // One roll is one ZOOM Previous view and one undo step, which UNDO Control Combine
        // joins to the zooms and pans next to it (M2-47 part 4).
        if (e.timeStamp - this.#lastWheel > WHEEL_GESTURE_MS) {
          this.#history.push(this.#view);
          this.#step('ZOOM');
        }
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
        this.#rest.cancel();
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
          this.#press = {
            pointer: e.pointerId,
            x: e.offsetX,
            y: e.offsetY,
            dragged: false,
            path: [world],
            lasso: undefined,
            shown: false,
          };
          c.setPointerCapture(e.pointerId);
          let shift = e.shiftKey;
          if (this.#quick) {
            // Shift adds to the spaces shown; once they have cleared, a click starts afresh.
            shift &&= this.#quickClick !== undefined;
            this.#quickClick = { x: e.offsetX, y: e.offsetY };
          }
          if (!this.#precise()) {
            this.#hooks.onPick?.(world, {
              shift,
              release: false,
              grip: this.gripReach(),
            });
            return;
          }
          // At a point prompt the click gives the point the drafting aids make of it.
          this.#ctrl = e.ctrlKey;
          this.#hooks.onPick?.(this.#pointAt(world), {
            shift,
            release: false,
            ...(e.ctrlKey && { ctrl: true }),
          });
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
          // A press that never moves the view is no undo step.
          if (!drag.moved && (e.clientX !== drag.x || e.clientY !== drag.y)) {
            drag.moved = true;
            this.#step(drag.zoom ? 'ZOOM' : 'PAN');
          }
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
        this.#ctrl = e.ctrlKey;
        this.#shift = e.shiftKey;
        // A rest is the cursor alone: not while a button is held, a window, PAN or ZOOM goes on.
        if (e.buttons === 0 && !this.#drag && !this.#corner && this.#mode === 'none') {
          this.#rest.move({ x: e.clientX, y: e.clientY, offsetX: e.offsetX, offsetY: e.offsetY });
        } else this.#rest.cancel();
        const press = this.#press;
        const world = this.#world(e);
        const resting = e.buttons === 0 && !this.#drag && !this.#corner && this.#mode === 'none';
        this.#hoverGrip(resting ? world : undefined);
        this.#hoverPreview(resting ? { x: e.offsetX, y: e.offsetY } : undefined);
        if (press?.pointer === e.pointerId) {
          if (Math.hypot(e.offsetX - press.x, e.offsetY - press.y) > CLICK_PX && !press.dragged) {
            press.dragged = true;
            // Without PICKAUTO's bit 4 the drag makes the rectangular window it began.
            if (this.#drafting.pickauto & PICKAUTO_LASSO)
              press.lasso = e.offsetX < press.x ? 'crossing' : 'window';
          }
          // A point every few pixels is path enough, and keeps a long lasso's test quick.
          const last = press.path.at(-1);
          if (world && (!last || Math.hypot(world.x - last.x, world.y - last.y) >= 2 * this.#px()))
            press.path.push(world);
        }
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
        if (this.#quick && this.#mode === 'none') {
          const click = this.#quickClick;
          if (
            click &&
            !e.shiftKey &&
            Math.hypot(e.offsetX - click.x, e.offsetY - click.y) > QUICK_CLEAR_PX
          ) {
            this.#quickClick = undefined;
          }
          this.#requestQuick();
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
      // A drag begun with a click at the command engine ends its selection window, or lasso.
      const press = this.#press;
      if (press?.pointer === e.pointerId) {
        const lasso = this.#lasso();
        this.#press = undefined;
        if (press.shown) this.#hooks.onLasso?.(undefined);
        if (press.dragged && world && e.type === 'pointerup') {
          this.#hooks.onPick?.(world, {
            shift: e.shiftKey,
            release: true,
            ...(lasso && { lasso: { kind: lasso.kind, points: [...lasso.points, world] } }),
          });
        }
      }
    };
    c.addEventListener('pointerup', endDrag, opts);
    c.addEventListener('pointercancel', endDrag, opts);
    c.addEventListener(
      'pointerleave',
      () => {
        this.#rest.cancel();
        this.#hoverGrip(undefined);
        this.#hoverPreview(undefined);
        this.#pointer = undefined;
        this.#hit = undefined;
        this.#hits = [];
        this.#cycle = 0;
        this.#candidate = undefined;
        clearTimeout(this.#acquireTimer);
        if (this.#prompt && this.#mode === 'none') this.#track();
        if (this.#quick) {
          this.#quickMeasure = undefined;
          this.#drawQuick();
        }
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
   * The lasso being dragged (M3-04 part 2): a press that found nothing, started a selection
   * window there and has been dragged. Says so to the command line as it starts.
   */
  #lasso(): Lasso | undefined {
    const press = this.#press;
    const p = this.#prompt;
    if (!press?.dragged || !press.lasso || p?.kind !== 'point') return undefined;
    const band = p.rubberBand;
    const start = press.path[0]!;
    // The window this press started, not one a click began before it.
    if (!band?.box || band.selection !== 'auto' || band.from.x !== start.x) return undefined;
    if (band.from.y !== start.y) return undefined;
    if (!press.shown) {
      press.shown = true;
      this.#hooks.onLasso?.(press.lasso);
    }
    return { kind: press.lasso, points: press.path };
  }

  /**
   * Spacebar while a lasso is dragged (M3-04 part 2): its next kind, Crossing, Window, Fence,
   * as AutoCAD cycles them; false when no lasso is dragged.
   */
  cycleLasso(): boolean {
    const press = this.#press;
    if (!this.#lasso() || !press?.lasso) return false;
    const order = ['crossing', 'window', 'fence'] as const;
    press.lasso = order[(order.indexOf(press.lasso) + 1) % order.length];
    this.#hooks.onLasso?.(press.lasso);
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

  /**
   * SNAP, then ORTHO or POLAR, applied to a cursor point (M2-04). SNAP is grid snap or, with
   * SNAPTYPE 1, PolarSnap along the tracking paths (M3-06 part 3); the polar angles count from
   * the prompt's last segment with POLARMODE 1.
   */
  #constrain(world: Vec2): ReturnType<typeof constrainCursor> {
    const d = this.#aids();
    const base = this.#base();
    const vport = this.#vport();
    const p = this.#prompt;
    const last = p?.kind === 'point' ? p.rubberBand?.direction : undefined;
    const polarSnap = polarSnapDistance(d, this.#snapSpacing().x);
    return constrainCursor(world, {
      ...(base && { base }),
      ...(d.snap &&
        polarSnap === undefined && {
          snap: this.#snapSpacing(),
          ...(vport?.snapBase && { snapBase: vport.snapBase }),
        }),
      ...(polarSnap !== undefined && { polarSnap }),
      // TK's next tracking point goes orthogonally whatever ORTHO says (M3-06 part 4).
      ortho: d.ortho || (p?.kind === 'point' && p.ortho === true),
      ...trackingSettings(d, last),
      tolerance: TRACK_PX * this.#px(),
      ...(this.#acquired.length > 0 && { acquired: this.#acquired }),
    });
  }

  /** The modes the next point snaps with: a typed override's, else the running ones. */
  #modes(): number {
    const p = this.#prompt;
    return p?.kind === 'point' && p.osnap !== undefined ? p.osnap : this.#aids().osmode;
  }

  /** The object snaps at a point, best first, then what may be acquired; none with OSNAP off. */
  #snapAt(world: Vec2): Promise<OsnapHit[]> {
    const base = this.#base();
    const modes = this.#modes();
    const p = this.#prompt;
    const deferred = p?.kind === 'point' ? p.deferred : undefined;
    if (modes === 0 || !this.#view) return Promise.resolve([]);
    return this.#host
      .snap({
        point: world,
        aperture: this.#drafting.aperture * this.#px(),
        modes,
        underlays: this.#drafting.pdfOsnap,
        ...(base && { from: base }),
        ...(deferred && { deferred }),
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
    if (point && this.#aids().otrack && this.#prompt?.kind === 'point' && !this.#prompt.osnap)
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
    // POLARMODE 8 (M3-06 part 3): Shift held over it acquires it at once, and nothing else does.
    if (this.#shiftAcquires()) {
      if (this.#shift) this.#acquire(items);
      return;
    }
    // Otherwise a pause acquires it, unless Shift is held ("press Shift to temporarily avoid
    // acquiring a point", AutoCAD 2024 Help).
    this.#acquireTimer = window.setTimeout(() => {
      if (this.#candidate?.key !== key || this.#shift) return;
      this.#acquire(items);
      this.#track();
    }, ACQUIRE_MS);
  }

  /** Points are acquired with Shift (Options > Drafting's "Shift to acquire", POLARMODE 8). */
  #shiftAcquires(): boolean {
    return (this.#drafting.polarMode & POLARMODE_SHIFT_ACQUIRE) !== 0;
  }

  /** Shift pressed or let go: with Shift to acquire, pressing it acquires what the cursor is over. */
  #shiftKey(down: boolean): void {
    if (down === this.#shift) return;
    this.#shift = down;
    const c = this.#candidate;
    if (!down || !c || !this.#shiftAcquires() || !this.#prompt || this.#mode !== 'none') return;
    this.#acquire(c.items);
    this.#track();
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
    if (hit) {
      const point = this.#along(world, hit.point);
      return { point, ...(hit.deferred && { deferred: hit.deferred }) };
    }
    const p = this.#prompt;
    const missed = p?.kind === 'point' && p.osnap !== undefined && p.osnap !== 0;
    return { point: this.#constrain(world).point, ...(missed && { missed: true }) };
  }

  /**
   * A snap at a prompt whose point goes orthogonally (TK's next tracking point, M3-06 part 4):
   * the snap's X or Y along the axis the cursor goes from the base, as AutoCAD's tracking takes
   * it; elsewhere the snap itself.
   */
  #along(world: Vec2, snap: Vec2): Vec2 {
    const p = this.#prompt;
    const base = this.#base();
    if (p?.kind !== 'point' || !p.ortho || !base) return snap;
    const c = this.#constrain(world).point;
    return c.y === base.y && c.x !== base.x ? { x: snap.x, y: base.y } : { x: base.x, y: snap.y };
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
    // AUTOSNAP's bits (M2-59): the marker, its SnapTip, the magnet, the tracking tooltips.
    const bits = this.#drafting.autosnap;
    const trackTip = (bits & AUTOSNAP_TRACK_TIP) !== 0;
    if (hit) {
      // Without the magnet the rubber band stays at the cursor; a click still takes the snap.
      if (bits & AUTOSNAP_MAGNET) point = this.#along(world, hit.point);
      this.#overlay = [
        ...acquired,
        ...(bits & AUTOSNAP_MARKER
          ? markerPrimitives(hit.mode, hit.point, marker, ui.autosnap, !!hit.deferred)
          : []),
      ];
      if (bits & AUTOSNAP_TIP) tip = snapLabel(hit.mode, !!hit.deferred);
    } else if (c.polar) {
      const base = this.#base()!;
      this.#overlay = [
        ...acquired,
        ...trackingPrimitives(base, c.polar.angle, reach + c.polar.distance, px, ui.autotrack),
      ];
      if (trackTip) tip = polarLabel(c.polar, this.#precision());
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
      if (trackTip) tip = trackLabel(c.track, this.#precision());
    } else this.#overlay = acquired;
    this.#rubberBand(point);
    this.#tip.hidden = tip === '';
    if (tip) {
      this.#tip.textContent = tip;
      this.#tip.dataset['mode'] = hit?.mode ?? (c.polar ? 'polar' : 'track');
      this.#tip.dataset['deferred'] = String(!!hit?.deferred);
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
      moved: false,
    };
    this.canvas.setPointerCapture(e.pointerId);
  }
}

const sameAt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const sameTransform = (a: ViewTransform, b: ViewTransform): boolean =>
  a.scale === b.scale && sameAt(a.center, b.center);
