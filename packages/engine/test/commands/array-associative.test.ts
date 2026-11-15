// M3-11: associative arrays Triya makes (ARRAYASSOCIATIVITY 1, ARRAY's ASsociative Yes) and
// ARRAYEDIT on them (AutoCAD 2024 Help, "ARRAY (Command)", "ARRAYEDIT (Command)",
// "ARRAYASSOCIATIVITY (System Variable)"). An array is one INSERT of an anonymous array block of
// item INSERTs of an anonymous source block, with its definition in a TRIYA_ARRAY record
// (DEC-059).
//
// The drawing adds to the sample: 30 a circle r 1 at the origin (the source: its 2 × 2 extents
// make default spacings of 3), 31 a line (0,10)-(20,10), the path, and 33 a line (2,0)-(3,0).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  applyPoint,
  assocArrayOf,
  builtinCommands,
  compose,
  insertMatrix,
  isAssocArray,
  type AssocArray,
  type BusEvent,
  ChangeSetBuilder,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type Matrix2D,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { IDENTITY } from '../../src/geom/transform';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  circleGeom,
  entityInit,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...(base.entities ?? []),
      entityInit('30', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }),
      entityInit('31', lineGeom(0, 10, 20, 10)),
      entityInit('33', lineGeom(2, 0, 3, 0)),
      // A region, which cannot be copied, and an array AutoCAD made: an INSERT of an anonymous
      // block that its association objects react to.
      entityInit('35', { kind: 'REGION', loops: [] } as unknown as EntityGeometry),
      entityInit('37', circleGeom(0, 0, 2), { owner: '36' }),
      entityInit(
        '38',
        {
          kind: 'INSERT',
          block: '36',
          position: { x: 50, y: 50 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        },
        { reactors: ['39'] },
      ),
    ],
    tables: {
      ...base.tables,
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('36', '*U1')],
    },
    blocks: [...(base.blocks ?? []), { handle: '36', name: '*U1', basePoint: { x: 0, y: 0 } }],
  };
}

function setup(associativity = 1) {
  const model = DocumentModel.create(drawing());
  let picks: EntityId[] = [];
  let value = associativity;
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'sysvar' && r.name === 'ARRAYASSOCIATIVITY') {
        if (r.value !== undefined) value = r.value;
        return Promise.resolve({ ok: true, value });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  const live = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  const arrays = (): Entity[] =>
    live().filter((e) => assocArrayOf(model.objects.values(), e) !== undefined);
  const record = (e: Entity = arrays()[0]!): AssocArray => assocArrayOf(model.objects.values(), e)!;
  /** Every unit circle as drawn, through the blocks that hold it, as sorted centres. */
  const rings = (): number[][] => {
    const out: number[][] = [];
    const walk = (ids: readonly EntityId[], m: Matrix2D) => {
      for (const id of ids) {
        const e = model.entity(id)!;
        const g = e.geom;
        if (g.kind === 'CIRCLE' && g.radius === 1) {
          const c = applyPoint(m, g.center);
          out.push([r4(c.x), r4(c.y)]);
        } else if (g.kind === 'INSERT') {
          const base = model.blocks.get(g.block)!.basePoint;
          walk(model.blockEntities(g.block), compose(insertMatrix(g, base), m));
        }
      }
    };
    walk(model.blockEntities(MODEL_SPACE), IDENTITY);
    return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  };
  /** Every line drawn inside a block reference, as sorted [x1, y1, x2, y2]. */
  const sticks = (): number[][] => {
    const out: number[][] = [];
    const walk = (ids: readonly EntityId[], m: Matrix2D, inside: boolean) => {
      for (const id of ids) {
        const g = model.entity(id)!.geom;
        if (g.kind === 'LINE' && inside) {
          const a = applyPoint(m, g.start);
          const b = applyPoint(m, g.end);
          out.push([r4(a.x), r4(a.y), r4(b.x), r4(b.y)]);
        } else if (g.kind === 'INSERT') {
          const base = model.blocks.get(g.block)!.basePoint;
          walk(model.blockEntities(g.block), compose(insertMatrix(g, base), m), true);
        }
      }
    };
    walk(model.blockEntities(MODEL_SPACE), IDENTITY, false);
    return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  };
  return { model, bus, log, pick, live, arrays, record, rings, sticks, value: () => value };
}

