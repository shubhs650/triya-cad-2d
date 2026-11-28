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
  constraintBars,
  constraintDisplays,
  constraintGripsOf,
  type ConstraintGrip,
  type ConstraintBars,
  type ConstraintDisplay,
  annotationHidden,
  applyPoint,
  PDFFRAME,
  arrayGripPreview,
  movedTableGrip,
  tableGridLines,
  assocArrayOf,
  stretchInside,
  invert,
  layoutSheet,
  stretchGeometry,
  gripsOf,
  hasDynamicColumns,
  withColumnCount,
  gripInfoOf,
  moveGripBy,
  sameGrip,
  translation,
  unionBox,
  type GroupGrip,
  paperUnitsPerMm,
  previewObjects,
  viewportFrame,
  viewportScale,
  viewportShowsModel,
  VIEWPORT_NON_RECT_CLIP,
  viewportLayers,
  viewportTransform,
  ucsOf,
  viewportUcs,
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
  type NestedPick,
  type NonGraphicalObject,
  type RasterVariables,
  type SortEntsTable,
  type SpatialIndex,
  type ViewportGeometry,
} from '@triya/engine';
import {
  expandInsert,
  expands,
  insertClips,
  type BlockSource,
  type HeldBlock,
  type InsertClip,
} from './blocks';
import { createPaint, defaultPaint, LWDEFAULT_INITIAL, type PaintFunction } from './paint';
import { drawOrder } from './style/draw-order';
import { aciRgb, rgbHex } from './style/aci';
import { gridLines, type GridLines, type GridSpec } from './grid';
import { mixColors, parseHex, tintColor } from './style/mix';
import { adjustPixels, imageLabel, type ImageFrames } from './image';
import {
  attributeMode,
  fillMode,
  imageFrames,
  isFrameSetting,
  withLayers,
} from './document-settings';
import {
  adjustUnderlayPixels,
  mergeNeeds,
  pagePath,
  rasterCovers,
  underlayKey,
  underlayNeed,
  underlayRequest,
} from './underlay';
import { annotationLinetypeScale, patternLength } from './style/pattern';
import { lineweightPixels } from './style/resolve';
import {
  primCrosses,
  primCrossesFence,
  primCrossesPolygon,
  primInside,
  primInsidePolygon,
} from './select';
import { patternLibrary, tessellate, type TessellateContext } from './tessellate';
import {
  figureSize,
  pointFigurePath,
  pointHasDot,
  pointStyle,
  type PointStyle,
} from './point-style';
import { columnCounter, type TextContext } from './text';
import {
  annotationalSizes,
  constraintPrimitives,
  DYNAMIC_CONSTRAINT_PX,
  showsLock,
  sizesAt,
  type ConstraintSizes,
} from './constraint-display';
import {
  constraintBarAt,
  constraintBarHoverPrimitives,
  constraintBarPrimitives,
} from './constraint-bars';
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
  GRIP_COLORS_DEFAULT,
  gripHalfSize,
  screenToWorld,
  visibleBox,
  type ConstraintBarHit,
  type ConstraintBarStyle,
  type ConstraintStyle,
  type DrawnEntity,
  type FillGradient,
  type GripColors,
  type ImageFill,
  type PrimitiveClip,
  type PrimitiveColor,
  type RasterPixels,
  type RefEditDisplay,
  type RenderPrimitive,
  type RenderStyle,
  type Renderer,
  type ScreenRect,
  type SelectQuery,
  type SelectionPreview,
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
   * a clipped underlay then shows its boundary, an unclipped one nothing. Asked by
   * `underlayKey`: the definition's handle, with the layers turned off when any are.
   */
  readonly underlays?: (page: string) => UnderlayRaster | undefined;
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
  /** The entity drawn, which fades while a reference is edited in place unless in the working set. */
  readonly id?: EntityId;
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
  /** Every entry drawn this much faded (a command preview's faded objects, M3-12 part 6). */
  readonly alpha?: number;
}

