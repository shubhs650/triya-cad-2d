// LAYOUT objects to Triya (M1-18), on drawings authored in memory with acad-ts.
import {
  ACadVersion,
  BlockRecord,
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

describe('layouts whose block link is broken (M2-69)', () => {
  type Pair = [code: string, value: string];

  /** A DXF with Model, Layout1 and Layout2 tabs, as its group code pairs. */
  function authored(): Pair[] {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.updateCollections(true, true);
    const model = new Layout('Model');
    doc.layouts!.add(model);
    model.associatedBlock = doc.modelSpace!;
    const first = new Layout('Layout1');
    first.tabOrder = 1;
    doc.layouts!.add(first);
    first.associatedBlock = doc.paperSpace!;
    const second = new BlockRecord('*Paper_Space0');
    doc.blockRecords!.add(second);
    const sheet = new Layout('Layout2');
    sheet.tabOrder = 2;
    doc.layouts!.add(sheet);
    sheet.associatedBlock = second;
    const lines = new TextDecoder().decode(writeCadDocument(doc, { format: 'dxf' })).split(/\r?\n/);
    const out: Pair[] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i]!.trim(), lines[i + 1]!]);
    return out;
  }

  const bytes = (pairs: readonly Pair[]): Uint8Array =>
    new TextEncoder().encode(`${pairs.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`);

  /** The [start, end) ranges of each object of a type, from its 0 to the next 0. */
  function objects(pairs: readonly Pair[], type: string): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i]![0] !== '0' || pairs[i]![1] !== type) continue;
      let end = i + 1;
      while (pairs[end]![0] !== '0') end++;
      out.push([i, end]);
    }
    return out;
  }

  /** A LAYOUT's block record link: its 330 after `100 AcDbLayout` (the first 330 is its owner). */
  function breakLayoutLinks(pairs: Pair[]): void {
    for (const [s, e] of objects(pairs, 'LAYOUT')) {
      const sub = pairs.findIndex((p, i) => i >= s && i < e && p[1] === 'AcDbLayout');
      const link = pairs.findIndex((p, i) => i > sub && i < e && p[0] === '330');
      expect(link).toBeGreaterThan(0);
      pairs[link] = ['330', 'FFFA'];
    }
  }

  const mapped = (pairs: readonly Pair[]) => {
    const doc = readCadDocument(bytes(pairs));
    const names = new Map([...doc.blockRecords!].map((b) => [H(b), b.name]));
    return mapLayouts(doc).map((l) => `${l.name} ${names.get(l.blockRecord)}`);
  };

  const ALL = ['Model *Model_Space', 'Layout1 *Paper_Space', 'Layout2 *Paper_Space0'];

  it('authors a drawing whose layouts map as written', () => {
    expect(mapped(authored())).toEqual(ALL);
  });

  it("takes a layout's block record from the record that links it (BLOCK_RECORD 340)", () => {
    // ezdxf's layout_broken_links.dxf: every LAYOUT names a block record that is not there,
    // while each record's 340 still names its layout.
    const pairs = authored();
    breakLayoutLinks(pairs);
    expect(mapped(pairs)).toEqual(ALL);
  });

  it('finds the block record by name when neither side links the other', () => {
    // ezdxf's layout_broken_links_2.dxf: the records lost their 340 too. Model takes
    // *Model_Space; the paper tabs, in tab order, *Paper_Space then *Paper_Space0, 1, ….
    const pairs = authored();
    breakLayoutLinks(pairs);
    for (const [s, e] of objects(pairs, 'BLOCK_RECORD').reverse()) {
      const link = pairs.findIndex((p, i) => i >= s && i < e && p[0] === '340');
      if (link > 0) pairs.splice(link, 1);
    }
    expect(mapped(pairs)).toEqual(ALL);
  });

  it('links the record made for a BLOCK whose BLOCK_RECORD is missing', () => {
    // ezdxf's layout_missing_block_record.dxf: *Paper_Space0's record is gone; acad-ts makes
    // one for its BLOCK under a new handle, which no layout names.
    const pairs = authored();
    const [s, e] = objects(pairs, 'BLOCK_RECORD').find(([i, end]) =>
      pairs.slice(i, end).some((p) => p[0] === '2' && p[1] === '*Paper_Space0'),
    )!;
    pairs.splice(s, e - s);
    expect(mapped(pairs)).toEqual(ALL);
  });

  it('saves the links it repaired', () => {
    const pairs = authored();
    breakLayoutLinks(pairs);
    const saved = new TextDecoder()
      .decode(writeCadDocument(readCadDocument(bytes(pairs)), { format: 'dxf' }))
      .split(/\r?\n/);
    const back: Pair[] = [];
    for (let i = 0; i + 1 < saved.length; i += 2) back.push([saved[i]!.trim(), saved[i + 1]!]);
    const group = ([s, e]: [number, number], code: string, after = s) =>
      back.find((p, i) => i > after && i < e && p[0] === code)?.[1];
    const records = new Map(
      objects(back, 'BLOCK_RECORD').map((r) => [group(r, '5'), group(r, '340')]),
    );
    const links = objects(back, 'LAYOUT').map((l) => {
      const sub = back.findIndex((p, i) => i >= l[0] && i < l[1] && p[1] === 'AcDbLayout');
      const block = group(l, '330', sub);
      return block !== undefined && records.get(block) === group(l, '5');
    });
    expect(links).toEqual([true, true, true]);
  });
});
