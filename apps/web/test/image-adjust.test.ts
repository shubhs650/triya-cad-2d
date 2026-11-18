// The Image Adjust dialog's preview (M5-04 part 10): the image cut down to the preview's box and
// adjusted as the canvas adjusts it (render `adjustPixels`), so the preview shows what OK draws.
import type { RasterPixels } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { IMAGE_ADJUST_DEFAULTS, previewPixels, previewSize } from '../src/image-adjust';

/** A `w` × `h` image whose pixels are all `rgb`, opaque. */
function flat(w: number, h: number, rgb: [number, number, number], bitonal = false): RasterPixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width: w, height: h, data, ...(bitonal && { bitonal }) };
}

describe('previewSize', () => {
  it('fits the image in the box, keeping its shape, never enlarging it', () => {
    expect(previewSize(400, 200, 160)).toEqual({ width: 160, height: 80 });
    expect(previewSize(100, 400, 160)).toEqual({ width: 40, height: 160 });
    expect(previewSize(50, 20, 160)).toEqual({ width: 50, height: 20 });
    expect(previewSize(1000, 1, 160)).toEqual({ width: 160, height: 1 });
  });
});

describe('previewPixels', () => {
  const white: [number, number, number] = [255, 255, 255];

  it('shows the image unchanged at AutoCAD’s initial values (50, 50, 0)', () => {
    const p = previewPixels(flat(4, 2, [100, 150, 200]), IMAGE_ADJUST_DEFAULTS, white, 160);
    expect(p.width).toBe(4);
    expect(p.height).toBe(2);
    expect([...p.data.slice(0, 4)]).toEqual([100, 150, 200, 255]);
  });

  it('applies brightness, contrast and fade as the canvas does', () => {
    const src = flat(2, 2, [128, 128, 128]);
    const bright = previewPixels(src, { brightness: 100, contrast: 50, fade: 0 }, white, 160);
    expect(bright.data[0]).toBe(255);
    const dark = previewPixels(src, { brightness: 0, contrast: 50, fade: 0 }, white, 160);
    expect(dark.data[0]).toBe(0);
    // Fade 100 is the background alone.
    const faded = previewPixels(
      flat(2, 2, [0, 0, 0]),
      { ...IMAGE_ADJUST_DEFAULTS, fade: 100 },
      white,
      160,
    );
    expect([...faded.data.slice(0, 3)]).toEqual([255, 255, 255]);
  });

  it('cuts a large image down by nearest pixels', () => {
    const src = flat(800, 400, [10, 20, 30]);
    const p = previewPixels(src, IMAGE_ADJUST_DEFAULTS, white, 160);
    expect(p.width).toBe(160);
    expect(p.height).toBe(80);
    expect(p.data.length).toBe(160 * 80 * 4);
    expect([...p.data.slice(-4)]).toEqual([10, 20, 30, 255]);
  });

  it('draws a bitonal image’s foreground in the colour that stands out on the background', () => {
    const src = flat(2, 1, [0, 0, 0], true);
    expect([...previewPixels(src, IMAGE_ADJUST_DEFAULTS, white, 160).data.slice(0, 3)]).toEqual([
      0, 0, 0,
    ]);
    expect([
      ...previewPixels(src, IMAGE_ADJUST_DEFAULTS, [33, 40, 48], 160).data.slice(0, 3),
    ]).toEqual([255, 255, 255]);
  });
});
