// LAYOUT objects to Triya (M1-18), on drawings authored in memory with acad-ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Layout,
  PlotSettings,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import {
  mapLayouts,
  mapPageSetups,
  openDocument,
  readCadDocument,
  writeCadDocument,
} from '../src/index';

/** A drawing with its Model tab and one layout tab, added out of tab order. */
function read(): { doc: CadDocument; sheet: Layout } {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, false);
  const sheet = new Layout('Sheet');
  sheet.tabOrder = 1;
  doc.layouts!.add(sheet);
  sheet.associatedBlock = doc.paperSpace!;
  const model = new Layout('Model');
  doc.layouts!.add(model);
  model.associatedBlock = doc.modelSpace!;
  // A layout without a block record (a damaged file) is skipped.
  doc.layouts!.add(new Layout('Broken'));
  return { doc, sheet };
}

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

describe('mapLayouts', () => {
  it('maps each layout with its block record and page setup, in tab order', () => {
    const { doc, sheet: l } = read();
    l.paperSize = 'ISO_A4_(210.00_x_297.00_MM)';
    l.paperWidth = 210;
    l.paperHeight = 297;
    l.unprintableMargin.left = 7.5;
    l.unprintableMargin.bottom = 20;
    l.unprintableMargin.right = 7.5;
    l.unprintableMargin.top = 20;
    l.paperUnits = 1;
    l.paperRotation = 1;
    l.plotOriginX = 2;
    l.plotOriginY = 3;
    l.numeratorScale = 1;
    l.denominatorScale = 2;
    l.plotType = 5;
    l.minLimits.x = -20;

    const mapped = mapLayouts(doc);
    expect(mapped.map((m) => m.name)).toEqual(['Model', l.name]);
    expect(mapped[0]!.blockRecord).toBe(H(doc.modelSpace!));
    expect(mapped[1]).toEqual(
      expect.objectContaining({
        handle: H(l),
        tabOrder: l.tabOrder,
        blockRecord: H(l.associatedBlock!),
        flags: 1,
        limits: { min: { x: -20, y: l.minLimits.y }, max: { x: l.maxLimits.x, y: l.maxLimits.y } },
        plot: {
          paperSize: 'ISO_A4_(210.00_x_297.00_MM)',
          paperWidth: 210,
          paperHeight: 297,
          margins: { left: 7.5, bottom: 20, right: 7.5, top: 20 },
          paperUnits: 'millimeters',
          rotation: 1,
          origin: { x: 2, y: 3 },
          scale: { numerator: 1, denominator: 2 },
          ...(((l.flags as number) & 16) !== 0 && { standardScaleType: l.scaledFit as number }),
          plotType: 5,
          flags: l.flags as number,
        },
      }),
    );
  });

  it('reads the page setup’s plot style table (DXF 7), left out when it names none', () => {
    const { doc, sheet: l } = read();
    expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('styleSheet');
    l.styleSheet = 'monochrome.ctb';
    expect(mapLayouts(doc)[1]!.plot!.styleSheet).toBe('monochrome.ctb');
  });

  it('reads the standard scale (DXF 75) and the Window plot area (48, 49, 140, 141)', () => {
    const { doc, sheet: l } = read();
    // No window stored (AutoCAD writes four zeros): none mapped.
    expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('window');
    l.scaledFit = 16 as never; // 1:1
    l.plotType = 4 as never;
    l.windowLowerLeftX = -5;
    l.windowLowerLeftY = 10;
    l.windowUpperLeftX = 120;
    l.windowUpperLeftY = 80.5;
    const p = mapLayouts(doc)[1]!.plot!;
    expect(p.standardScaleType).toBe(16);
    expect(p.plotType).toBe(4);
    expect(p.window).toEqual({ min: { x: -5, y: 10 }, max: { x: 120, y: 80.5 } });
    // A custom scale (flag 16 off): DXF 75 means nothing.
    l.flags = ((l.flags as number) & ~16) as never;
    expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('standardScaleType');
  });

  // M2-45: DXF 1, the named page setup the layout has applied ("current page setup"). AutoCAD
  // writes '' for none; acad-ts reads a LAYOUT without the group as 'none_device'.
  it('reads the page setup name the layout has applied (DXF 1), left out for none', () => {
    const { doc, sheet: l } = read();
    for (const none of ['', 'none_device']) {
      l.pageName = none;
      expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('pageSetupName');
    }
    l.pageName = 'A3 Monochrome';
    expect(mapLayouts(doc)[1]!.plot!.pageSetupName).toBe('A3 Monochrome');
    // Triya's DXF saves before acad-ts patch 0180 wrote the layout's own name there: no page
    // setup, unless the drawing has a named page setup of that name.
    l.pageName = l.name.toUpperCase();
    expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('pageSetupName');
    const dict = doc.rootDictionary!.get(CadDictionary.acadPlotSettings) as CadDictionary;
    const same = new PlotSettings(l.name);
    same.pageName = l.name;
    dict.add(same);
    expect(mapLayouts(doc)[1]!.plot!.pageSetupName).toBe(l.name.toUpperCase());
  });

  it('reads inch paper and keeps an unknown rotation or unit to the defaults', () => {
    const { doc, sheet: l } = read();
    l.paperUnits = 0;
    expect(mapLayouts(doc)[1]!.plot!.paperUnits).toBe('inches');
    (l as { paperUnits: number }).paperUnits = 7;
    (l as { paperRotation: number }).paperRotation = 9;
    const p = mapLayouts(doc)[1]!.plot!;
    expect(p.paperUnits).toBe('millimeters');
    expect(p.rotation).toBe(0);
  });
});

