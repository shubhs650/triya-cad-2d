// The renderer contract (ARCHITECTURE.md §7.1). Everything outside packages/render talks to a
// `Renderer`; only this package knows it is Canvas 2D underneath, so a WebGL renderer can
// replace it behind the same interface (DEC-006).

import type {
  Box,
  ChangeSet,
  DragMotion,
  Entity,
  EntityId,
  GroupGrip,
  Handle,
  NestedPick,
  Vec2,
  ViewportGeometry,
} from '@triya/engine';
import { viewportTransform } from '@triya/engine';
import type { GridSpec } from './grid';
import type { TtfFont } from '@triya/text';
import type { Affine } from './affine';

/**
 * World → screen: the world point `center` sits at the middle of the viewport, `scale` is
 * screen pixels (CSS) per drawing unit, and world Y points up while screen Y points down.
 */
export interface ViewTransform {
  readonly center: { readonly x: number; readonly y: number };
  readonly scale: number;
}

/** Display settings that change how the scene looks but not what it contains. */
export interface RenderStyle {
  /** Canvas background, a CSS colour. */
  readonly background: string;
  /** What ACI 7 (and anything that resolves to the foreground) draws in, a CSS colour. */
  readonly foreground: string;
  /** LWT: lineweights shown at their width; off draws every line 1 px. */
  readonly showLineweights: boolean;
  /**
   * LWDEFAULT (M5-08 part 3): what a Default lineweight draws as, hundredths of a millimetre.
   * AutoCAD keeps it in the registry, not the drawing; absent is its initial 25 (0.25 mm). A
   * change re-resolves every object's paint.
   */
  readonly lineweightDefault?: number;
  /**
   * Lineweight Settings' Adjust Display Scale (M5-08 part 3): the Model tab's lineweight widths
   * multiplied by it (`LineweightDisplay.displayScale`); layouts show real paper widths. Absent
   * is 1.
   */
  readonly lineweightScale?: number;
  /**
   * Around a layout's sheet, a CSS colour (M1-18); the sheet itself is `background`, so ACI 7
   * contrasts with the paper. Defaults to the background moved toward grey.
   */
  readonly layoutBackground?: string;
  /**
   * LAYLOCKFADECTL, −90…90: objects on locked layers draw faded by this percentage (M1-69).
   * Zero or negative draws them normally; AutoCAD keeps the value in the registry, not the
   * drawing, and starts it at 50.
   */
  readonly layLockFade?: number;
  /**
   * XFADECTL, 0…90 (M5-02 part 5): while a reference is edited in place (`setRefEdit`), every
   * object not in the working set draws faded by this percentage; 0 draws them normally. AutoCAD
   * keeps it in the registry and starts it at 50.
   */
  readonly xFade?: number;
  /**
   * TRANSPARENCYDISPLAY (M1-108): object transparency shown; false draws every object opaque.
   * AutoCAD's initial value is 1, so absent shows it.
   */
  readonly showTransparency?: boolean;
  /**
   * FIELDDISPLAY (M4-10 part 3): fields shown on a grey background; false shows them as the rest
   * of their text. AutoCAD's initial value is 1, so absent shows it.
   */
  readonly showFields?: boolean;
  /**
   * ANNOALLVISIBLE (M6-03): every annotative object shown; false shows on the Model tab only
   * those supporting the current annotation scale (CANNOSCALE), as AutoCAD's 0. AutoCAD's
   * initial value is 1, so absent shows them all.
   */
  readonly annotationAllVisible?: boolean;
  /** The selection highlight's colour (M2-03, UI_SPEC.md §6), a CSS colour; a blue by default. */
  readonly selection?: string;
  /** GRID on (M2-04 part 2): the grid drawn under the drawing; absent draws none. */
  readonly grid?: GridSpec;
  /**
   * GRIPSIZE (M2-59 part 3): the grip box's size, AutoCAD's pixels, 1 to 255; absent is
   * AutoCAD's initial 5. `gripHalfSize` turns it into the half size grips are drawn at.
   */
  readonly gripSize?: number;
  /**
   * M3-06 part 8: a layout's viewports each show the UCS icon (UCSICON, the viewport's DXF 90
   * bits 32 and 64) for model space's current UCS, as seen through them. The canvas of a layout
   * sets it; plots and previews never draw it.
   */
  readonly viewportUcsIcons?: boolean;
  /**
   * GRIPCOLOR, GRIPHOVER, GRIPHOT and GRIPCONTOUR (M3-05 part 5), ACIs; absent are AutoCAD's
   * initial colours (`GRIP_COLORS_DEFAULT`).
   */
  readonly gripColors?: GripColors;
}