const grid = (xs: number[], ys: number[]) =>
  xs.flatMap((x) => ys.map((y) => [x, y])).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

async function start(s: ReturnType<typeof setup>, command: string, source = '30') {
  s.pick(source);
  await s.bus.script([command, '0,0', '']);
}

describe('associative ARRAYRECT', () => {
  it('makes one array object of the source on Enter, the source moved into a block of its own', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    expect(s.log).toContain('Type = Rectangular  Associative = Yes');
    // While its options are edited the array shows as copies.
    expect(s.rings()).toEqual(grid([0, 3, 6, 9], [0, 3, 6]));
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.model.entityByHandle('30')).toBeUndefined();
    const [array] = s.arrays();
    expect(s.arrays()).toHaveLength(1);
    // On the current layer (WALLS), at the base point (the source's centre).
    expect(array!.layer).toBe(LAYER_WALLS);
    expect(array!.geom).toMatchObject({ kind: 'INSERT', position: { x: 0, y: 0 }, rotation: 0 });
    const r = s.record(array);
    expect(r.params).toEqual({
      kind: 'rectangular',
      columns: 4,
      rows: 3,
      columnSpacing: 3,
      rowSpacing: 3,
    });
    expect(r.owner).toBe(array!.extDict);
    const g = array!.geom as { block: string };
    expect(s.model.blocks.get(g.block)!.name).toMatch(/^\*U\d+$/);
    const items = s.model.blockEntities(g.block).map((id) => s.model.entity(id)!);
    expect(items).toHaveLength(12);
    for (const item of items) {
      expect(item.layer).toBe(LAYER_0);
      expect(item.color).toEqual({ kind: 'byBlock' });
      expect(item.geom).toMatchObject({ kind: 'INSERT', block: r.source });
    }
    expect(s.model.blocks.get(r.source)!.name).toMatch(/^\*U\d+$/);
    expect(s.model.blockEntities(r.source)).toHaveLength(1);
    expect(s.rings()).toEqual(grid([0, 3, 6, 9], [0, 3, 6]));
  });

  it('keeps the array object on Esc, and puts the source at the base point in its block', async () => {
    const s = setup();
    s.pick('33');
    await s.bus.script(['ARRAYRECT', '0,0', '', 'COU', '2', '1', 'B', '2,0']);
    await s.bus.cancel();
    const [array] = s.arrays();
    expect(array!.geom).toMatchObject({ position: { x: 2, y: 0 } });
    const source = s.model.blockEntities(s.record(array).source).map((id) => s.model.entity(id)!);
    expect(source[0]!.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
  });

  it('switches ASsociative off and on, keeping the choice in ARRAYASSOCIATIVITY', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['AS']);
    expect(s.bus.promptText).toBe('Create associative array [Yes/No] <Yes>:');
    await s.bus.script(['N']);
    expect(s.value()).toBe(0);
    await s.bus.script(['']);
    expect(s.arrays()).toHaveLength(0);
    expect(s.rings()).toHaveLength(12);
    expect(s.arrays()).toHaveLength(0);

    const t = setup(0);
    await start(t, 'ARRAYRECT');
    expect(t.log).toContain('Type = Rectangular  Associative = No');
    await t.bus.script(['AS', 'Y', '']);
    expect(t.value()).toBe(1);
    expect(t.arrays()).toHaveLength(1);
  });

  it('is an array of its own when copied, and its record goes when it is erased', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['']);
    const [array] = s.arrays();
    s.pick(array!.handle);
    await s.bus.script(['COPY', '0,0', '', '0,0', '100,0', '']);
    const [a, b] = s.arrays();
    expect(b).toBeDefined();
    const ra = s.record(a);
    const rb = s.record(b);
    expect(rb.handle).not.toBe(ra.handle);
    expect(rb.source).not.toBe(ra.source);
    expect((b!.geom as { block: string }).block).not.toBe((a!.geom as { block: string }).block);
    expect(rb.params).toEqual(ra.params);
    expect(s.rings()).toHaveLength(24);

    s.pick(b!.handle);
    await s.bus.script(['ERASE', '0,0', '']);
    expect([...s.model.objects.values()].filter(isAssocArray)).toHaveLength(1);
  });
});

