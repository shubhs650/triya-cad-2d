// The Plot dialog's settings (M2-17): AutoCAD's defaults per space, the page they make, and the
// one-page PDF written from plot parts.
import { describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, bundledPlotStyleTable, type PlotPart } from '@triya/render';
import {
  LAYOUT_PAPER,
  PLOT_DEVICES,
  PNG_RESOLUTIONS,
  defaultPlotSettings,
  paperMm,
  plotAreas,
  plotFileName,
  plotPage,
  plotPdf,
  plotPng,
  plotStyleTables,
  plotSvgFile,
  plotTable,
  type PlotSpace,
} from '../src/plot';

const model: PlotSpace = {
  name: 'Model',
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  display: { minX: -50, minY: -50, maxX: 450, maxY: 250 },
  limits: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
};

/** An A3 landscape layout in millimetres, 1:1, paper −5…415 × −5…292. */
const layout: PlotSpace = {
  name: 'Layout1',
  sheet: { paper: { minX: -5, minY: -5, maxX: 415, maxY: 292 }, unitsPerMm: 1 },
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 280 },
};

describe('defaultPlotSettings', () => {
  it('plots model space’s display fitted and centred on A4 landscape, no plot style table', () => {
    const s = defaultPlotSettings(model);
    expect(s).toMatchObject({
      paper: 'ISO A4',
      orientation: 'landscape',
      area: 'display',
      fit: true,
      center: true,
      table: '',
      lineweights: true,
      plotStyles: true,
      paperspaceLast: false,
    });
    expect(plotAreas(model)).toEqual(['extents', 'display', 'limits']);
  });

  it('plots a layout’s sheet on its own paper at its page setup’s scale', () => {
    const s = defaultPlotSettings(layout);
    expect(s).toMatchObject({
      paper: LAYOUT_PAPER,
      orientation: 'landscape',
      area: 'layout',
      fit: false,
      scale: { mm: 1, units: 1 },
    });
    expect(paperMm(s, layout)).toEqual({ width: 420, height: 297 });
    const page = plotPage(s, layout);
    expect([page.width, page.height]).toEqual([420, 297]);
    // The sheet's corner at the page's.
    expect(page.toPaper.e).toBeCloseTo(5 * POINTS_PER_MM, 9);
    expect(plotAreas(layout)).toEqual(['layout', 'extents']);
  });

  it('turns an inch page setup into millimetres of paper', () => {
    const inch: PlotSpace = {
      name: 'Sheet',
      sheet: { paper: { minX: 0, minY: 0, maxX: 11, maxY: 8.5 }, unitsPerMm: 1 / 25.4 },
      inches: true,
    };
    const s = defaultPlotSettings(inch);
    // 1 inch = 1 unit, as the dialog shows it.
    expect(s.scale).toEqual({ mm: 25.4, units: 1 });
    const p = paperMm(s, inch);
    expect(p.width).toBeCloseTo(279.4, 9);
    expect(p.height).toBeCloseTo(215.9, 9);
    expect(plotPage(s, inch).scale).toBeCloseTo(25.4, 9);
  });
});

describe('plotPage', () => {
  it('plots A1 at a scale from the paper’s corner', () => {
    const s = {
      ...defaultPlotSettings(model),
      paper: 'ISO A1',
      area: 'extents' as const,
      fit: false,
      center: false,
      scale: { mm: 1, units: 1 },
      offset: { x: 10, y: 20 },
    };
    const page = plotPage(s, model);
    expect([page.width, page.height]).toEqual([841, 594]);
    expect(page.toPaper.e).toBeCloseTo(10 * POINTS_PER_MM, 9);
    expect(page.toPaper.f).toBeCloseTo(20 * POINTS_PER_MM, 9);
  });

  it('says why it cannot plot', () => {
    const none: PlotSpace = { name: 'Model' };
    expect(() => plotPage(defaultPlotSettings(none), none)).toThrow(/nothing to plot/);
    const s = { ...defaultPlotSettings(model), fit: false, scale: { mm: 0, units: 1 } };
    expect(() => plotPage(s, model)).toThrow(/positive/);
  });
});

