// M3-02 part 2: TRIM and EXTEND on the PromptBus, driven as the command line and the canvas
// drive them, with AutoCAD 2024's prompts and options (AutoCAD 2024 Help, "TRIM (Command)",
// "EXTEND (Command)"): Quick and Standard modes, picks, Shift to switch, fences, crossing
// windows, Edge, eRase, Undo and mOde. The geometry is `edit/trim.ts`'s (test/edit/trim.test.ts).
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
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** A canvas whose picks take the objects within 0.25 of the pick, nearest first. */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') {
        const hits: [number, EntityId][] = [];
        for (const e of model().entities()) {
          if (e.owner !== MODEL_SPACE) continue;
          const c = offsetCurveOf(e.geom);
          if (!c) continue;
          const d = closestPoint(c, r.point, toleranceForSize(100)).distance;
          if (d < 0.25) hits.push([d, e.id]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

/**
 * A drawing of its own: a horizontal line 30 (0,0)-(10,0) crossed by the verticals 31 at x = 3
 * and 32 at x = 7 (from y −5 to 5), a line 33 (0,8)-(5,8) short of 32's top, a circle 34 at
 * (20,0) r 2, and whatever `extra` adds (handles from 40 on).
 */
function setup(extra: EntityGeometry[] = [], lockedWalls = false) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      layers: [layer(LAYER_0, '0'), { ...layer(LAYER_WALLS, 'WALLS'), locked: lockedWalls }],
    },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', lineGeom(3, -5, 3, 5)),
      entityInit('32', lineGeom(7, -5, 7, 5)),
      entityInit('33', lineGeom(0, 8, 5, 8)),
      entityInit('34', { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 2 }),
      ...extra.map((g, i) =>
        entityInit((0x40 + i).toString(16).toUpperCase(), g, { layer: LAYER_WALLS }),
      ),
    ],
  });
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => model) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity | undefined => {
    const id = model.ids.idOf(h);
    return id === undefined ? undefined : model.entity(id);
  };
  /** Every line in model space as [x1, y1, x2, y2], sorted. */
  const lines = () =>
    [...model.entities()]
      .filter((e) => e.geom.kind === 'LINE' && e.owner === MODEL_SPACE)
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
  return { model, bus, log, byHandle, lines };
}

const QUICK_TRIM =
  'Select object to trim or shift-select to extend or [cuTting edges/Crossing/mOde/Project/eRase/Undo]:';
const QUICK_EXTEND =
  'Select object to extend or shift-select to trim or [Boundary edges/Crossing/mOde/Project/Undo]:';