describe('associative ARRAYPOLAR and ARRAYPATH', () => {
  it('keeps a polar array’s centre in its block and its base point in the source’s', async () => {
    const s = setup();
    s.pick('33');
    await s.bus.script(['ARRAYPOLAR', '0,0', '', '0,0', 'I', '4', '']);
    const [array] = s.arrays();
    // The base point, the stick's centre (2.5, 0), is the array's position.
    expect(array!.geom).toMatchObject({ position: { x: 2.5, y: 0 } });
    expect(s.record(array).params).toEqual({
      kind: 'polar',
      center: { x: -2.5, y: 0 },
      base: { x: 0, y: 0 },
      items: 4,
      fillAngle: 2 * Math.PI,
      rows: 1,
      rowSpacing: 1.5,
      rotateItems: true,
    });
  });

  it('follows the path it was made along, and stops following it once it is erased', async () => {
    const s = setup();
    s.pick('30');
    await s.bus.script(['ARRAYPATH', '0,0', '']);
    s.pick('31');
    await s.bus.script(['1,10', 'B', '0,0', 'M', 'D', 'I', '3', '']);
    const [array] = s.arrays();
    expect(s.record(array).params).toMatchObject({
      kind: 'path',
      path: '31',
      method: 'divide',
      items: 3,
      reversed: false,
      tangent: { x: 1, y: 0 },
      base: { x: 0, y: 0 },
    });
    // The base point, the circle's centre, is the array's position and its source's origin.
    expect(array!.geom).toMatchObject({ position: { x: 0, y: 0 } });
    expect(s.rings()).toEqual([
      [0, 10],
      [10, 10],
      [20, 10],
    ]);
    s.pick('31');
    await s.bus.script(['ERASE', '0,0', '']);
    expect(s.record(array).params).not.toHaveProperty('path');
    expect(s.rings()).toHaveLength(3);
  });
});

