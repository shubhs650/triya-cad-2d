// M6-01 part 3: the Page Setup Manager's edits of named page setups in the engine session (New,
// Import, Modify, Rename, Delete, Set Current), each one PAGESETUP undo step, refusing what
// AutoCAD refuses.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  MODEL_PAGE_SETUP,
  namedPageSetups,
  nextPageSetupName,
  pageSetupNamed,
  plotTransparencyOf,
  type DocumentInit,
  type LayoutPlot,
  type NamedPageSetup,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, sampleInit } from '../model/fixtures';

const PLOT: LayoutPlot = {
  paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
  paperWidth: 297,
  paperHeight: 210,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 32 | 128,
};

const A3: LayoutPlot = {
  ...PLOT,
  paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
  paperWidth: 420,
  paperHeight: 297,
  styleSheet: 'monochrome.ctb',
};

const DICTIONARY = 'A0';

/** The sample with its ACAD_PLOTSETTINGS dictionary, one layout page setup in it, and two tabs. */
function init(withDictionary = true): DocumentInit {
  const base = sampleInit();
  const existing: NamedPageSetup = {
    handle: 'A1',
    type: 'PLOTSETTINGS',
    owner: DICTIONARY,
    reactors: [DICTIONARY],
    name: 'A3 Monochrome',
    model: false,
    plot: A3,
  };
  return {
    ...base,
    meta: { ...base.meta, ...(withDictionary && { plotSettingsDictionary: DICTIONARY }) },
    header: [...(base.header ?? []), ['$HANDSEED', 'B0']],
    objects: withDictionary ? [...(base.objects ?? []), existing] : (base.objects ?? []),
    layouts: [
      {
        handle: '22',
        name: 'Model',
        tabOrder: 0,
        blockRecord: MODEL_SPACE,
        plot: { ...PLOT, plotType: 1, flags: PLOT.flags | MODEL_PAGE_SETUP },
      },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE, plot: PLOT },
    ],
  };
}

const names = (s: EngineSession) => namedPageSetups(s.model).map((p) => p.name);

const refused = (s: EngineSession, e: Parameters<EngineSession['edit']>[0]) => {
  const r = s.edit(e);
  return r.ok ? 'accepted' : r.message;
};

