// PDFUNDERLAY tessellation, what of the page the view needs, the request the app is sent, and
// the display settings applied to a drawn page (M1-20).
import type { UnderlayGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  adjustUnderlayPixels,
  mergeNeeds,
  rasterCovers,
  tessellate,
  underlayFrame,
  underlayNeed,
  underlayRequest,
  type Paint,
  type RasterPixels,
  type UnderlayFill,
  type UnderlayRaster,
} from '../src/index';

const PAINT: Paint = { color: '#ff0000' };

const underlay = (extra: Partial<UnderlayGeometry> = {}): UnderlayGeometry => ({
  kind: 'PDFUNDERLAY',
  definition: '9A',
  position: { x: 100, y: 50 },
  scale: { x: 2, y: 2, z: 2 },
  rotation: 0,
  flags: 2,
  contrast: 100,
  fade: 0,
  clip: [],
  ...extra,
});

function points(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length;) {
    if (path[i] === PATH_Z) {
      i += 1;
      continue;
    }
    expect([PATH_M, PATH_L]).toContain(path[i]);
    out.push(
      [path[i + 1]!, path[i + 2]!].map((v) => Math.round(v * 1e9) / 1e9 + 0) as [number, number],
    );
    i += 3;
  }
  return out;
}

const only = (g: UnderlayGeometry) => {
  const prims = tessellate(g, PAINT);
  expect(prims).toHaveLength(1);
  return prims[0]!;
};

describe('underlay tessellation', () => {
  it('maps the page through scale, rotation and the insertion point', () => {
    const f = underlayFrame(underlay({ rotation: Math.PI / 2 }));
    // Page (1, 0) → 2 units along +Y from the insertion point; page (0, 1) → 2 along −X.
    expect(f.a * 1 + f.e).toBeCloseTo(100);
    expect(f.b * 1 + f.f).toBeCloseTo(52);
    expect(f.c * 1 + f.e).toBeCloseTo(98);
    expect(f.d * 1 + f.f).toBeCloseTo(50);
  });

  it('reverses the Y axis of an underlay on a −Z plane', () => {
    const f = underlayFrame(underlay({ upsideDown: true, rotation: Math.PI }));
    // X axis at π, Y reversed: page (1, 1) → (−2, +2) from the insertion point.
    expect(f.a + f.c + f.e).toBeCloseTo(98);
    expect(f.b + f.d + f.f).toBeCloseTo(52);
  });

  it('draws an unclipped page as a fill with no path: the page size comes with its raster', () => {
    const p = only(underlay({ flags: 2 | 4 | 8, contrast: 60, fade: 30 }));
    expect(p).toMatchObject({ kind: 'fill', path: [], color: '#ff0000' });
    expect(p.kind === 'fill' && p.underlay).toEqual({
      definition: '9A',
      frame: { a: 2, b: 0, c: -0, d: 2, e: 100, f: 50 },
      clipped: false,
      contrast: 60,
      fade: 30,
      monochrome: true,
      adjustColors: true,
    });
  });

  it('clips to a two-vertex rectangle and to a polygon, scaled into the drawing', () => {
    const rect = only(
      underlay({
        flags: 3,
        clip: [
          { x: 1, y: 1 },
          { x: 3, y: 2 },
        ],
      }),
    );
    expect(points(rect.kind === 'fill' ? rect.path : [])).toEqual([
      [102, 52],
      [106, 52],
      [106, 54],
      [102, 54],
    ]);
    const poly = only(
      underlay({
        flags: 3,
        clip: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 3 },
          { x: 0, y: 0 },
        ],
      }),
    );
    // The repeated closing vertex is dropped; the path closes itself.
    expect(points(poly.kind === 'fill' ? poly.path : [])).toEqual([
      [100, 50],
      [108, 50],
      [104, 56],
    ]);
    expect(poly.kind === 'fill' && poly.underlay?.clipped).toBe(true);
  });

  it('ignores the boundary while clipping is off', () => {
    const p = only(
      underlay({
        flags: 2,
        clip: [
          { x: 1, y: 1 },
          { x: 3, y: 2 },
        ],
      }),
    );
    expect(p.kind === 'fill' && p.path).toEqual([]);
  });

  it('draws nothing for an underlay turned off, and only the boundary without a definition', () => {
    expect(
      tessellate(
        underlay({
          flags: 1,
          clip: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        }),
        PAINT,
      ),
    ).toEqual([]);
    const { definition: _, ...g } = underlay({
      flags: 3,
      clip: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    const prims = tessellate(g, { ...PAINT, lineweight: 0.5 });
    expect(prims).toEqual([
      expect.objectContaining({ kind: 'stroke', color: '#ff0000', lineweight: 0.5 }),
    ]);
    expect(tessellate({ ...g, flags: 2 }, PAINT)).toEqual([]);
  });
});

