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
  IDENTITY,
  MAX_ACQUIRED,
  paperPointOf,
  viewportLocked,
  viewportScale,
  viewportTwist,
  viewportSnapGrid,
  viewportViewOf,
  withViewportView,
  workableViewport,
  type ViewportGeometry,
  type ViewportView,
  constrainCursor,
  dragMotion,
  layoutSheet,
  constraintBarKey,
  offsetSnapPoint,
  polarLabel,
  trackLabel,
  trackedSnaps,
  toWorld,
  ucsOf,
  viewportUcs,
  type Acquired,
  type PlanUcs,
  unionBox,
  type Box,
  type ChangeSet,
  type DimStylePreview,
  type StylePreview,
  type EntityId,
  type NestedPick,
  PREVIEW_AT_COMMAND,
  PREVIEW_SELECTING,
  type GroupGrip,
  type Handle,
  type HeaderValue,
  type Layout,
  type EntityGeometry,
  type MTextGeometry,
  type TextGeometry,
  type TextOutline,
  type TextPiece,
  type DeferredPick,
  type EnclosedSpace,
  type OsnapHit,
  type OsnapMode,
  type SnappedPoint,
  type Lasso,
  type Prompt,
  type QuickMeasure,
  type UnderlaySnapPage,
  type UndoView,
  type Vec2,
  type SnapGridState,
  type VportRecord,
  type CommandPreview,
  type TableCellLock,
} from '@triya/engine';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  RendererHost,
  fitView,
  gripHalfSize,
  modelViewOf,
  screenToWorld,
  tessellate,
  transformPrimitive,
  worldToScreen,
  aciRgb,
  rgbHex,
  type ChangeLink,
  type ConstraintBarHit,
  type DrawnEntity,
  type FontSources,
  type GridSpec,
  type PlotPart,
  type PlotRequest,
  type RasterPixels,
  type RefEditDisplay,
  type RenderPrimitive,
  type RenderStats,
  type RenderStyle,
  type ScreenRect,
  type SelectQuery,
  type UnderlayRaster,
  type ViewTransform,
} from '@triya/render';
import type { OpenResult } from '@triya/io';
import { ROLLOVER_DELAY_MS, type RestAt } from '../rollover';
import { commandInput, focusOf } from '../shortcuts';
import { RestWatch } from './rest';
import {
  areaPreviewed,
  leftOf,
  pathArea,
  previewsSelection,
  windowArea,
  windowCorners,
} from '../selection-preview';
import { layoutsOf } from '../documents';
import {
  appliedPageSetupName,
  pageSetupOf,
  pageSetupsOf,
  plotViewsOf,
  type PlotSpace,
} from '../plot';
import { drawingObjects, drawingRecords, drawingViews } from '../saved-views';
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
  gridDisplayOf,
  polarSnapDistance,
  trackingSettings,
  type DraftingState,
} from '../drafting';
import { DEFAULT_CANVAS, type CanvasColours } from '../preferences';
import { heldOverrides, withOverrides } from '../temp-overrides';
import {
  CONSTRAINT_BAR_PANEL,
  CONSTRAINT_COLOR,
  crosshairCursor,
  foregroundOn,
  interfaceColours,
  isDarkColor,
  type InterfaceColours,
} from './colours';
import { tooltipStyle } from '../tooltip-appearance';
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
import {
  ViewportHistories,
  fitTurned,
  frameOnCanvas,
  frameView,
  maximizedGeometry,
  sameViewportView,
  turnedBox,
  viewportViewFrom,
  type FrameOnCanvas,
} from './viewport-zoom';

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
/** PICKAUTO 2 (M3-04 part 6): a press on an object at `Command:`, dragged, starts a window. */
const PICKAUTO_DRAG = 2;
/** A selection window's colours, its fill's opacity and a crossing edge's dash (M2-03). */
const WINDOW_COLOR = '#4da3ff';
const CROSSING_COLOR = '#5fd35f';
const SELECTION_FILL_OPACITY = 0.18;
const DASH_PX = 6;
/** Command preview requests (M3-12 part 6), numbered across every canvas of every drawing. */
let previewSeq = 0;
/** Questions for the lock of the table cell under the cursor (M4-16 part 11), numbered likewise. */
let cellLockSeq = 0;
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

/** SNAPMODE and GRIDMODE of the viewport a canvas works in, and where they are kept. */
export interface ViewportModesShown {
  readonly holder: Handle;
  readonly snap: boolean;
  readonly grid: boolean;
}

