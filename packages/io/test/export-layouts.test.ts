// TriyaToAcad for LAYOUT objects (M1-75 part 20): a layout tab's name, tab order, limits,
// PSLTSCALE / LIMCHECK flags and page setup. The drawing is authored in memory with acad-ts and
// saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Layout as AcadLayout,
  Line,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type Layout, type LayoutPlot } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

interface Options {
  /** Set the header's $PLIMMIN / $PLIMMAX, $PLIMCHECK and $PSLTSCALE to Layout1's own. */
  readonly headerAgrees?: boolean;
}

/**
 * Model, Layout1 (on *Paper_Space, an A3 page setup with a standard scale) and Layout2 (on
 * *Paper_Space0, a custom 1:2 scale, with a line drawn on its sheet), as AutoCAD saves them:
 * Model's plot flags carry ModelType.
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  options: Options = {},
): Uint8Array {
  const doc = new CadDocument(version);
  // A new acad-ts document has no LAYOUT objects; AutoCAD links each space block to one.
  const layouts = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
  const sheet2 = new BlockRecord('*Paper_Space0');
  doc.blockRecords!.add(sheet2);
  sheet2.entities.add(new Line(new XYZ(10, 10, 0), new XYZ(100, 50, 0)));
  const made: AcadLayout[] = [];
  for (const [name, space, tab] of [
    ['Model', doc.modelSpace!, 0],
    ['Layout1', doc.paperSpace!, 1],
    ['Layout2', sheet2, 2],
  ] as const) {
    const layout = new AcadLayout(name);
    layouts.add(layout);
    layout.associatedBlock = space;
    layout.tabOrder = tab;
    made.push(layout);
  }
  const [model, one, two] = made as [AcadLayout, AcadLayout, AcadLayout];
  model.flags = 11952 as never; // 1024 ModelType | 512 | 128 | 32 | 16 | … as AutoCAD saves it
  model.plotType = 0 as never;
  one.flags = 688 as never; // 512 | 128 | 32 | 16: a standard scale
  one.plotType = 5 as never;
  one.paperSize = 'ISO_A3_(420.00_x_297.00_MM)';
  one.paperWidth = 420;
  one.paperHeight = 297;
  one.paperUnits = 1 as never;
  one.minLimits = new XY(-20, -7.5);
  one.maxLimits = new XY(400, 289.5);
  two.flags = 672 as never; // no 16: the custom scale 142 / 143 applies
  two.plotType = 5 as never;
  two.numeratorScale = 1;
  two.denominatorScale = 2;
  if (options.headerAgrees) {
    const h = doc.header!;
    h.paperSpaceLimitsMin = new XY(-20, -7.5);
    h.paperSpaceLimitsMax = new XY(400, 289.5);
    h.paperSpaceLimitsChecking = false;
    h.paperSpaceLineTypeScaling = 1 as never;
    one.layoutFlags = 1 as never; // PSLTSCALE on, LIMCHECK off
  }
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const layout = (model: DocumentModel, name: string): Layout =>
  model.layouts.find((l) => l.name === name)!;

/** Saves `model` over a fresh read of `bytes` and reads the result. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat): CadDocument {
  return readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
}

/** A layout as it maps back, without the reader's link. */
const comparable = ({ raw: _raw, ...rest }: Layout) => rest;

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/** Why a save of `bytes` with the edit `f` is refused. */
function refused(
  f: (b: ChangeSetBuilder, model: DocumentModel) => void,
  bytes = drawing(),
): string[] {
  const model = open(bytes);
  edit(model, (b) => f(b, model));
  return refusal(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' }));
}

const plotOf = (model: DocumentModel, name: string): LayoutPlot => layout(model, name).plot!;

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

describe('LAYOUT objects', () => {
  it.each(SAVES)(
    'writes a renamed, reordered layout with a new page setup and limits (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      edit(model, (b) => {
        // LAYOUT Rename, dragging Layout2's tab in front of Layout1, PAGESETUP, LIMITS.
        const one = layout(model, 'Layout1');
        const two = layout(model, 'Layout2');
        b.updateLayout(one.handle, { name: 'Elevations', tabOrder: 2 });
        b.updateLayout(two.handle, {
          name: 'Plans',
          tabOrder: 1,
          flags: 2,
          limits: { min: { x: 0, y: 0 }, max: { x: 841, y: 594 } },
          plot: {
            ...two.plot!,
            paperSize: 'ISO_A1_(841.00_x_594.00_MM)',
            paperWidth: 841,
            paperHeight: 594,
            margins: { left: 5, bottom: 7.5, right: 5, top: 7.5 },
            paperUnits: 'millimeters',
            rotation: 1,
            origin: { x: 2.5, y: -1 },
            scale: { numerator: 1, denominator: 50 },
            plotType: 1,
            flags: 672 | 1 | 64, // + PlotViewportBorders, ScaleLineweights
          },
        });
      });
      const doc = saved(bytes, model, format);
      const back = documentInit(doc).layouts!;
      expect(back.map(comparable)).toEqual(model.layouts.map(comparable));
      expect(back.map((l) => l.name)).toEqual(['Model', 'Plans', 'Elevations']);
      // The ACAD_LAYOUT dictionary lists each layout under its new name.
      const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
      expect([...dict.entryNames].sort()).toEqual(['Elevations', 'Model', 'Plans']);
      expect(dict.get('Plans')).toBe(doc.layouts!.get('Plans'));
      // The rest of the drawing maps as it did.
      const { layouts: _a, ...rest } = documentInit(doc);
      const { layouts: _b, ...was } = documentInit(readCadDocument(bytes));
      expect(JSON.stringify({ ...rest, header: undefined, meta: undefined })).toBe(
        JSON.stringify({ ...was, header: undefined, meta: undefined }),
      );
    },
  );

  it('lets two layouts trade names', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => {
      b.updateLayout(layout(model, 'Layout1').handle, { name: 'Layout2' });
      b.updateLayout(layout(model, 'Layout2').handle, { name: 'layout1' });
    });
    const back = documentInit(saved(bytes, model, 'dxf')).layouts!;
    expect(back.map(comparable)).toEqual(model.layouts.map(comparable));
  });

  it('keeps the header limits, LIMCHECK and PSLTSCALE in step with the current layout', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dxf', { headerAgrees: true });
    const limits = { min: { x: 0, y: 0 }, max: { x: 594, y: 420 } };
    // Changing the layout alone would leave AutoCAD's $PLIMMIN / $PLIMMAX on the old limits.
    expect(
      refused((b, m) => b.updateLayout(layout(m, 'Layout1').handle, { limits, flags: 2 }), bytes),
    ).toEqual([
      expect.stringMatching(/Layout1 .*: limits: \$PLIMMIN and \$PLIMMAX state the current/),
      expect.stringMatching(/Layout1 .*: PSLTSCALE \(flag 1\): \$PSLTSCALE states the current/),
      expect.stringMatching(/Layout1 .*: LIMCHECK \(flag 2\): \$PLIMCHECK states the current/),
    ]);
    // With the header changed alike (LIMITS and PSLTSCALE in a layout set both), it saves.
    const model = open(bytes);
    const was = model.header;
    const flag = (v: unknown, on: boolean) => (typeof v === 'boolean' ? on : on ? 1 : 0);
    edit(model, (b) => {
      b.updateLayout(layout(model, 'Layout1').handle, { limits, flags: 2 });
      b.setHeader('$PLIMMIN', limits.min);
      b.setHeader('$PLIMMAX', limits.max);
      b.setHeader('$PSLTSCALE', flag(was.get('$PSLTSCALE'), false));
      b.setHeader('$PLIMCHECK', flag(was.get('$PLIMCHECK'), true));
    });
    const back = documentInit(saved(bytes, model, 'dxf'));
    expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
    expect(new Map(back.header).get('$PLIMMAX')).toEqual(limits.max);
    // A layout that is not current has no header variables of its own.
    expect(
      refused((b, m) => b.updateLayout(layout(m, 'Layout2').handle, { limits, flags: 2 }), bytes),
    ).toEqual([]);
  });

  it('refuses names AutoCAD refuses', () => {
    const rename = (from: string, name: string) =>
      refused((b, m) => b.updateLayout(layout(m, from).handle, { name }));
    expect(rename('Model', 'Space')).toEqual([
      expect.stringMatching(/layout Space .*: the Model layout cannot be renamed/),
    ]);
    expect(rename('Layout1', 'model')).toEqual([
      expect.stringMatching(/layout model .*: Model is the model layout's name/),
    ]);
    expect(rename('Layout1', 'LAYOUT2')).toEqual([
      expect.stringMatching(/layout LAYOUT2 .*: another layout is named LAYOUT2/),
    ]);
    expect(rename('Layout1', '')).toEqual([expect.stringMatching(/: a layout needs a name/)]);
    for (const name of ['A*B', 'Plan: east', 'x'.repeat(256)]) {
      expect(rename('Layout1', name)).toEqual([
        expect.stringMatching(/is not a valid layout name/),
      ]);
    }
  });

  it('refuses tab orders AutoCAD does not keep', () => {
    const tabs = (orders: Record<string, number>) =>
      refused((b, m) => {
        for (const [name, tabOrder] of Object.entries(orders))
          b.updateLayout(layout(m, name).handle, { tabOrder });
      });
    expect(tabs({ Model: 1, Layout1: 0 })).toEqual([
      expect.stringMatching(/layout Model .*: the Model tab is always first \(tab order 0\)/),
      expect.stringMatching(/layout tabs: the layouts' tab orders are not 1 to 2/),
    ]);
    expect(tabs({ Layout1: 2 })).toEqual([
      expect.stringMatching(/layout tabs: the layouts' tab orders are not 1 to 2/),
    ]);
    expect(tabs({ Layout1: 3, Layout2: 1 })).toEqual([
      expect.stringMatching(/layout tabs: the layouts' tab orders are not 1 to 2/),
    ]);
    expect(tabs({ Layout1: 1.5 })).toEqual([
      expect.stringMatching(/tabOrder: 1.5 is not a whole number/),
      expect.stringMatching(/layout tabs/),
    ]);
  });

  it('refuses limits, flags and page setups AutoCAD does not take', () => {
    const update = (name: string, patch: (m: DocumentModel) => Partial<Layout>) =>
      refused((b, m) => b.updateLayout(layout(m, name).handle, patch(m)));
    const plot = (name: string, p: Partial<LayoutPlot>) =>
      update(name, (m) => ({ plot: { ...plotOf(m, name), ...p } }));
    expect(
      update('Layout1', () => ({ limits: { min: { x: 0, y: 0 }, max: { x: 0, y: 10 } } })),
    ).toEqual([
      expect.stringMatching(/limits: the upper right corner is not above and right of the lower/),
    ]);
    expect(
      update('Layout1', () => ({ limits: { min: { x: 0, y: Number.NaN }, max: { x: 1, y: 1 } } })),
    ).toEqual([expect.stringMatching(/limits: each value is a number/)]);
    expect(update('Layout1', () => ({ flags: 1 | 4 }))).toEqual([
      expect.stringMatching(/flags: 5 has bits other than 1 \(PSLTSCALE\) and 2 \(LIMCHECK\)/),
    ]);
    expect(update('Layout1', (m) => ({ blockRecord: layout(m, 'Layout2').blockRecord }))).toEqual([
      expect.stringMatching(/blockRecord: a layout keeps its block record/),
    ]);
    expect(update('Layout1', () => ({ xdata: [] }))).toEqual([
      expect.stringMatching(/xdata changes/),
    ]);
    expect(update('Layout1', () => ({ plot: undefined }) as unknown as Partial<Layout>)).toEqual([
      expect.stringMatching(/plot: a layout keeps its page setup/),
    ]);
    expect(plot('Layout1', { paperWidth: 0, paperHeight: -1 })).toEqual([
      expect.stringMatching(/paperWidth: 0 is not a number more than 0/),
      expect.stringMatching(/paperHeight: -1 is not a number more than 0/),
    ]);
    expect(plot('Layout1', { margins: { left: -1, bottom: 0, right: 0, top: 0 } })).toEqual([
      expect.stringMatching(/margins: each value is a number of 0 or more/),
    ]);
    expect(plot('Layout1', { paperSize: 3 as never })).toEqual([
      expect.stringMatching(/paperSize: 3 is not text/),
    ]);
    expect(plot('Layout1', { paperUnits: 'feet' as never, rotation: 4 as never })).toEqual([
      expect.stringMatching(/paperUnits: "feet" is not inches, millimeters or pixels/),
      expect.stringMatching(/rotation: 4 is not 0, 1, 2 or 3/),
    ]);
    expect(plot('Layout1', { origin: { x: Number.POSITIVE_INFINITY, y: 0 } })).toEqual([
      expect.stringMatching(/origin: each value is a number/),
    ]);
    expect(plot('Layout2', { scale: { numerator: 1, denominator: 0 } })).toEqual([
      expect.stringMatching(/scale: each value is a number more than 0/),
    ]);
    // Plot area View and Window name a view (DXF 6) and a window (48, 49, 140, 141).
    expect(plot('Layout1', { plotType: 3 })).toEqual([
      expect.stringMatching(/plotType: 3 \(View\) needs the view name, which Triya does not map/),
    ]);
    expect(plot('Layout1', { plotType: 4 })).toEqual([
      expect.stringMatching(/plotType: 4 \(Window\) needs the window, which Triya does not map/),
    ]);
    expect(plot('Layout1', { plotType: 6 })).toEqual([
      expect.stringMatching(/plotType: 6 is not a whole number from 0 to 5/),
    ]);
    expect(plot('Model', { plotType: 5 })).toEqual([
      expect.stringMatching(/plotType: the Model layout has no layout to plot \(5\)/),
    ]);
    // Flag 16: the scale is the standard one DXF 75 names, which Triya does not map.
    expect(plot('Layout2', { flags: 672 | 16 })).toEqual([
      expect.stringMatching(/flags: a standard scale \(16\) is chosen by DXF 75/),
    ]);
    expect(plot('Layout1', { scale: { numerator: 1, denominator: 100 } })).toEqual([
      expect.stringMatching(/scale: the layout plots at a standard scale \(flag 16\)/),
    ]);
    expect(plot('Layout1', { flags: 688 | 256 })).toEqual([
      expect.stringMatching(/flags: 944 has bits AutoCAD does not define \(256\)/),
    ]);
    expect(plot('Layout1', { flags: 688 | 1024 })).toEqual([
      expect.stringMatching(/flags: ModelType \(1024\) marks the Model layout's page setup/),
    ]);
  });

  it('accepts a custom scale chosen in place of a standard one', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => {
      const l = layout(model, 'Layout1');
      b.updateLayout(l.handle, {
        plot: { ...l.plot!, flags: 688 & ~16, scale: { numerator: 1, denominator: 20 } },
      });
    });
    const back = documentInit(saved(bytes, model, 'dwg')).layouts!;
    expect(back.map(comparable)).toEqual(model.layouts.map(comparable));
  });

  it('refuses layout changes in drawings before R2000, which introduced layouts', () => {
    const problems = refused(
      (b, m) => b.updateLayout(layout(m, 'Layout1').handle, { name: 'Sheet' }),
      drawing(ACadVersion.AC1014, 'dwg'),
    );
    expect(problems).toEqual([expect.stringMatching(/AC1014 has no layouts \(R2000 added them\)/)]);
  });

  it('refuses a layout added or removed without its block', () => {
    const bytes = drawing();
    const init = documentInit(readCadDocument(bytes));
    const [model, one, two] = init.layouts!;
    const less = DocumentModel.create({ ...init, layouts: [model!, one!] });
    expect(refusal(() => exportDocument(readCadDocument(bytes), less, { format: 'dxf' }))).toEqual([
      expect.stringMatching(
        /layout Layout2 .*: its block \*Paper_Space0 \(.*\) stays; LAYOUT Delete takes it/,
      ),
    ]);
    // A second layout on Layout2's sheet.
    const more = DocumentModel.create({
      ...init,
      layouts: [model!, one!, two!, { ...two!, handle: 'FFF0', name: 'Layout3', tabOrder: 3 }],
    });
    expect(refusal(() => exportDocument(readCadDocument(bytes), more, { format: 'dxf' }))).toEqual([
      expect.stringMatching(
        /layout Layout3 \(FFF0\): a new layout comes with a new \*Paper_Space block/,
      ),
    ]);
  });
});

/** Layout1's A3 page setup at a custom scale: DXF 75, which names a standard one, is not mapped. */
const sheetPlot = (m: DocumentModel): LayoutPlot => ({ ...plotOf(m, 'Layout1'), flags: 672 });

describe('LAYOUT New and Delete', () => {
  /**
   * What the drawing maps to, without what LAYOUT New and Delete change (BLOCK and ENDBLK, which
   * Triya does not map, are among the passthrough handles: `changedPassthrough` checks those).
   */
  const rest = (doc: CadDocument) => {
    const {
      layouts: _l,
      blocks: _b,
      entities: _e,
      tables,
      header: _h,
      meta: _m,
      handSeed: _s,
      passthrough: _p,
      ...others
    } = documentInit(doc);
    const { blockRecords: _r, ...otherTables } = tables ?? {};
    return JSON.parse(JSON.stringify({ ...others, tables: otherTables })) as unknown;
  };

  /** The passthrough objects one of `a`, `b` has and the other not, by DXF name. */
  const changedPassthrough = (a: CadDocument, b: CadDocument): string[] => {
    const [x, y] = [a, b].map((d) => new Set(documentInit(d).passthrough));
    const names = (d: CadDocument, hs: string[]) =>
      hs.map((h) => d.getCadObject(Number.parseInt(h, 16))?.objectName ?? h);
    return [
      ...names(
        a,
        [...x!].filter((h) => !y!.has(h)),
      ),
      ...names(
        b,
        [...y!].filter((h) => !x!.has(h)),
      ),
    ].sort();
  };

  it.each(SAVES)('writes a new layout and draws on its sheet (%s %s)', (version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const two = layout(model, 'Layout2');
    let sheet!: Layout;
    edit(model, (b) => {
      sheet = b.addLayout({
        name: 'Details',
        flags: 1,
        limits: { min: { x: 0, y: 0 }, max: { x: 594, y: 420 } },
        plot: {
          ...two.plot!,
          paperSize: 'ISO_A2_(594.00_x_420.00_MM)',
          paperWidth: 594,
          paperHeight: 420,
        },
      });
      b.addEntity({
        owner: sheet.blockRecord,
        layer: model.tables.layers.keys().next().value!,
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 594, y: 420 } },
      });
    });
    const doc = saved(bytes, model, format);
    const back = documentInit(doc);
    expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
    // Its block is the next *Paper_Space, linked both ways, and holds the line.
    const record = back.tables!.blockRecords!.find((r) => r.handle === sheet.blockRecord);
    expect(record).toMatchObject({ name: '*Paper_Space1', layout: sheet.handle });
    expect(back.blocks!.find((d) => d.handle === sheet.blockRecord)?.basePoint).toEqual({
      x: 0,
      y: 0,
    });
    const lines = back.entities!.filter((e) => e.owner === sheet.blockRecord);
    expect(lines.map((e) => e.geom)).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 594, y: 420 } },
    ]);
    // The ACAD_LAYOUT dictionary lists it; nothing else changes.
    const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
    expect(dict.get('Details')).toBe(doc.layouts!.get('Details'));
    expect(doc.layouts!.get('Details')!.associatedBlock?.name).toBe('*Paper_Space1');
    expect(rest(doc)).toEqual(rest(readCadDocument(bytes)));
    expect(changedPassthrough(readCadDocument(bytes), doc)).toEqual(['BLOCK', 'ENDBLK']);
    expect(back.entities!.length).toBe(documentInit(readCadDocument(bytes)).entities!.length + 1);
  });

  it.each(SAVES)(
    'removes a layout with its block and what is on its sheet (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      const two = layout(model, 'Layout2');
      const was = documentInit(readCadDocument(bytes));
      expect(was.entities!.filter((e) => e.owner === two.blockRecord)).toHaveLength(1);
      edit(model, (b) => b.removeLayout(two.handle));
      const doc = saved(bytes, model, format);
      const back = documentInit(doc);
      expect(back.layouts!.map((l) => l.name)).toEqual(['Model', 'Layout1']);
      expect(back.tables!.blockRecords!.some((r) => r.handle === two.blockRecord)).toBe(false);
      expect(back.blocks!.some((d) => d.handle === two.blockRecord)).toBe(false);
      expect(back.entities!.length).toBe(was.entities!.length - 1);
      const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
      expect([...dict.entryNames].sort()).toEqual(['Layout1', 'Model']);
      expect(doc.getCadObject(Number.parseInt(two.handle, 16))).toBeNull();
      expect(rest(doc)).toEqual(rest(readCadDocument(bytes)));
      expect(changedPassthrough(readCadDocument(bytes), doc)).toEqual(['BLOCK', 'ENDBLK']);
    },
  );

  it('deletes a layout and makes another in one save', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => {
      b.removeLayout(layout(model, 'Layout2').handle);
      // *Paper_Space0 goes in the same save, so the new sheet is *Paper_Space1.
      b.addLayout({
        name: 'Layout2',
        limits: layout(model, 'Layout1').limits!,
        plot: sheetPlot(model),
      });
    });
    const back = documentInit(saved(bytes, model, 'dwg'));
    expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
    const sheet = model.layouts.find((l) => l.name === 'Layout2')!;
    expect(back.tables!.blockRecords!.find((r) => r.handle === sheet.blockRecord)?.name).toBe(
      '*Paper_Space1',
    );
  });

  it('refuses what LAYOUT New and Delete do not do', () => {
    // AutoCAD makes another layout current before deleting the current one, which moves
    // *Paper_Space to that layout's block.
    expect(refused((b, m) => b.removeLayout(layout(m, 'Layout1').handle))).toEqual([
      expect.stringMatching(
        /layout Layout1 .*: the current layout \(on \*Paper_Space\) goes only once another is made current/,
      ),
    ]);
    // Every layout is set up for plotting.
    expect(refused((b) => b.addLayout({ name: 'Sheet' }))).toEqual([
      expect.stringMatching(/layout Sheet .*: a new layout needs its limits/),
      expect.stringMatching(/layout Sheet .*: a new layout needs its page setup/),
    ]);
    const full = (m: DocumentModel) => ({
      limits: layout(m, 'Layout1').limits!,
      plot: sheetPlot(m),
    });
    expect(refused((b, m) => b.addLayout({ name: 'layout1', ...full(m) }))).toEqual([
      expect.stringMatching(/layout layout1 .*: another layout is named layout1/),
    ]);
    expect(refused((b, m) => b.addLayout({ name: 'A|B', ...full(m) }))).toEqual([
      expect.stringMatching(/is not a valid layout name/),
    ]);
    expect(refused((b, m) => b.addLayout({ name: 'Sheet', tabOrder: 5, ...full(m) }))).toEqual([
      expect.stringMatching(/layout tabs: the layouts' tab orders are not 1 to 3/),
    ]);
    expect(
      refused((b, m) => {
        const sheet = b.addLayout({ name: 'Sheet', ...full(m) });
        b.updateBlock(sheet.blockRecord, { basePoint: { x: 5, y: 5 } });
      }),
    ).toEqual([expect.stringMatching(/a new layout's block has its base point at 0,0/)]);
    expect(
      refused(
        (b, m) => b.addLayout({ name: 'Sheet', ...full(m) }),
        drawing(ACadVersion.AC1014, 'dwg'),
      ),
    ).toEqual([expect.stringMatching(/AC1014 has no layouts \(R2000 added them\)/)]);
  });
});

describe('Making another layout current', () => {
  const recordName = (doc: CadDocument, h: string) =>
    (doc.getCadObject(Number.parseInt(h, 16)) as BlockRecord | null)?.name;
  const paperHeader = (m: Map<string, unknown> | ReadonlyMap<string, unknown>) =>
    Object.fromEntries(
      [...m].filter(([k]) => /^\$P(LIM|SLTSCALE|INSBASE|EXT|ELEVATION|UCS)/.test(k)),
    );

  it.each(SAVES)(
    'swaps *Paper_Space to the new current layout and the header to its state (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format, { headerAgrees: true });
      const model = open(bytes);
      const [one, two] = [layout(model, 'Layout1'), layout(model, 'Layout2')];
      const was = documentInit(readCadDocument(bytes));
      edit(model, (b) => b.setCurrentLayout(two.handle));
      expect(model.header.get('$PLIMMAX')).toEqual(two.limits!.max);
      const doc = saved(bytes, model, format);
      // The sheet blocks keep their handles and swap names.
      expect([recordName(doc, two.blockRecord), recordName(doc, one.blockRecord)]).toEqual([
        '*Paper_Space',
        '*Paper_Space0',
      ]);
      expect(doc.paperSpace?.handle.toString(16).toUpperCase()).toBe(two.blockRecord);
      const back = documentInit(doc);
      expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
      expect(paperHeader(new Map(back.header))).toEqual(paperHeader(model.header));
      // Layout2's line is on its sheet, now the current one, as it was.
      expect(back.entities).toEqual(was.entities);
    },
  );

  it.each(SAVES)(
    'deletes the layout that was current once another is (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format, { headerAgrees: true });
      const model = open(bytes);
      const [one, two] = [layout(model, 'Layout1'), layout(model, 'Layout2')];
      edit(model, (b) => {
        b.setCurrentLayout(two.handle);
        b.removeLayout(one.handle);
      });
      const doc = saved(bytes, model, format);
      const back = documentInit(doc);
      expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
      expect(back.layouts!.map((l) => l.name)).toEqual(['Model', 'Layout2']);
      expect(recordName(doc, two.blockRecord)).toBe('*Paper_Space');
      expect(doc.getCadObject(Number.parseInt(one.blockRecord, 16))).toBeNull();
      expect(doc.getCadObject(Number.parseInt(one.handle, 16))).toBeNull();
      expect(back.entities!.filter((e) => e.owner === two.blockRecord)).toHaveLength(1);
    },
  );

  it('writes a layout whose space changes', () => {
    const bytes = drawing();
    const model = open(bytes);
    const two = layout(model, 'Layout2');
    const space = {
      ...two.space!,
      insertionBase: { x: 5, y: 6, z: 0 },
      extents: { min: { x: 1, y: 2, z: 0 }, max: { x: 300, y: 200, z: 0 } },
    };
    edit(model, (b) => b.updateLayout(two.handle, { space }));
    expect(
      layout(open(exportDocument(readCadDocument(bytes), model, { format: 'dxf' })), 'Layout2')
        .space,
    ).toEqual(space);
  });

  it('refuses a switch the header or the blocks do not follow', () => {
    const agreeing = drawing(ACadVersion.AC1032, 'dxf', { headerAgrees: true });
    // The header stated Layout1's limits, so it must state Layout2's.
    expect(
      refused((b, m) => {
        b.setCurrentLayout(layout(m, 'Layout2').handle);
        b.setHeader('$PLIMMAX', layout(m, 'Layout1').limits!.max);
      }, agreeing),
    ).toEqual([
      expect.stringMatching(
        /layout Layout2 .*: made current, \$PLIMMAX states the current layout's; set it to Layout2's/,
      ),
    ]);
    // A layout the same save adds cannot be made current yet.
    expect(
      refused((b, m) => {
        const sheet = b.addLayout({
          name: 'Sheet',
          limits: layout(m, 'Layout1').limits!,
          plot: sheetPlot(m),
        });
        b.setCurrentLayout(sheet.handle);
      }, agreeing),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/layout Sheet .*: made current, but a layout the same save adds/),
      ]),
    );
    // Values a space cannot have.
    expect(
      refused((b, m) => {
        const two = layout(m, 'Layout2');
        b.updateLayout(two.handle, { space: { ...two.space!, elevation: Number.NaN } });
      }),
    ).toEqual([expect.stringMatching(/layout Layout2 .*: space: each value is a number/)]);
  });
});
