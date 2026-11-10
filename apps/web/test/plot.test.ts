// The Plot dialog's settings (M2-17): AutoCAD's defaults per space, the page they make, and the
// one-page PDF written from plot parts.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, bundledPlotStyleTable, type PlotPart } from '@triya/render';
import {
  LAYOUT_PAPER,
  defaultPlotSettings,
  paperMm,
  plotAreas,
  plotFileName,
  plotPage,
  plotPdf,
  plotStyleTables,
  plotPreview,
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
    expect(plotTable(s)).toBe(bundledPlotStyleTable('triya-monochrome.ctb'));
    expect(plotTable({ ...s, plotStyles: false })).toBeUndefined();
  });
});

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
