// PDFUNDERLAY (M1-20): the page shown as a fill carrying the underlay's placement, what of the
// page the view needs drawn, and the display settings applied to a drawn page once per setting.
//
// Placement: the underlay's own space is the page in inches (72 PDF points each), its origin
// at the page's lower-left corner, scaled by DXF 41 / 42 and turned by the rotation about the
// insertion point; a −Z underlay's Y axis is reversed (map/entities.ts `underlayGeometry`). AutoCAD
// attaches a PDF in a millimetre drawing at scale 25.4, which is this unit. The clip boundary
// (DXF 11) is in the same unscaled space: two vertices are opposite corners of a rectangle.
//
// Resolution: the page is not in the drawing. The renderer asks the app (`UnderlayRequest`) for
// the part of the page on screen at the screen's resolution, rounded up to steps of √2 and
// padded by a quarter of the view each side on a 64-pixel grid, so a small pan or zoom draws
// from the raster it has and asks for nothing new.

import type { Box, UnderlayGeometry, Vec2 } from '@triya/engine';
import type { Paint } from './tessellate';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  type PrimitiveFrame,
  type RasterPixels,
  type RenderPrimitive,
  type UnderlayFill,
  type UnderlayRaster,
  type UnderlayRequest,
} from './types';

/** DXF 280 bits. */
export const UNDERLAY_CLIPPING = 1;
export const UNDERLAY_ON = 2;
export const UNDERLAY_MONOCHROME = 4;
export const UNDERLAY_ADJUST_COLORS = 8;

/** A request's resolution steps and padding, and the grid its region snaps out to. */
const STEP = Math.SQRT2;
const PAD = 0.25;
const GRID_PX = 64;

/** Underlay space → world. */
export function underlayFrame(g: UnderlayGeometry): PrimitiveFrame {
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  const sx = g.scale.x;
  const sy = g.scale.y * (g.upsideDown ? -1 : 1);
  return { a: sx * cos, b: sx * sin, c: -sy * sin, d: sy * cos, e: g.position.x, f: g.position.y };
}

const at = (f: PrimitiveFrame, x: number, y: number): Vec2 => ({
  x: f.a * x + f.c * y + f.e,
  y: f.b * x + f.d * y + f.f,
});

/** The clip boundary in underlay space, or undefined when it states no area. */
function boundary(g: UnderlayGeometry): Vec2[] | undefined {
  const v = g.clip;
  if (v.length === 2) {
    const [p, q] = [v[0]!, v[1]!];
    return [p, { x: q.x, y: p.y }, q, { x: p.x, y: q.y }];
  }
  const last = v.length - 1;
  const closed = v.length > 3 && v[0]!.x === v[last]!.x && v[0]!.y === v[last]!.y;
  const pts = closed ? v.slice(0, last) : [...v];
  return pts.length >= 3 ? pts : undefined;
}

/** A closed ring of underlay points as a world path. */
export function underlayRing(f: PrimitiveFrame, pts: readonly Vec2[]): number[] {
  const path: number[] = [];
  pts.forEach((p, i) => {
    const w = at(f, p.x, p.y);
    path.push(i === 0 ? PATH_M : PATH_L, w.x, w.y);
  });
  path.push(PATH_Z);
  return path;
}