describe('ARRAYEDIT', () => {
  async function made(s: ReturnType<typeof setup>) {
    await start(s, 'ARRAYRECT');
    await s.bus.script(['']);
    return s.arrays()[0]!;
  }

  it('changes a rectangular array’s rows and columns, remaking its items', async () => {
    const s = setup();
    const array = await made(s);
    s.pick(array.handle);
    await s.bus.script(['ARRAYEDIT', '0,0']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Source/REPlace/Base point/Rows/Columns/RESet/eXit] <eXit>:',
    );
    await s.bus.script(['C', '2', '5', 'R', '2', 'T', '2']);
    expect(s.record().params).toEqual({
      kind: 'rectangular',
      columns: 2,
      rows: 2,
      columnSpacing: 5,
      rowSpacing: 2,
    });
    expect(s.rings()).toEqual(grid([0, 5], [0, 2]));
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    // The array keeps its handle and blocks.
    expect(s.arrays()[0]!.handle).toBe(array.handle);
  });

  it('follows a moved array, and refuses what is not an array it made', async () => {
    const s = setup();
    const array = await made(s);
    s.pick(array.handle);
    await s.bus.script(['MOVE', '0,0', '', '0,0', '10,0']);
    s.pick('20');
    await s.bus.script(['ARRAYEDIT', '0,0']);
    expect(s.log.at(-1)).toBe('The object selected is not an associative array.');
    expect(s.bus.promptText).toBe('Select array:');
    s.pick(array.handle);
    await s.bus.script(['10,0', 'R', '1', '']);
    expect(s.rings()).toEqual(grid([10, 13, 16, 19], [0]));
    await s.bus.script(['']);
    // Nothing picked ends it.
    s.pick();
    await s.bus.script(['ARRAYEDIT', '']);
    expect(s.bus.command).toBeUndefined();
  });

  it('edits a polar array’s items, angles, rows, rotation and base point', async () => {
    const s = setup();
    s.pick('33');
    await s.bus.script(['ARRAYPOLAR', '0,0', '', '0,0', '']);
    s.pick(s.arrays()[0]!.handle);
    await s.bus.script(['ARRAYEDIT', '0,0']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Source/REPlace/Base point/Items/Angle between/Fill angle/Rows/ROTate items/RESet/eXit] <eXit>:',
    );
    await s.bus.script(['I', '3', 'F', '180', 'A', '45', 'R', '2', '1', 'ROT', 'N']);
    const p = s.record().params;
    expect(p).toMatchObject({ items: 3, rows: 2, rowSpacing: 1, rotateItems: false });
    expect(r4((p as { fillAngle: number }).fillAngle)).toBe(r4(Math.PI / 2));
    await s.bus.script(['B', '2,0', '']);
    // Picked at the stick's start, (2, 0): half a unit left of the old base point.
    expect(s.record().params).toMatchObject({ base: { x: -0.5, y: 0 } });
  });

  it('edits a path array’s method, items, rows, alignment and base point, until its path goes', async () => {
    const s = setup();
    s.pick('30');
    await s.bus.script(['ARRAYPATH', '0,0', '']);
    s.pick('31');
    await s.bus.script(['1,10', 'B', '0,0', '']);
    s.pick(s.arrays()[0]!.handle);
    await s.bus.script(['ARRAYEDIT', '0,0']);
    expect(s.bus.promptText).toBe(
      'Enter an option [Source/REPlace/Method/Base point/Items/Rows/Align items/RESet/eXit] <eXit>:',
    );
    await s.bus.script(['M', 'D', 'I', '2', 'R', '2', '1', 'A', 'N']);
    expect(s.record().params).toMatchObject({
      method: 'divide',
      items: 2,
      rows: 2,
      rowSpacing: 1,
      align: false,
    });
    expect(s.rings()).toEqual(grid([0, 20], [10, 11]));
    // Base point: picked one unit right of item 0's centre, so the items shift left.
    await s.bus.script(['B', '1,10']);
    expect(s.record().params).toMatchObject({ base: { x: 1, y: 0 } });
    expect(s.rings()).toEqual(grid([-1, 19], [10, 11]));
    await s.bus.script(['']);
    s.pick('31');
    await s.bus.script(['ERASE', '0,0', '']);
    s.pick(s.arrays()[0]!.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'I']);
    expect(s.log.at(-1)).toBe("The array's path is gone: its items stay where they are.");
    expect(s.rings()).toEqual(grid([-1, 19], [10, 11]));
  });

  it('refuses an array made elsewhere, and a path array scaled out of shape', async () => {
    const s = setup();
    s.pick('38');
    await s.bus.script(['ARRAYEDIT', '0,0']);
    expect(s.log.at(-1)).toBe(
      'Triya cannot edit this array: it was not made in Triya, and its parameters are not documented.',
    );
    s.pick();
    await s.bus.script(['']);
    s.pick('30');
    await s.bus.script(['ARRAYPATH', '0,0', '']);
    s.pick('31');
    await s.bus.script(['1,10', '']);
    const array = s.arrays()[0]!;
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(array.id, { geom: { ...array.geom, scale: { x: 2, y: 1, z: 1 } } as never });
    s.model.apply(b.build());
    s.pick(array.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'R', '2', '', '']);
    expect(s.log).toContain('The array cannot be remade: it is not scaled uniformly.');
    expect(s.bus.command).toBeUndefined();
  });

  it('ends on Esc, and leaves what cannot be copied out of a new array', async () => {
    const s = setup();
    s.pick('33');
    await s.bus.script(['ARRAYPOLAR', '0,0', '', '0,0', '']);
    s.pick(s.arrays()[0]!.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'R', '3']);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.record().params).toMatchObject({ rows: 1 });

    const t = setup();
    t.pick('35');
    await t.bus.script(['ARRAYRECT', '0,0', '', '']);
    expect(t.arrays()).toEqual([]);
    expect(t.log).toContain('1 object was not arrayed: a region cannot be copied.');
    expect(t.model.entityByHandle('35')).toBeDefined();
  });
});

