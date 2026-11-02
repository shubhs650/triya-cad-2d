// IMAGE and WIPEOUT tessellation and image pixel adjustment (M1-19).
//
// Clip vertices are pixel coordinates centred on pixels with V counted down from the image's
// top edge, so a vertex (x, y) sits at position + u (x + ½) + v (h − y − ½). The public corpus
// pins the direction: wipeout_door.dxf's door-opening wipeouts state y from 0.5 to 0.376 of a
// 1 × 1 image and only this reading puts them in the wall, from the insertion point up.
import type { ImageGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  PATH_L,
  PATH_M,
  PATH_Z,
  adjustPixels,
  tessellate,
  type Paint,
  type RasterPixels,
  type RenderPrimitive,
} from '../src/index';

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
