// M6-04's option matrix: each Plot dialog option, alone, plotted through the app's own pipeline
// (the render session's plot job asked with the dialog's request, then the PDF writer with its
// settings) and read back with pdf.js: the page's size, the clip of the plot area, the stroke's
// colour, width and opacity, where the path lies, and what plots first.
import { describe, expect, it } from 'vitest';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, RenderSession } from '@triya/render';
import {
  toleranceForSize,
  type EntityInit,
  type Layout,
  type ViewportGeometry,
  type Xdata,
} from '@triya/engine';
import {
  drawingInit,
  entity,
  line,
  MODEL,
  PAPER,
  surface,
} from '../../../packages/render/test/fixtures';
import {
  CUSTOM_PAPER,
  LAYOUT_PAPER,
  appliedPageSetup,
  defaultPlotSettings,
  pageSetupOf,
  paperMm,
  plotPage,
  plotPdf,
  type PlotSettings,
  type PlotSpace,
} from '../src/plot';
import { plotRequest } from '../src/plot-preview';

// Frame 40…80 × 20…60 on the sheet, showing model 0…100 × 0…100 (scale 0.4).
const viewport: ViewportGeometry = {
  kind: 'VIEWPORT',
  center: { x: 60, y: 40 },
  width: 40,
  height: 40,
  id: 2,
  status: 1,
  flags: 0,
  viewCenter: { x: 50, y: 50 },
  viewHeight: 100,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
};

/** A red (ACI 1) 0.5 mm line at 50 % transparency in model space; a blue line on the sheet. */
const entities: EntityInit[] = [
  entity('50', line(0, 0, 100, 50), {
    color: { kind: 'aci', index: 1 },
    lineweight: 50,
    transparency: { alpha: 127 },
  }),
  entity('70', line(0, 0, 200, 0), { owner: PAPER, color: { kind: 'aci', index: 5 } }),
  entity('71', viewport, { owner: PAPER }),
];

const session = () =>
  new RenderSession({
    now: () => 0,
    document: { init: drawingInit(entities), block: MODEL, tol: toleranceForSize(1000) },
    surface: surface('visible'),
    createLayer: () => surface('scene'),
    requestIdle: () => {},
  });

const model: PlotSpace = {
  name: 'Model',
  extents: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  display: { minX: -100, minY: -50, maxX: 200, maxY: 100 },
  limits: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
};

/** An A4 landscape layout in millimetres, 1:1, paper 0…297 × 0…210. */
const layout: PlotSpace = {
  name: 'Layout1',
  sheet: { paper: { minX: 0, minY: 0, maxX: 297, maxY: 210 }, unitsPerMm: 1 },
  extents: { minX: 0, minY: 0, maxX: 200, maxY: 60 },
};

interface Plotted {
  /** The page, millimetres. */
  readonly width: number;
  readonly height: number;
  /** The plot area's clip on the page, millimetres. */
  readonly clip: readonly number[];
  readonly strokes: readonly {
    readonly color: string;
    readonly width: number;
    readonly opacity: number;
    /** The path's first point and its bounds, millimetres on the page. */
    readonly start: readonly number[];
    readonly bounds: readonly number[];
  }[];
}

const mm = (v: number) => Math.round((v / POINTS_PER_MM) * 1000) / 1000;

/** Plots `space` with `settings` as the Plot dialog's OK does, and reads the page back. */
async function plotted(space: PlotSpace, settings: PlotSettings): Promise<Plotted> {
  const block = space.sheet ? PAPER : MODEL;
  const parts = session().plot({ block, ...plotRequest(settings, space) });
  const bytes = plotPdf(parts, plotPage(settings, space), settings, space, 'matrix');
  const page = await (await getDocument({ data: bytes }).promise).getPage(1);
  const list = await page.getOperatorList();
  const strokes: {
    color: string;
    width: number;
    opacity: number;
    start: number[];
    bounds: number[];
  }[] = [];
  let clip: number[] = [];
  let color = '#000000';
  let width = 1;
  let opacity = 1;
  let path: { start: number[]; bounds: number[] } | undefined;
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.setStrokeRGBColor) color = args[0] as string;
    else if (fn === OPS.setLineWidth) width = args[0] as number;
    else if (fn === OPS.setGState) {
      for (const [key, value] of args[0] as [string, unknown][]) {
        if (key === 'CA') opacity = value as number;
      }
    } else if (fn === OPS.constructPath) {
      const data = Object.values((args[1] as object[])[0]!) as number[];
      const box = Object.values(args[2] as object) as number[];
      path = { start: [mm(data[1]!), mm(data[2]!)], bounds: box.map(mm) };
      if (clip.length === 0) clip = path.bounds;
      else if (args[0] === OPS.stroke) {
        strokes.push({ color, width: mm(width), opacity, ...path });
      }
    }
  });
  const [, , w, h] = page.view as number[];
  return { width: mm(w!), height: mm(h!), clip, strokes };
}