/** A POINT shown as its PDMODE figure, which the view sizes (M3-01 part 4). */
function hasFigure(entry: CacheEntry): boolean {
  const p = entry.prims[0];
  return p?.kind === 'point' && p.figure !== undefined;
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
/** A dotted grid's dots, stronger than the minor lines as a dot covers so little. */
const GRID_DOT_MIX = 0.6;
/** The selection highlight (M2-03): colour, glow width and alpha, and dash, in CSS pixels. */
const SELECTION_COLOR = '#4da3ff';
/** The current viewport's frame (MSPACE, M6-02 part 3), CSS pixels wide. */
const ACTIVE_VIEWPORT_PX = 3;
/**
 * The border round the drawing area while a layout viewport is maximized (VPMAX, M6-02 part 7):
 * AutoCAD draws it red, whatever the background, so the state is not mistaken for the Model tab.
 */
export const MAXIMIZED_VIEWPORT_COLOR = '#e0301e';
const MAXIMIZED_VIEWPORT_PX = 2;
const SELECTION_GLOW_PX = 5;
const SELECTION_GLOW_ALPHA = 0.35;
const SELECTION_DASH = [4, 3];
/**
 * COMMANDPREVIEW (M3-12 part 6): how much of the objects a command's pick would change shows
 * while its preview is drawn over them (AutoCAD fades them; its help gives no amount).
 */
export const COMMAND_PREVIEW_FADE = 0.3;
/**
 * The selection preview (M3-04 part 5): the selection's glow with a solid line this wide, CSS
 * pixels. AutoCAD previews an object thickened (its retired PREVIEWEFFECT's "thickened lines");
 * solid, it tells apart from the dashed selection.
 */
const PREVIEW_LINE_PX = 2;

export const DEFAULT_STYLE: RenderStyle = {
  background: '#212830',
  foreground: '#ffffff',
  showLineweights: false,
};

/** The paint for a style's LWDEFAULT: the shared default one at AutoCAD's initial 25. */
function paintFor(style: RenderStyle): PaintFunction {
  const lw = style.lineweightDefault ?? LWDEFAULT_INITIAL;
  return lw === LWDEFAULT_INITIAL ? defaultPaint : createPaint({ lwDefault: lw });
}

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
/** XFADECTL (M5-02 part 5): AutoCAD's initial value, and the most it fades (its range is 0…90). */
const XFADE_DEFAULT = 50;
const XFADE_MAX = 90;
/** Header variables that change how every entity is painted. */
const PAINT_HEADER = new Set([
  '$LTSCALE',
  '$FILLMODE',
  '$ATTMODE',
  '$XCLIPFRAME',
  '$PDMODE',
  '$PDSIZE',
]);

const isSortEnts = (o: NonGraphicalObject): o is SortEntsTable => o.type === 'SORTENTSTABLE';

const WHITE = [255, 255, 255] as const;
const BLACK = [0, 0, 0] as const;

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
 * Grips (M2-06 part 2): their size is the style's GRIPSIZE (`gripHalfSize`, M2-59 part 3), their
 * colours its GRIPCOLOR, GRIPHOVER (M3-05 part 2: the grip under the cursor), GRIPHOT and
 * GRIPCONTOUR (the edge that keeps a grip visible on any background), AutoCAD's initial ACI 150,
 * 11, 12 and 251 unless set (M3-05 part 5).
 */
function gripPalette(c: GripColors | undefined) {
  const hex = (aci: number) => rgbHex(aciRgb(aci));
  const g = c ?? GRIP_COLORS_DEFAULT;
  return {
    unselected: hex(g.unselected),
    hover: hex(g.hover),
    selected: hex(g.selected),
    contour: hex(g.contour),
  };
}

/** DXF 90 bits 32 and 64 of a VIEWPORT: UCSICON on, and at the UCS origin (M3-06 part 8). */
const VIEWPORT_UCS_ICON = 32;
const VIEWPORT_UCS_ICON_AT_ORIGIN = 64;
/** A viewport's UCS icon: its arms and its corner's distance from the frame, CSS pixels. */
const UCS_ICON_ARM = 24;
const UCS_ICON_MARGIN = 6;

/**
 * A triangular grip centred on (x, y) pointing along the unit (ux, uy), in device pixels, its
 * dark edge drawn first as the square grips' is.
 */
function arrowGrip(
  ctx: Canvas2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  half: number,
  fill: string,
  contour: string,
): void {
  const corners = (r: number): [[number, number], [number, number], [number, number]] => [
    [x + ux * 1.4 * r, y + uy * 1.4 * r],
    [x - ux * r - uy * 1.2 * r, y - uy * r + ux * 1.2 * r],
    [x - ux * r + uy * 1.2 * r, y - uy * r - ux * 1.2 * r],
  ];
  for (const [style, r] of [
    [contour, half + 1],
    [fill, half],
  ] as const) {
    const [a, b, c] = corners(r);
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fill();
  }
}

/** The id an object being placed is drawn under: no object of the drawing has it. */
const ADDING = -1 as EntityId;

/** An MTEXT's dynamic columns counted as its text needs them now (a column grip's preview). */
function recounted(g: EntityGeometry, text: TextContext | undefined): EntityGeometry {
  if (g.kind !== 'MTEXT' || !text || !hasDynamicColumns(g)) return g;
  const n = columnCounter(text)(g);
  return n === undefined ? g : withColumnCount(g, n);
}

/** A dimension without its block, so the engine draws it (a STRETCH preview, M2-10 part 3). */
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
  /** The objects' paint; replaced when LWDEFAULT changes, unless the caller supplied it. */
  #paint: PaintFunction;
  readonly #ownPaint: boolean;
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
    points?: PointStyle;
  } = {};
  readonly #createLayer: () => Surface;
  readonly #images: ((definition: Handle) => RasterPixels | undefined) | undefined;
  readonly #underlays: ((page: string) => UnderlayRaster | undefined) | undefined;
  readonly #onUnderlayRequest: ((request: UnderlayRequest) => void) | undefined;
  /**
   * What the scene being drawn needs of each page (`underlayKey`), merged over every underlay
   * showing it, with one of those underlays for its definition and layers.
   */
  #underlayNeeds = new Map<
    string,
    { readonly u: UnderlayFill; readonly need: { readonly scale: number; readonly region: Box } }
  >();
  /** The last request sent per page, as a key, so an unanswerable one is not sent again. */
  #underlayAsked = new Map<string, string>();
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
  #paperSpace = false;
  /**
   * The layout whose block is shown (Model's or a sheet's); a change set that updates it
   * (renamed, new page setup or flags, M1-97) re-reads what follows from it.
   */
  #layoutHandle: Handle | undefined;
  /** Paper drawing units per millimetre, from the layout's page setup (M1-18). */
  #paperUnitsPerMm = 1;
  /** The layout's PSLTSCALE (DXF 70 bit 1): viewport linetypes in paper units. */
  #psltscale = true;
  /** The block shown is model space: the Model tab, where MSLTSCALE applies (M1-63). */
  #modelTab = false;
  /** The layout's sheet, when the block shown is a set-up layout. */
  #sheet: LayoutSheet | undefined;
  /** Model space, when the block shown is a layout whose viewports show it. */
  #modelBlock: Handle | undefined;
  /**
   * The floating viewport made current (MSPACE, M6-02 part 3): picks, windows, snaps and what
   * is drawn over the scene (selection, grips, previews) are model space's, through it.
   */
  #active: Handle | undefined;
  /**
   * The current viewport maximized (VPMAX, M6-02 part 7): the geometry it is drawn with, framed by
   * the whole canvas; the sheet, paper space's objects and the other viewports are not drawn.
   */
  #maximized: ViewportGeometry | undefined;
  /** `#activeViewport()` of the entry and maximized geometry it was made for. */
  #maximizedEntry:
    | { readonly of: ViewportEntry; readonly geom: ViewportGeometry; readonly entry: ViewportEntry }
    | undefined;
  /** The layout's model-space viewports in stacking order; undefined until first needed. */
  #viewports: readonly ViewportEntry[] | undefined;
  /**
   * Per viewport with layer overrides (M1-62): the entries of entities those overrides restyle,
   * built on first draw and dropped by every change set (they are rare and few).
   */
  #overridden = new Map<Handle, Map<EntityId, CacheEntry | undefined>>();

  /** Per entity id (ids are dense): its primitives and screen-size data; hidden ones absent. */
  #cache: (CacheEntry | undefined)[] = [];

  /** The scene cache's size, for the diagnostics panel (M7-08): walked when asked. */
  sceneSize(): { readonly entities: number; readonly primitives: number } {
    let entities = 0;
    let primitives = 0;
    for (const e of this.#cache) {
      if (!e) continue;
      entities += 1;
      primitives += e.prims.length;
    }
    return { entities, primitives };
  }
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
  /** The dimensional constraints drawn selected (M9-03 part 10), by handle. */
  #highlightConstraints: ReadonlySet<Handle> = new Set();
  /** The drawing's dimensional constraints as they show (M9-03 part 4), until a change. */
  #constraints: readonly ConstraintDisplay[] | undefined;
  /** The drawing's constraint bars as they are laid out (M9-05 part 2), until a change. */
  #bars: ConstraintBars | undefined;
  /** The constraint bar's icon, square or panel under the cursor (M9-05 part 4). */
  #barHover: ConstraintBarHit | undefined;
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
        /** An array's items remade by its grip (M3-05 part 7): a block's entry through `m`. */
        readonly items: readonly { readonly entry: CacheEntry; readonly m: Matrix2D }[];
        /** A command preview's faded objects (M3-12 part 6), left out of the scene. */
        readonly faded: readonly CacheEntry[];
      }
    | undefined;
  /** The array preview's blocks tessellated once per drag: an INSERT of each at its base. */
  #itemBlocks = new Map<string, CacheEntry | undefined>();
  /** The objects a command preview fades (M3-12 part 6): the scene leaves them out. */
  #faded: ReadonlySet<EntityId> = new Set();
  /**
   * The objects grips show on, and the hot grip (M2-06 part 2); the groups shown by one grip
   * each (GROUPDISPLAYMODE, M3-13).
   */
  #grips:
    | {
        readonly ids: readonly EntityId[];
        readonly hot: Vec2 | undefined;
        readonly groups: readonly GroupGrip[];
        /** The dimensional constraints selected, showing their grips (M9-03 part 11). */
        readonly constraints: readonly Handle[];
      }
    | undefined;
  /** The cursor, and how near a grip counts as under it (M3-05 part 2), for GRIPHOVER. */
  #gripHover: { readonly at: Vec2; readonly within: number } | undefined;
  /** The objects the selection preview highlights (M3-04 part 5). */
  #previewed: readonly EntityId[] = [];
  /** The locked layers (M1-69), found again after a layer change; undefined until needed. */
  #locked: ReadonlySet<Handle> | undefined;
  /** The reference edited in place (M5-02 part 5): its working set and its block as it was. */
  #refEdit: { readonly held: HeldBlock; readonly working: ReadonlySet<EntityId> } | undefined;
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
    this.#ownPaint = o.paint === undefined;
    this.#paint = o.paint ?? paintFor(this.#style);
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
    this.#tessellate.points = pointStyle(this.#model);
    this.#imageQuality = imageQuality(this.#model);
    if (o.patterns?.length) this.#tessellate.patterns = patternLibrary(o.patterns);
    this.#blockSource = {
      model: this.#model,
      // Through `#paint`, which an LWDEFAULT change replaces.
      paint: (e, model, block) => this.#paint(e, model, block),
      insertContext: (insert, model, outer) =>
        (this.#paint.insertContext ?? defaultPaint.insertContext)(insert, model, outer),
      order: (block) => this.#blockOrder(block),
      tessellate: this.#tessellate,
      clip: (insert) => (this.#clips ??= insertClips(this.#model))(insert),
      held: () => this.#refEdit?.held,
    };
    this.#now = o.now ?? (() => performance.now());
    this.#requestIdle = o.requestIdle ?? ((cb) => setTimeout(cb, 50));
    this.#identify();
    this.#cacheBlock();
  }

  /**
   * Which space the block shown is: model space, or a layout's sheet with its page setup. Read
   * as the canvas is made, and again when the change set that makes its layout arrives (LAYOUT
   * New, M6-01: a canvas made for a layout added since the drawing opened starts from the
   * drawing as it opened, before the change log it is handed).
   */
  #identify(): void {
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

  /** The display style drawn with now. */
  get style(): RenderStyle {
    return this.#style;
  }

  setStyle(style: RenderStyle): void {
    const lwDefault = this.#style.lineweightDefault;
    const allVisible = this.#style.annotationAllVisible !== false;
    this.#style = style;
    // CONSTRAINTNAMEFORMAT may have changed the constraints' text.
    this.#constraints = undefined;
    // ANNOALLVISIBLE turned (M6-03): the annotative objects it hides or shows are cached again.
    if (this.#modelTab && (style.annotationAllVisible !== false) !== allVisible) this.#cacheBlock();
    // LWDEFAULT changed (M5-08 part 3): Default lineweights are resolved with the paint, at
    // cache time, so every object is resolved again, as for a layer change.
    if (
      this.#ownPaint &&
      (style.lineweightDefault ?? LWDEFAULT_INITIAL) !== (lwDefault ?? LWDEFAULT_INITIAL)
    ) {
      this.#paint = paintFor(style);
      this.#cacheBlock();
    }
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

  setActiveViewport(handle: Handle | undefined, maximized?: ViewportGeometry): void {
    const max = handle === undefined ? undefined : maximized;
    if (handle === this.#active && max === this.#maximized) return;
    this.#active = handle;
    this.#maximized = max;
    // The selection is drawn with the scene, the current viewport's bold frame with the rest.
    this.#sceneDirty = this.#transientDirty = true;
  }

  /**
   * The current viewport (MSPACE), while it shows model space; maximized (VPMAX), with the
   * geometry that frames it by the canvas.
   */
  #activeViewport(): ViewportEntry | undefined {
    const h = this.#active;
    const vp = h === undefined ? undefined : this.#viewportList().find((v) => v.handle === h);
    const geom = this.#maximized;
    if (!vp || !geom) return vp;
    const made = this.#maximizedEntry;
    if (made?.of === vp && made.geom === geom) return made.entry;
    const entry = { ...vp, geom, toPaper: viewportTransform(geom), clip: undefined };
    this.#maximizedEntry = { of: vp, geom, entry };
    return entry;
  }

  /** The current viewport while it is maximized (VPMAX), framed by the canvas. */
  #maximizedViewport(): ViewportEntry | undefined {
    return this.#maximized ? this.#activeViewport() : undefined;
  }

  /** The block picks and windows take objects of: model space while a viewport is current. */
  #pickBlock(): Handle {
    return this.#activeViewport() ? this.#modelBlock! : this.#block;
  }

  /** The block picks, windows and snaps take objects of (`#pickBlock`). */
  get pickBlock(): Handle {
    return this.#pickBlock();
  }

  /**
   * The frame what is drawn over the scene is drawn in: model space's through the current
   * viewport, clipped to it on `ctx` (restore it after), else the view's.
   */
  #overlayFrame(ctx: Canvas2D, view: DrawFrame = this.#viewFrame()): DrawFrame {
    const vp = this.#activeViewport();
    if (!vp) return view;
    const through = this.#throughViewport(vp, view);
    if (!through) {
      // The frame is out of view: nothing of model space shows.
      this.#clipTo(ctx, vp, view, { x: 0, y: 0, w: 0, h: 0 });
      return view;
    }
    this.#clipTo(ctx, vp, view, through.clip);
    return through.frame;
  }

  /** Clips `ctx` to the viewport's frame (device rectangle `rect`) and its clip outline. */
  #clipTo(
    ctx: Canvas2D,
    vp: ViewportEntry,
    view: DrawFrame,
    rect: { x: number; y: number; w: number; h: number },
  ): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    if (vp.clip) {
      // The clip entity's outline, from paper coordinates to the device as the sheet is drawn.
      ctx.setTransform(view.m.a, view.m.b, view.m.c, view.m.d, view.m.e, view.m.f);
      ctx.beginPath();
      for (const path of vp.clip) buildPath(ctx, path, view.ox, view.oy);
      ctx.clip('evenodd');
    }
  }

  /**
   * The current viewport's frame drawn bold (AutoCAD outlines the viewport made current with a
   * heavier border), in the foreground colour, on the transient layer.
   */
  #drawActiveFrame(ctx: Canvas2D): void {
    const vp = this.#activeViewport();
    if (!vp) return;
    if (this.#maximized) return this.#drawMaximizedBorder(ctx);
    const view = this.#viewFrame();
    const { m } = view;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    if (vp.clip) for (const path of vp.clip) buildPath(ctx, path, view.ox, view.oy);
    else {
      const f = viewportFrame(vp.geom);
      buildPath(
        ctx,
        [
          PATH_M,
          f.minX,
          f.minY,
          PATH_L,
          f.maxX,
          f.minY,
          PATH_L,
          f.maxX,
          f.maxY,
          PATH_L,
          f.minX,
          f.maxY,
          PATH_Z,
        ],
        view.ox,
        view.oy,
      );
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = this.#style.foreground;
    ctx.lineWidth = ACTIVE_VIEWPORT_PX * this.#dpr;
    ctx.stroke();
  }

  /** The red border round the canvas while a viewport is maximized (VPMAX, M6-02 part 7). */
  #drawMaximizedBorder(ctx: Canvas2D): void {
    const w = MAXIMIZED_VIEWPORT_PX * this.#dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(w / 2, w / 2, this.#width * this.#dpr - w, this.#height * this.#dpr - w);
    ctx.strokeStyle = MAXIMIZED_VIEWPORT_COLOR;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  setHighlight(ids: readonly EntityId[], constraints: readonly Handle[] = []): void {
    const none = ids.length === 0 && constraints.length === 0;
    if (none && this.#highlight.size === 0 && this.#highlightConstraints.size === 0) return;
    this.#highlight = new Set(ids);
    this.#highlightConstraints = new Set(constraints);
    this.#sceneDirty = this.#contentDirty = true;
  }

  constraintAt(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
    view: ViewTransform = this.#view,
  ): Handle | null {
    const p = screenToWorld(view, this.#width, this.#height, screen);
    const r = aperture / view.scale;
    let best: { handle: Handle; d: number } | undefined;
    for (const { handle, prims } of this.#pickableConstraints(view)) {
      for (const prim of prims) {
        const dist = distanceTo(prim, p);
        if (dist <= r && (!best || dist < best.d)) best = { handle, d: dist };
      }
    }
    return best?.handle ?? null;
  }

  constraintsIn(query: SelectQuery, view: ViewTransform = this.#view): Handle[] {
    const poly = query.polygon;
    const test: (p: RenderPrimitive) => boolean = poly
      ? query.kind === 'window'
        ? (p) => primInsidePolygon(p, poly)
        : query.kind === 'crossing'
          ? (p) => primCrossesPolygon(p, poly)
          : (p) => primCrossesFence(p, poly)
      : query.kind === 'window'
        ? (p) => primInside(p, query.box)
        : (p) => primCrosses(p, query.box);
    const all = query.kind === 'window' ? 'every' : 'some';
    const out: Handle[] = [];
    for (const { handle, prims } of this.#pickableConstraints(view)) {
      if (prims.length > 0 && prims[all](test)) out.push(handle);
    }
    return out;
  }

  /**
   * The dimensional constraints a pick or a window can take in `view` (M9-03 parts 10 and 14),
   * each with the primitives it is taken by: its text (its runs' boxes, as an object's text is
   * taken anywhere in them), dimension line or arc and arrows, not its extension lines. None on
   * a layout but through the viewport made current (M9-03 part 13), where `view` is its model
   * view; none hidden, nor one whose objects are all on layers frozen in that viewport.
   */
  *#pickableConstraints(
    view: ViewTransform,
  ): Generator<{ readonly handle: Handle; readonly prims: readonly RenderPrimitive[] }> {
    const vp = this.#modelTab ? undefined : this.#activeViewport();
    if (!this.#modelTab && !vp) return;
    const look = this.#style.constraints;
    this.#constraints ??= constraintDisplays(this.#model, look?.nameFormat ?? 2);
    for (const d of this.#constraints) {
      if (vp?.frozen && this.#constraintFrozen(d, vp.frozen)) continue;
      const sizes = this.#constraintSizes(d, look, view.scale);
      if (!sizes) continue;
      const prims: RenderPrimitive[] = [];
      for (const prim of constraintPrimitives(
        d,
        sizes,
        'foreground',
        this.#tessellate.text,
        false,
        showsLock(d, look?.lockIcon),
      )) {
        prims.push(prim);
        if (prim.kind !== 'infinite' && prim.kind !== 'point' && prim.text) {
          prims.push({ kind: 'fill', path: prim.text.greek, color: '' });
        }
      }
      yield { handle: d.handle, prims };
    }
  }

  setRefEdit(display: RefEditDisplay | undefined): void {
    const was = this.#refEdit?.held;
    const same =
      was !== undefined &&
      display !== undefined &&
      was.block === display.block &&
      sameIds(was.path, display.path) &&
      sameIds(this.#refEditOrder ?? [], display.order) &&
      was.entities.size === display.held.length &&
      display.held.every((e) => was.entities.get(e.id) === e);
    if (!display) {
      if (!this.#refEdit) return;
      this.#refEdit = this.#refEditOrder = undefined;
      this.#heldRefs.clear();
    } else {
      const held: HeldBlock = same
        ? was
        : {
            block: display.block,
            path: display.path,
            order: this.#heldOrder(display.block, display.order),
            entities: new Map(display.held.map((e) => [e.id, e])),
          };
      if (!same) this.#refEditOrder = display.order;
      this.#refEdit = { held, working: new Set(display.working) };
    }
    // The references drawing the block (directly or nested) draw it again, as it was or as it is.
    if (!same) {
      const blocks = new Set<Handle>();
      if (was) blocks.add(was.block);
      if (display) blocks.add(display.block);
      this.#cache.forEach((entry, id) => {
        if (entry?.blocks && [...blocks].some((b) => entry.blocks!.has(b))) this.#cacheEntity(id);
      });
    }
    this.#sceneDirty = this.#contentDirty = true;
  }

  /** The cached references drawing the block edited in place as it was (`#entryOf`). */
  readonly #heldRefs = new Set<EntityId>();

  /** The block order REFEDIT's display was given, to know it again (`setRefEdit`). */
  #refEditOrder: readonly EntityId[] | undefined;

  /** `order` (a block's entities in block order) in draw order, by the block's SORTENTSTABLE. */
  #heldOrder(block: Handle, order: readonly EntityId[]): readonly EntityId[] {
    if (!this.#sortTables) {
      this.#sortTables = new Map();
      for (const o of this.#model.objects.values())
        if (isSortEnts(o)) this.#sortTables.set(o.block, o);
    }
    const table = this.#sortTables.get(block);
    if (!table) return order;
    const handles = order.map((id) => this.#model.ids.handleOf(id));
    if (handles.some((h) => h === undefined)) return order;
    return drawOrder(handles as Handle[], table.entries).map((h) => this.#model.ids.idOf(h)!);
  }

  setDrag(motion: DragMotion | undefined): void {
    this.#setFaded(motion?.preview?.faded ?? []);
    if (!motion) {
      this.#itemBlocks.clear();
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
      const inside = stretchInside({ box: s.window, ...(s.polygon && { polygon: s.polygon }) });
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
        const own = gripInfoOf(this.#model, e);
        // Ctrl held with a table's column grip sizes the table (M4-05 part 6).
        const info = g.ctrl && own && 'tableStyle' in own ? { ...own, ctrl: true as const } : own;
        const r = moveGripBy(e.geom, g.from, g.to, info, g.fn);
        if (r.kind === 'move') gripMoved.push(this.#cache[id]);
        if (r.kind !== 'shape') continue;
        if (r.geom.kind === 'ACAD_TABLE') {
          // A table's grip sizes its rows or columns (M4-05 part 4): its grid as it would be,
          // its block being drawn again only once the grip is placed.
          const style = info && 'tableStyle' in info ? info.tableStyle : undefined;
          for (const line of tableGridLines(r.geom, style)) {
            const entry = this.#entryOf({ ...e, geom: line }, id, this.#model, this.#blockSource);
            if (entry) stretched.push(entry);
          }
          continue;
        }
        // A dimension's grip reshapes it and the engine regenerates it (M2-11): drawn afresh.
        // A column grip's dynamic columns take what the text needs, as they will (M2-26 part 2).
        const geom = recounted(unblocked(r.geom), this.#tessellate.text);
        const entry = this.#entryOf({ ...e, geom }, id, this.#model, this.#blockSource);
        if (entry) stretched.push(entry);
      }
    }
    // A grip of the table cells selected (TABLECELL, M4-05 part 6): the table's grid as it would
    // be, its block drawn again once the grip is placed.
    const t = motion.table;
    const te = t && this.#model.entity(t.id);
    if (t && te?.geom.kind === 'ACAD_TABLE' && this.#cache[t.id]) {
      const info = gripInfoOf(this.#model, te);
      const style = info && 'tableStyle' in info ? info.tableStyle : undefined;
      const moved = movedTableGrip(te.geom, style, t.role, t.d);
      for (const line of moved ? tableGridLines(moved, style) : []) {
        const entry = this.#entryOf({ ...te, geom: line }, t.id, this.#model, this.#blockSource);
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
        owner: this.#pickBlock(),
        layer: a.layer,
        color: { kind: 'byLayer' },
        linetype: 'ByLayer',
        lineweight: 'ByLayer',
        transparency: 'ByLayer',
        ltScale: 1,
        visible: true,
        geom: unblocked(a.geom),
        ...(a.xdata && { xdata: a.xdata }),
      };
      const entry = this.#entryOf(e, ADDING, this.#model, this.#blockSource);
      if (entry) stretched.push(entry);
    }
    // A command preview (M3-12 part 6): each shape as an object with its properties would be
    // drawn, over the objects it changes, which are faded.
    const faded: CacheEntry[] = [];
    const pv = motion.preview;
    for (const fid of pv?.faded ?? []) {
      const entry = this.#cache[fid];
      if (entry) faded.push(entry);
    }
    for (const shape of pv?.shapes ?? []) {
      const e: Entity = {
        id: ADDING,
        handle: '',
        type: shape.geom.kind,
        owner: this.#pickBlock(),
        ...shape.props,
        visible: true,
        geom: unblocked(shape.geom),
      };
      const entry = this.#entryOf(e, ADDING, this.#model, this.#blockSource);
      if (entry) stretched.push(entry);
    }
    const gripMove = g ? translation(g.to.x - g.from.x, g.to.y - g.from.y) : motion.m;
    const items = motion.array ? this.#arrayItems(motion.array) : [];
    this.#drag = { moved, m: motion.m, stretched, gripMoved, gripMove, items, faded };
    this.#transientDirty = true;
  }

  /**
   * The array a grip drag would make (M3-05 part 7): each item's block, tessellated once per
   * drag as an INSERT of it at its base point carrying the array's properties (its items' are
   * ByBlock), drawn through the item's transform.
   */
  #arrayItems(a: NonNullable<DragMotion['array']>): { entry: CacheEntry; m: Matrix2D }[] {
    const insert = this.#model.entity(a.id);
    const record = insert && assocArrayOf(this.#model.objects.values(), insert);
    if (!insert || !record || insert.geom.kind !== 'INSERT') return [];
    const shown = arrayGripPreview(this.#model, insert, record, a.role, a.fn, a.to) ?? [];
    const out: { entry: CacheEntry; m: Matrix2D }[] = [];
    for (const { block, m } of shown) {
      const key = `${a.id}:${block}`;
      if (!this.#itemBlocks.has(key)) {
        const base = this.#model.blocks.get(block)?.basePoint ?? { x: 0, y: 0 };
        const geom = {
          ...insert.geom,
          block,
          position: base,
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        };
        delete (geom as { array?: unknown }).array;
        const entry = this.#entryOf({ ...insert, geom }, a.id, this.#model, this.#blockSource);
        this.#itemBlocks.set(key, entry);
      }
      const entry = this.#itemBlocks.get(key);
      if (entry) out.push({ entry, m });
    }
    return out;
  }

  /**
   * The objects a command preview fades (M3-12 part 6): the scene is drawn again without them,
   * only when they change, and the transient layer draws them faded.
   */
  #setFaded(ids: readonly EntityId[]): void {
    const was = this.#faded;
    if (ids.length === was.size && ids.every((id) => was.has(id))) return;
    this.#faded = new Set(ids);
    this.#sceneDirty = this.#contentDirty = true;
  }

  /**
   * The objects to show grips on, the hot one red (M2-06 part 2); undefined or none hides them.
   * Grips are drawn at the style's GRIPSIZE in GRIPCOLOR (ACI 150) and GRIPHOT (ACI 12), over
   * everything, AutoCAD's defaults.
   */
  setGrips(
    ids: readonly EntityId[],
    hot?: Vec2,
    groups: readonly GroupGrip[] = [],
    constraints: readonly Handle[] = [],
  ): void {
    const shown = ids.length > 0 || groups.length > 0 || constraints.length > 0;
    if (!shown && !this.#grips) return;
    this.#grips = shown ? { ids, hot, groups, constraints } : undefined;
    this.#transientDirty = true;
  }

  /**
   * The grips of the dimensional constraints selected (M9-03 part 11): on the Model tab, or on a
   * layout through the viewport made current (M9-03 part 13), where they are picked.
   */
  #constraintGrips(): ConstraintGrip[] {
    const handles = this.#grips?.constraints ?? [];
    if (handles.length === 0 || (!this.#modelTab && !this.#activeViewport())) return [];
    return handles.flatMap((h) => constraintGripsOf(this.#model, h));
  }

  /**
   * A selected group's one grip (GROUPDISPLAYMODE, M3-13): the centre of its objects' extents as
   * the spatial index bounds them, the point the engine asks the canvas for (`bounds`), and that
   * box. None for objects without extents.
   */
  #groupGrips(): { readonly center: Vec2; readonly box: Box | undefined }[] {
    const out: { center: Vec2; box: Box | undefined }[] = [];
    for (const g of this.#grips?.groups ?? []) {
      let box: Box | undefined;
      for (const id of g.ids) {
        const b = this.#index.bounds(id);
        if (b?.kind === 'box') box = box ? unionBox(box, b.box) : b.box;
      }
      if (!box) continue;
      const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      out.push({ center, box: g.box ? box : undefined });
    }
    return out;
  }

  /**
   * Where the cursor is, for the grip under it to draw in GRIPHOVER (ACI 11, AutoCAD's initial
   * colour, M3-05 part 2): the grip nearest it within `within` drawing units; undefined, none.
   */
  setGripHover(at: Vec2 | undefined, within: number): void {
    const was = this.#gripHover;
    if (!at && !was) return;
    this.#gripHover = at && { at, within };
    if (this.#grips) this.#transientDirty = true;
  }

  setSelectionPreview(preview: SelectionPreview | undefined): void {
    const ids = preview ? this.#previewOf(preview) : [];
    const was = this.#previewed;
    if (ids.length === was.length && ids.every((id, i) => id === was[i])) return;
    this.#previewed = ids;
    this.#transientDirty = true;
  }

  hoverConstraintBar(
    screen: { readonly x: number; readonly y: number } | undefined,
    view: ViewTransform = this.#view,
  ): ConstraintBarHit | null {
    const look = this.#style.constraintBars;
    let hit: ConstraintBarHit | undefined;
    if (screen && look && this.#modelTab) {
      this.#bars ??= constraintBars(this.#model);
      const p = screenToWorld(view, this.#width, this.#height, screen);
      hit = constraintBarAt(
        this.#bars,
        this.#barVisible(look),
        view.scale,
        look.mode ?? 4095,
        p,
        look.moved,
      );
    }
    const was = this.#barHover;
    const same =
      hit?.constraint === was?.constraint &&
      hit?.entity === was?.entity &&
      hit?.segment === was?.segment;
    this.#barHover = hit;
    if (!same) this.#transientDirty = true;
    return hit ?? null;
  }

  /** What `preview` lights up: the object under the pickbox, or what its area would take. */
  #previewOf(preview: SelectionPreview): EntityId[] {
    const o = { filter: preview.filter, groups: preview.groups, space: this.#pickBlock() };
    if (preview.area) {
      const taken = this.select(preview.area);
      if (preview.limit !== undefined && taken.length > preview.limit) return [];
      const out = new Set<EntityId>();
      for (const id of taken) for (const p of previewObjects(this.#model, id, o)) out.add(p);
      return [...out].sort((a, b) => a - b);
    }
    const hits = preview.screen ? this.hitTest(preview.screen, preview.aperture, preview.view) : [];
    // Shift+Space (M3-04 part 7) steps through the overlapping objects; the one stepped to
    // shows whatever PREVIEWFILTER says, as the drafter asked for it.
    if (preview.cycle !== undefined && hits.length > 0) {
      const hit = hits[preview.cycle % hits.length]!;
      return previewObjects(this.#model, hit, { ...o, filter: 0 });
    }
    const hit = hits[0];
    return hit !== undefined ? previewObjects(this.#model, hit, o) : [];
  }

  /**
   * A primitive as a pick or a window tests it. An unclipped PDF underlay's fill states no path,
   * since its page's size is only in the PDF: once the page is known it is tested as the page
   * (the outline drawn round it), and before nothing of it can be taken (M5-04 part 9, so
   * PDFCLIP and PDFADJUST can pick an unclipped underlay, as AutoCAD picks one by its frame).
   */
  #selectable(prim: RenderPrimitive): RenderPrimitive | undefined {
    if (prim.kind !== 'fill' || !prim.underlay || prim.path.length > 0) return prim;
    const u = prim.underlay;
    const page = this.#underlays?.(underlayKey(u.definition, u.layersOff))?.page;
    return page ? { ...prim, path: pagePath(u.frame, page) } : undefined;
  }

  select(query: SelectQuery): EntityId[] {
    const poly = query.polygon;
    const test: (p: RenderPrimitive) => boolean = poly
      ? query.kind === 'window'
        ? (p) => primInsidePolygon(p, poly)
        : query.kind === 'crossing'
          ? (p) => primCrossesPolygon(p, poly)
          : (p) => primCrossesFence(p, poly)
      : query.kind === 'window'
        ? (p) => primInside(p, query.box)
        : (p) => primCrosses(p, query.box);
    const all = query.kind === 'window' ? 'every' : 'some';
    const out: EntityId[] = [];
    for (const id of this.#index.query(this.#pickBlock(), query.box)) {
      const prims = this.#cache[id]?.prims.map((p) => this.#selectable(p));
      // Nothing drawn (a layer off or frozen): nothing to take.
      if (!prims || prims.length === 0) continue;
      if (prims.every((p) => p === undefined)) continue;
      if (prims[all]((p) => p !== undefined && test(p))) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * What entities are tessellated with now (fonts, image frames, patterns, FILLMODE, ATTMODE):
   * the plot job (M2-17) tessellates with the same, so a plot shows what the screen does.
   */
  /**
   * The height of the view on show in drawing units (the space shown's): what a plot made now
   * sizes relative PDSIZE points by, as the screen does (M3-01 part 4).
   */
  get viewHeight(): number {
    return this.#height / this.#view.scale;
  }

  get tessellateContext(): TessellateContext {
    return this.#tessellate;
  }

  /** Redraws the scene on the next frame: something it draws from changed (a bitmap, M1-19). */
  invalidate(): void {
    this.#sceneDirty = this.#contentDirty = true;
  }

  apply(cs: ChangeSet): void {
    const e = cs.entities;
    // The layout of the block shown made (LAYOUT New, or its deletion undone; M6-01): its sheet
    // and the viewports' model space follow from it now.
    if (cs.layouts?.added?.some((l) => l.blockRecord === this.#block)) {
      this.#identify();
      this.#cacheBlock();
      this.#viewports = undefined;
      this.#sceneDirty = this.#contentDirty = true;
    }
    // Grips sit on the objects' points, which the change may have moved.
    if (this.#grips) this.#transientDirty = true;
    // Dimensional constraints follow their objects, values and the drawing's units; a drawing
    // without any is looked at again only when its objects change.
    if (cs.objects || cs.header || this.#constraints?.length) this.#constraints = undefined;
    // Constraint bars follow their objects' midpoints (M9-05 part 2).
    if (cs.objects || this.#bars?.bars.length || this.#bars?.marks.length) this.#bars = undefined;
    // The hovered icon's frame follows its bar.
    if (this.#barHover) this.#transientDirty = true;
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
    // PDFFRAME (M5-04 part 17) is a DICTIONARYVAR, a header entry of its own name.
    const frames =
      touchesFrames(cs.objects) ||
      touchesImageNames(cs.objects) ||
      cs.header?.some((h) => h.name === PDFFRAME);
    if (frames) {
      this.#tessellate.frames = imageFrames(this.#model);
      this.#imageQuality = imageQuality(this.#model);
    }
    this.#tessellate.fill = fillMode(this.#model);
    this.#tessellate.attributeMode = attributeMode(this.#model);
    this.#tessellate.points = pointStyle(this.#model);
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
    // entity, a multiline style change redraws its multilines (M3-14), and an IMAGEFRAME,
    // WIPEOUTFRAME or PDFFRAME change reframes every image or underlay: re-resolve the whole block.
    if (
      frames ||
      clips ||
      cs.tables?.layers ||
      cs.tables?.linetypes ||
      cs.tables?.textStyles ||
      cs.tables?.mlineStyles ||
      cs.header?.some((h) => PAINT_HEADER.has(h.name)) ||
      // A new annotation scale (M6-03) shows or hides annotative objects under ANNOALLVISIBLE 0.
      (this.#modelTab &&
        this.#style.annotationAllVisible === false &&
        cs.header?.some((h) => h.name === 'CANNOSCALE'))
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
      const overlay = this.#overlayFrame(t.ctx);
      if (drag) {
        const view = overlay;
        if (drag.faded.length > 0) {
          this.#drawPrimitives(t.ctx, drag.faded, false, { ...view, alpha: COMMAND_PREVIEW_FADE });
        }
        this.#drawPrimitives(t.ctx, drag.moved, false, this.#dragFrame(view, drag.m));
        this.#drawPrimitives(t.ctx, drag.stretched, false, view);
        if (drag.gripMoved.length > 0) {
          this.#drawPrimitives(t.ctx, drag.gripMoved, false, this.#dragFrame(view, drag.gripMove));
        }
        for (const { entry, m } of drag.items) {
          this.#drawPrimitives(t.ctx, [entry], false, this.#dragFrame(view, m));
        }
      }
      this.#drawPrimitives(
        t.ctx,
        [{ prims: this.#transient, size: Infinity, x: 0, y: 0 }],
        false,
        overlay,
      );
      if (this.#previewed.length > 0) this.#drawPreview(t.ctx, overlay);
      if (this.#barHover) this.#drawBarHover(t.ctx, overlay);
      if (this.#grips) this.#drawGrips(t.ctx, overlay);
      // `#overlayFrame` clipped to the current viewport.
      if (this.#activeViewport()) t.ctx.restore();
      this.#drawActiveFrame(t.ctx);
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

  hitTest(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
    view: ViewTransform = this.#view,
  ): EntityId[] {
    const p = screenToWorld(view, this.#width, this.#height, screen);
    const r = aperture / view.scale;
    const box: Box = { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
    const hits: { id: EntityId; d: number }[] = [];
    for (const id of this.#index.query(this.#pickBlock(), box)) {
      const entry = this.#cache[id];
      if (!entry) continue;
      let d = Infinity;
      for (const drawn of entry.prims) {
        const prim = this.#selectable(drawn);
        if (!prim) continue;
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

  nestedHit(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
    id: EntityId,
    view: ViewTransform = this.#view,
  ): NestedPick | null {
    const e = this.#model.entity(id);
    if (!e || e.geom.kind !== 'INSERT' || !this.#cache[id]) return null;
    const p = screenToWorld(view, this.#width, this.#height, screen);
    const r = aperture / view.scale;
    // Expanded again with each part's owner, only for this pick: the scene cache keeps a
    // reference's parts without them, as nothing else asks.
    const x = expandInsert(e, this.#blockSource, { dashes: false, owners: true });
    let best: { i: number; d: number } | undefined;
    x.prims.forEach((prim, i) => {
      if (prim.clip && !insideClips(prim.clip, p)) return;
      let d = distanceTo(prim, p);
      if (prim.kind !== 'infinite' && prim.kind !== 'point' && prim.text)
        d = Math.min(d, distanceTo({ kind: 'fill', path: prim.text.greek, color: '' }, p));
      if (d <= r && (!best || d < best.d)) best = { i, d };
    });
    const owner = best && x.owners?.[best.i];
    if (!owner) return null;
    const last = owner.path[owner.path.length - 1];
    const attribute =
      last !== undefined &&
      owner.entity.id === last &&
      owner.entity.handle !== this.#model.entity(last)?.handle
        ? owner.entity.handle
        : undefined;
    return { path: owner.path, ...(attribute !== undefined && { attribute }) };
  }

  entitiesIn(rect: ScreenRect): DrawnEntity[] {
    const toWorld = (x: number, y: number) =>
      screenToWorld(this.#view, this.#width, this.#height, { x, y });
    const box = boxAround([
      toWorld(rect.x, rect.y),
      toWorld(rect.x + rect.width, rect.y + rect.height),
    ]);
    const found = new Set<EntityId>();
    // A viewport maximized fills the canvas: its model space is all there is (VPMAX).
    const maximized = this.#maximizedViewport();
    if (!maximized) this.#drawnIn(this.#block, box, found);
    // Model space through each viewport, under the part of the rectangle inside its frame.
    for (const vp of maximized ? [maximized] : this.#viewportList()) {
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
    // A block made since the drawing opened (the Block Editor's, M5-02) comes with the changes
    // the canvas is handed next: its entities are cached as they are applied.
    if (!this.#model.hasBlock(this.#block)) return;
    for (const id of this.#model.blockEntities(this.#block)) this.#cacheEntity(id);
    if (this.#modelBlock)
      for (const id of this.#model.blockEntities(this.#modelBlock)) this.#cacheEntity(id);
  }

  #cacheEntity(id: EntityId): void {
    const e = this.#model.entity(id);
    if (!e) return;
    // Hidden by ANNOALLVISIBLE 0 (M6-03): drawn, picked and windowed as an object on a layer off.
    this.#cache[id] = this.hides(e)
      ? undefined
      : this.#entryOf(e, id, this.#model, this.#blockSource);
  }

  /**
   * Whether the canvas hides `e`, an object of the space shown, although its layer shows it: on
   * the Model tab, an annotative object not supporting the current annotation scale while
   * ANNOALLVISIBLE is 0 (M6-03). Snaps skip what it hides (`OsnapSource.hidden`).
   */
  hides(e: Entity): boolean {
    return (
      this.#modelTab && annotationHidden(this.#model, e, this.#style.annotationAllVisible !== false)
    );
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
    let extra: Pick<CacheEntry, 'dashes' | 'blocks' | 'layer' | 'id'>;
    let held = false;
    if (expands(e, this.#blockDef)) {
      // The reference decides its own visibility: an off layer still shows its contents on
      // other layers.
      const x = expandInsert(e, source, { dashes: false });
      held = this.#refEdit !== undefined && x.blocks.has(this.#refEdit.held.block);
      if (source === this.#blockSource) {
        if (held) this.#heldRefs.add(id);
        else this.#heldRefs.delete(id);
      }
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
    extra = { ...extra, layer: e.layer, id };
    // The size and centre drive the sub-pixel LOD; unknown bounds never count as small.
    const b = held ? undefined : this.#index.bounds(id);
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
    // Not there yet (made since the drawing opened, M5-02): nothing to order, nothing kept.
    if (!this.#model.hasBlock(block)) return [];
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
    let hits = this.#index.query(block, box);
    // The references drawing a block edited in place as it was (M5-02 part 5): the index bounds
    // them by what the block holds now, which may be nothing, so they are always drawn.
    if (this.#heldRefs.size > 0) {
      const extra = [...this.#heldRefs].filter((id) => this.#model.entity(id)?.owner === block);
      if (extra.length > 0) hits = [...new Set([...hits, ...extra])];
    }
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
  #drawGrips(ctx: Canvas2D, frame: DrawFrame): void {
    const grips = this.#grips!;
    const { ox, oy, m } = frame;
    const half = Math.max(1, Math.round(gripHalfSize(this.#style.gripSize) * this.#dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const seen = new Set<string>();
    const hover = this.#hoveredGrip();
    const colors = gripPalette(this.#style.gripColors);
    const device = (p: Vec2) => ({
      x: Math.round(m.a * (p.x - ox) + m.c * (p.y - oy) + m.e),
      y: Math.round(m.b * (p.x - ox) + m.d * (p.y - oy) + m.f),
    });
    const square = (x: number, y: number, fill: string) => {
      // The contour keeps the grip visible on any background.
      ctx.fillStyle = colors.contour;
      ctx.fillRect(x - half - 1, y - half - 1, 2 * half + 2, 2 * half + 2);
      ctx.fillStyle = fill;
      ctx.fillRect(x - half, y - half, 2 * half, 2 * half);
    };
    const fillOf = (p: Vec2) =>
      grips.hot !== undefined && sameGrip(p, grips.hot)
        ? colors.selected
        : hover && sameGrip(p, hover)
          ? colors.hover
          : colors.unselected;
    // A selected group (M3-13): its bounding box at GROUPDISPLAYMODE 2, a device pixel wide in
    // the grip colour, then its one grip at the centre.
    const groups = this.#groupGrips();
    for (const { box } of groups) {
      if (!box) continue;
      const corners = [
        device({ x: box.minX, y: box.minY }),
        device({ x: box.maxX, y: box.minY }),
        device({ x: box.maxX, y: box.maxY }),
        device({ x: box.minX, y: box.maxY }),
      ];
      const width = Math.max(1, Math.round(this.#dpr));
      // An odd width sits on pixel centres, so the line is crisp, not two half-tone pixels.
      const o = width % 2 === 1 ? 0.5 : 0;
      ctx.strokeStyle = colors.unselected;
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(corners[0]!.x + o, corners[0]!.y + o);
      for (const c of corners.slice(1)) ctx.lineTo(c.x + o, c.y + o);
      ctx.closePath();
      ctx.stroke();
    }
    for (const { center } of groups) {
      const { x, y } = device(center);
      if (seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      square(x, y, fillOf(center));
    }
    const objects = grips.ids.flatMap((id) => {
      const e = this.#model.entity(id);
      return e ? gripsOf(e.geom, gripInfoOf(this.#model, e)) : [];
    });
    // A selected constraint's grips (M9-03 part 11): its triangles set its value, as an
    // MTEXT's column grips size it.
    for (const g of [...objects, ...this.#constraintGrips()]) {
      const { x, y } = device(g.point);
      if (seen.has(`${x},${y}`)) continue;
      seen.add(`${x},${y}`);
      const fill = fillOf(g.point);
      if (g.towards) {
        // An arrow grip (M2-26 part 2: an MTEXT's column width and height), pointing the way
        // it sizes, as AutoCAD draws them.
        const dx = m.a * g.towards.x + m.c * g.towards.y;
        const dy = m.b * g.towards.x + m.d * g.towards.y;
        const len = Math.hypot(dx, dy) || 1;
        arrowGrip(ctx, x, y, dx / len, dy / len, half, fill, colors.contour);
        continue;
      }
      square(x, y, fill);
    }
  }

  /** The grip nearest the cursor within its reach, of the objects grips show on. */
  #hoveredGrip(): Vec2 | undefined {
    const h = this.#gripHover;
    if (!h || !this.#grips) return undefined;
    let best: Vec2 | undefined;
    let bestD = h.within;
    for (const { center } of this.#groupGrips()) {
      const d = Math.hypot(center.x - h.at.x, center.y - h.at.y);
      if (d <= bestD) {
        best = center;
        bestD = d;
      }
    }
    const points = [
      ...this.#grips.ids.flatMap((id) => {
        const e = this.#model.entity(id);
        return e ? gripsOf(e.geom, gripInfoOf(this.#model, e)).map((g) => g.point) : [];
      }),
      // A selected constraint's (M9-03 part 11).
      ...this.#constraintGrips().map((g) => g.point),
    ];
    for (const p of points) {
      const d = Math.hypot(p.x - h.at.x, p.y - h.at.y);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
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
    const maximized = this.#maximizedViewport();
    if (maximized) return this.#drawMaximized(ctx, maximized, view, reduced);
    if (sheet) this.#drawSheet(ctx, sheet, view);
    // While a viewport is current the grid is model space's, through it (M6-02 part 9).
    const active = this.#activeViewport();
    if (active) this.#drawViewportGrid(ctx, active, view);
    else this.#drawGrid(ctx, view);
    for (const vp of this.#viewportList()) this.#drawViewport(ctx, vp, view, reduced);
    if (this.#style.viewportUcsIcons) {
      for (const vp of this.#viewportList()) this.#drawViewportUcsIcon(ctx, vp, view);
    }
    // A command preview's faded objects are drawn on the transient layer (M3-12 part 6).
    const faded = this.#faded;
    const entries = this.#visibleEntries(
      this.#block,
      view.box,
      faded.size > 0 ? (id, entry) => (faded.has(id) ? undefined : entry) : undefined,
    );
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
    if (this.#modelTab) {
      this.#drawConstraints(ctx, view);
      this.#drawConstraintBars(ctx, view);
    }
    // While a viewport is current its model space's objects are selected, drawn through it.
    const overlay = this.#overlayFrame(ctx, view);
    this.#drawHighlight(ctx, overlay);
    if (this.#activeViewport()) ctx.restore();
    this.#askForPages();
  }

  /**
   * The dimensional constraints on the Model tab (M9-03 part 4): dynamic ones the same size on
   * screen at any zoom, in their own colour, unless hidden, all of them or one by DCDISPLAY
   * (then shown while an object they constrain is selected, under DYNCONSTRAINTMODE 1);
   * annotational ones sized by the drawing's DIMVARs, as dimensions (plotted by the plot job).
   *
   * Through a layout's viewport (M9-03 part 13, `view` its frame): the annotational ones, and
   * the dynamic ones with `dynamic` (the viewport made current, where model space is worked in;
   * AutoCAD keeps them for editing and never plots them); none whose objects are all on layers
   * frozen in the viewport, as Triya's constraints keep no layer of their own.
   */
  #drawConstraints(ctx: Canvas2D, view: DrawFrame, dynamic = true): void {
    const look = this.#style.constraints;
    this.#constraints ??= constraintDisplays(this.#model, look?.nameFormat ?? 2);
    if (this.#constraints.length === 0) return;
    const prims: RenderPrimitive[] = [];
    const picked: RenderPrimitive[] = [];
    for (const d of this.#constraints) {
      if (!dynamic && d.form === 'dynamic') continue;
      if (view.frozen && this.#constraintFrozen(d, view.frozen)) continue;
      const sizes = this.#constraintSizes(d, look, view.scale);
      if (!sizes) continue;
      const color = d.form === 'annotational' ? 'foreground' : (look?.color ?? 'foreground');
      const drawn = constraintPrimitives(
        d,
        sizes,
        color,
        this.#tessellate.text,
        true,
        showsLock(d, look?.lockIcon),
      );
      prims.push(...drawn);
      if (this.#highlightConstraints.has(d.handle)) picked.push(...drawn);
    }
    this.#drawPrimitives(ctx, [{ prims, size: Infinity, x: 0, y: 0 }], false, view);
    // The constraints selected (M9-03 part 10), highlighted as selected objects are.
    if (picked.length > 0 && this.#outlinePrimitives(ctx, view, picked)) this.#strokeSelected(ctx);
  }

  /** Whether every object `d` constrains is on a layer in `frozen` (a viewport's). */
  #constraintFrozen(d: ConstraintDisplay, frozen: ReadonlySet<Handle>): boolean {
    return d.entities.every((h) => {
      const layer = this.#model.entityByHandle(h)?.layer;
      return layer !== undefined && frozen.has(layer);
    });
  }

  /**
   * The sizes `d` is drawn at, or undefined where it is not drawn: an annotational one always,
   * sized by its DIMVARs; a dynamic one the same size on screen, unless hidden (all
   * of them, or this one by DCDISPLAY, M9-03 part 7), then shown only while an object it
   * constrains is selected (DYNCONSTRAINTMODE 1).
   */
  #constraintSizes(
    d: ConstraintDisplay,
    look: ConstraintStyle | undefined,
    scale: number,
  ): ConstraintSizes | undefined {
    if (d.form === 'annotational') return annotationalSizes(this.#model.header, d.dimvars);
    const selected = () =>
      d.entities.some((h) => {
        const e = this.#model.entityByHandle(h);
        return e !== undefined && this.#highlight.has(e.id);
      });
    const shown =
      (look?.dynamic !== false && !d.hidden) || (look?.showSelected !== false && selected());
    return shown ? sizesAt(DYNAMIC_CONSTRAINT_PX, scale) : undefined;
  }

  /**
   * The constraint bars on the Model tab (M9-05 part 2): each constrained object's bar, the same
   * size on screen at any zoom, unless CONSTRAINTBAR hid it (then shown while its object is
   * selected, under CONSTRAINTBARDISPLAY bit 2); CONSTRAINTBARMODE's kinds; the Coincident
   * squares of the objects shown. Not plotted: plots draw entities only.
   */
  #drawConstraintBars(ctx: Canvas2D, view: DrawFrame): void {
    const look = this.#style.constraintBars;
    if (!look) return;
    this.#bars ??= constraintBars(this.#model);
    if (this.#bars.bars.length === 0 && this.#bars.marks.length === 0) return;
    const visible = this.#barVisible(look);
    const color = look.color ?? this.#style.constraints?.color ?? 'foreground';
    const prims = constraintBarPrimitives(
      this.#bars,
      visible,
      view.scale,
      {
        mode: look.mode ?? 4095,
        color,
        panel: look.panel ?? 'background',
        opacity: Math.min(Math.max(look.transparency ?? 50, 10), 90) / 100,
      },
      look.moved,
    );
    this.#drawPrimitives(ctx, [{ prims, size: Infinity, x: 0, y: 0 }], false, view);
  }

  /**
   * Whether an object's bar shows: not hidden by CONSTRAINTBAR, or hidden and selected while
   * CONSTRAINTBARDISPLAY bit 2 is on.
   */
  #barVisible(look: ConstraintBarStyle): (h: Handle) => boolean {
    const selected = (h: string) => {
      const e = this.#model.entityByHandle(h);
      return e !== undefined && this.#highlight.has(e.id);
    };
    return (h) => !look.hidden.has(h) || (look.showSelected !== false && selected(h));
  }

  /**
   * The constraint under the cursor (M9-05 part 4) on the transient layer: its objects as the
   * selection preview shows an object, its icons framed in the selection colour.
   */
  #drawBarHover(ctx: Canvas2D, frame: DrawFrame): void {
    const hit = this.#barHover;
    const look = this.#style.constraintBars;
    if (!hit || !look || !this.#modelTab) return;
    this.#bars ??= constraintBars(this.#model);
    const ids: EntityId[] = [];
    for (const h of hit.entities) {
      const e = this.#model.entityByHandle(h);
      if (e) ids.push(e.id);
    }
    this.#drawPreview(ctx, frame, ids);
    const color = this.#style.selection ?? SELECTION_COLOR;
    const prims = constraintBarHoverPrimitives(
      this.#bars,
      this.#barVisible(look),
      frame.scale,
      look.mode ?? 4095,
      hit,
      color,
      look.moved,
    );
    if (prims.length > 0)
      this.#drawPrimitives(ctx, [{ prims, size: Infinity, x: 0, y: 0 }], false, frame);
  }

  /**
   * The scene while a viewport is maximized (VPMAX, M6-02 part 7): the canvas in the sheet's
   * colour, as the viewport shows model space on it, and model space through the viewport alone,
   * with its frozen layers and layer overrides; its selection over it.
   */
  #drawMaximized(ctx: Canvas2D, vp: ViewportEntry, view: DrawFrame, reduced: boolean): void {
    ctx.fillStyle = this.#style.background;
    ctx.fillRect(0, 0, this.#scene.canvas.width, this.#scene.canvas.height);
    this.#drawViewportGrid(ctx, vp, view);
    this.#drawViewport(ctx, vp, view, reduced);
    const overlay = this.#overlayFrame(ctx, view);
    this.#drawHighlight(ctx, overlay);
    ctx.restore();
    this.#askForPages();
  }

  /**
   * The selection over the scene (M2-03, UI_SPEC.md §6 "AutoCAD-like highlight (dashed +
   * glow)"): each selected entity's outline as a wide translucent glow, then a dashed line, in
   * the selection colour. Text shows by the boxes of its runs; fills by their outlines.
   */
  #drawHighlight(ctx: Canvas2D, frame: DrawFrame): void {
    if (this.#highlight.size === 0 || !this.#outline(ctx, frame, this.#highlight)) return;
    this.#strokeSelected(ctx);
  }

  /** The path built strokes as the selection: a wide translucent glow, then a dashed line. */
  #strokeSelected(ctx: Canvas2D): void {
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

  /**
   * The selection preview over everything (M3-04 part 5, SELECTIONPREVIEW): the objects under
   * the pickbox as the selection's glow, then a solid line `PREVIEW_LINE_PX` wide, in the
   * selection colour, on the transient layer, so moving the cursor never redraws the scene.
   */
  #drawPreview(ctx: Canvas2D, frame: DrawFrame, ids: readonly EntityId[] = this.#previewed): void {
    if (!this.#outline(ctx, frame, ids)) return;
    const px = this.#dpr;
    ctx.strokeStyle = this.#style.selection ?? SELECTION_COLOR;
    ctx.globalAlpha = SELECTION_GLOW_ALPHA;
    ctx.lineWidth = SELECTION_GLOW_PX * px;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = PREVIEW_LINE_PX * px;
    ctx.stroke();
  }

  /**
   * Builds the path of `ids` as drawn in the space shown (text by its runs' boxes, fills by
   * their outlines) on `ctx`, in device pixels; false when none of them is in view.
   */
  /** Builds the outline of `prims` (drawn outside the scene cache) as `#outline` does. */
  #outlinePrimitives(ctx: Canvas2D, frame: DrawFrame, prims: readonly RenderPrimitive[]): boolean {
    const { ox, oy, m } = frame;
    let any = false;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    for (const prim of prims) {
      if (prim.kind === 'point' || prim.kind === 'infinite') continue;
      const runs = prim.text?.greek;
      buildPath(ctx, runs && runs.length > 0 ? runs : (prim.continuous ?? prim.path), ox, oy);
      any = true;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return any;
  }

  #outline(ctx: Canvas2D, frame: DrawFrame, ids: Iterable<EntityId>): boolean {
    const { ox, oy, m, scale, box } = frame;
    const dot = 2 / scale;
    let any = false;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.beginPath();
    for (const id of ids) {
      const entry = this.#cache[id];
      // In a layout the cache holds model space too (for its viewports); only the space shown
      // is selected in.
      if (!entry || this.#model.entity(id)?.owner !== this.#pickBlock()) continue;
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
        // A field's grey background is no part of its text's outline.
        if (prim.kind === 'fill' && prim.fieldShade) continue;
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
          // An unclipped underlay by its page (`#selectable`): PDFFRAME 0 shows the frame while
          // the underlay is selected or previewed (M5-04 part 17).
          const shape = prim.kind === 'fill' && prim.underlay ? this.#selectable(prim) : prim;
          if (!shape || shape.kind === 'point' || shape.kind === 'infinite') continue;
          buildPath(ctx, runs && runs.length > 0 ? runs : (shape.continuous ?? shape.path), ox, oy);
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return any;
  }

  /** Sends what the scene just drawn needed of each page and its raster does not show (M1-20). */
  #askForPages(): void {
    const needs = this.#underlayNeeds;
    this.#underlayNeeds = new Map();
    const send = this.#onUnderlayRequest;
    if (!send) return;
    for (const [page, { u, need }] of needs) {
      const raster = this.#underlays?.(page);
      if (raster && rasterCovers(raster, need)) continue;
      const request = underlayRequest(u.definition, need, raster?.page, u.layersOff);
      const key = JSON.stringify(request);
      if (this.#underlayAsked.get(page) === key) continue;
      this.#underlayAsked.set(page, key);
      send(request);
    }
  }

  /**
   * GRID while a layout viewport is current (M6-02 part 9): model space's lines as the viewport
   * shows them, clipped to its frame, as AutoCAD shows the grid of the viewport worked in rather
   * than paper space's; points snap to model space's grid there, so the lines show where.
   */
  #drawViewportGrid(ctx: Canvas2D, vp: ViewportEntry, view: DrawFrame): void {
    if (!this.#style.grid) return;
    const through = this.#throughViewport(vp, view);
    if (!through) return;
    this.#clipTo(ctx, vp, view, through.clip);
    this.#drawGrid(ctx, through.frame);
    ctx.restore();
  }

  /**
   * GRID (M2-04 part 2): the minor lines faint and the major ones stronger, a device pixel
   * wide on whole pixels, under everything drawn (UI_SPEC.md §6).
   */
  #drawGrid(ctx: Canvas2D, view: DrawFrame): void {
    const spec = this.#style.grid;
    if (!spec) return;
    const lines = gridLines(spec, view.box, view.scale);
    if (!lines) return;
    const { m, ox, oy } = view;
    const { background, foreground } = this.#style;
    const toward = spec.color ?? foreground;
    const dx = (x: number) => m.a * (x - ox) + m.e;
    const dy = (y: number) => m.d * (y - oy) + m.f;
    if (lines.turned) return this.#drawTurnedGrid(ctx, lines, view, spec);
    if (m.b !== 0 || m.c !== 0) {
      // Model space through a twisted viewport (M6-02 part 15): the frame turns the lines.
      const frame = lines.extent ?? view.box;
      const turned = { angle: 0, base: { x: 0, y: 0 }, frame };
      return this.#drawTurnedGrid(ctx, { ...lines, turned }, view, spec);
    }
    if (spec.dots) {
      // GRIDSTYLE (M3-06 part 6): a dot of a device pixel or two where the lines cross.
      const size = Math.max(1, Math.round(this.#dpr));
      ctx.beginPath();
      for (const x of lines.xs) {
        const px = Math.round(dx(x));
        for (const y of lines.ys) ctx.rect(px, Math.round(dy(y)), size, size);
      }
      ctx.fillStyle = mixColors(background, toward, spec.color ? 1 : GRID_DOT_MIX);
      ctx.fill();
      return;
    }
    // Lines across the view, or between the limits (GRIDDISPLAY without bit 1).
    const e = lines.extent;
    const [left, right] = e ? [dx(e.minX), dx(e.maxX)] : [0, this.#width * this.#dpr];
    const [top, bottom] = e ? [dy(e.maxY), dy(e.minY)] : [0, this.#height * this.#dpr];
    const stroke = (xs: readonly number[], ys: readonly number[], mix: number) => {
      ctx.beginPath();
      for (const x of xs) {
        const d = Math.round(dx(x)) + 0.5;
        ctx.moveTo(d, top);
        ctx.lineTo(d, bottom);
      }
      for (const y of ys) {
        const d = Math.round(dy(y)) + 0.5;
        ctx.moveTo(left, d);
        ctx.lineTo(right, d);
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

  /**
   * A grid turned by the UCS and SNAPANG (M3-06 part 7): each line between the turned frame's
   * sides, or a dot where two cross, mapped to the device; not snapped to whole pixels, as a
   * slanted line has none to keep to.
   */
  #drawTurnedGrid(ctx: Canvas2D, lines: GridLines, view: DrawFrame, spec: GridSpec): void {
    const { angle, base, frame } = lines.turned!;
    const { m, ox, oy } = view;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // The whole frame matrix: a twisted viewport's turns the device axes too (M6-02 part 15).
    const at = (u: number, v: number): [number, number] => {
      const x = base.x + u * c - v * s - ox;
      const y = base.y + u * s + v * c - oy;
      return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    };
    const { background, foreground } = this.#style;
    const toward = spec.color ?? foreground;
    if (spec.dots) {
      const size = Math.max(1, Math.round(this.#dpr));
      ctx.beginPath();
      for (const u of lines.xs)
        for (const v of lines.ys) {
          const [px, py] = at(u, v);
          ctx.rect(Math.round(px), Math.round(py), size, size);
        }
      ctx.fillStyle = mixColors(background, toward, spec.color ? 1 : GRID_DOT_MIX);
      ctx.fill();
      return;
    }
    const stroke = (us: readonly number[], vs: readonly number[], mix: number) => {
      ctx.beginPath();
      for (const u of us) {
        ctx.moveTo(...at(u, frame.minY));
        ctx.lineTo(...at(u, frame.maxY));
      }
      for (const v of vs) {
        ctx.moveTo(...at(frame.minX, v));
        ctx.lineTo(...at(frame.maxX, v));
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

  /**
   * The UCS icon of a viewport (M3-06 part 8; AutoCAD 2024 Help, "UCSICON"): with its UCSICON bit
   * (DXF 90 bit 32) on, the X and Y arrows of the UCS it shows (its own with UCSVP on, else model
   * space's current one: `viewportUcs`, M3-15) as the viewport turns them, at
   * the UCS origin with bit 64 while it sits inside the frame with room, else in the frame's
   * lower-left corner; a square at the corner while the UCS is the WCS.
   */
  #drawViewportUcsIcon(ctx: Canvas2D, vp: ViewportEntry, view: DrawFrame): void {
    const flags = vp.geom.flags;
    if ((flags & VIEWPORT_UCS_ICON) === 0) return;
    // Its own UCS while its UCSVP is on (M3-15).
    const ucs = viewportUcs(vp.geom, ucsOf(this.#model.header, false));
    const t = vp.toPaper;
    const k = view.m.a;
    const device = (p: Vec2) => ({
      x: view.m.e + k * (p.x - view.ox),
      y: view.m.f - k * (p.y - view.oy),
    });
    // The axes' directions on the device (y down), from model space through the viewport.
    const dir = (a: number) => {
      const x = t.a * Math.cos(a) + t.c * Math.sin(a);
      const y = t.b * Math.cos(a) + t.d * Math.sin(a);
      const l = Math.hypot(x, y);
      return l === 0 ? { x: 1, y: 0 } : { x: x / l, y: -y / l };
    };
    const ex = dir(ucs.angle);
    const ey = dir(ucs.angle + Math.PI / 2);
    const arm = UCS_ICON_ARM * this.#dpr;
    const f = viewportFrame(vp.geom);
    const lo = device({ x: f.minX, y: f.minY });
    const hi = device({ x: f.maxX, y: f.maxY });
    const room = arm + UCS_ICON_MARGIN * this.#dpr;
    let corner = { x: lo.x + room, y: lo.y - room };
    if (flags & VIEWPORT_UCS_ICON_AT_ORIGIN) {
      const o = device({
        x: t.a * ucs.origin.x + t.c * ucs.origin.y + t.e,
        y: t.b * ucs.origin.x + t.d * ucs.origin.y + t.f,
      });
      if (o.x >= lo.x + room && o.x <= hi.x - room && o.y <= lo.y - room && o.y >= hi.y + room) {
        corner = o;
      }
    }
    const world = ucs.angle === 0 && ucs.origin.x === 0 && ucs.origin.y === 0;
    const at = (e: Vec2, d: number) => ({ x: corner.x + e.x * d, y: corner.y + e.y * d });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(
      Math.min(lo.x, hi.x),
      Math.min(lo.y, hi.y),
      Math.abs(hi.x - lo.x),
      Math.abs(hi.y - lo.y),
    );
    ctx.clip();
    ctx.strokeStyle = this.#style.foreground;
    ctx.lineWidth = this.#dpr;
    ctx.beginPath();
    for (const [e, n] of [
      [ex, ey],
      [ey, ex],
    ] as const) {
      const tip = at(e, arm);
      ctx.moveTo(corner.x, corner.y);
      ctx.lineTo(tip.x, tip.y);
      // The arrowhead: back from the tip and out to either side.
      const head = 5 * this.#dpr;
      for (const side of [1, -1]) {
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(
          tip.x - e.x * head + n.x * side * 3 * this.#dpr,
          tip.y - e.y * head + n.y * side * 3 * this.#dpr,
        );
      }
    }
    if (world) {
      const s = 6 * this.#dpr;
      const a = at(ex, s);
      const b = { x: a.x + ey.x * s, y: a.y + ey.y * s };
      const c = at(ey, s);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
    }
    // The letters as strokes, upright on the device, beyond each arrow (the context draws no
    // text: the renderer's text is tessellated).
    const h = 3.5 * this.#dpr;
    const lx = at(ex, arm + 8 * this.#dpr);
    const ly = at(ey, arm + 8 * this.#dpr);
    ctx.moveTo(lx.x - h, lx.y - h);
    ctx.lineTo(lx.x + h, lx.y + h);
    ctx.moveTo(lx.x + h, lx.y - h);
    ctx.lineTo(lx.x - h, lx.y + h);
    ctx.moveTo(ly.x - h, ly.y - h);
    ctx.lineTo(ly.x, ly.y);
    ctx.lineTo(ly.x + h, ly.y - h);
    ctx.moveTo(ly.x, ly.y);
    ctx.lineTo(ly.x, ly.y + h);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Model space as the viewport shows it in `view`: the frame entities are drawn in (model
   * coordinates about the model point at the frame centre, the box of model space under the
   * visible part of the frame) and the device rectangle the frame clips to; undefined while the
   * frame is out of view.
   */
  #throughViewport(
    vp: ViewportEntry,
    view: DrawFrame,
  ): { frame: DrawFrame; clip: { x: number; y: number; w: number; h: number } } | undefined {
    const frame = viewportFrame(vp.geom);
    const shown = {
      minX: Math.max(frame.minX, view.box.minX),
      minY: Math.max(frame.minY, view.box.minY),
      maxX: Math.min(frame.maxX, view.box.maxX),
      maxY: Math.min(frame.maxY, view.box.maxY),
    };
    if (shown.minX >= shown.maxX || shown.minY >= shown.maxY) return undefined;
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
    const vs = viewportScale(vp.geom);
    return {
      frame: {
        ox: o.x,
        oy: o.y,
        m,
        scale: view.scale * vs,
        box,
        // PSLTSCALE 1: "the dash lengths of a line in a viewport … the same as … in paper space".
        linetypeScale: this.#psltscale ? 1 / vs : 1,
        ...(vp.frozen ? { frozen: vp.frozen } : {}),
      },
      clip: this.#deviceRect(shown, view),
    };
  }

  /** One viewport's view of model space, clipped to its frame. */
  #drawViewport(ctx: Canvas2D, vp: ViewportEntry, view: DrawFrame, reduced: boolean): void {
    const through = this.#throughViewport(vp, view);
    if (!through) return;
    const shownLayers = vp.layers;
    const entries = this.#visibleEntries(
      this.#modelBlock!,
      through.frame.box,
      shownLayers ? (id, entry) => this.#overriddenEntry(vp, shownLayers, id, entry) : undefined,
    );
    this.#sceneEntries += entries.length;
    this.#constraints ??= constraintDisplays(this.#model, this.#style.constraints?.nameFormat ?? 2);
    const constraints = this.#constraints.length > 0;
    if (entries.length === 0 && !constraints) return;
    this.#clipTo(ctx, vp, view, through.clip);
    if (entries.length > 0) this.#drawPrimitives(ctx, entries, reduced, through.frame);
    // Its annotational constraints, and the dynamic ones while it is current (M9-03 part 13).
    if (constraints) {
      this.#drawConstraints(ctx, through.frame, vp.handle === this.#activeViewport()?.handle);
    }
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
    // In-place reference editing (M5-02 part 5): what is not in the working set fades.
    const xfade = this.#xfade();
    // Object transparency (M1-108) multiplies in, unless TRANSPARENCYDISPLAY is off.
    const transparent = this.#style.showTransparency !== false;
    const opacity = (p: RenderPrimitive): number =>
      transparent || (p.kind === 'fill' && p.fieldShade) ? (p.opacity ?? 1) : 1;
    // FIELDDISPLAY (M4-10 part 3): fields' grey backgrounds, unless turned off.
    const fieldShades = this.#style.showFields !== false;
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
      const lockedEntry =
        fade !== undefined && entry.layer !== undefined && fade.locked.has(entry.layer);
      const entryAlpha =
        (frame.alpha ?? 1) *
        (lockedEntry ? fade.alpha : 1) *
        (xfade && !(entry.id !== undefined && xfade.working.has(entry.id)) ? xfade.alpha : 1);
      // LOD: an entity under a pixel is a dot, or nothing in a reduced frame. A POINT with a
      // PDMODE figure is sized by the view, not by the entity (M3-01 part 4).
      if (entry.size * scale < 1 && !hasFigure(entry)) {
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
        if (prim.kind === 'fill' && prim.fieldShade && !fieldShades) continue;
        setClip(prim.clip);
        // In a block, a part fades when the reference's layer (the entry's) or a layer below it
        // is locked; AutoCAD's help does not say for the nested case (ambiguity noted, M1-69).
        const a =
          (!lockedEntry && fade && prim.layers?.some((l) => fade.locked.has(l))
            ? entryAlpha * fade.alpha
            : entryAlpha) * opacity(prim);
        const color = this.#color(prim.color);
        if (prim.kind === 'point') {
          flush();
          const f = prim.figure;
          if (f) {
            // The PDMODE figure (M3-01 part 4), sized by the view now: a relative PDSIZE is a
            // share of the height on show (the canvas, or the viewport drawn).
            const size = figureSize(f.size, box.maxY - box.minY);
            const path = pointFigurePath(prim.x, prim.y, f.mode, size, f.angle);
            if (path.length > 0) {
              world();
              ctx.beginPath();
              buildPath(ctx, path, ox, oy);
              device();
              setAlpha(a);
              ctx.strokeStyle = color;
              ctx.lineWidth = this.#lineWidth(undefined);
              ctx.stroke();
            }
            if (!pointHasDot(f.mode)) continue;
          }
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
   * page, and the boundary (or page) outlined in the entity's colour unless PDFFRAME hides it
   * (`frameOff`, M5-04 part 17). Leaves the canvas transform at identity.
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
    // A page with layers turned off is a raster of its own (M2-38 part 2).
    const page = underlayKey(u.definition, u.layersOff);
    const raster = this.#underlays?.(page);
    const need = underlayNeed(u, clipPath, frame.box, frame.scale * this.#dpr, raster?.page);
    if (need) {
      const had = this.#underlayNeeds.get(page)?.need;
      this.#underlayNeeds.set(page, { u, need: had ? mergeNeeds(had, need) : need });
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
    if (u.frameOff) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
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

  /**
   * The alpha objects not in the working set draw at while a reference is edited in place
   * (XFADECTL, M5-02 part 5), with the working set; undefined when nothing fades.
   */
  #xfade(): { readonly alpha: number; readonly working: ReadonlySet<EntityId> } | undefined {
    const edit = this.#refEdit;
    if (!edit) return undefined;
    const amount = Math.min(XFADE_MAX, this.#style.xFade ?? XFADE_DEFAULT);
    return amount > 0 ? { alpha: 1 - amount / 100, working: edit.working } : undefined;
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
        : {
            show: this.#style.showLineweights,
            space: 'model',
            displayScale: this.#style.lineweightScale ?? 1,
          },
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

/** Whether two id lists hold the same ids in the same order. */
function sameIds(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
