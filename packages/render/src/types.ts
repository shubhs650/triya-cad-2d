// The renderer contract (ARCHITECTURE.md §7.1). Everything outside packages/render talks to a
// `Renderer`; only this package knows it is Canvas 2D underneath, so a WebGL renderer can
// replace it behind the same interface (DEC-006).

import type { Box, ChangeSet, EntityId, Handle } from '@triya/engine';

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
   * TRANSPARENCYDISPLAY (M1-108): object transparency shown; false draws every object opaque.
   * AutoCAD's initial value is 1, so absent shows it.
   */
  readonly showTransparency?: boolean;
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
  /** A POINT drawn as a dot (PDMODE 0); other PDMODE shapes come with the POINT style task. */
  | {
      readonly kind: 'point';
      readonly x: number;
      readonly y: number;
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
    };

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
  /** Entities within `aperture` CSS pixels of a screen point, nearest first. */
  hitTest(screen: { readonly x: number; readonly y: number }, aperture: number): EntityId[];
  /**
   * The entities drawn in a rectangle of the canvas, model space through a layout's viewports
   * included, in handle order: the fidelity harness names them where a golden image differs
   * (M1-106).
   */
  entitiesIn(rect: ScreenRect): DrawnEntity[];
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
