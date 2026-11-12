// PNG encoding for plots (M2-18): the raster a "Triya PNG" plot downloads, and the bitmaps an
// SVG plot embeds as `data:` URIs. 8-bit RGBA (colour type 6), every row filtered None and the
// whole image deflated once (PNG §11–12); a resolution, when given, goes into a pHYs chunk in
// pixels per metre so viewers and print dialogs size the image as plotted. No DOM here.

import { Zlib, zlibSync } from 'fflate';
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

/** The resolution as a pHYs chunk, in pixels per metre. */
function physChunk(dpi: number): Uint8Array {
  const phys = new Uint8Array(9);
  const ppm = Math.round(dpi / 0.0254);
  const v = new DataView(phys.buffer);
  v.setUint32(0, ppm);
  v.setUint32(4, ppm);
  phys[8] = 1; // the unit is the metre
  return chunk('pHYs', phys);
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
  if (o.dpi !== undefined && o.dpi > 0) parts.push(physChunk(o.dpi));
  parts.push(chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of parts) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * A PNG written a band of rows at a time (M2-39 part 4), for a raster plot too big to hold as one
 * bitmap: each band is filtered and pushed through one zlib stream, whose output becomes IDAT
 * chunks as it comes (PNG §12.11 lets the image data span any number of them), so only the
 * compressed file and one band are in memory. Same format as `encodePng`: 8-bit RGBA, filter None.
 */
export class PngWriter {
  readonly #width: number;
  readonly #height: number;
  readonly #parts: Uint8Array[] = [];
  readonly #zlib: Zlib;
  #rows = 0;
  #done: Uint8Array | undefined;

  constructor(width: number, height: number, o: PngOptions = {}) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
      throw new RangeError(`a PNG cannot be ${width} × ${height} pixels`);
    }
    // PNG §11.2.2: each side at most 2^31 − 1.
    if (width > 0x7fffffff || height > 0x7fffffff) {
      throw new RangeError(`a PNG cannot be ${width} × ${height} pixels`);
    }
    this.#width = width;
    this.#height = height;
    const ihdr = new Uint8Array(13);
    const h = new DataView(ihdr.buffer);
    h.setUint32(0, width);
    h.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    this.#parts.push(Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr));
    if (o.dpi !== undefined && o.dpi > 0) this.#parts.push(physChunk(o.dpi));
    this.#zlib = new Zlib({ level: 6 });
    this.#zlib.ondata = (data) => {
      if (data.length > 0) this.#parts.push(chunk('IDAT', data));
    };
  }

  /** The next band: `p.width` must be the image's, `p.height` its rows, top first. */
  rows(p: PlotPixels): void {
    if (this.#done) throw new Error('the PNG is already finished');
    const { width, height } = p;
    if (width !== this.#width || !(height > 0) || p.data.length < width * height * 4) {
      throw new RangeError(`a band of ${this.#width}-pixel rows cannot be ${width} × ${height}`);
    }
    if (this.#rows + height > this.#height) {
      throw new RangeError(`the PNG has ${this.#height} rows, not ${this.#rows + height}`);
    }
    const row = width * 4 + 1;
    const raw = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) {
      const from = y * width * 4;
      // Filter type 0 (None) leads each row.
      if (p.data instanceof Uint8Array || p.data instanceof Uint8ClampedArray) {
        raw.set(p.data.subarray(from, from + width * 4), y * row + 1);
      } else {
        for (let i = 0; i < width * 4; i++) raw[y * row + 1 + i] = p.data[from + i]!;
      }
    }
    this.#rows += height;
    this.#zlib.push(raw, this.#rows === this.#height);
  }

  /** The file, once every row has been given. */
  end(): Uint8Array {
    if (this.#done) return this.#done;
    if (this.#rows !== this.#height) {
      throw new RangeError(`the PNG has ${this.#height} rows; ${this.#rows} were given`);
    }
    this.#parts.push(chunk('IEND', new Uint8Array(0)));
    const out = new Uint8Array(this.#parts.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.#parts) {
      out.set(c, at);
      at += c.length;
    }
    this.#parts.length = 0;
    this.#done = out;
    return out;
  }
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
