// M2-06: what ERASE, MOVE and COPY do to the links between objects. An associative hatch
// follows its boundary when the whole boundary goes with it and lets go otherwise (AutoCAD
// 2024 Help, "HATCH associativity"); an erased object leaves its group; a copy is a new object
// with links of its own; objects on locked layers stay put.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  copyObjects,
  eraseObjects,
  mirrorIn,
  moveBy,
  refusalMessages,
  transformObjects,
  type DocumentInit,
  type EditReport,
  type Entity,
  type HatchGeometry,
} from '../../src/index';
import { LAYER_WALLS, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

/** A square of four lines (30–33) filled by an associative hatch (34), and a group of 30 and 31. */
function square(): DocumentInit {
  const base = sampleInit();
  const pts = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as const;
  const lines = pts.map(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % 4]!;
    return entityInit(`3${i}`, lineGeom(x, y, x2, y2), { reactors: ['34'] });
  });
  const hatch: HatchGeometry = {
    kind: 'HATCH',
    pattern: 'SOLID',
    solid: true,
    associative: true,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: [
      {
        flags: 1,
        edges: pts.map(([x, y], i) => {
          const [x2, y2] = pts[(i + 1) % 4]!;
          return { type: 'line', start: { x, y }, end: { x: x2, y: y2 } } as const;
        }),
        sources: ['30', '31', '32', '33'],
      },
    ],
    patternLines: [],
    seedPoints: [{ x: 5, y: 5 }],
  };
  return {
    ...base,
    entities: [...lines, entityInit('34', hatch)],
    objects: [
      ...(base.objects ?? []),
      {
        handle: '35',
        type: 'GROUP',
        owner: 'C',
        name: 'PAIR',
        description: '',
        selectable: true,
        entities: ['30', '31'],
      } as never,
    ],
  };
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => EditReport): EditReport {
  const b = new ChangeSetBuilder(model);
  const r = f(b);
  model.apply(b.build());
  return r;
}

const ids = (model: DocumentModel, ...handles: string[]) =>
  handles.map((h) => model.entityByHandle(h)!.id);
const hatchOf = (e: Entity | undefined) => e?.geom as HatchGeometry;

describe('an associative hatch', () => {
  it('follows when its whole boundary moves, even when only the boundary is selected', () => {
    const model = DocumentModel.create(square());
    const r = edit(model, (b) =>
      transformObjects(b, model, ids(model, '30', '31', '32', '33'), moveBy({ x: 5, y: 0 })),
    );
    expect(r.ids).toHaveLength(5);
    const h = hatchOf(model.entityByHandle('34'));
    expect(h.associative).toBe(true);
    expect(h.seedPoints).toEqual([{ x: 10, y: 5 }]);
    expect(h.loops[0]!.sources).toEqual(['30', '31', '32', '33']);
  });

  it('lets go of its boundary when only part of it moves', () => {
    const model = DocumentModel.create(square());
    edit(model, (b) => transformObjects(b, model, ids(model, '30'), moveBy({ x: 0, y: -1 })));
    const h = hatchOf(model.entityByHandle('34'));
    expect(h.associative).toBe(false);
    expect(h.loops[0]!.sources).toBeUndefined();
    expect(h.seedPoints).toEqual([{ x: 5, y: 5 }]);
    for (const l of ['30', '31', '32', '33']) {
      expect(model.entityByHandle(l)!.reactors).toBeUndefined();
    }
  });

  it('lets go when it moves without its boundary', () => {
    const model = DocumentModel.create(square());
    edit(model, (b) => transformObjects(b, model, ids(model, '34'), moveBy({ x: 1, y: 0 })));
    expect(hatchOf(model.entityByHandle('34')).associative).toBe(false);
    expect(model.entityByHandle('31')!.reactors).toBeUndefined();
  });

  it('lets go when a boundary object is erased', () => {
    const model = DocumentModel.create(square());
    edit(model, (b) => eraseObjects(b, model, ids(model, '32')));
    expect(model.entityByHandle('32')).toBeUndefined();
    expect(hatchOf(model.entityByHandle('34')).associative).toBe(false);
  });

  it("is copied onto its boundary's copies, or as a plain hatch without them", () => {
    const model = DocumentModel.create(square());
    const all = edit(model, (b) =>
      copyObjects(b, model, ids(model, '30', '31', '32', '33', '34'), moveBy({ x: 20, y: 0 })),
    );
    const copies = all.ids.map((id) => model.entity(id)!);
    const hatch = copies.find((e) => e.type === 'HATCH')!;
    const lines = copies.filter((e) => e.type === 'LINE');
    expect(hatchOf(hatch).associative).toBe(true);
    expect(hatchOf(hatch).loops[0]!.sources).toEqual(lines.map((l) => l.handle));
    for (const l of lines) expect(l.reactors).toEqual([hatch.handle]);
    // The originals keep theirs.
    expect(hatchOf(model.entityByHandle('34')).loops[0]!.sources).toEqual(['30', '31', '32', '33']);

    const alone = edit(model, (b) =>
      copyObjects(b, model, ids(model, '34'), moveBy({ x: 0, y: 20 })),
    );
    const h = hatchOf(model.entity(alone.ids[0]!));
    expect(h.associative).toBe(false);
    expect(h.loops[0]!.sources).toBeUndefined();
  });
});

