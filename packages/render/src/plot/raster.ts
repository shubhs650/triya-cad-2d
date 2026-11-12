// A plot as a raster (M2-18, ARCHITECTURE.md §12's `PngSink`, PRD FR-F7): the SVG plot
// (`@triya/pdf` `plotSvg`, which this package cannot import, so the app hands its text over)
// drawn by the browser onto a canvas the size the resolution asks for, then read back as
// straight RGBA for the PNG encoder. One picture of the plot, the SVG's, so a PNG shows what the
// SVG and PDF plots show. Main thread only (`Image` decodes the SVG).
// M2-39 part 4: a plot bigger than one bitmap is drawn a band of rows at a time (`top`,
// `rows`): the SVG is drawn at the whole image's size, moved up by `top`, onto a canvas `rows`
// high, which the browser draws from the SVG's vectors, so the bands join without a seam.

import type { RasterPixels } from '../types';

/** The most pixels drawn at once (A1 at about 250 dpi); a bigger plot is drawn in bands. */
export const MAX_RASTER_PIXELS = 64_000_000;

/** The pixels a band of a plot drawn in bands has at most (64 MB of RGBA). */
export const RASTER_BAND_PIXELS = 16_000_000;

/**
 * The most pixels across or down a raster plot may have: the widest canvas Chromium and Firefox
 * draw on (32,767), and about where common image viewers stop opening a PNG.
 */
export const MAX_RASTER_SIDE = 32_767;

/** Why a raster plot of `width` × `height` pixels cannot be made, or undefined when it can. */
export function rasterTooBig(width: number, height: number): string | undefined {
  if (width <= MAX_RASTER_SIDE && height <= MAX_RASTER_SIDE) return undefined;
  return `The image would be ${width} × ${height} pixels, more than ${MAX_RASTER_SIDE.toLocaleString('en-US')} on a side: choose a lower resolution or a smaller paper.`;
}

/** The rows of each band a plot of `width` × `height` pixels is drawn in: one band when it fits. */
export function rasterBands(width: number, height: number): number[] {
  if (width * height <= MAX_RASTER_PIXELS) return [height];
  const rows = Math.max(1, Math.floor(RASTER_BAND_PIXELS / width));
  const out: number[] = [];
  for (let left = height; left > 0; left -= rows) out.push(Math.min(rows, left));
  return out;
}

/** Pixels across and down a paper of `mm` at `dpi`. */
export function rasterSize(
  mm: { readonly width: number; readonly height: number },
  dpi: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round((mm.width / 25.4) * dpi)),
    height: Math.max(1, Math.round((mm.height / 25.4) * dpi)),
  };
}

export interface RasterizeOptions {
  /** Pixels. */
  readonly width: number;
  readonly height: number;
  /** A CSS colour under the plot; transparent when absent. */
  readonly background?: string;
  /** Draw only the band of `rows` rows from row `top` (part 4); the whole image when absent. */
  readonly top?: number;
  readonly rows?: number;
}

/**
 * An SVG document drawn at `width` × `height` pixels, or the band of it `top` and `rows` ask for
 * (`rows` × `width` pixels); throws a message for the user.
 */
export async function rasterizeSvg(svg: string, o: RasterizeOptions): Promise<RasterPixels> {
  const { width, height } = o;
  const top = o.top ?? 0;
  const rows = o.rows ?? height - top;
  const tooBig = rasterTooBig(width, height);
  if (tooBig) throw new RangeError(tooBig);
  if (top < 0 || rows < 1 || top + rows > height) {
    throw new RangeError(`rows ${top}–${top + rows} are not in a ${height}-row image`);
  }
  if (width * rows > MAX_RASTER_PIXELS) {
    throw new RangeError(`a band of ${width} × ${rows} pixels is too big to draw at once`);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(width, rows);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the image.');
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, width, rows);
    }
    ctx.drawImage(img, 0, -top, width, height);
    const data = ctx.getImageData(0, 0, width, rows).data;
    return { width, height: rows, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