/**
 * The grips' colours as ACIs 1 to 255 (AutoCAD 2024 Help, each variable "Saved in: Registry";
 * the Options dialog's Selection tab, "Grip Colors Dialog Box"): unselected grips (GRIPCOLOR),
 * the grip the cursor pauses on (GRIPHOVER), the hot grip (GRIPHOT) and every grip's contour
 * (GRIPCONTOUR).
 */
export interface GripColors {
  readonly unselected: number;
  readonly hover: number;
  readonly selected: number;
  readonly contour: number;
}

/** The grip colours' initial values (AutoCAD 2024 Help): ACI 150, 11, 12 and 251. */
export const GRIP_COLORS_DEFAULT: GripColors = {
  unselected: 150,
  hover: 11,
  selected: 12,
  contour: 251,
};

/** GRIPSIZE's initial value (AutoCAD 2024 Help). */
export const GRIPSIZE_DEFAULT = 5;

/**
 * Half a grip box's side in CSS pixels for a GRIPSIZE (M2-59 part 3): AutoCAD's initial 5 is
 * the 4 px half size Triya has drawn grips at since M2-06, and the size scales from there, as
 * AUTOSNAPSIZE scales the AutoSnap marker. The canvas picks a grip within this and a pixel.
 */
export function gripHalfSize(gripSize: number | undefined): number {
  return ((gripSize ?? GRIPSIZE_DEFAULT) * 4) / GRIPSIZE_DEFAULT;
}

/**
 * A primitive's colour: a CSS colour, the foreground, which follows the background (ACI 7 is
 * black on a light canvas and white on a dark one), or the canvas background itself (an MTEXT
 * mask in the drawing window colour, M1-41), so a theme switch needs no re-tessellation.
 */
export type PrimitiveColor = string | 'foreground' | 'background';

/**
 * Text glyphs (M1-41) and their LOD: once `height` (the tallest character's cap height, world
 * units) is under 3 CSS px on screen, the renderer fills `greek` (one box per run, cap height
 * tall) faintly instead of drawing the glyphs.
 */
export interface TextLod {
  readonly height: number;
  readonly greek: readonly number[];
  /**
   * The TrueType glyphs a `fill` of text draws, in order (M2-16 part 3): a PDF plot writes them
   * as text in the embedded font instead of filling their outlines.
   */
  readonly glyphs?: readonly PlacedGlyph[];
}

/** A TrueType glyph placed in the drawing (structurally the PDF writer's `PlotGlyph`). */
export interface PlacedGlyph {
  readonly font: TtfFont;
  /** Glyph number in the font file. */
  readonly index: number;
  readonly codePoint: number;
  /** Font units (y up, origin on the baseline) → world. */
  readonly m: Affine;
}

/**
 * Path commands in world coordinates, packed for speed:
 *   M x y · L x y · A cx cy r a0 a1 ccw · E cx cy rx ry rotation a0 a1 ccw · Z
 *   Q x1 y1 x y (quadratic Bézier) · C x1 y1 x2 y2 x y (cubic Bézier)
 * Arcs, ellipses and Béziers (TrueType outlines, M1-41) stay exact: the canvas draws them
 * natively at any zoom, and an affine map carries a Bézier by its control points.
 */
export const PATH_M = 0;
export const PATH_L = 1;
export const PATH_A = 2;
export const PATH_E = 3;
export const PATH_Z = 4;
export const PATH_Q = 5;
export const PATH_C = 6;

/** A 2D affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export interface PrimitiveFrame {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** A gradient hatch's fill (M1-16 part 2): a two-colour ramp laid out in `frame`. */
export interface FillGradient {
  /** `linear` runs along x from 0 to 1 of the unit frame; `radial` from its origin to radius 1. */
  readonly kind: 'linear' | 'radial';
  /** Unit frame → world. */
  readonly frame: PrimitiveFrame;
  /** [offset along the ramp, weight of colour 2]. */
  readonly stops: readonly (readonly [offset: number, mix: number])[];
  readonly colors: readonly [PrimitiveColor, PrimitiveColor];
  /**
   * A one-colour gradient: colour 2 is colour 1 shaded toward black (below 0.5) or tinted
   * toward white (above), resolved per frame because colour 1 may be the foreground.
   */
  readonly tint?: number;
}

