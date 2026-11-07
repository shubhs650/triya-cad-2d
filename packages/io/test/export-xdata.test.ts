// TriyaToAcad for an entity's extended data (M1-75 part 19): the xdata an entity (or an ATTRIB of
// an INSERT) carries per registered application (DXF 1001 and the 1000–1071 groups after it),
// new or edited. COPY, MIRROR and ARRAY give the new entities their source's xdata, HYPERLINK
// keeps its link in PE_URL xdata, and DIMOVERRIDE keeps a dimension's overrides in its ACAD
// DSTYLE xdata, so a save has to write them. Drawings are authored in memory with acad-ts and
// saved once, so "the file" is real bytes; the corpus-wide edit is in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  AppId,
  AttributeDefinition,
  AttributeEntity,
  BlockRecord,
  CadDocument,
  Circle,
  ExtendedDataHandle,
  ExtendedDataInteger16,
  ExtendedDataString,
  Insert,
  Layer,
  Line,
  Seqend,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type Xdata,
  type XdataValue,
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
 * One drawing with the applications MY_APP, OTHER_APP and AcadAnnotative, a layer WALLS, and in
 * model space: a LINE with MY_APP (a string and a 16-bit integer) and OTHER_APP (a string)
 * xdata, a CIRCLE without xdata, and an INSERT of TAG with one ATTRIB carrying MY_APP xdata.
 * `dangling` ends the LINE's MY_APP xdata with a 1005 naming no object.
 */
function drawing(dangling = false): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  for (const name of ['MY_APP', 'OTHER_APP', 'AcadAnnotative']) doc.appIds!.add(new AppId(name));
  doc.layers!.add(new Layer('WALLS'));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const circle = new Circle(new XYZ(5, 5, 0), 2);
  const tag = new BlockRecord('TAG');
  doc.blockRecords!.add(tag);
  const attdef = new AttributeDefinition();
  attdef.tag = 'NO';
  attdef.prompt = 'Number';
  attdef.value = '000';
  attdef.height = 1;
  tag.entities.add(attdef);
  const insert = new Insert(tag);
  insert.insertPoint = new XYZ(20, 0, 0);
  for (const e of [line, circle, insert]) doc.entities!.add(e);
  line.extendedData.addByName('MY_APP', undefined);
  line.extendedData
    .getByName('MY_APP')
    .records.push(new ExtendedDataString('tag'), new ExtendedDataInteger16(3));
  if (dangling) line.extendedData.getByName('MY_APP').records.push(new ExtendedDataHandle(0xfeed));
  line.extendedData.addByName('OTHER_APP', undefined);
  line.extendedData.getByName('OTHER_APP').records.push(new ExtendedDataString('other'));
  // `new Insert(block)` makes an ATTRIB of each ATTDEF, under no handle; this one is made by hand.
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
  a.extendedData.addByName('MY_APP', undefined);
  a.extendedData.getByName('MY_APP').records.push(new ExtendedDataString('attrib'));
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();
const FORMATS: { format: CadFormat; binary?: boolean }[] = [
  { format: 'dxf' },
  { format: 'dxf', binary: true },
  { format: 'dwg' },
];

