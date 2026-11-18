// The Image Adjust dialog's preview (IMAGEADJUST, M5-04 part 10; AutoCAD Help, "Image Adjust
// Dialog Box": "Displays a preview of the selected image. The preview image updates dynamically
// to reflect changes to the brightness, contrast, and fade settings"). The image is cut down to
// the preview's box by nearest pixels, then adjusted with the canvas's own arithmetic (render
// `adjustPixels`), so the preview shows what OK draws.
import type { ImageAdjustSettings } from '@triya/engine';
import { base64, encodePng } from '@triya/pdf';
import { adjustPixels, type RasterPixels } from '@triya/render';

/** AutoCAD's initial values, which Reset restores (DXF 281 / 282 / 283: 50, 50, 0). */
export const IMAGE_ADJUST_DEFAULTS: ImageAdjustSettings = { brightness: 50, contrast: 50, fade: 0 };

/** The image's size fitted in a `box` × `box` square, its shape kept, never enlarged. */
export function previewSize(
  width: number,
  height: number,
  box: number,
): { width: number; height: number } {
  const k = Math.min(1, box / width, box / height);
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}

/**
 * The preview's pixels, straight RGBA, over `background` (the drawing's, 0–255). A bitonal
 * image's foreground is the IMAGE's colour on the canvas; the preview has no colour of the
 * entity, so it draws the foreground black or white, whichever stands out on the background, as
 * ACI 7 does.
 */
export function previewPixels(
  src: RasterPixels,
  settings: ImageAdjustSettings,
  background: readonly [number, number, number],
  box: number,
): RasterPixels {
  const { width, height } = previewSize(src.width, src.height, box);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / width));
      const from = (sy * src.width + sx) * 4;
      data.set(src.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  const [r, g, b] = background;
  const light = 0.299 * r + 0.587 * g + 0.114 * b >= 128;
  const small: RasterPixels = { width, height, data, ...(src.bitonal && { bitonal: true }) };
  return {
    width,
    height,
    data: adjustPixels(small, {
      ...settings,
      transparent: false,
      color: light ? [0, 0, 0] : [255, 255, 255],
      background,
    }),
  };
}

/** `#rrggbb` as 0–255 channels; white for anything else. */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [255, 255, 255];
}

/** Pixels as a PNG data URL, which an `<img>` shows (no canvas outside the renderer). */
export function pngUrl(p: RasterPixels): string {
  return `data:image/png;base64,${base64(encodePng(p))}`;
}
