// M2-08: DRAWORDER, TEXTTOFRONT and HATCHTOBACK on the PromptBus (AutoCAD 2024 Help: DRAWORDER,
// TEXTTOFRONT, HATCHTOBACK (Command)). They write the block's SORTENTSTABLE, never the block's
// own order: the drawing order checked here is the one the renderer draws
// (`drawOrder` in @triya/render: ascending sort handle, own handle without an entry).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  blockDrawOrder,
  builtinCommands,
  moveInDrawOrder,
  rearranged,
  sortTableOf,
  writeDrawOrder,
  type BusEvent,
  type DocumentInit,
  type EntityId,
  type EntityInit,
  type SortEntsTable,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  MODEL_SPACE,
  PAPER_SPACE,
  blockRecord,
  entityInit,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const text = (handle: string, owner = MODEL_SPACE): EntityInit =>
  entityInit(
    handle,
    {
      kind: 'TEXT',
      position: { x: 0, y: 0 },
      alignmentPoint: { x: 0, y: 0 },
      height: 1,
      rotation: 0,
      halign: 0,
      valign: 0,
      text: 'A',
      style: '0',
      widthFactor: 1,
      oblique: 0,
    } as never,
    { owner },
  );

const hatch = (handle: string): EntityInit =>
  entityInit(handle, { kind: 'HATCH', loops: [] } as never);

/**
 * Model space 20, 21 (circle), 23, then 25 (text), 26 (hatch), 27 (line); paper space 24 and
 * 28 (text). The model-space block record has an extension dictionary 50, paper space none.
 */
function init(extra: Partial<DocumentInit> = {}): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [
        { ...blockRecord(MODEL_SPACE, '*Model_Space'), extDict: '50' },
        blockRecord(PAPER_SPACE, '*Paper_Space'),
      ],
    },
    entities: [
      ...base.entities!,
      text('25'),
      hatch('26'),
      entityInit('27', lineGeom(3, 3, 4, 4)),
      text('28', PAPER_SPACE),
    ],
    ...extra,
  };
}

