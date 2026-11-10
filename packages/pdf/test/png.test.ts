import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { base64, crc32, encodePng } from '../src/png';

/** The PNG's chunks: type, data, and whether the stored CRC matches. */
function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let at = 8; at < png.length;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    const crc = view.getUint32(at + 8 + len);
    out.push({
      type,
      data,
      crcOk: (crc32(png.subarray(at + 4, at + 8 + len)) ^ 0xffffffff) >>> 0 === crc,
    });
    at += 12 + len;
  }
  return out;
}

describe('encodePng', () => {
  const pixels = {
    width: 2,
    height: 2,
    data: [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255],
  };

  it('writes the signature, an RGBA IHDR, the rows filtered None, and IEND, each CRC right', () => {
    const png = encodePng(pixels);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const cs = chunks(png);
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(cs.every((c) => c.crcOk)).toBe(true);
    expect([...cs[0]!.data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
    expect([...unzlibSync(cs[1]!.data)]).toEqual([
      0,
      ...pixels.data.slice(0, 8),
      0,
      ...pixels.data.slice(8),
    ]);
  });

  it('records the resolution in pixels per metre', () => {
    const cs = chunks(encodePng(pixels, { dpi: 300 }));
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const phys = new DataView(cs[1]!.data.buffer, cs[1]!.data.byteOffset, 9);
    // 300 dpi = 11811 pixels per metre, both ways, unit metre.
    expect([phys.getUint32(0), phys.getUint32(4), phys.getUint8(8)]).toEqual([11811, 11811, 1]);
  });

  it('refuses an empty or short bitmap', () => {
    expect(() => encodePng({ width: 0, height: 1, data: [] })).toThrow(RangeError);
    expect(() => encodePng({ width: 2, height: 2, data: [0, 0, 0, 0] })).toThrow(RangeError);
  });

  it('matches the CRC-32 check value', () => {
    expect((crc32(new TextEncoder().encode('123456789')) ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
  });
});

describe('base64', () => {
  it('pads as RFC 4648 says', () => {
    const enc = (s: string) => base64(new TextEncoder().encode(s));
    expect(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map(enc)).toEqual([
      '',
      'Zg==',
      'Zm8=',
      'Zm9v',
      'Zm9vYg==',
      'Zm9vYmE=',
      'Zm9vYmFy',
    ]);
  });
});