/** The page rectangle (underlay space) as a world path. */
export function pagePath(f: PrimitiveFrame, page: UnderlayRaster['page']): number[] {
  const { width: w, height: h } = page;
  return underlayRing(f, [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

/**
 * A PDFUNDERLAY: one fill carrying its page, clipped to its boundary while clipping is on. An
 * underlay turned off (DXF 280 bit 2 clear) draws nothing; AutoCAD's help does not say whether
 * its frame stays (ambiguity noted, M1-20). Without a definition there is no page to show, so a
 * clipped one draws its boundary and an unclipped one nothing.
 */
export function underlayPrimitives(g: UnderlayGeometry, paint: Paint): RenderPrimitive[] {
  if ((g.flags & UNDERLAY_ON) === 0) return [];
  if (!(g.scale.x !== 0 && g.scale.y !== 0)) return [];
  const f = underlayFrame(g);
  const clip = (g.flags & UNDERLAY_CLIPPING) !== 0 ? boundary(g) : undefined;
  const path = clip ? underlayRing(f, clip) : [];
  const lineweight = paint.lineweight === undefined ? {} : { lineweight: paint.lineweight };
  if (!g.definition)
    return clip ? [{ kind: 'stroke', path, color: paint.color, ...lineweight }] : [];
  return [
    {
      kind: 'fill',
      path,
      color: paint.color,
      ...lineweight,
      underlay: {
        definition: g.definition,
        frame: f,
        clipped: clip !== undefined,
        contrast: g.contrast,
        fade: g.fade,
        monochrome: (g.flags & UNDERLAY_MONOCHROME) !== 0,
        adjustColors: (g.flags & UNDERLAY_ADJUST_COLORS) !== 0,
      },
    },
  ];
}

/** Pixels per underlay unit at `k` device pixels per world unit: the frame's larger stretch. */
export function underlayScale(f: PrimitiveFrame, k: number): number {
  return k * Math.max(Math.hypot(f.a, f.b), Math.hypot(f.c, f.d));
}

function boxOfPath(path: readonly number[]): Box | undefined {
  let box: Box | undefined;
  for (let i = 0; i < path.length;) {
    if (path[i] === PATH_Z) {
      i += 1;
      continue;
    }
    const x = path[i + 1]!;
    const y = path[i + 2]!;
    box = box
      ? {
          minX: Math.min(box.minX, x),
          minY: Math.min(box.minY, y),
          maxX: Math.max(box.maxX, x),
          maxY: Math.max(box.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
    i += 3;
  }
  return box;
}

const intersect = (a: Box, b: Box): Box | undefined => {
  const out = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return out.minX < out.maxX && out.minY < out.maxY ? out : undefined;
};

/**
 * What one underlay on screen needs of its page: the part inside the visible `box` (world) and
 * its clip, in underlay units, at the screen's resolution; clamped to the page when its size is
 * known. Undefined when none of it is on screen.
 */
export function underlayNeed(
  u: UnderlayFill,
  path: readonly number[],
  box: Box,
  k: number,
  page?: UnderlayRaster['page'],
): { readonly scale: number; readonly region: Box } | undefined {
  const clip = u.clipped ? boxOfPath(path) : undefined;
  const seen = clip ? intersect(box, clip) : box;
  if (!seen) return undefined;
  const f = u.frame;
  const det = f.a * f.d - f.b * f.c;
  if (det === 0) return undefined;
  // World → underlay through the frame's inverse; a rotated view box maps to a rotated
  // rectangle, which its four corners bound.
  const inv = (x: number, y: number): Vec2 => ({
    x: (f.d * (x - f.e) - f.c * (y - f.f)) / det,
    y: (f.a * (y - f.f) - f.b * (x - f.e)) / det,
  });
  const corners = [
    inv(seen.minX, seen.minY),
    inv(seen.maxX, seen.minY),
    inv(seen.maxX, seen.maxY),
    inv(seen.minX, seen.maxY),
  ];
  let region: Box | undefined = {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
  if (page) region = intersect(region, { minX: 0, minY: 0, maxX: page.width, maxY: page.height });
  return region ? { scale: underlayScale(f, k), region } : undefined;
}

/** Two needs of one page (two underlays, or one in two viewports) as one. */
export function mergeNeeds(
  a: { readonly scale: number; readonly region: Box },
  b: { readonly scale: number; readonly region: Box },
): { readonly scale: number; readonly region: Box } {
  return {
    scale: Math.max(a.scale, b.scale),
    region: {
      minX: Math.min(a.region.minX, b.region.minX),
      minY: Math.min(a.region.minY, b.region.minY),
      maxX: Math.max(a.region.maxX, b.region.maxX),
      maxY: Math.max(a.region.maxY, b.region.maxY),
    },
  };
}

/**
 * A need as the request the app is asked for: resolution stepped up, region padded and snapped,
 * and kept on the page once its size is known.
 */
export function underlayRequest(
  definition: string,
  need: { readonly scale: number; readonly region: Box },
  page?: UnderlayRaster['page'],
): UnderlayRequest {
  const scale = STEP ** Math.ceil(Math.log(need.scale) / Math.log(STEP) - 1e-9);
  const { region: r } = need;
  const padX = (r.maxX - r.minX) * PAD;
  const padY = (r.maxY - r.minY) * PAD;
  const grid = GRID_PX / scale;
  const region = {
    minX: Math.floor((r.minX - padX) / grid) * grid,
    minY: Math.floor((r.minY - padY) / grid) * grid,
    maxX: Math.ceil((r.maxX + padX) / grid) * grid,
    maxY: Math.ceil((r.maxY + padY) / grid) * grid,
  };
  if (page) {
    region.minX = Math.max(region.minX, 0);
    region.minY = Math.max(region.minY, 0);
    region.maxX = Math.min(region.maxX, page.width);
    region.maxY = Math.min(region.maxY, page.height);
  }
  return { definition, scale, region };
}

/** Whether `raster` shows `need` at least at the screen's resolution. */
export function rasterCovers(
  raster: UnderlayRaster,
  need: { readonly scale: number; readonly region: Box },
): boolean {
  const r = raster.region;
  const w = r.maxX - r.minX;
  if (!(w > 0)) return false;
  const scale = raster.pixels.width / w;
  const eps = 1e-9 * Math.max(raster.page.width, raster.page.height);
  const n = need.region;
  return (
    scale >= need.scale * (1 - 1e-9) &&
    r.minX <= n.minX + eps &&
    r.minY <= n.minY + eps &&
    r.maxX >= n.maxX - eps &&
    r.maxY >= n.maxY - eps
  );
}

export interface UnderlayAdjustment {
  readonly contrast: number;
  readonly fade: number;
  readonly monochrome: boolean;
  readonly adjustColors: boolean;
  /** The canvas background, 0–255. */
  readonly background: readonly [number, number, number];
}

/**
 * The page as AutoCAD would show it, straight RGBA. AutoCAD documents what the settings do but
 * not the arithmetic, so the curves are ours (M1-20; ambiguity noted):
 *   monochrome draws each pixel as its grey (luma, Rec. 601);
 *   contrast c (20–100, 100 the file's own colours, as AutoCAD writes by default) scales about
 *     mid grey by c / 100;
 *   adjust for background, on a dark background, turns each colour's lightness over and keeps
 *     its hue and chroma, so black linework draws white as ACI 7 does;
 *   fade f (0–80) lets f / 100 of the background through, as alpha, since the paper is clear.
 */
export function adjustUnderlayPixels(src: RasterPixels, o: UnderlayAdjustment): Uint8ClampedArray {
  const s = src.data;
  const out = new Uint8ClampedArray(s.length);
  const k = Math.min(Math.max(o.contrast, 0), 100) / 100;
  const keep = 1 - Math.min(Math.max(o.fade, 0), 100) / 100;
  const [br, bg, bb] = o.background;
  const dark = 0.299 * br + 0.587 * bg + 0.114 * bb < 128;
  const flip = o.adjustColors && dark;
  for (let i = 0; i < s.length; i += 4) {
    let r = s[i]!;
    let g = s[i + 1]!;
    let b = s[i + 2]!;
    if (o.monochrome) r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
    r = (r - 128) * k + 128;
    g = (g - 128) * k + 128;
    b = (b - 128) * k + 128;
    if (flip) {
      // Lightness L → 1 − L with hue and chroma kept: every channel moves by 255 − max − min.
      const d = 255 - Math.max(r, g, b) - Math.min(r, g, b);
      r += d;
      g += d;
      b += d;
    }
    out[i] = Math.round(r);
    out[i + 1] = Math.round(g);
    out[i + 2] = Math.round(b);
    out[i + 3] = Math.round(s[i + 3]! * keep);
  }
  return out;
}