const modelDefaults = { ...defaultPlotSettings(model), area: 'extents' as const };

describe('the Plot options matrix (M6-04)', () => {
  it('plots model space’s extents fitted and centred on A4 landscape by default', async () => {
    const p = await plotted(model, modelDefaults);
    expect([p.width, p.height]).toEqual([297, 210]);
    // 100 × 50 fitted to 297 wide: 297 × 148.5, centred vertically.
    expect(p.clip).toEqual([0, 30.75, 297, 179.25]);
    expect(p.strokes).toHaveLength(1);
    expect(p.strokes[0]).toMatchObject({ color: '#ff0000', width: 0.5, start: [0, 30.75] });
  });

  it('Plot transparency: off by default, as AutoCAD’s page setups are; on plots the object’s', async () => {
    expect(modelDefaults.transparency).toBe(false);
    expect((await plotted(model, modelDefaults)).strokes[0]!.opacity).toBe(1);
    const on = await plotted(model, { ...modelDefaults, transparency: true });
    expect(on.strokes[0]!.opacity).toBeCloseTo(0.498, 3);
  });

  it('Plot with plot styles: through the table when on, the object’s own colour when off', async () => {
    const mono = { ...modelDefaults, table: 'triya-monochrome.ctb' };
    expect((await plotted(model, mono)).strokes[0]!.color).toBe('#000000');
    const off = await plotted(model, { ...mono, plotStyles: false });
    expect(off.strokes[0]!.color).toBe('#ff0000');
  });

  it('Plot object lineweights: off plots the thinnest line', async () => {
    const off = { ...modelDefaults, plotStyles: false, lineweights: false };
    expect((await plotted(model, off)).strokes[0]!.width).toBe(0);
    // Plot with plot styles implies object lineweights, as AutoCAD greys the box.
    expect((await plotted(model, { ...off, plotStyles: true })).strokes[0]!.width).toBe(0.5);
  });

  it('Scale lineweights (layouts): grows them with the plot scale against the page setup’s', async () => {
    const s = { ...defaultPlotSettings(layout), scale: { mm: 2, units: 1 } };
    // The sheet's line and the viewport's frame at the default 0.25 mm, the model's line 0.5 mm.
    expect((await plotted(layout, s)).strokes.map((t) => t.width)).toEqual([0.25, 0.25, 0.5]);
    const scaled = await plotted(layout, { ...s, scaleLineweights: true });
    expect(scaled.strokes.map((t) => t.width)).toEqual([0.5, 0.5, 1]);
  });

  it('Plot paperspace last (layouts): the sheet’s objects after the viewports’', async () => {
    const s = defaultPlotSettings(layout);
    expect((await plotted(layout, s)).strokes.map((t) => t.color)).toEqual([
      '#0000ff',
      '#000000',
      '#ff0000',
    ]);
    const last = await plotted(layout, { ...s, paperspaceLast: true });
    expect(last.strokes.map((t) => t.color)).toEqual(['#ff0000', '#0000ff', '#000000']);
  });

  it('Hide paperspace objects (layouts): a 3D setting, so a 2D sheet plots the same', async () => {
    const s = defaultPlotSettings(layout);
    expect(s.hidePaperspace).toBe(false);
    expect(await plotted(layout, { ...s, hidePaperspace: true })).toEqual(await plotted(layout, s));
  });

  it('Plot upside-down: turns the plot 180° on the paper', async () => {
    const p = await plotted(model, { ...modelDefaults, upsideDown: true });
    expect(p.strokes[0]!.start).toEqual([297, 179.25]);
    expect(p.clip).toEqual([0, 30.75, 297, 179.25]);
  });

  it('Drawing orientation: portrait turns the paper', async () => {
    const p = await plotted(model, { ...modelDefaults, orientation: 'portrait' });
    expect([p.width, p.height]).toEqual([210, 297]);
    expect(p.clip).toEqual([0, 96, 210, 201]);
  });

  it('Plot area: Extents, Display, Limits and Window each plot their own box', async () => {
    const at = { ...modelDefaults, fit: false, center: false, scale: { mm: 1, units: 2 } };
    const clip = async (s: PlotSettings) => (await plotted(model, s)).clip;
    expect(await clip(at)).toEqual([0, 0, 50, 25]);
    // Display reaches past the paper's top: cut to it.
    expect(await clip({ ...at, area: 'display' })).toEqual([0, 0, 150, 75]);
    expect(await clip({ ...at, area: 'limits' })).toEqual([0, 0, 210, 148.5]);
    const window = { minX: 50, minY: 0, maxX: 100, maxY: 50 };
    const w = await plotted(model, { ...at, area: 'window', window });
    expect(w.clip).toEqual([0, 0, 25, 25]);
    // The whole line is drawn, clipped: its start lies left of the window.
    expect(w.strokes[0]!.start).toEqual([-25, 0]);
  });

  it('Plot offset: from the paper’s corner, or centred', async () => {
    const at = { ...modelDefaults, fit: false, center: false, scale: { mm: 1, units: 1 } };
    expect((await plotted(model, { ...at, offset: { x: 10, y: 20 } })).clip).toEqual([
      10, 20, 110, 70,
    ]);
    expect((await plotted(model, { ...at, center: true })).clip).toEqual([98.5, 80, 198.5, 130]);
  });

  it('Paper size: a listed paper, or a custom size in millimetres', async () => {
    const a3 = await plotted(model, { ...modelDefaults, paper: 'ISO A3' });
    expect([a3.width, a3.height]).toEqual([420, 297]);
    const custom = {
      ...modelDefaults,
      paper: CUSTOM_PAPER,
      customPaper: { width: 500, height: 200 },
    };
    expect(paperMm(custom, model)).toEqual({ width: 500, height: 200 });
    const p = await plotted(model, custom);
    // Landscape: the long side across.
    expect([p.width, p.height]).toEqual([500, 200]);
    expect(p.clip).toEqual([50, 0, 450, 200]);
    expect((await plotted(model, { ...custom, orientation: 'portrait' })).width).toBe(200);
  });

  it('opens Plot transparency on from the layout’s PLOTTRANSPARENCY xdata', () => {
    const plot = { ...pageSetupOf({ handle: 'AB', plot: PLOT } as Layout)!.plot! };
    const appIds = [{ handle: '1A', name: 'PlotTransparency' }];
    const xdata = (on: number): Xdata => [{ appId: '1A', values: [{ code: 1071, value: on }] }];
    const with_ = (on: number) =>
      defaultPlotSettings({
        ...layout,
        pageSetup: pageSetupOf({ handle: 'AB', plot, xdata: xdata(on) } as Layout, appIds),
      });
    expect(with_(1).transparency).toBe(true);
    expect(with_(0).transparency).toBe(false);
    // Without the application's name known, nothing is read.
    expect(
      defaultPlotSettings({
        ...layout,
        pageSetup: pageSetupOf({ handle: 'AB', plot, xdata: xdata(1) } as Layout),
      }).transparency,
    ).toBe(false);
  });
});

