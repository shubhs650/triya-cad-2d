// Image files to RasterPixels (M1-19 part 2), on self-authored files built here byte by byte
// (BMP, a one-bit TIFF) or written by UTIF.js (an RGBA TIFF). PNG, JPEG and GIF go through the
// browser's codecs, stood in for by a fake.
import * as UTIF from 'utif';
import { describe, expect, it } from 'vitest';
import { decodeBmp, decodeRaster, decodeTiff, rasterFormat, type RasterPixels } from '../src/index';

/** A BMP with a BITMAPINFOHEADER: `rows` are top first, each already padded to 4 bytes. */
function bmp(o: {
  width: number;
  height: number;
  bpp: number;
  rows: number[][];
  palette?: number[][];
  topDown?: boolean;
  compression?: number;
  masks?: number[];
}): Uint8Array {
  const palette = (o.palette ?? []).flatMap(([r, g, b]) => [b!, g!, r!, 0]);
  const masks = (o.masks ?? []).flatMap((m) => [
    m & 255,
    (m >>> 8) & 255,
    (m >>> 16) & 255,
    m >>> 24,
  ]);
  const stored = o.topDown ? o.rows : [...o.rows].reverse();
  const pixels = stored.flat();
  const offset = 14 + 40 + masks.length + palette.length;
  const out = new Uint8Array(offset + pixels.length);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, offset, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, o.width, true);
  v.setInt32(22, o.topDown ? -o.height : o.height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, o.bpp, true);
  v.setUint32(30, o.compression ?? 0, true);
  v.setUint32(46, (o.palette ?? []).length, true);
  out.set(masks, 54);
  out.set(palette, 54 + masks.length);
  out.set(pixels, offset);
  return out;
}

const px = (p: RasterPixels) => [...p.data];

