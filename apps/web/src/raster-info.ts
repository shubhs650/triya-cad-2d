// What an image file states of itself (M5-04 part 5): its size in pixels and, when it gives one,
// its resolution, read from its header without decoding it. IMAGEATTACH's Attach Image dialog
// shows them (Image Information) and the engine sizes the image by them, as AutoCAD sizes an
// attached image by the resolution its file records (AutoCAD Help, "Attach Image Dialog Box").
// The formats are those `decodeRaster` draws (images.ts `isRasterFile`):
// - PNG: IHDR and pHYs in metres (pasted-pictures.ts `pngInfo`);
// - JPEG: the first SOFn frame header, and the JFIF APP0 density in dots per inch or centimetre
//   (JFIF 1.02 §A; units 0 states only the aspect ratio, which is no resolution);
// - BMP: BITMAPINFOHEADER width, height (negative: top-down) and pixels per metre;
// - GIF: the logical screen size (GIF89a §18), which states no resolution;
// - TIFF: the first IFD's ImageWidth, ImageLength, XResolution, YResolution and ResolutionUnit
//   (TIFF 6.0 §8: unit 2 inch, the default; 3 centimetre; 1 none).
import { pngInfo, type PngInfo } from './pasted-pictures';

export type RasterInfo = PngInfo;

const INCH_CM = 2.54;
const INCH_M = 0.0254;

const be16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const le16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const le32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const sle32 = (b: Uint8Array, at: number) => le32(b, at) | 0;

const positive = (v: number) => Number.isFinite(v) && v > 0;

/** `ppi` when both are resolutions, else none. */
function withPpi(width: number, height: number, x: number, y: number): RasterInfo | undefined {
  if (!positive(width) || !positive(height)) return undefined;
  return positive(x) && positive(y) ? { width, height, ppi: { x, y } } : { width, height };
}

function jpegInfo(b: Uint8Array): RasterInfo | undefined {
  let ppi: { x: number; y: number } | undefined;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1]!;
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = be16(b, at + 2);
    const data = at + 4;
    if (
      marker === 0xe0 &&
      length >= 14 &&
      String.fromCharCode(...b.subarray(data, data + 5)) === 'JFIF\0'
    ) {
      const units = b[data + 7];
      const x = be16(b, data + 8);
      const y = be16(b, data + 10);
      if (units === 1) ppi = { x, y };
      else if (units === 2) ppi = { x: x * INCH_CM, y: y * INCH_CM };
    }
    // SOF0–SOF15 but DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (data + 5 > b.length) return undefined;
      return withPpi(be16(b, data + 3), be16(b, data + 1), ppi?.x ?? 0, ppi?.y ?? 0);
    }
    if (marker === 0xda) return undefined;
    at += 2 + length;
  }
  return undefined;
}

function bmpInfo(b: Uint8Array): RasterInfo | undefined {
  if (b.length < 26) return undefined;
  const header = le32(b, 14);
  if (header === 12) return withPpi(le16(b, 18), le16(b, 20), 0, 0);
  if (header < 40 || b.length < 46) return undefined;
  return withPpi(
    sle32(b, 18),
    Math.abs(sle32(b, 22)),
    sle32(b, 38) * INCH_M,
    sle32(b, 42) * INCH_M,
  );
}

function gifInfo(b: Uint8Array): RasterInfo | undefined {
  return b.length < 10 ? undefined : withPpi(le16(b, 6), le16(b, 8), 0, 0);
}

function tiffInfo(b: Uint8Array): RasterInfo | undefined {
  const little = b[0] === 0x49;
  const u16 = (at: number) => (little ? le16(b, at) : be16(b, at));
  const u32 = (at: number) =>
    little
      ? le32(b, at)
      : ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
  if (b.length < 8 || u16(2) !== 42) return undefined;
  const ifd = u32(4);
  if (ifd + 2 > b.length) return undefined;
  const tags = new Map<number, number>();
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e);
    const type = u16(e + 2);
    if (type === 3) tags.set(tag, u16(e + 8));
    else if (type === 4) tags.set(tag, u32(e + 8));
    else if (type === 5) {
      // RATIONAL: numerator and denominator at the offset.
      const at = u32(e + 8);
      if (at + 8 <= b.length && u32(at + 4) !== 0) tags.set(tag, u32(at) / u32(at + 4));
    }
  }
  const unit = tags.get(296) ?? 2;
  const k = unit === 2 ? 1 : unit === 3 ? INCH_CM : 0;
  return withPpi(
    tags.get(256) ?? 0,
    tags.get(257) ?? 0,
    (tags.get(282) ?? 0) * k,
    (tags.get(283) ?? 0) * k,
  );
}

/** The image file's size and resolution from its header; undefined when it is none we draw. */
export function rasterInfo(bytes: Uint8Array): RasterInfo | undefined {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return pngInfo(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpegInfo(b);
  if (b[0] === 0x42 && b[1] === 0x4d) return bmpInfo(b);
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return gifInfo(b);
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return tiffInfo(b);
  return undefined;
}