describe('TRIM', () => {
  it('trims the part picked between the edges in Quick mode, as AutoCAD 2024', async () => {
    const { bus, log, lines, byHandle } = setup();
    await bus.script(['TR']);
    expect(log).toContain('Current settings: Projection=UCS, Edge=None, Mode=Quick');
    expect(bus.promptText).toBe(QUICK_TRIM);
    expect(bus.prompt).toMatchObject({ kind: 'point', pickbox: true });
    await bus.pick({ x: 5, y: 0 });
    // The line keeps its handle for the part before the cut; the part after is a new line.
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 3, y: 0 } });
    expect(lines()).toContainEqual([7, 0, 10, 0]);
    expect(lines()).not.toContainEqual([0, 0, 10, 0]);
    expect(bus.promptText).toBe(QUICK_TRIM);
    // The vertical 31's lower half: cut by the line's remaining part at y = 0.
    await bus.pick({ x: 3, y: -4 });
    expect(byHandle('31')!.geom).toMatchObject({ start: { x: 3, y: 0 }, end: { x: 3, y: 5 } });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('deletes an object no edge crosses in Quick mode, and trims a circle to an arc', async () => {
    const { bus, byHandle, model } = setup([lineGeom(19, -5, 19, 5)]);
    await bus.script(['TRIM']);
    // The circle at (20,0) r 2 is crossed by x = 19: its left part goes, and what is left is an
    // arc, a new object on the circle's layer.
    await bus.pick({ x: 18.05, y: 0.4 });
    expect(byHandle('34')).toBeUndefined();
    const arc = [...model.entities()].find((e) => e.geom.kind === 'ARC')!;
    expect(arc).toMatchObject({ layer: LAYER_0 });
    // 33 crosses nothing: Quick mode deletes it.
    await bus.pick({ x: 2, y: 8 });
    expect(byHandle('33')).toBeUndefined();
  });

  it('extends with Shift held, and EXTEND trims with Shift held', async () => {
    const { bus, log, byHandle } = setup();
    await bus.script(['TRIM']);
    // 33 (0,8)-(5,8) picked near its end with Shift: extended, but 32 stops at y = 5, so with
    // EDGEMODE None nothing is that way.
    await bus.pick({ x: 4.5, y: 8 }, { shift: true });
    expect(log.at(-1)).toBe('Object does not intersect an edge.');
    expect(bus.promptText).toBe(QUICK_TRIM);
    expect(byHandle('33')!.geom).toMatchObject({ end: { x: 5, y: 8 } });
    await bus.submit('');
    await bus.script(['EX']);
    expect(bus.promptText).toBe(QUICK_EXTEND);
    // Shift: trim the line between the verticals.
    await bus.pick({ x: 5, y: 0 }, { shift: true });
    expect(byHandle('30')!.geom).toMatchObject({ end: { x: 3, y: 0 } });
    // Without Shift: 30, now (0,0)-(3,0), picked nearer its end, which is on 31 already, so it
    // goes on to the next boundary, 32.
    await bus.pick({ x: 2.5, y: 0 });
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 7, y: 0 } });
  });

  it('works in Standard mode on the edges chosen, with Edge Extend', async () => {
    const { bus, log, lines, byHandle } = setup();
    await bus.script(['TRIM', 'O', 'S']);
    expect(log).toContain('Current settings: Projection=UCS, Edge=None, Mode=Standard');
    expect(log).toContain('Select cutting edges ...');
    expect(bus.promptText).toBe('Select objects or <select all>:');
    // Only 32 cuts.
    await bus.pick({ x: 7, y: 3 });
    await bus.submit('');
    expect(bus.promptText).toBe(
      'Select object to trim or shift-select to extend or [cuTting edges/Fence/Crossing/mOde/Project/Edge/eRase/Undo]:',
    );
    await bus.pick({ x: 9, y: 0 });
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 7, y: 0 } });
    // A line no chosen edge crosses is not deleted in Standard mode.
    await bus.pick({ x: 2, y: 8 });
    expect(log.at(-1)).toBe('Object does not intersect an edge.');
    expect(byHandle('33')).toBeDefined();
    // Edge Extend: 33 extended with Shift reaches where 32 would be if it went on up.
    await bus.script(['E']);
    expect(bus.promptText).toBe(
      'Enter an implied edge extension mode [Extend/No extend] <No extend>:',
    );
    await bus.submit('E');
    await bus.pick({ x: 4.5, y: 8 }, { shift: true });
    expect(byHandle('33')!.geom).toMatchObject({ end: { x: 7, y: 8 } });
    expect(lines()).toContainEqual([0, 8, 7, 8]);
    await bus.submit('');
    // The settings are TRIM's and EXTEND's both, for the next command.
    const from = log.length;
    await bus.script(['EXTEND']);
    expect(log.slice(from)).toEqual([
      'Command: EXTEND',
      'Current settings: Projection=UCS, Edge=Extend, Mode=Standard',
      'Select boundary edges ...',
    ]);
    expect(bus.promptText).toBe('Select objects or [mOde] <select all>:');
    // Enter: every object is a boundary.
    await bus.submit('');
    expect(bus.promptText).toBe(
      'Select object to extend or shift-select to trim or [Boundary edges/Fence/Crossing/mOde/Project/Edge/Undo]:',
    );
  });

  it('trims every object a Quick fence crosses, and Undo takes the fence back', async () => {
    const { bus, lines } = setup();
    await bus.script(['TRIM']);
    // A pick on nothing starts a fence; its second point trims what it crosses: 31 and 32
    // below the line.
    await bus.pick({ x: 1, y: -3 });
    expect(bus.promptText).toBe('Specify next fence point or [Undo]:');
    await bus.pick({ x: 9, y: -3 });
    expect(lines()).toContainEqual([3, 0, 3, 5]);
    expect(lines()).toContainEqual([7, 0, 7, 5]);
    expect(bus.promptText).toBe(QUICK_TRIM);
    await bus.submit('U');
    expect(lines()).toContainEqual([3, -5, 3, 5]);
    expect(lines()).toContainEqual([7, -5, 7, 5]);
    await bus.submit('U');
    expect(bus.promptText).toBe(QUICK_TRIM);
  });

  it('trims what a Crossing window takes nearest its first corner, and a Standard Fence', async () => {
    const { bus, lines } = setup();
    await bus.script(['TRIM', 'C']);
    expect(bus.promptText).toBe('Specify first corner:');
    // A window round the line between the verticals, first corner at its left.
    await bus.submit('4,-1');
    expect(bus.promptText).toBe('Specify opposite corner:');
    await bus.submit('6,1');
    expect(lines()).toContainEqual([0, 0, 3, 0]);
    expect(lines()).toContainEqual([7, 0, 10, 0]);
    await bus.submit('');
    await bus.script(['TRIM', 'O', 'S', '', 'F']);
    expect(bus.promptText).toBe('Specify first fence point:');
    // Fence over the upper halves of 31 and 32 (above y = 0, where 30's parts are).
    await bus.script(['2,3', '8,3', '']);
    expect(lines()).toContainEqual([3, -5, 3, 0]);
    expect(lines()).toContainEqual([7, -5, 7, 0]);
  });

  it('erases with eRase, which Undo puts back, and takes a typed point as a pick', async () => {
    const { bus, byHandle } = setup();
    await bus.script(['TRIM', 'R']);
    expect(bus.promptText).toBe('Select objects to erase or <exit>:');
    await bus.pick({ x: 2, y: 8 });
    await bus.submit('');
    expect(byHandle('33')).toBeUndefined();
    await bus.submit('U');
    expect(byHandle('33')).toBeDefined();
    // Typed at the prompt, a point picks there: on nothing, it starts a fence.
    await bus.submit('30,30');
    expect(bus.promptText).toBe('Specify next fence point or [Undo]:');
  });

  it('refuses objects on locked layers, and remembers Project', async () => {
    const { bus, log, byHandle } = setup([lineGeom(5, -2, 5, 2)], true);
    await bus.script(['TRIM']);
    await bus.pick({ x: 5, y: 1.5 });
    expect(log.at(-1)).toBe('The object is on a locked layer.');
    expect(byHandle('40')!.geom).toMatchObject({ start: { x: 5, y: -2 }, end: { x: 5, y: 2 } });
    await bus.script(['P']);
    expect(bus.promptText).toBe('Enter a projection option [None/Ucs/View] <Ucs>:');
    await bus.submit('N');
    await bus.submit('');
    await bus.script(['TRIM']);
    expect(log).toContain('Current settings: Projection=None, Edge=None, Mode=Quick');
  });
});
