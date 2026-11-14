// Raster images (M1-19 part 3): image files the user supplies, matched to IMAGEDEFs by file name
// without folder or case, decoded once, and handed to every canvas showing an IMAGE of them, a
// copy each (the renderer host transfers the buffer to its worker). An unloaded definition
// (DXF 280 = 0) is not served, as AutoCAD shows only an unloaded image's frame.
import type { ImageDefinition } from '@triya/engine';
import type { RasterPixels } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { RasterImages, imageDefinitionsOf, isRasterFile } from '../src/images';

const def = (handle: string, fileName: string, loaded = true): ImageDefinition => ({
  handle,
  type: 'IMAGEDEF',
  owner: 'D4',
  name: handle,
  fileName,
  size: { x: 2, y: 1 },
  pixelSize: { x: 1, y: 1 },
  loaded,
  units: 0,
});

/** A decoder that makes a 2 × 1 bitmap whose first byte is the file's first byte. */
function fakeDecode() {
  const decoded: Uint8Array[] = [];
  const decode = (bytes: Uint8Array): Promise<RasterPixels> => {
    decoded.push(bytes);
    if (bytes[0] === 0) return Promise.reject(new Error('not an image'));
    const data = new Uint8ClampedArray(8);
    data[0] = bytes[0]!;
    return Promise.resolve({ width: 2, height: 1, data });
  };
  return { decode, decoded };
}

