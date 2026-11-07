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
  XY,
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
 * *Paper_Space0, a custom 1:2 scale), as AutoCAD saves them: Model's plot flags carry ModelType.
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

  it('refuses a layout added or removed outside a change set', () => {
    const bytes = drawing();
    const init = documentInit(readCadDocument(bytes));
    const [model, one, two] = init.layouts!;
    const less = DocumentModel.create({ ...init, layouts: [model!, one!] });
    expect(refusal(() => exportDocument(readCadDocument(bytes), less, { format: 'dxf' }))).toEqual([
      expect.stringMatching(/layout Layout2 .*: removing a layout/),
    ]);
    const more = DocumentModel.create({
      ...init,
      layouts: [model!, one!, two!, { ...two!, handle: 'FFF0', name: 'Layout3', tabOrder: 3 }],
    });
    expect(refusal(() => exportDocument(readCadDocument(bytes), more, { format: 'dxf' }))).toEqual([
      expect.stringMatching(/layout Layout3 \(FFF0\): adding a layout/),
    ]);
  });
});
