// IMAGE and WIPEOUT (M1-19): the image's shown area as a fill carrying its bitmap placement,
// its frame, and the pixel adjustments (brightness, contrast, fade, transparency) applied to a
// bitmap once per setting, never per frame.
//
// Placement: DXF 10 is the image's lower-left corner and 11 / 12 one pixel's step along its U
// and V axes, so the image covers position + u·i + v·j for 0 ≤ i ≤ width, 0 ≤ j ≤ height.
// Bitmap rows run top first, so bitmap point (x, y) is position + u·x + v·(height − y).
//
// The clip boundary (DXF 14) is in pixel coordinates centred on pixels with V counted down
// from the top edge, so vertex (x, y) is bitmap point (x + ½, y + ½); the unclipped boundary
// AutoCAD writes is (−½, −½)–(width − ½, height − ½). The DXF reference gives no origin; the
// public corpus pins it (see image.test.ts). A WIPEOUT is a 1 × 1 image with the same rules.

import type { ImageGeometry, Vec2 } from '@triya/engine';
import type { Paint } from './tessellate';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  type PrimitiveFrame,
  type RasterPixels,
  type RenderPrimitive,
} from './types';

/**
 * IMAGEFRAME and WIPEOUTFRAME (RASTERVARIABLES / WIPEOUTVARIABLES DXF 70). AutoCAD's initial
 * value of both is 1 (shown), which a drawing without the objects keeps. Value 2 ("displayed
 * but not plotted") reads as shown, which is what the screen does.
 */
export interface ImageFrames {
  readonly image: boolean;
  readonly wipeout: boolean;
}

const FRAMES_ON: ImageFrames = { image: true, wipeout: true };

/** DXF 70 bit 1: show image; bit 8: transparency on. */
const SHOW_IMAGE = 1;
const TRANSPARENT = 8;

/** Bitmap space (pixels, y down from the top edge) → world. */
function bitmapFrame(g: ImageGeometry): PrimitiveFrame {
  const h = g.size.y;
  return {
    a: g.u.x,
    b: g.u.y,
    c: -g.v.x,
    d: -g.v.y,
    e: g.position.x + g.v.x * h,
    f: g.position.y + g.v.y * h,
  };
}

const at = (f: PrimitiveFrame, x: number, y: number): Vec2 => ({
  x: f.a * x + f.c * y + f.e,
  y: f.b * x + f.d * y + f.f,
});

function ring(path: number[], pts: readonly Vec2[]): void {
  pts.forEach((p, i) => path.push(i === 0 ? PATH_M : PATH_L, p.x, p.y));
  path.push(PATH_Z);
}

/** The whole image, counter-clockwise from its lower-left corner. */
function outline(g: ImageGeometry, f: PrimitiveFrame): Vec2[] {
  const { x: w, y: h } = g.size;
  return [at(f, 0, h), at(f, w, h), at(f, w, 0), at(f, 0, 0)];
}

/** The clip boundary in world coordinates, or undefined when it states no area. */
function boundary(g: ImageGeometry, f: PrimitiveFrame): Vec2[] | undefined {
  const v = g.clip.vertices;
  if (v.length < 2) return undefined;
  if (g.clip.type === 'rectangle' && v.length === 2) {
    const x0 = v[0]!.x + 0.5;
    const y0 = v[0]!.y + 0.5;
    const x1 = v[1]!.x + 0.5;
    const y1 = v[1]!.y + 0.5;
    return [at(f, x0, y0), at(f, x1, y0), at(f, x1, y1), at(f, x0, y1)];
  }
  // AutoCAD repeats the first vertex at the end; the path closes itself.
  const last = v.length - 1;
  const closed = v.length > 3 && v[0]!.x === v[last]!.x && v[0]!.y === v[last]!.y;
  const pts = (closed ? v.slice(0, last) : v).map((p) => at(f, p.x + 0.5, p.y + 0.5));
  return pts.length >= 3 ? pts : undefined;
}

