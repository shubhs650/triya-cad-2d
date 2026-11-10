// PNG encoding for plots (M2-18): the raster a "Triya PNG" plot downloads, and the bitmaps an
// SVG plot embeds as `data:` URIs. 8-bit RGBA (colour type 6), every row filtered None and the
// whole image deflated once (PNG §11–12); a resolution, when given, goes into a pHYs chunk in
// pixels per metre so viewers and print dialogs size the image as plotted. No DOM here.

import { zlibSync } from 'fflate';
import type { PlotPixels } from './fills';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | undefined;

/** CRC-32 of `bytes` (PNG Annex D). */
export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = crc;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

export interface PngOptions {
  /** Dots per inch, written as a pHYs chunk; none when absent. */
  readonly dpi?: number;
}

/** Straight RGBA pixels, rows top first, as a PNG file. */
export function encodePng(p: PlotPixels, o: PngOptions = {}): Uint8Array {
  const { width, height } = p;
  if (!(width > 0 && height > 0) || p.data.length < width * height * 4) {
    throw new RangeError(`a ${width} × ${height} bitmap needs ${width * height * 4} bytes`);
  }
  const row = width * 4 + 1;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    // Filter type 0 (None) leads each row.
    for (let i = 0; i < width * 4; i++) raw[y * row + 1 + i] = p.data[y * width * 4 + i]!;
  }
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr)];
  if (o.dpi !== undefined && o.dpi > 0) {
    const phys = new Uint8Array(9);
    const ppm = Math.round(o.dpi / 0.0254);
    const v = new DataView(phys.buffer);
    v.setUint32(0, ppm);
    v.setUint32(4, ppm);
    phys[8] = 1; // the unit is the metre
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of parts) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 (RFC 4648 §4, padded), without the DOM's `btoa`. */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!;
    out += c === undefined ? '=' : B64[n & 63]!;
  }
  return out;
}