describe('Apply to Layout of the new options (M6-04)', () => {
  const sheet = { ...layout, pageSetup: pageSetupOf({ handle: 'AB', plot: PLOT } as Layout) };
  const own = { ...model, pageSetup: pageSetupOf({ handle: 'AA', plot: PLOT } as Layout) };

  it('writes Hide paperspace objects as flag 8 of a layout’s page setup', () => {
    const s = defaultPlotSettings(sheet);
    expect(appliedPageSetup({ ...s, hidePaperspace: true }, sheet).flags).toBe(688 | 8);
    const hidden = { ...sheet, pageSetup: { ...sheet.pageSetup!, flags: 688 | 8 } };
    expect(defaultPlotSettings(hidden).hidePaperspace).toBe(true);
    expect(appliedPageSetup({ ...s, hidePaperspace: false }, hidden).flags).toBe(688);
    // Model space has no paper space objects: its flag is kept as it is.
    expect(defaultPlotSettings(own).hidePaperspace).toBe(false);
    expect(appliedPageSetup({ ...defaultPlotSettings(own), hidePaperspace: true }, own).flags).toBe(
      688,
    );
  });

  it('writes a custom paper by its size, which opens again as the page setup’s paper', () => {
    const s = {
      ...defaultPlotSettings(own),
      paper: CUSTOM_PAPER,
      customPaper: { width: 500, height: 200.5 },
    };
    const plot = appliedPageSetup(s, own);
    expect(plot).toMatchObject({
      paperSize: 'UserDefinedMetric_(500.00_x_200.50_MM)',
      paperWidth: 500,
      paperHeight: 200.5,
      margins: { left: 0, bottom: 0, right: 0, top: 0 },
      rotation: 0,
    });
    const again = defaultPlotSettings({
      ...own,
      pageSetup: pageSetupOf({ handle: 'AA', plot } as Layout),
    });
    expect(again.paper).toBe(LAYOUT_PAPER);
    expect(
      paperMm(again, { ...own, pageSetup: pageSetupOf({ handle: 'AA', plot } as Layout) }),
    ).toEqual({
      width: 500,
      height: 200.5,
    });
  });

  it('refuses a custom paper with no size, or past what a PDF page holds', () => {
    for (const customPaper of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: 5081, height: 100 },
      undefined,
    ]) {
      expect(() =>
        plotPage(
          { ...modelDefaults, paper: CUSTOM_PAPER, ...(customPaper && { customPaper }) },
          model,
        ),
      ).toThrow('The custom paper size must be between 1 and 5080 mm each way.');
    }
  });
});

/** A4 landscape fed landscape, millimetres, 1:1, Layout area. */
const PLOT = {
  paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
  paperWidth: 297,
  paperHeight: 210,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'millimeters' as const,
  rotation: 0 as const,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 688,
};
