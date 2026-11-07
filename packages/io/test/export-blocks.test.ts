// TriyaToAcad for block definitions (M1-75 part 22): BLOCK (a new named block with its
// entities, inserted at once), BASE in the block editor (a moved base point), RENAME and the
// BLOCK dialog's Block unit, Allow exploding and Scale uniformly settings. A block is a
// BLOCK_RECORD with its BLOCK and ENDBLK entities (the definition's base point and flags); the
// save makes all three, the markers under handles above every handle the engine handed out, as
// it numbers a polyline's vertices. Drawings are authored in memory with acad-ts and saved once,
// so "the file" is real bytes; the corpus-wide edit is in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  BlockTypeFlags,
  CadDocument,
  Insert,
  Line,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type BlockDefinition,
  type BlockTableRecord,
  type EntityGeometry,
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
 * Model space holds an INSERT of WINDOW, a block whose base point sits at (1, 1, 5) and holds a
 * LINE; EMPTY is a block with nothing in it, and *U1 an anonymous one.
 */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  const window = new BlockRecord('WINDOW');
  doc.blockRecords!.add(window);
  window.blockEntity.basePoint = new XYZ(1, 1, 5);
  window.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(4, 0, 0)));
  doc.blockRecords!.add(new BlockRecord('EMPTY'));
  const anonymous = new BlockRecord('*U1');
  anonymous.isAnonymous = true;
  doc.blockRecords!.add(anonymous);
  anonymous.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(0, 4, 0)));
  const insert = new Insert(window);
  insert.insertPoint = new XYZ(10, 0, 0);
  doc.entities!.add(insert);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const blockNamed = (model: DocumentModel, name: string): BlockDefinition =>
  [...model.blocks.values()].find((d) => d.name === name)!;

const modelSpace = (model: DocumentModel) => blockNamed(model, '*Model_Space').handle;

/** Saves `model` over a fresh read of `bytes` and reads the result. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat): CadDocument {
  return readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
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

const lineGeom = (x: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x, y: 0 },
  end: { x, y: 3 },
});

const insertGeom = (block: string): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x: 30, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/**
 * A block definition and record as they map back, by name and without the reader's links: an
 * R12 DXF has no BLOCK_RECORD, so the reader makes up the record handles (and every one moves
 * when a save adds an object, see r12-paper-space-facts).
 */
