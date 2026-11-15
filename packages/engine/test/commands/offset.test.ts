// M3-02 part 1: OFFSET on the PromptBus, driven as the command line drives it, with AutoCAD
// 2024's prompts and options (AutoCAD 2024 Help, "OFFSET (Command)"): a distance or Through,
// Erase, Layer, Multiple and Undo, the distance remembered (OFFSETDIST). The geometry is
// `edit/offset.ts`'s (test/edit/offset.test.ts). The sample drawing's model space holds
// 20 (0,0)-(10,0) on layer 0, 21 a circle at (5,5) r 2 on WALLS and 23 (0,0)-(0,10).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, MODEL_SPACE, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** A canvas whose picks take the objects within 0.25 of the pick, nearest first. */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'get') {
        return Promise.resolve({
          ok: true,
          view: { center: { x: 0, y: 0 }, width: 100, height: 100, paper: false },
        });
      }
      if (r.op === 'pick') {
        const hits: [number, EntityId][] = [];
        for (const e of model().entities()) {
          if (e.owner !== MODEL_SPACE) continue;
          const g = e.geom;
          const d =
            g.kind === 'POINT'
              ? Math.hypot(g.position.x - r.point.x, g.position.y - r.point.y)
              : closestPoint(offsetCurveOf(g)!, r.point, toleranceForSize(100)).distance;
          if (d < 0.25) hits.push([d, e.id]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

function setup(extra: EntityGeometry[] = []) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    entities: [
      ...(init.entities ?? []),
      ...extra.map((g, i) => entityInit((0x30 + i).toString(16), g)),
    ],
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => model) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const ends = () =>
    added().map((e) => {
      const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
      return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
    });
  return { model, bus, log, added, ends };
}

const LINE_20 = { x: 5, y: 0 };

describe('OFFSET', () => {
  it('offsets a line by a distance to the side picked, with the source properties', async () => {
    const { bus, ends, added, log } = setup();
    await bus.script(['O']);
    expect(log).toContain('Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=0');
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <Through>:');
    await bus.submit('2');
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
    await bus.pick(LINE_20);
    expect(bus.promptText).toBe('Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:');
    await bus.submit('3,-5');
    expect(ends()).toEqual([[0, -2, 10, -2]]);
    expect(added()[0]).toMatchObject({ type: 'LINE', owner: MODEL_SPACE, layer: LAYER_0 });
    // Back at "Select object": the circle, outward.
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
    await bus.pick({ x: 7, y: 5 });
    await bus.submit('9,5');
    const circle = added()[1]!;
    expect(circle).toMatchObject({ layer: LAYER_WALLS });
    expect(circle.geom).toMatchObject({ kind: 'CIRCLE', center: { x: 5, y: 5 }, radius: 4 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    // The distance is the next OFFSET's default.
    await bus.script(['OFFSET']);
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <2.0000>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
  });

  it('refuses a distance that is not positive and an object it cannot offset', async () => {
    const { bus, log, added } = setup([{ kind: 'POINT', position: { x: 20, y: 20 } }]);
    await bus.script(['OFFSET', '0']);
    expect(log.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.script(['-1']);
    expect(log.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.submit('1');
    await bus.pick({ x: 20, y: 20 });
    expect(log.at(-1)).toBe('Cannot offset that object.');
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
    // A circle offset inward by more than its radius makes nothing.
    await bus.submit('');
    await bus.script(['OFFSET', '3']);
    await bus.pick({ x: 7, y: 5 });
    await bus.submit('5,5');
    expect(log.at(-1)).toBe('Cannot offset that object.');
    // A side point on the object makes nothing either, and asks again for an object.
    await bus.pick(LINE_20);
    await bus.submit('4,0');
    expect(added()).toEqual([]);
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
  });

  it('offsets through a point (Through), each object its own distance', async () => {
    const { bus, ends, added } = setup();
    await bus.script(['O', 'T']);
    await bus.pick(LINE_20);
    expect(bus.promptText).toBe('Specify through point or [Exit/Multiple/Undo] <Exit>:');
    await bus.submit('4,3');
    expect(ends()).toEqual([[0, 3, 10, 3]]);
    await bus.pick({ x: 0, y: 7 });
    await bus.submit('-1.5,2');
    expect(ends()[1]).toEqual([-1.5, 0, -1.5, 10]);
    await bus.submit('E');
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(2);
    // Through stays the default.
    await bus.script(['O']);
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <Through>:');
  });

  it('offsets again and again at a distance with Multiple, Enter going to the next object', async () => {
    const { bus, ends } = setup();
    await bus.script(['O', '1']);
    await bus.pick(LINE_20);
    await bus.submit('M');
    expect(bus.promptText).toBe('Specify point on side to offset or [Exit/Undo] <next object>:');
    await bus.script(['5,5', '5,5', '5,5']);
    expect(ends()).toEqual([
      [0, 1, 10, 1],
      [0, 2, 10, 2],
      [0, 3, 10, 3],
    ]);
    // Undo takes back the last; the next goes from the one before.
    await bus.submit('U');
    await bus.submit('5,-5');
    expect(ends()).toEqual([
      [0, 1, 10, 1],
      [0, 2, 10, 2],
      [0, 1, 10, 1],
    ]);
    await bus.submit('');
    expect(bus.promptText).toBe('Select object to offset or [Exit/Undo] <Exit>:');
    // Undo at "Select object" takes back the offsets one by one, then says so.
    await bus.script(['U', 'U', 'U']);
    expect(ends()).toEqual([]);
    await bus.submit('U');
    expect(bus.history.at(-1)).toBe('Nothing to undo.');
  });

  it('erases the source with Erase Yes, and Undo puts it back', async () => {
    const { bus, model, ends } = setup();
    await bus.script(['O', 'E']);
    expect(bus.promptText).toBe('Erase source object after offsetting? [Yes/No] <No>:');
    await bus.script(['Y']);
    expect(bus.promptText).toBe('Specify offset distance or [Through/Erase/Layer] <Through>:');
    await bus.submit('2');
    await bus.pick(LINE_20);
    await bus.submit('5,5');
    expect(ends()).toEqual([[0, 2, 10, 2]]);
    const line20 = () => [...model.entities()].find((e) => e.handle === '20');
    expect(line20()).toBeUndefined();
    await bus.submit('U');
    expect(ends()).toEqual([]);
    expect(line20()).toBeDefined();
    await bus.submit('');
    // The setting is remembered.
    await bus.script(['O']);
    expect(bus.history).toContain(
      'Current settings: Erase source=Yes  Layer=Source  OFFSETGAPTYPE=0',
    );
  });

  it('erases a Through Multiple source once the run ends', async () => {
    const { bus, model, ends } = setup();
    await bus.script(['O', 'E', 'Y', 'T']);
    await bus.pick(LINE_20);
    await bus.script(['M', '1,1', '1,2', '']);
    expect(ends()).toEqual([
      [0, 1, 10, 1],
      [0, 2, 10, 2],
    ]);
    expect([...model.entities()].find((e) => e.handle === '20')).toBeUndefined();
    // Undo puts the source back first, then takes back the offsets.
    await bus.submit('U');
    expect([...model.entities()].find((e) => e.handle === '20')).toBeDefined();
    expect(ends()).toHaveLength(2);
    // A Through Multiple run whose offsets are all taken back erases nothing as it ends: here
    // Undo takes back the earlier run's last offset, and Exit leaves line 23 in place.
    await bus.pick({ x: 0, y: 5 });
    await bus.script(['M', 'U']);
    expect(ends()).toEqual([[0, 1, 10, 1]]);
    await bus.submit('E');
    expect(bus.command).toBeUndefined();
    expect([...model.entities()].find((e) => e.handle === '23')).toBeDefined();
  });

  it('puts the offset on the current layer with Layer Current', async () => {
    const { bus, added } = setup();
    await bus.script(['O', 'L']);
    expect(bus.promptText).toBe('Enter layer option for offset objects [Current/Source] <Source>:');
    await bus.script(['C', '1']);
    await bus.pick(LINE_20);
    await bus.submit('5,5');
    // CLAYER is WALLS; the line was on 0.
    expect(added()[0]).toMatchObject({ layer: LAYER_WALLS });
    await bus.submit('E');
    await bus.script(['O']);
    expect(bus.history).toContain(
      'Current settings: Erase source=No  Layer=Current  OFFSETGAPTYPE=0',
    );
  });

  it('offsets a polyline as one polyline, an inward offset of a dumbbell as two', async () => {
    const dumbbell: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: (
        [
          [20, 0],
          [26, 0],
          [26, 2.5],
          [30, 2.5],
          [30, 0],
          [36, 0],
          [36, 6],
          [30, 6],
          [30, 3.5],
          [26, 3.5],
          [26, 6],
          [20, 6],
        ] as const
      ).map(([x, y]) => ({ x, y, bulge: 0 })),
    };
    const { bus, added } = setup([dumbbell]);
    await bus.script(['O', '1']);
    await bus.pick({ x: 23, y: 0 });
    await bus.submit('23,3');
    expect(added()).toHaveLength(2);
    expect(added().every((e) => e.type === 'LWPOLYLINE')).toBe(true);
    await bus.pick({ x: 23, y: 0 });
    await bus.submit('23,-3');
    expect(added()).toHaveLength(3);
  });

  it('Exit and Esc end it; Esc at the options ends it too', async () => {
    const { bus } = setup();
    await bus.script(['O', 'E']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    await bus.script(['O', 'L']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    await bus.script(['O', '1', 'E']);
    expect(bus.command).toBeUndefined();
    // Enter at the side prompt is its <Exit>.
    await bus.script(['O', '1']);
    await bus.pick(LINE_20);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['O', '1']);
    await bus.pick(LINE_20);
    await bus.submit('E');
    expect(bus.command).toBeUndefined();
    await bus.script(['O', '1']);
    await bus.pick(LINE_20);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });
});
