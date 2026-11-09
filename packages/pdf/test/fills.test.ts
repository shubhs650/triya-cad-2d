// M2-16 part 2: what a plot paints besides strokes and solid fills. Plot style fill styles as
// uncoloured tiling patterns, gradient fills as axial and radial shadings, raster images as
// image XObjects (with a soft mask for their transparent pixels), POINTs as dots and XLINE /
// RAY clipped to the plot area.
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PdfDocument } from '../src/document';
import { FILL_STYLES, type FillStyle } from '../src/fills';
import { POINTS_PER_MM } from '../src/linetypes';
import { IDENTITY, PATH_L, PATH_M, PATH_Z } from '../src/path';
import { plotItems, type PlotItem, type PlotPaint, type PlotPageOptions } from '../src/plot';

const paint: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.5,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};
const square = (x: number, y: number, s: number) => [
  PATH_M,
  x,
  y,
  PATH_L,
  x + s,
  y,
  PATH_L,
  x + s,
  y + s,
  PATH_L,
  x,
  y + s,
  PATH_Z,
];

function plot(items: readonly PlotItem[], o: Partial<PlotPageOptions> = {}) {
  const doc = new PdfDocument({ compress: false });
  const page = doc.addPage(200, 100);
  plotItems(page, items, { toPaper: IDENTITY, ...o });
  const lines = page.content.toString().trimEnd().split('\n');
  const file = Buffer.from(doc.bytes()).toString('latin1');
  return { lines, file, page, doc };
}

/** The objects of an uncompressed file by number, dictionaries with their stream text. */
function objects(file: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of file.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) out.set(Number(m[1]), m[2]!);
  return out;
}

describe('plot style fill styles (M2-16 part 2)', () => {
  it('lists the eight patterned fill styles of the Plot Style Table Editor', () => {
    expect(Object.keys(FILL_STYLES)).toEqual([
      'checkerboard',
      'crosshatch',
      'diamonds',
      'horizontalBars',
      'slantLeft',
      'slantRight',
      'squareDots',
      'verticalBars',
    ]);
  });

  it('fills with an uncoloured tiling pattern in the object’s colour', () => {
    const { lines, file } = plot([
      {
        kind: 'fill',
        path: square(10, 10, 20),
        paint: { ...paint, color: [255, 0, 0], fillStyle: 'crosshatch' },
      },
    ]);
    expect(lines).toContain('/CsPrgb cs 1 0 0 /Pcrosshatch scn');
    expect(lines).toContain('f');
    expect(file).toMatch(/\/ColorSpace << \/CsPrgb \[\/Pattern \/DeviceRGB\] >>/);
    expect(file).toMatch(/\/Pattern << \/Pcrosshatch \d+ 0 R >>/);
    const pattern = [...objects(file).values()].find((o) => o.includes('/PatternType 1'))!;
    expect(pattern).toMatch(/\/PaintType 2 \/TilingType 1/);
    expect(pattern).toMatch(/\/XStep 6 \/YStep 6/);
    // Uncoloured: the cell sets no colour of its own.
    const cell = pattern.slice(pattern.indexOf('stream\n'));
    expect(cell).not.toMatch(/ (rg|RG|g|G|scn|SCN|sc|SC|cs|CS)$/m);
  });

  it('keeps a grey fill in DeviceGray and a solid fill style plain', () => {
    const { lines, file } = plot([
      { kind: 'fill', path: square(0, 0, 5), paint: { ...paint, fillStyle: 'squareDots' } },
      { kind: 'fill', path: square(0, 0, 5), paint: { ...paint, fillStyle: 'solid' } },
    ]);
    expect(lines).toContain('/CsPg cs 0 /PsquareDots scn');
    expect(lines).toContain('0 g');
    expect(file).not.toMatch(/DeviceRGB/);
  });

  it('writes one pattern per style a page uses, each cell different', () => {
    const styles = Object.keys(FILL_STYLES) as FillStyle[];
    const items: PlotItem[] = [...styles, ...styles].map((fillStyle, i) => ({
      kind: 'fill',
      path: square(i * 10, 0, 8),
      paint: { ...paint, fillStyle },
    }));
    const { file } = plot(items);
    const patterns = [...objects(file).values()].filter((o) => o.includes('/PatternType 1'));
    expect(patterns).toHaveLength(8);
    expect(new Set(patterns.map((p) => p.slice(p.indexOf('stream'))))).toHaveProperty('size', 8);
  });
});

