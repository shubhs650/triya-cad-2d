// M2-39 part 4: raster plots over 64 Mpx are drawn in bands of rows, up to 32,767 pixels a side.
import { describe, expect, it } from 'vitest';
import {
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE,
  RASTER_BAND_PIXELS,
  rasterBands,
  rasterSize,
  rasterTooBig,
} from '../../src/plot/raster';

describe('rasterBands', () => {
  it('draws a plot that fits as one band', () => {
    expect(rasterBands(8000, 8000)).toEqual([8000]);
    expect(MAX_RASTER_PIXELS).toBe(64_000_000);
  });

  it('cuts a bigger plot into bands of at most 16 million pixels covering every row', () => {
    const { width, height } = rasterSize({ width: 1189, height: 841 }, 300);
    expect([width, height]).toEqual([14043, 9933]);
    const bands = rasterBands(width, height);
    expect(bands.reduce((a, b) => a + b, 0)).toBe(height);
    expect(bands.every((r) => r * width <= RASTER_BAND_PIXELS)).toBe(true);
    expect(bands.slice(0, -1).every((r) => r === bands[0])).toBe(true);
    // The biggest plot: 68 bands of 488 rows (the last 71).
    const most = rasterBands(MAX_RASTER_SIDE, MAX_RASTER_SIDE);
    expect([most.length, most[0], most.at(-1)]).toEqual([68, 488, 71]);
  });
});

describe('rasterTooBig', () => {
  it('allows up to 32,767 pixels a side and says why beyond', () => {
    expect(rasterTooBig(MAX_RASTER_SIDE, MAX_RASTER_SIDE)).toBeUndefined();
    expect(rasterTooBig(MAX_RASTER_SIDE + 1, 10)).toMatch(
      /32768 × 10 pixels, more than 32,767 on a side/,
    );
  });
});
