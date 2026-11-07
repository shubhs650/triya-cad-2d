// TriyaToAcad for PURGE (M1-75 part 25): table records and block definitions the drawing no
// longer uses go from the saved file, as AutoCAD's PURGE takes them (and LAYDEL, VIEW Delete,
// the UCS dialog's Delete). A record anything left in the drawing still refers to is refused,
// whatever refers to it: an entity, another record, a header variable, xdata, or an object
// Triya does not map. Drawings are authored in memory with acad-ts and saved once, so "the
// file" is real bytes; the corpus-wide purge is in
// packages/testkit/src/export/export-purge.corpus.test.ts.
import {
  ACadVersion,
  AppId,
  BlockRecord,
  CadDocument,
  DimensionStyle,
  ExtendedDataString,
  Insert,
  Layer,
  Line,
  LineType,
  TextStyle,
  UCS,
  View,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Handle,
  type SymbolTableRecord,
  type TableName,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/**
 * Layers USED (a LINE on it, with xdata of USED_APP), SPARE, CURRENT ($CLAYER), FENCED (drawn
 * CENTER) and HELD (named only by an XRECORD Triya does not map); linetypes CENTER and DASHED;
 * text style NOTES; dimension style SPARE; applications SPARE_APP and USED_APP; UCS SPARE;
 * view SPARE; blocks EMPTY (nothing in it), OLD (a LINE, inserted nowhere) and WINDOW (inserted
 * in model space).
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const used = new Layer('USED');
  for (const name of ['SPARE', 'CURRENT', 'HELD']) doc.layers!.add(new Layer(name));
  doc.layers!.add(used);
  const center = new LineType('CENTER');
  doc.lineTypes!.add(center);
  doc.lineTypes!.add(new LineType('DASHED'));
  const fenced = new Layer('FENCED');
  doc.layers!.add(fenced);
  fenced.lineType = center;
  doc.header!.currentLayerName = 'CURRENT';
  doc.textStyles!.add(new TextStyle('NOTES'));
  doc.dimensionStyles!.add(new DimensionStyle('SPARE'));
  doc.appIds!.add(new AppId('SPARE_APP'));
  doc.appIds!.add(new AppId('USED_APP'));
  doc.uCSs!.add(new UCS('SPARE'));
  const view = new View('SPARE');
  view.height = 10;
  view.width = 10;
  view.direction = new XYZ(0, 0, 1);
  doc.views!.add(view);
  doc.blockRecords!.add(new BlockRecord('EMPTY'));
  const old = new BlockRecord('OLD');
  doc.blockRecords!.add(old);
  old.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(0, 4, 0)));
  const window = new BlockRecord('WINDOW');
  doc.blockRecords!.add(window);
  window.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(4, 0, 0)));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  doc.entities!.add(line);
  line.layer = used;
  line.extendedData.addByName('USED_APP', undefined);
  line.extendedData.getByName('USED_APP').records.push(new ExtendedDataString('tag'));
  const insert = new Insert(window);
  insert.insertPoint = new XYZ(20, 0, 0);
  doc.entities!.add(insert);
  const note = new XRecord('TRIYA_NOTE');
  doc.rootDictionary!.add(note);
  note.createEntry(330, doc.layers!.get('HELD'));
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const named = (model: DocumentModel, table: TableName, name: string): SymbolTableRecord =>
  [...(model.tables[table] as ReadonlyMap<Handle, SymbolTableRecord>).values()].find(
    (r) => r.name.toUpperCase() === name.toUpperCase(),
  )!;

const names = (model: DocumentModel, table: TableName): string[] =>
  [...(model.tables[table] as ReadonlyMap<Handle, SymbolTableRecord>).values()]
    .map((r) => r.name.toUpperCase())
    .sort();

/**
 * What PURGE (or LAYDEL, VIEW Delete, …) takes: a table's record, or a block and its record
 * (with its entities, which the engine wants gone first).
 */
function purge(b: ChangeSetBuilder, model: DocumentModel, table: TableName, name: string): void {
  const h = named(model, table, name).handle;
  if (table === 'blockRecords') {
    for (const id of model.blockEntities(h)) b.removeEntity(id);
    b.removeBlock(h);
  } else b.removeTableRecord(table, h);
}

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat): DocumentModel {
  return open(exportDocument(readCadDocument(bytes), model, { format }));
}

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
  format: CadFormat = 'dxf',
): string[] {
  const model = open(bytes);
  edit(model, (b) => f(b, model));
  return refusal(() => exportDocument(readCadDocument(bytes), model, { format }));
}

/** Every record of each table that nothing in `drawing()` uses. */
const UNUSED: readonly (readonly [TableName, string])[] = [
  ['layers', 'SPARE'],
  ['linetypes', 'DASHED'],
  ['textStyles', 'NOTES'],
  ['dimStyles', 'SPARE'],
  ['appIds', 'SPARE_APP'],
  ['ucs', 'SPARE'],
  ['views', 'SPARE'],
  ['blockRecords', 'EMPTY'],
];

const CASES: readonly (readonly [string, ACadVersion, CadFormat])[] = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2000 DWG', ACadVersion.AC1015, 'dwg'],
  ['R2000 DXF', ACadVersion.AC1015, 'dxf'],
];

