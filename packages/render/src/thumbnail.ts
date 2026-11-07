// Thumbnails of what a canvas shows (M1-22 part 5): the document tab hover preview pictures
// each space as last drawn. The visible surface keeps its last frame while its tab is hidden,
// so a thumbnail is a scaled copy of it, taken where the canvas lives (the render worker, or
// the main thread on the fallback path) and handed over as an ImageBitmap.

import type { Surface } from './canvas2d';

/** `createImageBitmap`, injectable so the worker protocol can be tested in Node. */
export type BitmapFactory = (
  source: CanvasImageSource,
  options: ImageBitmapOptions,
) => Promise<ImageBitmap>;

export interface ThumbnailSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The size of a `canvas`-shaped picture fitted inside `max`, aspect kept, never enlarged and
 * at least one pixel each way; undefined for a canvas that has never been sized.
 */
export function thumbnailSize(
  canvas: ThumbnailSize,
  max: ThumbnailSize,
): ThumbnailSize | undefined {
  if (canvas.width <= 0 || canvas.height <= 0 || max.width <= 0 || max.height <= 0) {
    return undefined;
  }
  const scale = Math.min(max.width / canvas.width, max.height / canvas.height, 1);
  return {
    width: Math.max(1, Math.round(canvas.width * scale)),
    height: Math.max(1, Math.round(canvas.height * scale)),
  };
}

/**
 * A copy of the surface's last frame fitted inside `max`. The copy is taken when this is
 * called (createImageBitmap snapshots a canvas synchronously), so later frames don't reach it.
 */
export function thumbnailOf(
  surface: Surface,
  max: ThumbnailSize,
  createBitmap: BitmapFactory | undefined = globalThis.createImageBitmap?.bind(globalThis),
): Promise<ImageBitmap | undefined> {
  const size = thumbnailSize(surface.canvas, max);
  if (!size || !createBitmap) return Promise.resolve(undefined);
  return createBitmap(surface.image, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'medium',
  });
}
