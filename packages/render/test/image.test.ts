// IMAGE and WIPEOUT tessellation and image pixel adjustment (M1-19).
//
// Clip vertices are pixel coordinates centred on pixels with V counted down from the image's
// top edge, so a vertex (x, y) sits at position + u (x + ½) + v (h − y − ½). The public corpus
// pins the direction: wipeout_door.dxf's door-opening wipeouts state y from 0.5 to 0.376 of a
// 1 × 1 image and only this reading puts them in the wall, from the insertion point up.
import type { ImageDefinition, ImageGeometry } from '@triya/engine';
import { FontBook } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  adjustPixels,
  imageLabel,
  tessellate,
  type TessellateContext,
  type Paint,
  type RasterPixels,
  type RenderPrimitive,
} from '../src/index';
import { romans } from './text-fonts';

const PAINT: Paint = { color: '#ff0000' };

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
  clip: {
    type: 'rectangle',
    vertices: [
      { x: -0.5, y: -0.5 },
      { x: 7.5, y: 3.5 },
    ],
    inverted: false,
  },
  ...extra,
});

/** The packed path's points, in order. */
function points(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length;) {
    if (path[i] === PATH_Z) {
      i += 1;
      continue;
    }
    expect([PATH_M, PATH_L]).toContain(path[i]);
    out.push([path[i + 1]!, path[i + 2]!]);
    i += 3;
  }
  return out;
}

type Fill = Extract<RenderPrimitive, { readonly path: readonly number[] }>;
const fillOf = (prims: RenderPrimitive[]) => prims.find((p): p is Fill => p.kind === 'fill');
const strokeOf = (prims: RenderPrimitive[]) => prims.find((p): p is Fill => p.kind === 'stroke');
const apply = (f: NonNullable<Fill['image']>['frame'], x: number, y: number) => [
  f.a * x + f.c * y + f.e,
  f.b * x + f.d * y + f.f,
];

describe('IMAGE', () => {
  it('fills its whole area with the bitmap, top row at the top', () => {
    const prims = tessellate(image(), PAINT);
    const fill = fillOf(prims)!;
    expect(points(fill.path)).toEqual([
      [10, 20],
      [14, 20],
      [14, 22],
      [10, 22],
    ]);
    expect(fill.color).toBe('#ff0000');
    const im = fill.image!;
    expect(im).toMatchObject({
      definition: '7F',
      brightness: 50,
      contrast: 50,
      fade: 0,
      transparent: false,
    });
    // Bitmap (0, 0) is the top-left corner, (8, 4) the bottom-right one.
    expect(apply(im.frame, 0, 0)).toEqual([10, 22]);
    expect(apply(im.frame, 8, 4)).toEqual([14, 20]);
    expect(apply(im.frame, 8, 0)).toEqual([14, 22]);
  });

  it('follows rotated and mirrored pixel vectors', () => {
    // U up and V to the left: the image turned 90° CCW.
    const fill = fillOf(tessellate(image({ u: { x: 0, y: 0.5 }, v: { x: -0.5, y: 0 } }), PAINT))!;
    expect(apply(fill.image!.frame, 0, 0)).toEqual([8, 20]);
    expect(apply(fill.image!.frame, 8, 4)).toEqual([10, 24]);
  });

  it('draws its frame along the boundary when IMAGEFRAME is on, AutoCAD’s initial value', () => {
    const prims = tessellate(image(), PAINT);
    expect(prims.map((p) => p.kind)).toEqual(['fill', 'stroke']);
    const frame = strokeOf(prims)!;
    expect(points(frame.path)).toEqual(points(fillOf(prims)!.path));
    expect(frame.path.at(-1)).toBe(PATH_Z);
    expect(tessellate(image(), PAINT, { frames: { image: false, wipeout: true } })).toEqual([
      fillOf(prims),
    ]);
  });

  it('clips to a rectangle stated by two corners', () => {
    const g = image({
      clipping: true,
      clip: {
        type: 'rectangle',
        vertices: [
          { x: 1.5, y: 0.5 },
          { x: 5.5, y: 2.5 },
        ],
        inverted: false,
      },
    });
    // x 2…6 px and y 1…3 px down from the top: world x 11…13, y 20.5…21.5.
    expect(points(fillOf(tessellate(g, PAINT))!.path)).toEqual([
      [11, 21.5],
      [13, 21.5],
      [13, 20.5],
      [11, 20.5],
    ]);
  });

  it('clips to a polygon, and keeps the outside of an inverted clip', () => {
    const tri = [
      { x: -0.5, y: -0.5 },
      { x: 7.5, y: -0.5 },
      { x: 3.5, y: 3.5 },
    ];
    const g = image({ clipping: true, clip: { type: 'polygon', vertices: tri, inverted: false } });
    const fill = fillOf(tessellate(g, PAINT))!;
    expect(points(fill.path)).toEqual([
      [10, 22],
      [14, 22],
      [12, 20],
    ]);
    expect(fill.evenOdd).toBeFalsy();

    const inv = fillOf(
      tessellate(
        image({ clipping: true, clip: { type: 'polygon', vertices: tri, inverted: true } }),
        PAINT,
      ),
    )!;
    expect(points(inv.path)).toEqual([
      [10, 20],
      [14, 20],
      [14, 22],
      [10, 22],
      [10, 22],
      [14, 22],
      [12, 20],
    ]);
    expect(inv.evenOdd).toBe(true);
  });

  it('ignores a stored boundary while clipping is off', () => {
    const g = image({
      clip: {
        type: 'polygon',
        vertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 2 },
        ],
        inverted: false,
      },
    });
    expect(points(fillOf(tessellate(g, PAINT))!.path)).toHaveLength(4);
  });

  it('shows only the frame when "show image" (DXF 70 bit 1) is off', () => {
    const prims = tessellate(image({ displayFlags: 6 }), PAINT);
    expect(prims.map((p) => p.kind)).toEqual(['stroke']);
  });

  it('passes on brightness, contrast, fade and transparency', () => {
    const im = fillOf(
      tessellate(image({ brightness: 75, contrast: 20, fade: 40, displayFlags: 15 }), PAINT),
    )!.image!;
    expect(im).toMatchObject({ brightness: 75, contrast: 20, fade: 40, transparent: true });
  });

  it('draws nothing for an image with no size', () => {
    expect(tessellate(image({ size: { x: 0, y: 4 } }), PAINT)).toEqual([]);
  });
});