describe('ARRAYEDIT Base point, REPlace and RESet (part 2)', () => {
  async function made(s: ReturnType<typeof setup>) {
    await start(s, 'ARRAYRECT');
    await s.bus.script(['']);
    const array = s.arrays()[0]!;
    s.pick(array.handle);
    await s.bus.script(['ARRAYEDIT', '0,0']);
    return array;
  }

  it('moves a rectangular array’s base point, leaving its items where they are', async () => {
    const s = setup();
    const array = await made(s);
    expect(s.bus.promptText).toBe(
      'Enter an option [Source/REPlace/Base point/Rows/Columns/RESet/eXit] <eXit>:',
    );
    await s.bus.script(['B']);
    expect(s.bus.promptText).toBe('Specify base point <current>:');
    await s.bus.script(['1,2']);
    expect(s.arrays()[0]!.geom).toMatchObject({ position: { x: 1, y: 2 } });
    expect(s.rings()).toEqual(grid([0, 3, 6, 9], [0, 3, 6]));
    const source = s.model.blockEntities(s.record().source).map((id) => s.model.entity(id)!);
    expect(source[0]!.geom).toMatchObject({ center: { x: -1, y: -2 } });
    // Enter keeps it where it is.
    await s.bus.script(['B', '']);
    expect(s.arrays()[0]!.geom).toMatchObject({ position: { x: 1, y: 2 } });
    // Later edits keep the base point: rows grow from the same items.
    await s.bus.script(['R', '2', '']);
    expect(s.rings()).toEqual(grid([0, 3, 6, 9], [0, 3]));
    expect(s.arrays()[0]!.handle).toBe(array.handle);
  });

  it('replaces picked items with other objects, which stay in the drawing, and RESet takes them back', async () => {
    const s = setup();
    await made(s);
    s.pick('33');
    await s.bus.script(['REP', '0,0', '']);
    expect(s.bus.promptText).toBe('Select base point of replacement objects <centroid>:');
    // The stick's start lands on each item's base point (the circle's centre).
    await s.bus.script(['2,0']);
    expect(s.bus.promptText).toBe('Select an item in array to replace or [Source objects]:');
    await s.bus.script(['3.5,0.5', '6,3']);
    expect(s.model.entityByHandle('33')).toBeDefined();
    const r = s.record();
    expect(r.replaced).toHaveLength(2);
    expect(r.replaced![0]).toMatchObject({ item: 1, row: 0 });
    expect(r.replaced![1]).toMatchObject({ item: 2, row: 1, block: r.replaced![0]!.block });
    expect(s.model.blocks.get(r.replaced![0]!.block)!.name).toMatch(/^\*U\d+$/);
    expect(s.sticks()).toEqual([
      [3, 0, 4, 0],
      [6, 3, 7, 3],
    ]);
    expect(s.rings()).toHaveLength(10);
    // A point off the array finds nothing; Enter ends the picking.
    await s.bus.script(['50,50']);
    expect(s.log.at(-1)).toBe('No item of the array is there.');
    await s.bus.script(['']);
    expect(s.bus.promptText).toMatch(/^Enter an option/);

    await s.bus.script(['RES']);
    expect(s.record()).not.toHaveProperty('replaced');
    expect(s.sticks()).toEqual([]);
    expect(s.rings()).toHaveLength(12);
  });

  it('replaces the source objects for every item not replaced already', async () => {
    const s = setup();
    await made(s);
    const before = s.record().source;
    s.pick('33');
    await s.bus.script(['REP', '0,0', '', '2,0', '0,3', '']);
    s.pick('33');
    await s.bus.script(['REP', '0,0', '', '', 'S']);
    expect(s.bus.promptText).toMatch(/^Enter an option/);
    const r = s.record();
    expect(r.source).not.toBe(before);
    // Both replacements show the stick, the second about its centre (2.5, 0).
    expect(s.sticks()).toHaveLength(12);
    expect(s.sticks()).toContainEqual([0, 3, 1, 3]);
    expect(s.sticks()).toContainEqual([-0.5, 0, 0.5, 0]);
    expect(s.rings()).toEqual([]);
    // RESet leaves the new source objects: only the item overrides go.
    await s.bus.script(['RES']);
    expect(s.sticks()).toContainEqual([-0.5, 3, 0.5, 3]);
  });

  it('will not replace items with the array itself, and copies an array with its replacements', async () => {
    const s = setup();
    const array = await made(s);
    s.pick(array.handle);
    await s.bus.script(['REP', '0,0', '']);
    expect(s.log.at(-1)).toBe('An array cannot replace its own items.');
    s.pick('33');
    await s.bus.script(['REP', '0,0', '', '2,0', '0,0', '', '']);
    s.pick(array.handle);
    await s.bus.script(['COPY', '0,0', '', '0,0', '100,0', '']);
    const [a, b] = s.arrays();
    const ra = s.record(a);
    const rb = s.record(b);
    expect(rb.replaced).toEqual([{ item: 0, row: 0, block: expect.any(String) }]);
    expect(rb.replaced![0]!.block).not.toBe(ra.replaced![0]!.block);
    expect(s.sticks()).toEqual([
      [0, 0, 1, 0],
      [100, 0, 101, 0],
    ]);
  });
});