describe('named page setups', () => {
  it('adds a page setup in ACAD_PLOTSETTINGS, one PAGESETUP undo step', async () => {
    const s = new EngineSession(init());
    expect(nextPageSetupName(s.model)).toBe('Setup1');
    const r = s.edit({
      kind: 'page-setup-new',
      setup: { name: ' Setup1 ', model: false, plot: { ...PLOT, pageSetupName: 'Old' } },
    });
    if (!r.ok) throw new Error(r.message);
    const made = pageSetupNamed(s.model, 'setup1')!;
    // Filed in the dictionary, which it lists as its reactor, as AutoCAD files one; a named page
    // setup names no applied page setup of its own.
    expect(made).toMatchObject({ name: 'Setup1', owner: DICTIONARY, reactors: [DICTIONARY] });
    expect(made.plot).toEqual(PLOT);
    expect(r.change.objects?.added).toHaveLength(1);
    expect(names(s)).toEqual(['A3 Monochrome', 'Setup1']);
    expect(nextPageSetupName(s.model)).toBe('Setup2');
    expect(s.undoState.nextUndo).toBe('PAGESETUP');
    await s.command({ kind: 'submit', text: 'U' });
    expect(names(s)).toEqual(['A3 Monochrome']);
  });

  it("gives a model space page setup flag 1024 and a layout's none", () => {
    const s = new EngineSession(init());
    s.edit({ kind: 'page-setup-new', setup: { name: 'Model Fit', model: true, plot: PLOT } });
    const page = pageSetupNamed(s.model, 'Model Fit')!;
    expect(page.model).toBe(true);
    expect(page.plot.flags & MODEL_PAGE_SETUP).toBe(MODEL_PAGE_SETUP);
    // Model space has no Layout plot area: it plots its extents.
    expect(page.plot.plotType).toBe(1);
    s.edit({
      kind: 'page-setup-new',
      setup: { name: 'Sheet', model: false, plot: { ...PLOT, flags: PLOT.flags | 1024 } },
    });
    expect(pageSetupNamed(s.model, 'Sheet')!.plot.flags & MODEL_PAGE_SETUP).toBe(0);
  });

  it('keeps "Plot transparency" in the page setup\'s PLOTTRANSPARENCY xdata', () => {
    const s = new EngineSession(init());
    const r = s.edit({
      kind: 'page-setup-new',
      setup: { name: 'Glass', model: false, plot: PLOT, plotTransparency: true },
    });
    if (!r.ok) throw new Error(r.message);
    // The application registered in the same undo step.
    expect(r.change.tables?.appIds?.added?.map((a) => a.name)).toEqual(['PLOTTRANSPARENCY']);
    const page = pageSetupNamed(s.model, 'Glass')!;
    expect(plotTransparencyOf(s.model, page)).toBe(true);
    s.edit({ kind: 'page-setup-edit', setup: page.handle, plotTransparency: false });
    expect(plotTransparencyOf(s.model, pageSetupNamed(s.model, 'Glass')!)).toBe(false);
  });

  it('modifies and renames a page setup, keeping its handle', async () => {
    const s = new EngineSession(init());
    const r = s.edit({
      kind: 'page-setup-edit',
      setup: 'A1',
      name: 'A3 Colour',
      plot: { ...A3, styleSheet: 'acad.ctb' },
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.change.objects?.updated).toHaveLength(1);
    const page = pageSetupNamed(s.model, 'A3 Colour')!;
    expect(page.handle).toBe('A1');
    expect(page.plot.styleSheet).toBe('acad.ctb');
    // A case-only rename is a rename; the same name and settings change nothing.
    expect(s.edit({ kind: 'page-setup-edit', setup: 'A1', name: 'A3 COLOUR' }).ok).toBe(true);
    expect(names(s)).toEqual(['A3 COLOUR']);
    expect(
      s.edit({ kind: 'page-setup-edit', setup: 'A1', name: 'A3 COLOUR', plot: page.plot }),
    ).toEqual({ ok: true, change: {} });
    await s.command({ kind: 'submit', text: 'U' });
    await s.command({ kind: 'submit', text: 'U' });
    expect(pageSetupNamed(s.model, 'A3 Monochrome')?.plot).toEqual(A3);
  });

  it('deletes a page setup; a layout that names it keeps its settings', () => {
    const s = new EngineSession(init());
    s.edit({ kind: 'page-setup-current', setup: 'A1', layout: '1E' });
    const r = s.edit({ kind: 'page-setup-delete', setup: 'A1' });
    if (!r.ok) throw new Error(r.message);
    expect(r.change.objects?.removed).toHaveLength(1);
    expect(names(s)).toEqual([]);
    expect(s.model.layouts[1]?.plot).toEqual({ ...A3, pageSetupName: 'A3 Monochrome' });
  });

  it('sets a page setup current: the layout takes its settings and names it', () => {
    const s = new EngineSession(init());
    s.edit({
      kind: 'page-setup-edit',
      setup: 'A1',
      plotTransparency: true,
    });
    const r = s.edit({ kind: 'page-setup-current', setup: 'A1', layout: '1E' });
    if (!r.ok) throw new Error(r.message);
    const layout = s.model.layouts[1]!;
    expect(layout.plot).toEqual({ ...A3, pageSetupName: 'A3 Monochrome' });
    expect(plotTransparencyOf(s.model, layout)).toBe(true);
    expect(s.undoState.nextUndo).toBe('PAGESETUP');
    // Again: nothing changes.
    expect(s.edit({ kind: 'page-setup-current', setup: 'A1', layout: '1E' })).toEqual({
      ok: true,
      change: {},
    });
  });

  it('imports page setups, redefining one of the same name when asked', () => {
    const s = new EngineSession(init());
    const setups = [
      { name: 'Model A1 Fit', model: true, plot: { ...PLOT, plotType: 1 } },
      { name: 'a3 monochrome', model: false, plot: PLOT },
    ];
    expect(refused(s, { kind: 'page-setup-import', setups })).toBe(
      'A page setup named "A3 Monochrome" already exists.',
    );
    expect(names(s)).toEqual(['A3 Monochrome']);
    const r = s.edit({ kind: 'page-setup-import', setups, replace: true });
    if (!r.ok) throw new Error(r.message);
    expect(names(s)).toEqual(['A3 Monochrome', 'Model A1 Fit']);
    // Redefined in place: the handle and the name as the drawing had it stay.
    expect(pageSetupNamed(s.model, 'A3 Monochrome')).toMatchObject({ handle: 'A1', plot: PLOT });
    expect(
      refused(s, {
        kind: 'page-setup-import',
        setups: [
          { name: 'Twice', model: false, plot: PLOT },
          { name: 'TWICE', model: false, plot: PLOT },
        ],
      }),
    ).toBe('"TWICE" is listed twice.');
  });

  it('refuses what AutoCAD refuses', () => {
    const s = new EngineSession(init());
    const add = (name: string, plot = PLOT, model = false) =>
      refused(s, { kind: 'page-setup-new', setup: { name, model, plot } });
    expect(add('')).toBe('Invalid page setup name.');
    expect(add('A<B')).toBe('Invalid page setup name.');
    expect(add('x'.repeat(256))).toBe('Invalid page setup name.');
    // Named for their scale, as page setups commonly are.
    expect(add('A1 1:100')).toBe('accepted');
    expect(add('a3 MONOCHROME')).toBe('A page setup named "A3 Monochrome" already exists.');
    expect(add('Zero', { ...PLOT, paperWidth: 0 })).toBe(
      'Invalid page setup: the paper size must be greater than 0.',
    );
    expect(add('View', { ...PLOT, plotType: 3 })).toBe(
      'Invalid page setup: the View plot area needs a view.',
    );
    expect(refused(s, { kind: 'page-setup-edit', setup: 'FF', name: 'X' })).toBe(
      'Page setup not found.',
    );
    add('Other');
    const other = pageSetupNamed(s.model, 'Other')!.handle;
    expect(refused(s, { kind: 'page-setup-edit', setup: other, name: 'A3 Monochrome' })).toBe(
      'A page setup named "A3 Monochrome" already exists.',
    );
    // A layouts' page setup is not model space's, and the other way round.
    expect(refused(s, { kind: 'page-setup-current', setup: 'A1', layout: '22' })).toBe(
      '"A3 Monochrome" is a page setup for layouts.',
    );
    add('Model', PLOT, true);
    const model = pageSetupNamed(s.model, 'Model')!.handle;
    expect(refused(s, { kind: 'page-setup-current', setup: model, layout: '1E' })).toBe(
      '"Model" is a page setup for model space.',
    );
    expect(
      refused(s, {
        kind: 'page-setup-import',
        setups: [{ name: 'model', model: false, plot: PLOT }],
        replace: true,
      }),
    ).toBe('"Model" is a page setup for model space.');
    // A drawing without ACAD_PLOTSETTINGS cannot hold named page setups.
    const bare = new EngineSession(init(false));
    expect(
      refused(bare, { kind: 'page-setup-new', setup: { name: 'X', model: false, plot: PLOT } }),
    ).toBe('This drawing has no page setup dictionary (ACAD_PLOTSETTINGS).');
  });
});