// M1-109: an image whose bitmap the app has not supplied shows its file name inside its frame.
// The test font's `A` is a square a tenth of the text height across, advancing two tenths, so
// `AAAA` is 0.8 heights wide.
describe('missing image name', () => {
  const book = new FontBook();
  // The name is drawn in the bundled default font; the test's romans stands in for it.
  book.addShx('oet-simplex.shx', romans());
  const ctx = (name: string | undefined): TessellateContext => ({
    text: { fonts: book, style: () => undefined },
    imageName: (h) => (h === '7F' ? name : undefined),
  });
  type Glyphs = Fill & { readonly missingImage?: string };
  const glyphs = (prims: RenderPrimitive[]) =>
    prims.filter((p): p is Glyphs => p.kind !== 'point' && p.kind !== 'infinite' && !!p.text);
  const extent = (prims: Glyphs[]): [number, number, number, number] => {
    const pts = prims.flatMap((p) => points(p.path));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  it('centres the name in the frame, a quarter of its height tall at most', () => {
    // The 4 × 2 frame centred on (12, 21): height 0.5 (a quarter of 2), so 0.4 wide.
    const prims = tessellate(image(), PAINT, ctx('AAAA'));
    const g = glyphs(prims);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: 'stroke', color: '#ff0000', missingImage: '7F' });
    const [x0, y0, x1, y1] = extent(g);
    expect(x0).toBeCloseTo(11.8, 9);
    expect(y0).toBeCloseTo(20.75, 9);
    // The last square starts 0.6 heights in and is 0.1 across.
    expect(x1).toBeCloseTo(12.15, 9);
    expect(y1).toBeCloseTo(20.8, 9);
    // The fill (the bitmap, when it comes) and the frame are still there.
    expect(fillOf(prims)?.image).toBeDefined();
    expect(prims.at(-1)).toMatchObject({ kind: 'stroke' });
    expect((prims.at(-1) as Fill).text).toBeUndefined();
  });

  it('shrinks a long name to 80 % of the frame’s width', () => {
    // 40 squares: 8 heights wide, so 0.4 tall to span 3.2 of the 4 units.
    const [x0, y0, x1] = extent(glyphs(tessellate(image(), PAINT, ctx('A'.repeat(40)))));
    expect(x0).toBeCloseTo(10.4, 9);
    expect(y0).toBeCloseTo(20.8, 9);
    expect(x1).toBeCloseTo(13.6 - 0.04, 9);
  });

  it('runs along the image’s U axis', () => {
    // Turned 90°: U up, V to the left, the frame x 8–10, y 20–24 centred on (9, 22).
    const turned = image({ u: { x: 0, y: 0.5 }, v: { x: -0.5, y: 0 } });
    const [x0, y0, x1, y1] = extent(glyphs(tessellate(turned, PAINT, ctx('AAAA'))));
    // The baseline is a quarter height right of the centre and the glyphs rise to the left.
    expect(x0).toBeCloseTo(9.2, 9);
    expect(x1).toBeCloseTo(9.25, 9);
    expect(y0).toBeCloseTo(21.8, 9);
    expect(y1).toBeCloseTo(22.15, 9);
  });

  it('fits a clipped image’s name to its clip boundary', () => {
    // The left half: pixels 0–3 of 8, world x 10–12, centred on (11, 21).
    const half = image({
      clipping: true,
      clip: {
        type: 'rectangle',
        vertices: [
          { x: -0.5, y: -0.5 },
          { x: 3.5, y: 3.5 },
        ],
        inverted: false,
      },
    });
    const [x0, , x1] = extent(glyphs(tessellate(half, PAINT, ctx('AAAA'))));
    expect((x0 + x1 + 0.05) / 2).toBeCloseTo(11, 9);
  });

  it('shrinks the name until it lies inside a clip polygon', () => {
    // A triangle of pixels: base along the bottom edge, apex at the top middle; in world
    // (10, 20), (14, 20), (12, 22).
    const triangle = image({
      clipping: true,
      clip: {
        type: 'polygon',
        vertices: [
          { x: -0.5, y: 3.5 },
          { x: 7.5, y: 3.5 },
          { x: 3.5, y: -0.5 },
        ],
        inverted: false,
      },
    });
    // 40 squares fit the extents at 0.4 tall (3.2 wide), which would cross the sides.
    const g = glyphs(tessellate(triangle, PAINT, ctx('A'.repeat(40))));
    const pts = g.flatMap((p) => points(p.path));
    expect(pts.length).toBeGreaterThan(0);
    // Inside: above the base and below both sides.
    for (const [x, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y - 20).toBeLessThanOrEqual(x - 10 + 1e-9);
      expect(y - 20).toBeLessThanOrEqual(14 - x + 1e-9);
    }
    // Centred on the triangle's centroid, (12, 20.667), along U.
    const [x0, , x1] = extent(g);
    expect((x0 + x1) / 2).toBeGreaterThan(11.9);
    expect((x0 + x1) / 2).toBeLessThan(12);
  });

  it('shows no name for an unloaded definition, without fonts, or with the image hidden', () => {
    expect(glyphs(tessellate(image(), PAINT, ctx(undefined)))).toEqual([]);
    expect(glyphs(tessellate(image(), PAINT, { imageName: () => 'AAAA' }))).toEqual([]);
    expect(glyphs(tessellate(image({ displayFlags: 6 }), PAINT, ctx('AAAA')))).toEqual([]);
    const { definition: _, ...none } = image();
    expect(glyphs(tessellate(none, PAINT, ctx('AAAA')))).toEqual([]);
  });
});