describe('gradient fills', () => {
  const frame = { a: 40, b: 0, c: 0, d: 40, e: 10, f: 20 };

  it('paints an axial shading through the frame, clipped to the fill', () => {
    const { lines, file } = plot([
      {
        kind: 'fill',
        path: square(10, 20, 40),
        evenOdd: true,
        paint,
        gradient: {
          kind: 'linear',
          frame,
          stops: [
            { offset: 0, color: [255, 0, 0] },
            { offset: 1, color: [0, 0, 255] },
          ],
        },
      },
    ]);
    const at = lines.indexOf('W* n');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at + 1, at + 4)).toEqual(['40 0 0 40 10 20 cm', '/Sh1 sh', 'Q']);
    expect(lines[lines.lastIndexOf('q', at)]).toBe('q');
    expect(file).toMatch(
      /\/ShadingType 2 \/ColorSpace \/DeviceRGB \/Coords \[0 0 1 0\] \/Function << \/FunctionType 2 \/Domain \[0 1\] \/C0 \[1 0 0\] \/C1 \[0 0 1\] \/N 1 >> \/Extend \[true true\]/,
    );
  });

  it('stitches a ramp of more stops and pads its ends; radial is ShadingType 3', () => {
    const { file } = plot([
      {
        kind: 'fill',
        path: square(10, 20, 40),
        paint,
        gradient: {
          kind: 'radial',
          frame,
          stops: [
            { offset: 0.25, color: [0, 0, 0] },
            { offset: 0.5, color: [255, 255, 255] },
            { offset: 0.75, color: [0, 0, 0] },
          ],
        },
      },
    ]);
    expect(file).toMatch(/\/ShadingType 3 \/ColorSpace \/DeviceGray \/Coords \[0 0 0 0 0 1\]/);
    expect(file).toMatch(/\/FunctionType 3 \/Domain \[0 1\] \/Functions \[/);
    expect(file).toMatch(/\/Bounds \[0.25 0.5 0.75\] \/Encode \[0 1 0 1 0 1 0 1\]/);
  });

  it('fills a degenerate frame with its first colour', () => {
    const { lines } = plot([
      {
        kind: 'fill',
        path: square(0, 0, 5),
        paint,
        gradient: {
          kind: 'linear',
          frame: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
          stops: [{ offset: 0, color: [0, 255, 0] }],
        },
      },
    ]);
    expect(lines).toContain('0 1 0 rg');
    expect(lines).not.toContain('/Sh1 sh');
  });
});

describe('raster images', () => {
  // 2 × 1 pixels: opaque red, half-transparent blue.
  const pixels = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) };
  const image = { pixels, frame: { a: 10, b: 0, c: 0, d: -10, e: 0, f: 10 }, width: 2, height: 1 };

  it('draws the bitmap through its frame, clipped to the fill', () => {
    const { lines } = plot([{ kind: 'fill', path: square(0, 0, 20), paint, image }]);
    const at = lines.indexOf('W n');
    // Unit square → bitmap (y down, layout size 2 × 1) → world.
    expect(lines.slice(at + 1, at + 4)).toEqual(['20 0 0 10 0 0 cm', '/Im1 Do', 'Q']);
  });

  it('writes RGB with an 8-bit soft mask for the alpha, Flate compressed', () => {
    const { file } = plot([{ kind: 'fill', path: square(0, 0, 20), paint, image }]);
    const o = objects(file);
    const im = [...o.values()].find((v) => v.includes('/Subtype /Image /Width 2'))!;
    expect(im).toMatch(/\/ColorSpace \/DeviceRGB \/BitsPerComponent 8/);
    const smask = Number(/\/SMask (\d+) 0 R/.exec(im)![1]);
    expect(o.get(smask)).toMatch(/\/ColorSpace \/DeviceGray/);
    const raw = (dict: string) => {
      const start = file.indexOf(dict) + dict.length;
      const body = file.slice(file.indexOf('stream\n', start) + 7);
      const len = Number(/\/Length (\d+)/.exec(dict)![1]);
      return [...inflateSync(Buffer.from(body.slice(0, len), 'latin1'))];
    };
    expect(raw(im.slice(0, im.indexOf('stream')))).toEqual([255, 0, 0, 0, 0, 255]);
    const mask = o.get(smask)!;
    expect(raw(mask.slice(0, mask.indexOf('stream')))).toEqual([255, 128]);
  });

  it('writes an opaque grey bitmap as DeviceGray without a mask, once per page', () => {
    const grey = { width: 1, height: 1, data: new Uint8Array([90, 90, 90, 255]) };
    const one = { ...image, pixels: grey, width: 1 };
    const { lines, file } = plot([
      { kind: 'fill', path: square(0, 0, 5), paint, image: one },
      { kind: 'fill', path: square(5, 0, 5), paint, image: one },
    ]);
    expect(lines.filter((l) => l === '/Im1 Do')).toHaveLength(2);
    const images = [...objects(file).values()].filter((v) => v.includes('/Subtype /Image'));
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(/\/ColorSpace \/DeviceGray/);
    expect(images[0]).not.toMatch(/SMask/);
  });

  it('stretches a bitmap of another size to the layout size', () => {
    const { lines } = plot([
      { kind: 'fill', path: square(0, 0, 20), paint, image: { ...image, width: 4, height: 2 } },
    ]);
    // The frame's top edge stays at y = 10; the bitmap spans 4 × 2 of its 10-unit pixels.
    expect(lines).toContain('40 0 0 20 0 -10 cm');
  });
});

