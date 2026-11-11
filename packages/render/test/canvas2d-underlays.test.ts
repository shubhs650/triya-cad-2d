// Canvas2DRenderer with PDF underlays (M1-20): the page raster the app drew, adjusted once per
// setting into a layer of its own, drawn through world ∘ frame ∘ the raster's region and
// clipped to the boundary or the page; the boundary or page outlined; and the requests for the
// page the view needs, sent once per distinct request after a scene is drawn.
import type { EntityGeometry, UnderlayGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  underlayKey,
  type RenderStyle,
  type UnderlayRaster,
  type UnderlayRequest,
} from '../src/index';
import { drawing, entity, MODEL, surface, type Call, type FakeContext } from './fixtures';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };

const underlay = (extra: Partial<UnderlayGeometry> = {}): UnderlayGeometry => ({
  kind: 'PDFUNDERLAY',
  definition: '9A',
  position: { x: 10, y: 20 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  flags: 2,
  contrast: 100,
  fade: 0,
  clip: [],
  ...extra,
});

/** A page 8 × 4 units drawn whole at 2 pixels per unit, opaque mid grey. */
const PAGE: UnderlayRaster = {
  page: { width: 8, height: 4 },
  region: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
  pixels: {
    width: 16,
    height: 8,
    data: new Uint8ClampedArray(16 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : 128)),
  },
};

function setup(
  geoms: { handle: string; geom: EntityGeometry }[],
  rasters: Record<string, UnderlayRaster> = {},
) {
  const d = drawing(geoms.map((g) => entity(g.handle, g.geom)));
  const layers: (ReturnType<typeof surface> & { name: string })[] = [];
  const asked: UnderlayRequest[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const name = ['scene', 'transient'][layers.length] ?? `page${layers.length - 2}`;
      const s = { ...surface(name), name };
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
    underlays: (h) => rasters[h],
    onUnderlayRequest: (q) => asked.push(q),
  });
  r.resize(200, 100, 1);
  const scene = layers[0]!.ctx;
  // World (12, 21) at the centre, 10 px per unit: x' = 10 (x − 12) + 100, y' = 50 − 10 (y − 21).
  const redraw = (scale = 10): FakeContext => {
    scene.clear();
    r.setView({ center: { x: 12, y: 21 }, scale });
    r.invalidate();
    r.frame();
    return scene;
  };
  return { r, layers, asked, redraw, rasters };
}

function transformAt(c: FakeContext, name: string, n = 0): Call | undefined {
  const at = c.calls.map((k, i) => (k[0] === name ? i : -1)).filter((i) => i >= 0)[n]!;
  return c.calls
    .slice(0, at)
    .filter((k) => k[0] === 'setTransform')
    .at(-1)
    ?.map((v) => (v === 0 ? 0 : v)) as Call | undefined;
}

