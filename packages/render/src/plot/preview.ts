// The plot preview (M2-18 part 2; PREVIEW, the Plot dialog's Preview, PRD FR-P3/FR-P4): the
// sheet as it will plot, on a grey backdrop, panned and zoomed like AutoCAD's preview window.
// What is drawn on the sheet is the plot itself rasterised by the app (the PDF the plot writes,
// drawn by pdf.js), so the preview pixel-matches the rasterised PDF: this module only places that
// raster. Each raster covers whole device pixels (`previewRegion`), so at the zoom it was made
// for it is copied pixel for pixel; while a new one is on its way the last one is stretched.
//
// Units: the view is in CSS pixels (scale = CSS pixels per paper millimetre, the paper's
// top-left corner at x, y), the paper in millimetres from its top-left corner, y down.

import type { RasterPixels } from '../types';

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

export interface PreviewPoint {
  readonly x: number;
  readonly y: number;
}

/** CSS pixels per paper millimetre, and where the paper's top-left corner is on the canvas. */
export interface PreviewView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The part of the paper on screen: millimetres from its top-left corner and the device pixels. */
export interface PreviewRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly px: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** CSS pixels around the sheet at Zoom Original. */
export const PREVIEW_MARGIN = 24;
/** The closest the preview zooms: 64 CSS pixels per millimetre (about 1600 % of a 1:1 view). */
export const PREVIEW_MAX_SCALE = 64;
/** The farthest: the sheet a few pixels across. */
const MIN_PAPER_PIXELS = 16;

const snap = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

/** Zoom Original: the whole sheet, centred, with a margin, its corner on a whole device pixel. */
export function fitPreview(paper: PreviewSize, viewport: PreviewSize, dpr: number): PreviewView {
  const room = {
    width: Math.max(1, viewport.width - 2 * PREVIEW_MARGIN),
    height: Math.max(1, viewport.height - 2 * PREVIEW_MARGIN),
  };
  const scale = Math.min(room.width / paper.width, room.height / paper.height);
  return {
    scale,
    x: snap((viewport.width - paper.width * scale) / 2, dpr),
    y: snap((viewport.height - paper.height * scale) / 2, dpr),
  };
}