describe('plot style tables', () => {
  it('lists the CTBs, or the STBs in a named plot style drawing', () => {
    expect(plotStyleTables(model)).toEqual([
      'triya-default.ctb',
      'triya-monochrome.ctb',
      'triya-grayscale.ctb',
    ]);
    expect(plotStyleTables({ ...model, namedPlotStyles: true })).toEqual([
      'triya-default.stb',
      'triya-monochrome.stb',
    ]);
  });

  it('plots with the table only while "Plot with plot styles" is on', () => {
    const s = { ...defaultPlotSettings(model), table: 'triya-monochrome.ctb' };
    expect(plotTable(s)).toBe(bundledPlotStyleTable('triya-monochrome.ctb'));
    expect(plotTable({ ...s, plotStyles: false })).toBeUndefined();
  });
});

/** A one-page US Letter PDF of `content`, Helvetica as /F1. */
function onePagePdf(content: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('plotPdf', () => {
  it('writes one page of the paper’s size, labelled with the space', async () => {
    const parts: PlotPart[] = [
      {
        kind: 'stroke',
        path: [0, 0, 0, 1, 400, 200],
        paint: {
          color: [0, 0, 0],
          screening: 100,
          lineweight: 0.5,
          linetype: { kind: 'object' },
          endStyle: 'round',
          joinStyle: 'round',
          fillStyle: 'solid',
          physicalPen: 0,
          virtualPen: 0,
        },
      },
    ];
    const s = { ...defaultPlotSettings(model), paper: 'ISO A1', area: 'extents' as const };
    const bytes = plotPdf(parts, plotPage(s, model), s, model, 'plan - Model');
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('%PDF-1.7');
    const pdf = await getDocument({ data: bytes }).promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const [, , w, h] = page.view;
    expect(w! / POINTS_PER_MM).toBeCloseTo(841, 3);
    expect(h! / POINTS_PER_MM).toBeCloseTo(594, 3);
    expect(await pdf.getPageLabels()).toEqual(['Model']);
  });

  // M2-16 part 5: a PDF underlay plots its page's own content, its text still text.
  it('copies a PDF underlay’s page from the file supplied, and plots its boundary without one', async () => {
    const file = onePagePdf('BT /F1 48 Tf 72 400 Td (TRIYA) Tj ET 1 0 0 rg 72 72 144 144 re f');
    const paint = {
      color: [0, 0, 0] as const,
      screening: 100,
      lineweight: 0.5,
      linetype: { kind: 'object' as const },
      endStyle: 'round' as const,
      joinStyle: 'round' as const,
      fillStyle: 'solid' as const,
      physicalPen: 0,
      virtualPen: 0,
    };
    const parts: PlotPart[] = [
      {
        kind: 'fill',
        path: [0, 0, 0, 1, 400, 0, 1, 400, 200, 4],
        paint,
        underlay: {
          definition: '9A',
          fileName: '..\\plans\\PDF-UNDERLAY.PDF',
          page: '1',
          frame: { a: 25.4, b: 0, c: 0, d: 25.4, e: 0, f: 0 },
          clipped: true,
          contrast: 100,
          fade: 0,
          monochrome: false,
        },
      },
    ];
    const s = { ...defaultPlotSettings(model), paper: 'ISO A3', area: 'extents' as const };
    const read = async (bytes: Uint8Array) => {
      const page = await (await getDocument({ data: bytes }).promise).getPage(1);
      const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : ''));
      return { text, ops: (await page.getOperatorList()).fnArray };
    };
    const files = new Map([['pdf-underlay.pdf', file]]);
    const shown = await read(
      plotPdf(parts, plotPage(s, model), s, model, 'plan - Model', (f) =>
        files.get(f.split(/[\\/]/).pop()!.toLowerCase()),
      ),
    );
    expect(shown.text).toContain('TRIYA');
    expect(shown.ops).toContain(OPS.paintFormXObjectBegin);
    const missing = await read(plotPdf(parts, plotPage(s, model), s, model, 'plan - Model'));
    expect(missing.text).toEqual([]);
    expect(missing.ops).not.toContain(OPS.paintFormXObjectBegin);
    expect(missing.ops).toContain(OPS.constructPath);
  });

  it('names the file after the drawing and the space', () => {
    expect(plotFileName('plan.dxf', layout)).toBe('plan-Layout1.pdf');
    expect(plotFileName('a/b.dwg', { name: 'X:1' })).toBe('a_b-X_1.pdf');
  });
});

