// A plot as a raster (M2-18, ARCHITECTURE.md §12's `PngSink`, PRD FR-F7): the SVG plot
// (`@triya/pdf` `plotSvg`, which this package cannot import, so the app hands its text over)
// drawn by the browser onto a canvas the size the resolution asks for, then read back as
// straight RGBA for the PNG encoder. One picture of the plot, the SVG's, so a PNG shows what the
// SVG and PDF plots show. Main thread only (`Image` decodes the SVG).

import type { RasterPixels } from '../types';

/** The most pixels a raster plot may have (A1 at about 250 dpi); more would not fit in memory. */
export const MAX_RASTER_PIXELS = 64_000_000;

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
}

/** An SVG document drawn at `width` × `height` pixels; throws a message for the user. */
export async function rasterizeSvg(svg: string, o: RasterizeOptions): Promise<RasterPixels> {
  const { width, height } = o;
  if (width * height > MAX_RASTER_PIXELS) {
    throw new RangeError(
      `The image would be ${width} × ${height} pixels, more than ${MAX_RASTER_PIXELS / 1e6} million: choose a lower resolution or a smaller paper.`,
    );
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the image.');
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
