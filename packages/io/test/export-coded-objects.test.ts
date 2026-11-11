// TriyaToAcad for coded objects (M2-32 part 4): what makes a pasted block dynamic, written into a
// new extension dictionary of the record or reference it came with. The drawing is authored in
// memory with acad-ts and saved once, so "the file" is real bytes; a model change stands for
// what PASTECLIP adds (the corpus pastes are packages/testkit/src/export/paste.corpus.test.ts).
import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Insert,
  Line,
  XRecord,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  dynamicBlockOf,
  isCodedObject,
  type CodedObject,
  type DxfGroup,
  type Entity,
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

/** Block B (a line) inserted once, at 0,0. */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const block = new BlockRecord('B');
  block.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(10, 10, 0)));
  doc.blockRecords!.add(block);
  doc.entities!.add(new Insert(block));
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const coded = (
  handle: string,
  owner: string,
  dxfName: string,
  body: DxfGroup[],
  key?: string,
  dxfClass?: CodedObject['dxfClass'],
): CodedObject => ({
  handle,
  type: 'CODED_OBJECT',
  owner,
  dxfName,
  ...(key !== undefined ? { key } : {}),
  codes: [{ code: 5, value: handle }, { code: 330, value: owner }, ...body],
  ...(dxfClass ? { dxfClass } : {}),
});

/** A reference's representation: a DICTIONARY under `key` holding one XRECORD. */
function representation(b: ChangeSetBuilder, xdict: string, key = 'AcDbBlockRepresentation') {
  const dict = b.allocateHandle();
  const data = b.allocateHandle();
  const objects = [
    coded(
      dict,
      xdict,
      'DICTIONARY',
      [
        { code: 100, value: 'AcDbDictionary' },
        { code: 280, value: 0 },
        { code: 281, value: 1 },
        { code: 3, value: 'AcDbRepData' },
        { code: 350, value: data },
      ],
      key,
    ),
    coded(data, dict, 'XRECORD', [
      { code: 100, value: 'AcDbXrecord' },
      { code: 280, value: 1 },
      { code: 1, value: 'state' },
      { code: 70, value: 7 },
    ]),
  ];
  for (const o of objects) b.adoptObject(o);
  return objects;
}

/** A new reference to B with a representation in a new extension dictionary. */
function pasted(model: DocumentModel) {
  const b = new ChangeSetBuilder(model);
  const block = [...model.blocks.values()].find((d) => d.name === 'B')!.handle;
  const space = [...model.blocks.values()].find((d) => d.name === '*Model_Space')!.handle;
  const xdict = b.allocateHandle();
  const objects = representation(b, xdict);
  const insert = b.addEntity({
    owner: space,
    layer: [...model.tables.layers.values()][0]!.handle,
    extDict: xdict,
    geom: {
      kind: 'INSERT',
      block,
      position: { x: 5, y: 5 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    },
  });
  model.apply(b.build());
  return { insert, xdict, objects };
}

const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat = 'dxf') =>
  exportDocument(readCadDocument(bytes), model, { format });

const refusal = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return e.message;
    throw e;
  }
  return '';
};