/** An IMAGE or WIPEOUT: its fill (bitmap or background mask), then its frame when shown. */
export function imagePrimitives(
  g: ImageGeometry,
  paint: Paint,
  frames: ImageFrames = FRAMES_ON,
): RenderPrimitive[] {
  if (!(g.size.x > 0 && g.size.y > 0)) return [];
  const f = bitmapFrame(g);
  // A wipeout's boundary is its shape; an image's applies while clipping is on (DXF 280).
  const clip = g.kind === 'WIPEOUT' || g.clipping ? boundary(g, f) : undefined;
  const shape = clip ?? outline(g, f);
  const inverted = g.kind === 'IMAGE' && clip !== undefined && g.clip.inverted;
  const out: RenderPrimitive[] = [];
  const area: number[] = [];
  if (inverted) ring(area, outline(g, f));
  ring(area, shape);
  if (g.kind === 'WIPEOUT') {
    out.push({ kind: 'fill', path: area, color: 'background' });
  } else if (g.definition && (g.displayFlags & SHOW_IMAGE) !== 0) {
    out.push({
      kind: 'fill',
      path: area,
      color: paint.color,
      ...(inverted ? { evenOdd: true } : {}),
      image: {
        definition: g.definition,
        frame: f,
        width: g.size.x,
        height: g.size.y,
        brightness: g.brightness,
        contrast: g.contrast,
        fade: g.fade,
        transparent: (g.displayFlags & TRANSPARENT) !== 0,
      },
    });
  }
  if (g.kind === 'WIPEOUT' ? frames.wipeout : frames.image) {
    // The frame is the clip boundary (an inverted clip's too), in the entity's colour.
    const path: number[] = [];
    ring(path, shape);
    out.push({
      kind: 'stroke',
      path,
      color: paint.color,
      ...(paint.lineweight === undefined ? {} : { lineweight: paint.lineweight }),
    });
  }
  return out;
}

export interface PixelAdjustment {
  /** DXF 281 / 282 / 283, 0–100. */
  readonly brightness: number;
  readonly contrast: number;
  readonly fade: number;
  readonly transparent: boolean;
  /** The image's colour (a bitonal image's foreground) and the background, 0–255. */
  readonly color: readonly [number, number, number];
  readonly background: readonly [number, number, number];
}

/** Bitonal: a pixel darker than this (mean of its channels) is foreground. */
const BITONAL_THRESHOLD = 128;

/**
 * The pixels as AutoCAD would show them, straight RGBA. AutoCAD documents what the settings
 * do but not the arithmetic, so the curves here are ours (M1-19, unverified against AutoCAD
 * until reference plots exist, M1-64):
 *   contrast c scales about mid grey by c / 50 (0 flat grey, 50 unchanged, 100 doubled);
 *   brightness b adds (b − 50) / 50 × 255 (0 black, 100 white);
 *   fade f mixes f / 100 of the background in ("blends the image into the background").
 * A bitonal image takes no brightness or contrast (AutoCAD greys both out for one): its
 * foreground is the image colour and its background the drawing's, or clear when transparent.
 * Without transparency a pixel's alpha is laid over the background, so the image is opaque.
 */
export function adjustPixels(src: RasterPixels, o: PixelAdjustment): Uint8ClampedArray {
  const n = src.width * src.height * 4;
  const s = src.data;
  const out = new Uint8ClampedArray(n);
  const k = o.contrast / 50;
  const add = ((o.brightness - 50) / 50) * 255;
  const t = Math.min(Math.max(o.fade / 100, 0), 1);
  const [br, bg, bb] = o.background;
  const [cr, cg, cb] = o.color;
  const fadeTo = (v: number, back: number) => Math.round(v * (1 - t) + back * t);
  for (let i = 0; i < n; i += 4) {
    const alpha = s[i + 3]! / 255;
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    if (src.bitonal) {
      const fore = (s[i]! + s[i + 1]! + s[i + 2]!) / 3 < BITONAL_THRESHOLD && alpha > 0;
      if (!fore && o.transparent) continue;
      [r, g, b] = fore ? [cr, cg, cb] : [br, bg, bb];
    } else {
      const level = (v: number) => Math.min(Math.max((v - 128) * k + 128 + add, 0), 255);
      r = level(s[i]!);
      g = level(s[i + 1]!);
      b = level(s[i + 2]!);
      if (o.transparent) a = s[i + 3]!;
      else {
        r = r * alpha + br * (1 - alpha);
        g = g * alpha + bg * (1 - alpha);
        b = b * alpha + bb * (1 - alpha);
      }
    }
    out[i] = fadeTo(r, br);
    out[i + 1] = fadeTo(g, bg);
    out[i + 2] = fadeTo(b, bb);
    out[i + 3] = a;
  }
  return out;
}
