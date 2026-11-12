import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PngWriter, base64, crc32, encodePng } from '../src/png';

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

// M2-39 part 4: a PNG too big for one bitmap is written a band of rows at a time.
describe('PngWriter', () => {
  /** A `w` × `h` bitmap whose every byte depends on its place. */
  const bitmap = (w: number, h: number, top = 0) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < w * 4; i++) data[y * w * 4 + i] = ((y + top) * 31 + i * 7) & 0xff;
    }
    return { width: w, height: h, data };
  };

  it('writes the same image as encodePng from bands of any height', () => {
    const whole = bitmap(5, 7);
    const w = new PngWriter(5, 7, { dpi: 150 });
    w.rows(bitmap(5, 3, 0));
    w.rows(bitmap(5, 1, 3));
    w.rows(bitmap(5, 3, 4));
    const banded = chunks(w.end());
    const single = chunks(encodePng(whole, { dpi: 150 }));
    expect(banded.every((c) => c.crcOk)).toBe(true);
    expect(banded[0]!.type).toBe('IHDR');
    expect([...banded[0]!.data]).toEqual([...single[0]!.data]);
    expect(banded[1]).toMatchObject({ type: 'pHYs' });
    expect([...banded[1]!.data]).toEqual([...single[1]!.data]);
    expect(banded.at(-1)!.type).toBe('IEND');
    const idat = banded.filter((c) => c.type === 'IDAT').map((c) => c.data);
    expect(idat.length).toBeGreaterThan(0);
    const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
    idat.reduce((at, d) => (joined.set(d, at), at + d.length), 0);
    const idatSingle = single.find((c) => c.type === 'IDAT')!.data;
    expect([...unzlibSync(joined)]).toEqual([...unzlibSync(idatSingle)]);
  });

  it('refuses a band of another width, too many rows, and an early end', () => {
    const w = new PngWriter(4, 2);
    expect(() => w.rows(bitmap(3, 1))).toThrow(RangeError);
    w.rows(bitmap(4, 1));
    expect(() => w.end()).toThrow(/2 rows; 1 were given/);
    expect(() => w.rows(bitmap(4, 2))).toThrow(RangeError);
    w.rows(bitmap(4, 1, 1));
    expect(w.end()).toBe(w.end());
    expect(() => new PngWriter(0, 1)).toThrow(RangeError);
  });
});
