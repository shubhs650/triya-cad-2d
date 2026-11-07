// TriyaToAcad for draw order (M1-75 part 7): SORTENTSTABLE objects, which DRAWORDER,
// TEXTTOFRONT and HATCHTOBACK (M2-08) edit, are written edited, new or removed. The drawing is
// authored in memory with acad-ts and saved once, so "the file" is real bytes; every corpus
// SORTENTSTABLE is edited in packages/testkit/src/export/export.corpus.test.ts.
import { ACadVersion, CadDocument, Line, XYZ } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Handle,
  type NonGraphicalObject,
  type SortEntsTable,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/**
 * Three LINEs in model space, whose draw order puts the first on top (a SORTENTSTABLE in the
 * model space record's extension dictionary), and one LINE in paper space, whose record has no
 * extension dictionary.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const lines = [0, 1, 2].map((i) => new Line(new XYZ(0, i, 0), new XYZ(10, i, 0)));
  for (const l of lines) doc.entities!.add(l);
  doc.paperSpace!.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(5, 5, 0)));
  const table = doc.modelSpace!.createSortEntitiesTable();
  // Registering assigns the handles; the first line then draws as if it were the last.
  table.add(lines[0]!, lines[2]!.handle + 1);
  return writeCadDocument(doc, { format });
}

function open(bytes: Uint8Array): DocumentModel {
  return DocumentModel.create(documentInit(readCadDocument(bytes)));
}

/** `updateObject` with a draw order table's own fields. */
const patchTable = (b: ChangeSetBuilder, handle: Handle, patch: Partial<SortEntsTable>) =>
  b.updateObject(handle, patch as Partial<NonGraphicalObject>);

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const blockNamed = (model: DocumentModel, name: string): Handle =>
  [...model.blocks.values()].find((b) => b.name.toUpperCase() === name)!.handle;

const tables = (objects: readonly NonGraphicalObject[] | undefined): SortEntsTable[] =>
  (objects ?? []).filter((o): o is SortEntsTable => o.type === 'SORTENTSTABLE');

const tableOf = (model: DocumentModel, block: Handle): SortEntsTable | undefined =>
  tables([...model.objects.values()]).find((t) => t.block === block);

