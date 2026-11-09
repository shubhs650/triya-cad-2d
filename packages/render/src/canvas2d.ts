// Canvas2DRenderer: the v1 `Renderer` (ARCHITECTURE.md §7.2).
//
// - Scene cache: each entity's primitives are built once per change (`apply`), never per
//   frame, and the drawn scene is kept in its own layer, so a frame that only moves the
//   transient layer (rubber band, grips) is two bitmap copies.
// - Culling: each frame draws only what the spatial index returns for the visible box.
// - LOD: an entity smaller than a pixel on screen is a one-pixel dot; after a frame over the
//   16 ms budget the next frame skips those and schedules a full-quality frame when idle.
// - Pan/zoom (M1-44): while only the view changes on a scene too heavy to redraw within a
//   frame, each frame draws the last scene bitmap moved and scaled to the new view (what it
//   does not cover shows the background), and the scene is drawn again in full once the view
//   has stopped changing for `SETTLE_MS`. Any other change redraws at once.
// - Precision: paths are built relative to the view centre, so canvas float32 maths never
//   sees large drawing coordinates.
// - DPR: backing stores are CSS size × device pixel ratio; line widths are device pixels.
// - Style (M1-13): an entity with a linetype is cached continuous, which is what it shows
//   once a pattern is under a pixel and what picking measures; its dashes are fitted the
//   first time it is drawn at a zoom that shows them and kept until it changes, so opening a
//   drawing never pays for dashes nobody zooms in to see. Lineweights follow AutoCAD's model
//   and layout display (`lineweightPixels`), a block's SORTENTSTABLE sets the draw order
//   (`drawOrder`), and LTSCALE, linetype and layer changes re-resolve every entity.
// - Layouts (M1-18): a layout's block is shown on its sheet (the paper in the canvas
//   background colour, the area around it in `layoutBackground`, the printable area dashed),
//   with each floating viewport's view of model space drawn first, clipped to its frame and
//   culled by the model-space index, then the paper-space entities on top (AutoCAD's display,
//   and its plot default "plot paper space last"). Model-space entities share the cache: their
//   primitives are in model space whichever viewport shows them, and each viewport only changes
//   the transform they are drawn through.
//
// The renderer reads the model and its spatial index; the caller applies each ChangeSet to
// both first, then to the renderer (the order `SpatialIndex.apply` already requires).

import {
  applyPoint,
  inBox,
  invert,
  layoutSheet,
  stretchGeometry,
  gripsOf,
  moveGrip,
  sameGrip,
  translation,
  paperUnitsPerMm,
  viewportFrame,
  viewportScale,
  viewportShowsModel,
  VIEWPORT_NON_RECT_CLIP,
  viewportLayers,
  viewportTransform,
  type LayerRecord,
  type ViewportLayers,
  type Box,
  type ChangeSet,
  type DocumentModel,
  type DragMotion,
  type Vec2,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type Handle,
  type ImageDefinition,
  type KeyedChanges,
  type Layout,
  type LayoutSheet,
  type Matrix2D,
  type NonGraphicalObject,
  type RasterVariables,
  type SortEntsTable,
  type SpatialIndex,
  type ViewportGeometry,
  type WipeoutVariables,
} from '@triya/engine';
import { expandInsert, expands, insertClips, type BlockSource, type InsertClip } from './blocks';
import { defaultPaint, type PaintFunction } from './paint';
import { drawOrder } from './style/draw-order';
import { aciRgb, rgbHex } from './style/aci';
import { gridLines } from './grid';
import { mixColors, parseHex, tintColor } from './style/mix';
import { adjustPixels, imageLabel, type ImageFrames } from './image';
import {
  adjustUnderlayPixels,
  mergeNeeds,
  pagePath,
  rasterCovers,
  underlayNeed,
  underlayRequest,
} from './underlay';
import { annotationLinetypeScale, patternLength } from './style/pattern';
import { lineweightPixels } from './style/resolve';
import { primCrosses, primInside } from './select';
import { patternLibrary, tessellate } from './tessellate';
import type { TextContext } from './text';
import type { PatternLibrary } from '@triya/hatch';
import type { TextFonts } from '@triya/text';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  screenToWorld,
  visibleBox,
  type DrawnEntity,
  type FillGradient,
  type ImageFill,
  type PrimitiveClip,
  type PrimitiveColor,
  type RasterPixels,
  type RenderPrimitive,
  type RenderStyle,
  type Renderer,
  type ScreenRect,
  type SelectQuery,
  type UnderlayFill,
  type UnderlayRaster,
  type UnderlayRequest,
  type ViewTransform,
} from './types';

