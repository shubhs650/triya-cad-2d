import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  unloadedXrefs,
  withoutXrefContent,
  xrefLoadChange,
  type DocumentInit,
  type EntityGeometry,
  type LayerRecord,
  type NonGraphicalObject,
  type SortEntsTable,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  linetype,
  circleGeom,
  sampleInit,
  snapshot,
  MODEL_SPACE,
} from './fixtures';

const XREF = '30';

const insert = (block: string, x = 0, y = 0): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/** The sample drawing with an attached xref CHILD (path child.dxf) referenced once. */
function hostInit(extraLayers: LayerRecord[] = []): DocumentInit {
  const s = sampleInit();
  return {
    ...s,
    tables: {
      ...s.tables,
      layers: [...(s.tables?.layers ?? []), ...extraLayers],
      blockRecords: [
        ...(s.tables?.blockRecords ?? []),
        { ...blockRecord(XREF, 'CHILD'), flags: 4 },
      ],
    },
    blocks: [
      ...(s.blocks ?? []),
      { handle: XREF, name: 'CHILD', basePoint: { x: 0, y: 0 }, xrefPath: '.\\child.dxf' },
    ],
    entities: [...(s.entities ?? []), entityInit('31', insert(XREF, 100, 0))],
  };
}

/**
 * The xref's own drawing: layers 0, WALLS and ROOF, a DASHED linetype, a block DOOR, a nested
 * attached xref GRAND and a nested overlay OVL, model-space entities, a draw order, and a
 * layout with a line.
 */