// M2-17 part 6: the named page setups AutoCAD's Plot dialog lists (ACAD_PLOTSETTINGS entries).
describe('mapPageSetups', () => {
  function named(): { doc: CadDocument; a3: PlotSettings; fit: PlotSettings } {
    const { doc } = read();
    const dict = doc.rootDictionary!.get(CadDictionary.acadPlotSettings) as CadDictionary;
    const a3 = new PlotSettings('A3 Monochrome');
    a3.pageName = 'A3 Monochrome';
    a3.paperSize = 'ISO_full_bleed_A3_(420.00_x_297.00_MM)';
    a3.paperWidth = 420;
    a3.paperHeight = 297;
    a3.plotType = 5 as never;
    a3.styleSheet = 'monochrome.ctb';
    a3.flags = (16 | 32 | 128) as never;
    a3.scaledFit = 16 as never;
    dict.add(a3);
    const fit = new PlotSettings('Model A1 Fit');
    fit.pageName = 'Model A1 Fit';
    fit.paperSize = 'ISO_full_bleed_A1_(841.00_x_594.00_MM)';
    fit.paperWidth = 841;
    fit.paperHeight = 594;
    fit.plotType = 1 as never;
    fit.flags = (1024 | 16 | 4 | 32 | 128) as never;
    fit.scaledFit = 0 as never;
    dict.add(fit);
    return { doc, a3, fit };
  }

  it("maps each entry with its settings, model space's by flag 1024, by name", () => {
    const { doc, a3, fit } = named();
    const out = mapPageSetups(doc);
    expect(out.map((p) => [p.name, p.model])).toEqual([
      ['A3 Monochrome', false],
      ['Model A1 Fit', true],
    ]);
    expect(out[0]).toEqual(
      expect.objectContaining({
        type: 'PLOTSETTINGS',
        handle: H(a3),
        owner: H(a3.owner!),
        plot: expect.objectContaining({
          paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
          paperWidth: 420,
          plotType: 5,
          standardScaleType: 16,
          styleSheet: 'monochrome.ctb',
          flags: 16 | 32 | 128,
        }),
      }),
    );
    expect(out[1]!.handle).toBe(H(fit));
    expect(out[1]!.plot.standardScaleType).toBe(0);
    // A layout's own page setup is not a named one.
    expect(out.some((p) => p.name === 'Sheet' || p.name === 'Model')).toBe(false);
  });

  it('reads them from a DXF, where they open as objects of the drawing', () => {
    const { doc } = named();
    const back = readCadDocument(writeCadDocument(doc, { format: 'dxf' }));
    expect(mapPageSetups(back).map((p) => p.name)).toEqual(['A3 Monochrome', 'Model A1 Fit']);
    const objects = openDocument(back).init.objects ?? [];
    expect(objects.filter((o) => o.type === 'PLOTSETTINGS').length).toBe(2);
  });
});