/** Zooms by `factor` about `at` (CSS pixels): the paper point under it stays put. */
export function zoomPreview(
  v: PreviewView,
  factor: number,
  at: PreviewPoint,
  paper?: PreviewSize,
): PreviewView {
  const least = paper ? MIN_PAPER_PIXELS / Math.max(paper.width, paper.height) : 1e-3;
  const scale = Math.min(PREVIEW_MAX_SCALE, Math.max(least, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
}

/** Moves the sheet by CSS pixels. */
export function panPreview(v: PreviewView, dx: number, dy: number): PreviewView {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Zoom Window: the paper between two canvas points fills the canvas; a sliver leaves the view. */
export function windowPreview(
  v: PreviewView,
  a: PreviewPoint,
  b: PreviewPoint,
  viewport: PreviewSize,
): PreviewView {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < 3 || h < 3) return v;
  const k = Math.min(viewport.width / w, viewport.height / h);
  const scale = Math.min(PREVIEW_MAX_SCALE, v.scale * k);
  const f = scale / v.scale;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  return {
    scale,
    x: viewport.width / 2 - (cx - v.x) * f,
    y: viewport.height / 2 - (cy - v.y) * f,
  };
}

/** The paper on screen as whole device pixels, and the millimetres they cover; none when off it. */
export function previewRegion(
  v: PreviewView,
  paper: PreviewSize,
  viewport: PreviewSize,
  dpr: number,
): PreviewRegion | undefined {
  const cw = Math.round(viewport.width * dpr);
  const ch = Math.round(viewport.height * dpr);
  const left = Math.max(0, Math.floor(v.x * dpr + 1e-9));
  const top = Math.max(0, Math.floor(v.y * dpr + 1e-9));
  const right = Math.min(cw, Math.ceil((v.x + paper.width * v.scale) * dpr - 1e-9));
  const bottom = Math.min(ch, Math.ceil((v.y + paper.height * v.scale) * dpr - 1e-9));
  if (right <= left || bottom <= top) return undefined;
  const mm = (px: number) => px / dpr / v.scale;
  return {
    x: mm(left) - v.x / v.scale,
    y: mm(top) - v.y / v.scale,
    width: mm(right - left),
    height: mm(bottom - top),
    px: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

/** The preview's colours: AutoCAD's grey surround and a white sheet with a shadow. */
const BACKDROP = '#7f7f7f';
const SHADOW = 'rgba(0, 0, 0, 0.45)';
const SHEET = '#ffffff';

/**
 * Draws the preview on a canvas: the backdrop, the sheet and its shadow, then the latest raster
 * of the plot where it lies on the sheet.
 */
export class PlotPreviewSurface {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #paper: PreviewSize;
  #size: PreviewSize = { width: 0, height: 0 };
  #dpr = 1;
  #view: PreviewView = { scale: 1, x: 0, y: 0 };
  #raster: { image: ImageBitmap; region: PreviewRegion } | undefined;

  constructor(canvas: HTMLCanvasElement, paper: PreviewSize) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot draw the preview.');
    this.#ctx = ctx;
    this.#paper = paper;
  }

  get view(): PreviewView {
    return this.#view;
  }

  get size(): PreviewSize {
    return this.#size;
  }

  get dpr(): number {
    return this.#dpr;
  }

  /** The canvas's CSS size and device pixel ratio. */
  resize(size: PreviewSize, dpr: number): void {
    this.#size = size;
    this.#dpr = dpr;
    this.#canvas.width = Math.max(1, Math.round(size.width * dpr));
    this.#canvas.height = Math.max(1, Math.round(size.height * dpr));
  }

  setView(v: PreviewView): void {
    this.#view = v;
  }

  /** The paper on screen now, as `previewRegion` gives it. */
  region(): PreviewRegion | undefined {
    return previewRegion(this.#view, this.#paper, this.#size, this.#dpr);
  }

  /** The plot rasterised for `region` (its `px` size); replaces the last one. */
  async setRaster(pixels: RasterPixels, region: PreviewRegion): Promise<void> {
    const data = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    const image = await createImageBitmap(data);
    this.#raster?.image.close();
    this.#raster = { image, region };
  }

  draw(): void {
    const ctx = this.#ctx;
    const { scale, x, y } = this.#view;
    const dpr = this.#dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    const px = (v: number) => v * dpr;
    const sheet = {
      x: px(x),
      y: px(y),
      width: px(this.#paper.width * scale),
      height: px(this.#paper.height * scale),
    };
    const shadow = Math.max(2, Math.round(4 * dpr));
    ctx.fillStyle = SHADOW;
    ctx.fillRect(sheet.x + shadow, sheet.y + shadow, sheet.width, sheet.height);
    ctx.fillStyle = SHEET;
    ctx.fillRect(sheet.x, sheet.y, sheet.width, sheet.height);
    const r = this.#raster;
    if (!r) return;
    // Where the raster's millimetres are now; at the zoom it was made for, its own pixels.
    const dx = px(x + r.region.x * scale);
    const dy = px(y + r.region.y * scale);
    const dw = px(r.region.width * scale);
    const dh = px(r.region.height * scale);
    const exact =
      Math.abs(dw - r.image.width) < 1e-4 &&
      Math.abs(dh - r.image.height) < 1e-4 &&
      Math.abs(dx - Math.round(dx)) < 1e-4 &&
      Math.abs(dy - Math.round(dy)) < 1e-4;
    if (exact) ctx.drawImage(r.image, Math.round(dx), Math.round(dy));
    else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(r.image, dx, dy, dw, dh);
    }
  }

  /** Zoom Window's rubber band between two canvas points (CSS pixels), over what is drawn. */
  drawWindow(a: PreviewPoint, b: PreviewPoint): void {
    const ctx = this.#ctx;
    const dpr = this.#dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#1e64d2';
    ctx.fillStyle = 'rgba(30, 100, 210, 0.12)';
    ctx.lineWidth = 1;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.#raster?.image.close();
    this.#raster = undefined;
  }
}
