// PUBLISH (M2-17 part 2): the drawing's sheets, model space then each layout in tab order, each
// plotted with its own page setup (as the Plot dialog opens on it) into one PDF whose pages are
// labelled with the sheet's layout and bookmarked with the sheet's name.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, type PlotPart } from '@triya/render';
import type { Layout } from '@triya/engine';
import { defaultPlotSettings } from '../src/plot';
import { publishFileName, publishPdf, publishSheets, sheetSpace } from '../src/publish';

const stroke: PlotPart = {
  kind: 'stroke',
  path: [0, 0, 0, 1, 100, 50],
  paint: {
    color: [0, 0, 0],
    screening: 100,
    lineweight: 0.25,
    linetype: { kind: 'object' },
    endStyle: 'round',
    joinStyle: 'round',
    fillStyle: 'solid',
    physicalPen: 0,
    virtualPen: 0,
  },
};

/** An A3 landscape layout in millimetres (PLOTSETTINGS as acad-ts maps them). */
function a3(name: string, blockRecord: string, tabOrder: number): Layout {
  return {
    handle: `L${tabOrder}`,
    name,
    blockRecord,
    tabOrder,
    plot: {
      paperSize: 'ISO_A3_(420.00_x_297.00_MM)',
      paperWidth: 420,
      paperHeight: 297,
      margins: { left: 0, bottom: 0, right: 0, top: 0 },
      paperUnits: 'millimeters',
      rotation: 0,
      origin: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
    },
  } as unknown as Layout;
}

describe('publishSheets', () => {
  it('names each sheet after the drawing and the space, model first', () => {
    const sheets = publishSheets('plan.dxf', [
      { name: 'Model', block: '1F' },
      { name: 'Layout1', block: '58' },
      { name: 'Layout2', block: '5E' },
    ]);
    expect(sheets.map((s) => s.sheet)).toEqual(['plan-Model', 'plan-Layout1', 'plan-Layout2']);
    expect(sheets.every((s) => s.include)).toBe(true);
    expect(publishFileName('plan.dxf')).toBe('plan.pdf');
  });
});

describe('sheetSpace', () => {
  it('gives a layout not shown its sheet from its page setup', () => {
    const space = sheetSpace({ name: 'Layout1', layout: a3('Layout1', '58', 1) });
    expect(space.name).toBe('Layout1');
    expect(space.sheet?.unitsPerMm).toBe(1);
    expect(space.sheet!.paper.maxX - space.sheet!.paper.minX).toBeCloseTo(420, 9);
  });

  it('plots model space not shown by its extents', () => {
    const extents = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
    expect(sheetSpace({ name: 'Model', extents })).toMatchObject({ name: 'Model', extents });
  });

  it('takes the page setup’s plot style table and options, model space’s from its own (part 3)', () => {
    const layout = a3('Layout1', '58', 1);
    const styled = {
      ...layout,
      plot: { ...layout.plot!, styleSheet: 'monochrome.ctb', flags: 32 },
    };
    const space = sheetSpace({ name: 'Layout1', layout: styled });
    expect(space.pageSetup).toEqual({ styleSheet: 'monochrome.ctb', flags: 32 });
    expect(defaultPlotSettings(space)).toMatchObject({
      table: 'triya-monochrome.ctb',
      plotStyles: true,
      lineweights: false,
    });
    // The Model layout's page setup has a paper too, but model space plots no sheet.
    const extents = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
    const model = sheetSpace({
      name: 'Model',
      layout: { ...styled, name: 'Model' },
      extents,
      model: true,
    });
    expect(model.sheet).toBeUndefined();
    expect(model.pageSetup?.styleSheet).toBe('monochrome.ctb');
    expect(defaultPlotSettings(model)).toMatchObject({ area: 'extents', fit: true });
  });

  it('passes your own plot style tables on', () => {
    const userTables = new Map();
    expect(sheetSpace({ name: 'Model', userTables }).userTables).toBe(userTables);
  });
});

describe('publishPdf', () => {
  it('writes one page per sheet, labelled and bookmarked, each on its own paper', async () => {
    const model = sheetSpace({ name: 'Model', extents: { minX: 0, minY: 0, maxX: 100, maxY: 50 } });
    const layout = sheetSpace({ name: 'Layout1', layout: a3('Layout1', '58', 1) });
    const { bytes, failed } = publishPdf(
      [
        { sheet: 'plan-Model', space: model, parts: [stroke] },
        { sheet: 'plan-Layout1', space: layout, parts: [stroke] },
        { sheet: 'plan-Empty', space: { name: 'Empty' }, parts: [] },
      ],
      'plan',
    );
    expect(failed).toEqual([
      { sheet: 'plan-Empty', message: 'There is nothing to plot in this plot area.' },
    ]);
    const pdf = await getDocument({ data: bytes! }).promise;
    expect(pdf.numPages).toBe(2);
    expect(await pdf.getPageLabels()).toEqual(['Model', 'Layout1']);
    const outline = await pdf.getOutline();
    expect(outline.map((o) => o.title)).toEqual(['plan-Model', 'plan-Layout1']);
    const [, , w1, h1] = (await pdf.getPage(1)).view;
    expect([w1! / POINTS_PER_MM, h1! / POINTS_PER_MM].map(Math.round)).toEqual([297, 210]);
    const [, , w2, h2] = (await pdf.getPage(2)).view;
    expect([w2! / POINTS_PER_MM, h2! / POINTS_PER_MM].map(Math.round)).toEqual([420, 297]);
  });

  it('writes no file when no sheet plots', () => {
    const { bytes, failed } = publishPdf(
      [{ sheet: 'x-Model', space: { name: 'Model' }, parts: [] }],
      'x',
    );
    expect(bytes).toBeUndefined();
    expect(failed).toHaveLength(1);
  });
});