// M2-18: the Triya SVG and Triya PNG plotters plot the same parts with the same settings.
describe('plotting to SVG and PNG', () => {
  const part = (layer: string): PlotPart => ({
    kind: 'stroke',
    path: [0, 0, 0, 1, 400, 200],
    layer,
    paint: {
      color: [255, 0, 0],
      screening: 100,
      lineweight: 0.5,
      linetype: { kind: 'object' },
      endStyle: 'round',
      joinStyle: 'round',
      fillStyle: 'solid',
      physicalPen: 0,
      virtualPen: 0,
    },
  });

  it('lists the three plotters, PDF first, and opens on the PDF one at 150 dpi on white', () => {
    expect(PLOT_DEVICES.map((d) => d.name)).toEqual([
      'Triya PDF (vector, to file)',
      'Triya SVG (vector, to file)',
      'Triya PNG (raster, to file)',
    ]);
    expect(defaultPlotSettings(model)).toMatchObject({
      device: 'pdf',
      dpi: 150,
      background: 'white',
    });
    expect(PNG_RESOLUTIONS).toContain(300);
  });

  it('writes an SVG of the paper’s size with the drawing layers as Inkscape layers', () => {
    const s = {
      ...defaultPlotSettings(model),
      device: 'svg' as const,
      paper: 'ISO A3',
      area: 'extents' as const,
      background: 'none' as const,
    };
    const svg = plotSvgFile(
      [part('Walls'), part('Doors')],
      plotPage(s, model),
      s,
      model,
      'plan - Model',
    );
    expect(svg).toContain('width="420mm" height="297mm"');
    expect(svg).toContain('<title>plan - Model</title>');
    expect([...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'Walls',
      'Doors',
    ]);
    expect(svg).not.toContain('<rect width');
    const white = plotSvgFile([], plotPage(s, model), { ...s, background: 'white' }, model, 't');
    expect(white).toContain('fill="#ffffff"');
  });

  it('rasterises the SVG at the resolution asked for and records it in the PNG', async () => {
    const s = { ...defaultPlotSettings(model), device: 'png' as const, paper: 'ISO A4', dpi: 100 };
    const seen: { svg: string; o: { width: number; height: number; background?: string } }[] = [];
    const png = await plotPng(
      [part('0')],
      plotPage(s, model),
      s,
      model,
      'plan - Model',
      async (svg, o) => {
        seen.push({ svg, o });
        return {
          width: o.width,
          height: o.height,
          data: new Uint8ClampedArray(o.width * o.height * 4),
        };
      },
    );
    // A4 landscape at 100 dpi: 297 / 25.4 × 100 by 210 / 25.4 × 100.
    expect(seen[0]!.o).toEqual({ width: 1169, height: 827, background: '#ffffff' });
    expect(seen[0]!.svg).toContain('inkscape:label="0"');
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1169, 827]);
    // pHYs right after IHDR: 100 dpi = 3937 pixels per metre.
    expect(view.getUint32(41)).toBe(3937);
    await plotPng(
      [],
      plotPage(s, model),
      { ...s, background: 'none' },
      model,
      't',
      async (_svg, o) => {
        expect(o.background).toBeUndefined();
        return {
          width: o.width,
          height: o.height,
          data: new Uint8ClampedArray(o.width * o.height * 4),
        };
      },
    );
  });

  it('names the file by the plotter', () => {
    expect(plotFileName('plan.dxf', layout, 'svg')).toBe('plan-Layout1.svg');
    expect(plotFileName('plan.dxf', layout, 'png')).toBe('plan-Layout1.png');
  });
});
