// M5-04 part 5: an image file's size and resolution read from its header, which IMAGEATTACH's
// Attach Image dialog shows and sizes the image by (PNG, JPEG, BMP, GIF, TIFF).
import { describe, expect, it } from 'vitest';
import { rasterInfo } from '../src/raster-info';

const be16 = (v: number) => [(v >> 8) & 255, v & 255];
const le16 = (v: number) => [v & 255, (v >> 8) & 255];
const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** A JPEG's markers up to its frame header: JFIF APP0 with `units` and density, then SOF. */
function jpeg(w: number, h: number, units?: number, dx = 0, dy = 0, sof = 0xc0) {
  const app0 =
    units === undefined
      ? []
      : [
          0xff,
          0xe0,
          ...be16(16),
          ...'JFIF'.split('').map((c) => c.charCodeAt(0)),
          0,
          1,
          2,
          units,
          ...be16(dx),
          ...be16(dy),
          0,
          0,
        ];
  // A DQT segment the reader skips, then the frame header.
  const dqt = [0xff, 0xdb, ...be16(4), 0, 0];
  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    ...dqt,
    0xff,
    sof,
    ...be16(11),
    8,
    ...be16(h),
    ...be16(w),
    3,
  ]);
}

function bmp(w: number, h: number, ppm: number) {
  const b = new Array<number>(54).fill(0);
  b[0] = 0x42;
  b[1] = 0x4d;
  b.splice(14, 4, ...le32(40));
  b.splice(18, 4, ...le32(w));
  b.splice(22, 4, ...le32(h));
  b.splice(38, 4, ...le32(ppm));
  b.splice(42, 4, ...le32(ppm));
  return new Uint8Array(b);
}

/** A big-endian TIFF with one IFD: width, length (SHORT), X/Y resolution (RATIONAL), unit. */
function tiff(w: number, h: number, res: number, unit?: number) {
  const entries: number[][] = [
    [256, 3, 1, w << 16],
    [257, 4, 1, h],
    [282, 5, 1, 0],
    [283, 5, 1, 0],
    ...(unit === undefined ? [] : [[296, 3, 1, unit << 16]]),
  ];
  const ifd = 8;
  const rational = ifd + 2 + entries.length * 12 + 4;
  entries[2]![3] = rational;
  entries[3]![3] = rational;
  return new Uint8Array([
    0x4d,
    0x4d,
    0,
    42,
    ...be32(ifd),
    ...be16(entries.length),
    ...entries.flatMap(([tag, type, n, v]) => [
      ...be16(tag!),
      ...be16(type!),
      ...be32(n!),
      ...be32(v!),
    ]),
    ...be32(0),
    ...be32(res * 2),
    ...be32(2),
  ]);
}

describe('rasterInfo', () => {
  it('reads a PNG', () => {
    const png = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...be32(13),
      73,
      72,
      68,
      82,
      ...be32(64),
      ...be32(32),
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...be32(0),
      73,
      69,
      78,
      68,
      0,
      0,
      0,
      0,
    ]);
    expect(rasterInfo(png)).toEqual({ width: 64, height: 32 });
  });

  it('reads a JPEG frame header and its JFIF density in inches or centimetres', () => {
    expect(rasterInfo(jpeg(640, 480, 1, 300, 150))).toEqual({
      width: 640,
      height: 480,
      ppi: { x: 300, y: 150 },
    });
    expect(rasterInfo(jpeg(10, 20, 2, 100, 100))!.ppi!.x).toBeCloseTo(254, 9);
    // Units 0: an aspect ratio only. A progressive frame (SOF2) without JFIF.
    expect(rasterInfo(jpeg(10, 20, 0, 1, 1))).toEqual({ width: 10, height: 20 });
    expect(rasterInfo(jpeg(10, 20, undefined, 0, 0, 0xc2))).toEqual({ width: 10, height: 20 });
    // Cut short before its frame header.
    expect(rasterInfo(jpeg(10, 20).subarray(0, 12))).toBeUndefined();
  });

  it('reads a BMP, bottom-up or top-down, and its pixels per metre', () => {
    expect(rasterInfo(bmp(100, 50, 3780))).toEqual({
      width: 100,
      height: 50,
      ppi: { x: 3780 * 0.0254, y: 3780 * 0.0254 },
    });
    expect(rasterInfo(bmp(100, -50, 0))).toEqual({ width: 100, height: 50 });
  });

  it('reads a GIF, which states no resolution', () => {
    const gif = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61,
      ...le16(320),
      ...le16(200),
      0,
      0,
    ]);
    expect(rasterInfo(gif)).toEqual({ width: 320, height: 200 });
  });

  it('reads a TIFF IFD, its resolution in inches by default, centimetres, or none', () => {
    expect(rasterInfo(tiff(800, 600, 72))).toEqual({
      width: 800,
      height: 600,
      ppi: { x: 72, y: 72 },
    });
    expect(rasterInfo(tiff(800, 600, 100, 3))!.ppi!.y).toBeCloseTo(254, 9);
    expect(rasterInfo(tiff(800, 600, 72, 1))).toEqual({ width: 800, height: 600 });
  });

  it('is undefined for what is not an image', () => {
    expect(rasterInfo(new TextEncoder().encode('0\nSECTION\n'))).toBeUndefined();
    expect(rasterInfo(new Uint8Array([0x42, 0x4d, 0]))).toBeUndefined();
  });
});
