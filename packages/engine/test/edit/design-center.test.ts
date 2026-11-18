// M5-11: Design-Center-lite. What a drawing offers DesignCenter by category, and bringing it
// into another drawing as AutoCAD 2024's DesignCenter does (AutoCAD Help, "To Add Content with
// DesignCenter": "if a definition is a duplicate of one in the drawing, it is ignored"; "To
// Insert a Block with DesignCenter": a block dragged in is inserted with automatic scaling, and
// Insert Block... opens the Insert dialog): each item comes with what it names under new
// handles, a duplicate keeps the drawing's own (and brings nothing with it), and a block is
// inserted where it was dropped, in the drawing's units, one ADCENTER undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  addDesignCenterItem,
  compareHandles,
  designCenterContent,
  designCenterItem,
  isDesignCenterItem,
  type AttdefGeometry,
  type DesignCenterItem,
  type DialogRequest,
  type DimStyleRecord,
  type InsertGeometry,
  type LayerRecord,
  type MLeaderStyleRecord,
  type TableStyleRecord,
  type TextStyleRecord,
  type ViewRequest,
} from '../../src/index';
import { setup } from '../commands/edit-harness';
import { blockRecord, entityInit, layer, lineGeom, linetype, sampleInit } from '../model/fixtures';

// Engine tests have no Node or DOM types (TESTING.md); Node has it.
declare const structuredClone: <T>(value: T) => T;

const HIDDEN = '60';
const PIPES = '61';
const VALVE = '62';
const NUT = '63';
const ANON = '64';
const XREF = '65';
const XLAYER = '66';
const TAG = '6A';

const attdef: AttdefGeometry = {
  kind: 'ATTDEF',
  tag: 'SIZE',
  prompt: 'Valve size',
  value: 'DN50',
  flags: 0,
  style: '16',
  position: { x: 0, y: 2 },
  height: 0.25,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
} as AttdefGeometry;

/**
 * The drawing items come from, in inches: layer PIPES on linetype HIDDEN, block VALVE (inches)
 * drawn on PIPES and holding NUT, an anonymous block, an xref with a layer of its own, a text
 * style, dimension style ISO-25 with a sub-style, a multileader style and a table style.
 */
function source(withAttribute = false): DocumentModel {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    meta: { ...base.meta!, insUnits: 1 },
    handSeed: '200',
    tables: {
      ...base.tables,
      layers: [
        ...(base.tables?.layers ?? []),
        { ...layer(PIPES, 'PIPES'), linetype: HIDDEN },
        { ...layer(XLAYER, 'SITE|ROADS'), flags: 48 } as LayerRecord,
      ],
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        linetype('67', 'ByLayer'),
        linetype('68', 'ByBlock'),
        linetype(HIDDEN, 'HIDDEN'),
      ],
      textStyles: [{ handle: '69', name: 'Labels', font: 'romans.shx' } as TextStyleRecord],
      dimStyles: [
        { handle: '6B', name: 'ISO-25', vars: { DIMTXT: 2.5 } } as DimStyleRecord,
        { handle: '6C', name: 'ISO-25$2', vars: { DIMTXT: 3 } } as DimStyleRecord,
      ],
      mleaderStyles: [{ handle: '6D', name: 'Callout' } as MLeaderStyleRecord],
      tableStyles: [
        { handle: '6E', name: 'Schedule', cellStyles: [] } as unknown as TableStyleRecord,
      ],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        { ...blockRecord(VALVE, 'VALVE'), units: 1 },
        blockRecord(NUT, 'NUT'),
        blockRecord(ANON, '*U1'),
        { ...blockRecord(XREF, 'SITE'), flags: 4 },
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: VALVE, name: 'VALVE', basePoint: { x: 0, y: 0 } },
      { handle: NUT, name: 'NUT', basePoint: { x: 0, y: 0 } },
      { handle: ANON, name: '*U1', basePoint: { x: 0, y: 0 } },
      { handle: XREF, name: 'SITE', basePoint: { x: 0, y: 0 } },
    ],
    entities: [
      ...(base.entities ?? []),
      entityInit('70', lineGeom(-1, 0, 1, 0), { owner: VALVE, layer: PIPES }),
      entityInit(
        '71',
        {
          kind: 'INSERT',
          block: NUT,
          position: { x: 1, y: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        } as unknown as InsertGeometry,
        { owner: VALVE },
      ),
      ...(withAttribute ? [entityInit(TAG, attdef, { owner: VALVE })] : []),
      entityInit('72', lineGeom(0, 0, 0.5, 0), { owner: NUT }),
      entityInit('73', lineGeom(0, 0, 1, 1), { owner: ANON }),
    ],
  });
}