const fill = (g: UnderlayGeometry): { u: UnderlayFill; path: readonly number[] } => {
  const p = tessellate(g, PAINT)[0]!;
  if (p.kind !== 'fill' || !p.underlay) throw new Error('not an underlay fill');
  return { u: p.underlay, path: p.path };
};

describe('what the view needs of the page', () => {
  const page = { width: 8.5, height: 11 };

  it('is the visible part of the page at the screen’s pixels per page unit', () => {
    const { u, path } = fill(underlay());
    // World x 100…110 is page x 0…5; at 4 device px per world unit, 8 px per page unit.
    const need = underlayNeed(u, path, { minX: 90, minY: 40, maxX: 110, maxY: 60 }, 4, page);
    expect(need).toEqual({ scale: 8, region: { minX: 0, minY: 0, maxX: 5, maxY: 5 } });
  });

  it('is clamped to the page once its size is known, and nothing when off the page', () => {
    const { u, path } = fill(underlay());
    const big = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    expect(underlayNeed(u, path, big, 1, page)?.region).toEqual({
      minX: 0,
      minY: 0,
      maxX: 8.5,
      maxY: 11,
    });
    expect(
      underlayNeed(u, path, { minX: 0, minY: 0, maxX: 50, maxY: 40 }, 1, page),
    ).toBeUndefined();
    // Before the size is known the region is the view, unclamped; the app clamps it.
    expect(underlayNeed(u, path, { minX: 98, minY: 48, maxX: 102, maxY: 52 }, 1)?.region).toEqual({
      minX: -1,
      minY: -1,
      maxX: 1,
      maxY: 1,
    });
  });

  it('is limited to the clip boundary and bounds a rotated view', () => {
    const { u, path } = fill(
      underlay({
        flags: 3,
        clip: [
          { x: 1, y: 1 },
          { x: 2, y: 3 },
        ],
        rotation: Math.PI / 4,
      }),
    );
    const need = underlayNeed(u, path, { minX: -1e3, minY: -1e3, maxX: 1e3, maxY: 1e3 }, 1, page)!;
    // The clip's world box, rotated back, bounds the clip and a little around it.
    expect(need.region.minX).toBeLessThanOrEqual(1 + 1e-9);
    expect(need.region.maxY).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(need.region.maxX).toBeLessThan(3);
    expect(need.scale).toBeCloseTo(2);
  });

  it('merges two underlays of one page into the sharper scale and both regions', () => {
    const a = { scale: 4, region: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    const b = { scale: 8, region: { minX: 2, minY: -1, maxX: 3, maxY: 0.5 } };
    expect(mergeNeeds(a, b)).toEqual({ scale: 8, region: { minX: 0, minY: -1, maxX: 3, maxY: 1 } });
  });
});

describe('the request sent to the app', () => {
  it('steps the scale up by √2 and pads and snaps the region to a 64-pixel grid', () => {
    const r = underlayRequest('9A', { scale: 70, region: { minX: 1, minY: 1, maxX: 5, maxY: 3 } });
    // 70 → 2^6.5 = 90.5; the grid is 64 / 90.5 page units; padding a quarter each way.
    expect(r.definition).toBe('9A');
    expect(r.scale).toBeCloseTo(90.50967, 4);
    const g = 64 / r.scale;
    for (const v of Object.values(r.region))
      expect(Math.abs(v / g - Math.round(v / g))).toBeLessThan(1e-9);
    expect(r.region.minX).toBeLessThanOrEqual(0);
    expect(r.region.maxX).toBeGreaterThanOrEqual(6);
    expect(r.region.minY).toBeLessThanOrEqual(0.5);
    expect(r.region.maxY).toBeGreaterThanOrEqual(3.5);
  });

  it('is the same request for a small pan or zoom, so it is asked once', () => {
    const a = underlayRequest('9A', { scale: 70, region: { minX: 1, minY: 1, maxX: 5, maxY: 3 } });
    const b = underlayRequest('9A', {
      scale: 72,
      region: { minX: 1.05, minY: 1, maxX: 5.05, maxY: 3 },
    });
    expect(b).toEqual(a);
  });

  it('keeps the padded region on the page once its size is known', () => {
    const need = { scale: 64, region: { minX: 0, minY: 0, maxX: 8.5, maxY: 11 } };
    expect(underlayRequest('9A', need, { width: 8.5, height: 11 }).region).toEqual(need.region);
  });

  it('keeps an exact step', () => {
    expect(
      underlayRequest('9A', { scale: 64, region: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }).scale,
    ).toBeCloseTo(64);
  });
});

const raster = (region: UnderlayRaster['region'], width: number, height = 1): UnderlayRaster => ({
  page: { width: 8.5, height: 11 },
  region,
  pixels: { width, height, data: new Uint8ClampedArray(width * height * 4) },
});

describe('whether a raster shows what the view needs', () => {
  const need = { scale: 10, region: { minX: 1, minY: 1, maxX: 2, maxY: 2 } };

  it('does when it covers the region at the scale or finer', () => {
    expect(rasterCovers(raster({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, 40), need)).toBe(true);
    expect(rasterCovers(raster({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, 80), need)).toBe(true);
  });

  it('does not when coarser, or when the region reaches past it', () => {
    expect(rasterCovers(raster({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, 39), need)).toBe(false);
    expect(rasterCovers(raster({ minX: 1.5, minY: 0, maxX: 4, maxY: 4 }, 40), need)).toBe(false);
    expect(rasterCovers(raster({ minX: 0, minY: 0, maxX: 0, maxY: 4 }, 40), need)).toBe(false);
  });
});

describe('page display settings', () => {
  const px = (...rgba: number[]): RasterPixels => ({
    width: rgba.length / 4,
    height: 1,
    data: new Uint8ClampedArray(rgba),
  });
  const LIGHT = [255, 255, 255] as const;
  const DARK = [0, 0, 0] as const;
  const plain = {
    contrast: 100,
    fade: 0,
    monochrome: false,
    adjustColors: false,
    background: LIGHT,
  };

  it('keeps the page as drawn at contrast 100 and fade 0, the clear paper included', () => {
    const src = px(0, 0, 0, 255, 200, 30, 40, 255, 0, 0, 0, 0);
    expect([...adjustUnderlayPixels(src, plain)]).toEqual([...src.data]);
  });

  it('greys a monochrome page and pulls a low contrast toward mid grey', () => {
    expect([...adjustUnderlayPixels(px(255, 0, 0, 255), { ...plain, monochrome: true })]).toEqual([
      76, 76, 76, 255,
    ]);
    expect([
      ...adjustUnderlayPixels(px(0, 0, 0, 255, 255, 255, 255, 255), { ...plain, contrast: 50 }),
    ]).toEqual([64, 64, 64, 255, 192, 192, 192, 255]);
  });

  it('turns lightness over on a dark background only, keeping hue', () => {
    const dark = { ...plain, adjustColors: true, background: DARK };
    // Black linework → white; pure red keeps its lightness (½) and so stays red; dark blue → light blue.
    expect([
      ...adjustUnderlayPixels(px(0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 100, 255), dark),
    ]).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 155, 155, 255, 255]);
    expect([...adjustUnderlayPixels(px(0, 0, 0, 255), { ...dark, background: LIGHT })]).toEqual([
      0, 0, 0, 255,
    ]);
  });

  it('fades by letting the background through', () => {
    expect([
      ...adjustUnderlayPixels(px(0, 0, 0, 255, 0, 0, 0, 100), { ...plain, fade: 40 }),
    ]).toEqual([0, 0, 0, 153, 0, 0, 0, 60]);
  });
});