describe('TriyaToAcad PURGE', () => {
  describe.each(CASES)('%s', (_label, version, format) => {
    const bytes = drawing(version, format);

    it('drops every unused record and block, and nothing else', () => {
      const model = open(bytes);
      const before = Object.fromEntries(
        UNUSED.map(([t]) => [t, names(model, t)] as const),
      ) as Record<TableName, string[]>;
      const handles = UNUSED.map(([t, n]) => named(model, t, n).handle);
      edit(model, (b) => {
        for (const [t, n] of UNUSED) purge(b, model, t, n);
      });
      const back = saved(bytes, model, format);
      for (const [t, n] of UNUSED) {
        expect(names(back, t)).toEqual(before[t].filter((x) => x !== n));
      }
      expect(handles.filter((h) => back.hasHandle(h))).toEqual([]);
      // What stays maps back as it was.
      expect(back.entityCount).toBe(model.entityCount);
      expect(named(back, 'layers', 'FENCED')).toEqual(named(model, 'layers', 'FENCED'));
    });

    it('drops a block with the entities erased from it in the same save', () => {
      const model = open(bytes);
      const old = named(model, 'blockRecords', 'OLD').handle;
      const lines = model.blockEntities(old).map((id) => model.entity(id)!.handle);
      edit(model, (b) => {
        for (const id of model.blockEntities(old)) b.removeEntity(id);
        b.removeBlock(old);
      });
      const back = saved(bytes, model, format);
      expect(names(back, 'blockRecords')).not.toContain('OLD');
      expect([old, ...lines].filter((h) => back.hasHandle(h))).toEqual([]);
    });

    it('drops a layer whose last entity is erased or moved off it in the same save', () => {
      const model = open(bytes);
      const used = named(model, 'layers', 'USED').handle;
      const line = [...model.entities()].find((e) => e.layer === used)!;
      edit(model, (b) => {
        b.updateEntity(line.id, { layer: named(model, 'layers', '0').handle });
        b.removeTableRecord('layers', used);
      });
      const back = saved(bytes, model, format);
      expect(names(back, 'layers')).not.toContain('USED');
      expect(back.entityByHandle(line.handle)!.layer).toBe(named(back, 'layers', '0').handle);

      const erased = open(bytes);
      edit(erased, (b) => {
        b.removeEntity(line.id);
        b.removeTableRecord('layers', used);
      });
      expect(names(saved(bytes, erased, format), 'layers')).not.toContain('USED');
    });

    it('drops a linetype with the layer drawn with it', () => {
      const model = open(bytes);
      edit(model, (b) => {
        purge(b, model, 'layers', 'FENCED');
        purge(b, model, 'linetypes', 'CENTER');
      });
      const back = saved(bytes, model, format);
      expect(names(back, 'layers')).not.toContain('FENCED');
      expect(names(back, 'linetypes')).not.toContain('CENTER');
    });
  });

  it('refuses a record something in the drawing still refers to, and changes nothing', () => {
    const bytes = drawing();
    const problems = (table: TableName, name: string) =>
      refused((b, model) => purge(b, model, table, name), bytes);
    expect(problems('layers', 'USED')).toEqual([
      expect.stringMatching(/^layer USED \([0-9A-F]+\): LINE [0-9A-F]+ refers to it$/),
    ]);
    expect(problems('layers', 'CURRENT')).toEqual([
      expect.stringMatching(/^layer CURRENT \([0-9A-F]+\): \$CLAYER names it$/),
    ]);
    // An object Triya does not map.
    expect(problems('layers', 'HELD')).toEqual([
      expect.stringMatching(/^layer HELD \([0-9A-F]+\): XRECORD [0-9A-F]+ refers to it$/),
    ]);
    expect(problems('linetypes', 'CENTER')).toEqual([
      expect.stringMatching(/^linetype CENTER \([0-9A-F]+\): LAYER [0-9A-F]+ refers to it$/),
    ]);
    expect(problems('appIds', 'USED_APP')).toEqual([
      expect.stringMatching(/^application USED_APP \([0-9A-F]+\): LINE [0-9A-F]+ refers to it$/),
    ]);
    expect(problems('blockRecords', 'WINDOW')).toEqual([
      expect.stringMatching(/^block WINDOW \([0-9A-F]+\): INSERT [0-9A-F]+ refers to it$/),
    ]);
    // The original is as it was: a refused save throws before anything changes.
    const original = readCadDocument(bytes);
    const model = open(bytes);
    edit(model, (b) => purge(b, model, 'layers', 'USED'));
    expect(refusal(() => exportDocument(original, model, { format: 'dxf' }))).not.toEqual([]);
    expect(original.layers!.contains('USED')).toBe(true);
  });

  it("refuses the records AutoCAD's PURGE never takes", () => {
    const bytes = drawing();
    const problems = (table: TableName, name: string) =>
      refused((b, model) => b.removeTableRecord(table, named(model, table, name).handle), bytes);
    expect(problems('layers', '0')).toContainEqual(expect.stringMatching(/0 cannot be purged$/));
    expect(problems('linetypes', 'Continuous')).toContainEqual(
      expect.stringMatching(/Continuous cannot be purged$/),
    );
    expect(problems('linetypes', 'ByLayer')).toContainEqual(
      expect.stringMatching(/ByLayer cannot be purged$/),
    );
    expect(problems('textStyles', 'Standard')).toContainEqual(
      expect.stringMatching(/Standard cannot be purged$/),
    );
    expect(problems('dimStyles', 'Standard')).toContainEqual(
      expect.stringMatching(/Standard cannot be purged$/),
    );
    expect(problems('appIds', 'ACAD')).toContainEqual(
      expect.stringMatching(/ACAD cannot be purged$/),
    );
    expect(
      refused((b, model) => purge(b, model, 'blockRecords', '*Paper_Space'), bytes),
    ).toContainEqual(expect.stringMatching(/a layout's block goes with its layout/));
  });

  it('refuses the tables this part does not purge', () => {
    const bytes = drawing();
    expect(
      refused(
        (b, model) => b.removeTableRecord('vports', named(model, 'vports', '*Active').handle),
        bytes,
      ),
    ).toContainEqual(expect.stringMatching(/: removing a viewport$/));
  });
});