const comparable = (model: DocumentModel, name: string) => {
  const handle = blockNamed(model, name).handle;
  const {
    raw: _r,
    handle: _h,
    ...record
  } = model.tables.blockRecords.get(handle)! as BlockTableRecord & { raw?: unknown };
  const { handle: _d, ...def } = model.blocks.get(handle)!;
  return {
    record,
    def,
    entities: model.blockEntities(handle).map((id) => {
      const { id: _id, raw: _e, owner: _o, ...e } = model.entity(id)!;
      return e;
    }),
  };
};

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1009, 'dxf'],
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dwg'],
  [ACadVersion.AC1024, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

/** From R2007 a drawing keeps a block's units, explodability and scalability (DWG R2007+). */
const keepsSettings = (version: ACadVersion) => version >= ACadVersion.AC1021;

describe('block definitions', () => {
  it.each(SAVES)(
    'writes a new block with its entities and a reference to it (%s %s)',
    (version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      let door = '';
      edit(model, (b) => {
        // BLOCK: DOOR at base point (2, 0), holding two lines, then INSERT of it in model space.
        const settings = keepsSettings(version)
          ? { units: 4, explodable: false, scalable: false }
          : {};
        door = b.addBlock({ name: 'DOOR', basePoint: { x: 2, y: 0 }, ...settings }).handle;
        const layer = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
        b.addEntity({ owner: door, layer, geom: lineGeom(2) });
        b.addEntity({ owner: door, layer, geom: lineGeom(3) });
        b.addEntity({ owner: modelSpace(model), layer, geom: insertGeom(door) });
      });
      const back = DocumentModel.create(documentInit(saved(bytes, model, format)));
      expect(comparable(back, 'DOOR')).toEqual(comparable(model, 'DOOR'));
      if (version > ACadVersion.AC1009) expect(blockNamed(back, 'DOOR').handle).toBe(door);
      const ref = back.blockEntities(modelSpace(back)).map((id) => back.entity(id)!);
      expect(ref.at(-1)?.geom).toMatchObject({
        kind: 'INSERT',
        block: blockNamed(back, 'DOOR').handle,
      });
      // The BLOCK and ENDBLK markers are numbered above every handle the engine handed out.
      expect(Number.parseInt(back.handSeed, 16)).toBeGreaterThan(
        Number.parseInt(model.handSeed, 16),
      );
      // Everything else is as it was.
      for (const name of ['WINDOW', 'EMPTY', '*U1']) {
        expect(comparable(back, name)).toEqual(comparable(model, name));
      }
    },
  );

  it.each(SAVES)('writes a moved base point and a renamed block (%s %s)', (version, format) => {
    const bytes = drawing(version, format);
    const model = open(bytes);
    const window = blockNamed(model, 'WINDOW').handle;
    edit(model, (b) => {
      // BASE in the block editor, then RENAME.
      b.updateBlock(window, { basePoint: { x: -3, y: 2 } });
      b.updateBlock(blockNamed(model, 'EMPTY').handle, { name: 'Spare' });
      if (keepsSettings(version)) {
        b.updateTableRecord('blockRecords', window, { units: 6, explodable: false });
      }
    });
    const doc = saved(bytes, model, format);
    const back = DocumentModel.create(documentInit(doc));
    expect(comparable(back, 'WINDOW')).toEqual(comparable(model, 'WINDOW'));
    expect(blockNamed(back, 'Spare')).toBeDefined();
    expect(blockNamed(back, 'EMPTY')).toBeUndefined();
    // The base point keeps its Z.
    const record = doc.blockRecords!.tryGetValue('WINDOW')!;
    expect(record.blockEntity.basePoint.z).toBe(5);
  });

  it('writes an anonymous block (the dimension and table commands make them)', () => {
    const bytes = drawing();
    const model = open(bytes);
    let anon = '';
    edit(model, (b) => {
      anon = b.addBlock({ name: '*U7', basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
      const layer = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
      b.addEntity({ owner: anon, layer, geom: lineGeom(2) });
    });
    const back = DocumentModel.create(documentInit(saved(bytes, model, 'dxf')));
    expect(comparable(back, '*U7')).toEqual(comparable(model, '*U7'));
    expect(back.tables.blockRecords.get(anon)?.flags).toBe(BlockTypeFlags.Anonymous);
  });

  it.each(['dxf', 'dwg'] as const)(
    'renames a block an arrowhead variable names, with the variable (%s)',
    (format) => {
      // $DIMBLK names its block (a DWG header holds the handle): RENAME takes it along.
      const first = open(drawing(ACadVersion.AC1032, format));
      edit(first, (b) => b.setHeader('$DIMBLK', 'WINDOW'));
      const bytes = exportDocument(readCadDocument(drawing(ACadVersion.AC1032, format)), first, {
        format,
      });
      const rename = (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateBlock(blockNamed(m, 'WINDOW').handle, { name: 'PANE' });
      expect(refused(rename, bytes, format)).toEqual([
        expect.stringMatching(/\$DIMBLK: it names WINDOW, which the save renames PANE/),
      ]);
      const model = open(bytes);
      edit(model, (b) => {
        rename(b, model);
        b.setHeader('$DIMBLK', 'PANE');
      });
      const back = DocumentModel.create(documentInit(saved(bytes, model, format)));
      expect(back.header.get('$DIMBLK')).toBe('PANE');
      expect(blockNamed(back, 'PANE')).toBeDefined();
    },
  );

  it('refuses what a save cannot keep', () => {
    const ms = (m: DocumentModel) => modelSpace(m);
    const named = (m: DocumentModel, n: string) => blockNamed(m, n).handle;
    expect(refused((b) => b.addBlock({ name: 'window', basePoint: { x: 0, y: 0 } }))).toEqual([
      expect.stringMatching(/another block is named window/),
    ]);
    expect(refused((b) => b.addBlock({ name: 'A<B', basePoint: { x: 0, y: 0 } }))).toEqual([
      expect.stringMatching(/"A<B" is not a valid block name/),
    ]);
    expect(refused((b, m) => b.updateBlock(ms(m), { name: 'Model' }))).toEqual([
      expect.stringMatching(/\*Model_Space cannot be renamed/),
    ]);
    expect(refused((b, m) => b.updateBlock(named(m, '*U1'), { name: 'NAMED' }))).toEqual([
      expect.stringMatching(/an anonymous block cannot be renamed/),
    ]);
    expect(refused((b, m) => b.updateBlock(ms(m), { basePoint: { x: 1, y: 0 } }))).toEqual([
      expect.stringMatching(/\*Model_Space \(\w+\): a layout block's base point is \$INSBASE/),
    ]);
    // Anonymous names and the anonymous flag go together; xref and layout blocks come with M1-21 and M6.
    expect(refused((b) => b.addBlock({ name: '*U9', basePoint: { x: 0, y: 0 } }))).toEqual([
      expect.stringMatching(/a name starting with \* needs the anonymous flag \(1\)/),
    ]);
    expect(refused((b) => b.addBlock({ name: 'X', basePoint: { x: 0, y: 0 }, flags: 1 }))).toEqual([
      expect.stringMatching(/an anonymous block's name starts with \*/),
    ]);
    expect(refused((b) => b.addBlock({ name: 'X', basePoint: { x: 0, y: 0 }, flags: 4 }))).toEqual([
      expect.stringMatching(/block flags 4/),
    ]);
    expect(
      refused((b) => b.addBlock({ name: '*Paper_Space3', basePoint: { x: 0, y: 0 }, flags: 1 })),
    ).toEqual([expect.stringMatching(/a layout's block comes with its layout/)]);
    const xref = (() => {
      const doc = new CadDocument(ACadVersion.AC1032);
      doc.blockRecords!.add(new BlockRecord('SITE', 'site.dwg'));
      return writeCadDocument(doc, { format: 'dxf' });
    })();
    expect(
      refused((b, m) => b.updateBlock(named(m, 'SITE'), { basePoint: { x: 1, y: 1 } }), xref),
    ).toEqual([expect.stringMatching(/SITE \(\w+\): an xref's base point is its drawing's/)]);
    expect(refused((b) => b.addBlock({ name: 'X', basePoint: { x: 0, y: 0 }, units: 25 }))).toEqual(
      [expect.stringMatching(/block units 25/)],
    );
    // PURGE comes later; an R2004 DWG has no place for a block's units.
    expect(refused((b, m) => b.removeBlock(named(m, 'EMPTY')))).toEqual([
      expect.stringMatching(/EMPTY .*removing a block/),
    ]);
    expect(
      refused(
        (b, m) => b.updateTableRecord('blockRecords', named(m, 'WINDOW'), { units: 4 }),
        drawing(ACadVersion.AC1018, 'dwg'),
        'dwg',
      ),
    ).toEqual([expect.stringMatching(/AC1018 does not store a block's units/)]);
  });
});
