// Canvas2DRenderer with raster images (M1-19): the app's decoded bitmap, adjusted once per
// setting into a layer of its own, drawn through world ∘ the image's frame and clipped to its
// boundary; an image without a bitmap outlined; IMAGEFRAME from RASTERVARIABLES; a WIPEOUT
// masking in the background colour; an image inside a block reference.
import type {
  EntityGeometry,
  ImageDefinition,
  ImageGeometry,
  NonGraphicalObject,
  RasterVariables,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { FontBook } from '@triya/text';
import { Canvas2DRenderer, type RasterPixels, type RenderStyle } from '../src/index';
import {
  change,
  drawing,
  entity,
  MODEL,
  surface,
  type Call,
  type DrawingExtra,
  type FakeContext,
} from './fixtures';
import { romans } from './text-fonts';

const DARK: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };

const image = (extra: Partial<ImageGeometry> = {}): ImageGeometry => ({
  kind: 'IMAGE',
  definition: '7F',
  position: { x: 10, y: 20 },
  u: { x: 0.5, y: 0 },
  v: { x: 0, y: 0.5 },
  size: { x: 8, y: 4 },
  displayFlags: 7,
  clipping: false,
  brightness: 50,
  contrast: 50,
  fade: 0,
  clip: { type: 'rectangle', vertices: [], inverted: false },
  ...extra,
});

/** An opaque bitmap of mid grey, 8 × 4 unless stated. */
const grey = (w = 8, h = 4): RasterPixels => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : 128)),
});

const rasterVars = (frame: boolean): RasterVariables => ({
  handle: '82',
  type: 'RASTERVARIABLES',
  owner: '0C',
  frame,
  quality: 'high',
  units: 0,
});

function setup(
  geoms: { handle: string; geom: EntityGeometry; owner?: string }[],
  o: { pixels?: Record<string, RasterPixels>; extra?: DrawingExtra; fonts?: FontBook } = {},
) {
  const d = drawing(
    geoms.map((g) => entity(g.handle, g.geom, g.owner ? { owner: g.owner } : {})),
    o.extra,
  );
  const layers: (ReturnType<typeof surface> & { name: string })[] = [];
  const asked: string[] = [];
  const r = new Canvas2DRenderer({
    model: d.model,
    index: d.index,
    block: MODEL,
    surface: surface('visible'),
    createLayer: () => {
      const name = ['scene', 'transient'][layers.length] ?? `bitmap${layers.length - 2}`;
      const s = { ...surface(name), name };
      layers.push(s);
      return s;
    },
    style: DARK,
    requestIdle: () => {},
    ...(o.fonts ? { fonts: o.fonts } : {}),
    images: (h) => {
      asked.push(h);
      return o.pixels?.[h];
    },
  });
  r.resize(200, 100, 1);
  // World (12, 21) at the centre, 10 px per unit: x' = 10 (x − 12) + 100, y' = 50 − 10 (y − 21).
  r.setView({ center: { x: 12, y: 21 }, scale: 10 });
  const scene = layers[0]!.ctx;
  const redraw = (): FakeContext => {
    scene.clear();
    r.setView({ center: { x: 12, y: 21 }, scale: 10 });
    r.frame();
    return scene;
  };
  return { d, r, layers, asked, redraw };
}

/** The transform in force at the n-th call named `name`. */
function transformAt(c: FakeContext, name: string, n = 0): Call | undefined {
  const at = c.calls.map((k, i) => (k[0] === name ? i : -1)).filter((i) => i >= 0)[n]!;
  // −0 from a zero product reads as 0.
  return c.calls
    .slice(0, at)
    .filter((k) => k[0] === 'setTransform')
    .at(-1)
    ?.map((v) => (v === 0 ? 0 : v)) as Call | undefined;
}

