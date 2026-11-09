import { describe, expect, it } from 'vitest';
import { PdfDocument } from '../src/document';
import { POINTS_PER_MM } from '../src/linetypes';
import { PATH_L, PATH_M, PATH_Z } from '../src/path';
import { paperTransform, plotItems, type PlotItem, type PlotPaint } from '../src/plot';

const paint: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0.5,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};
const line = (x0: number, y0: number, x1: number, y1: number) => [PATH_M, x0, y0, PATH_L, x1, y1];
const ops = (items: readonly PlotItem[], o: Partial<Parameters<typeof plotItems>[2]> = {}) => {
  const doc = new PdfDocument();
  const page = doc.addPage(100, 100);
  plotItems(page, items, { toPaper: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, ...o });
  return { lines: page.content.toString().trimEnd().split('\n'), page };
};

describe('plotItems', () => {
  it('strokes at the lineweight in points with the style’s ends and joins', () => {
    const { lines } = ops([{ kind: 'stroke', path: line(0, 0, 10, 0), paint }]);
    expect(lines).toEqual([
      'q',
      '/GSa1000 gs',
      '0 G',
      `${(0.5 * POINTS_PER_MM).toFixed(4)} w`,
      '1 J',
      '1 j',
      '[] 0 d',
      '0 0 m',
      '10 0 l',
      'S',
      'Q',
    ]);
  });

  it('maps PDF-less diamond ends and joins to square ends and miter joins', () => {
    const { lines } = ops([
      {
        kind: 'stroke',
        path: line(0, 0, 1, 0),
        paint: { ...paint, endStyle: 'diamond', joinStyle: 'diamond' },
      },
      {
        kind: 'stroke',
        path: line(0, 0, 1, 0),
        paint: { ...paint, endStyle: 'butt', joinStyle: 'bevel' },
      },
    ]);
    expect(lines.filter((l) => / [Jj]$/.test(l))).toEqual(['2 J', '0 j', '0 J', '2 j']);
  });

  it('plots thinnest with object lineweights off, and scales them when asked', () => {
    expect(
      ops([{ kind: 'stroke', path: line(0, 0, 1, 0), paint }], { lineweights: false }).lines,
    ).toContain('0 w');
    expect(
      ops([{ kind: 'stroke', path: line(0, 0, 1, 0), paint }], { lineweightScale: 2 }).lines,
    ).toContain(`${POINTS_PER_MM.toFixed(4)} w`);
  });

  it('fills with the paper colour and rule, and sets opacity through ExtGState', () => {
    const square = [PATH_M, 0, 0, PATH_L, 1, 0, PATH_L, 1, 1, PATH_Z];
    const { lines, page } = ops([
      {
        kind: 'fill',
        path: square,
        paint: { ...paint, color: [255, 0, 0] },
        evenOdd: true,
        opacity: 0.25,
      },
    ]);
    expect(lines).toEqual([
      'q',
      '/GSa250 gs',
      '1 0 0 rg',
      '0 0 m',
      '1 0 l',
      '1 1 l',
      'h',
      'f*',
      'Q',
    ]);
    expect(page.alphas.get('GSa250')).toBe(0.25);
  });

  it('dashes a plot style linetype, each subpath on its own when adaptive', () => {
    const lt = { kind: 'plot', index: 1, adaptive: false, patternSize: 0.5 } as const;
    const path = [...line(0, 0, 72, 0), ...line(0, 10, 36, 10)];
    const fixed = ops([{ kind: 'stroke', path, paint: { ...paint, linetype: lt } }]).lines;
    expect(fixed).toContain('[27 9] 0 d');
    expect(fixed.filter((l) => l === 'S')).toHaveLength(1);
    const adaptive = ops([
      { kind: 'stroke', path, paint: { ...paint, linetype: { ...lt, adaptive: true } } },
    ]).lines;
    // 72 pt holds two 36 pt repetitions as they are; 36 pt one.
    expect(adaptive.filter((l) => l.endsWith(' d'))).toEqual(['[27 9] 0 d']);
    expect(adaptive.filter((l) => l === 'S')).toHaveLength(2);
    const stretched = ops([
      {
        kind: 'stroke',
        path: line(0, 0, 45, 0),
        paint: { ...paint, linetype: { ...lt, adaptive: true } },
      },
    ]).lines;
    expect(stretched).toContain('[33.75 11.25] 0 d');
  });

  it('clips each run of items sharing XCLIP polygons once, then lifts the clip', () => {
    const clip = [[0, 0, 5, 0, 5, 5, 0, 5]];
    const { lines } = ops([
      { kind: 'stroke', path: line(0, 0, 10, 10), paint, clip },
      { kind: 'stroke', path: line(0, 1, 10, 11), paint, clip },
      { kind: 'stroke', path: line(0, 2, 10, 12), paint },
    ]);
    expect(lines.filter((l) => l === 'W n')).toHaveLength(1);
    expect(lines.slice(1, 8)).toEqual(['q', '0 0 m', '5 0 l', '5 5 l', '0 5 l', 'h', 'W n']);
    expect(lines.filter((l) => l === 'q')).toHaveLength(2);
    expect(lines.filter((l) => l === 'Q')).toHaveLength(2);
    // The third line is drawn after the clip is lifted.
    expect(lines.lastIndexOf('Q') > lines.indexOf('0 2 m')).toBe(true);
    expect(lines.indexOf('0 2 m') > lines.indexOf('Q')).toBe(true);
  });

  it('clips to the printable area and skips empty paths', () => {
    const { lines } = ops([{ kind: 'stroke', path: [], paint }], {
      area: { x: 10, y: 10, width: 80, height: 80 },
    });
    expect(lines).toEqual(['q', '10 10 80 80 re', 'W n', '/GSa1000 gs', 'Q']);
  });
});

describe('paperTransform', () => {
  it('puts a world point at a paper point at a millimetre scale', () => {
    const m = paperTransform(0.01, { x: 1000, y: 2000 }, { x: 36, y: 72 });
    expect(m.a).toBeCloseTo(0.01 * POINTS_PER_MM);
    expect(m.a * 1000 + m.c * 2000 + m.e).toBeCloseTo(36);
    expect(m.b * 1000 + m.d * 2000 + m.f).toBeCloseTo(72);
  });

  it('turns exact quarter turns without rounding noise', () => {
    const m = paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect([m.a, m.b, m.c, m.d]).toEqual([0, POINTS_PER_MM, -POINTS_PER_MM, 0]);
    const t = paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }, 0.3);
    expect(t.a).toBeCloseTo(Math.cos(0.3) * POINTS_PER_MM);
  });
});
