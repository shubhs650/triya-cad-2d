// PUBLISH (M2-17 part 2): the drawing's sheets, model space then each layout in tab order, each
// plotted with its own page setup (as the Plot dialog opens on it) into one PDF whose pages are
// labelled with the sheet's layout and bookmarked with the sheet's name.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, type PlotPart } from '@triya/render';
import type { Layout, NamedPageSetup } from '@triya/engine';
import { defaultPlotSettings, pageSetupsOf, plotFile, withPageSetup } from '../src/plot';
import {
  movedSheet,
  publishFileName,
  publishLog,
  publishLogName,
  publishPdf,
  publishSheetFiles,
  publishSheets,
  publishedDownload,
  PUBLISH_TO,
  sheetSpace,
  withOpenDrawings,
} from '../src/publish';

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
    expect(space.pageSetup).toMatchObject({ styleSheet: 'monochrome.ctb', flags: 32 });
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
    // Its plot type (5, Layout) is not model space's: the extents, at the page setup's scale,
    // since flag 16 (Fit to paper with DXF 75 = 0) is off (part 4).
    expect(defaultPlotSettings(model)).toMatchObject({ area: 'extents', fit: false });
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

// M2-39 part 4: Publish to SVG or PNG writes a file a sheet, several as one ZIP.
describe('publishing to SVG and PNG (M2-39 part 4)', () => {
  const model = sheetSpace({ name: 'Model', extents: { minX: 0, minY: 0, maxX: 100, maxY: 50 } });
  const layout = sheetSpace({ name: 'Layout1', layout: a3('Layout1', '58', 1) });
  const sheets = [
    { sheet: 'plan-Model', space: model, parts: [stroke] },
    { sheet: 'plan-Layout1', space: layout, parts: [stroke] },
    { sheet: 'plan-Empty', space: { name: 'Empty' }, parts: [] },
  ];

  it('offers PDF, SVG and PNG', () => {
    expect(PUBLISH_TO.map((d) => d.name)).toEqual(['PDF', 'SVG', 'PNG']);
  });

  it('writes a file a sheet with its page setup and the plotter chosen, reporting the rest', async () => {
    const seen: { device: string; paper: number; title: string }[] = [];
    const { files, failed } = await publishSheetFiles(
      sheets,
      'svg',
      async (parts, page, settings, space, title) => {
        if (parts.length === 0) throw new Error('There is nothing to plot in this plot area.');
        seen.push({ device: settings.device, paper: Math.round(page.width), title });
        return plotFile(parts, page, settings, space, title);
      },
    );
    expect(files.map((f) => f.name)).toEqual(['plan-Model.svg', 'plan-Layout1.svg']);
    expect(seen).toEqual([
      { device: 'svg', paper: 297, title: 'plan-Model' },
      { device: 'svg', paper: 420, title: 'plan-Layout1' },
    ]);
    expect(failed).toEqual([
      { sheet: 'plan-Empty', message: 'There is nothing to plot in this plot area.' },
    ]);
    const svg = new TextDecoder().decode(files[1]!.bytes);
    expect(svg).toContain('<title>plan-Layout1</title>');
    expect(svg).toContain('width="420mm" height="297mm"');
  });

  it('plots PNGs at the resolution chosen (part 5), 150 dpi otherwise', async () => {
    const dpis: number[] = [];
    const write = async (..._: unknown[]) => ({ bytes: new Uint8Array() });
    await publishSheetFiles(sheets.slice(0, 1), 'png', async (_p, _pg, settings) => {
      dpis.push(settings.dpi);
      return write();
    });
    await publishSheetFiles(
      sheets.slice(0, 1),
      'png',
      async (_p, _pg, settings) => {
        dpis.push(settings.dpi);
        return write();
      },
      { dpi: 300 },
    );
    expect(dpis).toEqual([150, 300]);
  });

  it('plots a sheet with the settings it was plotted with (Page Setup Override, part 5)', async () => {
    const settings = { ...defaultPlotSettings(model), paper: 'ISO A3', area: 'extents' as const };
    const seen: number[] = [];
    await publishSheetFiles([{ ...sheets[0]!, settings }], 'svg', async (parts, page, s) => {
      seen.push(Math.round(page.width));
      expect(s.device).toBe('svg');
      return { bytes: new Uint8Array(parts.length) };
    });
    expect(seen).toEqual([420]);
    const { bytes } = publishPdf([{ ...sheets[0]!, settings }], 'plan');
    const pdf = await getDocument({ data: bytes! }).promise;
    const [, , w] = (await pdf.getPage(1)).view;
    expect(Math.round(w! / POINTS_PER_MM)).toBe(420);
  });

  it('downloads one file as itself and several as one ZIP', () => {
    const svg = { name: 'plan-Model.svg', bytes: new TextEncoder().encode('<svg/>') };
    const png = { name: 'plan-Layout1.png', bytes: Uint8Array.from([137, 80, 78, 71]) };
    expect(publishedDownload([svg], publishFileName('plan.dxf', 'zip'))).toEqual({
      name: 'plan-Model.svg',
      bytes: svg.bytes,
      type: 'image/svg+xml',
    });
    const zip = publishedDownload([svg, png], publishFileName('plan.dxf', 'zip'))!;
    expect([zip.name, zip.type]).toEqual(['plan.zip', 'application/zip']);
    expect([...zip.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    const names = new TextDecoder().decode(zip.bytes);
    expect(names).toContain('plan-Model.svg');
    expect(names).toContain('plan-Layout1.png');
    // Export's All layouts names a ZIP, so even one layout is one.
    expect(publishedDownload([png], 'plan.zip', 'always')!.name).toBe('plan.zip');
    expect(publishedDownload([], 'plan.zip')).toBeUndefined();
  });
});

// Part 6: named page setups, several drawings, the sheet list's order and the publish log.
describe('several drawings and named page setups (part 6)', () => {
  const plan = [
    { name: 'Model', block: '1F' },
    { name: 'Layout1', block: '58' },
  ];
  const site = [
    { name: 'Model', block: '2A' },
    { name: 'Survey', block: '7C' },
  ];

  it('adds the sheets of every open drawing after those listed, once', () => {
    const listed = publishSheets('plan.dxf', plan, 1);
    const all = withOpenDrawings(listed, [
      { doc: 1, drawing: 'plan.dxf', spaces: plan },
      { doc: 2, drawing: 'site.dwg', spaces: site },
    ]);
    expect(all.map((s) => [s.doc, s.sheet])).toEqual([
      [1, 'plan-Model'],
      [1, 'plan-Layout1'],
      [2, 'site-Model'],
      [2, 'site-Survey'],
    ]);
    // Loading again adds nothing; a sheet removed comes back.
    expect(withOpenDrawings(all, [{ doc: 2, drawing: 'site.dwg', spaces: site }])).toEqual(all);
    const removed = all.filter((s) => s.sheet !== 'site-Model');
    expect(
      withOpenDrawings(removed, [{ doc: 2, drawing: 'site.dwg', spaces: site }]).map(
        (s) => s.sheet,
      ),
    ).toEqual(['plan-Model', 'plan-Layout1', 'site-Survey', 'site-Model']);
  });

  it('moves a sheet up or down, and not past either end', () => {
    expect(movedSheet(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(movedSheet(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(movedSheet(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(movedSheet(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('plots a sheet on a named page setup’s paper and table, its layout unchanged', () => {
    const layout = a3('Layout1', '58', 1);
    const a1: NamedPageSetup = {
      handle: '9A',
      type: 'PLOTSETTINGS',
      owner: '39',
      name: 'A1 Monochrome',
      model: false,
      plot: {
        ...layout.plot!,
        paperSize: 'ISO_full_bleed_A1_(841.00_x_594.00_MM)',
        paperWidth: 841,
        paperHeight: 594,
        styleSheet: 'monochrome.ctb',
        flags: 32 | 128,
      },
    };
    const forModel: NamedPageSetup = { ...a1, handle: '9B', name: 'Model fit', model: true };
    const setups = pageSetupsOf([forModel, a1], false);
    expect(setups.map((p) => p.name)).toEqual(['A1 Monochrome']);
    const own = sheetSpace({ name: 'Layout1', layout, pageSetups: setups });
    const named = withPageSetup(own, 'a1 monochrome');
    expect(named.pageSetupName).toBe('A1 Monochrome');
    expect(named.sheet!.paper.maxX - named.sheet!.paper.minX).toBeCloseTo(841, 9);
    // Apply to Layout still writes the layout's own page setup.
    expect(named.pageSetup?.layout).toBe(layout.handle);
    expect(defaultPlotSettings(named)).toMatchObject({ table: 'triya-monochrome.ctb' });
    expect(withPageSetup(named, undefined).pageSetupName).toBeUndefined();
    expect(() => withPageSetup(own, 'Model fit')).toThrow('Page setup "Model fit" not found.');
  });

  // M2-45: the page setup a layout has applied (its DXF 1) is the Name it opens on.
  it('opens a sheet on the name of the page setup its layout has applied', () => {
    const layout = a3('Layout1', '58', 1);
    const applied = { ...layout, plot: { ...layout.plot!, pageSetupName: 'A3 Monochrome' } };
    const own = sheetSpace({ name: 'Layout1', layout: applied });
    expect(own.pageSetupName).toBe('A3 Monochrome');
    expect(own.pageSetup?.plot).toBe(applied.plot);
    // "<None>": the same settings, no name.
    const none = withPageSetup(own, undefined);
    expect(none.pageSetupName).toBeUndefined();
    expect(none.pageSetup).toBe(own.pageSetup);
    expect(sheetSpace({ name: 'Layout1', layout }).pageSetupName).toBeUndefined();
  });

  it('writes the log a row a sheet with its page setup and status', () => {
    const [model, layout] = publishSheets('plan, rev "A".dxf', plan, 1);
    const log = publishLog(
      [
        { sheet: model!, status: 'Published' },
        { sheet: { ...layout!, pageSetup: 'A3 Monochrome' }, status: 'There is nothing to plot.' },
      ],
      new Date(Date.UTC(2026, 10, 10, 15, 0, 0)),
    );
    expect(log.split('\r\n')).toEqual([
      'Publish log,2026-11-10T15:00:00.000Z',
      'Drawing,Sheet Name,Layout,Page Setup,Status',
      '"plan, rev ""A"".dxf","plan, rev ""A""-Model",Model,<Default: None>,Published',
      '"plan, rev ""A"".dxf","plan, rev ""A""-Layout1",Layout1,A3 Monochrome,There is nothing to plot.',
      '',
    ]);
    expect(publishLogName('plan.dxf')).toBe('plan.csv');
  });
});