/** Lets the decodes run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('isRasterFile', () => {
  it('takes the formats the renderer decodes, by extension and without case', () => {
    for (const n of ['a.png', 'B.JPG', 'c.jpeg', 'd.bmp', 'e.tif', 'f.TIFF', 'g.gif', 'h.jpe'])
      expect(isRasterFile(n), n).toBe(true);
    for (const n of ['a.dxf', 'b.dwg', 'c.pdf', 'd.pat', 'png', 'e.png.txt'])
      expect(isRasterFile(n), n).toBe(false);
  });
});

describe('imageDefinitionsOf', () => {
  it('follows the IMAGEDEFs edits add, change and remove', () => {
    const a = def('A1', 'a.png');
    const b = def('B1', 'b.png');
    const init = { objects: [a, b, { handle: 'C1', type: 'DICTIONARY', owner: '0' }] } as never;
    const b2 = { ...b, fileName: 'b2.png' };
    const c = def('D1', 'd.png');
    const changes = [
      { objects: { updated: [{ before: b, after: b2 }], removed: [a] } },
      { objects: { added: [c] } },
    ] as never;
    expect(imageDefinitionsOf(init, changes).map((d) => d.fileName)).toEqual(['b2.png', 'd.png']);
  });
});

describe('RasterImages', () => {
  it('serves a canvas the bitmaps of its definitions whose files it has, a copy each', async () => {
    const { decode, decoded } = fakeDecode();
    const images = new RasterImages(decode);
    images.add('PHOTO.png', new Uint8Array([7]));
    const got: [string, RasterPixels | undefined][] = [];
    const defs = [def('9A', '..\\pics\\photo.png'), def('9B', 'photo.PNG'), def('9C', 'x.png')];
    images.client(
      () => defs,
      (d, p) => got.push([d, p]),
    );
    await settle();
    expect(got.map(([d]) => d).sort()).toEqual(['9A', '9B']);
    expect(got[0]![1]!.data[0]).toBe(7);
    // One decode for the file; each delivery has its own buffer.
    expect(decoded).toHaveLength(1);
    expect(got[0]![1]!.data.buffer).not.toBe(got[1]![1]!.data.buffer);
    expect(images.has('C:\\photo.png')).toBe(true);
    expect(images.has('x.png')).toBe(false);
  });

  it('serves the canvases waiting on a file when it arrives, and again for a new version', async () => {
    const { decode } = fakeDecode();
    const images = new RasterImages(decode);
    const got: number[] = [];
    images.client(
      () => [def('9A', 'plan.bmp')],
      (_d, p) => got.push(p!.data[0]!),
    );
    images.client(
      () => [def('7F', '.\\plan.bmp')],
      (_d, p) => got.push(p!.data[0]!),
    );
    await settle();
    expect(got).toEqual([]);
    images.add('plan.bmp', new Uint8Array([3]));
    await settle();
    expect(got).toEqual([3, 3]);
    images.add('Plan.BMP', new Uint8Array([4]));
    await settle();
    expect(got).toEqual([3, 3, 4, 4]);
  });

  it('does not serve an unloaded definition, a disposed canvas or a file it cannot decode', async () => {
    const { decode } = fakeDecode();
    const images = new RasterImages(decode);
    const got: string[] = [];
    const gone = images.client(
      () => [def('1A', 'a.png')],
      (d) => got.push(`gone ${d}`),
    );
    gone.dispose();
    images.client(
      () => [def('2A', 'a.png', false), def('2B', 'bad.png'), def('2C', 'a.png')],
      (d) => got.push(d),
    );
    images.add('a.png', new Uint8Array([1]));
    images.add('bad.png', new Uint8Array([0]));
    await settle();
    expect(got).toEqual(['2C']);
  });

  it('serves everything again on `resend`, with the definitions as they are now', async () => {
    const { decode, decoded } = fakeDecode();
    const images = new RasterImages(decode);
    images.add('a.png', new Uint8Array([1]));
    images.add('b.png', new Uint8Array([2]));
    let defs = [def('1A', 'a.png')];
    const got: string[] = [];
    const c = images.client(
      () => defs,
      (d, p) => got.push(`${d}:${p?.data[0]}`),
    );
    await settle();
    // A new renderer (REGEN) or an edit that brought a definition in (an xref with images).
    defs = [def('1A', 'a.png'), def('1B', 'b.png')];
    c.resend();
    await settle();
    expect(got).toEqual(['1A:1', '1A:1', '1B:2']);
    expect(decoded).toHaveLength(2);
  });
});

describe('RasterImages with kept pictures (M2-54)', () => {
  it('looks a missing file up among the pictures kept on this device, once', async () => {
    const { decode } = fakeDecode();
    const asked: string[] = [];
    let found = 0;
    const images = new RasterImages(decode, {
      kept: (name) => {
        asked.push(name);
        return Promise.resolve(name === 'pasted-0a1b2c3d.png' ? new Uint8Array([9]) : undefined);
      },
      found: () => found++,
    });
    const got: string[] = [];
    const defs = [
      def('1A', 'pasted-0a1b2c3d.png'),
      def('1B', '.\\pasted-0A1B2C3D.png'),
      def('1C', 'pasted-ffffffff.png'),
      def('1D', 'photo.png'),
      def('1E', 'pasted-11111111.png', false),
    ];
    const c = images.client(
      () => defs,
      (d, p) => got.push(`${d}:${p?.data[0]}`),
    );
    await settle();
    await settle();
    expect(got.sort()).toEqual(['1A:9', '1B:9']);
    expect(images.has('pasted-0a1b2c3d.png')).toBe(true);
    expect(found).toBe(1);
    // Only pasted pictures' names, each asked once: a REGEN does not ask again.
    c.resend();
    await settle();
    expect(asked.sort()).toEqual(['pasted-0a1b2c3d.png', 'pasted-ffffffff.png']);
  });

  it('keeps a file supplied meanwhile over the kept one', async () => {
    const { decode } = fakeDecode();
    let release: (b: Uint8Array) => void = () => {};
    const images = new RasterImages(decode, {
      kept: () => new Promise((r) => (release = r)),
      found: () => {},
    });
    const got: number[] = [];
    images.client(
      () => [def('1A', 'pasted-0a1b2c3d.png')],
      (_d, p) => got.push(p!.data[0]!),
    );
    images.add('pasted-0a1b2c3d.png', new Uint8Array([5]));
    release(new Uint8Array([9]));
    await settle();
    await settle();
    expect(got).toEqual([5]);
  });
});