function setup(i: DocumentInit = init(), picked: () => EntityId[] = () => []) {
  const model = DocumentModel.create(i);
  const view: ViewHost = {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(r.op === 'pick' ? { ok: true, ids: picked() } : { ok: false, message: '' }),
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const order = (block = MODEL_SPACE) => {
    const b = new ChangeSetBuilder(model);
    return blockDrawOrder(model, block, sortTableOf(b, model, block)).map((e) =>
      model.ids.handleOf(e.id)!,
    );
  };
  const id = (h: string) => model.entityByHandle(h)!.id;
  const table = (block = MODEL_SPACE) =>
    [...model.objects.values()].find(
      (o) => o.type === 'SORTENTSTABLE' && (o as SortEntsTable).block === block,
    ) as SortEntsTable | undefined;
  return { model, bus, log, order, id, table };
}

describe('DRAWORDER', () => {
  it('asks for an ordering option, Back by default, and sends the objects back', async () => {
    let picks: EntityId[] = [];
    const s = setup(init(), () => picks);
    picks = [s.id('27')];
    await s.bus.script(['DR', '3,3', '']);
    expect(s.bus.promptText).toBe(
      'Enter object ordering option [Above objects/Under objects/Front/Back] <Back>:',
    );
    await s.bus.script(['']);
    expect(s.order()).toEqual(['27', '20', '21', '23', '25', '26']);
    // The block itself keeps its order; the table, new, is in the record's own dictionary.
    expect(s.model.blockEntities(MODEL_SPACE).map((i) => s.model.ids.handleOf(i))).toEqual([
      '20',
      '21',
      '23',
      '25',
      '26',
      '27',
    ]);
    expect(s.table()).toMatchObject({ owner: '50', reactors: ['50'], block: MODEL_SPACE });
  });

  it('brings objects to the front, keeping their own order', async () => {
    let picks: EntityId[] = [];
    const t = setup(init(), () => picks);
    picks = [t.id('20')];
    await t.bus.script(['DRAWORDER', '0,0']);
    picks = [t.id('21')];
    await t.bus.script(['5,5', '', 'F']);
    expect(t.order()).toEqual(['23', '25', '26', '27', '20', '21']);
    // Both to the front again: nothing moves, nothing changes.
    const before = t.table();
    picks = [t.id('20')];
    await t.bus.script(['DRAWORDER', '0,0']);
    picks = [t.id('21')];
    await t.bus.script(['5,5', '', 'F']);
    expect(t.table()).toBe(before);
  });

  it('puts objects just above or under the reference objects', async () => {
    let picks: EntityId[] = [];
    const s = setup(init(), () => picks);
    picks = [s.id('27')];
    await s.bus.script(['DRAWORDER', '3,3', '', 'U']);
    expect(s.bus.promptText).toBe('Select reference objects:');
    picks = [s.id('21')];
    await s.bus.script(['5,5', '']);
    expect(s.order()).toEqual(['20', '27', '21', '23', '25', '26']);
    picks = [s.id('20')];
    await s.bus.script(['DRAWORDER', '0,0', '', 'A']);
    picks = [s.id('25')];
    await s.bus.script(['0,0', '']);
    expect(s.order()).toEqual(['27', '21', '23', '25', '20', '26']);
  });

  it('ends on Enter with nothing selected, or no reference objects', async () => {
    let picks: EntityId[] = [];
    const s = setup(init(), () => picks);
    await s.bus.script(['DRAWORDER', '']);
    expect(s.bus.command).toBeUndefined();
    picks = [s.id('27')];
    await s.bus.script(['DRAWORDER', '3,3', '', 'A', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.table()).toBeUndefined();
  });

  it('creates the record’s extension dictionary when it has none', () => {
    const s = setup();
    const b = new ChangeSetBuilder(s.model);
    moveInDrawOrder(b, s.model, [s.id('24')], { to: 'front' });
    s.model.apply(b.build());
    expect(s.order(PAPER_SPACE)).toEqual(['28', '24']);
    const dict = s.model.tables.blockRecords.get(PAPER_SPACE)!.extDict!;
    expect(dict).toBeDefined();
    expect(s.table(PAPER_SPACE)).toMatchObject({ owner: dict, reactors: [dict] });
  });
});

describe('draw order tables', () => {
  it('hands out the sort handles in use, keeping the entries of objects Triya does not map', () => {
    // 3A is an unmapped object of model space drawn as 22.
    const s = setup(
      init({
        objects: [
          {
            handle: '60',
            type: 'SORTENTSTABLE',
            owner: '50',
            block: MODEL_SPACE,
            entries: [
              { entity: '3A', sort: '22' },
              { entity: '20', sort: '2A' },
            ],
          } as SortEntsTable,
        ],
      }),
    );
    expect(s.order()).toEqual(['21', '23', '25', '26', '27', '20']);
    const b = new ChangeSetBuilder(s.model);
    moveInDrawOrder(b, s.model, [s.id('20')], { to: 'back' });
    s.model.apply(b.build());
    expect(s.order()).toEqual(['20', '21', '23', '25', '26', '27']);
    // The sort handles in use (21 … 27 and 2A) handed out in the new order; the unmapped
    // object's entry stays first, as read.
    expect(s.table()!.entries[0]).toEqual({ entity: '3A', sort: '22' });
    expect(s.table()!.entries.slice(1)).toEqual([
      { entity: '20', sort: '21' },
      { entity: '21', sort: '23' },
      { entity: '23', sort: '25' },
      { entity: '25', sort: '26' },
      { entity: '26', sort: '27' },
      { entity: '27', sort: '2A' },
    ]);
  });

  it('falls back to the objects’ own handles when sort handles repeat', () => {
    const s = setup(
      init({
        objects: [
          {
            handle: '60',
            type: 'SORTENTSTABLE',
            owner: '50',
            block: MODEL_SPACE,
            entries: [{ entity: '20', sort: '21' }],
          } as SortEntsTable,
        ],
      }),
    );
    const b = new ChangeSetBuilder(s.model);
    const order = ['27', '26', '25', '23', '21', '20'].map(s.id);
    expect(writeDrawOrder(b, s.model, MODEL_SPACE, order)).toBe(true);
    s.model.apply(b.build());
    expect(s.order()).toEqual(['27', '26', '25', '23', '21', '20']);
  });

  it('leaves an order that needs no table alone', () => {
    const s = setup();
    const b = new ChangeSetBuilder(s.model);
    expect(
      writeDrawOrder(b, s.model, MODEL_SPACE, ['20', '21', '23', '25', '26', '27'].map(s.id)),
    ).toBe(false);
  });

  it('rearranges only what it is given, and nothing without reference objects', () => {
    const order = [1, 2, 3, 4] as unknown as EntityId[];
    const ids = new Set([2] as unknown as EntityId[]);
    expect(rearranged(order, new Set(), { to: 'front' })).toEqual(order);
    expect(
      rearranged(order, ids, { to: 'above', reference: [2] as unknown as EntityId[] }),
    ).toEqual(order);
  });
});

describe('TEXTTOFRONT and HATCHTOBACK', () => {
  it('brings text, dimensions and leaders of every layout to the front', async () => {
    const s = setup();
    await s.bus.script(['TEXTTOFRONT']);
    expect(s.bus.promptText).toBe('Bring to front [Text/Dimensions/Leaders/All] <All>:');
    await s.bus.script(['']);
    expect(s.log.at(-1)).toBe('2 objects brought to front.');
    expect(s.order()).toEqual(['20', '21', '23', '26', '27', '25']);
    expect(s.order(PAPER_SPACE)).toEqual(['24', '28']);
    await s.bus.script(['TEXTTOFRONT', 'D']);
    expect(s.log.at(-1)).toBe('0 objects brought to front.');
    await s.bus.script(['TEXTTOFRONT', 'T']);
    expect(s.log.at(-1)).toBe('2 objects brought to front.');
  });

  it('sends every hatch to the back, leaving locked layers alone', async () => {
    const s = setup();
    await s.bus.script(['HATCHTOBACK']);
    expect(s.log.at(-1)).toBe('1 hatch object sent to back.');
    expect(s.order()).toEqual(['26', '20', '21', '23', '25', '27']);
    const base = init();
    const locked = setup({
      ...base,
      tables: {
        ...base.tables,
        layers: base.tables!.layers!.map((l) =>
          l.handle === LAYER_0 ? { ...l, locked: true } : l,
        ),
      },
    });
    await locked.bus.script(['HATCHTOBACK']);
    expect(locked.log.at(-1)).toBe('0 hatch objects sent to back.');
  });
});
