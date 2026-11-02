// Image files to `RasterPixels` (M1-19 part 2): what the app hands the renderer for an IMAGEDEF.
//
// AutoCAD attaches BMP, JPEG, PNG, TIFF and GIF among others. BMP is decoded here, TIFF by
// UTIF.js (the browser has no TIFF codec), and PNG, JPEG and GIF by the browser's own codecs
// (`createImageBitmap`, also in workers), which are injected so Node tests can stand in for
// them. A one-bit image is marked bitonal, which AutoCAD draws in the image's colour.

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./utif.d.ts" />
import * as UTIF from 'utif';
import type { RasterPixels } from '../types';

export type RasterFormat = 'png' | 'jpeg' | 'bmp' | 'tiff' | 'gif';

/** The file's format by its signature, whatever its name says; undefined for others. */
export function rasterFormat(bytes: Uint8Array): RasterFormat | undefined {
  const b = (i: number) => bytes[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
  if (b(0) === 0x42 && b(1) === 0x4d) return 'bmp';
  if (
    (b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0) ||
    (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0 && b(3) === 0x2a)
  )
    return 'tiff';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'gif';
  return undefined;
}

/** The browser's decoder for PNG, JPEG and GIF: straight RGBA, as `RasterPixels` needs. */
export type BrowserDecode = (bytes: Uint8Array, format: RasterFormat) => Promise<RasterPixels>;

export interface DecodeOptions {
  /** Defaults to `browserDecode`, which needs `createImageBitmap` and `OffscreenCanvas`. */
  readonly browser?: BrowserDecode;
}

/** Decodes an image file; rejects for a format AutoCAD attaches that is not supported here. */
export async function decodeRaster(
  bytes: Uint8Array,
  o: DecodeOptions = {},
): Promise<RasterPixels> {
  const format = rasterFormat(bytes);
  switch (format) {
    case 'bmp':
      return decodeBmp(bytes);
    case 'tiff':
      return decodeTiff(bytes);
    case 'png': {
      const px = await (o.browser ?? browserDecode)(bytes, format);
      return pngBitonal(bytes) ? { ...px, bitonal: true } : px;
    }
    case 'jpeg':
    case 'gif':
      return (o.browser ?? browserDecode)(bytes, format);
    default:
      throw new Error('not an image file AutoCAD attaches (BMP, JPEG, PNG, TIFF or GIF)');
  }
}

/** PNG IHDR: one bit per pixel, greyscale or a two-colour palette. */
function pngBitonal(bytes: Uint8Array): boolean {
  // Signature (8), IHDR length and type (8), width and height (8), then depth and colour type.
  return bytes.length > 25 && bytes[24] === 1 && (bytes[25] === 0 || bytes[25] === 3);
}

const MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  gif: 'image/gif',
};

/**
 * The browser's codecs, without colour management or premultiplying, so the pixels are the
 * file's own; a GIF gives its first frame.
 */
export const browserDecode: BrowserDecode = async (bytes, format) => {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: MIME[format] }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const { width, height } = bitmap;
  const ctx = new OffscreenCanvas(width, height).getContext('2d');
  if (!ctx) throw new Error('no 2D context to read the image back');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
};

/** TIFF via UTIF.js: the first directory that holds an image (TIFF 6.0 §2). */
export function decodeTiff(bytes: Uint8Array): RasterPixels {
  const buffer = bytes.slice().buffer;
  const ifds = UTIF.decode(buffer);
  const ifd = ifds.find((d) => d.t256 !== undefined);
  if (!ifd) throw new Error('TIFF has no image');
  UTIF.decodeImage(buffer, ifd, ifds);
  const width = ifd.width ?? 0;
  const height = ifd.height ?? 0;
  if (!(width > 0 && height > 0)) throw new Error('TIFF image has no size');
  const rgba = UTIF.toRGBA8(ifd);
  const bits = ifd.t258 as number[] | undefined;
  // Tag 258 BitsPerSample, default 1 (TIFF 6.0 §8).
  const bitonal = (bits?.length ?? 1) === 1 && (bits?.[0] ?? 1) === 1;
  return {
    width,
    height,
    data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4),
    ...(bitonal ? { bitonal: true } : {}),
  };
}

/**
 * BMP (Windows bitmap, BITMAPINFOHEADER or later): 1, 4 and 8 bits through the palette, 16,
 * 24 and 32 bits direct, uncompressed or with bit-field masks, rows bottom-up unless the height
 * is negative. RLE-compressed files are rare in drawings and are refused.
 */
export function decodeBmp(bytes: Uint8Array): RasterPixels {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = v.getUint32(10, true);
  const header = v.getUint32(14, true);
  if (header < 40) throw new Error('BMP core headers (OS/2 1.x) are not supported');
  const width = v.getInt32(18, true);
  const rawHeight = v.getInt32(22, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bpp = v.getUint16(28, true);
  const compression = v.getUint32(30, true);
  if (!(width > 0 && height > 0)) throw new Error('BMP has no size');
  // BI_RGB 0, BI_BITFIELDS 3, BI_ALPHABITFIELDS 6.
  if (compression !== 0 && compression !== 3 && compression !== 6)
    throw new Error(`BMP compression ${compression} is not supported`);
  let masks: [number, number, number, number] | undefined;
  if (compression === 3 || compression === 6) {
    // The masks follow a 40-byte header, or sit inside a V2+ header.
    const at = 14 + 40;
    masks = [
      v.getUint32(at, true),
      v.getUint32(at + 4, true),
      v.getUint32(at + 8, true),
      compression === 6 || header >= 56 ? v.getUint32(at + 12, true) : 0,
    ];
  } else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  else if (bpp === 32) masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
  const colours = bpp <= 8 ? v.getUint32(46, true) || 1 << bpp : 0;
  const palette = 14 + header;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  const channel = (px: number, mask: number): number => {
    if (mask === 0) return 255;
    const shift = Math.log2(mask & -mask);
    const max = mask >>> shift;
    return Math.round((((px & mask) >>> shift) * 255) / max);
  };
  for (let y = 0; y < height; y++) {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp <= 8) {
        const bit = x * bpp;
        const byte = bytes[row + (bit >> 3)]!;
        const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        if (index >= colours) throw new Error('BMP pixel outside its palette');
        const p = palette + index * 4; // BGRx
        out[o] = bytes[p + 2]!;
        out[o + 1] = bytes[p + 1]!;
        out[o + 2] = bytes[p]!;
        out[o + 3] = 255;
      } else if (bpp === 24) {
        const p = row + x * 3;
        out[o] = bytes[p + 2]!;
        out[o + 1] = bytes[p + 1]!;
        out[o + 2] = bytes[p]!;
        out[o + 3] = 255;
      } else if ((bpp === 16 || bpp === 32) && masks) {
        const px = bpp === 16 ? v.getUint16(row + x * 2, true) : v.getUint32(row + x * 4, true);
        out[o] = channel(px, masks[0]);
        out[o + 1] = channel(px, masks[1]);
        out[o + 2] = channel(px, masks[2]);
        out[o + 3] = channel(px, masks[3]);
      } else throw new Error(`BMP with ${bpp} bits per pixel is not supported`);
    }
  }
  return { width, height, data: out, ...(bpp === 1 ? { bitonal: true } : {}) };
}