function open(bytes = FILE): DocumentModel {
  return DocumentModel.create(documentInit(readCadDocument(bytes)));
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

/** The reopened entities, by handle, as Triya maps them. */
function reopened(bytes: Uint8Array): Map<string, EntityInit> {
  return new Map(documentInit(readCadDocument(bytes)).entities?.map((e) => [e.handle, e]));
}

const save = (
  model: DocumentModel,
  options: { format: CadFormat; binary?: boolean } = { format: 'dxf' },
  bytes = FILE,
): Uint8Array => exportDocument(readCadDocument(bytes), model, options);

const find = (model: DocumentModel, type: string): Entity =>
  [...model.entities()].find((e) => e.type === type)!;

const app = (model: DocumentModel, name: string): string =>
  [...model.tables.appIds.values()].find((a) => a.name.toUpperCase() === name.toUpperCase())!
    .handle;

type InsertGeometry = Extract<EntityGeometry, { kind: 'INSERT' }>;

/** One value of each group code xdata can hold, the 1003 naming `layer` and the 1005 `handle`. */
function everyCode(layer: string, handle: string): XdataValue[] {
  return [
    { code: 1000, value: 'every code' },
    { code: 1002, value: '{' },
    { code: 1003, value: Number.parseInt(layer, 16) },
    { code: 1004, value: new Uint8Array([1, 2, 254, 255]) },
    { code: 1005, value: handle },
    { code: 1010, value: { x: 1, y: 2, z: 3 } },
    { code: 1011, value: { x: 4, y: 5, z: 6 } },
    { code: 1012, value: { x: 0.5, y: -0.5, z: 0 } },
    { code: 1013, value: { x: 0, y: 0, z: 1 } },
    { code: 1040, value: 2.25 },
    { code: 1041, value: 12.5 },
    { code: 1042, value: 0.125 },
    { code: 1070, value: -32768 },
    { code: 1071, value: 2147483647 },
    { code: 1002, value: '}' },
  ];
}

describe('triyaToAcad entity xdata', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    const line = find(model, 'LINE');
    expect(line.xdata).toEqual([
      {
        appId: app(model, 'MY_APP'),
        values: [
          { code: 1000, value: 'tag' },
          { code: 1070, value: 3 },
        ],
      },
      { appId: app(model, 'OTHER_APP'), values: [{ code: 1000, value: 'other' }] },
    ]);
    expect(find(model, 'CIRCLE').xdata).toBeUndefined();
    const [attrib] = (find(model, 'INSERT').geom as InsertGeometry).attributes;
    expect(attrib?.xdata).toEqual([
      { appId: app(model, 'MY_APP'), values: [{ code: 1000, value: 'attrib' }] },
    ]);
  });

  it('writes every group code onto an entity that had no xdata', () => {
    for (const options of FORMATS) {
      const model = open();
      const circle = find(model, 'CIRCLE');
      const walls = [...model.tables.layers.values()].find((l) => l.name === 'WALLS')!;
      const xdata: Xdata = [
        {
          appId: app(model, 'MY_APP'),
          values: everyCode(walls.handle, find(model, 'LINE').handle),
        },
      ];
      edit(model, (b) => b.updateEntity(circle.id, { xdata }));
      const back = reopened(save(model, options));

      expect(back.get(circle.handle)?.xdata, JSON.stringify(options)).toEqual(xdata);
    }
  });

  it('edits, adds and drops one application of an entity, keeping the others in their order', () => {
    for (const options of FORMATS) {
      const model = open();
      const line = find(model, 'LINE');
      const [mine, other] = line.xdata!;
      const xdata: Xdata = [
        { appId: other!.appId, values: [{ code: 1000, value: 'changed' }] },
        mine!,
      ];
      edit(model, (b) => b.updateEntity(line.id, { xdata }));
      const back = reopened(save(model, options));

      expect(back.get(line.handle)?.xdata, JSON.stringify(options)).toEqual(xdata);
    }
  });

  it('removes all of an entity’s xdata', () => {
    for (const options of FORMATS) {
      const model = open();
      const line = find(model, 'LINE');
      edit(model, (b) => b.updateEntity(line.id, { xdata: undefined }));
      const back = reopened(save(model, options));

      expect(back.get(line.handle)?.xdata, JSON.stringify(options)).toBeUndefined();
    }
  });

  it('keeps an unchanged application’s records as they were read', () => {
    const model = open();
    const line = find(model, 'LINE');
    const [mine, other] = line.xdata!;
    edit(model, (b) =>
      b.updateEntity(line.id, {
        xdata: [mine!, { appId: other!.appId, values: [{ code: 1000, value: 'changed' }] }],
      }),
    );
    const doc = readCadDocument(FILE);
    const acad = doc.getCadObject(Number.parseInt(line.handle, 16))!;
    const kept = acad.extendedData.getByName('MY_APP');

    triyaToAcad(doc, model);

    expect(acad.extendedData.getByName('MY_APP')).toBe(kept);
  });

  it('gives a copy its source’s xdata (COPY), under an application the same save adds', () => {
    for (const options of FORMATS) {
      const model = open();
      const line = find(model, 'LINE');
      let copy: Entity | undefined;
      let added: { handle: string } | undefined;
      edit(model, (b) => {
        added = b.addTableRecord('appIds', { name: 'TRIYA_MARKUP' });
        const { id: _id, handle: _handle, ...init } = line;
        copy = b.addEntity({
          ...init,
          xdata: [
            ...line.xdata!,
            { appId: added.handle, values: [{ code: 1000, value: 'copied' }] },
          ],
        });
      });
      const back = reopened(save(model, options));

      expect(back.get(copy!.handle)?.xdata, JSON.stringify(options)).toEqual(
        model.entity(copy!.id)!.xdata,
      );
    }
  });

  it('writes an ATTRIB’s xdata, edited and on an ATTRIB the INSERT gains', () => {
    for (const options of FORMATS) {
      const model = open();
      const insert = find(model, 'INSERT');
      const g = insert.geom as InsertGeometry;
      const [attrib] = g.attributes;
      let added = '';
      edit(model, (b) => {
        added = model.handles.allocate();
        b.updateEntity(insert.id, {
          geom: {
            ...g,
            attributes: [
              {
                ...attrib!,
                xdata: [{ appId: app(model, 'OTHER_APP'), values: [{ code: 1040, value: 0.5 }] }],
              },
              {
                ...attrib!,
                handle: added,
                raw: { handle: added },
                xdata: [{ appId: app(model, 'MY_APP'), values: [{ code: 1071, value: 7 }] }],
              },
            ],
          },
        });
      });
      const back = reopened(save(model, options));
      const attributes = (back.get(insert.handle)?.geom as InsertGeometry).attributes;

      expect(
        attributes.map((a) => a.xdata),
        JSON.stringify(options),
      ).toEqual((model.entity(insert.id)!.geom as InsertGeometry).attributes.map((a) => a.xdata));
    }
  });

  it('refuses xdata it cannot write and leaves the original as it was', () => {
    const value =
      (v: XdataValue): ((m: DocumentModel) => Xdata) =>
      (m) => [{ appId: app(m, 'MY_APP'), values: [v] }];
    const cases: [string, (m: DocumentModel) => Xdata, RegExp][] = [
      [
        'an application not in the drawing',
        () => [{ appId: 'FFFFF', values: [{ code: 1070, value: 1 }] }],
        /not a regist/,
      ],
      [
        'an application twice',
        (m) => [
          { appId: app(m, 'MY_APP'), values: [{ code: 1070, value: 1 }] },
          { appId: app(m, 'MY_APP'), values: [{ code: 1070, value: 2 }] },
        ],
        /twice/,
      ],
      [
        'an application without values',
        (m) => [{ appId: app(m, 'MY_APP'), values: [] }],
        /no values/,
      ],
      ['a 1001 inside the values', value({ code: 1001, value: 'X' }), /group code 1001/],
      ['an unknown group code', value({ code: 1006, value: 1 }), /group code 1006/],
      ['a number for a string', value({ code: 1000, value: 1 }), /1000 .*string/],
      ['a string longer than 255', value({ code: 1000, value: 'x'.repeat(256) }), /255/],
      ['a line break in a string', value({ code: 1000, value: 'a\nb' }), /line break/],
      ['a control string other than braces', value({ code: 1002, value: '(' }), /\{ or \}/],
      ['an unopened brace', value({ code: 1002, value: '}' }), /braces/],
      ['an unclosed brace', value({ code: 1002, value: '{' }), /braces/],
      ['a 1003 naming no layer', value({ code: 1003, value: 0xfffff }), /layer/],
      ['bytes as a string', value({ code: 1004, value: 'ab' }), /bytes/],
      ['more than 127 bytes', value({ code: 1004, value: new Uint8Array(128) }), /127/],
      ['a 1005 that is not a handle', value({ code: 1005, value: 'XYZ' }), /handle/],
      ['a point that is a number', value({ code: 1010, value: 1 }), /point/],
      ['a point not finite', value({ code: 1011, value: { x: 0, y: Infinity, z: 0 } }), /point/],
      ['a real not finite', value({ code: 1040, value: Number.NaN }), /finite/],
      ['a 16-bit integer out of range', value({ code: 1070, value: 32768 }), /16-bit/],
      ['a fractional integer', value({ code: 1070, value: 1.5 }), /16-bit/],
      ['a 32-bit integer out of range', value({ code: 1071, value: 2 ** 31 }), /32-bit/],
      [
        'more than 16 KB',
        (m) => [
          {
            appId: app(m, 'MY_APP'),
            values: Array.from({ length: 700 }, () => ({
              code: 1010,
              value: { x: 1, y: 1, z: 1 },
            })),
          },
        ],
        /16 KB/,
      ],
      [
        'annotative xdata (the annotative property is not written yet)',
        (m) => [{ appId: app(m, 'AcadAnnotative'), values: [{ code: 1070, value: 1 }] }],
        /AcadAnnotative/,
      ],
    ];
    for (const [what, xdata, message] of cases) {
      for (const where of ['entity', 'attrib'] as const) {
        const model = open();
        edit(model, (b) => {
          if (where === 'entity') {
            b.updateEntity(find(model, 'CIRCLE').id, { xdata: xdata(model) });
            return;
          }
          const insert = find(model, 'INSERT');
          const g = insert.geom as InsertGeometry;
          b.updateEntity(insert.id, {
            geom: { ...g, attributes: [{ ...g.attributes[0]!, xdata: xdata(model) }] },
          });
        });
        const doc = readCadDocument(FILE);
        const init = documentInit(doc);

        let error: unknown;
        try {
          triyaToAcad(doc, model);
        } catch (e) {
          error = e;
        }
        expect(error, `${what} (${where})`).toBeInstanceOf(UnsupportedChangeError);
        expect((error as UnsupportedChangeError).problems.join('; '), what).toMatch(message);
        expect(documentInit(doc), what).toEqual(init);
      }
    }
  });

  it('writes a 1005 naming no object as it is, kept or new (AutoCAD keeps one to an erased object)', () => {
    // acad-ts's DXF writer writes it as read since patch 0029, its DWG writer since 0149.
    for (const options of FORMATS) {
      const bytes = drawing(true);
      const model = open(bytes);
      const line = find(model, 'LINE');
      const circle = find(model, 'CIRCLE');
      const [mine, other] = line.xdata!;
      expect(mine!.values.at(-1)).toEqual({ code: 1005, value: 'FEED' });
      edit(model, (b) => {
        b.updateEntity(line.id, {
          xdata: [mine!, { appId: other!.appId, values: [{ code: 1005, value: 'BEEF' }] }],
        });
        b.updateEntity(circle.id, { xdata: [mine!] });
      });
      const back = reopened(save(model, options, bytes));

      expect(back.get(line.handle)?.xdata, JSON.stringify(options)).toEqual(
        model.entity(line.id)!.xdata,
      );
      expect(back.get(circle.handle)?.xdata, JSON.stringify(options)).toEqual([mine]);
    }
  });
});