describe('ARRAYEDIT Source and ARRAYCLOSE (part 2)', () => {
  async function opened(s: ReturnType<typeof setup>) {
    await start(s, 'ARRAYRECT');
    await s.bus.script(['COU', '2', '1', '']);
    s.pick(s.arrays()[0]!.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'S']);
    expect(s.bus.promptText).toBe('Select item in array:');
    await s.bus.script(['3.2,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toBe('Edit the item, then save or discard the changes with ARRAYCLOSE.');
  }
  /** The unit circles standing in model space: the item's objects being edited. */
  const editing = (s: ReturnType<typeof setup>) =>
    s.live().filter((e) => e.geom.kind === 'CIRCLE' && e.geom.radius === 1);

  it('opens the item’s objects in its place, and every item follows their edits', async () => {
    const s = setup();
    await opened(s);
    const [copy] = editing(s);
    expect(copy!.geom).toMatchObject({ center: { x: 3, y: 0 } });
    // The item itself is left out while it is edited.
    expect(s.rings()).toEqual([
      [0, 0],
      [3, 0],
    ]);
    s.pick(copy!.handle);
    await s.bus.script(['MOVE', '0,0', '', '0,0', '0,1']);
    expect(s.rings()).toEqual([
      [0, 1],
      [3, 1],
    ]);
    // Drawn objects join the source too.
    await s.bus.script(['LINE', '3,0', '4,0', '']);
    expect(s.sticks()).toEqual([[0, 0, 1, 0]]);
    await s.bus.script(['ARRAYEDIT']);
    expect(s.log.at(-1)).toBe(
      'An array is being edited: save or discard its changes with ARRAYCLOSE first.',
    );
    await s.bus.script(['ARRAYCLOSE']);
    expect(s.bus.promptText).toBe('Save changes to array [Yes/No] <Yes>:');
    await s.bus.script(['']);
    expect(editing(s)).toEqual([]);
    expect(s.rings()).toEqual([
      [0, 1],
      [3, 1],
    ]);
    expect(s.sticks()).toEqual([
      [0, 0, 1, 0],
      [3, 0, 4, 0],
    ]);
    expect(s.live().some((e) => e.geom.kind === 'LINE' && r4(e.geom.start.x) === 3)).toBe(false);
    await s.bus.script(['ARRAYCLOSE']);
    expect(s.log.at(-1)).toBe('No array is being edited.');
  });

  it('puts the objects back as they were on No', async () => {
    const s = setup();
    await opened(s);
    const before = s.model.blockEntities(s.record().source).map((id) => s.model.entity(id)!.handle);
    s.pick(editing(s)[0]!.handle);
    await s.bus.script(['MOVE', '0,0', '', '0,0', '0,1']);
    await s.bus.script(['ARRAYCLOSE', 'N']);
    expect(editing(s)).toEqual([]);
    expect(s.rings()).toEqual([
      [0, 0],
      [3, 0],
    ]);
    expect(
      s.model.blockEntities(s.record().source).map((id) => s.model.entity(id)!.handle),
    ).toEqual(before);
  });

  it('discards when every object was erased, and forgets an array that is gone', async () => {
    const s = setup();
    await opened(s);
    s.pick(editing(s)[0]!.handle);
    await s.bus.script(['ERASE', '0,0', '']);
    // Erasing them all leaves the block as it was.
    expect(s.rings()).toEqual([[0, 0]]);
    await s.bus.script(['ARRAYCLOSE', 'Y']);
    expect(s.log).toContain("The item's objects are all erased: the changes are discarded.");
    expect(s.rings()).toEqual([
      [0, 0],
      [3, 0],
    ]);

    const t = setup();
    await opened(t);
    t.pick(t.arrays()[0]!.handle);
    await t.bus.script(['ERASE', '0,0', '']);
    await t.bus.script(['ARRAYCLOSE']);
    expect(t.log.at(-1)).toBe('No array is being edited.');
  });

  it('closes on an undone opening, putting the item back', async () => {
    const s = setup();
    await opened(s);
    await s.bus.script(['U']);
    expect(editing(s)).toEqual([]);
    expect(s.rings()).toHaveLength(2);
    await s.bus.script(['ARRAYCLOSE', 'N']);
    expect(s.rings()).toEqual([
      [0, 0],
      [3, 0],
    ]);
    // Esc at the question leaves the edit open.
    const t = setup();
    await opened(t);
    await t.bus.script(['ARRAYCLOSE']);
    await t.bus.cancel();
    expect(editing(t)).toHaveLength(1);
    await t.bus.script(['ARRAYCLOSE', 'N']);
    expect(editing(t)).toEqual([]);
  });

  it('picks again where no item is, and refuses an item scaled out of shape', async () => {
    const s = setup();
    await start(s, 'ARRAYRECT');
    await s.bus.script(['']);
    const array = s.arrays()[0]!;
    s.pick(array.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'S', '50,50']);
    expect(s.log.at(-1)).toBe('No item of the array is there.');
    await s.bus.script(['']);
    expect(s.bus.promptText).toMatch(/^Enter an option/);
    await s.bus.script(['']);
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(array.id, { geom: { ...array.geom, scale: { x: 2, y: 1, z: 1 } } as never });
    s.model.apply(b.build());
    s.pick(array.handle);
    await s.bus.script(['ARRAYEDIT', '0,0', 'S', '0,0']);
    expect(s.log.at(-1)).toBe('The item cannot be edited: it is not scaled uniformly.');
  });
});

