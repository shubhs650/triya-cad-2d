// M1-24: the golden-image comparison the fidelity harness runs (TESTING.md §4): pixelmatch at
// threshold 0.1 and SSIM, both within the file's manifest tolerance.
import { describe, expect, it } from 'vitest';
import {
  compareImages,
  decodePng,
  diffRegions,
  encodePng,
  goldenPath,
  spaceSlug,
  ssim,
  type Raster,
} from './compare.ts';

function raster(width: number, height: number, fill: (x: number, y: number) => number): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fill(x, y);
      const i = (y * width + x) * 4;
      data.set([v, v, v, 255], i);
    }
  }
  return { width, height, data };
}

/** A dark canvas with a few bright lines, like a drawing. */
const drawing = () =>
  raster(64, 48, (x, y) =>
    x === y || x === 40 || y === 10 || (x - 32) ** 2 + (y - 24) ** 2 < 30 ? 230 : 33,
  );

describe('ssim', () => {
  it('is 1 for identical images and lower the more they differ', () => {
    const a = drawing();
    expect(ssim(a, a)).toBe(1);
    const shifted = raster(64, 48, (x, y) => (x === y + 3 || x === 44 || y === 14 ? 230 : 33));
    const s = ssim(a, shifted);
    expect(s).toBeLessThan(0.9);
    expect(s).toBeGreaterThan(-1);
    const blank = raster(64, 48, () => 33);
    expect(ssim(a, blank)).toBeLessThan(0.9);
  });

  it('is symmetric', () => {
    const a = drawing();
    const b = raster(64, 48, (x, y) => (x === y ? 200 : 40));
    expect(ssim(a, b)).toBeCloseTo(ssim(b, a), 12);
  });
});

describe('compareImages', () => {
  const tol = { pixelMismatch: 0.5, ssim: 0.985 };

  it('passes identical images with no mismatch', () => {
    const r = compareImages(drawing(), drawing(), tol);
    expect(r).toMatchObject({ pass: true, mismatchPct: 0, ssim: 1 });
  });

  it('fails when a line moves, and reports where', () => {
    const moved = raster(64, 48, (x, y) =>
      x === y || x === 50 || y === 10 || (x - 32) ** 2 + (y - 24) ** 2 < 30 ? 230 : 33,
    );
    const r = compareImages(moved, drawing(), tol);
    expect(r.pass).toBe(false);
    expect(r.mismatchPct).toBeGreaterThan(0.5);
    expect(r.reason).toMatch(/mismatch/);
    // Both columns, 40 and 50, are in the reported regions.
    const xs = r.regions.flatMap((b) => [b.x, b.x + b.width]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(40);
    expect(Math.max(...xs)).toBeGreaterThan(50);
    // The diff image marks the changed pixels.
    const diff = decodePng(r.diffPng!);
    expect([diff.width, diff.height]).toEqual([64, 48]);
  });

  it('tolerates a mismatch inside the file tolerance', () => {
    const big = (dx: number) =>
      raster(400, 300, (x, y) => (x === y || y === 150 || x === 200 + dx ? 230 : 33));
    // One 300-pixel column moved by one pixel: 600 of 120 000 pixels, 0.5 %.
    const r = compareImages(big(1), big(0), { pixelMismatch: 2, ssim: 0.9 });
    expect(r.pass).toBe(true);
    expect(r.mismatchPct).toBeGreaterThan(0);
    expect(r.mismatchPct).toBeLessThanOrEqual(2);
  });

  it('fails on a size change without comparing pixels', () => {
    const r = compareImages(
      raster(10, 10, () => 0),
      raster(10, 12, () => 0),
      tol,
    );
    expect(r).toMatchObject({ pass: false, reason: 'size 10×10, golden 10×12' });
  });
});

describe('diffRegions', () => {
  it('merges neighbouring cells into one box', () => {
    const mask = new Uint8Array(100 * 100);
    for (let x = 10; x < 70; x++) mask[20 * 100 + x] = 1;
    mask[90 * 100 + 90] = 1;
    const boxes = diffRegions(mask, 100, 100, 16);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ x: 0, y: 16, width: 80, height: 16 });
    expect(boxes[1]).toEqual({ x: 80, y: 80, width: 16, height: 16 });
  });
});

describe('png', () => {
  it('round-trips through encode and decode', () => {
    const a = drawing();
    const b = decodePng(encodePng(a));
    expect(b.width).toBe(64);
    expect(Buffer.compare(Buffer.from(b.data), Buffer.from(a.data))).toBe(0);
  });
});

describe('golden paths', () => {
  it('puts each space of a corpus file in the file’s own folder under refs/golden', () => {
    expect(goldenPath('public/third-party/ezdxf/examples_dxf/a b.dxf', 'Model')).toBe(
      'public/refs/golden/ezdxf/examples_dxf/a b.dxf/model.png',
    );
    expect(goldenPath('public/x/y.dwg', 'Layout 1')).toBe(
      'public/refs/golden/x/y.dwg/layout-Layout_1.png',
    );
  });

  it('keeps distinct layout names distinct', () => {
    expect(spaceSlug('A/B')).not.toBe(spaceSlug('A_B'));
    expect(spaceSlug('Model')).toBe('model');
    expect(spaceSlug('ÜBERSICHT')).toMatch(/^layout-[\w.~-]+$/);
  });
});
