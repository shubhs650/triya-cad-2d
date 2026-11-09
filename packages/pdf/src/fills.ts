// What a plot fills with besides a solid colour (M2-16 part 2):
// - The plot style fill styles (Plot Style Table Editor, "Fill style": Checkerboard,
//   Crosshatch, Diamonds, Horizontal Bars, Slant Left, Slant Right, Square Dots, Vertical
//   Bars). AutoCAD names them and publishes no geometry, so the cells are ours: a 6 pt
//   (about 2 mm) square repeated on the paper, lines 1 pt wide and bars 2 pt, drawn as PDF
//   uncoloured tiling patterns (§8.7.3.3), so one pattern serves every colour and every
//   object's pattern lines up with its neighbours' as a plotter's screen would.
// - Gradient fills as axial and radial shadings (§8.7.4.5.3–4) whose functions interpolate
//   the ramp's stops in sRGB, as the canvas does.
// - Raster images as image XObjects (§8.9.5): 8-bit RGB, or grey when every pixel is, with
//   their alpha as a soft mask when any pixel is not opaque.
// No DOM here.

import { zlibSync } from 'fflate';
import { pdfNumber, type Rgb } from './content';

export type FillStyle =
  | 'checkerboard'
  | 'crosshatch'
  | 'diamonds'
  | 'horizontalBars'
  | 'slantLeft'
  | 'slantRight'
  | 'squareDots'
  | 'verticalBars';

/** The pattern cell's size, points. */
export const FILL_CELL = 6;

/** Lines of slope ±1 through the cell's corners and its neighbours', so the tiles join. */
const slants = (dir: 1 | -1, width: number): string => {
  const s = FILL_CELL;
  const lines = [-s, 0, s].map((k) =>
    dir === 1 ? `${k - 1} -1 m ${k + s + 1} ${s + 1} l` : `${k - 1} ${s + 1} m ${k + s + 1} -1 l`,
  );
  return `${width} w 0 J ${lines.join(' ')} S`;
};

/** Each fill style's cell, as content stream operators that set no colour. */
export const FILL_STYLES: Readonly<Record<FillStyle, string>> = {
  checkerboard: `0 0 3 3 re 3 3 3 3 re f`,
  crosshatch: `0 0 6 1 re 0 0 1 6 re f`,
  diamonds: `${slants(1, 0.75)} ${slants(-1, 0.75)}`,
  horizontalBars: `0 0 6 2 re f`,
  slantLeft: slants(-1, 1),
  slantRight: slants(1, 1),
  squareDots: `2 2 2 2 re f`,
  verticalBars: `0 0 2 6 re f`,
};

export interface GradientStop {
  /** Along the ramp, 0–1. */
  readonly offset: number;
  readonly color: Rgb;
}

const isGray = (c: Rgb) => c[0] === c[1] && c[1] === c[2];

/** A colour as function output in the shading's colour space. */
const components = (c: Rgb, gray: boolean): string =>
  `[${(gray ? [c[0]] : [...c]).map((v) => pdfNumber(Math.min(255, Math.max(0, v)) / 255)).join(' ')}]`;

/**
 * The shading's colour space and its function over [0, 1]: one exponential interpolation per
 * pair of neighbouring stops, stitched when there are more than two. The ends hold the first
 * and last stops' colours, as a canvas gradient pads them.
 */
export function gradientFunction(stops: readonly GradientStop[]): {
  readonly colorSpace: string;
  readonly fn: string;
} {
  if (stops.length === 0) throw new RangeError('a gradient needs a stop');
  const sorted = [...stops]
    .map((s) => ({ offset: Math.min(1, Math.max(0, s.offset)), color: s.color }))
    .sort((a, b) => a.offset - b.offset);
  if (sorted[0]!.offset > 0) sorted.unshift({ offset: 0, color: sorted[0]!.color });
  if (sorted[sorted.length - 1]!.offset < 1)
    sorted.push({ offset: 1, color: sorted[sorted.length - 1]!.color });
  const gray = sorted.every((s) => isGray(s.color));
  const pieces: string[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    pieces.push(
      `<< /FunctionType 2 /Domain [0 1] /C0 ${components(sorted[i]!.color, gray)} /C1 ${components(
        sorted[i + 1]!.color,
        gray,
      )} /N 1 >>`,
    );
  }
  const colorSpace = gray ? '/DeviceGray' : '/DeviceRGB';
  if (pieces.length === 1) return { colorSpace, fn: pieces[0]! };
  const bounds = sorted.slice(1, -1).map((s) => pdfNumber(s.offset));
  const encode = pieces.map(() => '0 1').join(' ');
  return {
    colorSpace,
    fn: `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.join(' ')}] /Bounds [${bounds.join(
      ' ',
    )}] /Encode [${encode}] >>`,
  };
}

/** Straight RGBA, rows top first, as the renderer hands bitmaps over. */
export interface PlotPixels {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface EncodedImage {
  readonly width: number;
  readonly height: number;
  readonly gray: boolean;
  /** Flate-compressed samples. */
  readonly color: Uint8Array;
  /** Flate-compressed alpha, absent when every pixel is opaque. */
  readonly alpha?: Uint8Array;
}

/** A bitmap as image XObject samples. */
export function encodeImage(p: PlotPixels): EncodedImage {
  const count = p.width * p.height;
  if (!(count > 0) || p.data.length < count * 4) {
    throw new RangeError(`a ${p.width} × ${p.height} bitmap needs ${count * 4} bytes`);
  }
  const d = p.data;
  let gray = true;
  let opaque = true;
  for (let i = 0; i < count * 4; i += 4) {
    if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) gray = false;
    if (d[i + 3] !== 255) opaque = false;
  }
  const color = new Uint8Array(gray ? count : count * 3);
  const alpha = opaque ? undefined : new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (gray) color[i] = d[i * 4]!;
    else {
      color[i * 3] = d[i * 4]!;
      color[i * 3 + 1] = d[i * 4 + 1]!;
      color[i * 3 + 2] = d[i * 4 + 2]!;
    }
    if (alpha) alpha[i] = d[i * 4 + 3]!;
  }
  return {
    width: p.width,
    height: p.height,
    gray,
    color: zlibSync(color, { level: 6 }),
    ...(alpha ? { alpha: zlibSync(alpha, { level: 6 }) } : {}),
  };
}
