// EXPORT and EXPORTPDF (M2-39 part 2): what the Export Data and Save As PDF dialogs offer for a
// space, the file names they suggest and the plot settings each choice exports with.
import { describe, expect, it } from 'vitest';
import {
  EXPORT_TYPES,
  defaultExportArea,
  exportAreas,
  exportExtension,
  exportFileName,
  exportSettings,
  pageSetupOverride,
  withExportType,
} from '../src/export';
import { LAYOUT_PAPER, defaultPlotSettings, type PlotSpace } from '../src/plot';

const model: PlotSpace = {
  name: 'Model',
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  display: { minX: -50, minY: -50, maxX: 450, maxY: 250 },
  limits: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
};

const layout: PlotSpace = {
  name: 'Layout1',
  sheet: { paper: { minX: -5, minY: -5, maxX: 415, maxY: 292 }, unitsPerMm: 1 },
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 280 },
};

describe('the export file types', () => {
  it('are the formats Triya writes, PDF first as in AutoCAD’s list', () => {
    expect(EXPORT_TYPES.map((t) => t.id)).toEqual(['pdf', 'svg', 'png', 'dxf']);
    expect(EXPORT_TYPES.map((t) => t.name)).toEqual([
      'PDF (*.pdf)',
      'SVG (*.svg)',
      'PNG (*.png)',
      'AutoCAD 2018 DXF (*.dxf)',
    ]);
  });
});

describe('exportAreas', () => {
  it('offers Display, Extents and Window in model space', () => {
    expect(exportAreas(model, 'pdf')).toEqual(['display', 'extents', 'window']);
    expect(exportAreas(model, 'png')).toEqual(['display', 'extents', 'window']);
    expect(exportAreas({ ...model, display: undefined }, 'svg')).toEqual(['extents', 'window']);
  });

  it('offers Current layout and All layouts in a layout, for every plot type (part 4)', () => {
    expect(exportAreas(layout, 'pdf')).toEqual(['current', 'all']);
    expect(exportAreas(layout, 'svg')).toEqual(['current', 'all']);
    expect(exportAreas(layout, 'png')).toEqual(['current', 'all']);
  });

  it('offers nothing for a DXF, which is the whole drawing', () => {
    expect(exportAreas(model, 'dxf')).toEqual([]);
    expect(exportAreas(layout, 'dxf')).toEqual([]);
  });

  it('defaults to Display in model space and Current layout in a layout', () => {
    expect(defaultExportArea(model)).toBe('display');
    expect(defaultExportArea({ ...model, display: undefined })).toBe('extents');
    expect(defaultExportArea(layout)).toBe('current');
  });
});

describe('exportFileName', () => {
  it('names a plot after the drawing and the space, as AutoCAD’s Save As PDF does', () => {
    expect(exportFileName('plan.dxf', model, 'pdf', 'display')).toBe('plan-Model.pdf');
    expect(exportFileName('plan.dwg', layout, 'svg', 'current')).toBe('plan-Layout1.svg');
    expect(exportFileName('a:b.dxf', layout, 'png', 'current')).toBe('a_b-Layout1.png');
  });

  it('names all layouts and a DXF after the drawing alone', () => {
    expect(exportFileName('plan.dxf', layout, 'pdf', 'all')).toBe('plan.pdf');
    expect(exportFileName('plan.dwg', model, 'dxf', undefined)).toBe('plan.dxf');
  });

  it('names all layouts as SVG or PNG files a ZIP after the drawing (part 4)', () => {
    expect(exportFileName('plan.dxf', layout, 'svg', 'all')).toBe('plan.zip');
    expect(exportFileName('plan.dxf', layout, 'png', 'all')).toBe('plan.zip');
  });
});

describe('withExportType', () => {
  it('changes the extension to the type chosen, or adds it', () => {
    expect(withExportType('plan-Model.pdf', 'svg')).toBe('plan-Model.svg');
    expect(withExportType('plan-Model.PDF', 'png')).toBe('plan-Model.png');
    expect(withExportType('plan-Model', 'dxf')).toBe('plan-Model.dxf');
    expect(withExportType('plan.v2', 'pdf')).toBe('plan.v2.pdf');
    expect(withExportType('  ', 'pdf')).toBe('Drawing1.pdf');
  });

  it('makes All layouts as SVG or PNG a ZIP, and back (part 4)', () => {
    expect(withExportType('plan.pdf', 'svg', 'all')).toBe('plan.zip');
    expect(withExportType('plan', 'png', 'all')).toBe('plan.zip');
    expect(withExportType('plan.zip', 'pdf', 'all')).toBe('plan.pdf');
    expect(withExportType('plan.zip', 'svg', 'current')).toBe('plan.svg');
    expect(exportExtension('svg', 'all')).toBe('zip');
    expect(exportExtension('pdf', 'all')).toBe('pdf');
  });
});

describe('exportSettings', () => {
  it('plots model space with its page setup and the area chosen', () => {
    const base = defaultPlotSettings(model);
    expect(exportSettings(model, 'pdf', 'extents')).toEqual({ ...base, area: 'extents' });
    expect(exportSettings(model, 'svg', 'display')).toEqual({
      ...base,
      device: 'svg',
      area: 'display',
    });
    const window = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
    expect(exportSettings(model, 'png', 'window', window)).toEqual({
      ...base,
      device: 'png',
      area: 'window',
      window,
    });
  });

  it('plots a layout as its page setup says', () => {
    expect(exportSettings(layout, 'pdf', 'current')).toEqual(defaultPlotSettings(layout));
    expect(exportSettings(layout, 'pdf', 'all')).toEqual(defaultPlotSettings(layout));
  });

  it('refuses a window that was not picked', () => {
    expect(() => exportSettings(model, 'pdf', 'window')).toThrow(/window/i);
  });
});

describe('Page Setup Override (part 5)', () => {
  it('opens on the current page setup’s paper, orientation, scale and plot style table', () => {
    const base = defaultPlotSettings(layout);
    expect(pageSetupOverride(layout)).toEqual({
      paper: LAYOUT_PAPER,
      orientation: base.orientation,
      fit: base.fit,
      scale: base.scale,
      table: base.table,
    });
    const m = defaultPlotSettings(model);
    expect(pageSetupOverride(model)).toMatchObject({ paper: m.paper, fit: m.fit, table: '' });
  });

  it('replaces the page setup’s paper, orientation, scale and table, keeping the rest', () => {
    const override = {
      paper: 'ISO A3',
      orientation: 'portrait' as const,
      fit: false,
      scale: { mm: 1, units: 50 },
      table: 'monochrome.ctb',
    };
    const base = defaultPlotSettings(model);
    expect(exportSettings(model, 'pdf', 'extents', undefined, override)).toEqual({
      ...base,
      ...override,
      area: 'extents',
    });
    const window = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
    expect(exportSettings(model, 'svg', 'window', window, override)).toEqual({
      ...base,
      ...override,
      device: 'svg',
      area: 'window',
      window,
    });
    // A layout keeps its plot area (Layout) and its plot options, its paper and scale replaced.
    expect(exportSettings(layout, 'pdf', 'all', undefined, override)).toEqual({
      ...defaultPlotSettings(layout),
      ...override,
    });
  });

  it('plots a PNG at the resolution chosen', () => {
    expect(exportSettings(model, 'png', 'extents', undefined, undefined, 300).dpi).toBe(300);
    expect(exportSettings(model, 'png', 'extents').dpi).toBe(150);
  });
});