describe('points and infinite lines', () => {
  it('plots a point as a round dot of its lineweight, at least 0.25 mm', () => {
    const { lines } = plot([
      { kind: 'point', x: 5, y: 6, paint: { ...paint, color: [255, 0, 0] } },
      { kind: 'point', x: 7, y: 8, paint: { ...paint, lineweight: 0 } },
    ]);
    const r = (mm: number) => (mm * POINTS_PER_MM) / 2;
    const n = (v: number) => v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    // A filled circle: four quarter cubics from the rightmost point, closed.
    const red = lines.indexOf('1 0 0 rg');
    expect(lines[red + 1]).toBe(`${n(5 + r(0.5))} 6 m`);
    expect(lines.slice(red + 2, red + 6).every((l) => / c$/.test(l))).toBe(true);
    expect(lines[red + 2]).toMatch(new RegExp(` 5 ${n(6 + r(0.5)).replace('.', '\\.')} c$`));
    expect(lines.slice(red + 6, red + 8)).toEqual(['h', 'f']);
    expect(lines).toContain(`${n(7 + r(0.25))} 8 m`);
  });

  it('clips an XLINE to the page and a RAY from its base', () => {
    const { lines } = plot([
      { kind: 'infinite', base: { x: 50, y: 50 }, direction: { x: 1, y: 0 }, both: true, paint },
      { kind: 'infinite', base: { x: 50, y: 50 }, direction: { x: 0, y: 2 }, both: false, paint },
    ]);
    const text = lines.join('\n');
    expect(text).toContain('0 50 m\n200 50 l\nS');
    expect(text).toContain('50 50 m\n50 100 l\nS');
  });

  it('clips to the plot area, and plots nothing of a line that misses it', () => {
    const area = { x: 10, y: 10, width: 50, height: 50 };
    const { lines } = plot(
      [
        { kind: 'infinite', base: { x: 0, y: 0 }, direction: { x: 1, y: 1 }, both: true, paint },
        { kind: 'infinite', base: { x: 0, y: 90 }, direction: { x: 1, y: 0 }, both: true, paint },
        {
          kind: 'infinite',
          base: { x: 30, y: 30 },
          direction: { x: -1, y: 0 },
          both: false,
          paint,
        },
      ],
      { area },
    );
    const text = lines.join('\n');
    expect(text).toContain('10 10 m\n60 60 l\nS');
    expect(text).not.toMatch(/ 90 [ml]$/m);
    expect(text).toContain('30 30 m\n10 30 l\nS');
  });

  it('dashes an XLINE with its linetype laid out from the base point, in world units', () => {
    // 2:1 plot: a 5-unit dash, 5-unit gap pattern is 10 and 10 points on paper.
    const { lines } = plot(
      [
        {
          kind: 'infinite',
          base: { x: 0, y: 25 },
          direction: { x: 1, y: 0 },
          both: true,
          paint,
          dashes: { lengths: [5, -5], period: 10 },
        },
      ],
      { toPaper: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
    );
    const moves = lines.filter((l) => / m$/.test(l));
    expect(moves.slice(0, 3)).toEqual(['0 50 m', '20 50 m', '40 50 m']);
    expect(moves).toHaveLength(10);
    expect(lines).toContain('10 50 l');
  });

  it('dashes with a plot style linetype from the base point, not the page edge', () => {
    const { lines } = plot([
      {
        kind: 'infinite',
        base: { x: 33, y: 10 },
        direction: { x: 1, y: 0 },
        both: true,
        paint: {
          ...paint,
          linetype: { kind: 'plot', index: 1, adaptive: true, patternSize: 0.5 },
        },
      },
    ]);
    const dash = lines.find((l) => / d$/.test(l))!;
    const m = /^\[([\d. ]+)\] ([\d.]+) d$/.exec(dash)!;
    const period = m[1]!.split(' ').reduce((s, v) => s + Number(v), 0);
    // The pattern is in phase at x = 33: the stroke starts 33 points before it.
    expect((Number(m[2]) + 33) % period).toBeCloseTo(0, 3);
  });
});
