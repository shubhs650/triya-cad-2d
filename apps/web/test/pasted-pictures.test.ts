// M2-54: another app's picture on the system clipboard. Its PNG is read for its size and
// resolution, named after its SHA-256 and kept on this device, so PASTECLIP's IMAGE draws now and
// whenever a drawing naming it opens here again.
import { describe, expect, it } from 'vitest';
import {
  isPastedPictureName,
  keepPicture,
  pictureName,
  pngInfo,
  type PictureFolder,
} from '../src/pasted-pictures';

/** A PNG's chunk: length, type, data and a CRC (not checked here, so zeros). */
function chunk(type: string, data: number[]): number[] {
  const n = data.length;
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
}
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** A PNG's header chunks for a `w` × `h` picture, with a pHYs chunk when given. */
function png(w: number, h: number, phys?: [number, number, number], before: number[] = []) {
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]),
    ...before,
    ...(phys ? chunk('pHYs', [...be32(phys[0]), ...be32(phys[1]), phys[2]]) : []),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

describe('pngInfo', () => {
  it('reads the size, and the resolution a pHYs chunk gives in pixels per metre', () => {
    expect(pngInfo(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    // 5669 pixels a metre is 144 to the inch (a screenshot on a 2× screen).
    const info = pngInfo(png(640, 360, [5669, 5669, 1], chunk('sRGB', [0])));
    expect(info?.width).toBe(640);
    expect(Math.round(info!.ppi!.x)).toBe(144);
    expect(Math.round(info!.ppi!.y)).toBe(144);
  });

  it('takes no resolution from an aspect ratio alone, a zero, or a pHYs after the pixels', () => {
    expect(pngInfo(png(10, 10, [2, 1, 0]))).toEqual({ width: 10, height: 10 });
    expect(pngInfo(png(10, 10, [0, 3780, 1]))).toEqual({ width: 10, height: 10 });
    const late = new Uint8Array([
      ...png(10, 10).subarray(0, -12),
      ...chunk('pHYs', [...be32(3780), ...be32(3780), 1]),
      ...chunk('IEND', []),
    ]);
    expect(pngInfo(late)).toEqual({ width: 10, height: 10 });
  });

  it('is undefined for what is not a PNG or has no pixels', () => {
    expect(pngInfo(new Uint8Array([137, 80, 78, 71]))).toBeUndefined();
    expect(pngInfo(new Uint8Array(40))).toBeUndefined();
    expect(pngInfo(png(0, 10))).toBeUndefined();
    const notIhdr = png(10, 10);
    notIhdr[12] = 'X'.charCodeAt(0);
    expect(pngInfo(notIhdr)).toBeUndefined();
  });
});

describe('pictureName', () => {
  it('names a picture after the first 8 hex digits of its SHA-256', async () => {
    // SHA-256 of the empty input begins e3b0c442.
    expect(await pictureName(new Uint8Array())).toBe('pasted-e3b0c442.png');
    expect(isPastedPictureName('pasted-e3b0c442.png')).toBe(true);
    expect(isPastedPictureName('C:\\work\\PASTED-E3B0C442.PNG')).toBe(true);
    expect(isPastedPictureName('photo.png')).toBe(false);
  });
});

describe('keepPicture', () => {
  function folder(failPut = false): PictureFolder & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    return {
      files,
      get: (name) => Promise.resolve(files.get(name)),
      put: (name, bytes) => {
        if (failPut) return Promise.reject(new Error('QuotaExceededError'));
        files.set(name, bytes);
        return Promise.resolve();
      },
    };
  }

  it('keeps the PNG under its name, hands it to the images and tells PASTECLIP what it is', async () => {
    const f = folder();
    const used: string[] = [];
    const bytes = png(640, 360, [5669, 5669, 1]);
    const picture = await keepPicture(bytes, f, (n) => used.push(n));
    const name = await pictureName(bytes);
    expect(picture).toMatchObject({ fileName: name, width: 640, height: 360 });
    expect(Math.round(picture!.ppi!.x)).toBe(144);
    expect(used).toEqual([name]);
    expect(await f.get(name)).toBe(bytes);
  });

  it('still pastes a picture the device cannot keep, and nothing that is not a PNG', async () => {
    const used: string[] = [];
    const picture = await keepPicture(png(4, 2), folder(true), (n) => used.push(n));
    expect(picture).toMatchObject({ width: 4, height: 2 });
    expect(picture).not.toHaveProperty('ppi');
    expect(used).toHaveLength(1);
    expect(await keepPicture(new Uint8Array([1, 2, 3]), folder(), () => used.push('x'))).toBe(
      undefined,
    );
    expect(used).toHaveLength(1);
  });
});
