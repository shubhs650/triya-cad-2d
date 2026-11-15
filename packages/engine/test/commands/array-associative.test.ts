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
  type DocumentInit,
  type Entity,
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
    ],
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
  return { model, bus, log, pick, live, arrays, record, rings, value: () => value };
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
    expect(s.live().filter((e) => e.geom.kind === 'INSERT')).toHaveLength(0);

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
    expect(s.bus.promptText).toBe('Enter an option [Rows/Columns/eXit] <eXit>:');
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
      'Enter an option [Base point/Items/Angle between/Fill angle/Rows/ROTate items/eXit] <eXit>:',
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
      'Enter an option [Method/Base point/Items/Rows/Align items/eXit] <eXit>:',
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
});