const handlesIn = (model: DocumentModel, block: Handle): Handle[] =>
  model.blockEntities(block).map((id) => model.entity(id)!.handle);

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat = 'dxf') {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** The table as it maps back, without the reader's link. */
function comparable(t: SortEntsTable | undefined) {
  if (!t) return t;
  const { raw: _raw, ...rest } = t;
  return rest;
}

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('draw order (SORTENTSTABLE)', () => {
  it.each(formats)('writes an edited table (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const table = tableOf(model, ms)!;
    const [a, b, c] = handlesIn(model, ms);
    // DRAWORDER: c to the bottom, b above everything; a's entry goes.
    const entries = [
      { entity: c!, sort: '1' },
      { entity: b!, sort: 'FFFF' },
    ];
    edit(model, (bld) => patchTable(bld, table.handle, { entries }));

    const back = tables(saved(bytes, model, format).objects).find((t) => t.block === ms);
    expect(comparable(back)).toEqual(comparable(model.objects.get(table.handle) as SortEntsTable));
    expect(a).toBeDefined();
  });

  it.each(formats)('writes a new entity into the draw order (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const table = tableOf(model, ms)!;
    let added: Handle = '';
    edit(model, (bld) => {
      const e = bld.addEntity({
        owner: ms,
        layer: [...model.tables.layers.values()][0]!.handle,
        geom: { kind: 'POINT', position: { x: 1, y: 1 } },
      } as never);
      added = e.handle;
      // TEXTTOFRONT puts it below everything else.
      patchTable(bld, table.handle, { entries: [...table.entries, { entity: added, sort: '2' }] });
    });

    const back = tables(saved(bytes, model, format).objects).find((t) => t.block === ms);
    expect(back?.entries).toContainEqual({ entity: added, sort: '2' });
    expect(comparable(back)).toEqual(comparable(model.objects.get(table.handle) as SortEntsTable));
  });

  it.each(formats)('adds a table to a block without an extension dictionary (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const ps = blockNamed(model, '*PAPER_SPACE');
    expect(model.tables.blockRecords.get(ps)?.extDict).toBeUndefined();
    const [line] = handlesIn(model, ps);
    let table: NonGraphicalObject | undefined;
    edit(model, (b) => {
      // The record's new extension dictionary holds the table, as AutoCAD makes it.
      const dict = model.handles.allocate();
      b.updateTableRecord('blockRecords', ps, { extDict: dict });
      table = b.addObject({
        type: 'SORTENTSTABLE',
        owner: dict,
        reactors: [dict],
        block: ps,
        entries: [{ entity: line!, sort: '1' }],
      } as Omit<SortEntsTable, 'handle'>);
    });

    const init = saved(bytes, model, format);
    const back = tables(init.objects).find((t) => t.block === ps);
    expect(comparable(back)).toEqual(comparable(table as SortEntsTable));
    const record = init.tables?.blockRecords?.find((r) => r.handle === ps);
    expect(record?.extDict).toBe(table!.owner);
  });

  it.each(formats)('adds a table to a block with an extension dictionary (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const old = tableOf(model, ms)!;
    const [a] = handlesIn(model, ms);
    let table: NonGraphicalObject | undefined;
    edit(model, (b) => {
      b.removeObject(old.handle);
      table = b.addObject({
        type: 'SORTENTSTABLE',
        owner: old.owner,
        reactors: [old.owner],
        block: ms,
        entries: [{ entity: a!, sort: '1' }],
      } as Omit<SortEntsTable, 'handle'>);
    });

    const back = tables(saved(bytes, model, format).objects).filter((t) => t.block === ms);
    expect(back.map(comparable)).toEqual([comparable(table as SortEntsTable)]);
  });

  it.each(formats)('removes a table (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const table = tableOf(model, ms)!;
    edit(model, (b) => b.removeObject(table.handle));

    const init = saved(bytes, model, format);
    expect(tables(init.objects)).toEqual([]);
    // The extension dictionary stays, empty, as AutoCAD leaves it.
    expect(init.tables?.blockRecords?.find((r) => r.handle === ms)?.extDict).toBe(table.owner);
  });

  it('drops the entry of an entity the save removes', () => {
    const bytes = drawing();
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const table = tableOf(model, ms)!;
    const first = table.entries[0]!.entity;
    edit(model, (b) => b.removeEntity(model.entityByHandle(first)!.id));

    const out = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
    // Not even a dangling 331 the reader would skip (acad-ts writes a removed entity as 0).
    const text = Array.from(out, (c) => String.fromCharCode(c)).join('');
    const object = text.slice(text.lastIndexOf('AcDbSortentsTable'));
    expect(object.slice(0, object.indexOf('\n  0\n'))).not.toMatch(/\n331\r?\n/);
    const back = tables(documentInit(readCadDocument(out)).objects).find((t) => t.block === ms);
    expect(back?.entries).toEqual([]);
  });

  it('refuses what a save cannot keep and leaves the original as it was', () => {
    const bytes = drawing();
    type Case = [string, (model: DocumentModel, b: ChangeSetBuilder) => void, RegExp];
    const ms = (m: DocumentModel) => blockNamed(m, '*MODEL_SPACE');
    const ps = (m: DocumentModel) => blockNamed(m, '*PAPER_SPACE');
    const table = (m: DocumentModel) => tableOf(m, ms(m))!;
    const cases: Case[] = [
      [
        'an entry for an entity of another block',
        (m, b) =>
          patchTable(b, table(m).handle, {
            entries: [{ entity: handlesIn(m, ps(m))[0]!, sort: '1' }],
          }),
        /not in block/,
      ],
      [
        'an entry for no entity',
        (m, b) => patchTable(b, table(m).handle, { entries: [{ entity: 'FFFFF', sort: '1' }] }),
        /not in block/,
      ],
      [
        'two entries for one entity',
        (m, b) => {
          const [a] = handlesIn(m, ms(m));
          patchTable(b, table(m).handle, {
            entries: [
              { entity: a!, sort: '1' },
              { entity: a!, sort: '2' },
            ],
          });
        },
        /more than one entry/,
      ],
      [
        'a sort handle that is not one',
        (m, b) =>
          patchTable(b, table(m).handle, {
            entries: [{ entity: handlesIn(m, ms(m))[0]!, sort: 'xyz' }],
          }),
        /sort handle/,
      ],
      [
        'a table moved to another block',
        (m, b) => patchTable(b, table(m).handle, { block: ps(m) }),
        /block changes/,
      ],
      [
        'a second table for a block',
        (m, b) =>
          b.addObject({
            type: 'SORTENTSTABLE',
            owner: table(m).owner,
            block: ms(m),
            entries: [],
          } as Omit<SortEntsTable, 'handle'>),
        /second draw order table/,
      ],
      [
        'a new table outside its block’s extension dictionary',
        (m, b) =>
          b.addObject({
            type: 'SORTENTSTABLE',
            owner: table(m).owner,
            block: ps(m),
            entries: [],
          } as Omit<SortEntsTable, 'handle'>),
        /extension dictionary/,
      ],
      [
        'an extension dictionary no new table needs',
        (m, b) => b.updateTableRecord('blockRecords', ps(m), { extDict: m.handles.allocate() }),
        /block \*Paper_Space \(\w+\): extDict changes/,
      ],
      [
        'xdata on a table',
        (m, b) =>
          patchTable(b, table(m).handle, {
            xdata: [{ appId: '12', values: [{ code: 1000, value: 'x' }] }],
          } as never),
        /xdata changes/,
      ],
    ];
    for (const [what, change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(model, b));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model, 'dxf'), what).toThrow(UnsupportedChangeError);
      expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf'), what).toThrow(message);
      expect(documentInit(doc), what).toEqual(before);
    }
  });

  it('refuses a new table in a drawing older than R14, which has no draw order', () => {
    const doc = new CadDocument(ACadVersion.AC1012);
    doc.entities!.add(new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0)));
    const bytes = writeCadDocument(doc, { format: 'dxf' });
    const model = open(bytes);
    const ms = blockNamed(model, '*MODEL_SPACE');
    edit(model, (b) => {
      const dict = model.handles.allocate();
      b.updateTableRecord('blockRecords', ms, { extDict: dict });
      b.addObject({ type: 'SORTENTSTABLE', owner: dict, block: ms, entries: [] } as Omit<
        SortEntsTable,
        'handle'
      >);
    });

    expect(() => triyaToAcad(readCadDocument(bytes), model, 'dxf')).toThrow(/R14/);
  });
});