describe('imageLabel', () => {
  const def = (extra: Partial<ImageDefinition> = {}): ImageDefinition => ({
    handle: '7F',
    type: 'IMAGEDEF',
    owner: '80',
    name: 'site-photo',
    fileName: '.\\images\\site-photo.jpg',
    size: { x: 40, y: 30 },
    pixelSize: { x: 1, y: 1 },
    loaded: true,
    units: 0,
    ...extra,
  });

  it('is the file name without its folder, for a loaded definition only', () => {
    expect(imageLabel(def())).toBe('site-photo.jpg');
    expect(imageLabel(def({ fileName: 'C:/photos/Site.PNG' }))).toBe('Site.PNG');
    expect(imageLabel(def({ fileName: '' }))).toBe('site-photo');
    expect(imageLabel(def({ loaded: false }))).toBeUndefined();
  });
});

describe('WIPEOUT', () => {
  // wipeout_door.dxf handle 318: a 1045 × 130 opening from the insertion point up.
  const door: ImageGeometry = {
    kind: 'WIPEOUT',
    displayFlags: 7,
    brightness: 50,
    contrast: 50,
    fade: 0,
    position: { x: -1045, y: -130 },
    u: { x: 1045, y: 0 },
    v: { x: 0, y: 1045 },
    size: { x: 1, y: 1 },
    clipping: true,
    clip: {
      type: 'polygon',
      vertices: [
        { x: -0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.3755981148684704 },
        { x: -0.5, y: 0.3755981148684704 },
        { x: -0.5, y: 0.5 },
      ],
      inverted: false,
    },
  };

  it('fills its boundary with the background', () => {
    const prims = tessellate(door, PAINT, { frames: { image: true, wipeout: false } });
    expect(prims).toHaveLength(1);
    const fill = fillOf(prims)!;
    expect(fill.color).toBe('background');
    expect(fill.image).toBeUndefined();
    const pts = points(fill.path);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-130, 6);
    // The file states the height to about 1e-4 of a drawing unit.
    expect(Math.max(...ys)).toBeCloseTo(0, 3);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(-1045, 6);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(0, 6);
  });

  it('draws its frame when WIPEOUTFRAME is on, AutoCAD’s initial value', () => {
    expect(tessellate(door, PAINT).map((p) => p.kind)).toEqual(['fill', 'stroke']);
    expect(strokeOf(tessellate(door, PAINT))!.color).toBe('#ff0000');
  });
});