export interface CanvasHooks {
  /** The world point under the cursor, or undefined when it leaves the canvas. */
  /**
   * The cursor's world point, with the UCS of a layout viewport made current that keeps its own
   * (UCSVP 1, M6-02 part 20), which the status bar's coordinates are in; else the header's.
   */
  readonly onCursor: (
    p: { readonly x: number; readonly y: number } | undefined,
    ucs?: PlanUcs,
  ) => void;
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
      /**
       * The press at this point has just been dragged (M3-04 part 6): with PICKAUTO 2, one that
       * picked an object at `Command:` starts a window there instead.
       */
      readonly dragged?: boolean;
      /**
       * With `release`: the path a press was dragged along from the rubber band's start, at a
       * prompt that takes a freehand path (TRIM's freehand fence, M3-12 part 6).
       */
      readonly freehand?: readonly Vec2[];
      /**
       * The point a point, distance or angle prompt asked for, as the drafting aids make it (not
       * a pick at `Command:` or "Select objects"): what the drafter types next is for the
       * prompt it leads to (M5-22).
       */
      readonly answer?: true;
    },
  ) => void;
  /**
   * COMMANDPREVIEW (M3-12 part 6): asks the command engine what a pick (point) at `cursor`
   * would do, with the objects under the pickbox (`hits`) where the prompt previews by them;
   * the answer comes back to `commandPreviewed` with `seq`.
   */
  readonly onCommandPreview?: (q: {
    readonly seq: number;
    readonly cursor: Vec2;
    readonly hits: readonly EntityId[];
    readonly shift: boolean;
  }) => void;
  /**
   * A lasso is dragged (M3-04 part 2): its kind, for the command line to say, as AutoCAD's
   * does; undefined when it ends.
   */
  readonly onLasso?: (kind: Lasso['kind'] | undefined) => void;
  /**
   * A left double click (M2-07 part 2): the world point under it, for the command engine to
   * edit the object there (TEXTEDIT on a text, AutoCAD's DBLCLKEDIT).
   */
  /**
   * `paper` (M6-02 part 9): the double click began outside the layout viewport current then,
   * and `p` is the sheet's point.
   */
  readonly onDoubleClick?: (p: Vec2, paper?: true) => void;
  /**
   * The layout viewport worked in changed (MSPACE, PSPACE; M6-02 part 3), or was maximized or
   * restored (VPMAX, VPMIN; part 7): the status bar's.
   */
  readonly onViewport?: (handle: Handle | undefined, maximized: boolean) => void;
  /**
   * A tap of Ctrl at a prompt that `ctrlCycles` (M3-05): the hot multi-functional grip's next
   * function, as AutoCAD's Ctrl cycles them.
   */
  readonly onCtrlCycle?: () => void;
  /** Shift+right-click at a point prompt (M2-04 part 2): the object snap menu, at client px. */
  readonly onSnapMenu?: (at: { readonly x: number; readonly y: number }) => void;
  /**
   * A right-click (no Shift) on the canvas (M3-05 part 5): the prompt's shortcut menu, at client
   * px, if it has one (the grip modes'); true when shown, so the browser's menu is not.
   */
  readonly onShortcutMenu?: (at: { readonly x: number; readonly y: number }) => boolean;
  /**
   * A right-click at `Command:` on a constraint bar (M9-05 part 4): its icon's shortcut menu at
   * client px (Delete, Hide, Hide All Constraints, Constraint Bar Settings); true when shown.
   */
  readonly onConstraintBarMenu?: (
    at: { readonly x: number; readonly y: number },
    hit: ConstraintBarHit,
  ) => boolean;
  /** Delete pressed with the cursor resting on a constraint bar's icon (M9-05 part 4). */
  readonly onConstraintDelete?: (hit: ConstraintBarHit) => void;
  /** The left-button mode changed (a window was picked, or Esc ended it). */
  readonly onMode?: (mode: CanvasMode) => void;
  /**
   * The cursor rests on the canvas (M2-35 part 21, rollover tooltips): no button held and no
   * window, PAN or ZOOM under way, still for `ROLLOVER_DELAY_MS`. Undefined when the rest ends:
   * the cursor moves on, a button is pressed, the wheel rolls or the cursor leaves.
   */
  readonly onRest?: (at: RestAt | undefined) => void;
  /**
   * Selection cycling's badge (M3-04 part 7, SELECTIONCYCLING 1 or 2): the cursor, in window
   * pixels, rests over overlapping objects it could select; undefined when it no longer does.
   */
  readonly onOverlap?: (at: { readonly x: number; readonly y: number } | undefined) => void;
  /**
   * The cursor is at `point` at `Command:` or a prompt showing table cell locks (M4-16 part 11):
   * the engine is asked for the lock of the cell there, answered with `cellLocked(seq, lock)`.
   */
  readonly onCellLock?: (q: { readonly seq: number; readonly point: Point }) => void;
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
  /**
   * A ZOOM or PAN in the layout viewport made current changed its own view (M6-02 part 4): the
   * drawing's edit, resolved once the engine has answered. `join` is the rest of one wheel roll
   * or drag, one undo step with its start.
   */
  readonly onViewportView?: (
    viewport: Handle,
    view: ViewportView,
    label: 'ZOOM' | 'PAN' | 'VIEW',
    join: boolean,
  ) => Promise<unknown> | void;
  /**
   * SNAP or GRID of the viewport this canvas works in changed, or it works in another one (M6-02
   * part 19): the status bar shows the shown canvas's (`viewportModes`).
   */
  readonly onViewportModes?: (modes: ViewportModesShown | undefined) => void;
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
  /** The objects of the drawing whose constraint bars are hidden, by handle (M9-05 part 2). */
  readonly constraintBars?: () => ReadonlySet<string>;
  /**
   * The drawing's constraint bars the drafter dragged (M9-05 part 6), by `constraintBarKey`: each
   * one's offset in CSS pixels, y down, from where it is laid out.
   */
  readonly constraintBarMoves?: () => ReadonlyMap<string, { x: number; y: number }>;
  /** A constraint bar dragged at `Command:` (M9-05 part 6) to `offset`; undefined puts it back. */
  readonly moveConstraintBar?: (key: string, offset: { x: number; y: number } | undefined) => void;
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
  /** The object snap that gave the point and its object, which Infer reads (M9-05 part 7). */
  readonly snap?: { readonly mode: OsnapMode; readonly id: EntityId };
  /** The PARallel and OTRACK paths it was placed on, from which objects (M9-05 part 8). */
  readonly tracks?: readonly Omit<SnappedPoint, 'point'>[];
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
  /**
   * A layout's paper-space viewport (DXF 69 id 1) as edited, which keeps paper space's snap and
   * grid settings (M6-02 part 17); undefined on the Model tab and in a layout that has none.
   */
  #paperViewport: { readonly handle: Handle; geom: ViewportGeometry } | undefined;
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
  /** The floating viewport made current (MSPACE, M6-02 part 3), and its geometry now. */
  #current: CurrentViewport | undefined;
  /** ZOOM Previous of each layout viewport's own view (M6-02 part 4). */
  readonly #viewportHistory = new ViewportHistories();
  /**
   * The current viewport is maximized (VPMAX, M6-02 part 7): `#current`'s geometry is the one
   * that frames it by the whole canvas, and its view there the canvas's own, which VPMIN drops.
   */
  #maximized = false;
  /**
   * The last left press outside the current layout viewport's frame (M6-02 part 9), which the
   * engine takes to make the viewport there current, with its point on the sheet: a double click
   * begun with it is that switch alone, not a pick or an edit in the viewport it went to.
   */
  #outsidePress:
    | { readonly t: number; readonly x: number; readonly y: number; readonly paper: Vec2 }
    | undefined;
  /** ZOOM Previous of the view of the viewport maximized, apart from its own. */
  #maximizedHistory = new ViewportHistories();
  /**
   * The cursor is outside the viewport worked in (M6-02 part 13): over a tiled viewport that is
   * not current, or off the current layout viewport's frame. It is an arrow there, with no
   * object snap, tracking, rubber band or preview, as AutoCAD shows it (AutoCAD 2024 Help, "To
   * Make a Model Viewport Current": in the current viewport "the cursor is displayed as
   * crosshairs instead of an arrow").
   */
  #outside = false;
  /**
   * Viewport view edits sent and not answered yet: the view the canvas gave the current viewport
   * stands over the one a change set brings meanwhile, so a roll of the wheel goes on from it.
   */
  #viewportEdits = 0;
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
  /** A frame is being sent: what is told the renderer now goes with it, needing no other. */
  #sending = false;
  /**
   * COMMANDPREVIEW (M3-12 part 6): the request the engine is answering (one at a time, the
   * latest cursor asked next), the cursor still to ask about, and whether a preview is drawn.
   */
  #previewAsked: { readonly seq: number; readonly prompt: Prompt } | undefined;
  #previewWanted: { readonly cursor: Point; readonly hover: boolean } | undefined;
  #previewShown = false;
  /** A selection window or lasso being dragged previews what it takes (M3-04 part 6). */
  #areaPreviewing = false;
  /**
   * Shift+Space over overlapping objects (M3-04 part 7): where the cursor was when it was first
   * pressed, CSS pixels on the canvas, and how many times; the next pick there takes the object
   * that many steps on from the nearest.
   */
  #overlapStep:
    { readonly at: { readonly x: number; readonly y: number }; step: number } | undefined;
  /** The lock question awaiting its answer (M4-16 part 11): one at a time, the latest next. */
  #lockAsked: number | undefined;
  /** Where the cursor is, waiting to be asked about once the question out is answered. */
  #lockWanted: Point | undefined;
  /** The cursor carries the lock of the cell under it. */
  #lockShown = false;
  /** What of the constraint bars the cursor is on at `Command:` (M9-05 part 4), as answered. */
  #barHit: ConstraintBarHit | undefined;
  /** The latest constraint bar question asked; older answers are passed over. */
  #barSeq = 0;
  /**
   * A press at `Command:` on a constraint bar (M9-05 part 6): a drag moves the bar, a click
   * without one picks there as any other click does, on release.
   */
  #barPress:
    | {
        readonly pointer: number;
        readonly x: number;
        readonly y: number;
        readonly key: string;
        readonly from: { readonly x: number; readonly y: number } | undefined;
        readonly world: Point;
        readonly shift: boolean;
        dragged: boolean;
      }
    | undefined;
  /** The badge's latest hit test, so an older answer arriving late is dropped. */
  #badgeAsked = 0;
  /** The badge shows. */
  #badgeShown = false;
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
  /** The UCS icon (M3-06 part 7), over the canvas's lower-left corner or at the UCS origin. */
  readonly #ucsIcon: HTMLDivElement;

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
    if (this.#layout) {
      const sheet = opened.init.entities?.find(
        (e) => e.owner === block && e.geom.kind === 'VIEWPORT' && e.geom.id === 1,
      );
      if (sheet?.geom.kind === 'VIEWPORT') {
        this.#paperViewport = { handle: sheet.handle, geom: sheet.geom };
      }
    }
    for (const cs of changes) {
      this.#followHeader(cs);
      this.#followVports(cs);
      this.#followPaperViewport(cs);
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
    // Dynamic Input's tooltip takes the layout colour over a layout (M3-06 part 8).
    canvas.dataset['space'] = this.#layout ? 'layout' : 'model';
    // Neither model space nor a layout's: a block definition the Block Editor shows (M5-02).
    const editing = !this.#layout && block !== opened.modelSpace;
    canvas.setAttribute(
      'aria-label',
      this.#layout
        ? `Layout ${this.#layout.name}`
        : editing
          ? 'Block Editor'
          : (hooks.tile?.label ?? 'Model'),
    );
    container.append(canvas);
    this.#canvas = canvas;
    this.#paintCursor();
    this.#tip = document.createElement('div');
    this.#tip.className = 'autosnap-tip';
    this.#tip.dataset['testid'] = 'autosnap-tip';
    this.#tip.hidden = true;
    container.append(this.#tip);
    this.#styleTip();
    this.#quickLabels = document.createElement('div');
    this.#quickLabels.className = 'quick-measure';
    this.#quickLabels.dataset['testid'] = 'quick-measure';
    container.append(this.#quickLabels);
    this.#ucsIcon = document.createElement('div');
    this.#ucsIcon.className = 'ucs-icon';
    this.#ucsIcon.dataset['testid'] = 'ucs-icon';
    this.#ucsIcon.setAttribute('aria-hidden', 'true');
    this.#ucsIcon.hidden = true;
    container.append(this.#ucsIcon);
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

  /**
   * A dimension style's preview image of `size` CSS pixels at this screen's pixel ratio (M4-03
   * part 3), in the drawing's styles and the canvas's display style.
   */
  dimStylePreview(
    preview: DimStylePreview,
    size: { width: number; height: number },
  ): Promise<ImageBitmap | undefined> {
    return this.#host.dimStylePreview(preview, { ...size, dpr: devicePixelRatio });
  }

  /** A text or multileader style dialog's preview image (M4-14), as `dimStylePreview`'s. */
  stylePreview(
    preview: StylePreview,
    size: { width: number; height: number },
  ): Promise<ImageBitmap | undefined> {
    return this.#host.stylePreview(preview, { ...size, dpr: devicePixelRatio });
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
    const changes = this.#hooks.changes?.() ?? [];
    const init = this.#opened.init;
    const setup = layout ?? layoutsOf(init, changes).find((l) => l.blockRecord === this.block);
    return {
      name: layout?.name ?? 'Model',
      sheet: sheet && { paper: sheet.paper, unitsPerMm: sheet.unitsPerMm },
      inches: setup?.plot?.paperUnits === 'inches',
      extents: this.#extents(),
      display,
      limits: this.#limits(),
      namedPlotStyles: this.#header.get('$PSTYLEMODE') === 0,
      // The applications as edited: Apply to Layout may have registered PLOTTRANSPARENCY.
      pageSetup: pageSetupOf(setup, drawingRecords(init, changes, 'appIds')),
      // As edited: the Page Setup Manager adds, changes and deletes them (M6-01 part 3).
      pageSetups: pageSetupsOf(drawingObjects(init, changes), layout === undefined),
      pageSetupName: appliedPageSetupName(setup),
      views: plotViewsOf(drawingViews(init, changes), layout !== undefined),
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
  zoomExtents(): void | Promise<void> {
    if (this.#zoomable()) return this.#viewportExtents(false);
    const view = () => extentsView(this.#extents() ?? this.#paper(), this.#size);
    this.#go(view());
    this.#againOnceMeasured(view);
  }

  /** ZOOM All: the limits or the extents, whichever reaches further. */
  zoomAll(): void | Promise<void> {
    if (this.#zoomable()) return this.#viewportExtents(true);
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
    const z = this.#zoomable();
    if (z) this.#goViewport(z, scaleView(frameView(z.c.geom, z.frame.size), factor), 'ZOOM');
    else if (this.#view) this.#go(scaleView(this.#view, factor));
  }

  /**
   * ZOOM nXP: in the layout viewport made current, n paper units to the model unit, its scale on
   * the sheet (AutoCAD 2024 Help, "ZOOM (Command)": "nXP ... relative to the paper space units");
   * on paper, n relative to the layout's limits.
   */
  zoomPaper(factor: number): void {
    const z = this.#zoomable();
    if (!z) return this.zoomLimits(factor);
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const height = Math.abs(z.c.geom.height) / factor;
    const center = viewportViewOf(z.c.geom).center;
    this.#goViewport(z, { center, scale: z.frame.size.height / height }, 'ZOOM');
  }

  /** ZOOM Previous: back to the view before the last zoom or pan; false with none left. */
  zoomPrevious(): boolean {
    const z = this.#zoomable();
    if (z) {
      // Each viewport steps back through its own views.
      const was = this.#ownHistory().previous(z.c.handle);
      if (was)
        this.#goViewport(
          z,
          { center: was.center, scale: z.frame.size.height / was.height },
          'ZOOM',
          {
            previous: true,
          },
        );
      return was !== undefined;
    }
    const v = this.#history.previous();
    if (v) {
      this.#step('ZOOM');
      this.#setView(v);
    }
    return v !== undefined;
  }

  /** ZOOM Window from the command: the box between two world points fills the window. */
  zoomWindow(a: Vec2, b: Vec2): void {
    const z = this.#zoomable();
    if (z) {
      const w = fitTurned(this.#frameTurn(z), (t) => windowView(t(a), t(b), z.frame.size));
      if (w) this.#goViewport(z, w, 'ZOOM');
      return;
    }
    // A display-locked viewport made current keeps its view: the sheet moves (AutoCAD's).
    const v = windowView(this.#toSheet(a), this.#toSheet(b), this.#size);
    if (v) this.#go(v);
  }

  /** ZOOM Center: `center` in the middle with `height` world units from top to bottom. */
  zoomCenter(center: Vec2, height: number): void {
    const z = this.#zoomable();
    if (z) {
      if (height > 0) this.#goViewport(z, { center, scale: z.frame.size.height / height }, 'ZOOM');
      return;
    }
    const h = height * this.#sheetScale();
    if (h > 0 && this.#size.height > 0)
      this.#go({ center: this.#toSheet(center), scale: this.#size.height / h });
  }

  /**
   * ZOOM n: `factor` relative to the limits (1 fits them, 2 shows half as much) about the view's
   * centre; the extents stand in for limits a space does not have.
   */
  zoomLimits(factor: number): void {
    const z = this.#zoomable();
    if (z) {
      const ms = this.#opened.modelSpace;
      const limits =
        this.#modelLimits() ?? (ms === undefined ? undefined : this.#opened.extents[ms]);
      const now = frameView(z.c.geom, z.frame.size);
      const w = fitTurned(this.#frameTurn(z), (t) =>
        limitsView(limits && turnedBox(limits, t), z.frame.size, factor, {
          ...now,
          center: t(now.center),
        }),
      );
      if (w) this.#goViewport(z, w, 'ZOOM');
      return;
    }
    const v = limitsView(this.#limits() ?? this.#extents(), this.#size, factor, this.#view);
    if (v) this.#go(v);
  }

  /** -PAN: moves the drawing by `by` world units. */
  panWorld(by: Vec2): void {
    const z = this.#zoomable();
    if (z) {
      const now = frameView(z.c.geom, z.frame.size);
      const center = { x: now.center.x - by.x, y: now.center.y - by.y };
      this.#goViewport(z, { center, scale: now.scale }, 'PAN');
      return;
    }
    const v = this.#view;
    const k = this.#sheetScale();
    if (v) {
      const center = { x: v.center.x - by.x * k, y: v.center.y - by.y * k };
      this.#go({ scale: v.scale, center }, 'PAN');
    }
  }

  /** Shows `view`, recording the current one for ZOOM Previous (VIEW restore). */
  show(view: ViewTransform): void {
    this.#go(view, 'VIEW');
  }

  /**
   * A model view restored in the layout viewport made current (M2-47's leftover, M6-02 part 12;
   * AutoCAD 2024 Help, "View Manager Dialog Box": Set Current in a layout viewport's model space
   * restores a model view there): the window `box` (world units) fills the viewport, a VIEW step
   * of the viewport's own view. False when no viewport whose view can change is current.
   */
  showInViewport(box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    const z = this.#zoomable();
    if (!z) return false;
    const w = fitTurned(this.#frameTurn(z), (t) => {
      const b = turnedBox(box, t);
      return windowView({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }, z.frame.size);
    });
    if (w) this.#goViewport(z, w, 'VIEW');
    return w !== undefined;
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

  /** The view the cursor works in: model space's through a viewport made current (MSPACE). */
  get view(): ViewTransform | undefined {
    return this.#pointerView();
  }

  /** The layout viewport made current (MSPACE, M6-02 part 3), if any. */
  get viewport(): Handle | undefined {
    return this.#current?.handle;
  }

  /**
   * The current layout viewport's own view, model space at its frame's middle and the model units
   * from its bottom to its top (VIEWCTR and VIEWSIZE in MSPACE; M6-02 part 4), if one is current.
   */
  get viewportView(): { center: Vec2; height: number; width: number } | undefined {
    const g = this.#current?.geom;
    if (!g) return undefined;
    const v = viewportViewOf(g);
    return { ...v, width: (v.height * Math.abs(g.width)) / Math.abs(g.height) };
  }

  /**
   * MSPACE and PSPACE (M6-02 part 3): the layout is worked in through the floating viewport
   * `handle` (its geometry as it is now), or on paper again. The cursor's points, snaps, picks
   * and windows are model space's while one is current; the sheet stays where it is.
   */
  setViewport(
    handle: Handle | undefined,
    geometry: ViewportGeometry | undefined,
    maximized = false,
  ): void {
    const view = this.#view;
    const current = handle !== undefined && geometry && this.#layout ? geometry : undefined;
    // VPMAX (M6-02 part 7): the viewport framed by the whole canvas, showing what it showed.
    const max = maximized && current && view && this.#size.width > 0 && this.#size.height > 0;
    const before = this.#current?.handle;
    this.#current =
      handle !== undefined && current
        ? { handle, geom: max ? maximizedGeometry(current, view, this.#size) : current }
        : undefined;
    this.#maximized = max !== undefined && max !== false;
    if (this.#maximized) this.#maximizedHistory = new ViewportHistories();
    this.#host.setActiveViewport(
      this.#current?.handle,
      this.#maximized ? this.#current?.geom : undefined,
    );
    this.#canvas.dataset['viewport'] = this.#current?.handle ?? '';
    this.#canvas.dataset['maximized'] = this.#maximized ? 'true' : '';
    this.#hooks.onViewport?.(this.#current?.handle, this.#maximized);
    this.#hits = [];
    this.#hit = undefined;
    this.#acquired = [];
    this.#leftWork(this.#isOutside());
    // The crosshairs turn with a twisted viewport's model space (M6-02 part 15).
    this.#paintCursor();
    // The grid is model space's through the viewport, paper space's on the sheet (M6-02 part 9),
    // at the spacing of the viewport worked in (M6-02 part 17).
    // Each viewport has its own GRIDMODE and SNAPMODE and UCS icon too (M6-02 part 19).
    if (before !== this.#current?.handle) {
      this.#host.setStyle(this.#style());
      this.#showUcsIcon();
      this.#hooks.onViewportModes?.(this.viewportModes());
    }
    if (this.#prompt) this.#requestSnap();
    this.#track();
    if (this.#view && this.#size.width > 0) this.#host.frame();
  }

  /**
   * A left press while a layout viewport is current (M6-02 part 9): one outside its frame is
   * kept, as the engine switches to the viewport there (or does nothing, on the sheet between
   * them). True for the second press of a double click begun with it, which is taken for nothing
   * else: the canvas may not show the switch yet, and the viewport switched to has nothing to
   * pick from that click.
   */
  #viewportPress(e: PointerEvent): boolean {
    if (this.#outsideDouble(e, DOUBLE_CLICK_MS)) return true;
    this.#outsidePress = undefined;
    const c = this.#current;
    const view = this.#view;
    if (!c || this.#maximized || !view || this.#mode !== 'none') return false;
    const { width, height } = this.#size;
    const paper = screenToWorld(view, width, height, { x: e.offsetX, y: e.offsetY });
    const g = c.geom;
    const outside =
      Math.abs(paper.x - g.center.x) > g.width / 2 || Math.abs(paper.y - g.center.y) > g.height / 2;
    if (outside) this.#outsidePress = { t: e.timeStamp, x: e.offsetX, y: e.offsetY, paper };
    return false;
  }

  /** The press outside the current viewport that `e`, within `ms` of it, doubles. */
  #outsideDouble(e: MouseEvent, ms: number): { readonly paper: Vec2 } | undefined {
    const o = this.#outsidePress;
    if (!o || e.timeStamp - o.t >= ms) return undefined;
    return Math.hypot(e.offsetX - o.x, e.offsetY - o.y) <= DOUBLE_CLICK_PX ? o : undefined;
  }

  /**
   * The view the cursor's points are taken in: model space as the current viewport shows it
   * while one is (MSPACE), else the view shown.
   */
  #pointerView(): ViewTransform | undefined {
    const v = this.#view;
    const c = this.#current;
    return v && c ? modelViewOf(v, c.geom) : v;
  }

  /** A point of the cursor's space where the sheet shows it (itself on paper). */
  #toSheet(p: Vec2): Vec2 {
    const c = this.#current;
    if (!c) return p;
    return paperPointOf(c.geom, p);
  }

  /** Sheet units per unit of the cursor's space (1 on paper). */
  #sheetScale(): number {
    const c = this.#current;
    return c ? viewportScale(c.geom) : 1;
  }

  /**
   * The layout viewport made current whose own view ZOOM, PAN, the wheel and real-time
   * navigation change (M6-02 part 4), with its frame on the canvas: none on paper, nor for a
   * viewport whose display is locked, where they move the sheet as AutoCAD's do.
   */
  #zoomable(): { readonly c: CurrentViewport; readonly frame: FrameOnCanvas } | undefined {
    const c = this.#current;
    const v = this.#view;
    // A viewport maximized zooms whatever its lock: the view is the canvas's own (VPMAX).
    if (!c || !v || (!this.#maximized && viewportLocked(c.geom))) return undefined;
    const frame = frameOnCanvas(c.geom, v, this.#size);
    return frame.size.width > 0 && frame.size.height > 0 ? { c, frame } : undefined;
  }

  /** The angle a zoomable viewport's frame turns model space by: its twist (M6-02 part 15). */
  #frameTurn(z: { readonly c: CurrentViewport }): number {
    return viewportTwist(z.c.geom);
  }

  /**
   * The current viewport shows `view` of its frame as its own view (M6-02 part 4): the drawing's
   * edit, a ZOOM or PAN undo step, and the view left kept for ZOOM Previous unless `join` (the
   * rest of a wheel roll or drag) or `previous` (ZOOM Previous itself).
   */
  #goViewport(
    z: { readonly c: CurrentViewport; readonly frame: FrameOnCanvas },
    view: ViewTransform,
    label: 'ZOOM' | 'PAN' | 'VIEW',
    o: { readonly join?: boolean; readonly previous?: boolean } = {},
  ): void {
    const { c, frame } = z;
    const next = viewportViewFrom(view, frame.size);
    const was = viewportViewOf(c.geom);
    if (!(next.height > 0) || !Number.isFinite(next.height) || sameViewportView(next, was)) return;
    if (!o.join && !o.previous) this.#ownHistory().push(c.handle, was);
    c.geom = withViewportView(c.geom, next);
    // Maximized, the view is the canvas's alone: VPMIN shows the viewport's own again.
    let sent: Promise<unknown> | void = undefined;
    if (this.#maximized) this.#host.setActiveViewport(c.handle, c.geom);
    else sent = this.#hooks.onViewportView?.(c.handle, next, label, o.join === true);
    if (sent) {
      this.#viewportEdits++;
      const done = () => void this.#viewportEdits--;
      void sent.then(done, done);
    }
    // The cursor is over another model point now: its coordinates and rubber band follow.
    if (this.#view) this.#setView(this.#view);
  }

  /** The ZOOM Previous views of the current viewport: its own, or those it had maximized. */
  #ownHistory(): ViewportHistories {
    return this.#maximized ? this.#maximizedHistory : this.#viewportHistory;
  }

  /**
   * The viewport maximized framed by the canvas again, once the canvas or the sheet's view has
   * changed (a resize): about the same model point, at the same scale.
   */
  #refitMaximized(): void {
    const c = this.#current;
    const v = this.#view;
    const { width, height } = this.#size;
    if (!this.#maximized || !c || !v || !(width > 0) || !(height > 0)) return;
    const g = c.geom;
    const framed =
      g.center.x === v.center.x &&
      g.center.y === v.center.y &&
      g.width === width / v.scale &&
      g.height === height / v.scale;
    if (framed) return;
    const was = viewportViewOf(g);
    const scale = viewportScale(g);
    c.geom = maximizedGeometry(g, v, this.#size, {
      center: was.center,
      height: height / v.scale / scale,
    });
    this.#host.setActiveViewport(c.handle, c.geom);
  }

  /** ZOOM Extents or All in the current viewport: model space's, as the renderer measures it. */
  async #viewportExtents(all: boolean): Promise<void> {
    const box = await this.#host.extents(this.#opened.modelSpace);
    const z = this.#zoomable();
    if (!z) return;
    const size = z.frame.size;
    const limits = this.#modelLimits();
    // A twisted viewport fits the boxes as its turned frame shows them (M6-02 part 15).
    const view = fitTurned(this.#frameTurn(z), (t) => {
      const b = box && turnedBox(box, t);
      return all ? allView(limits && turnedBox(limits, t), b, size) : extentsView(b, size);
    })!;
    this.#goViewport(z, view, 'ZOOM');
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
    // MATCHPROP's paintbrush (M3-16): the cursor image changes only as the badge does.
    this.#paintCursor();
    // A cell locked or unlocked at the last prompt shows as such where the cursor rests.
    const at = this.#pointer;
    this.#hoverLock(at && !this.#press && this.#mode === 'none' ? this.#world(at) : undefined);
    // A constraint bar answers the cursor at `Command:` only.
    this.#hoverBar(at && !this.#press && this.#mode === 'none' ? at : undefined);
    // The preview drawn was the last prompt's; this one's is asked for where the cursor rests.
    this.#showCommandPreview(undefined);
    if (prompt?.commandPreview?.hover) {
      const p = this.#pointer;
      this.#commandPreview(p && !this.#press ? this.#world(p) : undefined);
    }
    // The window that previewed is gone or another; the next cursor move previews it afresh.
    if (this.#areaPreviewing) {
      this.#areaPreviewing = false;
      this.#host.setSelectionPreview(undefined);
    }
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
    const v = this.#pointerView();
    const { width, height } = this.#size;
    if (!v || !(width > 0) || !(height > 0)) return undefined;
    // All four corners: a twisted viewport's view turns the canvas (M6-02 part 15).
    const ps = [
      screenToWorld(v, width, height, { x: 0, y: 0 }),
      screenToWorld(v, width, height, { x: width, y: 0 }),
      screenToWorld(v, width, height, { x: width, y: height }),
      screenToWorld(v, width, height, { x: 0, y: height }),
    ];
    return {
      minX: Math.min(...ps.map((p) => p.x)),
      minY: Math.min(...ps.map((p) => p.y)),
      maxX: Math.max(...ps.map((p) => p.x)),
      maxY: Math.max(...ps.map((p) => p.y)),
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
    const v = this.#pointerView();
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

  /** CONSTRAINTBAR showed or hid bars of the drawing (M9-05 part 2). */
  constraintBarsChanged(): void {
    if (this.#layout) return;
    this.#host.setStyle(this.#style());
    this.#requestFrame();
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
      before.annoAllVisible !== state.annoAllVisible ||
      before.fieldDisplay !== state.fieldDisplay ||
      before.dynConstraints !== state.dynConstraints ||
      before.dynConstraintMode !== state.dynConstraintMode ||
      before.constraintNameFormat !== state.constraintNameFormat ||
      before.dimConstraintIcon !== state.dimConstraintIcon ||
      before.constraintBarMode !== state.constraintBarMode ||
      before.constraintBarDisplay !== state.constraintBarDisplay ||
      before.cbarTransparency !== state.cbarTransparency ||
      before.layLockFade !== state.layLockFade ||
      before.xFade !== state.xFade ||
      before.lwDefault !== state.lwDefault ||
      before.lwScale !== state.lwScale ||
      before.gripSize !== state.gripSize ||
      before.gripColors !== state.gripColors ||
      before.gridStyle !== state.gridStyle
    ) {
      this.#host.setStyle(this.#style());
      this.#requestFrame();
    }
    if (before.tooltip !== state.tooltip) this.#styleTip();
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
    return withOverrides(this.#ownModes(this.#drafting), heldOverrides.active());
  }

  /**
   * The drafting aids with SNAP and GRID of the viewport this canvas works in, which keeps them
   * (M6-02 part 19), else the status bar's own for a drawing with none.
   */
  #ownModes(d: DraftingState): DraftingState {
    const s = this.#snapGrid();
    return s ? { ...d, snap: s.snapOn, grid: s.gridOn } : d;
  }

  /** GRIDMODE of the viewport worked in (M6-02 part 19). */
  #gridOn(): boolean {
    return this.#ownModes(this.#drafting).grid;
  }

  /**
   * SNAPMODE and GRIDMODE of the viewport this canvas works in, and where they are kept (the
   * layout viewport made current, a layout's paper-space viewport, model space's VPORT of this
   * tile); undefined when the drawing has none (M6-02 part 19).
   */
  viewportModes(): ViewportModesShown | undefined {
    const h = this.#snapGridHolder();
    return h && { holder: h.handle, snap: h.state.snapOn, grid: h.state.gridOn };
  }

  /** A temporary override key was pressed or let go: snap and track anew at a point prompt. */
  #overridden(): void {
    if (!this.#prompt || this.#mode !== 'none') return;
    this.#hit = undefined;
    this.#requestSnap();
    this.#track();
  }

  /**
   * The AutoSnap and tracking tooltip as the Drafting Tooltip Appearance sets every drafting
   * tooltip, unless it is set for Dynamic Input's only (M3-06 part 8).
   */
  #styleTip(): void {
    const t = this.#drafting.tooltip;
    const style = this.#tip.style;
    const s = t.all ? tooltipStyle(t, this.#layout !== undefined) : undefined;
    style.background = s?.background ?? '';
    style.color = s?.color ?? '';
    style.fontSize = s?.fontSize ?? '';
    style.opacity = s?.opacity ?? '';
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

  /**
   * The objects to show grips on, and the hot grip (M2-06 part 2); the dimensional constraints
   * selected show theirs (M9-03 part 11).
   */
  setGrips(
    ids: readonly EntityId[],
    hot?: Vec2,
    groups: readonly GroupGrip[] = [],
    constraints: readonly Handle[] = [],
  ): void {
    this.#host.setGrips(ids, hot, groups, constraints);
    this.#gripsHoverable = (ids.length > 0 || groups.length > 0 || constraints.length > 0) && !hot;
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
    // A window being dragged previews what it takes instead (`#areaPreview`).
    if (this.#areaPreviewing) return;
    const d = this.#drafting;
    const atCommand = this.#hooks.atCommand?.() ?? false;
    // Where a pick would select (either of SELECTIONPREVIEW's places), whatever previews.
    const selecting =
      screen && previewsSelection(PREVIEW_AT_COMMAND | PREVIEW_SELECTING, this.#asked, atCommand);
    // Shift+Space's steps last while the cursor stays within the pickbox of where they began.
    const step = this.#overlapStep;
    if (step && (!selecting || Math.hypot(screen.x - step.at.x, screen.y - step.at.y) > d.pickbox))
      this.#overlapStep = undefined;
    const cycle = this.#overlapStep?.step;
    this.#overlapBadge(selecting && d.selectionCycling > 0 ? screen : undefined);
    // A command preview of the object under the pickbox (M3-12 part 6) shows what the pick does
    // in place of the selection preview's highlight, which would hide the faded part.
    const commandPreviews = this.#asked?.commandPreview?.hover === true && d.commandPreview === 1;
    const on =
      selecting &&
      (cycle !== undefined ||
        (!commandPreviews && previewsSelection(d.selectionPreview, this.#asked, atCommand)));
    if (!on && !this.#previewing) return;
    this.#previewing = !!on;
    this.#host.setSelectionPreview(
      on
        ? {
            screen,
            // The view the cursor is over, which the render worker may not have yet (M5-23).
            ...(this.#view && { view: this.#pointerView()! }),
            aperture: d.pickbox,
            filter: d.previewFilter,
            groups: (d.pickStyle & 1) !== 0,
            ...(cycle !== undefined && { cycle }),
          }
        : undefined,
    );
    this.#requestFrame();
  }

  /**
   * COMMANDPREVIEW (M3-12 part 6; AutoCAD 2024 Help, COMMANDPREVIEW): at a prompt with a
   * command preview, what a pick (point) at `cursor` would do, asked of the command engine and
   * drawn when it answers: the objects it changes faded, their new shapes over them. Undefined,
   * or COMMANDPREVIEW 0, takes the preview away.
   */
  #commandPreview(cursor: Point | undefined): void {
    const src = this.#asked?.commandPreview;
    const on =
      src && cursor && this.#mode === 'none' && this.#drafting.commandPreview === 1 && !this.#press;
    if (!on) {
      this.#previewWanted = undefined;
      // An answer still to come is for a cursor gone: it is not drawn.
      this.#previewAsked = this.#previewAsked && { ...this.#previewAsked, prompt: NO_PROMPT };
      this.#showCommandPreview(undefined);
      return;
    }
    this.#previewWanted = { cursor, hover: src.hover === true };
    this.#askPreview();
  }

  /** Asks for the cursor wanted, unless an answer is awaited (the latest is asked next). */
  #askPreview(): void {
    const want = this.#previewWanted;
    const prompt = this.#asked;
    const ask = this.#hooks.onCommandPreview;
    if (!want || !prompt || !ask || this.#previewAsked) return;
    this.#previewWanted = undefined;
    const seq = ++previewSeq;
    this.#previewAsked = { seq, prompt };
    const send = (hits: readonly EntityId[]) => {
      if (this.#previewAsked?.seq !== seq) return;
      ask({ seq, cursor: want.cursor, hits, shift: this.#shift });
    };
    const screen = this.#pointer;
    if (!want.hover) send([]);
    else if (!screen) this.commandPreviewed(seq, undefined);
    else {
      // What a pick there would find: the objects under the pickbox, as a click asks.
      void this.#host
        .hitTest(
          { x: screen.offsetX, y: screen.offsetY },
          this.#drafting.pickbox,
          this.#pointerView(),
        )
        .then(send, () => this.commandPreviewed(seq, undefined));
    }
  }

  /**
   * The command engine's answer to the preview request `seq` (M3-12 part 6): drawn while the
   * prompt it was asked at still waits; another canvas's answer is passed over.
   */
  commandPreviewed(seq: number, preview: CommandPreview | undefined): void {
    const asked = this.#previewAsked;
    if (asked?.seq !== seq) return;
    this.#previewAsked = undefined;
    if (asked.prompt === this.#asked) this.#showCommandPreview(preview);
    this.#askPreview();
  }

  #showCommandPreview(preview: CommandPreview | undefined): void {
    if (!preview && !this.#previewShown) return;
    this.#previewShown = preview !== undefined;
    this.#host.setDrag(preview && { ids: [], m: IDENTITY, preview });
    this.#requestFrame();
  }

  /**
   * The lock by the cursor over a locked table cell (M4-16 part 11), as AutoCAD shows one while
   * the cursor hovers over a locked cell: at `Command:` and at a prompt that asks for it
   * (TABLECELL's options), the engine asked about `world`; undefined takes the lock away.
   */
  #hoverLock(world: Point | undefined): void {
    const asked = this.#asked;
    const on =
      world &&
      this.#hooks.onCellLock &&
      ((this.#hooks.atCommand?.() ?? false) || (asked?.kind === 'point' && asked.cellLocks));
    if (!on) {
      this.#lockWanted = undefined;
      // An answer still to come is for a cursor gone: it is dropped.
      this.#lockAsked = undefined;
      this.#showLock(false);
      return;
    }
    this.#lockWanted = world;
    this.#askLock();
  }

  #askLock(): void {
    const point = this.#lockWanted;
    if (!point || this.#lockAsked !== undefined) return;
    this.#lockWanted = undefined;
    const seq = ++cellLockSeq;
    this.#lockAsked = seq;
    this.#hooks.onCellLock?.({ seq, point });
  }

  /** The engine's answer to lock question `seq` (M4-16 part 11); another canvas's is passed over. */
  cellLocked(seq: number, lock: TableCellLock | undefined): void {
    if (this.#lockAsked !== seq) return;
    this.#lockAsked = undefined;
    // A cursor moved on meanwhile is asked about next, the answer for the old place shown till then.
    this.#showLock(lock !== undefined);
    this.#askLock();
  }

  #showLock(on: boolean): void {
    if (on === this.#lockShown) return;
    this.#lockShown = on;
    this.#paintCursor();
  }

  /**
   * The cursor at `screen` (CSS pixels on the canvas) over the constraint bars at `Command:`
   * (M9-05 part 4): the renderer highlights the icon under it with its constraint's objects, as
   * AutoCAD does while the cursor rests on an icon, and answers what it is, kept for a
   * right-click or Delete; undefined, or another prompt, takes the highlight away.
   */
  #hoverBar(screen: { readonly offsetX: number; readonly offsetY: number } | undefined): void {
    const on = screen && (this.#hooks.atCommand?.() ?? false);
    const seq = ++this.#barSeq;
    if (!on) {
      if (!this.#barHit) return;
      this.#barHit = undefined;
      void this.#host.hoverConstraintBar(undefined);
      this.#requestFrame();
      return;
    }
    const at = { x: screen.offsetX, y: screen.offsetY };
    void this.#host.hoverConstraintBar(at, this.#pointerView()).then((hit) => {
      if (seq === this.#barSeq) this.#barHit = hit ?? undefined;
    });
    this.#requestFrame();
  }

  /**
   * A left press at `Command:` on a constraint bar's panel or icon (M9-05 part 6; AutoCAD 2024
   * Help, "About Displaying and Verifying Geometric Constraints": constraint bars can be dragged):
   * held until the pointer moves or is released. Not a Coincident square, which sits at its point.
   */
  #pressBar(e: PointerEvent, world: Point): boolean {
    const bar = this.#barHit;
    const move = this.#hooks.moveConstraintBar;
    if (bar?.entity === undefined || !move || !(this.#hooks.atCommand?.() ?? false)) return false;
    const key = constraintBarKey(bar.entity, bar.segment);
    this.#barPress = {
      pointer: e.pointerId,
      x: e.offsetX,
      y: e.offsetY,
      key,
      from: this.#hooks.constraintBarMoves?.().get(key),
      world,
      shift: e.shiftKey,
      dragged: false,
    };
    this.canvas.setPointerCapture(e.pointerId);
    return true;
  }

  /** The bar pressed follows the pointer once it moves past a click (M9-05 part 6). */
  #dragBar(e: PointerEvent): boolean {
    const p = this.#barPress;
    if (!p || p.pointer !== e.pointerId) return false;
    const dx = e.offsetX - p.x;
    const dy = e.offsetY - p.y;
    if (!p.dragged && Math.hypot(dx, dy) > CLICK_PX) p.dragged = true;
    if (p.dragged) {
      this.#hooks.moveConstraintBar?.(p.key, {
        x: (p.from?.x ?? 0) + dx,
        y: (p.from?.y ?? 0) + dy,
      });
    }
    this.#pointer = { offsetX: e.offsetX, offsetY: e.offsetY };
    this.#cursorAt(this.#world(e));
    return true;
  }

  /**
   * The press on a bar ends (M9-05 part 6): a drag leaves the bar where it is (put back where it
   * was if the pointer was lost); a click picks where it was pressed, as at any other place.
   */
  #dropBar(e: PointerEvent): void {
    const p = this.#barPress;
    if (!p || p.pointer !== e.pointerId) return;
    this.#barPress = undefined;
    if (p.dragged) {
      if (e.type !== 'pointerup') this.#hooks.moveConstraintBar?.(p.key, p.from);
      return;
    }
    if (e.type !== 'pointerup') return;
    this.#hooks.onPick?.(p.world, { shift: p.shift, release: false, grip: this.gripReach() });
  }

  /** What of the constraint bars the cursor rests on (M9-05 part 4), as last answered. */
  constraintBarHit(): ConstraintBarHit | undefined {
    return this.#barHit;
  }

  /**
   * Selection cycling's badge (M3-04 part 7; AutoCAD 2024 Help, "To Select Overlapping or Close
   * Objects": "the selection cycling badge displays" where objects overlap): shown while more
   * than one object lies under the pickbox at `screen`; undefined hides it.
   */
  #overlapBadge(screen: { readonly x: number; readonly y: number } | undefined): void {
    const asked = ++this.#badgeAsked;
    const hide = () => {
      if (!this.#badgeShown) return;
      this.#badgeShown = false;
      this.#hooks.onOverlap?.(undefined);
    };
    if (!screen) return hide();
    void this.#host.hitTest(screen, this.#drafting.pickbox, this.#pointerView()).then((ids) => {
      if (asked !== this.#badgeAsked) return;
      if (ids.length < 2) return hide();
      const r = this.#canvas.getBoundingClientRect();
      this.#badgeShown = true;
      this.#hooks.onOverlap?.({ x: r.left + screen.x, y: r.top + screen.y });
    });
  }

  /**
   * Shift+Space (M3-04 part 7; AutoCAD 2024 Help, "To Select Overlapping or Close Objects"):
   * where the cursor rests at a prompt that selects, the next of the objects under the pickbox
   * lights up, round again after the last, and a pick there takes it. False when the cursor
   * rests on no such canvas, so the key does what it otherwise would.
   */
  cycleOverlap(): boolean {
    const p = this.#pointer;
    const resting = p && !this.#drag && !this.#corner && !this.#press && this.#mode === 'none';
    if (!resting) return false;
    const at = { x: p.offsetX, y: p.offsetY };
    const atCommand = this.#hooks.atCommand?.() ?? false;
    if (!previewsSelection(PREVIEW_AT_COMMAND | PREVIEW_SELECTING, this.#asked, atCommand))
      return false;
    const was = this.#overlapStep;
    this.#overlapStep = { at: was?.at ?? at, step: (was?.step ?? 0) + 1 };
    this.#hoverPreview(at);
    return true;
  }

  /**
   * The selection window, polygon, fence or lasso being dragged (M3-04 part 6): what `area`
   * would take lights up, when SELECTIONPREVIEW previews at the prompt it is dragged at, unless
   * it takes more than SELECTIONPREVIEWLIMIT or the prompt previews the command instead;
   * undefined, the window is gone.
   */
  #areaPreview(area: SelectQuery | undefined): void {
    const d = this.#drafting;
    // A command preview of what the window (fence) would do takes its place (M3-12 part 7), as
    // it does the pickbox's (part 6): the objects it would trim show faded, not lit up.
    const commandPreviews = this.#asked?.commandPreview !== undefined && d.commandPreview === 1;
    const on = area && !commandPreviews && areaPreviewed(d.selectionPreview, this.#prompt);
    if (!on && !this.#areaPreviewing) return;
    this.#areaPreviewing = !!on;
    this.#previewing = false;
    this.#host.setSelectionPreview(
      on
        ? {
            area,
            limit: d.selectionPreviewLimit,
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
  setHighlight(ids: readonly EntityId[], constraints: readonly Handle[] = []): void {
    this.#host.setHighlight(ids, constraints);
    this.#requestFrame();
  }

  /** The reference edited in place (M5-02 part 5): what fades, how other references draw. */
  setRefEdit(display: RefEditDisplay | undefined): void {
    this.#host.setRefEdit(display);
    this.#requestFrame();
  }

  /**
   * The objects within the pickbox of a world point, nearest first (M2-03). The render worker
   * is told the view the point is shown in with the pick: it gets the canvas's views with its
   * frames, so just after a ZOOM or PAN, while a slow frame is drawn, it still holds the view
   * before and took what was there before (M5-23).
   */
  pick(point: Vec2): Promise<EntityId[]> {
    const v = this.#pointerView();
    if (!v) return Promise.resolve([]);
    const screen = worldToScreen(v, this.#size.width, this.#size.height, point);
    // PICKBOX (M3-04 part 4): the pickbox's half size in CSS pixels, AutoCAD's initial 3.
    const pickbox = this.#drafting.pickbox;
    // Shift+Space stepped through the objects here (M3-04 part 7): the pick takes the one lit
    // up, alone, so no Selection list asks again. The steps end with the pick.
    const step = this.#overlapStep;
    if (step) {
      this.#overlapStep = undefined;
      this.#previewAgain();
      if (Math.hypot(screen.x - step.at.x, screen.y - step.at.y) <= pickbox) {
        return this.#host
          .hitTest(step.at, pickbox, v)
          .then((ids) => (ids.length > 1 ? [ids[step.step % ids.length]!] : ids));
      }
    }
    return this.#host.hitTest(screen, pickbox, v);
  }

  /**
   * The dimensional constraint drawn within the pickbox of a world point (M9-03 part 10), in
   * the view the pointer works in, as `pick` takes objects.
   */
  constraintAt(point: Vec2): Promise<Handle | undefined> {
    const v = this.#pointerView();
    if (!v) return Promise.resolve(undefined);
    const screen = worldToScreen(v, this.#size.width, this.#size.height, point);
    return this.#host.constraintAt(screen, this.#drafting.pickbox, v).then((h) => h ?? undefined);
  }

  /**
   * What a pick at a world point hit inside the block reference `id` (M5-06 part 5: the layer
   * tools' nested picks), within the pickbox; undefined where it hit none of its contents.
   */
  pickNested(point: Vec2, id: EntityId): Promise<NestedPick | undefined> {
    const v = this.#pointerView();
    if (!v) return Promise.resolve(undefined);
    const screen = worldToScreen(v, this.#size.width, this.#size.height, point);
    return this.#host.nestedHit(screen, this.#drafting.pickbox, id, v).then((h) => h ?? undefined);
  }

  /** Where a world point is shown, in window pixels (M3-04 part 3: the Selection list). */
  clientOf(point: Vec2): Vec2 | undefined {
    const v = this.#pointerView();
    if (!v) return undefined;
    const s = worldToScreen(v, this.#size.width, this.#size.height, point);
    const r = this.#canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }

  /**
   * The world point shown at window pixels `client`, undefined off the canvas (M5-11: where an
   * item dragged from DesignCenter was dropped).
   */
  worldOfClient(client: Vec2): Vec2 | undefined {
    const v = this.#pointerView();
    if (!v) return undefined;
    const r = this.#canvas.getBoundingClientRect();
    const x = client.x - r.left;
    const y = client.y - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return undefined;
    return screenToWorld(v, this.#size.width, this.#size.height, { x, y });
  }

  /** The objects a selection window between two world points takes (M2-03). */
  selectWindow(a: Vec2, b: Vec2, crossing: boolean): Promise<EntityId[]> {
    // Square to the screen in a twisted layout viewport (M6-02 part 15).
    return this.#host.select(windowArea(a, b, crossing, this.#pointerView()?.rotation ?? 0));
  }

  /** What a selection polygon (WPolygon, CPolygon) or fence takes (M3-04). */
  selectPath(points: readonly Vec2[], kind: 'window' | 'crossing' | 'fence'): Promise<EntityId[]> {
    return this.#host.select(pathArea(points, kind));
  }

  /** ZOOM Object: the objects' extents fill the window; false when none has a known extent. */
  async zoomObjects(ids: readonly EntityId[]): Promise<boolean> {
    const found = await this.#host.boundsOf(ids);
    if (!found || !(this.#size.width > 0)) return false;
    const z = this.#zoomable();
    if (z) {
      const fit = fitTurned(this.#frameTurn(z), (t) =>
        fitView(turnedBox(found, t), z.frame.size.width, z.frame.size.height, 0),
      )!;
      const flat = found.maxX === found.minX && found.maxY === found.minY;
      const now = frameView(z.c.geom, z.frame.size);
      this.#goViewport(z, flat ? { ...fit, scale: now.scale } : fit, 'ZOOM');
      return true;
    }
    const a = this.#toSheet({ x: found.minX, y: found.minY });
    const b = this.#toSheet({ x: found.maxX, y: found.maxY });
    const box = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
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

  /** The TEXT runs and strokes MTEXTs explode into (M3-12 part 7: EXPLODE of MTEXT). */
  textPieces(texts: readonly MTextGeometry[]): Promise<(readonly TextPiece[] | null)[]> {
    return this.#host.textPieces(texts);
  }

  /** The frames MTEXTs are laid out in (M4-09: JUSTIFYTEXT and SCALETEXT). */
  textFrames(
    texts: readonly MTextGeometry[],
  ): Promise<({ readonly width: number; readonly height: number } | null)[]> {
    return this.#host.textFrames(texts);
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
    canvas.dataset['space'] = this.#canvas.dataset['space'];
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
    const snapGrid = this.#snapGridKey();
    this.#followViewport(change);
    this.#followPaperViewport(change);
    // The layout renamed or given a new page setup or limits (M1-97): its sheet frames ZOOM
    // Extents and All from now on, and the canvas takes its new name.
    const layout = this.#layout;
    const after =
      layout && change.layouts?.updated?.find((u) => u.after.handle === layout.handle)?.after;
    if (after) {
      this.#layout = after;
      this.#canvas.setAttribute('aria-label', `Layout ${after.name}`);
    }
    // The snap and grid spacing or behaviour, or the limits a grid may stay within (M3-06
    // part 6), changed: the grid shows them.
    const limits = this.#followHeader(change);
    // The snap and grid settings of the viewport worked in, a layout viewport's or paper
    // space's own (M6-02 part 17), changed: SNAPANG turns the crosshairs.
    const vports = this.#followVports(change) || this.#snapGridKey() !== snapGrid;
    if (vports) this.#showUcsIcon();
    if (vports || (limits && this.#gridOn())) this.#host.setStyle(this.#style());
    // Its SNAP or GRID turned (M6-02 part 19): the status bar shows them.
    if (vports) this.#hooks.onViewportModes?.(this.viewportModes());
    // Drawn now rather than on the next animation frame, so `flush` resolves once the change
    // is on screen (the palette measures toggle → canvas, M1-23). The view is sent only when it
    // is not the one the renderer has: setting a view redraws the whole scene, and a render
    // worker that took the change from the engine (M2-62) has drawn it already, so this frame
    // only shows what it drew.
    if (this.#view && this.#size.width > 0) {
      if (this.#view !== this.#sentView) this.#sendView(this.#view);
      this.#host.frame();
    }
  }

  /**
   * The current viewport moved, resized or zoomed by a change (an undo, M6-02 part 3): the
   * cursor follows its view; erased or turned off, the layout is worked in on paper again, as
   * the engine works in it (`floatingViewport`).
   */
  #followViewport(change: ChangeSet): void {
    const c = this.#current;
    if (!c) return;
    if (change.entities?.removed?.some((r) => r.entity.handle === c.handle)) {
      this.setViewport(undefined, undefined);
      return;
    }
    const after = change.entities?.updated?.find((u) => u.after.handle === c.handle)?.after;
    if (after?.geom.kind !== 'VIEWPORT') return;
    if (!workableViewport(after.geom)) return this.setViewport(undefined, undefined);
    if (this.#maximized) {
      // Still framed by the canvas, showing what it shows (a VPLAYER edit, say).
      const { center, width, height, viewCenter, viewHeight } = c.geom;
      c.geom = { ...after.geom, center, width, height, viewCenter, viewHeight };
      this.#host.setActiveViewport(c.handle, c.geom);
      return;
    }
    // While the canvas's own view edits are on their way, its view is the newest.
    c.geom =
      this.#viewportEdits > 0
        ? { ...after.geom, viewCenter: c.geom.viewCenter, viewHeight: c.geom.viewHeight }
        : after.geom;
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

  /** Where its renderer runs, and its frames' times and scene size (the diagnostics panel, M7-08). */
  get rendererMode(): 'worker' | 'main' {
    return this.#host.mode;
  }

  stats(): Promise<RenderStats> {
    return this.#host.stats();
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
    // A tile's container outlives its canvas when -VPORTS rearranges the tiles (M6-02 part 13):
    // its quick measure labels and UCS icon go with the canvas, not left on the new one.
    this.#quickLabels.remove();
    this.#ucsIcon.remove();
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

  /** Keeps the layout's paper-space viewport as `change` leaves it (M6-02 part 17). */
  #followPaperViewport(change: ChangeSet): void {
    if (!this.#layout) return;
    const p = this.#paperViewport;
    const e = change.entities;
    if (p && e?.removed?.some((r) => r.entity.handle === p.handle)) this.#paperViewport = undefined;
    for (const a of [
      ...(e?.added ?? []).map((x) => x.entity),
      ...(e?.updated ?? []).map((u) => u.after),
    ]) {
      if (a.owner !== this.block || a.geom.kind !== 'VIEWPORT' || a.geom.id !== 1) continue;
      this.#paperViewport = { handle: a.handle, geom: a.geom };
    }
  }

  /** The snap and grid settings shown, as text: what `apply` tells a change of them by. */
  #snapGridKey(): string {
    return JSON.stringify(this.#snapGrid() ?? null);
  }

  /** Keeps the VPORT records `change` edits; true when it edited any. */
  #followVports(change: ChangeSet): boolean {
    const v = change.tables?.vports;
    for (const r of [...(v?.added ?? []), ...(v?.updated ?? []).map((u) => u.after)])
      this.#vports.set(r.handle, r);
    return (v?.added?.length ?? 0) + (v?.updated?.length ?? 0) > 0;
  }

  /**
   * Keeps the header as `change` leaves it; true when the grid may follow what changed: model
   * space's limits, or a UCS (M3-06 part 7), which the UCS icon follows too.
   */
  #followHeader(change: ChangeSet): boolean {
    let limits = false;
    let ucs = false;
    for (const h of change.header ?? []) {
      if (h.after === undefined) this.#header.delete(h.name);
      else this.#header.set(h.name, h.after);
      if (h.name === '$LIMMIN' || h.name === '$LIMMAX') limits = true;
      if (/^\$P?UCS(ORG|XDIR|YDIR)$/.test(h.name)) ucs = true;
    }
    if (ucs) this.#showUcsIcon();
    return limits || ucs;
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
   * layout with its whole sheet in view (`#opening`), as does the Block Editor's block.
   */
  #savedView(): ViewTransform | undefined {
    // The Block Editor's block (M5-02) has no saved view: it opens at its extents.
    if (!this.#layout && this.block !== this.#opened.modelSpace) return undefined;
    return this.#layout
      ? paperSpaceView(paperSpaceViewport(this.#opened.init.entities, this.block), this.#size)
      : // As edited: -VPORTS writes the view each new tile starts with (M6-02 part 10).
        savedModelView(this.#vport(), this.#size);
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
    return this.#modelLimits();
  }

  /** Model space's limits: the header's LIMMIN and LIMMAX. */
  #modelLimits(): Box | undefined {
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

  /**
   * The crosshairs in their colour as the canvas's cursor (styles.css reads `--crosshair`),
   * turned with the UCS and SNAPANG (M3-06 part 8; AutoCAD 2024 Help, "SNAPANG": "The
   * crosshairs ... are rotated"). Painted again only when the colour or the angle changes.
   */
  #paintCursor(): void {
    const color = this.#ui().crosshair;
    // A twisted layout viewport made current turns them with model space (M6-02 part 15).
    const angle =
      this.#ucs().angle +
      (this.#snapGrid()?.snapRotation ?? 0) +
      (this.#pointerView()?.rotation ?? 0);
    const asked = this.#asked;
    const badge =
      (asked?.kind === 'selection' ? asked.cursor : undefined) ??
      (this.#lockShown ? 'lock' : undefined);
    const key = `${color} ${angle}${badge ? ` ${badge}` : ''}`;
    if (this.#canvas.dataset['cursor'] === key) return;
    this.#canvas.dataset['cursor'] = key;
    this.#canvas.style.setProperty('--crosshair', crosshairCursor(color, angle, badge));
  }

  #style(): RenderStyle {
    const lw = this.#header.get('$LWDISPLAY');
    // LWT and TPY from the status bar (M2-04 part 2): LWT is the drawing's until turned.
    const d = this.#drafting;
    const showLineweights = d.lwt ?? (lw === true || lw === 1);
    const c = this.#colours;
    const shared = {
      showLineweights,
      // LWDEFAULT and Adjust Display Scale (M5-08 part 3).
      lineweightDefault: d.lwDefault,
      lineweightScale: d.lwScale,
      selection: c.selection,
      ...(!d.tpy && { showTransparency: false }),
      // ANNOALLVISIBLE 0 (M6-03): the Model tab hides annotative objects not at its scale.
      ...(!d.annoAllVisible && { annotationAllVisible: false }),
      // FIELDDISPLAY (M4-10 part 3): the fields' grey background.
      ...(!d.fieldDisplay && { showFields: false }),
      // LAYLOCKFADECTL (M5-06): how faded objects on locked layers are drawn.
      layLockFade: d.layLockFade,
      // XFADECTL (M5-02 part 5): how faded what is not in REFEDIT's working set is drawn.
      xFade: d.xFade,
      gripSize: d.gripSize,
      gripColors: d.gripColors,
      ...(this.#gridOn() && { grid: { ...this.#grid(), ...(c.grid && { color: c.grid }) } }),
    };
    const background = this.#layout ? c.paper : c.model;
    return {
      background,
      foreground: foregroundOn(background),
      // Dimensional constraints (M9-03 part 4): Show Dynamic Constraints, DYNCONSTRAINTMODE and
      // CONSTRAINTNAMEFORMAT; dynamic ones in a blue that reads on the background. Their lock
      // icons, DIMCONSTRAINTICON (M9-05 part 9).
      constraints: {
        dynamic: d.dynConstraints,
        showSelected: d.dynConstraintMode,
        nameFormat: d.constraintNameFormat,
        lockIcon: d.dimConstraintIcon,
        color: isDarkColor(background) ? CONSTRAINT_COLOR.dark : CONSTRAINT_COLOR.light,
      },
      // Constraint bars (M9-05 part 2): those CONSTRAINTBAR hid, CONSTRAINTBARMODE's kinds,
      // CONSTRAINTBARDISPLAY bit 2 and CBARTRANSPARENCY.
      constraintBars: {
        hidden: this.#hooks?.constraintBars?.() ?? new Set<string>(),
        moved: this.#hooks?.constraintBarMoves?.() ?? new Map<string, { x: number; y: number }>(),
        mode: d.constraintBarMode,
        showSelected: (d.constraintBarDisplay & 2) !== 0,
        transparency: d.cbarTransparency,
        panel: isDarkColor(background) ? CONSTRAINT_BAR_PANEL.dark : CONSTRAINT_BAR_PANEL.light,
      },
      // A layout's viewports show model space's UCS icon (M3-06 part 8).
      ...(this.#layout && { layoutBackground: c.surround, viewportUcsIcons: true }),
      ...shared,
    };
  }

  /**
   * GRIDUNIT and GRIDMAJOR of the viewport shown (10 × 10 and 5 when it has none), drawn as its
   * GRIDDISPLAY and GRIDSTYLE say (M3-06 part 6).
   */
  #grid(): GridSpec {
    const vport = this.#snapGrid();
    const g = vport?.gridSpacing;
    const s = this.#snapSpacing();
    // A GRIDUNIT of 0 follows the snap spacing, as AutoCAD's does.
    const spacing = g && g.x > 0 && g.y > 0 ? g : s;
    const display = gridDisplayOf({
      flags: vport?.gridFlags,
      limits: this.#layout ? undefined : this.#limits(),
      // Through a layout viewport made current the grid is model space's (M6-02 part 9).
      layout: this.#layout !== undefined && !this.#current,
      gridStyle: this.#drafting.gridStyle,
    });
    // The grid runs along the UCS's axes turned by SNAPANG, from the snap base, which is a UCS
    // point (M3-06 part 7; AutoCAD 2024 Help, "SNAPANG", "SNAPBASE").
    const ucs = this.#ucs();
    const angle = ucs.angle + (vport?.snapRotation ?? 0);
    const base = toWorld(ucs, vport?.snapBase ?? { x: 0, y: 0 });
    return {
      spacing,
      ...((base.x !== 0 || base.y !== 0) && { base }),
      ...(angle !== 0 && { angle }),
      major: vport?.gridMajor && vport.gridMajor > 0 ? vport.gridMajor : 5,
      ...display,
    };
  }

  /** The current UCS of the space shown: model space's, or the layout's paper space's. */
  #ucs(): PlanUcs {
    // Model space's UCS while a layout viewport is current (MSPACE, M6-02 part 3), or the
    // viewport's own while its UCSVP is on (M6-02 part 20).
    if (this.#current) return viewportUcs(this.#current.geom, ucsOf(this.#header, false));
    return ucsOf(this.#header, this.#layout !== undefined);
  }

  /** Tells the cursor's point, in a viewport's own UCS when one keeps it (M6-02 part 20). */
  #cursorAt(p: Vec2 | undefined): void {
    const own = this.#current?.geom.ucsPerViewport ? this.#ucs() : undefined;
    this.#hooks.onCursor(p, own);
  }

  /**
   * The UCS icon (M3-06 part 7; AutoCAD 2024 Help, "UCSICON"): the X and Y axes' arrows turned as
   * the current UCS's, with a square at their corner in the WCS. UCSICON's bits are the viewport's
   * (DXF 74): 1 shows it, 2 puts it at the UCS origin while the origin is on the canvas with
   * room for it, else it sits in the lower-left corner. A layout's icon shows its paper space's
   * UCS, with its paper-space viewport's bits (on without one).
   */
  #showUcsIcon(): void {
    // The UCS or SNAPANG may have turned: the crosshairs follow them (once the canvas exists:
    // the constructor replays the drawing's changes before it makes it).
    const icon = this.#ucsIcon as HTMLDivElement | undefined;
    if (!icon) return;
    this.#paintCursor();
    // A layout's is its paper-space viewport's (DXF 90 bits 32 and 64, M6-02 part 19).
    const bits = this.#layout
      ? this.#paperViewport
        ? viewportSnapGrid(this.#paperViewport.geom).ucsIcon
        : 1
      : (this.#vport()?.ucsIcon ?? 1);
    const { width, height } = this.#size;
    if (!(bits & 1) || width === 0 || !this.#view) {
      icon.hidden = true;
      return;
    }
    const ucs = this.#ucs();
    // The arms may point any way, so the corner keeps an arm's length from every edge.
    const room = UCS_ICON_ARM + UCS_ICON_MARGIN;
    let corner = { x: room, y: height - room };
    if (bits & 2) {
      const o = worldToScreen(this.#view, width, height, ucs.origin);
      if (o.x >= room && o.x <= width - room && o.y >= room && o.y <= height - room) corner = o;
    }
    const world = ucs.angle === 0 && ucs.origin.x === 0 && ucs.origin.y === 0;
    const key = `${corner.x},${corner.y},${ucs.angle},${world}`;
    icon.hidden = false;
    icon.style.left = `${corner.x - UCS_ICON_ARM}px`;
    icon.style.top = `${corner.y - UCS_ICON_ARM}px`;
    if (icon.dataset['key'] === key) return;
    icon.dataset['key'] = key;
    icon.dataset['world'] = String(world);
    icon.style.color = foregroundOn(this.#layout ? this.#colours.paper : this.#colours.model);
    icon.innerHTML = ucsIconSvg(ucs.angle, world);
  }

  /** The `*Active` VPORT of model space, or this tile's, as edited; none in a layout. */
  #vport(): VportRecord | undefined {
    if (this.#layout) return undefined;
    return this.#modelVport();
  }

  /** The `*Active` VPORT of model space, or this tile's, as edited. */
  #modelVport(): VportRecord | undefined {
    const opened = this.#hooks.tile
      ? this.#hooks.tile.vport
      : activeVport(this.#opened.init.tables?.vports);
    return opened && (this.#vports.get(opened.handle) ?? opened);
  }

  /**
   * The snap and grid settings of the viewport worked in (M6-02 part 17), as the engine edits
   * them (`snapGridHolder`): the layout viewport made current, else a layout's paper-space
   * viewport, else model space's `*Active` VPORT (or this tile's), which also stands in for a
   * layout with no paper-space viewport yet. Undefined when there is none: 10 × 10 applies.
   */
  #snapGrid(): SnapGridState | undefined {
    return this.#snapGridHolder()?.state;
  }

  /** `#snapGrid`'s, with the handle of the VIEWPORT or VPORT record keeping them. */
  #snapGridHolder(): { handle: Handle; state: SnapGridState } | undefined {
    const at = this.#current ?? (this.#layout ? this.#paperViewport : undefined);
    if (at) return { handle: at.handle, state: viewportSnapGrid(at.geom) };
    const v = this.#modelVport();
    return v && { handle: v.handle, state: v };
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    // A hidden tab's canvas measures 0: keep its view until it shows again.
    if (width === 0 || height === 0) return;
    if (width === this.#size.width && height === this.#size.height) return;
    this.#size = { width, height };
    this.#showUcsIcon();
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
    this.#refitMaximized();
    this.#viewed();
    this.#requestFrame();
    this.#showUcsIcon();
    // Quick's values sit on the screen where what they measure was: measured again.
    if (this.#quick) this.#requestQuick();
    // The point under a cursor that has not moved is another one now: the status bar (and a
    // prompt's rubber band) follow it, as the cursor that came onto the canvas before there was
    // a view (a layout's first, M2-37) showed no coordinates until it next moved.
    const hovered = this.#pointer && !this.#drag && this.#canvas.matches(':hover');
    if (hovered && this.#prompt && this.#mode === 'none') this.#track();
    else {
      if (hovered) this.#cursorAt(this.#world(this.#pointer!));
      // The current vertex's marker keeps its size in pixels (M2-35 part 8).
      if (this.#vertexMark) this.#rubberBand(undefined);
    }
  }

  /**
   * Gives the renderer `view`, with the frame about to be sent. Until then the renderer has the
   * view before, and what it found under the cursor meanwhile (the selection preview's pickbox,
   * a rest's pick) it found under that one: a frame with raster images can keep the new view
   * from it a while (M1-60), and image-attach.spec.ts saw an image lit up and named by a
   * rollover tooltip by a cursor resting over nothing (M5-20). Both are read again here, after
   * the view in the renderer's queue.
   */
  #sendView(view: ViewTransform): void {
    const changed = view !== this.#sentView;
    this.#host.setView(view);
    this.#sentView = view;
    if (!changed) return;
    const hovered = this.#pointer && !this.#drag && this.#canvas.matches(':hover');
    if (!hovered) return;
    // A rest reported, or about to be, starts again: its tooltip goes and is asked again.
    this.#rest.again();
    // The pickbox shown lights up what is under it now; a wheel roll, which turned it off,
    // leaves it off until the cursor moves.
    if (!this.#previewing) return;
    this.#sending = true;
    try {
      this.#previewAgain();
    } finally {
      this.#sending = false;
    }
  }

  #requestFrame(): void {
    // One frame per animation frame however many wheel or pointer events arrive.
    if (this.#pending || this.#sending) return;
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
      this.#sendView(this.#view);
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
    const v = this.#pointerView();
    if (!v) return undefined;
    const { width, height } = this.#size;
    return screenToWorld(v, width, height, { x: e.offsetX, y: e.offsetY });
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
  #rubberBand(at: Point | undefined): void {
    const p = this.#prompt;
    // Ctrl held at a grip mode that has placed a copy: the cursor snaps to that copy's offset or
    // angle (M3-05 part 6), as the click will.
    const cursor = at && this.#ctrl && p?.offsetSnap ? offsetSnapPoint(p.offsetSnap, at) : at;
    // A command preview at a point prompt follows the point the drafting aids make (M3-12 part
    // 6); one by the object under the pickbox follows the pointer instead.
    if (!this.#asked?.commandPreview?.hover) this.#commandPreview(cursor);
    // The objects the prompt drags follow the cursor as the drafting aids place it (M2-06).
    const ctrl = this.#ctrl && (p?.switchDirection === true || p?.ctrlSizesTable === true);
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
    // TRIM's freehand fence being dragged (M3-12 part 6): drawn as a fence is.
    const free = this.#freehand();
    if (free && cursor && this.#mode === 'none') {
      this.#host.setTransient([
        ...preview,
        ...this.#selectionPath([...free, cursor], true, false),
        ...this.#vertexMarker(),
      ]);
      this.#requestFrame();
      return;
    }
    const from = p?.kind === 'point' ? p.rubberBand?.from : p && 'base' in p ? p.base : undefined;
    const box = p?.kind === 'point' && p.rubberBand?.box;
    const selection = p?.kind === 'point' ? p.rubberBand?.selection : undefined;
    if (from && cursor && selection && this.#mode === 'none') {
      const turn = this.#pointerView()?.rotation ?? 0;
      const crossing = selection === 'auto' ? leftOf(from, cursor, turn) : selection === 'crossing';
      const lasso = this.#lasso();
      const path =
        lasso && lasso.points.length > 1
          ? { points: lasso.points, open: lasso.kind === 'fence' }
          : p?.kind === 'point'
            ? p.rubberBand?.path
            : undefined;
      const kind = lasso ? lasso.kind : path?.open ? 'fence' : crossing ? 'crossing' : 'window';
      this.#areaPreview(
        path && path.points.length > 0
          ? pathArea([...path.points, cursor], kind)
          : windowArea(from, cursor, crossing, turn),
      );
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
    this.#areaPreview(undefined);
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
      ...this.#promptGrips(at),
    ]);
    this.#requestFrame();
  }

  /**
   * The grips a point prompt shows that are no object's (TABLECELL's cell grips, M4-05 part 6),
   * drawn as object grips are: GRIPSIZE squares in GRIPCOLOR with a GRIPCONTOUR edge, the one
   * the cursor is on in GRIPHOVER.
   */
  #promptGrips(cursor: Point | undefined): RenderPrimitive[] {
    const p = this.#asked;
    if (p?.kind !== 'point' || !p.grips || !this.#view) return [];
    const px = this.#px();
    const half = gripHalfSize(this.#drafting.gripSize) * px;
    const colours = this.#drafting.gripColors;
    const hex = (aci: number) => rgbHex(aciRgb(aci));
    const hover = cursor && this.#promptGripAt(cursor);
    const square = (q: Vec2, h: number): number[] => [
      PATH_M,
      q.x - h,
      q.y - h,
      PATH_L,
      q.x + h,
      q.y - h,
      PATH_L,
      q.x + h,
      q.y + h,
      PATH_L,
      q.x - h,
      q.y + h,
      PATH_Z,
    ];
    return p.grips.flatMap((q): RenderPrimitive[] => [
      { kind: 'fill', path: square(q, half + px), color: hex(colours.contour) },
      {
        kind: 'fill',
        path: square(q, half),
        color: hex(hover === q ? colours.hover : colours.unselected),
      },
    ]);
  }

  /** The grip of the point prompt's own (`#promptGrips`) a click at `world` is on, if any. */
  #promptGripAt(world: Vec2): Vec2 | undefined {
    const p = this.#asked;
    if (p?.kind !== 'point' || !p.grips) return undefined;
    let best: Vec2 | undefined;
    let reach = this.gripReach();
    for (const q of p.grips) {
      const d = Math.hypot(q.x - world.x, q.y - world.y);
      if (d <= reach) {
        best = q;
        reach = d;
      }
    }
    return best;
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
      const step = DASH_PX / (this.#pointerView()?.scale ?? 1);
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
    // Square to the screen, which a twisted layout viewport turns (M6-02 part 15).
    const corners = windowCorners(a, b, this.#pointerView()?.rotation ?? 0).map(
      (p): [number, number] => [p.x, p.y],
    );
    const outline = [...corners.flatMap(([x, y], i) => [i === 0 ? PATH_M : PATH_L, x, y]), PATH_Z];
    let edge = outline;
    const scale = this.#pointerView()?.scale ?? 1;
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
      // The dragged arc switches (M3-01 part 6), or the copy snaps to the offset (M3-05 part 6).
      const redrag =
        this.#prompt?.switchDirection || this.#prompt?.offsetSnap || this.#prompt?.ctrlSizesTable;
      if (redrag && this.#pointer && this.#mode === 'none') this.#track();
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
    // Delete with the cursor resting on a constraint bar's icon deletes its constraint (M9-05
    // part 4), unless it edits text typed somewhere (the command line's, a palette's field).
    window.addEventListener(
      'keydown',
      (e) => {
        const bar = this.#barHit;
        if (e.key !== 'Delete' || e.ctrlKey || e.altKey || e.metaKey || !bar?.constraint) return;
        if (!this.#canvas.matches(':hover') || typesText(e.target)) return;
        e.preventDefault();
        this.#hooks.onConstraintDelete?.(bar);
        this.#hoverBar(undefined);
      },
      opts,
    );
    window.addEventListener('blur', () => (this.#shift = false), opts);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#rest.cancel();
        this.#hoverPreview(undefined);
        this.#hoverBar(undefined);
        if (!this.#view) return;
        // The wheel zooms the viewport under the cursor, which becomes current (as a press
        // would), so the navigation bar then acts on the viewport just zoomed.
        this.#activate();
        const factor = wheelFactor(e.deltaY, e.deltaMode);
        const z = this.#zoomable();
        if (z) {
          // The current layout viewport's own view zooms about the model point under the
          // cursor; a roll is one step, as on the sheet.
          const join = e.timeStamp - this.#lastWheel <= WHEEL_GESTURE_MS;
          this.#lastWheel = e.timeStamp;
          const at = { x: e.offsetX - z.frame.left, y: e.offsetY - z.frame.top };
          const now = frameView(z.c.geom, z.frame.size);
          this.#goViewport(z, zoomAt(now, z.frame.size, at, factor), 'ZOOM', { join });
          this.#cursorAt(this.#world(e));
          return;
        }
        // One roll is one ZOOM Previous view and one undo step, which UNDO Control Combine
        // joins to the zooms and pans next to it (M2-47 part 4).
        if (e.timeStamp - this.#lastWheel > WHEEL_GESTURE_MS) {
          this.#history.push(this.#view);
          this.#step('ZOOM');
        }
        this.#lastWheel = e.timeStamp;
        this.#setView(zoomAt(this.#view, this.#size, { x: e.offsetX, y: e.offsetY }, factor));
        this.#cursorAt(this.#world(e));
      },
      { ...opts, passive: false },
    );
    c.addEventListener(
      'pointerdown',
      (e) => {
        this.#rest.cancel();
        // A press in a viewport that is not current makes it current; AutoCAD takes the
        // left-button click that does so for nothing else.
        // At a prompt for a viewport (-VPORTS Join) the click answers instead (M6-02 part 13).
        const picksTile = e.button === 0 && this.#picksViewport();
        if (!picksTile && this.#activate() && e.button === 0) return;
        if (e.button === 0 && this.#viewportPress(e)) return;
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
          if (this.#pressBar(e, world)) return;
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
          // At a point prompt the click gives the point the drafting aids make of it; outside the
          // viewport worked in, which it switches from, the point clicked.
          this.#ctrl = e.ctrlKey;
          this.#hooks.onPick?.(this.#outside ? world : this.#pointAt(world), {
            shift,
            release: false,
            ...(e.ctrlKey && { ctrl: true }),
            answer: true,
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
        if (this.#dragBar(e)) return;
        const drag = this.#drag;
        if (drag && drag.pointer === e.pointerId && this.#view) {
          // A press that never moves the view is no undo step.
          const join = drag.moved;
          const z = this.#zoomable();
          if (!drag.moved && (e.clientX !== drag.x || e.clientY !== drag.y)) {
            drag.moved = true;
            if (!z) this.#step(drag.zoom ? 'ZOOM' : 'PAN');
          }
          const factor = realtimeZoomFactor(e.clientY - drag.y, this.#size.height);
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          if (z) {
            // The current layout viewport's own view: one ZOOM or PAN step per drag.
            const now = frameView(z.c.geom, z.frame.size);
            const next = drag.zoom ? scaleView(now, factor) : panBy(now, dx, dy);
            if (dx !== 0 || dy !== 0)
              this.#goViewport(z, next, drag.zoom ? 'ZOOM' : 'PAN', { join });
          }
          // Real-time ZOOM is about the window's centre, as AutoCAD's.
          else this.#setView(drag.zoom ? scaleView(this.#view, factor) : panBy(this.#view, dx, dy));
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        this.#pointer = { offsetX: e.offsetX, offsetY: e.offsetY };
        this.#ctrl = e.ctrlKey;
        this.#shift = e.shiftKey;
        this.#leftWork(this.#isOutside());
        const outside = this.#outside;
        // A rest is the cursor alone: not while a button is held, a window, PAN or ZOOM goes on.
        if (e.buttons === 0 && !this.#drag && !this.#corner && this.#mode === 'none' && !outside) {
          this.#rest.move({ x: e.clientX, y: e.clientY, offsetX: e.offsetX, offsetY: e.offsetY });
        } else this.#rest.cancel();
        const press = this.#press;
        const world = this.#world(e);
        const resting =
          e.buttons === 0 && !this.#drag && !this.#corner && this.#mode === 'none' && !outside;
        this.#hoverGrip(resting ? world : undefined);
        this.#hoverPreview(resting ? { x: e.offsetX, y: e.offsetY } : undefined);
        this.#hoverLock(resting ? world : undefined);
        this.#hoverBar(resting && this.#mode === 'none' ? this.#pointer : undefined);
        // A preview by the object under the pickbox follows the cursor itself (M3-12 part 6).
        if (this.#asked?.commandPreview?.hover) this.#commandPreview(resting ? world : undefined);
        if (press?.pointer === e.pointerId) {
          if (Math.hypot(e.offsetX - press.x, e.offsetY - press.y) > CLICK_PX && !press.dragged) {
            press.dragged = true;
            // Without PICKAUTO's bit 4 the drag makes the rectangular window it began.
            if (this.#drafting.pickauto & PICKAUTO_LASSO)
              press.lasso = e.offsetX < press.x ? 'crossing' : 'window';
            // With bit 2 a press that picked an object at `Command:` starts a window there; the
            // engine knows whether it did (a press on a grip or on nothing is left alone).
            if (this.#drafting.pickauto & PICKAUTO_DRAG && !this.#precise()) {
              this.#hooks.onPick?.(press.path[0]!, {
                shift: e.shiftKey,
                release: false,
                dragged: true,
              });
            }
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
        this.#cursorAt(world);
      },
      opts,
    );
    const endDrag = (e: PointerEvent) => {
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this.#dropBar(e);
      if (this.#drag?.pointer === e.pointerId) this.#drag = undefined;
      // A window dragged out ends on release; one clicked waits for the second click.
      const world = this.#world(e);
      if (e.button === 0 && this.#corner?.dragged && world) this.#finishWindow(world);
      // A drag begun with a click at the command engine ends its selection window, or lasso.
      const press = this.#press;
      if (press?.pointer === e.pointerId) {
        const lasso = this.#lasso();
        const free = this.#freehand();
        this.#press = undefined;
        if (press.shown) this.#hooks.onLasso?.(undefined);
        if (press.dragged && world && e.type === 'pointerup') {
          this.#hooks.onPick?.(world, {
            shift: e.shiftKey,
            release: true,
            ...(lasso && { lasso: { kind: lasso.kind, points: [...lasso.points, world] } }),
            ...(free && { freehand: [...free, world] }),
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
        this.#commandPreview(undefined);
        this.#hoverLock(undefined);
        this.#hoverBar(undefined);
        this.#pointer = undefined;
        this.#leftWork(false);
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
        this.#cursorAt(undefined);
      },
      opts,
    );
    c.addEventListener('auxclick', (e) => e.preventDefault(), opts);
    // A double click edits the object under it (M2-07 part 2).
    c.addEventListener(
      'dblclick',
      (e) => {
        if (e.button !== 0 || this.#mode !== 'none') return;
        // One begun outside the current viewport switches viewports, or goes to paper space,
        // and edits nothing (M6-02 part 9).
        const outside = this.#outsideDouble(e, 2 * DOUBLE_CLICK_MS);
        if (outside) {
          this.#outsidePress = undefined;
          this.#hooks.onDoubleClick?.(outside.paper, true);
          return;
        }
        const world = this.#world(e);
        if (world) this.#hooks.onDoubleClick?.(world);
      },
      opts,
    );
    // Shift+right-click: AutoCAD's object snap menu, at a point prompt (M2-04 part 2); a plain
    // right-click the prompt's shortcut menu, where it has one (M3-05 part 5).
    c.addEventListener(
      'contextmenu',
      (e) => {
        if (this.#mode !== 'none') return;
        // A constraint bar's icon at `Command:` (M9-05 part 4): its own shortcut menu.
        const bar = this.#barHit;
        if (
          !e.shiftKey &&
          bar &&
          this.#hooks.onConstraintBarMenu?.({ x: e.clientX, y: e.clientY }, bar)
        ) {
          e.preventDefault();
          return;
        }
        if (!e.shiftKey) {
          // The prompt's own menu (M3-05 part 5: the grip modes' right-click menu).
          if (this.#hooks.onShortcutMenu?.({ x: e.clientX, y: e.clientY })) e.preventDefault();
          return;
        }
        if (!this.#precise()) return;
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
    // A window PICKAUTO 2 started from over an object is a rectangle (M3-04 part 6).
    if (band.lasso === false) return undefined;
    if (band.from.y !== start.y) return undefined;
    if (!press.shown) {
      press.shown = true;
      this.#hooks.onLasso?.(press.lasso);
    }
    return { kind: press.lasso, points: press.path };
  }

  /**
   * The freehand path being dragged (M3-12 part 6): a press that started the rubber band of a
   * prompt that takes one (TRIM's Quick mode fence) and has been dragged; its points so far.
   */
  #freehand(): readonly Point[] | undefined {
    const press = this.#press;
    const p = this.#prompt;
    if (!press?.dragged || p?.kind !== 'point' || !p.rubberBand?.freehand) return undefined;
    const start = press.path[0]!;
    const from = p.rubberBand.from;
    // The press that began this fence, not one after a click gave its first point.
    if (Math.hypot(start.x - from.x, start.y - from.y) > this.#px()) return undefined;
    return press.path;
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
    return 1 / (this.#pointerView()?.scale ?? 1);
  }

  /** The point the cursor is measured from: a rubber band's start (not a window's corner). */
  #base(): Vec2 | undefined {
    const p = this.#prompt;
    if (p?.kind === 'point')
      return p.rubberBand && !p.rubberBand.box ? p.rubberBand.from : undefined;
    return p && 'base' in p ? p.base : undefined;
  }

  /** SNAPUNIT of the viewport worked in (10 × 10 when it has none). */
  #snapSpacing(): Vec2 {
    const s = this.#snapGrid()?.snapSpacing;
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
    const vport = this.#snapGrid();
    const p = this.#prompt;
    const last = p?.kind === 'point' ? p.rubberBand?.direction : undefined;
    const polarSnap = polarSnapDistance(d, this.#snapSpacing().x);
    // In the current UCS, turned by SNAPANG for the snap and ORTHO (M3-06 part 7).
    const ucs = this.#ucs();
    const snapBase = toWorld(ucs, vport?.snapBase ?? { x: 0, y: 0 });
    return constrainCursor(world, {
      ...(base && { base }),
      ...(d.snap &&
        polarSnap === undefined && {
          snap: this.#snapSpacing(),
          ...((snapBase.x !== 0 || snapBase.y !== 0) && { snapBase }),
        }),
      ...(ucs.angle !== 0 && { ucs: ucs.angle }),
      ...(vport?.snapRotation && { snapAngle: vport.snapRotation }),
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
    if (!world || !this.#precise() || this.#outside) return;
    this.#snapping = true;
    void this.#snapAt(world).then((hits) => {
      this.#snapping = false;
      const at = this.#pointer && !this.#outside ? this.#world(this.#pointer) : undefined;
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
      items.push({ kind: 'point', point: point.point, mode: point.mode, id: point.id });
    for (const h of hits) {
      if (!h.track || !h.direction) continue;
      if (h.mode === 'EXT' && (!point || sameAt(h.point, point.point)))
        items.push({ kind: 'extension', point: h.point, direction: h.direction });
      else if (h.mode === 'PAR' && !point && !items.some((i) => i.kind === 'parallel'))
        items.push({ kind: 'parallel', point: h.point, direction: h.direction, id: h.id });
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
    // A click on one of the prompt's own grips is that grip (TABLECELL's, M4-05 part 6).
    const grip = this.#promptGripAt(world);
    if (grip) return { point: grip };
    // The aids as they are at the click: an override key let go while the snaps are worked out
    // still counts (M3-06 part 5), as the modes asked for already do.
    const aided = this.#constrain(world);
    const constrained = aided.point;
    const hits = (await this.#snapAt(world)).filter((h) => !h.track);
    const hit = hits[this.#cycle < hits.length ? this.#cycle : 0];
    if (hit) {
      const point = this.#along(world, hit.point);
      if (hit.deferred) return { point, deferred: hit.deferred };
      // Where the point is the snap's own (not moved along TK's axis), its object snap.
      const exact = point.x === hit.point.x && point.y === hit.point.y;
      return { point, ...(exact && { snap: { mode: hit.mode, id: hit.id } }) };
    }
    const p = this.#prompt;
    const missed = p?.kind === 'point' && p.osnap !== undefined && p.osnap !== 0;
    // Placed on PARallel's or object snap tracking's paths: which, for Infer (M9-05 part 8).
    const tracks = aided.track ? trackedSnaps(aided.track) : [];
    return {
      point: constrained,
      ...(missed && { missed: true }),
      ...(tracks.length > 0 && { tracks }),
    };
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
    if (!world || !this.#precise() || this.#outside) {
      this.#overlay = [];
      this.#tip.hidden = true;
      // Outside the viewport worked in the cursor is an arrow, with no rubber band to it.
      this.#rubberBand(this.#outside ? undefined : world);
      if (world) this.#cursorAt(world);
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
    this.#cursorAt(point);
  }

  /** LUPREC, for the tooltips. */
  #precision(): number {
    const v = this.#header.get('$LUPREC');
    return typeof v === 'number' && v >= 0 && v <= 8 ? v : 4;
  }

  /** Ctrl+R (M7-06): makes this tiled viewport current, as a click in it does. */
  activate(): boolean {
    return this.#activate();
  }

  /** Makes this tiled viewport current; true when it was not. */
  #activate(): boolean {
    const tile = this.#hooks.tile;
    if (!tile || tile.isCurrent()) return false;
    tile.activate();
    this.#leftWork(this.#isOutside());
    if (this.#prompt && this.#mode === 'none') {
      this.#requestSnap();
      this.#track();
    }
    return true;
  }

  /** The prompt waiting asks for a model viewport to be clicked (-VPORTS Join). */
  #picksViewport(): boolean {
    const p = this.#asked;
    return p?.kind === 'point' && p.viewport === true;
  }

  /**
   * Whether the cursor is outside the viewport worked in (`#outside`): a tile not current but at
   * a prompt for a viewport, where every tile takes the click; the sheet beyond the current
   * layout viewport's frame unless a window's corner is being placed, which may lie beyond it
   * (M6-02 part 9).
   */
  #isOutside(): boolean {
    const p = this.#pointer;
    if (!p) return false;
    const tile = this.#hooks.tile;
    if (tile) return !tile.isCurrent() && !this.#picksViewport();
    const c = this.#current;
    const view = this.#view;
    if (!c || this.#maximized || !view || this.#corner || this.#press || this.#drag) return false;
    const asked = this.#asked;
    if (asked?.kind === 'point' && asked.rubberBand?.box) return false;
    const { width, height } = this.#size;
    const paper = screenToWorld(view, width, height, { x: p.offsetX, y: p.offsetY });
    const g = c.geom;
    return (
      Math.abs(paper.x - g.center.x) > g.width / 2 || Math.abs(paper.y - g.center.y) > g.height / 2
    );
  }

  /** Records whether the cursor is outside the viewport worked in, for the arrow (styles.css). */
  #leftWork(outside: boolean): void {
    this.#outside = outside;
    const v = String(outside);
    if (this.#canvas.dataset['outside'] !== v) this.#canvas.dataset['outside'] = v;
    if (outside) {
      this.#hit = undefined;
      this.#hits = [];
    }
  }

  #startDrag(e: PointerEvent): void {
    // The current layout viewport's drag keeps its own ZOOM Previous view at its first move.
    if (this.#view && !this.#zoomable()) this.#history.push(this.#view);
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

/** A prompt no answer is drawn at: a command preview's answer for a cursor gone. */
const NO_PROMPT: Prompt = { kind: 'keyword', message: '' } as Prompt;

const sameAt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** A key pressed in text being typed (the command line's, a field's), not left empty. */
function typesText(target: EventTarget | null): boolean {
  const f = focusOf(target, commandInput.current);
  return f.kind !== 'none' && !(f.kind === 'command' && f.empty);
}

const sameTransform = (a: ViewTransform, b: ViewTransform): boolean =>
  a.scale === b.scale && sameAt(a.center, b.center);

/** The UCS icon's arm length and its corner's distance from the canvas edges, CSS pixels. */
const UCS_ICON_ARM = 36;
const UCS_ICON_MARGIN = 4;

/**
 * The UCS icon's SVG: a box twice the arm across with the axes' corner at its centre, X along
 * `angle` (radians counter-clockwise, so turned the other way in the SVG's downward Y) and Y a
 * quarter turn on, each an arrow with its letter; `world` adds AutoCAD's WCS square at the corner.
 */
function ucsIconSvg(angle: number, world: boolean): string {
  const a = UCS_ICON_ARM;
  const c = a; // the corner, in the middle of a 2a × 2a box
  const deg = (-angle * 180) / Math.PI;
  const head = (x: number, y: number, dx: number, dy: number) =>
    `M${x} ${y}L${x - 5 * dx + 3 * dy} ${y - 5 * dy - 3 * dx}M${x} ${y}L${x - 5 * dx - 3 * dy} ${y - 5 * dy + 3 * dx}`;
  const tip = a - 6;
  const square = world ? `<rect x="${c}" y="${c - 6}" width="6" height="6" />` : '';
  return (
    `<svg width="${2 * a}" height="${2 * a}" viewBox="0 0 ${2 * a} ${2 * a}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.5"><g transform="rotate(${deg.toFixed(3)} ${c} ${c})">` +
    `<path d="M${c} ${c}H${c + tip}${head(c + tip, c, 1, 0)}M${c} ${c}V${c - tip}${head(c, c - tip, 0, -1)}" />` +
    square +
    `<text x="${c + tip - 2}" y="${c + 12}" fill="currentColor" stroke="none" font-size="10">X</text>` +
    `<text x="${c - 11}" y="${c - tip + 6}" fill="currentColor" stroke="none" font-size="10">Y</text>` +
    `</g></svg>`
  );
}

/** The floating viewport made current (MSPACE) and its geometry as the canvas has it now. */
interface CurrentViewport {
  readonly handle: Handle;
  geom: ViewportGeometry;
}