describe('ERASE', () => {
  it('takes erased objects out of their groups', () => {
    const model = DocumentModel.create(square());
    edit(model, (b) => eraseObjects(b, model, ids(model, '31')));
    expect((model.objects.get('35') as unknown as { entities: string[] }).entities).toEqual(['30']);
  });
});

describe('COPY', () => {
  it('gives a copy new handles above the seed and no reactors of its own', () => {
    const model = DocumentModel.create(square());
    const r = edit(model, (b) => copyObjects(b, model, ids(model, '30'), moveBy({ x: 0, y: 1 })));
    const copy = model.entity(r.ids[0]!)!;
    expect(parseInt(copy.handle, 16)).toBeGreaterThanOrEqual(0x40);
    expect(copy.reactors).toBeUndefined();
    expect(copy.geom).toMatchObject({ start: { x: 0, y: 1 }, end: { x: 10, y: 1 } });
  });
});

describe('a colour-book colour (M2-48)', () => {
  const RAL_3020 = {
    kind: 'rgb',
    r: 204,
    g: 6,
    b: 5,
    bookName: 'RAL CLASSIC',
    colorName: 'RAL 3020',
  } as const;

  // AutoCAD's COPY and MIRROR make objects of the same properties: a colour-book colour stays
  // named by its book, and the drawing holds its DBCOLOR already (the save writes it, M2-27).
  it('stays named by its book on a COPY and a MIRROR copy', () => {
    const base = square();
    const init: DocumentInit = {
      ...base,
      entities: base.entities!.map((e) => (e.handle === '30' ? { ...e, color: RAL_3020 } : e)),
    };
    const model = DocumentModel.create(init);
    const copied = edit(model, (b) =>
      copyObjects(b, model, ids(model, '30'), moveBy({ x: 0, y: 1 })),
    );
    expect(model.entity(copied.ids[0]!)!.color).toEqual(RAL_3020);
    const mirrored = edit(model, (b) =>
      copyObjects(b, model, ids(model, '30'), mirrorIn({ x: 0, y: 5 }, { x: 10, y: 5 })),
    );
    expect(model.entity(mirrored.ids[0]!)!.color).toEqual(RAL_3020);
  });
});

describe('locked layers', () => {
  it('leave their objects where they are', () => {
    const base = square();
    const init: DocumentInit = {
      ...base,
      tables: {
        ...base.tables,
        layers: base.tables!.layers!.map((l) =>
          l.handle === LAYER_WALLS ? { ...layer(LAYER_WALLS, 'WALLS'), locked: true } : l,
        ),
      },
      entities: [...base.entities!, entityInit('36', lineGeom(0, 0, 1, 1), { layer: LAYER_WALLS })],
    };
    const model = DocumentModel.create(init);
    const r = edit(model, (b) =>
      transformObjects(b, model, ids(model, '36'), moveBy({ x: 1, y: 0 })),
    );
    expect(r.ids).toEqual([]);
    expect(model.entityByHandle('36')!.geom).toMatchObject({ start: { x: 0, y: 0 } });
  });
});

describe('refusalMessages', () => {
  it('counts what was left out, one line per reason', () => {
    expect(
      refusalMessages(
        new Map([
          ['a region cannot be copied', 1],
          ['OLE and proxy objects cannot be edited', 3],
        ]),
        'copied',
      ),
    ).toEqual([
      '1 object was not copied: a region cannot be copied.',
      '3 objects were not copied: OLE and proxy objects cannot be edited.',
    ]);
  });
});