const named = <T extends { name: string }>(
  m: ReadonlyMap<string, T>,
  name: string,
): T | undefined => [...m.values()].find((r) => r.name.toUpperCase() === name.toUpperCase());

function item(model: DocumentModel, category: DesignCenterItem['category'], name: string) {
  const i = designCenterItem(model, category, name);
  expect(i).toBeDefined();
  // What the app sends a drawing's engine crosses by structured clone.
  return structuredClone(i!);
}

describe('designCenterContent: what a drawing offers', () => {
  it('lists each category by name, without layout, anonymous and xref blocks or xref records', () => {
    expect(designCenterContent(source())).toEqual({
      blocks: ['NUT', 'VALVE'],
      dimstyles: ['ISO-25'],
      layers: ['0', 'PIPES', 'WALLS'],
      linetypes: ['Continuous', 'HIDDEN'],
      mleaderstyles: ['Callout'],
      tablestyles: ['Schedule'],
      textstyles: ['Labels'],
    });
  });

  it('offers no item it does not list', () => {
    const s = source();
    expect(designCenterItem(s, 'blocks', '*U1')).toBeUndefined();
    expect(designCenterItem(s, 'blocks', 'SITE')).toBeUndefined();
    expect(designCenterItem(s, 'layers', 'SITE|ROADS')).toBeUndefined();
    expect(designCenterItem(s, 'linetypes', 'BYLAYER')).toBeUndefined();
    expect(designCenterItem(s, 'layers', 'NONE')).toBeUndefined();
    expect(designCenterItem(s, 'layers', 'pipes')?.name).toBe('PIPES');
  });
});