describe('images', () => {
  it('draws the bitmap through world ∘ frame inside a clip of its boundary', () => {
    const { redraw } = setup([{ handle: '20', geom: image() }], { pixels: { '7F': grey() } });
    const c = redraw();
    const draws = c.named('drawImage');
    expect(draws).toEqual([['drawImage', 'bitmap0', 0, 0]]);
    // Bitmap (0, 0) is world (10, 22): device (80, 40); one pixel is 5 px each way.
    expect(transformAt(c, 'drawImage')).toEqual(['setTransform', 5, 0, 0, 5, 80, 40]);
    const kinds = c.calls.map((k) => k[0]);
    const i = kinds.indexOf('drawImage');
    expect(kinds.lastIndexOf('save', i)).toBeLessThan(kinds.lastIndexOf('clip', i));
    expect(c.calls[kinds.lastIndexOf('clip', i)]).toEqual(['clip', 'nonzero']);
    expect(kinds.indexOf('restore', i)).toBeGreaterThan(i);
    // The clip runs along the image's outline, in world units about the view centre.
    const clipPath = c.calls.slice(kinds.lastIndexOf('beginPath', i), i);
    expect(clipPath.filter((k) => k[0] === 'moveTo' || k[0] === 'lineTo')).toEqual([
      ['moveTo', -2, -1],
      ['lineTo', 2, -1],
      ['lineTo', 2, 1],
      ['lineTo', -2, 1],
    ]);
  });

  it('adjusts a bitmap once per setting, not every frame', () => {
    const { redraw, layers } = setup([{ handle: '20', geom: image({ brightness: 60 }) }], {
      pixels: { '7F': grey(1, 1) },
    });
    redraw();
    redraw();
    const bitmap = layers.find((l) => l.name === 'bitmap0')!;
    expect(bitmap.canvas).toEqual({ width: 1, height: 1 });
    const puts = bitmap.ctx.named('putImageData');
    expect(puts).toEqual([['putImageData', [179, 179, 179, 255], 0, 0]]);
    expect(layers).toHaveLength(3);
  });

  it('stretches a bitmap of another size over the image’s pixel grid', () => {
    const { redraw } = setup([{ handle: '20', geom: image() }], { pixels: { '7F': grey(16, 2) } });
    expect(transformAt(redraw(), 'drawImage')).toEqual(['setTransform', 2.5, 0, 0, 10, 80, 40]);
  });

  it('outlines an image the app has no bitmap for, and asks again next frame', () => {
    const { redraw, asked } = setup([{ handle: '20', geom: image() }], {
      extra: { objects: [rasterVars(false)] },
    });
    const c = redraw();
    expect(c.named('drawImage')).toEqual([]);
    expect(c.named('stroke')).toEqual([['stroke', '#ffffff', 1]]);
    redraw();
    expect(asked).toEqual(['7F', '7F']);
  });

  it('follows IMAGEFRAME, and reframes when RASTERVARIABLES changes', () => {
    const pixels = { '7F': grey() };
    const off = setup([{ handle: '20', geom: image() }], {
      pixels,
      extra: { objects: [rasterVars(false)] },
    });
    expect(off.redraw().named('stroke')).toEqual([]);
    off.r.apply(change(off.d, (b) => b.updateObject('82', { frame: true } as never)));
    expect(off.redraw().named('stroke')).toHaveLength(1);
    // Without a RASTERVARIABLES object the frame shows (AutoCAD's initial IMAGEFRAME 1).
    expect(
      setup([{ handle: '20', geom: image() }], { pixels })
        .redraw()
        .named('stroke'),
    ).toHaveLength(1);
  });

  it('smooths scaled bitmaps at IMAGEQUALITY high and shows their pixels at draft', () => {
    const smoothing = (quality: 'draft' | 'high') => {
      const vars: RasterVariables = { ...rasterVars(true), quality };
      const c = setup([{ handle: '20', geom: image() }], {
        pixels: { '7F': grey() },
        extra: { objects: [vars] },
      }).redraw();
      return c.named('imageSmoothingEnabled');
    };
    expect(smoothing('high')).toEqual([['imageSmoothingEnabled', true]]);
    expect(smoothing('draft')).toEqual([['imageSmoothingEnabled', false]]);
  });

  it('keeps the outside of an inverted clip with the even-odd rule', () => {
    const g = image({
      clipping: true,
      clip: {
        type: 'polygon',
        vertices: [
          { x: 1.5, y: 0.5 },
          { x: 5.5, y: 0.5 },
          { x: 3.5, y: 2.5 },
        ],
        inverted: true,
      },
    });
    const c = setup([{ handle: '20', geom: g }], { pixels: { '7F': grey() } }).redraw();
    expect(c.named('clip')).toEqual([['clip', 'evenodd']]);
  });

  it('draws an image inside a block reference through the insert’s transform', () => {
    const BLOCK = '50';
    const insert: EntityGeometry = {
      kind: 'INSERT',
      block: BLOCK,
      position: { x: 2, y: 17 },
      scale: { x: 2, y: 2, z: 1 },
      rotation: 0,
      attributes: [],
    } as unknown as EntityGeometry;
    const { redraw } = setup(
      [
        { handle: '30', geom: image({ position: { x: 0, y: 0 } }), owner: BLOCK },
        { handle: '20', geom: insert },
      ],
      {
        pixels: { '7F': grey() },
        extra: { blocks: [{ handle: BLOCK, name: 'PHOTO' }] },
      },
    );
    // Block (0, 2) (the image's top-left corner) lands on world (2, 21): device (0, 50).
    expect(transformAt(redraw(), 'drawImage')).toEqual(['setTransform', 10, 0, 0, 10, 0, 50]);
  });

  it('masks a wipeout in the background colour', () => {
    const wipeout: ImageGeometry = {
      ...image({ size: { x: 1, y: 1 }, u: { x: 4, y: 0 }, v: { x: 0, y: 2 } }),
      kind: 'WIPEOUT',
      clipping: true,
      clip: {
        type: 'polygon',
        vertices: [
          { x: -0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: -0.5 },
          { x: -0.5, y: -0.5 },
          { x: -0.5, y: 0.5 },
        ],
        inverted: false,
      },
    };
    const objects: NonGraphicalObject[] = [
      { handle: '83', type: 'WIPEOUTVARIABLES', owner: '0C', frame: 0 } as NonGraphicalObject,
    ];
    const c = setup([{ handle: '20', geom: wipeout }], { extra: { objects } }).redraw();
    expect(c.named('fill')).toEqual([['fill', '#000000', 'nonzero', 1]]);
    expect(c.named('stroke')).toEqual([]);
    expect(c.named('drawImage')).toEqual([]);
  });

  it('draws a wipeout’s frame on screen with WIPEOUTFRAME 2, which only the plot leaves out', () => {
    const wipeout: ImageGeometry = {
      ...image({ size: { x: 1, y: 1 }, u: { x: 4, y: 0 }, v: { x: 0, y: 2 } }),
      kind: 'WIPEOUT',
      clipping: true,
      clip: {
        type: 'polygon',
        vertices: [
          { x: -0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: -0.5 },
          { x: -0.5, y: -0.5 },
          { x: -0.5, y: 0.5 },
        ],
        inverted: false,
      },
    };
    const objects: NonGraphicalObject[] = [
      { handle: '83', type: 'WIPEOUTVARIABLES', owner: '0C', frame: 2 } as NonGraphicalObject,
    ];
    const c = setup([{ handle: '20', geom: wipeout }], { extra: { objects } }).redraw();
    expect(c.named('fill')).toEqual([['fill', '#000000', 'nonzero', 1]]);
    expect(c.named('stroke')).toHaveLength(1);
  });
});

