// TriyaToAcad for colour-book colours (M2-27: -ATTEDIT's Color option COlorbook, and the
// Properties palette's Color row, which lists the colours the selection uses). AutoCAD names a
// colour-book colour by a DBCOLOR object in the ACAD_COLOR dictionary, `BOOK$COLOR`, that an
// entity points at (DXF 430 beside its 420 true colour). Triya ships no colour books (AutoCAD's
// .acb files are Autodesk's), so an entity or ATTRIB may take only a colour the drawing already
// holds, with that colour's own DBCOLOR; anything else is refused. Drawings are authored in
// memory with acad-ts and saved once, so "the file" is real bytes (DXF only, DEC-047).
import {
  ACadVersion,
  AttributeEntity,
  BlockRecord,
  BookColor,
  CadDocument,
  Circle,
  Color as AcadColor,
  Insert,
  Line,
  Seqend,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Color,
  type Entity,
  type EntityGeometry,
  type EntityInit,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  writeCadDocument,
} from '../src/index';

const RAL_3020: Color = {
  kind: 'rgb',
  r: 204,
  g: 6,
  b: 5,
  bookName: 'RAL CLASSIC',
  colorName: 'RAL 3020',
};

/**
 * An AC1032 DXF holding the colour-book colour RAL CLASSIC$RAL 3020, which a CIRCLE uses, and in
 * model space a LINE and an INSERT of TAG with one ATTRIB.
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  const book = new BookColor();
  book.name = 'RAL CLASSIC$RAL 3020';
  book.color = new AcadColor(204, 6, 5);
  doc.colors!.add(book);
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const circle = new Circle(new XYZ(5, 5, 0), 2);
  const tag = new BlockRecord('TAG');
  doc.blockRecords!.add(tag);
  const insert = new Insert(tag);
  insert.insertPoint = new XYZ(20, 0, 0);
  for (const e of [line, circle, insert]) doc.entities!.add(e);
  circle.color = new AcadColor(204, 6, 5);
  circle.bookColor = book;
  insert.attributes.length = 0;
  const a = new AttributeEntity();
  a.tag = 'NO';
  a.value = 'A-1';
  a.insertPoint = new XYZ(21, 1, 0);
  a.height = 1;
  a.layer = insert.layer;
  a.owner = insert;
  a.handle = doc.header!.handleSeed++;
  insert.attributes.push(a);
  insert.attributes.seqend = new Seqend(insert);
  insert.attributes.seqend.handle = doc.header!.handleSeed++;
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();

const open = (): DocumentModel => DocumentModel.create(documentInit(readCadDocument(FILE)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const reopened = (bytes: Uint8Array): Map<string, EntityInit> =>
  new Map(documentInit(readCadDocument(bytes)).entities?.map((e) => [e.handle, e]));

const find = (model: DocumentModel, type: string): Entity =>
  [...model.entities()].find((e) => e.type === type)!;

type InsertGeometry = Extract<EntityGeometry, { kind: 'INSERT' }>;

const SAVES = [{ format: 'dxf' }, { format: 'dxf', binary: true }] as const;

/** The DBCOLOR objects of a saved file, by name. */
const dbColors = (bytes: Uint8Array): string[] =>
  [...(readCadDocument(bytes).colors ?? [])].map((c) => c.name);

describe('triyaToAcad colour-book colours', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    expect(find(model, 'CIRCLE').color).toEqual(RAL_3020);
    expect(find(model, 'LINE').color).toEqual({ kind: 'byLayer' });
  });

  it("gives an entity and an ATTRIB the drawing's colour-book colour", () => {
    for (const options of SAVES) {
      const model = open();
      const line = find(model, 'LINE');
      const insert = find(model, 'INSERT');
      const g = insert.geom as InsertGeometry;
      edit(model, (b) => {
        b.updateEntity(line.id, { color: RAL_3020 });
        b.updateEntity(insert.id, {
          geom: { ...g, attributes: g.attributes.map((a) => ({ ...a, color: RAL_3020 })) },
        });
      });
      const saved = exportDocument(readCadDocument(FILE), model, options);
      const back = reopened(saved);
      expect(back.get(line.handle)?.color).toEqual(RAL_3020);
      const attribute = (back.get(insert.handle)?.geom as InsertGeometry).attributes[0];
      expect(attribute?.color).toEqual(RAL_3020);
      // Named by the drawing's own DBCOLOR: none is added.
      expect(dbColors(saved)).toEqual(['RAL CLASSIC$RAL 3020']);
    }
  });

  it('takes a colour-book colour off, leaving the DBCOLOR in the drawing', () => {
    const model = open();
    const circle = find(model, 'CIRCLE');
    edit(model, (b) => b.updateEntity(circle.id, { color: { kind: 'aci', index: 1 } }));
    const saved = exportDocument(readCadDocument(FILE), model, { format: 'dxf' });
    expect(reopened(saved).get(circle.handle)?.color).toEqual({ kind: 'aci', index: 1 });
    expect(dbColors(saved)).toEqual(['RAL CLASSIC$RAL 3020']);
  });

  it('refuses a colour-book colour the drawing does not hold, or with another true colour', () => {
    for (const color of [
      { ...RAL_3020, colorName: 'RAL 9999' },
      { ...RAL_3020, bookName: 'PANTONE' },
      { ...RAL_3020, r: 0 },
    ]) {
      const model = open();
      const line = find(model, 'LINE');
      edit(model, (b) => b.updateEntity(line.id, { color }));
      let error: unknown;
      try {
        exportDocument(readCadDocument(FILE), model, { format: 'dxf' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UnsupportedChangeError);
      expect((error as UnsupportedChangeError).problems).toEqual([
        `LINE ${line.handle}: colour-book colours the drawing does not hold`,
      ]);
    }
  });
});