/**
 * One family of a pattern hatch's lines (M1-16 part 2), for the LOD that draws it as its area
 * at its average ink once the lines are under a pixel apart.
 */
export interface HatchTint {
  /** The hatch boundary as a fill path, and its fill rule. */
  readonly area: readonly number[];
  readonly evenOdd: boolean;
  /** World units between neighbouring lines. */
  readonly spacing: number;
  /** One dash repetition (0: continuous), its dashes' total length, and its dashes and dots. */
  readonly period: number;
  readonly dashLength: number;
  readonly marks: number;
}

/**
 * A raster image's bitmap, decoded to straight (not premultiplied) RGBA, rows top first, as
 * the app hands it over for an IMAGEDEF (M1-19).
 */
export interface RasterPixels {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes. */
  readonly data: Uint8ClampedArray;
  /**
   * A one-bit image. AutoCAD draws a bitonal image's foreground in the IMAGE's colour and its
   * background in the drawing's; the foreground here is the pixels darker than mid grey, as
   * in a black-on-white scan.
   */
  readonly bitonal?: boolean;
}

/** An IMAGE's bitmap on a `fill` whose path is the part of the image shown (M1-19). */
export interface ImageFill {
  /** The IMAGEDEF whose pixels are drawn. */
  readonly definition: string;
  /** Bitmap space (x right and y down in pixels, its top-left corner at 0, 0) → world. */
  readonly frame: PrimitiveFrame;
  /**
   * DXF 13: the image size in pixels the frame is laid out for; a bitmap of another size
   * (the file changed since it was attached) is stretched to it, as AutoCAD does.
   */
  readonly width: number;
  readonly height: number;
  /** DXF 281 / 282 / 283, 0–100: AutoCAD's defaults are 50, 50 and 0. */
  readonly brightness: number;
  readonly contrast: number;
  readonly fade: number;
  /** DXF 70 bit 8: transparent pixels (and a bitonal image's background) show through. */
  readonly transparent: boolean;
}

/**
 * A PDF underlay on a `fill` (M1-20). The path is the clip boundary in world coordinates when
 * `clipped`, else empty: the whole page shows, and its size is known only once the app has
 * drawn it (`UnderlayRaster.page`).
 */
export interface UnderlayFill {
  /** The PDFDEFINITION whose page is drawn. */
  readonly definition: string;
  /** Underlay space (the page in inches, origin at its lower-left corner, y up) → world. */
  readonly frame: PrimitiveFrame;
  readonly clipped: boolean;
  /** DXF 281, 20–100 (100 unchanged), and 282, 0–80. */
  readonly contrast: number;
  readonly fade: number;
  /** DXF 280 bit 4. */
  readonly monochrome: boolean;
  /** DXF 280 bit 8: colours adjusted for the background. */
  readonly adjustColors: boolean;
  /**
   * The PDF layers (optional content group names) the underlay turns off (ULAYERS, M2-38
   * part 2), sorted, once each; absent when none. Its page is drawn without them, so its
   * raster is asked for and kept apart from the plain page's (`underlayKey`).
   */
  readonly layersOff?: readonly string[];
  /**
   * PDFFRAME 0, or 2 in a plot (M5-04 part 17): the boundary or page is not outlined; absent
   * when it is. It stays the underlay's outline for picking and the selection's highlight.
   */
  readonly frameOff?: true;
}

/**
 * Part of a PDF underlay's page drawn by the app (M1-20), as it answers an `UnderlayRequest`.
 * Pixels are straight RGBA, rows top first; the paper is clear, as AutoCAD shows only the
 * page's content.
 */
export interface UnderlayRaster {
  /** The page size in underlay units (inches: 72 PDF points). */
  readonly page: { readonly width: number; readonly height: number };
  /** The part of the page the pixels cover, underlay units, y up. */
  readonly region: Box;
  readonly pixels: RasterPixels;
}

/**
 * The page a PDF underlay needs drawn (M1-20): `region` of it at `scale` pixels per underlay
 * unit. The renderer asks whenever the view needs more than the raster it has shows; the app
 * draws the page clipped to the page and to its own pixel budget.
 */
export interface UnderlayRequest {
  readonly definition: string;
  readonly scale: number;
  readonly region: Box;
  /** The PDF layers drawn turned off (`UnderlayFill.layersOff`); absent when none. */
  readonly layersOff?: readonly string[];
}