/** The Canvas 2D calls the renderer makes; an HTML canvas and an OffscreenCanvas both fit. */
export interface Canvas2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): void;
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    a0: number,
    a1: number,
    anticlockwise?: boolean,
  ): void;
  closePath(): void;
  stroke(): void;
  fill(rule?: CanvasFillRule): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  /** An image's adjusted bitmap, written once into a layer of its own (M1-19). */
  createImageData(width: number, height: number): ImageData;
  putImageData(data: ImageData, dx: number, dy: number): void;
  /** Viewport clipping and the printable area's dashes (M1-18). */
  save(): void;
  restore(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(rule?: CanvasFillRule): void;
  /** IMAGEQUALITY (M1-19): high smooths a scaled bitmap, draft shows its pixels. */
  imageSmoothingEnabled: boolean;
  setLineDash(segments: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
}

/** A canvas (visible or an offscreen layer) and its 2D context. */
export interface Surface {
  readonly canvas: { width: number; height: number };
  readonly ctx: Canvas2D;
  /** What `drawImage` takes to copy this surface onto another. */
  readonly image: CanvasImageSource;
}

export interface Canvas2DRendererOptions {
  readonly model: DocumentModel;
  readonly index: SpatialIndex;
  /** The block record shown: model space, or a layout's paper space. */
  readonly block: Handle;
  readonly surface: Surface;
  /** Makes an offscreen layer (the scene cache and the transient layer). */
  readonly createLayer: () => Surface;
  readonly style?: RenderStyle;
  /**
   * Entity → paint (inside the context an INSERT hands down); undefined hides it. Defaults to
   * `defaultPaint`, whose `insertContext` also serves a paint function that has none.
   */
  readonly paint?: PaintFunction;
  readonly now?: () => number;
  /** Runs a callback when the browser is idle (requestIdleCallback in the app). */
  readonly requestIdle?: (cb: () => void) => void;
  /**
   * Loaded fonts for TEXT and MTEXT (M1-41); without them text draws nothing. The app fills
   * them from the user font store and the bundled fonts before drawing (M1-37).
   */
  readonly fonts?: TextFonts;
  /**
   * The user's .pat files (M1-50), in the order added: their patterns join the bundled ones,
   * a later file winning on a shared name, for hatches stored without their pattern lines.
   */
  readonly patterns?: readonly string[];
  /** A field's current value (MTEXT `%<…>%`); undefined shows `----`. */
  readonly evaluateField?: (code: string) => string | undefined;
  /**
   * An IMAGEDEF's decoded bitmap (M1-19), or undefined while the app has none (file not
   * found or not yet decoded): the image then shows as its outline. Asked again every frame
   * until it answers, and once per bitmap and setting after that.
   */
  readonly images?: (definition: Handle) => RasterPixels | undefined;
  /**
   * A PDFDEFINITION's page as the app last drew it (M1-20), or undefined while it has none:
   * a clipped underlay then shows its boundary, an unclipped one nothing.
   */
  readonly underlays?: (definition: Handle) => UnderlayRaster | undefined;
  /**
   * Asks the app to draw a page (M1-20): called after a scene is drawn, for each page whose
   * raster does not show what is on screen at the screen's resolution, once per distinct
   * request until a new raster arrives.
   */
  readonly onUnderlayRequest?: (request: UnderlayRequest) => void;
}

/** An entity's primitives, with its world size and centre for the sub-pixel LOD. */
interface CacheEntry {
  readonly prims: readonly RenderPrimitive[];
  readonly size: number;
  readonly x: number;
  readonly y: number;
  /**
   * An entity with linetypes: its dashed primitives, built on first use, per linetype scale
   * multiplier (1, or a PSLTSCALE viewport's 1 / scale, M1-18).
   */
  readonly dashes?: {
    /** The longest pattern repetition among its parts at multiplier 1, world units. */
    readonly period: number;
    readonly build: (multiplier: number) => readonly RenderPrimitive[];
    readonly built: Map<number, readonly RenderPrimitive[]>;
  };
  /** An INSERT or a dimension: every block definition it draws from (M1-14, M1-15). */
  readonly blocks?: ReadonlySet<Handle>;
  /** The entity's own LAYER, which hides it when frozen in a viewport (M1-18). */
  readonly layer?: Handle;
}

/**
 * How cached primitives reach the device: coordinates minus `origin` (so canvas float32 maths
 * sees small numbers), then `m` to device pixels. `scale` is CSS pixels per drawing unit for
 * the LOD rules, and `box` what is visible, in the primitives' own coordinates.
 */
interface DrawFrame {
  readonly ox: number;
  readonly oy: number;
  readonly m: Matrix2D;
  readonly scale: number;
  readonly box: Box;
  /** A viewport's frozen layers (DXF 341): entries and block parts on them are skipped. */
  readonly frozen?: ReadonlySet<Handle>;
  /**
   * Linetype scale multiplier: 1 / the viewport scale under PSLTSCALE, the annotation scale
   * on the Model tab under MSLTSCALE (M1-63), else 1.
   */
  readonly linetypeScale?: number;
}

/** A viewport to draw: its geometry, model → paper map, and whether it is drawn. */
interface ViewportEntry {
  readonly handle: Handle;
  readonly geom: ViewportGeometry;
  readonly toPaper: Matrix2D;
  readonly frozen: ReadonlySet<Handle> | undefined;
  /** Its layer overrides (M1-62), when any layer has one in this viewport. */
  readonly layers: ViewportLayers | undefined;
  /**
   * A non-rectangular viewport's clip (DXF 340, M1-62): the clip entity's outline paths in
   * paper coordinates, filled even-odd so a REGION's holes stay out.
   */
  readonly clip: readonly (readonly number[])[] | undefined;
}

/** The block's entities in draw order, and each id's position in it. */
interface Ordered {
  readonly order: readonly EntityId[];
  readonly rank: number[];
}

/**
 * The area around a layout's sheet when the style names none: the canvas background moved a
 * third of the way to mid grey, so the sheet stands out on light and dark themes. AutoCAD's
 * own default is a fixed grey; ours follows the theme.
 */
const LAYOUT_SURROUND_MIX = 1 / 3;
/** The printable area's dashes, CSS px (AutoCAD draws it dashed; the lengths are ours). */
const PRINTABLE_DASH = [6, 4];
/** GRID's lines: the foreground's share of their colour, minor and major (M2-04 part 2). */
const GRID_MINOR_MIX = 0.12;
const GRID_MAJOR_MIX = 0.24;
/** The selection highlight (M2-03): colour, glow width and alpha, and dash, in CSS pixels. */
const SELECTION_COLOR = '#4da3ff';
const SELECTION_GLOW_PX = 5;
const SELECTION_GLOW_ALPHA = 0.35;
const SELECTION_DASH = [4, 3];

export const DEFAULT_STYLE: RenderStyle = {
  background: '#212830',
  foreground: '#ffffff',
  showLineweights: false,
};

/** The frame budget (ARCHITECTURE.md §7.2): 60 fps. */
const FRAME_BUDGET_MS = 16;
/**
 * Entities drawn above which a full redraw is taken as too heavy for a pan/zoom frame even when
 * its CPU time fits the budget: the canvas rasterises after the draw calls return, so the timer
 * does not see it. M1-12 measured 10k entities at 48–54 fps in headless Chromium.
 */
const HEAVY_SCENE_ENTRIES = 8000;
/** How long the view must stay put before a moved scene bitmap is redrawn in full. */
const SETTLE_MS = 100;
/** Text under this cap height on screen (CSS px) is greeked (ARCHITECTURE.md §7.2). */
const TEXT_LOD_PX = 3;
/**
 * How strongly a greeked run's box is filled: about the share of a cap-height box that glyph
 * strokes cover. AutoCAD shows no greeking (it draws every glyph); the value is ours.
 */
const GREEK_ALPHA = 0.35;
/** LAYLOCKFADECTL: AutoCAD's initial value, and the most it fades (its range is −90…90). */
const LAYLOCKFADE_DEFAULT = 50;
const LAYLOCKFADE_MAX = 90;
/** Header variables that change how every entity is painted. */
const PAINT_HEADER = new Set(['$LTSCALE', '$FILLMODE', '$ATTMODE', '$XCLIPFRAME']);

/** FILLMODE (M1-46): off, as 0 or false, outlines wide polylines; on when the header has none. */
function fillMode(model: DocumentModel): boolean {
  const v = model.header.get('$FILLMODE');
  return !(v === 0 || v === false);
}

/** ATTMODE (M1-14 part 2): which attributes references show; AutoCAD's 1 when absent. */
function attributeMode(model: DocumentModel): number | undefined {
  const v = model.header.get('$ATTMODE');
  return typeof v === 'number' ? v : undefined;
}

const isSortEnts = (o: NonGraphicalObject): o is SortEntsTable => o.type === 'SORTENTSTABLE';

const WHITE = [255, 255, 255] as const;
const BLACK = [0, 0, 0] as const;

const isFrameSetting = (o: NonGraphicalObject): o is RasterVariables | WipeoutVariables =>
  o.type === 'RASTERVARIABLES' || o.type === 'WIPEOUTVARIABLES';

/** IMAGEFRAME and WIPEOUTFRAME from the drawing's objects; on when the drawing has none. */
function imageFrames(model: DocumentModel): ImageFrames {
  let image = true;
  let wipeout = true;
  for (const o of model.objects.values()) {
    if (!isFrameSetting(o)) continue;
    if (o.type === 'RASTERVARIABLES') image = o.frame;
    else wipeout = o.frame;
  }
  return { image, wipeout };
}

/** IMAGEQUALITY from the drawing's RASTERVARIABLES; high when the drawing has none. */
function imageQuality(model: DocumentModel): 'draft' | 'high' {
  for (const o of model.objects.values())
    if (o.type === 'RASTERVARIABLES') return (o as RasterVariables).quality;
  return 'high';
}

function touchesFrames(c: KeyedChanges<NonGraphicalObject> | undefined): boolean {
  if (!c) return false;
  return (
    (c.added ?? []).some(isFrameSetting) ||
    (c.removed ?? []).some(isFrameSetting) ||
    (c.updated ?? []).some((u) => isFrameSetting(u.before) || isFrameSetting(u.after))
  );
}

/**
 * Whether a change set reloads, unloads or renames an image's definition (M1-109): the name a
 * missing image shows changes. An added definition comes with the images it brings, which are
 * tessellated anyway, and a removed one goes with them.
 */
function touchesImageNames(c: KeyedChanges<NonGraphicalObject> | undefined): boolean {
  return (c?.updated ?? []).some((u) => {
    if (u.before.type !== 'IMAGEDEF' || u.after.type !== 'IMAGEDEF') return false;
    const [a, b] = [u.before as ImageDefinition, u.after as ImageDefinition];
    return imageLabel(a) !== imageLabel(b);
  });
}

const isSpatialFilter = (o: NonGraphicalObject): boolean => o.type === 'SPATIAL_FILTER';

/** Whether a change set adds, removes or changes an XCLIP (M1-103). */
function touchesClips(c: KeyedChanges<NonGraphicalObject> | undefined): boolean {
  if (!c) return false;
  return (
    (c.added ?? []).some(isSpatialFilter) ||
    (c.removed ?? []).some(isSpatialFilter) ||
    (c.updated ?? []).some((u) => isSpatialFilter(u.before) || isSpatialFilter(u.after))
  );
}

function touchesSortEnts(c: KeyedChanges<NonGraphicalObject> | undefined): boolean {
  if (!c) return false;
  return (
    (c.added ?? []).some(isSortEnts) ||
    (c.removed ?? []).some(isSortEnts) ||
    (c.updated ?? []).some((u) => isSortEnts(u.before) || isSortEnts(u.after))
  );
}

/**
 * Grips (M2-06 part 2): GRIPSIZE's half size in CSS pixels, GRIPCOLOR (ACI 150), GRIPHOT (ACI 12)
 * and a dark edge.
 */
const GRIP_SIZE = 4;
const GRIP_COLOR = rgbHex(aciRgb(150));
const GRIP_HOT = rgbHex(aciRgb(12));
const GRIP_EDGE = '#1a1a1a';

/** A dimension without its block, so the engine draws it (a STRETCH preview, M2-10 part 3). */
/** The id an object being placed is drawn under: no object of the drawing has it. */
const ADDING = -1 as EntityId;

function unblocked(g: EntityGeometry): EntityGeometry {
  if (!('dimType' in g)) return g;
  const { block: _block, ...rest } = g;
  return rest as EntityGeometry;
}

export class Canvas2DRenderer implements Renderer {
  readonly #model: DocumentModel;
  readonly #index: SpatialIndex;
  readonly #block: Handle;
  readonly #surface: Surface;
  readonly #scene: Surface;
  readonly #transientLayer: Surface;
  readonly #paint: PaintFunction;
  /**
   * Fonts and text styles for TEXT and MTEXT (M1-41), image frame settings (M1-19), the
   * hatch pattern library (M1-50), FILLMODE (M1-46) and ATTMODE (M1-14). One object shared
   * with `#blockSource`, so a pattern, FILLMODE or ATTMODE change reaches block contents too.
   */
  readonly #tessellate: {
    text?: TextContext;
    frames?: ImageFrames;
    imageName?: (definition: Handle) => string | undefined;
    patterns?: PatternLibrary;
    fill?: boolean;
    attributeMode?: number | undefined;
  } = {};
  readonly #createLayer: () => Surface;
  readonly #images: ((definition: Handle) => RasterPixels | undefined) | undefined;
  readonly #underlays: ((definition: Handle) => UnderlayRaster | undefined) | undefined;
  readonly #onUnderlayRequest: ((request: UnderlayRequest) => void) | undefined;
  /** What the scene being drawn needs of each page, merged over every underlay showing it. */
  #underlayNeeds = new Map<Handle, { readonly scale: number; readonly region: Box }>();
  /** The last request sent per page, as a key, so an unanswerable one is not sent again. */
  #underlayAsked = new Map<Handle, string>();
  /** Page raster → its adjusted layers, by setting and background. */
  #pages = new WeakMap<RasterPixels, Map<string, Surface>>();
  /** IMAGEQUALITY from RASTERVARIABLES; AutoCAD's initial value is high. */
  #imageQuality: 'draft' | 'high' = 'high';
  /** Bitmap → its adjusted layers, by setting, colour and background. */
  #bitmaps = new WeakMap<RasterPixels, Map<string, Surface>>();
  /** How INSERTs and dimensions in the block shown expand (M1-14, M1-15). */
  readonly #blockSource: BlockSource;
  readonly #blockDef = (block: Handle) => this.#model.blocks.get(block);
  /** Block definition → its entities in draw order, built on demand. */
  #blockOrders = new Map<Handle, readonly EntityId[]>();
  /** Block definition → its SORTENTSTABLE, built on demand. */
  #sortTables: Map<Handle, SortEntsTable> | undefined;
  /** XCLIPs by INSERT (M1-103), built on demand. */
  #clips: ((insert: Handle) => InsertClip | undefined) | undefined;
  readonly #now: () => number;
  readonly #requestIdle: (cb: () => void) => void;
  /**
   * Model space and block definitions show lineweights as pixels; a layout's paper space as
   * paper millimetres at the zoom.
   */
  readonly #paperSpace: boolean;
  /**
   * The layout whose block is shown (Model's or a sheet's); a change set that updates it
   * (renamed, new page setup or flags, M1-97) re-reads what follows from it.
   */
  readonly #layoutHandle: Handle | undefined;
  /** Paper drawing units per millimetre, from the layout's page setup (M1-18). */
  #paperUnitsPerMm = 1;
  /** The layout's PSLTSCALE (DXF 70 bit 1): viewport linetypes in paper units. */
  #psltscale = true;
  /** The block shown is model space: the Model tab, where MSLTSCALE applies (M1-63). */
  readonly #modelTab: boolean;
  /** The layout's sheet, when the block shown is a set-up layout. */
  #sheet: LayoutSheet | undefined;
  /** Model space, when the block shown is a layout whose viewports show it. */
  readonly #modelBlock: Handle | undefined;
  /** The layout's model-space viewports in stacking order; undefined until first needed. */
  #viewports: readonly ViewportEntry[] | undefined;
  /**
   * Per viewport with layer overrides (M1-62): the entries of entities those overrides restyle,
   * built on first draw and dropped by every change set (they are rare and few).
   */
  #overridden = new Map<Handle, Map<EntityId, CacheEntry | undefined>>();

  /** Per entity id (ids are dense): its primitives and screen-size data; hidden ones absent. */
  #cache: (CacheEntry | undefined)[] = [];
  /** Per block drawn (the block shown, and model space through viewports): draw order. */
  #ordered = new Map<Handle, Ordered>();
  /** Scratch marks for walking visible entities in draw order without sorting. */
  #mark = new Uint8Array(0);
  #style: RenderStyle;
  #view: ViewTransform = { center: { x: 0, y: 0 }, scale: 1 };
  #width = 0;
  #height = 0;
  #dpr = 1;
  #transient: readonly RenderPrimitive[] = [];
  /** The entities drawn selected (M2-03). */
  #highlight: ReadonlySet<EntityId> = new Set();
  /**
   * What a command drags (M2-06 part 2): cached entries drawn through `m`, and the stretched
   * objects' entries tessellated from their stretched geometry.
   */
  #drag:
    | {
        readonly moved: readonly CacheEntry[];
        readonly m: Matrix2D;
        readonly stretched: readonly CacheEntry[];
        /** Objects a grip moves whole, by `gripMove`. */
        readonly gripMoved: readonly CacheEntry[];
        readonly gripMove: Matrix2D;
      }
    | undefined;
  /** The objects grips show on, and the hot grip (M2-06 part 2). */
  #grips: { readonly ids: readonly EntityId[]; readonly hot: Vec2 | undefined } | undefined;
  /** The locked layers (M1-69), found again after a layer change; undefined until needed. */
  #locked: ReadonlySet<Handle> | undefined;
  #sceneDirty = true;
  /**
   * Something other than the view changed since the scene was drawn (content, style, size,
   * fonts, patterns or a bitmap): moving the old bitmap would show the wrong drawing.
   */
  #contentDirty = true;
  /** The view the scene bitmap was drawn at; undefined before the first scene draw. */
  #sceneView: ViewTransform | undefined;
  /** The last scene draw's CPU time and the entities it drew. */
  #sceneMs = 0;
  #sceneEntries = 0;
  /** When a frame last moved the scene bitmap, and whether a settle check is waiting. */
  #movedAt = 0;
  #settlePending = false;
  /** The next frame draws the scene in full even if only the view changed (the settle). */
  #forceFull = false;
  #transientDirty = true;
  #lastFrameSlow = false;
  #idlePending = false;
  /** Frames that redrew the scene layer (tests check the transient path skips it). */
  sceneDraws = 0;

  constructor(o: Canvas2DRendererOptions) {
    this.#model = o.model;
    this.#index = o.index;
    this.#block = o.block;
    this.#surface = o.surface;
    this.#scene = o.createLayer();
    this.#transientLayer = o.createLayer();
    this.#style = o.style ?? DEFAULT_STYLE;
    this.#paint = o.paint ?? defaultPaint;
    this.#createLayer = o.createLayer;
    this.#images = o.images;
    this.#underlays = o.underlays;
    this.#onUnderlayRequest = o.onUnderlayRequest;
    if (o.fonts) {
      const model = this.#model;
      this.#tessellate.text = {
        fonts: o.fonts,
        style: (h) => model.tables.textStyles.get(h),
        ...(o.evaluateField ? { evaluateField: o.evaluateField } : {}),
      };
    }
    this.#tessellate.frames = imageFrames(this.#model);
    {
      const model = this.#model;
      this.#tessellate.imageName = (h) => {
        const o = model.objects.get(h);
        return o?.type === 'IMAGEDEF' ? imageLabel(o as ImageDefinition) : undefined;
      };
    }
    this.#tessellate.fill = fillMode(this.#model);
    this.#tessellate.attributeMode = attributeMode(this.#model);
    this.#imageQuality = imageQuality(this.#model);
    if (o.patterns?.length) this.#tessellate.patterns = patternLibrary(o.patterns);
    this.#blockSource = {
      model: this.#model,
      paint: this.#paint,
      insertContext: this.#paint.insertContext ?? defaultPaint.insertContext,
      order: (block) => this.#blockOrder(block),
      tessellate: this.#tessellate,
      clip: (insert) => (this.#clips ??= insertClips(this.#model))(insert),
    };
    this.#now = o.now ?? (() => performance.now());
    this.#requestIdle = o.requestIdle ?? ((cb) => setTimeout(cb, 50));
    const records = this.#model.tables.blockRecords;
    const isModel = (h: Handle) => records.get(h)?.name.toLowerCase() === '*model_space';
    const layout = this.#model.layouts.find((l) => l.blockRecord === this.#block);
    this.#paperSpace = layout !== undefined && !isModel(layout.blockRecord);
    this.#modelTab = isModel(this.#block);
    this.#layoutHandle = layout?.handle;
    this.#readLayout(layout);
    this.#modelBlock = this.#paperSpace
      ? [...records.values()].find((r) => isModel(r.handle))?.handle
      : undefined;
    this.#cacheBlock();
  }

  resize(width: number, height: number, dpr: number): void {
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    for (const s of [this.#surface, this.#scene, this.#transientLayer]) {
      s.canvas.width = Math.round(width * dpr);
      s.canvas.height = Math.round(height * dpr);
    }
    this.#sceneDirty = this.#contentDirty = this.#transientDirty = true;
  }

  setView(view: ViewTransform): void {
    this.#view = view;
    this.#sceneDirty = this.#transientDirty = true;
  }

  setStyle(style: RenderStyle): void {
    this.#style = style;
    this.#sceneDirty = this.#contentDirty = this.#transientDirty = true;
  }

  /**
   * Replaces the user's .pat files (M1-50). Every entity is re-tessellated, as for a layer
   * change: a hatch stored without its lines, alone or inside a block, may now draw or change.
   */
  setPatterns(sources: readonly string[]): void {
    this.#tessellate.patterns = patternLibrary(sources);
    this.#cacheBlock();
    this.#sceneDirty = this.#contentDirty = true;
  }

  /**
   * Replaces the fonts text draws with (the user's font files changed, M1-38): every entity is
   * re-tessellated, since text inside blocks, dimensions and tables may draw differently.
   */
  setFonts(fonts: TextFonts): void {
    const model = this.#model;
    this.#tessellate.text = {
      ...this.#tessellate.text,
      fonts,
      style: (h) => model.tables.textStyles.get(h),
    };
    this.#cacheBlock();
    this.#sceneDirty = this.#contentDirty = true;
  }

  setTransient(primitives: readonly RenderPrimitive[]): void {
    this.#transient = primitives;
    this.#transientDirty = true;
  }

  setHighlight(ids: readonly EntityId[]): void {
    if (ids.length === 0 && this.#highlight.size === 0) return;
    this.#highlight = new Set(ids);
    this.#sceneDirty = this.#contentDirty = true;
  }

  setDrag(motion: DragMotion | undefined): void {
    if (!motion) {
      if (!this.#drag) return;
      this.#drag = undefined;
      this.#transientDirty = true;
      return;
    }
    const moved: CacheEntry[] = [];
    for (const id of motion.ids) {
      const entry = this.#cache[id];
      if (entry) moved.push(entry);
    }
    const stretched: CacheEntry[] = [];
    const s = motion.stretch;
    if (s) {
      const inside = inBox(s.window);
      for (const id of s.ids) {
        const e = this.#model.entity(id);
        if (!e || !this.#cache[id]) continue;
        // The engine reshapes a dimension only when it can regenerate it (M2-10 part 3); the
        // preview draws the reshaped one afresh, as its rewritten block will.
        const r = stretchGeometry(e.geom, inside, s.d, { dimensions: true });
        const geom =
          r.kind === 'shape' ? unblocked(r.geom) : r.kind === 'none' ? e.geom : undefined;
        const entry = geom && this.#entryOf({ ...e, geom }, id, this.#model, this.#blockSource);
        if (entry) stretched.push(entry);
      }
    }
    const gripMoved: CacheEntry[] = [];
    const g = motion.grip;
    if (g) {
      for (const id of g.ids) {
        const e = this.#model.entity(id);
        if (!e || !this.#cache[id]) continue;
        const r = moveGrip(e.geom, g.from, g.to);
        if (r.kind === 'move') gripMoved.push(this.#cache[id]);
        if (r.kind !== 'shape') continue;
        // A dimension's grip reshapes it and the engine regenerates it (M2-11): drawn afresh.
        const geom = unblocked(r.geom);
        const entry = this.#entryOf({ ...e, geom }, id, this.#model, this.#blockSource);
        if (entry) stretched.push(entry);
      }
    }
    const a = motion.adding;
    if (a) {
      // An object a command is placing (a dimension, M2-11), as it will be made: ByLayer on
      // its layer, in the space shown.
      const e: Entity = {
        id: ADDING,
        handle: '',
        type: a.geom.kind,
        owner: this.#block,
        layer: a.layer,
        color: { kind: 'byLayer' },
        linetype: 'ByLayer',
        lineweight: 'ByLayer',
        transparency: 'ByLayer',
        ltScale: 1,
        visible: true,
        geom: unblocked(a.geom),
      };
      const entry = this.#entryOf(e, ADDING, this.#model, this.#blockSource);
      if (entry) stretched.push(entry);
    }
    const gripMove = g ? translation(g.to.x - g.from.x, g.to.y - g.from.y) : motion.m;
    this.#drag = { moved, m: motion.m, stretched, gripMoved, gripMove };
    this.#transientDirty = true;
  }

  /**
   * The objects to show grips on, the hot one red (M2-06 part 2); undefined or none hides them.
   * Grips are drawn GRIPSIZE pixels square in GRIPCOLOR (ACI 150) and GRIPHOT (ACI 12), over
   * everything, AutoCAD's defaults.
   */
  setGrips(ids: readonly EntityId[], hot?: Vec2): void {
    if (ids.length === 0 && !this.#grips) return;
    this.#grips = ids.length > 0 ? { ids, hot } : undefined;
    this.#transientDirty = true;
  }

  select(query: SelectQuery): EntityId[] {
    const test = query.kind === 'window' ? primInside : primCrosses;
    const all = query.kind === 'window' ? 'every' : 'some';
    const out: EntityId[] = [];
    for (const id of this.#index.query(this.#block, query.box)) {
      const prims = this.#cache[id]?.prims;
      // Nothing drawn (a layer off or frozen): nothing to take.
      if (!prims || prims.length === 0) continue;
      if (prims[all]((p) => test(p, query.box))) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }

  /** Redraws the scene on the next frame: something it draws from changed (a bitmap, M1-19). */
  invalidate(): void {
    this.#sceneDirty = this.#contentDirty = true;
  }

  apply(cs: ChangeSet): void {
    const e = cs.entities;
    // Grips sit on the objects' points, which the change may have moved.
    if (this.#grips) this.#transientDirty = true;
    for (const r of e?.removed ?? []) this.#forget(r.entity);
    for (const a of e?.added ?? []) this.#cacheIfShown(a.entity);
    for (const u of e?.updated ?? []) {
      this.#forget(u.before);
      this.#cacheIfShown(u.after);
    }
    const sortEnts = touchesSortEnts(cs.objects);
    if (
      e?.added?.length ||
      e?.removed?.length ||
      e?.updated?.some((u) => u.before.owner !== u.after.owner) ||
      sortEnts
    )
      this.#ordered.clear();
    // A viewport may have been added, moved, rescaled or switched off, a layer's viewport
    // overrides changed (M1-62), or a clip entity reshaped.
    if (this.#paperSpace && (e || cs.tables?.layers)) this.#viewports = undefined;
    this.#overridden.clear();
    // Block definitions whose contents or draw order changed: the INSERTs drawing from them
    // (directly or through nesting) are expanded again.
    const changed = new Set<Handle>();
    for (const r of e?.removed ?? []) changed.add(r.entity.owner);
    for (const a of e?.added ?? []) changed.add(a.entity.owner);
    for (const u of e?.updated ?? []) changed.add(u.before.owner).add(u.after.owner);
    // A moved base point places the block's contents elsewhere in every reference (M1-75).
    for (const u of cs.blocks?.updated ?? []) changed.add(u.after.handle);
    if (sortEnts) {
      for (const o of [
        ...(cs.objects?.added ?? []),
        ...(cs.objects?.removed ?? []),
        ...(cs.objects?.updated ?? []).flatMap((u) => [u.before, u.after]),
      ])
        if (isSortEnts(o)) changed.add(o.block);
      this.#sortTables = undefined;
    }
    for (const block of changed) this.#blockOrders.delete(block);
    changed.delete(this.#block);
    if (this.#modelBlock) changed.delete(this.#modelBlock);
    if (changed.size > 0) {
      this.#cache.forEach((entry, id) => {
        if (entry?.blocks && [...changed].some((b) => entry.blocks!.has(b))) this.#cacheEntity(id);
      });
    }
    const frames = touchesFrames(cs.objects) || touchesImageNames(cs.objects);
    if (frames) {
      this.#tessellate.frames = imageFrames(this.#model);
      this.#imageQuality = imageQuality(this.#model);
    }
    this.#tessellate.fill = fillMode(this.#model);
    this.#tessellate.attributeMode = attributeMode(this.#model);
    if (cs.tables?.layers) this.#locked = undefined;
    // An XCLIP turned on or off, reshaped, added or removed, or XCLIPFRAME changed (M1-103):
    // the references drawing it may sit anywhere, nested in any block, so the block is redrawn.
    const clips = touchesClips(cs.objects) || cs.header?.some((h) => h.name === '$XCLIPFRAME');
    if (clips) this.#clips = undefined;
    // The layout shown was renamed, reordered or given a new page setup, limits or PSLTSCALE
    // (M1-97): its sheet, paper units and viewport linetype scale are read again. They are
    // used at draw time only, so nothing is re-tessellated.
    const layout = cs.layouts?.updated?.find((l) => l.after.handle === this.#layoutHandle)?.after;
    if (layout) this.#readLayout(layout);
    // A layer, linetype, text style, LTSCALE, FILLMODE or ATTMODE change can restyle or hide any
    // entity, and an IMAGEFRAME or WIPEOUTFRAME change reframes every image: re-resolve the
    // whole block.
    if (
      frames ||
      clips ||
      cs.tables?.layers ||
      cs.tables?.linetypes ||
      cs.tables?.textStyles ||
      cs.header?.some((h) => PAINT_HEADER.has(h.name))
    )
      this.#cacheBlock();
    this.#sceneDirty = this.#contentDirty = true;
  }

  frame(): void {
    const start = this.#now();
    const moved = this.#movedScene();
    const reduced = !moved && this.#lastFrameSlow;
    this.#forceFull = false;
    if (!moved && (this.#sceneDirty || reduced)) {
      const t0 = this.#now();
      this.#drawScene(reduced);
      this.#sceneMs = this.#now() - t0;
      this.#sceneView = this.#view;
      this.#sceneDirty = this.#contentDirty = false;
    }
    if (this.#transientDirty) {
      const t = this.#transientLayer;
      t.ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      const drag = this.#drag;
      if (drag) {
        const view = this.#viewFrame();
        this.#drawPrimitives(t.ctx, drag.moved, false, this.#dragFrame(view, drag.m));
        this.#drawPrimitives(t.ctx, drag.stretched, false, view);
        if (drag.gripMoved.length > 0) {
          this.#drawPrimitives(t.ctx, drag.gripMoved, false, this.#dragFrame(view, drag.gripMove));
        }
      }
      this.#drawPrimitives(
        t.ctx,
        [{ prims: this.#transient, size: Infinity, x: 0, y: 0 }],
        false,
        this.#viewFrame(),
      );
      if (this.#grips) this.#drawGrips(t.ctx);
      this.#transientDirty = false;
    }
    const out = this.#surface.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.clearRect(0, 0, this.#surface.canvas.width, this.#surface.canvas.height);
    if (moved) {
      out.fillStyle = this.#surround();
      out.fillRect(0, 0, this.#surface.canvas.width, this.#surface.canvas.height);
      out.setTransform(...moved);
      out.drawImage(this.#scene.image, 0, 0);
      out.setTransform(1, 0, 0, 1, 0, 0);
    } else out.drawImage(this.#scene.image, 0, 0);
    out.drawImage(this.#transientLayer.image, 0, 0);
    if (moved) {
      this.#movedAt = start;
      this.#settleLater();
      return;
    }

    this.#lastFrameSlow = this.#now() - start > FRAME_BUDGET_MS;
    if (reduced) {
      // This frame skipped detail; draw it in full once the user pauses.
      this.#sceneDirty = true;
      if (!this.#idlePending) {
        this.#idlePending = true;
        this.#requestIdle(() => {
          this.#idlePending = false;
          this.#lastFrameSlow = false;
          this.frame();
        });
      }
    }
  }

  /**
   * When only the view changed since a heavy scene was drawn, the device transform that takes
   * the scene bitmap to the view in force; otherwise undefined, and the scene is redrawn.
   * A world point at device x₀ in the bitmap's view (centre c₀, scale s₀) is at
   * x₁ = k·x₀ + (W/2)(1 − k) + (c₀ − c₁)·s₁·dpr in the new one, with k = s₁/s₀ (y flips sign).
   */
  #movedScene(): [number, number, number, number, number, number] | undefined {
    const from = this.#sceneView;
    const to = this.#view;
    if (!from || this.#forceFull || this.#contentDirty || !this.#sceneDirty) return undefined;
    if (from.center.x === to.center.x && from.center.y === to.center.y && from.scale === to.scale)
      return undefined;
    if (this.#sceneMs <= FRAME_BUDGET_MS && this.#sceneEntries <= HEAVY_SCENE_ENTRIES)
      return undefined;
    const k = to.scale / from.scale;
    const w = this.#width * this.#dpr;
    const h = this.#height * this.#dpr;
    const s = to.scale * this.#dpr;
    return [
      k,
      0,
      0,
      k,
      (w / 2) * (1 - k) + (from.center.x - to.center.x) * s,
      (h / 2) * (1 - k) - (from.center.y - to.center.y) * s,
    ];
  }

  /** Draws the scene in full once the view has stayed put for SETTLE_MS. */
  #settleLater(): void {
    if (this.#settlePending) return;
    this.#settlePending = true;
    const check = (): void => {
      if (this.#now() - this.#movedAt < SETTLE_MS) {
        this.#requestIdle(check);
        return;
      }
      this.#settlePending = false;
      // Something else may have redrawn the scene meanwhile (an edit, a resize).
      if (!this.#sceneDirty || this.#sceneView === this.#view) return;
      this.#forceFull = true;
      this.#lastFrameSlow = false;
      this.frame();
    };
    this.#requestIdle(check);
  }

  /** The sheet, PSLTSCALE and paper units of the layout shown. */
  #readLayout(layout: Layout | undefined): void {
    const plot = this.#paperSpace ? layout?.plot : undefined;
    this.#sheet = this.#paperSpace && layout ? layoutSheet(layout) : undefined;
    // A layout without stated flags takes AutoCAD's default, PSLTSCALE 1.
    this.#psltscale = ((layout?.flags ?? 1) & 1) !== 0;
    // Without a page setup the paper units follow the drawing's measurement.
    this.#paperUnitsPerMm = plot
      ? paperUnitsPerMm(plot)
      : this.#model.meta.measurement === 'imperial'
        ? 1 / 25.4
        : 1;
  }

  /** What shows around a layout's sheet, or the model background. */
  #surround(): string {
    return this.#sheet
      ? (this.#style.layoutBackground ??
          mixColors(this.#style.background, '#808080', LAYOUT_SURROUND_MIX))
      : this.#style.background;
  }

  hitTest(screen: { readonly x: number; readonly y: number }, aperture: number): EntityId[] {
    const p = screenToWorld(this.#view, this.#width, this.#height, screen);
    const r = aperture / this.#view.scale;
    const box: Box = { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
    const hits: { id: EntityId; d: number }[] = [];
    for (const id of this.#index.query(this.#block, box)) {
      const entry = this.#cache[id];
      if (!entry) continue;
      let d = Infinity;
      for (const prim of entry.prims) {
        // A part clipped away by XCLIP (M1-103) is not there to pick.
        if (prim.clip && !insideClips(prim.clip, p)) continue;
        d = Math.min(d, distanceTo(prim, p));
        // Text picks anywhere in its runs' boxes, between and inside the letters, as in
        // AutoCAD (M2-07 part 2: a double click on a word edits it).
        if (prim.kind !== 'infinite' && prim.kind !== 'point' && prim.text) {
          d = Math.min(d, distanceTo({ kind: 'fill', path: prim.text.greek, color: '' }, p));
        }
      }
      if (d <= r) hits.push({ id, d });
    }
    return hits.sort((a, b) => a.d - b.d).map((h) => h.id);
  }

  entitiesIn(rect: ScreenRect): DrawnEntity[] {
    const toWorld = (x: number, y: number) =>
      screenToWorld(this.#view, this.#width, this.#height, { x, y });
    const box = boxAround([
      toWorld(rect.x, rect.y),
      toWorld(rect.x + rect.width, rect.y + rect.height),
    ]);
    const found = new Set<EntityId>();
    this.#drawnIn(this.#block, box, found);
    // Model space through each viewport, under the part of the rectangle inside its frame.
    for (const vp of this.#viewportList()) {
      const frame = viewportFrame(vp.geom);
      const shown = {
        minX: Math.max(frame.minX, box.minX),
        minY: Math.max(frame.minY, box.minY),
        maxX: Math.min(frame.maxX, box.maxX),
        maxY: Math.min(frame.maxY, box.maxY),
      };
      if (shown.minX >= shown.maxX || shown.minY >= shown.maxY) continue;
      const t = invert(vp.toPaper);
      const corners = [
        [shown.minX, shown.minY],
        [shown.maxX, shown.minY],
        [shown.maxX, shown.maxY],
        [shown.minX, shown.maxY],
      ].map(([x, y]) => ({ x: t.a * x! + t.c * y! + t.e, y: t.b * x! + t.d * y! + t.f }));
      this.#drawnIn(this.#modelBlock!, boxAround(corners), found);
    }
    const out: DrawnEntity[] = [];
    for (const id of found) {
      const e = this.#model.entity(id);
      const handle = this.#model.ids.handleOf(id);
      if (e && handle !== undefined) out.push({ handle, type: e.geom.kind });
    }
    return out.sort((a, b) => compareHandles(a.handle, b.handle));
  }

  /**
   * Adds the entities of `block` drawn in `box`: the R-tree's candidates whose drawing comes
   * within the circle around the box (a fill counts its inside), so a big entity whose bounds
   * merely cover the box, such as a viewport frame around it, is left out.
   */
  #drawnIn(block: Handle, box: Box, out: Set<EntityId>): void {
    const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const r = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
    for (const id of this.#index.query(block, box)) {
      const entry = this.#cache[id];
      if (entry?.prims.some((prim) => distanceTo(prim, c) <= r)) out.add(id);
    }
  }

  /** Whether entities of `block` are drawn: the block shown, or model space in a layout. */
  #draws(block: Handle): boolean {
    return block === this.#block || (this.#modelBlock !== undefined && block === this.#modelBlock);
  }

  #cacheIfShown(e: Entity): void {
    if (!this.#draws(e.owner)) return;
    const id = this.#model.ids.idOf(e.handle);
    if (id !== undefined) this.#cacheEntity(id);
  }

  #forget(e: Entity): void {
    const id = this.#model.ids.idOf(e.handle);
    if (id !== undefined) this.#cache[id] = undefined;
  }

  #cacheBlock(): void {
    this.#cache = [];
    for (const id of this.#model.blockEntities(this.#block)) this.#cacheEntity(id);
    if (this.#modelBlock)
      for (const id of this.#model.blockEntities(this.#modelBlock)) this.#cacheEntity(id);
  }

  #cacheEntity(id: EntityId): void {
    const e = this.#model.entity(id);
    if (!e) return;
    this.#cache[id] = this.#entryOf(e, id, this.#model, this.#blockSource);
  }

  /**
   * An entity's cache entry, painted against `model`'s tables (a viewport's overridden layers,
   * M1-62) and expanded through `source`; undefined when it draws nothing.
   */
  #entryOf(
    e: Entity,
    id: EntityId,
    model: DocumentModel,
    source: BlockSource,
  ): CacheEntry | undefined {
    let prims: readonly RenderPrimitive[];
    let extra: Pick<CacheEntry, 'dashes' | 'blocks' | 'layer'>;
    if (expands(e, this.#blockDef)) {
      // The reference decides its own visibility: an off layer still shows its contents on
      // other layers.
      const x = expandInsert(e, source, { dashes: false });
      if (x.prims.length === 0 && x.blocks.size === 0) return undefined;
      prims = x.prims;
      const build = (linetypeScale: number) =>
        expandInsert(e, source, { dashes: true, linetypeScale }).prims;
      extra = {
        blocks: x.blocks,
        ...(x.period > 0 ? { dashes: { period: x.period, build, built: new Map() } } : {}),
      };
    } else {
      const paint = this.#paint(e, model);
      if (!paint) return undefined;
      const { linetype: lt, ...continuous } = paint;
      prims = tessellate(e.geom, continuous, this.#tessellate);
      const period = lt ? patternLength(lt.pattern) * lt.scale : 0;
      const build = (k: number) =>
        tessellate(
          e.geom,
          k === 1 || !lt ? paint : { ...paint, linetype: { ...lt, scale: lt.scale * k } },
          this.#tessellate,
        );
      extra = period > 0 ? { dashes: { period, build, built: new Map() } } : {};
    }
    extra = { ...extra, layer: e.layer };
    // The size and centre drive the sub-pixel LOD; unknown bounds never count as small.
    const b = this.#index.bounds(id);
    return b?.kind === 'box'
      ? {
          prims,
          size: Math.max(b.box.maxX - b.box.minX, b.box.maxY - b.box.minY),
          x: (b.box.minX + b.box.maxX) / 2,
          y: (b.box.minY + b.box.maxY) / 2,
          ...extra,
        }
      : { prims, size: Infinity, x: 0, y: 0, ...extra };
  }

  /**
   * What an entry draws at `scale` CSS px per unit with linetypes scaled by `multiplier`: its
   * dashes, or continuous (LOD).
   */
  #primitives(entry: CacheEntry, scale: number, multiplier: number): readonly RenderPrimitive[] {
    const d = entry.dashes;
    // ARCHITECTURE.md §7.2 LOD: "dashed linetypes below 1 px per pattern unit → solid". An
    // INSERT's parts with shorter patterns fall back one by one in the draw loop.
    if (!d || d.period * multiplier * scale < 1) return entry.prims;
    let built = d.built.get(multiplier);
    if (!built) d.built.set(multiplier, (built = d.build(multiplier)));
    return built;
  }

  /** A block's entities in draw order: block order, rearranged by its SORTENTSTABLE. */
  #blockOrder(block: Handle): readonly EntityId[] {
    const memo = this.#blockOrders.get(block);
    if (memo) return memo;
    if (!this.#sortTables) {
      this.#sortTables = new Map();
      for (const o of this.#model.objects.values())
        if (isSortEnts(o)) this.#sortTables.set(o.block, o);
    }
    const table = this.#sortTables.get(block);
    const ids = this.#model.blockEntities(block);
    const order = table
      ? drawOrder(
          ids.map((id) => this.#model.ids.handleOf(id)!),
          table.entries,
        ).map((h) => this.#model.ids.idOf(h)!)
      : [...ids];
    this.#blockOrders.set(block, order);
    return order;
  }

  /** A block's draw order and ranks, rebuilt after entities move in or out of it. */
  #orderedOf(block: Handle): Ordered {
    let o = this.#ordered.get(block);
    if (!o) {
      const order = this.#blockOrder(block);
      const rank: number[] = [];
      order.forEach((id, i) => (rank[id] = i));
      o = { order, rank };
      this.#ordered.set(block, o);
    }
    return o;
  }

  /**
   * The cached entries of `block` the index returns for `box`, in draw order; `swap` replaces an
   * entry (a viewport's overridden one, M1-62) or drops it (undefined).
   */
  #visibleEntries(
    block: Handle,
    box: Box,
    swap?: (id: EntityId, entry: CacheEntry) => CacheEntry | undefined,
  ): CacheEntry[] {
    const { order, rank } = this.#orderedOf(block);
    const hits = this.#index.query(block, box);
    const entries: CacheEntry[] = [];
    if (hits.length * 8 > order.length) {
      // Most of the block is in view: mark the hits and walk the block in draw order, which
      // is linear where sorting 100k ids is not.
      if (this.#mark.length < this.#cache.length) this.#mark = new Uint8Array(this.#cache.length);
      const mark = this.#mark;
      for (const id of hits) mark[id] = 1;
      for (const id of order) {
        if (mark[id] !== 1) continue;
        mark[id] = 0;
        const entry = this.#cache[id];
        const shown = entry && swap ? swap(id, entry) : entry;
        if (shown) entries.push(shown);
      }
    } else {
      hits.sort((a, b) => (rank[a] ?? 0) - (rank[b] ?? 0));
      for (const id of hits) {
        const entry = this.#cache[id];
        const shown = entry && swap ? swap(id, entry) : entry;
        if (shown) entries.push(shown);
      }
    }
    return entries;
  }

  /** The frame of the block shown: its coordinates about the view centre. */
  /**
   * The view frame for primitives carried by `s` first: device = V·(s(p) − o) is
   * V·A·(p − s⁻¹(o)) for s(p) = A·p + t, so the linear part composes and the origin goes back
   * through s, keeping the numbers the canvas sees small.
   */
  #dragFrame(view: DrawFrame, s: Matrix2D): DrawFrame {
    const v = view.m;
    const back = invert(s);
    const o = applyPoint(back, { x: view.ox, y: view.oy });
    const corners = [
      applyPoint(back, { x: view.box.minX, y: view.box.minY }),
      applyPoint(back, { x: view.box.maxX, y: view.box.minY }),
      applyPoint(back, { x: view.box.maxX, y: view.box.maxY }),
      applyPoint(back, { x: view.box.minX, y: view.box.maxY }),
    ];
    return {
      ox: o.x,
      oy: o.y,
      m: {
        a: v.a * s.a + v.c * s.b,
        b: v.b * s.a + v.d * s.b,
        c: v.a * s.c + v.c * s.d,
        d: v.b * s.c + v.d * s.d,
        e: v.e,
        f: v.f,
      },
      scale: view.scale * Math.sqrt(Math.abs(s.a * s.d - s.b * s.c)),
      box: {
        minX: Math.min(...corners.map((c) => c.x)),
        minY: Math.min(...corners.map((c) => c.y)),
        maxX: Math.max(...corners.map((c) => c.x)),
        maxY: Math.max(...corners.map((c) => c.y)),
      },
    };
  }

  /** The grips of the objects grips show on, as device-pixel squares. */
  #drawGrips(ctx: Canvas2D): void {
    const grips = this.#grips!;
    const { ox, oy, m } = this.#viewFrame();
    const half = Math.round(GRIP_SIZE * this.#dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const seen = new Set<string>();
    for (const id of grips.ids) {
      const e = this.#model.entity(id);
      if (!e) continue;
      for (const g of gripsOf(e.geom)) {
        const x = Math.round(m.a * (g.point.x - ox) + m.c * (g.point.y - oy) + m.e);
        const y = Math.round(m.b * (g.point.x - ox) + m.d * (g.point.y - oy) + m.f);
        if (seen.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        const hot = grips.hot !== undefined && sameGrip(g.point, grips.hot);
        // A dark edge keeps the grip visible on any background.
        ctx.fillStyle = GRIP_EDGE;
        ctx.fillRect(x - half - 1, y - half - 1, 2 * half + 2, 2 * half + 2);
        ctx.fillStyle = hot ? GRIP_HOT : GRIP_COLOR;
        ctx.fillRect(x - half, y - half, 2 * half, 2 * half);
      }
    }
  }

  #viewFrame(): DrawFrame {
    const k = this.#view.scale * this.#dpr;
    return {
      ox: this.#view.center.x,
      oy: this.#view.center.y,
      m: {
        a: k,
        b: 0,
        c: 0,
        d: -k,
        e: (this.#width * this.#dpr) / 2,
        f: (this.#height * this.#dpr) / 2,
      },
      scale: this.#view.scale,
      box: visibleBox(this.#view, this.#width, this.#height),
    };
  }

  /** The layout's viewports that show model space, in stacking (draw) order. */
  #viewportList(): readonly ViewportEntry[] {
    if (this.#viewports) return this.#viewports;
    const out: ViewportEntry[] = [];
    if (this.#modelBlock) {
      for (const id of this.#orderedOf(this.#block).order) {
        const e = this.#model.entity(id);
        // The viewport's own visibility and layer hide its frame only: AutoCAD shows the
        // view of a viewport whose layer is off (the usual way to hide frames). A frozen
        // layer is taken the same way; AutoCAD's help does not say.
        if (e?.geom.kind !== 'VIEWPORT' || !viewportShowsModel(e.geom)) continue;
        const frozen = e.geom.frozenLayers.length > 0 ? new Set(e.geom.frozenLayers) : undefined;
        out.push({
          handle: e.handle,
          geom: e.geom,
          toPaper: viewportTransform(e.geom),
          frozen,
          layers: viewportLayers(this.#model.tables.layers, e.handle),
          clip: this.#viewportClip(e.geom),
        });
      }
    }
    this.#viewports = out;
    return out;
  }

  /**
   * A non-rectangular viewport's clip outline (M1-62): the paths of the entity DXF 340 names,
   * drawn continuous whatever its layer and visibility (AutoCAD clips by the object's shape;
   * hiding the object's layer is how drafters hide the frame). Undefined, and the frame
   * rectangle clips, without the flag, the entity, or a stroked outline (a wide polyline fills).
   */
  #viewportClip(g: ViewportGeometry): readonly (readonly number[])[] | undefined {
    if ((g.flags & VIEWPORT_NON_RECT_CLIP) === 0 || g.clipBoundary === undefined) return undefined;
    const id = this.#model.ids.idOf(g.clipBoundary);
    const e = id === undefined ? undefined : this.#model.entity(id);
    if (!e) return undefined;
    const paths = tessellate(e.geom, { color: 'foreground' }, this.#tessellate).flatMap((p) =>
      p.kind === 'stroke' ? [p.path] : [],
    );
    return paths.length > 0 ? paths : undefined;
  }

  /**
   * `entry` as viewport `vp` draws it (M1-62): repainted with the viewport's layers when the
   * entity, or a block part of it, is on an overridden layer; otherwise as cached.
   */
  #overriddenEntry(
    vp: ViewportEntry,
    shown: ViewportLayers,
    id: EntityId,
    entry: CacheEntry,
  ): CacheEntry | undefined {
    const over = shown.overridden;
    const affected =
      (entry.layer !== undefined && over.has(entry.layer)) ||
      (entry.blocks !== undefined && entry.prims.some((p) => p.layers?.some((l) => over.has(l))));
    if (!affected) return entry;
    let cache = this.#overridden.get(vp.handle);
    if (!cache) this.#overridden.set(vp.handle, (cache = new Map()));
    if (cache.has(id)) return cache.get(id);
    const e = this.#model.entity(id);
    let built: CacheEntry | undefined;
    if (e) {
      const model = withLayers(this.#model, shown.layers);
      const paint = this.#paint;
      const context = this.#blockSource.insertContext;
      built = this.#entryOf(e, id, model, {
        ...this.#blockSource,
        paint: (x, _m, block) => paint(x, model, block),
        insertContext: (insert, _m, outer) => context(insert, model, outer),
      });
    }
    cache.set(id, built);
    return built;
  }

  #drawScene(reduced: boolean): void {
    this.sceneDraws++;
    this.#sceneEntries = 0;
    const { ctx, canvas } = this.#scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sheet = this.#sheet;
    ctx.fillStyle = this.#surround();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const view = this.#viewFrame();
    if (sheet) this.#drawSheet(ctx, sheet, view);
    this.#drawGrid(ctx, view);
    for (const vp of this.#viewportList()) this.#drawViewport(ctx, vp, view, reduced);
    const entries = this.#visibleEntries(this.#block, view.box);
    this.#sceneEntries += entries.length;
    // MSLTSCALE 1 "scales linetypes displayed on the Model tab by the annotation scale". Read
    // per scene, so a header change needs no re-tessellation (dashes are kept per multiplier).
    const annotation = this.#modelTab ? annotationLinetypeScale(this.#model.header) : undefined;
    this.#drawPrimitives(
      ctx,
      entries,
      reduced,
      annotation === undefined ? view : { ...view, linetypeScale: annotation },
    );
    this.#drawHighlight(ctx, view);
    this.#askForPages();
  }

  /**
   * The selection over the scene (M2-03, UI_SPEC.md §6 "AutoCAD-like highlight (dashed +
   * glow)"): each selected entity's outline as a wide translucent glow, then a dashed line, in
   * the selection colour. Text shows by the boxes of its runs; fills by their outlines.
   */
  #drawHighlight(ctx: Canvas2D, frame: DrawFrame): void {
    if (this.#highlight.size === 0) return;
    const { ox, oy, m, scale, box } = frame;
    const dot = 2 / scale;
    let any = false;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    for (const id of this.#highlight) {
      const entry = this.#cache[id];
      // In a layout the cache holds model space too (for its viewports); only the space shown
      // is selected in.
      if (!entry || this.#model.entity(id)?.owner !== this.#block) continue;
      const r = entry.size / 2;
      if (
        Number.isFinite(entry.size) &&
        (entry.x + r < box.minX ||
          entry.x - r > box.maxX ||
          entry.y + r < box.minY ||
          entry.y - r > box.maxY)
      )
        continue;
      for (const prim of entry.prims) {
        any = true;
        if (prim.kind === 'point') {
          ctx.moveTo(prim.x - ox - dot, prim.y - oy - dot);
          ctx.lineTo(prim.x - ox + dot, prim.y - oy + dot);
        } else if (prim.kind === 'infinite') {
          const seg = clipInfinite(prim, box);
          if (!seg) continue;
          ctx.moveTo(seg.x1 - ox, seg.y1 - oy);
          ctx.lineTo(seg.x2 - ox, seg.y2 - oy);
        } else {
          const runs = prim.text?.greek;
          buildPath(ctx, runs && runs.length > 0 ? runs : (prim.continuous ?? prim.path), ox, oy);
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!any) return;
    const color = this.#style.selection ?? SELECTION_COLOR;
    const px = this.#dpr;
    ctx.strokeStyle = color;
    ctx.globalAlpha = SELECTION_GLOW_ALPHA;
    ctx.lineWidth = SELECTION_GLOW_PX * px;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = px;
    ctx.setLineDash(SELECTION_DASH.map((d) => d * px));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Sends what the scene just drawn needed of each page and its raster does not show (M1-20). */
  #askForPages(): void {
    const needs = this.#underlayNeeds;
    this.#underlayNeeds = new Map();
    const send = this.#onUnderlayRequest;
    if (!send) return;
    for (const [definition, need] of needs) {
      const raster = this.#underlays?.(definition);
      if (raster && rasterCovers(raster, need)) continue;
      const request = underlayRequest(definition, need, raster?.page);
      const key = JSON.stringify(request);
      if (this.#underlayAsked.get(definition) === key) continue;
      this.#underlayAsked.set(definition, key);
      send(request);
    }
  }

  /**
   * GRID (M2-04 part 2): the minor lines faint and the major ones stronger, a device pixel
   * wide on whole pixels, under everything drawn (UI_SPEC.md §6).
   */
  #drawGrid(ctx: Canvas2D, view: DrawFrame): void {
    const spec = this.#style.grid;
    if (!spec) return;
    const lines = gridLines(spec, view.box, this.#view.scale);
    if (!lines) return;
    const { m, ox, oy } = view;
    const w = this.#width * this.#dpr;
    const h = this.#height * this.#dpr;
    const { background, foreground } = this.#style;
    const toward = spec.color ?? foreground;
    const stroke = (xs: readonly number[], ys: readonly number[], mix: number) => {
      ctx.beginPath();
      for (const x of xs) {
        const d = Math.round(m.a * (x - ox) + m.e) + 0.5;
        ctx.moveTo(d, 0);
        ctx.lineTo(d, h);
      }
      for (const y of ys) {
        const d = Math.round(m.d * (y - oy) + m.f) + 0.5;
        ctx.moveTo(0, d);
        ctx.lineTo(w, d);
      }
      ctx.strokeStyle = mixColors(background, toward, mix);
      ctx.lineWidth = this.#dpr;
      ctx.stroke();
    };
    const majorX = new Set(lines.majorXs);
    const majorY = new Set(lines.majorYs);
    stroke(
      lines.xs.filter((x) => !majorX.has(x)),
      lines.ys.filter((y) => !majorY.has(y)),
      spec.color ? 0.5 : GRID_MINOR_MIX,
    );
    stroke(lines.majorXs, lines.majorYs, spec.color ? 1 : GRID_MAJOR_MIX);
  }

  /** The paper in the background colour and the printable area dashed, in device pixels. */
  #drawSheet(ctx: Canvas2D, sheet: LayoutSheet, view: DrawFrame): void {
    const r = this.#deviceRect(sheet.paper, view);
    ctx.fillStyle = this.#style.background;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const p = this.#deviceRect(sheet.printable, view);
    if (p.w <= 0 || p.h <= 0) return;
    ctx.beginPath();
    ctx.rect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.setLineDash(PRINTABLE_DASH.map((d) => d * this.#dpr));
    ctx.strokeStyle = mixColors(this.#style.foreground, this.#style.background, 0.5);
    ctx.lineWidth = this.#dpr;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** A paper-space box on the device, snapped to whole pixels. */
  #deviceRect(b: Box, f: DrawFrame): { x: number; y: number; w: number; h: number } {
    const x0 = Math.round(f.m.a * (b.minX - f.ox) + f.m.e);
    const x1 = Math.round(f.m.a * (b.maxX - f.ox) + f.m.e);
    const y0 = Math.round(f.m.d * (b.maxY - f.oy) + f.m.f);
    const y1 = Math.round(f.m.d * (b.minY - f.oy) + f.m.f);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** One viewport's view of model space, clipped to its frame. */
  #drawViewport(ctx: Canvas2D, vp: ViewportEntry, view: DrawFrame, reduced: boolean): void {
    const frame = viewportFrame(vp.geom);
    const shown = {
      minX: Math.max(frame.minX, view.box.minX),
      minY: Math.max(frame.minY, view.box.minY),
      maxX: Math.min(frame.maxX, view.box.maxX),
      maxY: Math.min(frame.maxY, view.box.maxY),
    };
    if (shown.minX >= shown.maxX || shown.minY >= shown.maxY) return;
    const toModel = invert(vp.toPaper);
    // The model box under the visible part of the frame (a rotated view's corners spread it).
    const corners = [
      [shown.minX, shown.minY],
      [shown.maxX, shown.minY],
      [shown.maxX, shown.maxY],
      [shown.minX, shown.maxY],
    ].map(([x, y]) => ({
      x: toModel.a * x! + toModel.c * y! + toModel.e,
      y: toModel.b * x! + toModel.d * y! + toModel.f,
    }));
    const box = {
      minX: Math.min(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxX: Math.max(...corners.map((p) => p.x)),
      maxY: Math.max(...corners.map((p) => p.y)),
    };
    const shownLayers = vp.layers;
    const entries = this.#visibleEntries(
      this.#modelBlock!,
      box,
      shownLayers ? (id, entry) => this.#overriddenEntry(vp, shownLayers, id, entry) : undefined,
    );
    if (entries.length === 0) return;
    this.#sceneEntries += entries.length;
    // Model coordinates are taken about the model point at the frame centre.
    const o = {
      x: toModel.a * vp.geom.center.x + toModel.c * vp.geom.center.y + toModel.e,
      y: toModel.b * vp.geom.center.x + toModel.d * vp.geom.center.y + toModel.f,
    };
    const t = vp.toPaper;
    const k = view.m.a;
    const m: Matrix2D = {
      a: k * t.a,
      b: -k * t.b,
      c: k * t.c,
      d: -k * t.d,
      e: view.m.e + k * (vp.geom.center.x - view.ox),
      f: view.m.f - k * (vp.geom.center.y - view.oy),
    };
    const clip = this.#deviceRect(shown, view);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    if (vp.clip) {
      // The clip entity's outline, from paper coordinates to the device as the sheet is drawn.
      ctx.setTransform(view.m.a, view.m.b, view.m.c, view.m.d, view.m.e, view.m.f);
      ctx.beginPath();
      for (const path of vp.clip) buildPath(ctx, path, view.ox, view.oy);
      ctx.clip('evenodd');
    }
    const vs = viewportScale(vp.geom);
    this.#drawPrimitives(ctx, entries, reduced, {
      ox: o.x,
      oy: o.y,
      m,
      scale: view.scale * vs,
      box,
      // PSLTSCALE 1: "the dash lengths of a line in a viewport … the same as … in paper space".
      linetypeScale: this.#psltscale ? 1 / vs : 1,
      ...(vp.frozen ? { frozen: vp.frozen } : {}),
    });
    ctx.restore();
  }

  /** Draws entities' primitives, batching consecutive strokes of one colour and width. */
  #drawPrimitives(
    ctx: Canvas2D,
    entries: readonly CacheEntry[],
    reduced: boolean,
    frame: DrawFrame,
  ): void {
    const { ox, oy, m, scale, box, frozen } = frame;
    const ltMul = frame.linetypeScale ?? 1;
    /** Device pixels per drawing unit along a line (what a line width converts by). */
    const k = scale * this.#dpr;
    const devX = (x: number, y: number) => m.a * (x - ox) + m.c * (y - oy) + m.e;
    const devY = (x: number, y: number) => m.b * (x - ox) + m.d * (y - oy) + m.f;
    // Paths are built in world units and stroked in device pixels; switch only when needed.
    let inWorld = false;
    const world = (): void => {
      if (inWorld) return;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      inWorld = true;
    };
    const device = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      inWorld = false;
    };
    device();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Locked-layer fading (M1-69): the canvas alpha is set only when it changes, and is back
    // at 1 when the frame ends.
    const fade = this.#fade();
    // Object transparency (M1-108) multiplies in, unless TRANSPARENCYDISPLAY is off.
    const transparent = this.#style.showTransparency !== false;
    const opacity = (p: RenderPrimitive): number => (transparent ? (p.opacity ?? 1) : 1);
    let alpha = 1;
    const setAlpha = (a: number): void => {
      if (a === alpha) return;
      ctx.globalAlpha = a;
      alpha = a;
    };
    // `entry` is set for a transparent object's strokes: AutoCAD blends each object over what is
    // beneath, so two overlapping transparent objects darken where they cross, and one batch
    // must not hold strokes of two of them.
    let batch:
      { color: string; width: number; alpha: number; entry: CacheEntry | undefined } | undefined;
    const flush = (): void => {
      if (!batch) return;
      device();
      setAlpha(batch.alpha);
      ctx.strokeStyle = batch.color;
      ctx.lineWidth = batch.width;
      ctx.stroke();
      batch = undefined;
    };
    const dot = Math.max(1, Math.round(this.#dpr));
    // XCLIP (M1-103): the clip in force, set by save + clip and lifted by restore, which also
    // puts back the transform and alpha the save saw; parts of one reference share one array,
    // so the clip changes once per run of them.
    let clipped: PrimitiveClip | undefined;
    let alphaAtSave = 1;
    const setClip = (clip: PrimitiveClip | undefined): void => {
      if (clip === clipped) return;
      flush();
      if (clipped) {
        ctx.restore();
        alpha = alphaAtSave;
        inWorld = false;
        device();
      }
      clipped = clip;
      if (!clip) return;
      ctx.save();
      alphaAtSave = alpha;
      world();
      for (const poly of clip) {
        ctx.beginPath();
        for (let i = 0; i + 1 < poly.length; i += 2) {
          if (i === 0) ctx.moveTo(poly[0]! - ox, poly[1]! - oy);
          else ctx.lineTo(poly[i]! - ox, poly[i + 1]! - oy);
        }
        ctx.closePath();
        ctx.clip('nonzero');
      }
    };

    for (const entry of entries) {
      if (frozen && entry.layer !== undefined && frozen.has(entry.layer)) continue;
      const entryAlpha =
        fade && entry.layer !== undefined && fade.locked.has(entry.layer) ? fade.alpha : 1;
      // LOD: an entity under a pixel is a dot, or nothing in a reduced frame.
      if (entry.size * scale < 1) {
        if (reduced) continue;
        const first = entry.prims[0];
        if (!first) continue;
        setClip(undefined);
        flush();
        device();
        setAlpha(entryAlpha * opacity(first));
        ctx.fillStyle = this.#color(first.color);
        ctx.fillRect(
          Math.floor(devX(entry.x, entry.y)),
          Math.floor(devY(entry.x, entry.y)),
          dot,
          dot,
        );
        continue;
      }
      for (const prim of this.#primitives(entry, scale, ltMul)) {
        if (frozen && prim.layers?.some((l) => frozen.has(l))) continue;
        // A missing image's name (M1-109) goes once the app has the image's bitmap.
        if (prim.kind !== 'point' && prim.kind !== 'infinite' && prim.missingImage !== undefined) {
          if (this.#hasBitmap(prim.missingImage)) continue;
        }
        setClip(prim.clip);
        // In a block, a part fades when the reference's layer (the entry's) or a layer below it
        // is locked; AutoCAD's help does not say for the nested case (ambiguity noted, M1-69).
        const a =
          (entryAlpha === 1 && fade && prim.layers?.some((l) => fade.locked.has(l))
            ? fade.alpha
            : entryAlpha) * opacity(prim);
        const color = this.#color(prim.color);
        if (prim.kind === 'point') {
          flush();
          device();
          setAlpha(a);
          ctx.fillStyle = color;
          ctx.fillRect(
            Math.round(devX(prim.x, prim.y) - dot / 2),
            Math.round(devY(prim.x, prim.y) - dot / 2),
            dot,
            dot,
          );
          continue;
        }
        const text = prim.kind === 'infinite' ? undefined : prim.text;
        if (text && text.height * scale < TEXT_LOD_PX) {
          // ARCHITECTURE.md §7.2 LOD: text under 3 px tall → a faint box per run (greeking),
          // which keeps the text's place and colour and costs one fill.
          if (text.greek.length === 0) continue;
          flush();
          world();
          ctx.beginPath();
          buildPath(ctx, text.greek, ox, oy);
          device();
          setAlpha(GREEK_ALPHA * a);
          ctx.fillStyle = color;
          ctx.fill('nonzero');
          continue;
        }
        if (prim.kind === 'fill' && prim.underlay) {
          flush();
          setAlpha(a);
          this.#drawUnderlay(ctx, prim.path, prim.underlay, prim, color, frame);
          inWorld = false;
          continue;
        }
        if (prim.kind === 'fill' && prim.image) {
          flush();
          setAlpha(a);
          this.#drawImage(ctx, prim.path, prim.image, prim, color, frame);
          inWorld = false;
          continue;
        }
        if (prim.kind === 'fill') {
          flush();
          setAlpha(a);
          world();
          ctx.beginPath();
          buildPath(ctx, prim.path, ox, oy);
          const g = prim.gradient;
          if (g) {
            // The gradient is made in its unit frame; a fill paints it through the transform in
            // force when it fills, so that transform is world ∘ frame.
            const f = g.frame;
            const fe = f.e - ox;
            const ff = f.f - oy;
            ctx.setTransform(
              m.a * f.a + m.c * f.b,
              m.b * f.a + m.d * f.b,
              m.a * f.c + m.c * f.d,
              m.b * f.c + m.d * f.d,
              m.a * fe + m.c * ff + m.e,
              m.b * fe + m.d * ff + m.f,
            );
            inWorld = false;
            ctx.fillStyle = this.#gradient(ctx, g);
          } else {
            device();
            ctx.fillStyle = color;
          }
          ctx.fill(prim.evenOdd ? 'evenodd' : 'nonzero');
          if (g) device();
          continue;
        }
        const tint = prim.kind === 'stroke' ? prim.hatch : undefined;
        if (tint && tint.spacing * scale < 1) {
          // ARCHITECTURE.md §7.2 LOD: hatch lines under a pixel apart → the area at their
          // average ink, which is what the lines would paint: a line width of every spacing
          // across them, and each dash (plus its round caps) of every repetition along them.
          // Families tint one by one, so their alphas compound as their lines would overlap.
          flush();
          world();
          ctx.beginPath();
          buildPath(ctx, tint.area, ox, oy);
          device();
          const w = this.#lineWidth(prim.lineweight) / k;
          const across = Math.min(1, w / tint.spacing);
          const along =
            tint.period > 0 ? Math.min(1, (tint.dashLength + tint.marks * w) / tint.period) : 1;
          setAlpha(across * along * a);
          ctx.fillStyle = color;
          ctx.fill(tint.evenOdd ? 'evenodd' : 'nonzero');
          continue;
        }
        const width = this.#lineWidth(prim.lineweight);
        const own = opacity(prim) < 1 ? entry : undefined;
        if (
          !batch ||
          batch.color !== color ||
          batch.width !== width ||
          batch.alpha !== a ||
          batch.entry !== own
        ) {
          flush();
          batch = { color, width, alpha: a, entry: own };
          ctx.beginPath();
        }
        world();
        if (prim.kind === 'infinite') {
          const seg = clipInfinite(prim, box);
          if (!seg) continue;
          const d = prim.dashes;
          // The same LOD as other dashed strokes: under a pixel per repetition, continuous.
          if (d && d.period * scale >= 1) {
            dashInfinite(prim, d, seg, (x1, y1, x2, y2) => {
              ctx.moveTo(x1 - ox, y1 - oy);
              ctx.lineTo(x2 - ox, y2 - oy);
            });
          } else {
            ctx.moveTo(seg.x1 - ox, seg.y1 - oy);
            ctx.lineTo(seg.x2 - ox, seg.y2 - oy);
          }
        } else {
          // LOD for a dashed primitive handed in directly (the transient layer).
          const solid = prim.continuous && (prim.patternLength ?? 0) * scale < 1;
          buildPath(ctx, solid ? prim.continuous! : prim.path, ox, oy);
        }
      }
    }
    flush();
    setClip(undefined);
    setAlpha(1);
  }

  /** Whether the app has a bitmap for an IMAGEDEF this frame (M1-19, M1-109). */
  #hasBitmap(definition: Handle): boolean {
    const pixels = this.#images?.(definition);
    return !!pixels && pixels.width > 0 && pixels.height > 0;
  }

  /**
   * An image fill: its adjusted bitmap through world ∘ frame, clipped to the fill's path; the
   * path outlined while the app has no bitmap. Leaves the canvas transform at identity.
   */
  #drawImage(
    ctx: Canvas2D,
    path: readonly number[],
    im: ImageFill,
    prim: { readonly evenOdd?: boolean; readonly lineweight?: number },
    color: string,
    frame: DrawFrame,
  ): void {
    const { ox, oy, m } = frame;
    const pixels = this.#images?.(im.definition);
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    buildPath(ctx, path, ox, oy);
    if (!pixels || !(pixels.width > 0 && pixels.height > 0)) {
      // AutoCAD shows an image it cannot find by its frame; ours shows the boundary whatever
      // IMAGEFRAME says, so the missing image's place stays visible (ambiguity noted, M1-19).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = color;
      ctx.lineWidth = this.#lineWidth(prim.lineweight);
      ctx.stroke();
      return;
    }
    const layer = this.#bitmap(pixels, im, color);
    ctx.save();
    ctx.clip(prim.evenOdd ? 'evenodd' : 'nonzero');
    // AutoCAD documents draft as lower quality and faster; drawing pixels unsmoothed is ours.
    ctx.imageSmoothingEnabled = this.#imageQuality === 'high';
    // Bitmap pixels → the image's stated pixel grid → world → device.
    const sx = im.width / pixels.width;
    const sy = im.height / pixels.height;
    const f = im.frame;
    const fe = f.e - ox;
    const ff = f.f - oy;
    ctx.setTransform(
      (m.a * f.a + m.c * f.b) * sx,
      (m.b * f.a + m.d * f.b) * sx,
      (m.a * f.c + m.c * f.d) * sy,
      (m.b * f.c + m.d * f.d) * sy,
      m.a * fe + m.c * ff + m.e,
      m.b * fe + m.d * ff + m.f,
    );
    ctx.drawImage(layer.image, 0, 0);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * A PDF underlay (M1-20): what of its page the view needs is noted for `#askForPages`; the
   * page raster the app has is drawn through world ∘ frame, clipped to the boundary or the
   * page, and the boundary (or page) outlined in the entity's colour, as PDFFRAME's initial
   * value 1 shows it. Leaves the canvas transform at identity.
   */
  #drawUnderlay(
    ctx: Canvas2D,
    clipPath: readonly number[],
    u: UnderlayFill,
    prim: { readonly lineweight?: number },
    color: string,
    frame: DrawFrame,
  ): void {
    const { ox, oy, m } = frame;
    const raster = this.#underlays?.(u.definition);
    const need = underlayNeed(u, clipPath, frame.box, frame.scale * this.#dpr, raster?.page);
    if (need) {
      const had = this.#underlayNeeds.get(u.definition);
      this.#underlayNeeds.set(u.definition, had ? mergeNeeds(had, need) : need);
    }
    const path = u.clipped ? clipPath : raster ? pagePath(u.frame, raster.page) : undefined;
    if (!path) return;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const r = raster?.region;
    const px = raster?.pixels;
    if (r && px && px.width > 0 && px.height > 0 && r.maxX > r.minX && r.maxY > r.minY) {
      ctx.save();
      ctx.beginPath();
      buildPath(ctx, path, ox, oy);
      ctx.clip('nonzero');
      // Raster pixels (rows top first) → underlay units → world → device.
      const sx = (r.maxX - r.minX) / px.width;
      const sy = -(r.maxY - r.minY) / px.height;
      const f = u.frame;
      const fa = m.a * f.a + m.c * f.b;
      const fb = m.b * f.a + m.d * f.b;
      const fc = m.a * f.c + m.c * f.d;
      const fd = m.b * f.c + m.d * f.d;
      const fe = f.e - ox;
      const ff = f.f - oy;
      const ex = m.a * fe + m.c * ff + m.e;
      const ey = m.b * fe + m.d * ff + m.f;
      ctx.setTransform(
        fa * sx,
        fb * sx,
        fc * sy,
        fd * sy,
        fa * r.minX + fc * r.maxY + ex,
        fb * r.minX + fd * r.maxY + ey,
      );
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.#page(px, u).image, 0, 0);
      ctx.restore();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    ctx.beginPath();
    buildPath(ctx, path, ox, oy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = this.#lineWidth(prim.lineweight);
    ctx.stroke();
  }

  /** A page raster with the underlay's settings applied, made once per setting and background. */
  #page(pixels: RasterPixels, u: UnderlayFill): Surface {
    const background = this.#style.background;
    const key = `${u.contrast}|${u.fade}|${u.monochrome}|${u.adjustColors}|${background}`;
    let byKey = this.#pages.get(pixels);
    if (!byKey) this.#pages.set(pixels, (byKey = new Map()));
    let layer = byKey.get(key);
    if (!layer) {
      layer = this.#createLayer();
      layer.canvas.width = pixels.width;
      layer.canvas.height = pixels.height;
      const data = layer.ctx.createImageData(pixels.width, pixels.height);
      data.data.set(
        adjustUnderlayPixels(pixels, {
          contrast: u.contrast,
          fade: u.fade,
          monochrome: u.monochrome,
          adjustColors: u.adjustColors,
          background: parseHex(background) ?? BLACK,
        }),
      );
      layer.ctx.putImageData(data, 0, 0);
      byKey.set(key, layer);
    }
    return layer;
  }

  /** The bitmap with the image's settings applied, made once per setting and colours. */
  #bitmap(pixels: RasterPixels, im: ImageFill, color: string): Surface {
    const background = this.#style.background;
    const key = `${im.brightness}|${im.contrast}|${im.fade}|${im.transparent}|${color}|${background}`;
    let byKey = this.#bitmaps.get(pixels);
    if (!byKey) this.#bitmaps.set(pixels, (byKey = new Map()));
    let layer = byKey.get(key);
    if (!layer) {
      layer = this.#createLayer();
      layer.canvas.width = pixels.width;
      layer.canvas.height = pixels.height;
      const data = layer.ctx.createImageData(pixels.width, pixels.height);
      data.data.set(
        adjustPixels(pixels, {
          brightness: im.brightness,
          contrast: im.contrast,
          fade: im.fade,
          transparent: im.transparent,
          color: parseHex(color) ?? WHITE,
          background: parseHex(background) ?? BLACK,
        }),
      );
      layer.ctx.putImageData(data, 0, 0);
      byKey.set(key, layer);
    }
    return layer;
  }

  /** A gradient fill's canvas gradient, in its unit frame, with the colours resolved. */
  #gradient(ctx: Canvas2D, g: FillGradient): CanvasGradient {
    const c1 = this.#color(g.colors[0]);
    const c2 = g.tint === undefined ? this.#color(g.colors[1]) : tintColor(c1, g.tint);
    const out =
      g.kind === 'linear'
        ? ctx.createLinearGradient(0, 0, 1, 0)
        : ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [t, mix] of g.stops) out.addColorStop(t, mixColors(c1, c2, mix));
    return out;
  }

  /**
   * The alpha objects on locked layers draw at (LAYLOCKFADECTL, M1-69), with the locked layers;
   * undefined when nothing fades. AutoCAD fades toward the background; drawing at reduced alpha
   * is the same over empty canvas and lets what lies beneath show through, as its fade does.
   */
  #fade(): { readonly alpha: number; readonly locked: ReadonlySet<Handle> } | undefined {
    const amount = Math.min(LAYLOCKFADE_MAX, this.#style.layLockFade ?? LAYLOCKFADE_DEFAULT);
    if (!(amount > 0)) return undefined;
    if (!this.#locked) {
      const locked = new Set<Handle>();
      for (const l of this.#model.tables.layers.values()) if (l.locked) locked.add(l.handle);
      this.#locked = locked;
    }
    return this.#locked.size > 0 ? { alpha: 1 - amount / 100, locked: this.#locked } : undefined;
  }

  #color(c: PrimitiveColor): string {
    return c === 'foreground'
      ? this.#style.foreground
      : c === 'background'
        ? this.#style.background
        : c;
  }

  /** Device pixels for a lineweight in millimetres; undefined is 1 px. */
  #lineWidth(mm: number | undefined): number {
    const css = lineweightPixels(
      mm === undefined ? 0 : Math.round(mm * 100),
      this.#paperSpace
        ? {
            show: this.#style.showLineweights,
            space: 'paper',
            pixelsPerMillimetre: this.#view.scale * this.#paperUnitsPerMm,
          }
        : { show: this.#style.showLineweights, space: 'model' },
    );
    return css * this.#dpr;
  }
}

/** Replays packed path commands, offset by the view centre. */
/** Whether `p` is inside every XCLIP polygon (nonzero winding, as the canvas clips). */
function insideClips(clip: PrimitiveClip, p: { x: number; y: number }): boolean {
  return clip.every((poly) => {
    let winding = 0;
    for (let i = 0; i + 1 < poly.length; i += 2) {
      const x1 = poly[i]!;
      const y1 = poly[i + 1]!;
      const j = i + 2 < poly.length ? i + 2 : 0;
      const x2 = poly[j]!;
      const y2 = poly[j + 1]!;
      const side = (x2 - x1) * (p.y - y1) - (p.x - x1) * (y2 - y1);
      if (y1 <= p.y) {
        if (y2 > p.y && side > 0) winding++;
      } else if (y2 <= p.y && side < 0) winding--;
    }
    return winding !== 0;
  });
}

function buildPath(ctx: Canvas2D, a: readonly number[], ox: number, oy: number): void {
  for (let i = 0; i < a.length;) {
    switch (a[i]) {
      case PATH_M:
        ctx.moveTo(a[i + 1]! - ox, a[i + 2]! - oy);
        i += 3;
        break;
      case PATH_L:
        ctx.lineTo(a[i + 1]! - ox, a[i + 2]! - oy);
        i += 3;
        break;
      case PATH_A:
        // World y is up and the transform flips it, so increasing angles run CCW in the world.
        ctx.arc(a[i + 1]! - ox, a[i + 2]! - oy, a[i + 3]!, a[i + 4]!, a[i + 5]!, a[i + 6] === 0);
        i += 7;
        break;
      case PATH_E:
        ctx.ellipse(
          a[i + 1]! - ox,
          a[i + 2]! - oy,
          a[i + 3]!,
          a[i + 4]!,
          a[i + 5]!,
          a[i + 6]!,
          a[i + 7]!,
          a[i + 8] === 0,
        );
        i += 9;
        break;
      case PATH_Q:
        ctx.quadraticCurveTo(a[i + 1]! - ox, a[i + 2]! - oy, a[i + 3]! - ox, a[i + 4]! - oy);
        i += 5;
        break;
      case PATH_C:
        ctx.bezierCurveTo(
          a[i + 1]! - ox,
          a[i + 2]! - oy,
          a[i + 3]! - ox,
          a[i + 4]! - oy,
          a[i + 5]! - ox,
          a[i + 6]! - oy,
        );
        i += 7;
        break;
      case PATH_Z:
        ctx.closePath();
        i += 1;
        break;
      default:
        throw new Error(`bad path command ${a[i]} at ${i}`);
    }
  }
}

interface InfiniteSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Distances from the base point along the unit direction. */
  readonly t0: number;
  readonly t1: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * An XLINE's or RAY's linetype over its part on screen, from `t0` to `t1`. The pattern starts
 * at the base point and repeats both ways, so a dash stays where it is while the view moves;
 * AutoCAD documents no start for an infinite line's pattern, and this is what its display
 * shows a drafter (dashes that do not crawl when panning).
 */
function dashInfinite(
  p: Extract<RenderPrimitive, { kind: 'infinite' }>,
  d: { readonly lengths: readonly number[]; readonly period: number },
  seg: InfiniteSegment,
  draw: (x1: number, y1: number, x2: number, y2: number) => void,
): void {
  const at = (t: number): [number, number] => [p.base.x + seg.dx * t, p.base.y + seg.dy * t];
  for (let k = Math.floor(seg.t0 / d.period); k * d.period <= seg.t1; k++) {
    let s = k * d.period;
    for (const len of d.lengths) {
      const e = s + Math.abs(len);
      if (len >= 0) {
        const a = Math.max(s, seg.t0);
        const b = Math.min(e, seg.t1);
        // A dot (or a dash's start on screen) as a zero-length segment the round cap draws.
        if (b > a || (len === 0 && s >= seg.t0 && s <= seg.t1))
          draw(...at(a), ...at(len === 0 ? a : b));
      }
      s = e;
    }
  }
}

/** The part of an XLINE or RAY inside `box` (Liang–Barsky). */
function clipInfinite(
  p: Extract<RenderPrimitive, { kind: 'infinite' }>,
  box: Box,
): InfiniteSegment | undefined {
  const len = Math.hypot(p.direction.x, p.direction.y);
  if (!(len > 0)) return undefined;
  const dx = p.direction.x / len;
  const dy = p.direction.y / len;
  let t0 = p.both ? -Infinity : 0;
  let t1 = Infinity;
  const clip = (q: number, d: number, lo: number, hi: number): boolean => {
    if (d === 0) return q >= lo && q <= hi;
    let a = (lo - q) / d;
    let b = (hi - q) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!clip(p.base.x, dx, box.minX, box.maxX) || !clip(p.base.y, dy, box.minY, box.maxY))
    return undefined;
  return {
    x1: p.base.x + dx * t0,
    y1: p.base.y + dy * t0,
    x2: p.base.x + dx * t1,
    y2: p.base.y + dy * t1,
    t0,
    t1,
    dx,
    dy,
  };
}

const segDist = (
  p: { x: number; y: number },
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / l2)) : 0;
  return Math.hypot(p.x - (ax + t * vx), p.y - (ay + t * vy));
};

/** Whether angle `a` lies on the arc from a0 to a1 in the given direction. */
function onSweep(a: number, a0: number, a1: number, ccw: boolean): boolean {
  const TAU = 2 * Math.PI;
  const norm = (x: number): number => ((x % TAU) + TAU) % TAU;
  const sweep = Math.abs(a1 - a0);
  if (sweep >= TAU - 1e-12) return true;
  return ccw ? norm(a - a0) <= sweep : norm(a0 - a) <= sweep;
}

/** The box around some points. */
function boxAround(points: readonly { x: number; y: number }[]): Box {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** Handles in numeric order (hexadecimal; a longer handle is the larger). */
function compareHandles(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Distance from a world point to a primitive; 0 inside a fill. */
function distanceTo(prim: RenderPrimitive, p: { x: number; y: number }): number {
  if (prim.kind === 'point') return Math.hypot(p.x - prim.x, p.y - prim.y);
  if (prim.kind === 'infinite') {
    const len = Math.hypot(prim.direction.x, prim.direction.y);
    const dx = prim.direction.x / len;
    const dy = prim.direction.y / len;
    let t = (p.x - prim.base.x) * dx + (p.y - prim.base.y) * dy;
    if (!prim.both) t = Math.max(0, t);
    return Math.hypot(p.x - (prim.base.x + t * dx), p.y - (prim.base.y + t * dy));
  }
  // Walk the path, measuring each segment; a fill also counts its inside (even-odd ray test).
  // A dashed stroke is measured along its continuous path, so its gaps pick too.
  const a = prim.continuous ?? prim.path;
  let best = Infinity;
  let crossings = 0;
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;
  const edge = (x: number, y: number): void => {
    best = Math.min(best, segDist(p, px, py, x, y));
    if (py > p.y !== y > p.y && p.x < ((x - px) * (p.y - py)) / (y - py) + px) crossings++;
    px = x;
    py = y;
  };
  for (let i = 0; i < a.length;) {
    switch (a[i]) {
      case PATH_M:
        px = sx = a[i + 1]!;
        py = sy = a[i + 2]!;
        i += 3;
        break;
      case PATH_L:
        edge(a[i + 1]!, a[i + 2]!);
        i += 3;
        break;
      case PATH_A:
      case PATH_E: {
        const isArc = a[i] === PATH_A;
        const [ccx, ccy, rx] = [a[i + 1]!, a[i + 2]!, a[i + 3]!];
        const ry = isArc ? rx : a[i + 4]!;
        const rot = isArc ? 0 : a[i + 5]!;
        const a0 = a[i + (isArc ? 4 : 6)]!;
        const a1 = a[i + (isArc ? 5 : 7)]!;
        const ccw = a[i + (isArc ? 6 : 8)] !== 0;
        if (isArc) {
          const ang = Math.atan2(p.y - ccy, p.x - ccx);
          if (onSweep(ang, a0, a1, ccw))
            best = Math.min(best, Math.abs(Math.hypot(p.x - ccx, p.y - ccy) - rx));
        }
        // Chords for the inside test and the ellipse distance; the arc distance above is exact.
        const n = 64;
        for (let j = 1; j <= n; j++) {
          const t = a0 + ((a1 - a0) * j) / n;
          const ux = rx * Math.cos(t);
          const uy = ry * Math.sin(t);
          edge(
            ccx + ux * Math.cos(rot) - uy * Math.sin(rot),
            ccy + ux * Math.sin(rot) + uy * Math.cos(rot),
          );
        }
        i += isArc ? 7 : 9;
        break;
      }
      case PATH_Q:
      case PATH_C: {
        // Chords of the curve, for the distance and the inside test.
        const q = a[i] === PATH_Q;
        const [x0, y0] = [px, py];
        const n = 16;
        for (let j = 1; j <= n; j++) {
          const t = j / n;
          const u = 1 - t;
          if (q) {
            edge(
              u * u * x0 + 2 * u * t * a[i + 1]! + t * t * a[i + 3]!,
              u * u * y0 + 2 * u * t * a[i + 2]! + t * t * a[i + 4]!,
            );
          } else {
            const [b0, b1, b2, b3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            edge(
              b0 * x0 + b1 * a[i + 1]! + b2 * a[i + 3]! + b3 * a[i + 5]!,
              b0 * y0 + b1 * a[i + 2]! + b2 * a[i + 4]! + b3 * a[i + 6]!,
            );
          }
        }
        i += q ? 5 : 7;
        break;
      }
      case PATH_Z:
        edge(sx, sy);
        i += 1;
        break;
      default:
        i += 1;
    }
  }
  return prim.kind === 'fill' && crossings % 2 === 1 ? 0 : best;
}

/**
 * `model` with `layers` in place of its LAYER table (a viewport's overridden layers, M1-62), for
 * the paint functions, which read tables and the header. Everything else is the model's own.
 */
function withLayers(model: DocumentModel, layers: ReadonlyMap<Handle, LayerRecord>): DocumentModel {
  const tables = { ...model.tables, layers };
  return new Proxy(model, {
    get(target, key) {
      if (key === 'tables') return tables;
      const v: unknown = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
