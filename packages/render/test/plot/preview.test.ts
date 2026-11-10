// M2-18 part 2: the plot preview's view of the paper. Zoom Original shows the whole sheet with a
// margin, its corner on a whole device pixel; zooming keeps the paper point under the cursor
// still; the part of the paper on screen is drawn as whole device pixels with the paper
// millimetres those pixels cover, so the plot is rasterised for exactly the pixels it fills.
import { describe, expect, it } from 'vitest';
import {
  fitPreview,
  panPreview,
  previewRegion,
  windowPreview,
  zoomPreview,
  PREVIEW_MAX_SCALE,
} from '../../src/plot/preview';

const A4 = { width: 297, height: 210 };

describe('the plot preview view', () => {
  it('fits the whole sheet with a margin, centred, its corner on a device pixel', () => {
    const v = fitPreview(A4, { width: 1000, height: 600 }, 1.5);
    // Height decides: (600 − 2 × 24) / 210.
    expect(v.scale).toBeCloseTo(552 / 210, 12);
    expect(v.y * 1.5).toBe(Math.round(v.y * 1.5));
    expect(v.x * 1.5).toBe(Math.round(v.x * 1.5));
    expect(v.x + (A4.width * v.scale) / 2).toBeCloseTo(500, 0);
    expect(v.y + (A4.height * v.scale) / 2).toBeCloseTo(300, 0);
  });

  it('zooms about the cursor, within its limits', () => {
    const v = fitPreview(A4, { width: 1000, height: 600 }, 1);
    const at = { x: 400, y: 250 };
    const paperAt = { x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale };
    const z = zoomPreview(v, 2, at);
    expect(z.scale).toBeCloseTo(v.scale * 2, 12);
    expect((at.x - z.x) / z.scale).toBeCloseTo(paperAt.x, 9);
    expect((at.y - z.y) / z.scale).toBeCloseTo(paperAt.y, 9);
    expect(zoomPreview(v, 1e9, at).scale).toBe(PREVIEW_MAX_SCALE);
    expect(zoomPreview(v, 1e-9, at).scale).toBeGreaterThan(0);
  });

  it('pans by CSS pixels and zooms to a window', () => {
    const v = fitPreview(A4, { width: 1000, height: 600 }, 1);
    expect(panPreview(v, 10, -5)).toEqual({ ...v, x: v.x + 10, y: v.y - 5 });
    // The window's paper millimetres fill the canvas, centred.
    const w = windowPreview(
      v,
      { x: v.x, y: v.y },
      { x: v.x + 100, y: v.y + 30 },
      {
        width: 1000,
        height: 600,
      },
    );
    expect(w.scale).toBeCloseTo((v.scale * 1000) / 100, 9);
    expect(w.x).toBeCloseTo(0, 9);
    // A window too small to mean anything leaves the view.
    expect(windowPreview(v, { x: 5, y: 5 }, { x: 6, y: 5 }, { width: 1000, height: 600 })).toBe(v);
  });

  it('rasterises only the paper on screen, as whole device pixels', () => {
    const viewport = { width: 1000, height: 600 };
    const v = fitPreview(A4, viewport, 2);
    const r = previewRegion(v, A4, viewport, 2)!;
    // The whole sheet is on screen: its pixels, and the millimetres those pixels cover.
    expect(Number.isInteger(r.px.x) && Number.isInteger(r.px.width)).toBe(true);
    expect(r.px.x).toBe(v.x * 2);
    expect(r.px.width).toBe(Math.ceil((v.x + A4.width * v.scale) * 2) - r.px.x);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.width).toBeCloseTo(r.px.width / 2 / v.scale, 9);
    expect(r.height).toBeCloseTo(r.px.height / 2 / v.scale, 9);

    // Zoomed in: only the canvas's pixels.
    const z = zoomPreview(v, 8, { x: 500, y: 300 });
    const rz = previewRegion(z, A4, viewport, 2)!;
    expect(rz.px).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
    expect(rz.x).toBeCloseTo((0 - z.x) / z.scale, 9);
    expect(rz.width).toBeCloseTo(1000 / z.scale, 9);

    // Panned off the paper: nothing to draw.
    expect(previewRegion(panPreview(v, 5000, 0), A4, viewport, 2)).toBeUndefined();
  });
});