function childInit(): DocumentInit {
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '60',
    tables: {
      layers: [layer('10', '0'), { ...layer('11', 'WALLS'), linetype: '15' }, layer('12', 'ROOF')],
      linetypes: [linetype('14', 'Continuous'), linetype('15', 'DASHED')],
      textStyles: [
        {
          handle: '16',
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      blockRecords: [
        blockRecord('1F', '*Model_Space'),
        blockRecord('1B', '*Paper_Space'),
        blockRecord('40', 'DOOR'),
        { ...blockRecord('41', 'GRAND'), flags: 4 },
        { ...blockRecord('42', 'OVL'), flags: 12 },
      ],
    },
    blocks: [
      { handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: '1B', name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      { handle: '40', name: 'DOOR', basePoint: { x: 1, y: 1 }, beginHandle: '43', endHandle: '44' },
      { handle: '41', name: 'GRAND', basePoint: { x: 0, y: 0 }, xrefPath: 'grand.dxf' },
      { handle: '42', name: 'OVL', basePoint: { x: 0, y: 0 }, xrefPath: 'ovl.dxf' },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [
      { handle: 'C', type: 'DICTIONARY', owner: '0' },
      sortEnts({
        handle: '50',
        type: 'SORTENTSTABLE',
        owner: 'C',
        block: '1F',
        entries: [
          { entity: '21', sort: '5A' },
          { entity: '25', sort: '5B' },
        ],
      }),
    ],
    passthrough: ['3A'],
    entities: [
      entityInit('20', lineGeom(0, 0, 10, 0), { layer: '11', owner: '1F' }),
      entityInit('21', circleGeom(5, 5, 2), { layer: '10', owner: '1F', plotStyle: '3A' }),
      entityInit('23', insert('40', 2, 2), { layer: '12', owner: '1F' }),
      entityInit('24', insert('41'), { layer: '10', owner: '1F' }),
      entityInit('26', insert('42'), { layer: '10', owner: '1F' }),
      entityInit('25', lineGeom(9, 9, 8, 8), { layer: '10', owner: '1B' }),
      entityInit('45', lineGeom(1, 1, 2, 3), { layer: '12', owner: '40', linetype: '15' }),
    ],
  };
}

const sortEnts = (t: SortEntsTable): NonGraphicalObject => t;

const byName = <T extends { name: string }>(m: ReadonlyMap<string, T>, name: string) =>
  [...m.values()].find((r) => r.name === name);

function loaded(host = hostInit()) {
  const model = DocumentModel.create(host);
  const change = xrefLoadChange(model, XREF, childInit());
  model.apply(change);
  return { model, change };
}

describe('xrefLoadChange (M1-21)', () => {
  it("brings the xref's symbols in as name|symbol, xref-dependent and resolved", () => {
    const { model } = loaded();
    const walls = byName(model.tables.layers, 'CHILD|WALLS')!;
    expect(walls.flags).toBe(48);
    expect(model.tables.linetypes.get(walls.linetype)?.name).toBe('CHILD|DASHED');
    expect(byName(model.tables.layers, 'CHILD|ROOF')).toBeDefined();
    expect(byName(model.tables.textStyles, 'CHILD|Standard')).toBeDefined();
    // Layer 0 and CONTINUOUS are the host's own.
    expect(byName(model.tables.layers, 'CHILD|0')).toBeUndefined();
    expect(byName(model.tables.linetypes, 'CHILD|Continuous')).toBeUndefined();
    expect(model.tables.layers.size).toBe(4);
  });

  it("makes the xref's model space the content of the xref block, in its order", () => {
    const { model } = loaded();
    const content = model.blockEntities(XREF).map((id) => model.entity(id)!);
    expect(content.map((e) => e.type)).toEqual(['LINE', 'CIRCLE', 'INSERT', 'INSERT']);
    const [line, circle, door, grand] = content;
    expect(model.tables.layers.get(line!.layer)?.name).toBe('CHILD|WALLS');
    expect(circle!.layer).toBe('10');
    // A handle the load leaves out (a plot style placeholder) is dropped, not carried over.
    expect(circle!.plotStyle).toBeUndefined();
    const doorDef = model.blocks.get((door!.geom as { block: string }).block)!;
    expect(doorDef).toMatchObject({ name: 'CHILD|DOOR', basePoint: { x: 1, y: 1 } });
    expect(doorDef.beginHandle).toBeUndefined();
    const doorLine = model.entity(model.blockEntities(doorDef.handle)[0]!)!;
    expect(model.tables.linetypes.get(doorLine.linetype)?.name).toBe('CHILD|DASHED');
    // A nested attached xref keeps its name and path and waits for its own file.
    const grandDef = model.blocks.get((grand!.geom as { block: string }).block)!;
    expect(grandDef).toMatchObject({ name: 'GRAND', xrefPath: 'grand.dxf' });
    expect(model.tables.blockRecords.get(grandDef.handle)?.flags).toBe(4);
    expect(unloadedXrefs(model).map((r) => r.name)).toEqual(['GRAND']);
    // The nested overlay and the xref's layouts do not come in.
    expect(byName(model.tables.blockRecords, 'OVL')).toBeUndefined();
    expect(byName(model.tables.blockRecords, 'CHILD|*Paper_Space')).toBeUndefined();
  });

  it('numbers the content above $HANDSEED in the xref order, and draw order follows', () => {
    const { model, change } = loaded();
    const added = model.blocks.get(XREF)!.xrefLoaded!;
    expect(added.length).toBeGreaterThan(10);
    expect(added.every((h) => BigInt(`0x${h}`) >= 0x40n)).toBe(true);
    const sort = change.objects!.added!.find((o) => o.type === 'SORTENTSTABLE') as unknown as {
      block: string;
      owner: string;
      entries: { entity: string; sort: string }[];
    };
    expect(sort.block).toBe(XREF);
    expect(sort.owner).toBe(XREF);
    // The paper-space line's entry goes with it.
    expect(sort.entries).toHaveLength(1);
    const circle = model.entity(model.blockEntities(XREF)[1]!)!;
    expect(sort.entries[0]!.entity).toBe(circle.handle);
    expect(BigInt(`0x${sort.entries[0]!.sort}`)).toBeGreaterThan(BigInt(`0x${circle.handle}`));
    expect(compareSeed(model.handSeed, added)).toBe(true);
  });

  it("keeps the host's own record of an xref layer (VISRETAIN)", () => {
    const kept = { ...layer('35', 'CHILD|WALLS'), frozen: true, flags: 48 };
    const { model } = loaded(hostInit([kept]));
    const line = model.entity(model.blockEntities(XREF)[0]!)!;
    expect(line.layer).toBe('35');
    expect(byName(model.tables.layers, 'CHILD|WALLS')?.handle).toBe('35');
    expect(model.tables.layers.get('35')?.frozen).toBe(true);
  });

  it('refuses a block that is not an xref, and a second load', () => {
    const model = DocumentModel.create(hostInit());
    expect(() => xrefLoadChange(model, MODEL_SPACE, childInit())).toThrow(
      '*Model_Space is not an external reference.',
    );
    model.apply(xrefLoadChange(model, XREF, childInit()));
    expect(() => xrefLoadChange(model, XREF, childInit())).toThrow('CHILD is already loaded.');
  });

  it('loads through the engine session, and a refusal changes nothing', () => {
    const session = new EngineSession(hostInit());
    const before = snapshot(session.model);
    const refused = session.edit({ kind: 'xref-load', block: '20', drawing: childInit() });
    expect(refused).toEqual({ ok: false, message: 'No block 20.' });
    expect(snapshot(session.model)).toEqual(before);
    const result = session.edit({ kind: 'xref-load', block: XREF, drawing: childInit() });
    expect(result.ok).toBe(true);
    expect(session.model.blockEntities(XREF)).toHaveLength(4);
  });
});

describe('withoutXrefContent (M1-21)', () => {
  it('is the drawing as opened, so the save writes no xref content', () => {
    const { model } = loaded();
    const plain = withoutXrefContent(model);
    expect(plain).not.toBe(model);
    // Entity ids are the session's own; everything the save reads is the same.
    const noIds = (m: DocumentModel) =>
      JSON.parse(JSON.stringify(snapshot(m), (k, v: unknown) => (k === 'id' ? undefined : v)));
    expect(noIds(plain)).toEqual(noIds(DocumentModel.create(hostInit())));
    expect(plain.handSeed).toBe(model.handSeed);
  });

  it('is the model itself when nothing is loaded', () => {
    const model = DocumentModel.create(hostInit());
    expect(withoutXrefContent(model)).toBe(model);
  });
});

function compareSeed(seed: string, handles: readonly string[]): boolean {
  const s = BigInt(`0x${seed}`);
  return handles.every((h) => BigInt(`0x${h}`) < s);
}
