import { describe, expect, it } from 'vitest';
import { POINTS_PER_MM } from '../src/linetypes';
import { PATH_L, PATH_M, PATH_Z } from '../src/path';
import type { PlotItem, PlotPaint, PlotPathItem, PlotUnderlay } from '../src/plot';
import { plotSvg, underlayRasterPlan, type SvgPlotOptions } from '../src/svg';

const paint: PlotPaint = {
  color: [255, 0, 0],
  lineweight: 0.5,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const line = (x0: number, y0: number, x1: number, y1: number) => [PATH_M, x0, y0, PATH_L, x1, y1];
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
const svg = (items: readonly PlotItem[], o: Partial<SvgPlotOptions> = {}) =>
  plotSvg(items, { toPaper: IDENTITY, width: 100, height: 50, ...o });
/** The labels of the Inkscape layers, in order. */
const layers = (s: string) =>
  [...s.matchAll(/inkscape:groupmode="layer" inkscape:label="([^"]*)"/g)].map((m) => m[1]);

describe('plotSvg', () => {
  it('is as big as the paper in millimetres, in points, with paper y up turned into SVG y down', () => {
    const s = svg([{ kind: 'stroke', path: line(10, 10, 20, 40), paint, layer: 'A' }], {
      title: 'Plot <1>',
    });
    expect(s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg ')).toBe(
      true,
    );
    expect(s).toContain(
      `width="${Math.round((100 / POINTS_PER_MM) * 1000) / 1000}mm" height="${Math.round((50 / POINTS_PER_MM) * 1000) / 1000}mm" viewBox="0 0 100 50"`,
    );
    expect(s).toContain('<title>Plot &lt;1&gt;</title>');
    expect(s).toContain('d="M10 40L20 10"');
    expect(s.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('strokes at the lineweight in points with the ends and joins; lineweight 0 one pixel wide', () => {
    const s = svg([
      { kind: 'stroke', path: line(0, 0, 1, 0), paint },
      {
        kind: 'stroke',
        path: line(0, 0, 1, 0),
        paint: { ...paint, lineweight: 0, endStyle: 'diamond', joinStyle: 'bevel' },
      },
      {
        kind: 'stroke',
        path: line(0, 0, 1, 0),
        paint: { ...paint, endStyle: 'butt', joinStyle: 'miter' },
        opacity: 0.4,
      },
    ]);
    const paths = s.split('\n').filter((l) => l.startsWith('<path'));
    expect(paths[0]).toBe(
      `<path d="M0 50L1 50" fill="none" stroke="#ff0000" stroke-width="${Math.round(0.5 * POINTS_PER_MM * 1000) / 1000}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    expect(paths[1]).toContain(
      'stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="square" stroke-linejoin="bevel"',
    );
    expect(paths[2]).not.toContain('stroke-linecap');
    expect(paths[2]).not.toContain('stroke-linejoin');
    expect(paths[2]).toContain('opacity="0.4"');
  });

  it('plots everything thinnest with object lineweights off', () => {
    expect(
      svg([{ kind: 'stroke', path: line(0, 0, 1, 0), paint }], { lineweights: false }),
    ).toContain('vector-effect="non-scaling-stroke"');
  });

  it('dashes a plot style linetype, each subpath on its own when adaptive', () => {
    const dashed: PlotPaint = {
      ...paint,
      linetype: { kind: 'plot', index: 2, adaptive: false, patternSize: 6 },
    };
    const plain = svg([{ kind: 'stroke', path: line(0, 0, 50, 0), paint: dashed }]);
    expect(plain).toMatch(/stroke-dasharray="[\d. ]+"/);
    const two = [...line(0, 0, 50, 0), ...line(0, 10, 23, 10)];
    const adaptive = svg([
      {
        kind: 'stroke',
        path: two,
        paint: { ...dashed, linetype: { ...dashed.linetype, adaptive: true } } as PlotPaint,
      },
    ]);
    const arrays = [...adaptive.matchAll(/stroke-dasharray="([^"]+)"/g)].map((m) => m[1]);
    expect(arrays).toHaveLength(2);
    expect(arrays[0]).not.toBe(arrays[1]);
  });

  it('puts each drawing layer in an Inkscape layer, keeping the plot order', () => {
    const s = svg([
      { kind: 'stroke', path: line(0, 0, 10, 0), paint, layer: 'Walls' },
      { kind: 'stroke', path: line(0, 5, 10, 5), paint, layer: 'Doors & "frames"' },
      // Strokes only between: joins the first Walls layer.
      { kind: 'stroke', path: line(0, 10, 10, 10), paint, layer: 'Walls' },
    ]);
    expect(layers(s)).toEqual(['Walls', 'Doors &amp; &quot;frames&quot;']);
    expect(s).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
    expect(s).toContain('<g id="layer1" inkscape:groupmode="layer"');
  });

  it('starts another group for a layer when moving a part back would pass a fill across it', () => {
    const s = svg([
      { kind: 'stroke', path: line(0, 0, 10, 0), paint, layer: 'Lines' },
      { kind: 'fill', path: square(0, -5, 20), paint, layer: 'Hatch' },
      // Over the fill: must stay above it.
      { kind: 'stroke', path: line(0, 5, 10, 5), paint, layer: 'Lines' },
      // Far from the fill: joins the first Lines group.
      { kind: 'stroke', path: line(60, 40, 70, 40), paint, layer: 'Hatch' },
    ]);
    expect(layers(s)).toEqual(['Lines', 'Hatch', 'Lines']);
  });

  it('clips parts sharing a clip once, each polygon nested, and the plot to its area', () => {
    const clip = [
      [0, 0, 10, 0, 10, 10, 0, 10],
      [2, 2, 8, 2, 8, 8],
    ];
    const s = svg(
      [
        { kind: 'stroke', path: line(0, 0, 10, 10), paint, clip },
        { kind: 'stroke', path: line(0, 10, 10, 0), paint, clip },
      ],
      { area: { x: 5, y: 5, width: 50, height: 20 } },
    );
    expect(s.match(/<clipPath /g)).toHaveLength(3);
    expect(s).toContain('<rect x="5" y="25" width="50" height="20"/>');
    expect(s).toMatch(/<g clip-path="url\(#d\d+\)"><g clip-path="url\(#d\d+\)"><path/);
    expect(s).toContain('<path d="M0 50L10 50L10 40L0 40Z"/>');
    expect(s).toMatch(/inkscape:label="0" stroke-miterlimit="10" clip-path="url\(#d1\)"/);
  });

  it('fills solid, by a fill style pattern laid from the paper corner, and by a gradient', () => {
    const s = svg([
      { kind: 'fill', path: square(0, 0, 10), paint, evenOdd: true },
      { kind: 'fill', path: square(0, 0, 10), paint: { ...paint, fillStyle: 'crosshatch' } },
      { kind: 'fill', path: square(20, 0, 10), paint: { ...paint, fillStyle: 'crosshatch' } },
      {
        kind: 'fill',
        path: square(0, 0, 10),
        paint,
        gradient: {
          kind: 'linear',
          frame: { a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 },
          stops: [
            { offset: 1, color: [0, 0, 255] },
            { offset: 0, color: [255, 255, 0] },
          ],
        },
      },
    ]);
    expect(s).toContain('fill="#ff0000" fill-rule="evenodd"/>');
    // One pattern serves both crosshatched fills.
    expect(s.match(/<pattern /g)).toHaveLength(1);
    expect(s).toContain(
      'patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="matrix(1 0 0 -1 0 50)"><rect x="0" y="0" width="6" height="1" fill="#ff0000"/>',
    );
    expect(s).toContain(
      '<linearGradient id="d2" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(10 0 0 -10 0 50)"><stop offset="0" stop-color="#ffff00"/><stop offset="1" stop-color="#0000ff"/></linearGradient>',
    );
  });

  it('embeds an image as a PNG clipped to its boundary', () => {
    const s = svg([
      {
        kind: 'fill',
        path: square(0, 0, 10),
        paint,
        image: {
          pixels: { width: 1, height: 1, data: [0, 128, 255, 255] },
          frame: { a: 10, b: 0, c: 0, d: -10, e: 0, f: 10 },
          width: 1,
          height: 1,
        },
      },
    ]);
    expect(s).toMatch(
      /<g clip-path="url\(#d1\)"><image width="1" height="1" preserveAspectRatio="none"/,
    );
    expect(s).toContain(
      'transform="matrix(10 0 0 10 0 40)" xlink:href="data:image/png;base64,iVBORw0KGgo',
    );
  });

  it('plots a point as a dot, an XLINE across the plot area, a clipped underlay as its boundary', () => {
    const s = svg([
      { kind: 'point', x: 10, y: 10, paint: { ...paint, lineweight: 1 } },
      {
        kind: 'infinite',
        base: { x: 50, y: 25 },
        direction: { x: 1, y: 0 },
        both: true,
        paint,
      },
      {
        kind: 'fill',
        path: square(0, 0, 10),
        paint,
        underlay: {
          definition: '1A',
          fileName: 'plan.pdf',
          page: '1',
          frame: IDENTITY,
          clipped: true,
          contrast: 100,
          fade: 0,
          monochrome: false,
        },
      },
    ]);
    expect(s).toContain(
      `<circle cx="10" cy="40" r="${Math.round(POINTS_PER_MM * 500) / 1000}" fill="#ff0000"/>`,
    );
    expect(s).toContain('<path d="M0 25L100 25" fill="none"');
    expect(s).toContain('<path d="M0 50L10 50L10 40L0 40Z" fill="none" stroke="#ff0000"');
  });

  // M2-39: an underlay's page content, drawn by the app (pdf.js) as pixels over `region`.
  const underlay: PlotUnderlay = {
    definition: '1A',
    fileName: 'plan.pdf',
    page: '1',
    frame: { a: 10, b: 0, c: 0, d: 10, e: 5, f: 0 },
    clipped: false,
    contrast: 100,
    fade: 0,
    monochrome: false,
  };
  const page = { width: 4, height: 2 };
  const pixels = { width: 2, height: 1, data: [0, 0, 0, 255, 255, 0, 0, 128] };

  it('plots an underlay’s page as its pixels in its frame, with the page edge as its frame', () => {
    const s = svg(
      [
        {
          kind: 'fill',
          path: [],
          paint,
          underlay: { ...underlay, fade: 25 },
          layer: 'U',
          opacity: 0.8,
        },
      ],
      {
        underlayRasters: (u) =>
          u.definition === '1A'
            ? { pixels, region: { minX: 1, minY: 0, maxX: 3, maxY: 2 }, page }
            : undefined,
      },
    );
    // Two pixels across 2 inches and one down 2: (1, 2) in the page is the bitmap's corner, y
    // flipped; then 10 drawing units an inch, 5 across, and paper y down from 50.
    expect(s).toContain(
      '<image width="2" height="1" preserveAspectRatio="none" transform="matrix(10 0 0 20 15 30)" xlink:href="data:image/png;base64,iVBORw0KGgo',
    );
    // Fade 25 % keeps three quarters, times the object's transparency, as the PDF plot does.
    expect(s).toContain('<g opacity="0.6"><image ');
    // Unclipped, the frame is the page's edge, as PDFFRAME 1 plots it.
    expect(s).toContain('<path d="M5 50L45 50L45 30L5 30Z" fill="none" stroke="#ff0000"');
  });

  it('clips an underlay’s pixels to its boundary and frames the boundary', () => {
    const s = svg(
      [
        {
          kind: 'fill',
          path: square(15, 0, 10),
          paint,
          underlay: { ...underlay, clipped: true },
        },
      ],
      { underlayRasters: () => ({ pixels, region: { minX: 1, minY: 0, maxX: 3, maxY: 2 }, page }) },
    );
    expect(s).toContain('<clipPath id="d1"><path d="M15 50L25 50L25 40L15 40Z"/></clipPath>');
    expect(s).toMatch(/<g clip-path="url\(#d1\)"><image width="2" height="1" /);
    expect(s).toContain('<path d="M15 50L25 50L25 40L15 40Z" fill="none" stroke="#ff0000"');
    expect(s).not.toContain('opacity');
  });

  it('plans the part of an underlay’s page a plot shows, at the plot’s resolution', () => {
    const item: PlotPathItem = { kind: 'fill', path: [], paint, underlay };
    const o = { toPaper: { a: 7.2, b: 0, c: 0, d: 7.2, e: 0, f: 0 } };
    // An inch of page is 10 units, 72 points, an inch of paper: 100 dpi draws 100 pixels an inch.
    expect(underlayRasterPlan(item, o, page, 100)).toEqual({
      region: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
      width: 400,
      height: 200,
    });
    // Clipped: the boundary's extent on the page (here 1–2 by 0.5–1.5 inches).
    const clipped: PlotPathItem = {
      ...item,
      path: square(15, 5, 10),
      underlay: { ...underlay, clipped: true },
    };
    expect(underlayRasterPlan(clipped, o, page, 100)).toEqual({
      region: { minX: 1, minY: 0.5, maxX: 2, maxY: 1.5 },
      width: 100,
      height: 100,
    });
    // The plot area cuts it too (paper points 0–144 across: drawing x 0–20, page x up to 1.5).
    const area = { ...o, area: { x: 0, y: 0, width: 144, height: 1000 } };
    expect(underlayRasterPlan(item, area, page, 100)?.region).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1.5,
      maxY: 2,
    });
    // Too many pixels: the resolution drops to fit, the region kept.
    expect(underlayRasterPlan(item, o, page, 100, 20_000)).toEqual({
      region: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
      width: 200,
      height: 100,
    });
    // Nothing of the page on the plot, or a clipped underlay with no boundary: nothing to draw.
    expect(
      underlayRasterPlan(item, { ...o, area: { x: 500, y: 0, width: 10, height: 10 } }, page, 100),
    ).toBeUndefined();
    expect(
      underlayRasterPlan({ ...item, underlay: { ...underlay, clipped: true } }, o, page, 100),
    ).toBeUndefined();
  });

  it('lays a background sheet under the plot only when asked', () => {
    expect(svg([])).not.toContain('<rect');
    expect(svg([], { background: [255, 255, 255] })).toContain(
      '<rect width="100" height="50" fill="#ffffff"/>',
    );
  });
});
