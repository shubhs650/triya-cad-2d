// M2-17 part 5: what -PLOT's prompts default to and take for a space (the Plot dialog's settings
// and lists), and the settings its answers plot with.
import { describe, expect, it } from 'vitest';
import type { Layout, LayoutPlot } from '@triya/engine';
import { LAYOUT_PAPER, defaultPlotSettings, pageSetupOf, type PlotSpace } from '../src/plot';
import { scriptPapers, scriptSettings, scriptSetup } from '../src/plot-script';

const model: PlotSpace = {
  name: 'Model',
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  display: { minX: -50, minY: -50, maxX: 450, maxY: 250 },
  limits: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
};

const ansiB: LayoutPlot = {
  paperSize: 'ANSI_full_bleed_B_(17.00_x_11.00_Inches)',
  paperWidth: 431.8,
  paperHeight: 279.4,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'inches',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  standardScaleType: 16,
  plotType: 5,
  flags: 16 | 32 | 128 | 512,
  styleSheet: 'monochrome.ctb',
};

/** A layout set up on ANSI B in inches, at 1:1. */
const layout: PlotSpace = {
  name: 'Layout1',
  sheet: { paper: { minX: 0, minY: 0, maxX: 17, maxY: 11 }, unitsPerMm: 1 / 25.4 },
  extents: { minX: 1, minY: 1, maxX: 16, maxY: 10 },
  inches: true,
  pageSetup: pageSetupOf({ handle: '1F', plot: ansiB } as Layout),
};

describe('-PLOT setup', () => {
  it('answers model space with the dialog’s defaults and lists', () => {
    const setup = scriptSetup(model, 'plan.dxf', ['Model', 'Layout1']);
    const { dpi: _d, background: _b, ...dialog } = defaultPlotSettings(model);
    expect(setup).toMatchObject({
      layout: 'Model',
      layouts: ['Model', 'Layout1'],
      areas: ['extents', 'display', 'limits', 'window'],
      inches: false,
      paper: false,
      canSave: false,
      file: 'plan-Model.pdf',
      settings: dialog,
    });
    expect(setup.devices.map((d) => d.id)).toEqual(['pdf', 'svg', 'png']);
    expect(setup.tables).toContain('triya-monochrome.ctb');
    expect(setup.papers[0]).toEqual({ id: 'ISO A0', name: 'ISO A0 (841 x 1189 mm)' });
    expect(setup.papers.some((p) => p.id === LAYOUT_PAPER)).toBe(false);
  });

  it('answers a layout with its page setup: its paper by media name, inches, saving allowed', () => {
    const setup = scriptSetup(layout, 'plan.dxf', ['Model', 'Layout1']);
    expect(setup.papers[0]).toEqual({
      id: LAYOUT_PAPER,
      name: 'ANSI full bleed B (17.00 x 11.00 Inches)',
    });
    expect(setup).toMatchObject({
      layout: 'Layout1',
      areas: ['layout', 'extents', 'window'],
      inches: true,
      paper: true,
      canSave: true,
      file: 'plan-Layout1.pdf',
      settings: { paper: LAYOUT_PAPER, area: 'layout', paperspaceLast: true },
    });
  });

  it('names a layout’s own paper by its size when its page setup gives no media name', () => {
    const bare = { ...layout, pageSetup: undefined };
    expect(scriptPapers(bare)[0]).toEqual({
      id: LAYOUT_PAPER,
      name: 'Layout paper (431.8 x 279.4 mm)',
    });
  });

  it('plots with the answers over the dialog’s own settings', () => {
    const base = scriptSetup(model, 'plan.dxf', ['Model']).settings;
    const s = scriptSettings(model, { ...base, device: 'png', paper: 'ISO A1', fit: false });
    expect(s).toMatchObject({ device: 'png', paper: 'ISO A1', fit: false, dpi: 150 });
    expect(() => scriptSettings(model, { ...base, device: 'hpgl' })).toThrow(
      'Output device "hpgl" not found.',
    );
  });
});
