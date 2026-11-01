import { describe, expect, it } from 'vitest';
import {
  createEntity,
  DocumentModel,
  invertChangeSet,
  isEmptyChangeSet,
  updateEntity,
  updateRecord,
  type ChangeSet,
} from '../../src/model/index';
import {
  blockRecord,
  circleGeom,
  entityAt,
  entityInit,
  LAYER_WALLS,
  layer,
  lineGeom,
  MODEL_SPACE,
  PAPER_SPACE,
  sampleModel,
  snapshot,
} from './fixtures';

const META = {
  sourceVersion: 'AC1032',
  codePage: 'ANSI_1252',
  insUnits: 4,
  measurement: 'metric',
} as const;

describe('DocumentModel.create', () => {
  it('assigns dense ids in file order and keeps block entity order', () => {
    const m = sampleModel();
    expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 2, 3]);
    expect(m.blockEntities(PAPER_SPACE)).toEqual([4]);
    expect(m.entity(2)?.handle).toBe('21');
    expect(m.entityByHandle('23')?.id).toBe(3);
    expect(m.ids.idOf('24')).toBe(4);
    expect(m.entityCount).toBe(4);
    expect([...m.entities()].map((e) => e.handle)).toEqual(['20', '21', '23', '24']);
    expect(m.handSeed).toBe('40');
    expect(m.layouts.map((l) => l.name)).toEqual(['Model', 'Layout1']);
    expect(m.version).toBe(0);
  });

  it('raises a stale $HANDSEED above every handle, passthrough included', () => {
    const m = DocumentModel.create({
      meta: META,
      handSeed: '30',
      tables: { blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')] },
      blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
      passthrough: ['3A'],
    });
    expect(m.handSeed).toBe('3B');
    expect(m.handles.seedWasRaised).toBe(true);
  });

  it.each([
    [
      'a handle used twice across collections',
      { objects: [{ handle: '20', type: 'XRECORD', owner: 'C' }] },
      /handle 20 is used twice/,
    ],
    [
      'an entity whose owner block does not exist',
      { entities: [entityInit('50', lineGeom(0, 0, 1, 1), { owner: '77' })] },
      /owner block 77/,
    ],
    [
      'a block with no BLOCK_RECORD',
      { blocks: [{ handle: '78', name: 'X', basePoint: { x: 0, y: 0 } }] },
      /block 78 has no BLOCK_RECORD/,
    ],
    ['a non-canonical handle', { passthrough: ['3a'] }, /canonical/],
  ])('rejects %s', (_label, extra, error) => {
    const base = {
      meta: META,
      handSeed: '40',
      tables: { blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')] },
      blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
      entities: [entityInit('20', lineGeom(0, 0, 1, 1))],
    };
    expect(() => DocumentModel.create({ ...base, ...extra })).toThrow(error);
  });
});

/** Apply, check, invert, check the model is back to where it started, re-apply. */
function roundTrip(m: DocumentModel, cs: ChangeSet, check: () => void): void {
  const before = snapshot(m);
  m.apply(cs);
  check();
  const after = snapshot(m);
  m.apply(invertChangeSet(cs));
  expect(snapshot(m)).toEqual(before);
  m.apply(cs);
  expect(snapshot(m)).toEqual(after);
}