describe('addDesignCenterItem: one item brought into another drawing', () => {
  it('adds a layer with the linetype it names, under new handles above $HANDSEED', () => {
    const t = setup().model;
    const seed = t.handSeed;
    const b = new ChangeSetBuilder(t);
    expect(addDesignCenterItem(b, t, item(source(), 'layers', 'PIPES'))).toBe(true);
    t.apply(b.build());
    const pipes = named(t.tables.layers, 'PIPES')!;
    const hidden = named(t.tables.linetypes, 'HIDDEN')!;
    expect(pipes.linetype).toBe(hidden.handle);
    for (const h of [pipes.handle, hidden.handle]) {
      expect(compareHandles(h, seed)).toBeGreaterThanOrEqual(0);
    }
  });

  it('ignores a duplicate, keeping the drawing’s own and bringing nothing with it', () => {
    const t = setup().model;
    const s = source();
    // The target's PIPES is on Continuous: the source's HIDDEN does not come with a duplicate.
    const b0 = new ChangeSetBuilder(t);
    b0.addTableRecord('layers', { ...layer('', 'pipes'), linetype: '14' });
    t.apply(b0.build());
    const before = t.version;
    const b = new ChangeSetBuilder(t);
    expect(addDesignCenterItem(b, t, item(s, 'layers', 'PIPES'))).toBe(false);
    expect(addDesignCenterItem(b, t, item(s, 'blocks', 'NUT'))).toBe(true);
    t.apply(b.build());
    expect(t.version).toBeGreaterThan(before);
    expect(named(t.tables.linetypes, 'HIDDEN')).toBeUndefined();
    expect(named(t.tables.layers, 'PIPES')!.linetype).toBe('14');
  });

  it('adds a block with its contents, its layers and the blocks it holds', () => {
    const t = setup().model;
    const b = new ChangeSetBuilder(t);
    expect(addDesignCenterItem(b, t, item(source(), 'blocks', 'VALVE'))).toBe(true);
    t.apply(b.build());
    const valve = named(t.tables.blockRecords, 'VALVE')!;
    const nut = named(t.tables.blockRecords, 'NUT')!;
    expect(valve.units).toBe(1);
    const inside = t.blockEntities(valve.handle).map((id) => t.entity(id)!);
    expect(inside.map((e) => e.geom.kind)).toEqual(['LINE', 'INSERT']);
    expect(inside[0]!.layer).toBe(named(t.tables.layers, 'PIPES')!.handle);
    expect((inside[1]!.geom as InsertGeometry).block).toBe(nut.handle);
    expect(t.blockEntities(nut.handle)).toHaveLength(1);
  });

  it('adds a dimension style with its sub-styles, and each other kind of style', () => {
    const t = setup().model;
    const s = source();
    const b = new ChangeSetBuilder(t);
    for (const [c, n] of [
      ['dimstyles', 'ISO-25'],
      ['textstyles', 'Labels'],
      ['mleaderstyles', 'Callout'],
      ['tablestyles', 'Schedule'],
      ['linetypes', 'HIDDEN'],
    ] as const) {
      expect(addDesignCenterItem(b, t, item(s, c, n))).toBe(true);
    }
    t.apply(b.build());
    expect([...t.tables.dimStyles.values()].map((d) => d.name).sort()).toEqual([
      'ISO-25',
      'ISO-25$2',
    ]);
    expect(named(t.tables.textStyles, 'Labels')).toBeDefined();
    expect(named(t.tables.mleaderStyles, 'Callout')).toBeDefined();
    expect(named(t.tables.tableStyles, 'Schedule')).toBeDefined();
    expect(named(t.tables.linetypes, 'HIDDEN')).toBeDefined();
  });

  it('tells an item from other data', () => {
    expect(isDesignCenterItem(item(source(), 'layers', 'PIPES'))).toBe(true);
    for (const x of [
      undefined,
      null,
      'PIPES',
      { category: 'layers', name: 'PIPES' },
      { category: 'xrefs', name: 'A', content: { entities: [], blockEntities: [], blocks: [] } },
      { category: 'layers', name: 1, content: {} },
    ]) {
      expect(isDesignCenterItem(x)).toBe(false);
    }
  });
});

/** The drawing items go into, in millimetres (the harness's: layers 0 and WALLS, block B). */
const target = () => setup();

const inserts = (t: ReturnType<typeof setup>) => t.space().filter((e) => e.geom.kind === 'INSERT');