/**
 * XCLIP boundaries (M1-103), each a closed polygon as flat world `x, y` pairs: a primitive shows
 * only where it is inside every one (nonzero winding), one per clipped reference around it,
 * outermost first. Shared by reference among the parts of one reference, so the renderer sets a
 * clip once per run of parts.
 */
export type PrimitiveClip = readonly (readonly number[])[];

export type RenderPrimitive =
  | {
      readonly kind: 'stroke' | 'fill';
      readonly path: readonly number[];
      readonly color: PrimitiveColor;
      /**
       * Inside a block reference (M1-18): the layers that hide this part when frozen in a
       * viewport, its own effective layer and every nested reference's above it.
       */
      readonly layers?: readonly string[];
      /** Inside XCLIPped references (M1-103): the clip polygons it shows within. */
      readonly clip?: PrimitiveClip;
      /** Object transparency (M1-108): the opacity it draws at, below 1; absent is opaque. */
      readonly opacity?: number;
      /** Lineweight in millimetres; undefined is the default (drawn 1 px). */
      readonly lineweight?: number;
      /** Fill rule for `fill`: AutoCAD hatch loops use odd parity. */
      readonly evenOdd?: boolean;
      /**
       * A dashed stroke (M1-13): the exact path without its linetype, drawn instead once one
       * pattern repetition (`patternLength`, world units) is under a pixel on screen, and
       * used for picking so a click in a gap still hits.
       */
      readonly continuous?: readonly number[];
      readonly patternLength?: number;
      /** A gradient `fill`: drawn with this ramp instead of `color`. */
      readonly gradient?: FillGradient;
      /**
       * An image `fill`: the bitmap drawn clipped to the path, or, while the app has no pixels
       * for it, the path outlined in `color`.
       */
      readonly image?: ImageFill;
      /** A PDF underlay `fill` (M1-20): its page drawn clipped to the path or the page. */
      readonly underlay?: UnderlayFill;
      /** A pattern hatch family's `stroke`, with its sub-pixel tint. */
      readonly hatch?: HatchTint;
      /** Text glyphs, with their greeking. */
      readonly text?: TextLod;
      /**
       * A missing image's file name (M1-109): drawn only while the app has no bitmap for this
       * IMAGEDEF, which the renderer asks each frame as bitmaps arrive after tessellation.
       */
      readonly missingImage?: string;
      /**
       * A field's grey background (FIELDDISPLAY, M4-10 part 3): drawn on screen while
       * `RenderStyle.showFields` is not false, at its own opacity whatever TRANSPARENCYDISPLAY
       * says, and never plotted.
       */
      readonly fieldShade?: true;
    }
  /** XLINE (both directions) or RAY (one direction), clipped to the view when drawn. */
  | {
      readonly kind: 'infinite';
      readonly base: { readonly x: number; readonly y: number };
      readonly direction: { readonly x: number; readonly y: number };
      readonly both: boolean;
      readonly color: PrimitiveColor;
      /**
       * A linetype (M1-45 part 2): its elements in world units (dash > 0, gap < 0, dot 0) and
       * one repetition, laid out from `base` at draw time over the part on screen.
       */
      readonly dashes?: { readonly lengths: readonly number[]; readonly period: number };
      /**
       * Inside a block reference (M1-18): the layers that hide this part when frozen in a
       * viewport, its own effective layer and every nested reference's above it.
       */
      readonly layers?: readonly string[];
      /** Inside XCLIPped references (M1-103): the clip polygons it shows within. */
      readonly clip?: PrimitiveClip;
      /** Object transparency (M1-108): the opacity it draws at, below 1; absent is opaque. */
      readonly opacity?: number;
      readonly lineweight?: number;
    }
  /**
   * A POINT: a dot, or with `figure` the PDMODE figure (M3-01 part 4), sized when drawn since a
   * relative PDSIZE follows the view (`point-style.ts`).
   */
  | {
      readonly kind: 'point';
      readonly x: number;
      readonly y: number;
      readonly color: PrimitiveColor;
      readonly figure?: PointFigure;
      /**
       * Inside a block reference (M1-18): the layers that hide this part when frozen in a
       * viewport, its own effective layer and every nested reference's above it.
       */
      readonly layers?: readonly string[];
      /** Inside XCLIPped references (M1-103): the clip polygons it shows within. */
      readonly clip?: PrimitiveClip;
      /** Object transparency (M1-108): the opacity it draws at, below 1; absent is opaque. */
      readonly opacity?: number;
    };

