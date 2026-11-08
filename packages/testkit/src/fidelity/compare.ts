// Golden-image comparison for the fidelity harness (M1-24, TESTING.md §4). The references are
// Triya's own reviewed renders (DEC-047); a render passes when pixelmatch (threshold 0.1, its
// anti-aliasing detection on) finds at most `tolerance.pixelMismatch` % of pixels different
// AND the mean SSIM is at least `tolerance.ssim`. Both numbers come from the file's corpus.json
// entry, which a PR may only tighten.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** RGBA pixels, row by row from the top. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface Tolerance {
  /** Percentage of pixels allowed to differ. */
  readonly pixelMismatch: number;
  /** Lowest mean SSIM allowed. */
  readonly ssim: number;
}

/** A rectangle of the image, in pixels. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Comparison {
  readonly pass: boolean;
  readonly mismatchPct: number;
  readonly ssim: number;
  /** Why it failed; empty when it passed. */
  readonly reason: string;
  /** Where the differing pixels are, merged into boxes, top to bottom. */
  readonly regions: readonly Region[];
  /** pixelmatch's diff picture: the golden faded to grey, differences in red. */
  readonly diffPng?: Uint8Array | undefined;
}

/** pixelmatch's colour sensitivity, as TESTING.md §4 fixes it. */
const THRESHOLD = 0.1;
/** The colour pixelmatch paints a differing pixel in the diff picture (its default). */
const DIFF_RGB = [255, 0, 0] as const;
/** Cell size the differing pixels are grouped by before boxes are merged. */
const REGION_CELL = 32;

export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function encodePng(r: Raster): Uint8Array {
  const png = new PNG({ width: r.width, height: r.height });
  Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength).copy(png.data);
  return new Uint8Array(PNG.sync.write(png, { colorType: 6 }));
}

export function compareImages(actual: Raster, golden: Raster, tol: Tolerance): Comparison {
  if (actual.width !== golden.width || actual.height !== golden.height) {
    return {
      pass: false,
      mismatchPct: 100,
      ssim: 0,
      reason: `size ${actual.width}×${actual.height}, golden ${golden.width}×${golden.height}`,
      regions: [],
    };
  }
  const { width, height } = actual;
  const out = new Uint8Array(width * height * 4);
  const count = pixelmatch(actual.data, golden.data, out, width, height, { threshold: THRESHOLD });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    if (out[p] === DIFF_RGB[0] && out[p + 1] === DIFF_RGB[1] && out[p + 2] === DIFF_RGB[2]) {
      mask[i] = 1;
    }
  }
  const mismatchPct = (count / (width * height)) * 100;
  const s = ssim(actual, golden);
  const reasons: string[] = [];
  if (mismatchPct > tol.pixelMismatch) {
    reasons.push(`pixel mismatch ${mismatchPct.toFixed(3)} % > ${tol.pixelMismatch} %`);
  }
  if (s < tol.ssim) reasons.push(`SSIM ${s.toFixed(4)} < ${tol.ssim}`);
  return {
    pass: reasons.length === 0,
    mismatchPct,
    ssim: s,
    reason: reasons.join('; '),
    regions: diffRegions(mask, width, height, REGION_CELL),
    diffPng: count > 0 ? encodePng({ width, height, data: out }) : undefined,
  };
}

/**
 * Mean structural similarity (Wang et al. 2004) of the two images' luma, over 8×8 windows
 * every 4 pixels, with the usual constants for 8-bit samples. 1 means identical.
 */
export function ssim(a: Raster, b: Raster): number {
  const { width, height } = a;
  const la = luma(a);
  const lb = luma(b);
  const win = Math.min(8, width, height);
  const step = Math.max(1, win >> 1);
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const n = win * win;
  let sum = 0;
  let windows = 0;
  for (let y0 = 0; y0 + win <= height; y0 += step) {
    for (let x0 = 0; x0 + win <= width; x0 += step) {
      let sa = 0;
      let sb = 0;
      for (let y = y0; y < y0 + win; y++) {
        for (let x = x0; x < x0 + win; x++) {
          sa += la[y * width + x]!;
          sb += lb[y * width + x]!;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let y = y0; y < y0 + win; y++) {
        for (let x = x0; x < x0 + win; x++) {
          const da = la[y * width + x]! - ma;
          const db = lb[y * width + x]! - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n - 1 || 1;
      vb /= n - 1 || 1;
      cov /= n - 1 || 1;
      sum += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      windows++;
    }
  }
  return windows === 0 ? 1 : sum / windows;
}

function luma(r: Raster): Float64Array {
  const out = new Float64Array(r.width * r.height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    // Composited over black, as the canvas screenshot always is opaque.
    const alpha = r.data[p + 3]! / 255;
    out[i] = alpha * (0.299 * r.data[p]! + 0.587 * r.data[p + 1]! + 0.114 * r.data[p + 2]!);
  }
  return out;
}

/**
 * Boxes around the set pixels of `mask`: the image is cut into `cell`-pixel squares, squares
 * holding a set pixel are joined with their eight neighbours, and each group becomes its
 * bounding box (clipped to the image). Sorted top to bottom, then left to right.
 */
export function diffRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number,
): Region[] {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hit = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) hit[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes: Region[] = [];
  for (let start = 0; start < hit.length; start++) {
    if (!hit[start] || seen[start]) continue;
    let [c0, r0, c1, r1] = [cols, rows, -1, -1];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const c = i % cols;
      const r = Math.floor(i / cols);
      [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const j = nr * cols + nc;
          if (hit[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const x = c0 * cell;
    const y = r0 * cell;
    boxes.push({
      x,
      y,
      width: Math.min((c1 + 1) * cell, width) - x,
      height: Math.min((r1 + 1) * cell, height) - y,
    });
  }
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The file name of one space's golden image: `model` for model space, `layout-<name>` for a
 * layout, with the name's characters outside `[A-Za-z0-9.-]` spelled so that no two layout
 * names share a file (a space becomes `_`, anything else `~` and its code point in hex).
 */
export function spaceSlug(space: string): string {
  if (space.toLowerCase() === 'model') return 'model';
  let out = '';
  for (const ch of space) {
    if (/[A-Za-z0-9.-]/.test(ch)) out += ch;
    else if (ch === ' ') out += '_';
    else out += `~${ch.codePointAt(0)!.toString(16)}`;
  }
  return `layout-${out}`;
}

/**
 * Where the golden image of `space` in corpus file `file` lives, relative to `corpus/`:
 * `public/refs/golden/<the file's path below public/third-party or public>/<space>.png`, and
 * for a private file `private/refs/golden/<the file's path below private>/<space>.png`, beside
 * the private files and as gitignored as they are (M1-106).
 */
export function goldenPath(file: string, space: string): string {
  const root = file.startsWith('private/') ? 'private' : 'public';
  const rest = file.replace(/^(public\/(third-party\/)?|private\/)/, '');
  return `${root}/refs/golden/${rest}/${spaceSlug(space)}.png`;
}