describe('path arrays follow their path (part 2)', () => {
  it('remakes the items along a path that moved or changed shape', async () => {
    const s = setup();
    s.pick('30');
    await s.bus.script(['ARRAYPATH', '0,0', '']);
    s.pick('31');
    await s.bus.script(['1,10', 'B', '0,0', 'M', 'D', 'I', '3', '']);
    s.pick('31');
    await s.bus.script(['MOVE', '0,0', '', '0,0', '0,5']);
    expect(s.rings()).toEqual([
      [0, 15],
      [10, 15],
      [20, 15],
    ]);
    // Undo takes the items back with the path.
    await s.bus.script(['U']);
    expect(s.rings()).toEqual([
      [0, 10],
      [10, 10],
      [20, 10],
    ]);
    // Moved with the path, the array stays on it.
    s.pick('31', s.arrays()[0]!.handle);
    await s.bus.script(['MOVE', '0,0', '', '0,0', '5,0']);
    expect(s.rings()).toEqual([
      [5, 10],
      [15, 10],
      [25, 10],
    ]);
    // A path that changes length spreads the items along it.
    s.pick('31');
    await s.bus.script(['SCALE', '0,0', '', '5,10', '2']);
    expect(s.rings()).toEqual([
      [5, 10],
      [25, 10],
      [45, 10],
    ]);
  });
});