/** A POINT's PDMODE figure (M3-01 part 4): its mode, PDSIZE and turn (DXF 50). */
export interface PointFigure {
  readonly mode: number;
  /** PDSIZE as set: > 0 drawing units, else a percentage of the view's height (0 is 5). */
  readonly size: number;
  readonly angle?: number;
}

/** A rectangle of the canvas, CSS pixels from its top-left corner. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An entity drawn on the canvas: its handle and its DXF type (the geometry's kind). */
export interface DrawnEntity {
  readonly handle: Handle;
  readonly type: string;
}

export interface Renderer {
  /** The viewport's CSS size and device pixel ratio. */
  resize(width: number, height: number, dpr: number): void;
  setView(view: ViewTransform): void;
  /** Incremental scene update, called after the model (and its spatial index) applied `cs`. */
  apply(change: ChangeSet): void;
  /** Rubber bands, grips and osnap markers: drawn on top, never touching the scene cache. */
  setTransient(primitives: readonly RenderPrimitive[]): void;
  setStyle(style: RenderStyle): void;
  /** Draws one frame. */
  frame(): void;
  /**
   * Entities within `aperture` CSS pixels of a screen point, nearest first. `view` is the view
   * the point was taken in, the view set when left out: a canvas sends its views with its frames,
   * so a pick made just after a zoom names the view it was made in (M5-23).
   */
  hitTest(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
    view?: ViewTransform,
  ): EntityId[];
  /**
   * What a pick within `aperture` CSS pixels of a screen point hit inside the block reference
   * `id` (M5-06 part 5), the nearest part's object; null where it comes near none of them.
   * `view` as `hitTest`'s.
   */
  nestedHit(
    screen: { readonly x: number; readonly y: number },
    aperture: number,
    id: EntityId,
    view?: ViewTransform,
  ): NestedPick | null;
  /**
   * The entities drawn in a rectangle of the canvas, model space through a layout's viewports
   * included, in handle order: the fidelity harness names them where a golden image differs
   * (M1-106).
   */
  entitiesIn(rect: ScreenRect): DrawnEntity[];
  /**
   * The entities of the space shown a selection window takes (M2-03): a `window` those wholly
   * inside `box` (world units), a `crossing` window those inside it or crossing its edge.
   */
  select(query: SelectQuery): EntityId[];
  /** The entities to draw selected (M2-03): highlighted over the scene; none clears it. */
  setHighlight(ids: readonly EntityId[]): void;
  /**
   * The layout viewport made current (MSPACE, M6-02 part 3), by handle; undefined, paper space.
   * While it is, picks, windows and snaps take model space's objects, and the selection, grips
   * and previews are drawn through the viewport, clipped to it; its frame is drawn bold.
   */
  setActiveViewport(handle: Handle | undefined): void;
  /**
   * The reference edited in place (REFEDIT, M5-02 part 5): the working set drawn in full and the
   * rest faded (XFADECTL), the other references to its block drawing it whole; undefined, none.
   */
  setRefEdit(display: RefEditDisplay | undefined): void;
  /**
   * The objects a command drags with the cursor (M2-06 part 2), drawn moved on the transient
   * layer over their originals; undefined ends the drag.
   */
  setDrag(motion: DragMotion | undefined): void;
  /**
   * The objects to show grips on, `hot` the hot grip (M2-06 part 2), and the groups shown by
   * one grip at their centre (GROUPDISPLAYMODE, M3-13); none hides them.
   */
  setGrips(ids: readonly EntityId[], hot?: Vec2, groups?: readonly GroupGrip[]): void;
  /**
   * The cursor (M3-05 part 2): the grip nearest it within `within` drawing units draws in the
   * hover colour; undefined, none does.
   */
  setGripHover(at: Vec2 | undefined, within: number): void;
  /**
   * The selection preview (M3-04 part 5, SELECTIONPREVIEW): the object under the pickbox at
   * `screen`, unless PREVIEWFILTER leaves it out, is highlighted on the transient layer, with
   * its group when group selection is on; with `area` (M3-04 part 6), what that window,
   * polygon, fence or lasso being dragged would take, none once it takes more than `limit`;
   * undefined, none is.
   */
  setSelectionPreview(preview: SelectionPreview | undefined): void;
}

