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
  Layer,
  Line,
  Seqend,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  copyObjects,
  moveBy,
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

/** A layer's colour-book colour: AutoCAD names it by LAYER 430 alone, with no DBCOLOR. */
const DIC_7: Color = {
  kind: 'rgb',
  r: 252,
  g: 193,
  b: 135,
  bookName: 'DIC COLOR GUIDE(R)',
  colorName: 'DIC 7',
};

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
 * model space a LINE and an INSERT of TAG with one ATTRIB; its layer TINTED is DIC COLOR
 * GUIDE(R)$DIC 7, a colour no object uses, so no DBCOLOR names it (acadsharp's
 * Layer_color_book, M2-35 part 19).
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  const book = new BookColor();
  book.name = 'RAL CLASSIC$RAL 3020';
  book.color = new AcadColor(204, 6, 5);
  doc.colors!.add(book);
  const tinted = new Layer('TINTED');
  tinted.color = AcadColor.fromTrueColor(0xfcc187);
  tinted.trueColorName = 'DIC COLOR GUIDE(R)$DIC 7';
  doc.layers!.add(tinted);
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

  // M2-48: COPY, MIRROR and a paste into a drawing holding the colour keep its book's name; the
  // save writes the new entity's DBCOLOR reference (DXF 430) to the drawing's own DBCOLOR.
  it("names a new entity's colour by the drawing's DBCOLOR (a COPY of the circle)", () => {
    for (const options of SAVES) {
      const model = open();
      const circle = find(model, 'CIRCLE');
      const b = new ChangeSetBuilder(model);
      const [id] = copyObjects(b, model, [circle.id], moveBy({ x: 10, y: 0 })).ids;
      model.apply(b.build());
      const copy = model.entity(id!)!;
      expect(copy.color).toEqual(RAL_3020);
      const saved = exportDocument(readCadDocument(FILE), model, options);
      expect(reopened(saved).get(copy.handle)?.color).toEqual(RAL_3020);
      const written = [...(readCadDocument(saved).entities ?? [])].find(
        (e) => e.handle.toString(16).toUpperCase() === copy.handle,
      );
      expect(written?.bookColor?.name).toBe('RAL CLASSIC$RAL 3020');
      expect(dbColors(saved)).toEqual(['RAL CLASSIC$RAL 3020']);
    }
  });

  // M2-35 part 19: a layer's colour-book colour (DXF 430 of the LAYER, acad-ts patch 0181).
  const layerNamed = (model: DocumentModel, name: string) =>
    [...model.tables.layers.values()].find((l) => l.name === name)!;
  const reopenedLayers = (bytes: Uint8Array) =>
    new Map(documentInit(readCadDocument(bytes)).tables?.layers?.map((l) => [l.name, l]));

  it("reads a layer's colour-book colour and keeps it through a save", () => {
    const model = open();
    expect(layerNamed(model, 'TINTED').color).toEqual(DIC_7);
    for (const options of SAVES) {
      const saved = exportDocument(readCadDocument(FILE), model, options);
      expect(reopenedLayers(saved).get('TINTED')?.color).toEqual(DIC_7);
      // A layer's colour needs no DBCOLOR.
      expect(dbColors(saved)).toEqual(['RAL CLASSIC$RAL 3020']);
    }
  });

  it("writes a layer's colour-book colour, changed or new, and takes it off for a plain one", () => {
    for (const options of SAVES) {
      const model = open();
      const zero = layerNamed(model, '0');
      const tinted = layerNamed(model, 'TINTED');
      let added = '';
      edit(model, (b) => {
        b.updateTableRecord('layers', zero.handle, { color: RAL_3020 });
        b.updateTableRecord('layers', tinted.handle, {
          color: { kind: 'rgb', r: 252, g: 193, b: 135 },
        });
        added = b.addTableRecord('layers', { ...tinted, name: 'PASTED', color: DIC_7 }).handle;
      });
      const saved = exportDocument(readCadDocument(FILE), model, options);
      const back = reopenedLayers(saved);
      expect(back.get('0')?.color).toEqual(RAL_3020);
      expect(back.get('TINTED')?.color).toEqual({ kind: 'rgb', r: 252, g: 193, b: 135 });
      expect(back.get('PASTED')?.color).toEqual(DIC_7);
      expect(back.get('PASTED')?.handle).toBe(added);
    }
  });

  it("gives an entity a colour-book colour only a layer holds, adding the colour's DBCOLOR", () => {
    for (const options of SAVES) {
      const model = open();
      const line = find(model, 'LINE');
      edit(model, (b) => b.updateEntity(line.id, { color: DIC_7 }));
      const saved = exportDocument(readCadDocument(FILE), model, options);
      expect(reopened(saved).get(line.handle)?.color).toEqual(DIC_7);
      const doc = readCadDocument(saved);
      const dbcolor = doc.colors?.tryGet('DIC COLOR GUIDE(R)$DIC 7');
      expect(dbcolor?.color.trueColor).toBe(0xfcc187);
      // New objects are numbered above every handle the drawing and the engine gave out.
      expect(Number(dbcolor?.handle)).toBeGreaterThanOrEqual(Number.parseInt(model.handSeed, 16));
      expect(dbColors(saved).sort()).toEqual(['DIC COLOR GUIDE(R)$DIC 7', 'RAL CLASSIC$RAL 3020']);
    }
  });

  it('refuses a colour-book colour a layer holds with another true colour', () => {
    const model = open();
    const line = find(model, 'LINE');
    edit(model, (b) => b.updateEntity(line.id, { color: { ...DIC_7, r: 0 } }));
    expect(() => exportDocument(readCadDocument(FILE), model, { format: 'dxf' })).toThrow(
      UnsupportedChangeError,
    );
  });
});