describe('PromptBus.designCenter: Add, drag and Insert Block...', () => {
  it('adds the items as one ADCENTER step, saying what was added and what was ignored', async () => {
    const t = target();
    const s = source();
    await t.bus.designCenter({
      items: [
        item(s, 'layers', 'PIPES'),
        item(s, 'layers', 'WALLS'),
        item(s, 'textstyles', 'Labels'),
      ],
    });
    expect(t.bus.command).toBeUndefined();
    expect(t.log).toEqual([
      'Layer(s) added: PIPES.',
      'Text style(s) added: Labels.',
      'Duplicate definitions ignored: layer WALLS.',
    ]);
    expect(t.bus.undo.state.nextUndo).toBe('ADCENTER');
    await t.bus.script(['U']);
    expect(named(t.model.tables.layers, 'PIPES')).toBeUndefined();
    expect(named(t.model.tables.textStyles, 'Labels')).toBeUndefined();
  });

  it('makes no undo step when every item is a duplicate', async () => {
    const t = target();
    const version = t.model.version;
    await t.bus.designCenter({ items: [item(source(), 'layers', 'WALLS')] });
    expect(t.model.version).toBe(version);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('inserts a dropped block at the drop point in the drawing’s units, one step with its definition', async () => {
    const t = target();
    await t.bus.designCenter({
      items: [item(source(), 'blocks', 'VALVE')],
      insert: { block: 'valve', at: { x: 100, y: 50 } },
    });
    expect(t.bus.command).toBeUndefined();
    const [ref] = inserts(t);
    const g = ref!.geom as InsertGeometry;
    expect(g.block).toBe(named(t.model.tables.blockRecords, 'VALVE')!.handle);
    expect(g.position).toEqual({ x: 100, y: 50 });
    // Inches into millimetres: 25.4, as INSERT converts (INSUNITS).
    expect(g.scale).toEqual({ x: 25.4, y: 25.4, z: 25.4 });
    expect(g.rotation).toBe(0);
    expect(t.bus.undo.state.nextUndo).toBe('ADCENTER');
    await t.bus.script(['U']);
    expect(inserts(t)).toHaveLength(0);
    expect(named(t.model.tables.blockRecords, 'VALVE')).toBeUndefined();
  });

  it('inserts the drawing’s own block of the name, asking its attribute values', async () => {
    const t = target();
    // From the drawing itself: nothing to copy, block B inserted as it is.
    await t.bus.designCenter({ items: [], insert: { block: 'B', at: { x: 5, y: 5 } } });
    expect(inserts(t)).toHaveLength(1);
    const s = source(true);
    await t.bus.designCenter({
      items: [item(s, 'blocks', 'VALVE')],
      insert: { block: 'VALVE', at: { x: 0, y: 0 } },
    });
    expect(t.bus.prompt?.message).toBe('Valve size');
    await t.bus.submit('DN80');
    expect(t.bus.command).toBeUndefined();
    const valve = inserts(t).find((e) => (e.geom as InsertGeometry).block !== '50')!;
    const attribs = (valve.geom as InsertGeometry).attributes;
    expect(attribs.map((a) => (a as unknown as { value: string }).value)).toEqual(['DN80']);
  });

  it('opens the Insert dialog on the block for Insert Block...', async () => {
    const t = target();
    await t.bus.designCenter({
      items: [item(source(), 'blocks', 'NUT')],
      insert: { block: 'NUT' },
    });
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    const d = p!.dialog as Extract<DialogRequest, { type: 'insert' }>;
    expect(d.settings.name).toBe('NUT');
    expect(d.blocks.map((b) => b.name)).toEqual(['B', 'NUT']);
    await t.bus.cancel();
    // The definition stays, as INSERT's Browse... leaves the block it made.
    expect(named(t.model.tables.blockRecords, 'NUT')).toBeDefined();
  });

  it('refuses a block the drawing cannot insert, and cancels a running command first', async () => {
    const t = target();
    await t.bus.script(['LINE']);
    await t.bus.designCenter({ items: [], insert: { block: 'NOPE', at: { x: 0, y: 0 } } });
    expect(t.bus.command).toBeUndefined();
    expect(t.log).toContain('Block "NOPE" not found.');
  });
});

describe('ADCENTER and ADCCLOSE', () => {
  it('open and close DesignCenter (aliases ADC, DC, DCENTER)', async () => {
    const asked: ViewRequest[] = [];
    const bus = new PromptBus({
      model: DocumentModel.create(sampleInit()),
      registry: builtinCommands(),
      view: {
        request: (r) => {
          asked.push(r);
          return Promise.resolve({ ok: true });
        },
      },
    });
    await bus.script(['ADCENTER', 'ADC', 'DC', 'DCENTER', 'ADCCLOSE']);
    expect(asked).toEqual([
      ...Array(4).fill({ op: 'palette', palette: 'designcenter', open: true }),
      { op: 'palette', palette: 'designcenter', open: false },
    ]);
  });

  it('runs a design-center input, leaving out what is not an item', async () => {
    const s = new EngineSession(sampleInit());
    const layerItem = item(source(), 'layers', 'PIPES');
    await s.command({
      kind: 'design-center',
      drop: { items: [layerItem, { name: 'X' } as never], insert: { block: 7 } as never },
    });
    expect(named(s.model.tables.layers, 'PIPES')).toBeDefined();
    expect(s.undoState.nextUndo).toBe('ADCENTER');
    await s.command({
      kind: 'design-center',
      drop: { items: [], insert: { block: 'NONE', at: { x: NaN, y: 0 } } },
    });
    expect(s.undoState.nextUndo).toBe('ADCENTER');
  });
});