describe('coded objects written into a new extension dictionary (M2-32 part 4)', () => {
  it("puts a new reference's tree in its new dictionary, as written", () => {
    const bytes = drawing();
    const model = open(bytes);
    const { insert, xdict } = pasted(model);
    const acad = readCadDocument(save(bytes, model));
    const back = acad.getCadObject(Number.parseInt(insert.handle, 16)) as Insert;
    expect(back.xDictionary?.handle.toString(16).toUpperCase()).toBe(xdict);
    const rep = back.xDictionary!.getEntry<CadDictionary>('AcDbBlockRepresentation')!;
    expect(rep).toBeInstanceOf(CadDictionary);
    const data = rep.getEntry<XRecord>('AcDbRepData')!;
    expect(data).toBeInstanceOf(XRecord);
    expect(data.entries.map((e) => [e.code, e.value])).toEqual([
      [1, 'state'],
      [70, 7],
    ]);
  });

  it('reads back as the coded objects it was written from', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { objects } = pasted(model);
    const back = open(save(bytes, model));
    for (const o of objects) {
      const { raw: _raw, ...read } = back.objects.get(o.handle)!;
      // The writer states the owner and handle; the reader the dictionary's own codes.
      expect(read).toMatchObject({ handle: o.handle, owner: o.owner, dxfName: o.dxfName });
    }
    const data = back.objects.get(objects[1]!.handle) as CodedObject;
    expect(data.codes).toEqual(objects[1]!.codes);
  });

  it('writes nothing for a tree whose reference was erased after the paste', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { insert } = pasted(model);
    const b = new ChangeSetBuilder(model);
    b.removeEntity(insert.id);
    model.apply(b.build());
    const back = open(save(bytes, model));
    expect([...back.objects.values()].filter(isCodedObject)).toEqual([]);
  });

  it('refuses a tree under a reference the drawing has already', () => {
    const bytes = drawing();
    const model = open(bytes);
    const old = [...model.entities()].find((e) => e.type === 'INSERT')!;
    const b = new ChangeSetBuilder(model);
    const xdict = b.allocateHandle();
    representation(b, xdict);
    b.updateEntity(old.id, { extDict: xdict } as Partial<Entity>);
    model.apply(b.build());
    expect(refusal(() => save(bytes, model))).toMatch(/has an extension dictionary of its own/);
  });

  it('refuses a coded object whose owner is not a new coded object', () => {
    const bytes = drawing();
    const model = open(bytes);
    const b = new ChangeSetBuilder(model);
    const h = b.allocateHandle();
    b.adoptObject(coded(h, '1', 'XRECORD', [{ code: 100, value: 'AcDbXrecord' }]));
    model.apply(b.build());
    expect(refusal(() => save(bytes, model))).toMatch(/is not a new coded object/);
  });

  it('refuses a save to DWG, which the codes are not', () => {
    const bytes = drawing(ACadVersion.AC1032, 'dwg');
    const model = open(bytes);
    pasted(model);
    expect(refusal(() => save(bytes, model, 'dwg'))).toMatch(/written to DXF only/);
  });

  it('refuses a save in another version than AC1032', () => {
    const bytes = drawing(ACadVersion.AC1018);
    const model = open(bytes);
    pasted(model);
    expect(refusal(() => save(bytes, model))).toMatch(/AC1032's, not AC1018's/);
  });
});

describe('new dynamic blocks and their states (M2-32 part 4)', () => {
  const GRAPH_CLASS = {
    cppClassName: 'AcDbEvalGraph',
    applicationName: 'ObjectDBX Classes',
    proxyFlags: 4095,
    wasZombie: false,
  };

  /** A new block D (dynamic, with an empty evaluation graph unless `graph` is false) and state *U9. */
  function dynamicBlocks(model: DocumentModel, graph = true, tag = true) {
    const b = new ChangeSetBuilder(model);
    const app = b.addTableRecord('appIds', { name: 'AcDbBlockRepBTag' });
    const def = b.addBlock({ name: 'D', basePoint: { x: 0, y: 0 } });
    b.updateBlock(def.handle, { dynamic: { name: 'D' } });
    const xdict = b.allocateHandle();
    if (graph) {
      b.adoptObject(
        coded(
          b.allocateHandle(),
          xdict,
          'ACAD_EVALUATION_GRAPH',
          [
            { code: 100, value: 'AcDbEvalGraph' },
            { code: 96, value: 0 },
            { code: 97, value: 0 },
          ],
          'ACAD_ENHANCEDBLOCK',
          GRAPH_CLASS,
        ),
      );
      b.updateTableRecord('blockRecords', def.handle, { extDict: xdict });
    }
    const state = b.addBlock({ name: '*U9', basePoint: { x: 0, y: 0 }, flags: 1 });
    b.updateBlock(state.handle, { dynamicOf: def.handle });
    if (tag) {
      b.updateTableRecord('blockRecords', state.handle, {
        xdata: [
          {
            appId: app.handle,
            values: [
              { code: 1070, value: 1 },
              { code: 1005, value: def.handle },
            ],
          },
        ],
      });
    }
    model.apply(b.build());
    return { def, state };
  }

  it('writes a new dynamic block with its graph, and a state naming it', () => {
    const bytes = drawing();
    const model = open(bytes);
    const { def, state } = dynamicBlocks(model);
    const back = open(save(bytes, model));
    expect(dynamicBlockOf(back.blocks, def.handle)).toEqual({ handle: def.handle, name: 'D' });
    expect(dynamicBlockOf(back.blocks, state.handle)).toEqual({ handle: def.handle, name: 'D' });
  });

  it('refuses a new dynamic block without its graph', () => {
    const bytes = drawing();
    const model = open(bytes);
    dynamicBlocks(model, false);
    expect(refusal(() => save(bytes, model))).toMatch(/comes with its evaluation graph/);
  });

  it('refuses a new state whose record does not name its dynamic block', () => {
    const bytes = drawing();
    const model = open(bytes);
    dynamicBlocks(model, true, false);
    expect(refusal(() => save(bytes, model))).toMatch(/names it in its AcDbBlockRepBTag xdata/);
  });
});