describe('applyChangeSet and invertChangeSet', () => {
  it('adds an entity at its index and removes it again on inversion', () => {
    const m = sampleModel();
    const handle = m.handles.allocate();
    const e = createEntity(m.ids.assign(handle), entityInit(handle, circleGeom(1, 1, 1)));
    roundTrip(m, { entities: { added: [{ entity: e, index: 1 }] } }, () => {
      expect(m.blockEntities(MODEL_SPACE)).toEqual([1, e.id, 2, 3]);
      expect(m.entityByHandle(handle)).toBe(e);
    });
  });

  it('restores a removed entity at its original position, as the same object', () => {
    const m = sampleModel();
    const victim = entityAt(m, MODEL_SPACE, 1);
    const cs: ChangeSet = { entities: { removed: [{ entity: victim, index: 1 }] } };
    m.apply(cs);
    expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 3]);
    expect(m.entity(victim.id)).toBeUndefined();
    expect(m.entityByHandle(victim.handle)).toBeUndefined();
    m.apply(invertChangeSet(cs));
    expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 2, 3]);
    expect(m.entity(victim.id)).toBe(victim);
  });

  it('applies several removals in one block using their original indices', () => {
    const m = sampleModel();
    const [a, , c] = [0, 1, 2].map((i) => entityAt(m, MODEL_SPACE, i));
    roundTrip(
      m,
      {
        entities: {
          removed: [
            { entity: a!, index: 0 },
            { entity: c!, index: 2 },
          ],
        },
      },
      () => expect(m.blockEntities(MODEL_SPACE)).toEqual([2]),
    );
  });

  it('replaces an updated entity in place', () => {
    const m = sampleModel();
    const before = entityAt(m, MODEL_SPACE, 0);
    const after = updateEntity(before, { layer: LAYER_WALLS });
    roundTrip(m, { entities: { updated: [{ before, after }] } }, () => {
      expect(m.entity(before.id)).toBe(after);
      expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 2, 3]);
    });
  });

  it('moves an entity to another block as remove + add with the same handle and id', () => {
    const m = sampleModel();
    const e = entityAt(m, MODEL_SPACE, 2);
    const moved = createEntity(e.id, { ...e, owner: PAPER_SPACE });
    roundTrip(
      m,
      {
        entities: {
          removed: [{ entity: e, index: 2 }],
          added: [{ entity: moved, index: 0 }],
        },
      },
      () => {
        expect(m.blockEntities(MODEL_SPACE)).toEqual([1, 2]);
        expect(m.blockEntities(PAPER_SPACE)).toEqual([e.id, 4]);
        expect(m.entityByHandle(e.handle)).toBe(moved);
      },
    );
  });

  it('sets, changes and deletes header variables', () => {
    const m = sampleModel();
    roundTrip(
      m,
      {
        header: [
          { name: '$LTSCALE', before: 1, after: 2.5 },
          { name: '$CLAYER', before: 'WALLS', after: undefined },
          { name: '$ANGBASE', before: undefined, after: 0 },
        ],
      },
      () => {
        expect(m.header.get('$LTSCALE')).toBe(2.5);
        expect(m.header.has('$CLAYER')).toBe(false);
        expect(m.header.get('$ANGBASE')).toBe(0);
      },
    );
  });

  it('adds, updates and removes table records and objects', () => {
    const m = sampleModel();
    const walls = m.tables.layers.get(LAYER_WALLS)!;
    const dict = m.objects.get('C')!;
    roundTrip(
      m,
      {
        tables: {
          layers: {
            added: [layer('41', 'HIDDEN')],
            updated: [{ before: walls, after: updateRecord(walls, { frozen: true }) }],
          },
        },
        objects: { removed: [dict], added: [{ handle: '42', type: 'XRECORD', owner: '0' }] },
      },
      () => {
        expect(m.tables.layers.get('41')?.name).toBe('HIDDEN');
        expect(m.tables.layers.get(LAYER_WALLS)?.frozen).toBe(true);
        expect(m.objects.has('C')).toBe(false);
        expect(m.objects.get('42')?.type).toBe('XRECORD');
      },
    );
  });

  it('never lowers $HANDSEED when an addition is undone, so handles are not reused', () => {
    const m = sampleModel();
    const handle = m.handles.allocate();
    const e = createEntity(m.ids.assign(handle), entityInit(handle, circleGeom(1, 1, 1)));
    const cs: ChangeSet = { entities: { added: [{ entity: e, index: 3 }] } };
    m.apply(cs);
    m.apply(invertChangeSet(cs));
    expect(m.handSeed).toBe('41');
    expect(m.handles.allocate()).toBe('41');
  });

  it('raises $HANDSEED above a handle added from outside the allocator', () => {
    const m = sampleModel();
    m.apply({ objects: { added: [{ handle: '90', type: 'XRECORD', owner: '0' }] } });
    expect(m.handSeed).toBe('91');
  });

  it('counts versions', () => {
    const m = sampleModel();
    m.apply({ header: [{ name: '$LTSCALE', before: 1, after: 2 }] });
    expect(m.version).toBe(1);
  });

  it('inverting twice gives the original change set', () => {
    const m = sampleModel();
    const e = entityAt(m, MODEL_SPACE, 0);
    const cs: ChangeSet = {
      entities: {
        removed: [{ entity: e, index: 0 }],
        updated: [
          {
            before: entityAt(m, MODEL_SPACE, 1),
            after: updateEntity(entityAt(m, MODEL_SPACE, 1), { ltScale: 2 }),
          },
        ],
      },
      header: [{ name: '$LTSCALE', before: 1, after: 3 }],
      objects: { added: [{ handle: '42', type: 'XRECORD', owner: '0' }] },
      tables: { layers: { removed: [m.tables.layers.get(LAYER_WALLS)!] } },
    };
    expect(invertChangeSet(invertChangeSet(cs))).toEqual(cs);
  });

  it('recognises empty change sets', () => {
    expect(isEmptyChangeSet({})).toBe(true);
    expect(isEmptyChangeSet({ entities: { added: [] }, tables: { layers: {} }, header: [] })).toBe(
      true,
    );
    expect(isEmptyChangeSet({ header: [{ name: '$X', before: undefined, after: 1 }] })).toBe(false);
  });
});