describe('rasterFormat', () => {
  it('knows a file by its signature', () => {
    expect(rasterFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10]))).toBe('png');
    expect(rasterFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(rasterFormat(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('bmp');
    expect(rasterFormat(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe('tiff');
    expect(rasterFormat(new Uint8Array([0x4d, 0x4d, 0, 0x2a]))).toBe('tiff');
    expect(rasterFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif');
    expect(rasterFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeUndefined();
  });
});

describe('decodeBmp', () => {
  it('reads 24-bit rows bottom-up into RGBA top first', () => {
    // 2 × 2: top row red, green; bottom row blue, white. Rows pad 6 bytes to 8.
    const file = bmp({
      width: 2,
      height: 2,
      bpp: 24,
      rows: [
        [0, 0, 255, 0, 255, 0, 0, 0],
        [255, 0, 0, 255, 255, 255, 0, 0],
      ],
    });
    const p = decodeBmp(file);
    expect([p.width, p.height, p.bitonal]).toEqual([2, 2, undefined]);
    expect(px(p)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  });

  it('reads a top-down file (negative height) in its stored order', () => {
    const file = bmp({
      width: 1,
      height: 2,
      bpp: 24,
      topDown: true,
      rows: [
        [0, 0, 255, 0],
        [255, 0, 0, 0],
      ],
    });
    expect(px(decodeBmp(file))).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('reads 1-bit files through the palette and marks them bitonal', () => {
    // 3 pixels: black, white, black (palette 0 black, 1 white), bits from the high end.
    const file = bmp({
      width: 3,
      height: 1,
      bpp: 1,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      rows: [[0b01000000, 0, 0, 0]],
    });
    const p = decodeBmp(file);
    expect(p.bitonal).toBe(true);
    expect(px(p)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('reads 4- and 8-bit palette files', () => {
    const palette = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ];
    const four = bmp({ width: 2, height: 1, bpp: 4, palette, rows: [[0x21, 0, 0, 0]] });
    expect(px(decodeBmp(four))).toEqual([70, 80, 90, 255, 40, 50, 60, 255]);
    const eight = bmp({ width: 2, height: 1, bpp: 8, palette, rows: [[1, 0, 0, 0]] });
    expect(px(decodeBmp(eight))).toEqual([40, 50, 60, 255, 10, 20, 30, 255]);
  });

  it('reads 32-bit pixels with bit-field masks, alpha included', () => {
    const file = bmp({
      width: 1,
      height: 1,
      bpp: 32,
      compression: 6,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
      rows: [[0x30, 0x20, 0x10, 0x80]],
    });
    expect(px(decodeBmp(file))).toEqual([0x10, 0x20, 0x30, 0x80]);
  });

  it('reads 16-bit pixels as 5-5-5 by default', () => {
    // 0x7fff is white; 0x001f is pure blue.
    const file = bmp({ width: 2, height: 1, bpp: 16, rows: [[0xff, 0x7f, 0x1f, 0x00]] });
    expect(px(decodeBmp(file))).toEqual([255, 255, 255, 255, 0, 0, 255, 255]);
  });

  it('refuses RLE compression', () => {
    expect(() =>
      decodeBmp(bmp({ width: 1, height: 1, bpp: 8, compression: 1, rows: [[0, 0, 0, 0]] })),
    ).toThrow(/compression 1/);
  });
});

/** `data` as a zlib stream (RFC 1950) holding one stored (uncompressed) deflate block. */
function zlibStored(data: number[]): number[] {
  let a = 1;
  let b = 0;
  for (const d of data) {
    a = (a + d) % 65521;
    b = (b + a) % 65521;
  }
  const n = data.length;
  const adler = ((b << 16) | a) >>> 0;
  return [
    0x78,
    0x01,
    0x01, // BFINAL, stored
    n & 255,
    n >> 8,
    ~n & 255,
    (~n >> 8) & 255,
    ...data,
    adler >>> 24,
    (adler >>> 16) & 255,
    (adler >>> 8) & 255,
    adler & 255,
  ];
}

/**
 * A one-bit little-endian TIFF of `rows` (bytes), WhiteIsZero, uncompressed or (`deflate`)
 * as one zlib-wrapped strip, TIFF compression 8.
 */
function bitonalTiff(width: number, rows: number[], deflate = false): Uint8Array {
  const strip = deflate ? zlibStored(rows) : rows;
  const tags: [number, number, number][] = [
    [256, 3, width], // ImageWidth
    [257, 3, rows.length], // ImageLength
    [258, 3, 1], // BitsPerSample
    [259, 3, deflate ? 8 : 1], // Compression: none or Adobe Deflate
    [262, 3, 0], // PhotometricInterpretation: WhiteIsZero
    [273, 4, 0], // StripOffsets, patched below
    [277, 3, 1], // SamplesPerPixel
    [278, 3, rows.length], // RowsPerStrip
    [279, 4, strip.length], // StripByteCounts
  ];
  const ifd = 8;
  const data = ifd + 2 + tags.length * 12 + 4;
  const out = new Uint8Array(data + strip.length);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0]);
  v.setUint32(4, ifd, true);
  v.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, value], i) => {
    const at = ifd + 2 + i * 12;
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, 1, true);
    if (type === 3) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, tag === 273 ? data : value, true);
  });
  out.set(strip, data);
  return out;
}

describe('decodeTiff', () => {
  it('reads an RGBA TIFF', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]);
    const file = new Uint8Array(UTIF.encodeImage(rgba, 2, 1));
    const p = decodeTiff(file);
    expect([p.width, p.height, p.bitonal]).toEqual([2, 1, undefined]);
    expect(px(p)).toEqual([...rgba]);
  });

  it('reads a one-bit TIFF as bitonal, set bits black under WhiteIsZero', () => {
    const p = decodeTiff(bitonalTiff(3, [0b10100000, 0b01000000]));
    expect([p.width, p.height, p.bitonal]).toEqual([3, 2, true]);
    const grey = px(p).filter((_, i) => i % 4 === 0);
    expect(grey).toEqual([0, 255, 0, 255, 0, 255]);
  });

  it('inflates Deflate strips through the fflate-backed pako stand-in', () => {
    const p = decodeTiff(bitonalTiff(3, [0b10100000, 0b01000000], true));
    expect(px(p).filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0, 255, 0, 255]);
  });
});

describe('decodeRaster', () => {
  const fake = (calls: string[]) => async (_: Uint8Array, format: string) => {
    calls.push(format);
    return { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) };
  };

  it('decodes BMP and TIFF itself and hands PNG, JPEG and GIF to the browser', async () => {
    const calls: string[] = [];
    const browser = fake(calls);
    const red = bmp({ width: 1, height: 1, bpp: 24, rows: [[0, 0, 255, 0]] });
    expect(px(await decodeRaster(red, { browser }))).toEqual([255, 0, 0, 255]);
    const tiff = new Uint8Array(UTIF.encodeImage(new Uint8Array([9, 8, 7, 255]), 1, 1));
    expect(px(await decodeRaster(tiff, { browser }))).toEqual([9, 8, 7, 255]);
    await decodeRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { browser });
    await decodeRaster(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), { browser });
    expect(calls).toEqual(['jpeg', 'gif']);
    expect(calls).not.toContain('bmp');
  });

  it('marks a one-bit PNG bitonal from its IHDR', async () => {
    const png = (depth: number, colour: number) => {
      const b = new Uint8Array(33);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
      b[24] = depth;
      b[25] = colour;
      return b;
    };
    const browser = fake([]);
    expect((await decodeRaster(png(1, 0), { browser })).bitonal).toBe(true);
    expect((await decodeRaster(png(1, 3), { browser })).bitonal).toBe(true);
    expect((await decodeRaster(png(8, 6), { browser })).bitonal).toBeUndefined();
  });

  it('rejects files that are not images', async () => {
    await expect(decodeRaster(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      /not an image file/,
    );
  });
});