// M1-109: an image the app has no bitmap for shows its file name inside its frame, decided each
// frame as bitmaps arrive after tessellation; an unloaded definition shows its frame only.
describe('missing image name', () => {
  const fonts = () => {
    const book = new FontBook();
    book.addShx('oet-simplex.shx', romans());
    return book;
  };
  const def = (loaded: boolean): ImageDefinition => ({
    handle: '7F',
    type: 'IMAGEDEF',
    owner: '80',
    name: 'AB',
    fileName: '.\\images\\AB',
    size: { x: 8, y: 4 },
    pixelSize: { x: 1, y: 1 },
    loaded,
    units: 0,
  });

  // The name's glyphs batch with the frame (one colour and width), so they show as paths: the
  // missing image's outline and its frame are one move each, `A` (a square) and `B` (an arc)
  // one each.
  const moves = (c: FakeContext) => c.named('moveTo').length;

  it('draws the name while the bitmap is missing, and stops once it arrives', () => {
    const pixels: Record<string, RasterPixels> = {};
    const { redraw } = setup([{ handle: '20', geom: image() }], {
      pixels,
      fonts: fonts(),
      extra: { objects: [def(true)] },
    });
    expect(moves(redraw())).toBe(4);
    pixels['7F'] = grey();
    const c = redraw();
    expect(c.named('drawImage')).toHaveLength(1);
    // The bitmap's clip path and the frame.
    expect(moves(c)).toBe(2);
  });

  it('shows no name for an unloaded definition, and one once it is loaded', () => {
    const { d, r, redraw } = setup([{ handle: '20', geom: image() }], {
      fonts: fonts(),
      extra: { objects: [def(false)] },
    });
    expect(moves(redraw())).toBe(2);
    r.apply(change(d, (b) => b.updateObject('7F', { loaded: true } as never)));
    expect(moves(redraw())).toBe(4);
  });
});