describe('applyChangeSet validation is atomic', () => {
  const rejects = (make: (m: DocumentModel) => ChangeSet, error: RegExp): void => {
    const m = sampleModel();
    const before = snapshot(m);
    const seed = m.handSeed;
    expect(() => m.apply(make(m))).toThrow(error);
    expect(snapshot(m)).toEqual(before);
    expect(m.version).toBe(0);
    expect(m.handSeed).toBe(seed);
  };

  // Every case pairs a valid change with an invalid one, to prove nothing is half-applied.
  const okHeader = { name: '$LTSCALE', before: 1, after: 9 } as const;

  it('rejects a stale update', () => {
    rejects((m) => {
      const cur = entityAt(m, MODEL_SPACE, 0);
      const stale = updateEntity(cur, { ltScale: 2 });
      return {
        header: [okHeader],
        entities: { updated: [{ before: stale, after: updateEntity(stale, { ltScale: 3 }) }] },
      };
    }, /stale/);
  });

  it('rejects an update that changes identity or type', () => {
    rejects((m) => {
      const cur = entityAt(m, MODEL_SPACE, 0);
      const other = createEntity(cur.id, { ...cur, type: 'CIRCLE', geom: circleGeom(0, 0, 1) });
      return { header: [okHeader], entities: { updated: [{ before: cur, after: other }] } };
    }, /cannot change type/);
  });

  it('rejects removing an entity from the wrong index', () => {
    rejects(
      (m) => ({
        header: [okHeader],
        entities: { removed: [{ entity: entityAt(m, MODEL_SPACE, 1), index: 0 }] },
      }),
      /not at index 0/,
    );
  });

  it('rejects removing an entity that is not in the model', () => {
    rejects((m) => {
      const ghost = createEntity(m.ids.assign('77'), entityInit('77', lineGeom(0, 0, 1, 1)));
      return { header: [okHeader], entities: { removed: [{ entity: ghost, index: 0 }] } };
    }, /not in the model/);
  });

  it('rejects adding a handle that is already used', () => {
    rejects((m) => {
      const dup = createEntity(m.ids.assign('C'), entityInit('C', lineGeom(0, 0, 1, 1)));
      return { header: [okHeader], entities: { added: [{ entity: dup, index: 0 }] } };
    }, /handle C is already used/);
  });

  it('rejects adding an entity whose id is not bound to its handle', () => {
    rejects(() => {
      const e = createEntity(999, entityInit('77', lineGeom(0, 0, 1, 1)));
      return { header: [okHeader], entities: { added: [{ entity: e, index: 0 }] } };
    }, /id 999 is not bound to handle 77/);
  });

  it('rejects an addition index past the end of the block', () => {
    rejects((m) => {
      const e = createEntity(m.ids.assign('77'), entityInit('77', lineGeom(0, 0, 1, 1)));
      return { header: [okHeader], entities: { added: [{ entity: e, index: 4 }] } };
    }, /index 4 is out of range/);
  });

  it('rejects an addition to a block that does not exist', () => {
    rejects((m) => {
      const e = createEntity(
        m.ids.assign('77'),
        entityInit('77', lineGeom(0, 0, 1, 1), { owner: 'AB' }),
      );
      return { header: [okHeader], entities: { added: [{ entity: e, index: 0 }] } };
    }, /owner block AB/);
  });

  it('rejects touching the same entity twice', () => {
    rejects((m) => {
      const cur = entityAt(m, MODEL_SPACE, 0);
      return {
        entities: {
          updated: [{ before: cur, after: updateEntity(cur, { ltScale: 2 }) }],
          removed: [{ entity: cur, index: 0 }],
        },
      };
    }, /more than once/);
  });

  it('rejects a stale header value', () => {
    rejects(
      () => ({ header: [okHeader, { name: '$CLAYER', before: '0', after: 'X' }] }),
      /\$CLAYER is stale/,
    );
  });

  it('accepts a header vector equal by value', () => {
    const m = sampleModel();
    m.apply({
      header: [{ name: '$EXTMIN', before: { x: 0, y: 0, z: 0 }, after: { x: 1, y: 1, z: 0 } }],
    });
    expect(m.header.get('$EXTMIN')).toEqual({ x: 1, y: 1, z: 0 });
  });

  it('rejects stale or duplicate keyed records', () => {
    rejects(
      (m) => ({
        header: [okHeader],
        tables: { layers: { removed: [layer(LAYER_WALLS, 'WALLS')] } },
        objects: { removed: [m.objects.get('C')!] },
      }),
      /layers record 11 is stale/,
    );
    rejects(
      () => ({ header: [okHeader], objects: { added: [{ handle: '20', type: 'X', owner: '0' }] } }),
      /handle 20 is already used/,
    );
    rejects(
      () => ({
        header: [okHeader],
        objects: { removed: [{ handle: '99', type: 'X', owner: '0' }] },
      }),
      /object 99 is not in the model/,
    );
  });
});