/** Where the pickbox is and what the selection preview leaves out (M3-04 part 5). */
export interface SelectionPreview {
  /** The cursor, in CSS pixels from the canvas's top left (the pickbox's preview). */
  readonly screen?: { readonly x: number; readonly y: number };
  /** The view `screen` was taken in (M5-23); the view set when left out. */
  readonly view?: ViewTransform;
  /**
   * A selection window, polygon, fence or lasso being dragged, in world units (M3-04 part 6):
   * what it would take previews instead of the object under the pickbox.
   */
  readonly area?: SelectQuery;
  /**
   * SELECTIONPREVIEWLIMIT: an `area` taking more objects than this previews none ("whenever the
   * selection set exceeds the number in this setting, all preview highlighting is
   * discontinued"); undefined, no limit.
   */
  readonly limit?: number;
  /**
   * Shift+Space pressed this many times over overlapping objects (M3-04 part 7): the object
   * under the pickbox that many steps on from the nearest (round again after the farthest) is
   * the one previewed, whatever PREVIEWFILTER says; undefined, the nearest, filtered.
   */
  readonly cycle?: number;
  /** The pickbox's half size in CSS pixels (PICKBOX). */
  readonly aperture: number;
  /** PREVIEWFILTER's bits. */
  readonly filter: number;
  /** Group selection is on (PICKSTYLE bit 1). */
  readonly groups: boolean;
}

/**
 * A selection window in world units (M2-03), or a selection polygon or fence (M3-04): with
 * `polygon`, `window` (WPolygon) and `crossing` (CPolygon) test against the polygon through its
 * points, `fence` against the open run of lines through them, and `box` holds them all.
 */
export interface SelectQuery {
  readonly kind: 'window' | 'crossing' | 'fence';
  readonly box: Box;
  readonly polygon?: readonly { readonly x: number; readonly y: number }[];
}

/**
 * The view of model space a layout viewport shows when the sheet is shown in `view` (MSPACE,
 * M6-02 part 3): a point of model space is at the screen point its sheet point is at. The
 * viewport must be one the cursor can work through (`workableViewport`: plan, no twist), whose
 * model → paper map is a scale and a move.
 */
export function modelViewOf(view: ViewTransform, vp: ViewportGeometry): ViewTransform {
  const t = viewportTransform(vp);
  return {
    center: { x: (view.center.x - t.e) / t.a, y: (view.center.y - t.f) / t.d },
    scale: view.scale * t.a,
  };
}

/** The world box a view shows on a viewport of the given CSS size. */
export function visibleBox(view: ViewTransform, width: number, height: number): Box {
  const hw = width / 2 / view.scale;
  const hh = height / 2 / view.scale;
  return {
    minX: view.center.x - hw,
    minY: view.center.y - hh,
    maxX: view.center.x + hw,
    maxY: view.center.y + hh,
  };
}

/** The view that fits `box` into a viewport, leaving `margin` (a fraction) on each side. */
export function fitView(box: Box, width: number, height: number, margin = 0.05): ViewTransform {
  const w = Math.max(box.maxX - box.minX, 0);
  const h = Math.max(box.maxY - box.minY, 0);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const usable = 1 - 2 * margin;
  const sx = w > 0 ? (width * usable) / w : Infinity;
  const sy = h > 0 ? (height * usable) / h : Infinity;
  const scale = Math.min(sx, sy);
  return { center, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

export function worldToScreen(
  view: ViewTransform,
  width: number,
  height: number,
  p: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  return {
    x: width / 2 + (p.x - view.center.x) * view.scale,
    y: height / 2 - (p.y - view.center.y) * view.scale,
  };
}

export function screenToWorld(
  view: ViewTransform,
  width: number,
  height: number,
  p: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  return {
    x: view.center.x + (p.x - width / 2) / view.scale,
    y: view.center.y - (p.y - height / 2) / view.scale,
  };
}

/**
 * A reference edited in place (REFEDIT, M5-02 part 5) as the canvas shows it. The working set is
 * carried out of its block into the space while it is edited, so the block holds only the rest:
 * the reference edited draws that, and every other reference to the block draws the definition as
 * it was (`order`, with `held` for what went out) until REFCLOSE saves the edit, as AutoCAD's do.
 */
export interface RefEditDisplay {
  /** The block edited. */
  readonly block: Handle;
  /** The references from the one picked (in the space shown) inward to the one edited. */
  readonly path: readonly EntityId[];
  /** The block's entities, in block order, before the working set went out. */
  readonly order: readonly EntityId[];
  /** The objects carried out, as the definition held them. */
  readonly held: readonly Entity[];
  /** The working set: objects of the space drawn in full; every other object fades by XFADECTL. */
  readonly working: readonly EntityId[];
}