describe('underlays', () => {
  it('draws the page raster through world ∘ frame ∘ region inside a clip of the page', () => {
    const { redraw } = setup([{ handle: '20', geom: underlay() }], { '9A': PAGE });
    const c = redraw();
    expect(c.named('drawImage')).toEqual([['drawImage', 'page0', 0, 0]]);
    // Raster (0, 0) is page (0, 4) = world (10, 24): device (80, 20); a pixel is ½ unit = 5 px.
    expect(transformAt(c, 'drawImage')).toEqual(['setTransform', 5, 0, 0, 5, 80, 20]);
    const kinds = c.calls.map((k) => k[0]);
    const i = kinds.indexOf('drawImage');
    expect(kinds.lastIndexOf('clip', i)).toBeGreaterThan(kinds.lastIndexOf('save', i));
    expect(kinds.indexOf('restore', i)).toBeGreaterThan(i);
    // The page is outlined after it is drawn.
    expect(kinds.indexOf('stroke', i)).toBeGreaterThan(i);
  });

  it('places a raster of part of the page by its region', () => {
    const part: UnderlayRaster = {
      ...PAGE,
      region: { minX: 2, minY: 1, maxX: 6, maxY: 3 },
      pixels: { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4) },
    };
    const c = setup([{ handle: '20', geom: underlay() }], { '9A': part }).redraw();
    // Raster (0, 0) is page (2, 3) = world (12, 23): device (100, 30).
    expect(transformAt(c, 'drawImage')).toEqual(['setTransform', 5, 0, 0, 5, 100, 30]);
  });

  it('adjusts a page once per setting and background', () => {
    const { redraw, layers } = setup(
      [
        { handle: '20', geom: underlay({ fade: 50 }) },
        { handle: '21', geom: underlay({ fade: 50, position: { x: 0, y: 0 } }) },
      ],
      { '9A': PAGE },
    );
    redraw();
    redraw();
    const pages = layers.filter((l) => l.name.startsWith('page'));
    expect(pages).toHaveLength(1);
    const put = pages[0]!.ctx.named('putImageData')[0]![1] as number[];
    expect(put.slice(0, 4)).toEqual([128, 128, 128, 128]);
  });

  it('outlines the clip boundary while the page is not drawn yet, and asks for it', () => {
    const { redraw, asked } = setup([
      {
        handle: '20',
        geom: underlay({
          flags: 3,
          clip: [
            { x: 0, y: 0 },
            { x: 4, y: 2 },
          ],
        }),
      },
    ]);
    const c = redraw();
    expect(c.named('drawImage')).toEqual([]);
    expect(c.named('stroke')).toHaveLength(1);
    expect(asked).toHaveLength(1);
    // 10 px per unit → scale 10 stepped to 2^3.5; the region bounds the clip, padded.
    expect(asked[0]!.definition).toBe('9A');
    expect(asked[0]!.scale).toBeCloseTo(11.3137, 3);
    expect(asked[0]!.region.minX).toBeLessThanOrEqual(0);
    expect(asked[0]!.region.maxX).toBeGreaterThanOrEqual(4);
  });

  it('draws nothing for an unclipped page it has no raster for, but asks for the view', () => {
    const { redraw, asked } = setup([{ handle: '20', geom: underlay() }]);
    const c = redraw();
    expect(c.named('stroke')).toEqual([]);
    expect(c.named('drawImage')).toEqual([]);
    // The view is world (2…22, 16…26): page (−8…12, −4…6) before the page size is known.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.region.minX).toBeLessThanOrEqual(-8);
    expect(asked[0]!.region.maxY).toBeGreaterThanOrEqual(6);
  });

  it('asks once per distinct request, nothing while the raster covers, again after a zoom', () => {
    const { redraw, asked, rasters } = setup([{ handle: '20', geom: underlay() }]);
    redraw();
    redraw();
    expect(asked).toHaveLength(1);
    // A raster of the whole page at 16 px per unit covers the view at 10 px per world unit.
    rasters['9A'] = {
      ...PAGE,
      pixels: { width: 128, height: 64, data: new Uint8ClampedArray(128 * 64 * 4) },
    };
    redraw();
    expect(asked).toHaveLength(1);
    // Zoomed in to 40 px per unit, it no longer does.
    redraw(40);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.scale).toBeCloseTo(45.2548, 3);
    // Clamped to the page now its size is known.
    expect(asked[1]!.region.minX).toBeGreaterThanOrEqual(-1);
    expect(asked[1]!.region.maxX).toBeLessThanOrEqual(9);
  });

  it('asks for one page once when two underlays show it', () => {
    const { redraw, asked } = setup([
      { handle: '20', geom: underlay() },
      { handle: '21', geom: underlay({ position: { x: 0, y: 0 }, scale: { x: 4, y: 4, z: 1 } }) },
    ]);
    redraw();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.scale).toBeCloseTo(45.2548, 3);
  });

  it('asks for a page with layers turned off apart from the plain page, and draws each its own raster (M2-38)', () => {
    // Two underlays of one page, the second turning PDF layers off (ULAYERS): each needs a
    // raster of its own, keyed by the definition and the layers off, sorted.
    const { redraw, asked, rasters } = setup([
      { handle: '20', geom: underlay() },
      { handle: '21', geom: underlay({ layersOff: ['Walls', 'Notes'] }) },
    ]);
    redraw();
    expect(asked.map((q) => [q.definition, q.layersOff])).toEqual([
      ['9A', undefined],
      ['9A', ['Notes', 'Walls']],
    ]);
    expect(underlayKey('9A', ['Notes', 'Walls'])).toBe('9A\nNotes\nWalls');
    expect(underlayKey('9A', [])).toBe('9A');
    rasters['9A'] = PAGE;
    const c = redraw();
    expect(c.named('drawImage')).toHaveLength(1);
    rasters[underlayKey('9A', ['Notes', 'Walls'])] = { ...PAGE, pixels: { ...PAGE.pixels } };
    expect(redraw().named('drawImage')).toHaveLength(2);
  });
});