describe('adjustPixels', () => {
  const px = (data: number[], extra: Partial<RasterPixels> = {}): RasterPixels => ({
    width: data.length / 4,
    height: 1,
    data: new Uint8ClampedArray(data),
    ...extra,
  });
  const NEUTRAL = { brightness: 50, contrast: 50, fade: 0, transparent: false };
  const run = (
    src: RasterPixels,
    o: Partial<typeof NEUTRAL> = {},
    color: [number, number, number] = [255, 0, 0],
    background: [number, number, number] = [0, 0, 255],
  ) => [...adjustPixels(src, { ...NEUTRAL, ...o, color, background })];

  it('leaves pixels alone at the defaults', () => {
    expect(run(px([10, 128, 250, 255, 0, 0, 0, 255]))).toEqual([10, 128, 250, 255, 0, 0, 0, 255]);
  });

  it('scales contrast about mid grey: 0 is flat grey, 100 doubles', () => {
    expect(run(px([10, 128, 250, 255]), { contrast: 0 })).toEqual([128, 128, 128, 255]);
    expect(run(px([100, 128, 160, 255]), { contrast: 100 })).toEqual([72, 128, 192, 255]);
  });

  it('shifts brightness: 0 is black, 100 white', () => {
    expect(run(px([10, 128, 250, 255]), { brightness: 0 })).toEqual([0, 0, 0, 255]);
    expect(run(px([10, 128, 250, 255]), { brightness: 100 })).toEqual([255, 255, 255, 255]);
    expect(run(px([10, 128, 200, 255]), { brightness: 60 })).toEqual([61, 179, 251, 255]);
  });

  it('fades toward the background', () => {
    expect(run(px([200, 100, 0, 255]), { fade: 100 })).toEqual([0, 0, 255, 255]);
    expect(run(px([200, 100, 0, 255]), { fade: 50 })).toEqual([100, 50, 128, 255]);
  });

  it('keeps alpha when transparent, and lays it over the background when not', () => {
    const half = px([200, 100, 0, 128]);
    expect(run(half, { transparent: true })).toEqual([200, 100, 0, 128]);
    expect(run(half)).toEqual([100, 50, 127, 255]);
  });

  it('draws a bitonal image’s foreground in the image colour, its background in the drawing’s', () => {
    const bits = px([0, 0, 0, 255, 255, 255, 255, 255], { bitonal: true });
    expect(run(bits)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(run(bits, { transparent: true })).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
    // Brightness and contrast do not apply to bitonal images; fade does.
    expect(run(bits, { brightness: 0, contrast: 0 })).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(run(bits, { fade: 50 }).slice(0, 4)).toEqual([128, 0, 128, 255]);
  });
});
