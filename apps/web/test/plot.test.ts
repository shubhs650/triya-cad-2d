// The Plot dialog's settings (M2-17): AutoCAD's defaults per space, the page they make, and the
// one-page PDF written from plot parts.
import { describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, bundledPlotStyleTable, type PlotPart } from '@triya/render';
import type { Layout, LayoutPlot } from '@triya/engine';
import {
  LAYOUT_PAPER,
  PAGE_SETUP_FLAGS,
  PLOT_DEVICES,
  PNG_RESOLUTIONS,
  defaultPlotSettings,
  appliedPageSetup,
  pageSetupOf,
  paperMm,
  missingPlotStyleTable,
  plotAreas,
  plotFileName,
  plotPage,
  plotPdf,
  plotStyleTables,
  plotPng,
  plotPreview,
  plotSvgFile,
  plotTable,
  windowBox,
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
    expect(plotAreas(model)).toEqual(['extents', 'display', 'limits', 'window']);
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
    expect(plotAreas(layout)).toEqual(['layout', 'extents', 'window']);
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
    expect(plotTable(s, model)).toBe(bundledPlotStyleTable('triya-monochrome.ctb'));
    expect(plotTable({ ...s, plotStyles: false }, model)).toBeUndefined();
  });
});

describe('page setups and your own plot style tables (part 3)', () => {
  const { PLOT_STYLES, LINEWEIGHTS, SCALE_LINEWEIGHTS, PAPERSPACE_LAST } = PAGE_SETUP_FLAGS;
  const pens = bundledPlotStyleTable('triya-grayscale.ctb')!;
  const mine = bundledPlotStyleTable('triya-monochrome.ctb')!;

  it('reads the plot style table and plot options of a LAYOUT’s page setup', () => {
    const plot = { styleSheet: 'monochrome.ctb', flags: 688 } as Layout['plot'];
    expect(pageSetupOf({ plot } as Layout)).toMatchObject({
      styleSheet: 'monochrome.ctb',
      flags: 688,
    });
    expect(pageSetupOf({ plot: { flags: 0 } } as Layout)).toMatchObject({
      styleSheet: '',
      flags: 0,
    });
    expect(pageSetupOf({} as Layout)).toBeUndefined();
    expect(pageSetupOf(undefined)).toBeUndefined();
  });

  it('opens on the page setup’s plot style table, AutoCAD’s names answered by the bundled ones', () => {
    const at = (styleSheet: string) =>
      defaultPlotSettings({ ...layout, pageSetup: { styleSheet, flags: PLOT_STYLES } }).table;
    expect(at('monochrome.ctb')).toBe('triya-monochrome.ctb');
    expect(at('C:\\Plot Styles\\acad.ctb')).toBe('triya-default.ctb');
    expect(at('Triya-Grayscale.CTB')).toBe('triya-grayscale.ctb');
    expect(at('')).toBe('');
  });

  it('opens on the page setup’s plot options', () => {
    const on = defaultPlotSettings({
      ...layout,
      pageSetup: {
        styleSheet: '',
        flags: PLOT_STYLES | LINEWEIGHTS | SCALE_LINEWEIGHTS | PAPERSPACE_LAST,
      },
    });
    expect(on).toMatchObject({
      plotStyles: true,
      lineweights: true,
      scaleLineweights: true,
      paperspaceLast: true,
    });
    const off = defaultPlotSettings({ ...layout, pageSetup: { styleSheet: '', flags: 0 } });
    expect(off).toMatchObject({
      plotStyles: false,
      lineweights: false,
      scaleLineweights: false,
      paperspaceLast: false,
    });
    // Model space has no paper space to plot last, nor lineweights to scale with a layout's.
    const m = defaultPlotSettings({
      ...model,
      pageSetup: { styleSheet: '', flags: 0xffff & ~1024 },
    });
    expect(m).toMatchObject({ paperspaceLast: false, scaleLineweights: false, plotStyles: true });
  });

  it('lists your own tables of the drawing’s kind after the bundled ones and plots with them', () => {
    const space: PlotSpace = {
      ...model,
      userTables: new Map([
        ['Pens.ctb', pens],
        ['site.stb', mine],
        ['Architect.ctb', mine],
      ]),
    };
    expect(plotStyleTables(space)).toEqual([
      'triya-default.ctb',
      'triya-monochrome.ctb',
      'triya-grayscale.ctb',
      'Architect.ctb',
      'Pens.ctb',
    ]);
    expect(plotStyleTables({ ...space, namedPlotStyles: true })).toEqual([
      'triya-default.stb',
      'triya-monochrome.stb',
      'site.stb',
    ]);
    const s = { ...defaultPlotSettings(space), table: 'Pens.ctb' };
    expect(plotTable(s, space)).toBe(pens);
    // A page setup naming it, in another case and folder, opens on it.
    const named = defaultPlotSettings({
      ...space,
      pageSetup: { styleSheet: 'D:\\pens.CTB', flags: PLOT_STYLES },
    });
    expect(named.table).toBe('Pens.ctb');
  });

  it('prefers your own table to the bundled one AutoCAD’s name stands for', () => {
    const space: PlotSpace = {
      ...layout,
      userTables: new Map([['monochrome.ctb', mine]]),
      pageSetup: { styleSheet: 'monochrome.ctb', flags: PLOT_STYLES },
    };
    const s = defaultPlotSettings(space);
    expect(s.table).toBe('monochrome.ctb');
    expect(plotTable(s, space)).toBe(mine);
  });

  it('keeps a table this device lacks by name and plots without it', () => {
    const space: PlotSpace = {
      ...layout,
      pageSetup: { styleSheet: 'Site Pens.ctb', flags: PLOT_STYLES },
    };
    const s = defaultPlotSettings(space);
    expect(s.table).toBe('Site Pens.ctb');
    expect(missingPlotStyleTable(s, space)).toBe(true);
    expect(plotTable(s, space)).toBeUndefined();
    // A table of the other kind cannot serve the drawing either.
    const stb = { ...s, table: 'triya-default.stb' };
    expect(missingPlotStyleTable(stb, space)).toBe(true);
    expect(plotTable(stb, space)).toBeUndefined();
    expect(missingPlotStyleTable({ ...s, table: '' }, space)).toBe(false);
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

describe('the Window plot area (part 2)', () => {
  it('plots the window picked, whichever corners came first', () => {
    const window = windowBox({ x: 300, y: 20 }, { x: 100, y: 120 });
    expect(window).toEqual({ minX: 100, minY: 20, maxX: 300, maxY: 120 });
    const s = { ...defaultPlotSettings(model), area: 'window' as const, window };
    const page = plotPage(s, model);
    // 200 × 100 fitted to A4 landscape (297 × 210): 297 / 200 mm per unit.
    expect(page.scale).toBeCloseTo(297 / 200, 9);
  });

  it('has nothing to plot before a window is picked', () => {
    const s = { ...defaultPlotSettings(model), area: 'window' as const };
    expect(() => plotPage(s, model)).toThrow(/nothing to plot/);
  });
});

describe('plotPreview (the partial preview, part 2)', () => {
  it('places the plot area on the paper as it is turned', () => {
    const s = {
      ...defaultPlotSettings(model),
      area: 'extents' as const,
      fit: false,
      center: false,
      offset: { x: 10, y: 5 },
      scale: { mm: 1, units: 2 },
    };
    const p = plotPreview(s, model)!;
    expect([p.width, p.height]).toEqual([297, 210]);
    // 400 × 200 units at 1:2 is 200 × 100 mm, 10 mm right and 5 mm up from the corner.
    expect(p.area.x).toBeCloseTo(10, 9);
    expect(p.area.y).toBeCloseTo(5, 9);
    expect(p.area.width).toBeCloseTo(200, 9);
    expect(p.area.height).toBeCloseTo(100, 9);
    expect(p.offPaper).toBe(false);
    const portrait = plotPreview({ ...s, orientation: 'portrait' }, model)!;
    expect([portrait.width, portrait.height]).toEqual([210, 297]);
  });

  it('says when the plot runs off the paper, as AutoCAD’s red edge does', () => {
    const s = {
      ...defaultPlotSettings(model),
      area: 'extents' as const,
      fit: false,
      center: true,
      scale: { mm: 1, units: 1 },
    };
    const p = plotPreview(s, model)!;
    expect(p.offPaper).toBe(true);
    expect(p.area.width).toBeCloseTo(400, 9);
  });

  it('has no preview when the settings cannot plot', () => {
    expect(plotPreview(defaultPlotSettings({ name: 'Model' }), { name: 'Model' })).toBeUndefined();
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

describe('the rest of the page setup (part 4)', () => {
  /** Model's page setup as AutoCAD's default one: ANSI A fed portrait, landscape, display fitted. */
  const ansi: LayoutPlot = {
    paperSize: 'ANSI_A_(8.50_x_11.00_Inches)',
    paperWidth: 215.9,
    paperHeight: 279.4,
    margins: { left: 6.35, bottom: 6.35, right: 6.35, top: 6.35 },
    paperUnits: 'inches',
    rotation: 1,
    origin: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 2.584895464708373 },
    standardScaleType: 0,
    plotType: 0,
    flags: 11952 | 4,
  };
  const withSetup = (space: PlotSpace, plot: LayoutPlot, inches = false): PlotSpace => ({
    ...space,
    inches,
    pageSetup: { ...pageSetupOf({ handle: '22', plot } as Layout)! },
  });

  it('remembers the layout whose page setup it is', () => {
    expect(pageSetupOf({ handle: '22', plot: ansi } as Layout)).toEqual({
      styleSheet: '',
      flags: ansi.flags,
      layout: '22',
      plot: ansi,
    });
  });

  it('opens model space on its page setup’s paper, area, fit, centring and orientation', () => {
    const space = withSetup(model, ansi, true);
    const s = defaultPlotSettings(space);
    expect(s).toMatchObject({
      // ANSI A is one of the dialog’s papers: listed by its name.
      paper: 'ANSI A',
      orientation: 'landscape',
      upsideDown: false,
      area: 'display',
      fit: true,
      center: true,
    });
    // Rotation 3 (270°) is landscape upside-down; Extents and Limits by their DXF 74 codes.
    expect(defaultPlotSettings(withSetup(model, { ...ansi, rotation: 3 }))).toMatchObject({
      orientation: 'landscape',
      upsideDown: true,
    });
    expect(defaultPlotSettings(withSetup(model, { ...ansi, plotType: 1 })).area).toBe('extents');
    expect(defaultPlotSettings(withSetup(model, { ...ansi, plotType: 2 })).area).toBe('limits');
  });

  it('opens on a custom scale and offset, in the page setup’s paper units', () => {
    const plot: LayoutPlot = {
      ...ansi,
      paperSize: 'A3',
      paperWidth: 420,
      paperHeight: 297,
      paperUnits: 'millimeters',
      rotation: 0,
      origin: { x: 11.55, y: -13.65 },
      scale: { numerator: 1, denominator: 50 },
      flags: 11952 & ~16,
    };
    const s = defaultPlotSettings(withSetup(model, plot));
    expect(s).toMatchObject({
      paper: 'ISO A3',
      // A3 fed landscape, not turned: landscape.
      orientation: 'landscape',
      fit: false,
      scale: { mm: 1, units: 50 },
      center: false,
      offset: { x: 11.55, y: -13.65 },
    });
    // An inch page setup: 1 inch = 2 units.
    const inch = defaultPlotSettings(
      withSetup(model, { ...ansi, flags: 11952 & ~16, scale: { numerator: 1, denominator: 2 } }),
    );
    expect(inch.scale).toEqual({ mm: 25.4, units: 2 });
  });

  it('opens on a Window plot area with the window the page setup stores', () => {
    const window = { min: { x: 10, y: 20 }, max: { x: 110, y: 70 } };
    const s = defaultPlotSettings(withSetup(model, { ...ansi, plotType: 4, window }));
    expect(s.area).toBe('window');
    expect(s.window).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    // Plot type 4 without a window, View (3) and Layout (5) in model space: the dialog’s own.
    for (const plotType of [3, 4, 5])
      expect(defaultPlotSettings(withSetup(model, { ...ansi, plotType })).area).toBe('display');
  });

  it('offers a paper the dialog does not list as the page setup’s own', () => {
    const odd: LayoutPlot = { ...ansi, paperSize: 'Custom', paperWidth: 300, paperHeight: 200 };
    const space = withSetup(model, { ...odd, rotation: 0 });
    const s = defaultPlotSettings(space);
    expect(s.paper).toBe(LAYOUT_PAPER);
    expect(paperMm(s, space)).toEqual({ width: 300, height: 200 });
    expect(s.orientation).toBe('landscape');
    // A page setup without a paper (a device with none) opens on the dialog’s A4.
    const none = withSetup(model, { ...ansi, paperWidth: 0, paperHeight: 0 });
    expect(defaultPlotSettings(none).paper).toBe('ISO A4');
  });

  it('opens a layout upside-down when its page setup turns it 180°', () => {
    const plot: LayoutPlot = { ...ansi, rotation: 2, plotType: 5, flags: 688 };
    const s = defaultPlotSettings({ ...layout, pageSetup: pageSetupOf({ plot } as Layout) });
    expect(s).toMatchObject({ area: 'layout', upsideDown: true, offset: { x: 0, y: 0 } });
  });

  describe('Apply to Layout', () => {
    it('writes nothing new for the settings the page setup opened on', () => {
      for (const plot of [
        ansi,
        { ...ansi, rotation: 3 as const, plotType: 1 },
        { ...ansi, flags: 688, standardScaleType: 16, scale: { numerator: 1, denominator: 1 } },
      ]) {
        const space = withSetup(model, plot, plot.paperUnits === 'inches');
        expect(appliedPageSetup(defaultPlotSettings(space), space)).toEqual(plot);
      }
    });

    it('writes the paper, orientation, area, scale, offset and options chosen', () => {
      const space = withSetup(model, ansi, true);
      const s = {
        ...defaultPlotSettings(space),
        paper: 'ISO A3',
        orientation: 'portrait' as const,
        upsideDown: true,
        area: 'window' as const,
        window: { minX: 0, minY: 5, maxX: 200, maxY: 105 },
        fit: false,
        scale: { mm: 25.4, units: 20 },
        center: false,
        offset: { x: 10, y: 12.5 },
        table: 'triya-monochrome.ctb',
        lineweights: false,
        plotStyles: false,
      };
      expect(appliedPageSetup(s, space)).toEqual({
        ...ansi,
        // Triya’s plotters print to the paper’s edge.
        paperSize: 'ISO_full_bleed_A3_(297.00_x_420.00_MM)',
        paperWidth: 297,
        paperHeight: 420,
        margins: { left: 0, bottom: 0, right: 0, top: 0 },
        // Fed portrait, plotted portrait and upside-down.
        rotation: 2,
        plotType: 4,
        window: { min: { x: 0, y: 5 }, max: { x: 200, y: 105 } },
        // 1 inch = 20 units, in the page setup’s inches; a custom scale clears 16.
        scale: { numerator: 1, denominator: 20 },
        origin: { x: 10, y: 12.5 },
        flags: (11952 | 4) & ~(16 | 4 | 32 | 128),
        styleSheet: 'triya-monochrome.ctb',
      });
      // Fit to paper: 16 with DXF 75 = 0, the scale kept.
      const fitted = appliedPageSetup({ ...s, fit: true, center: true }, space);
      expect(fitted).toMatchObject({ standardScaleType: 0, scale: ansi.scale });
      expect(fitted.flags & (16 | 4)).toBe(16 | 4);
    });

    it('keeps the page setup’s own name for the table it opened on', () => {
      const plot = { ...ansi, styleSheet: 'C:\\Plot Styles\\monochrome.ctb' };
      const space = withSetup(model, plot, true);
      const s = defaultPlotSettings(space);
      expect(s.table).toBe('triya-monochrome.ctb');
      expect(appliedPageSetup(s, space).styleSheet).toBe(plot.styleSheet);
      expect(appliedPageSetup({ ...s, table: '' }, space)).not.toHaveProperty('styleSheet');
    });

    it('moves a layout’s sheet by the offset its Layout plot area is given', () => {
      const plot: LayoutPlot = { ...ansi, plotType: 5, flags: 688, origin: { x: 1, y: 2 } };
      const space: PlotSpace = { ...layout, pageSetup: pageSetupOf({ plot } as Layout) };
      const s = { ...defaultPlotSettings(space), offset: { x: 3, y: -1 } };
      expect(appliedPageSetup(s, space).origin).toEqual({ x: 4, y: 1 });
    });
  });
});
