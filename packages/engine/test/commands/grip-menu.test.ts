// M3-05 part 2: a grip's hover menu, Ctrl cycling at array grips and Ctrl-copy. AutoCAD 2024
// shows a multi-functional grip's functions in a menu as the cursor rests on it
// (GRIPMULTIFUNCTIONAL 3, "To Modify Polylines With Grips"); a function picked there makes the
// grip hot in that function. A tap of Ctrl cycles an array grip's functions as it does a
// polyline's, and holding Ctrl as a grip mode's point is clicked turns on Copy ("To Make
// Multiple Copies with Grips": "You can also make multiple copies by holding down Ctrl as you
// click the first point").
//
// The drawing: 40 an open polyline (0,0) (10,0) (10,10), 41 a line (20,0)-(30,0), 43 a circle
// about (50,0) of radius 2 and 30 a circle r 1 at (0,-20) that ARRAYRECT turns into a 4 × 3
// array 3 apart.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  GRIP_CYCLE,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type CircleGeometry,
  type CommandOutput,
  type DocumentInit,
  type EntityId,
  type LwPolylineGeometry,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...(base.entities ?? []).filter((e) => e.owner !== MODEL_SPACE),
      entityInit('40', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0 },
          { x: 10, y: 10, bulge: 0 },
        ],
      }),
      entityInit('41', lineGeom(20, 0, 30, 0)),
      entityInit('43', { kind: 'CIRCLE', center: { x: 50, y: 0 }, radius: 2 }),
      entityInit('30', { kind: 'CIRCLE', center: { x: 0, y: -20 }, radius: 1 }),
    ],
  };
}

function setup() {
  const model = DocumentModel.create(drawing());
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'sysvar' && r.name === 'ARRAYASSOCIATIVITY') {
        return Promise.resolve({ ok: true, value: 1 });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string) => model.entityByHandle(h)!.id;
  /** Picks each object at `Command:` (a pick takes the nearest one). */
  const select = async (...handles: string[]) => {
    for (const h of handles) {
      picks = [id(h)];
      await bus.pick({ x: 1000, y: 1000 });
    }
  };
  const verts = () =>
    (model.entityByHandle('40')!.geom as LwPolylineGeometry).vertices.map((v) => [
      r6(v.x),
      r6(v.y),
    ]);
  const circles = () =>
    model
      .blockEntities(MODEL_SPACE)
      .map((i) => model.entity(i)!.geom)
      .filter((g): g is CircleGeometry => g.kind === 'CIRCLE' && g.radius === 2)
      .map((g) => [r6(g.center.x), r6(g.center.y)]);
  /** A 4 × 3 rectangular array of circle 30, selected at `Command:`. */
  const array = async (): Promise<void> => {
    picks = [id('30')];
    await bus.script(['ARRAYRECT', '0,-20', '', '']);
    const insert = model
      .blockEntities(MODEL_SPACE)
      .find((i) => model.entity(i)!.geom.kind === 'INSERT')!;
    picks = [insert];
    await bus.pick({ x: 1000, y: 1000 });
  };
  return { model, bus, log, id, select, verts, circles, array };
}

describe('grip hover menu', () => {
  it('lists the functions of the selection’s grip under the cursor at Command:', async () => {
    const s = setup();
    await s.select('40', '41', '43');
    expect(s.bus.gripMenu({ x: 10.1, y: 0 }, 0.25)).toEqual({
      grip: { x: 10, y: 0 },
      items: ['Stretch Vertex', 'Add Vertex', 'Remove Vertex'],
    });
    expect(s.bus.gripMenu({ x: 10, y: 10 }, 0.25)?.items).toEqual([
      'Stretch Vertex',
      'Add Vertex',
      'Remove Vertex',
      'Extend Vertex',
    ]);
    expect(s.bus.gripMenu({ x: 5, y: 0 }, 0.25)?.items).toEqual([
      'Stretch',
      'Add Vertex',
      'Convert to Arc',
    ]);
    expect(s.bus.gripMenu({ x: 30, y: 0 }, 0.25)?.items).toEqual(['Stretch', 'Lengthen']);
    // A grip with one function has no menu, but is still the grip under the cursor (its hover
    // colour); no grip there, nothing.
    expect(s.bus.gripMenu({ x: 25, y: 0 }, 0.25)).toEqual({ grip: { x: 25, y: 0 }, items: [] });
    expect(s.bus.gripMenu({ x: 50, y: 0 }, 0.25)).toEqual({ grip: { x: 50, y: 0 }, items: [] });
    expect(s.bus.gripMenu({ x: 15, y: 5 }, 0.25)).toBeUndefined();
  });

  it('has no menu with nothing selected or while a command runs', async () => {
    const s = setup();
    expect(s.bus.gripMenu({ x: 10, y: 0 }, 0.25)).toBeUndefined();
    await s.select('40');
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.25 });
    expect(s.bus.command).toBe('GRIP');
    expect(s.bus.gripMenu({ x: 10, y: 0 }, 0.25)).toBeUndefined();
  });

  it('a function picked from the menu makes the grip hot in it', async () => {
    const s = setup();
    await s.select('40');
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.25, gripFunction: 'Add Vertex' });
    expect(s.bus.command).toBe('GRIP');
    expect(s.log.at(-1)).toBe('** ADD VERTEX **');
    expect(s.bus.promptText).toBe('Specify new vertex point or [eXit]:');
    await s.bus.submit('12,5');
    expect(s.verts()).toEqual([
      [0, 0],
      [10, 0],
      [12, 5],
      [10, 10],
    ]);
    expect(s.bus.command).toBeUndefined();
  });

  it('Remove Vertex from the menu acts at once; Stretch Vertex is STRETCH', async () => {
    const s = setup();
    await s.select('40');
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.25, gripFunction: 'Stretch Vertex' });
    expect(s.log.at(-1)).toBe('** STRETCH **');
    await s.bus.submit('X');
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.25, gripFunction: 'Remove Vertex' });
    expect(s.verts()).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(s.bus.command).toBeUndefined();
    // A function the grip does not have is STRETCH.
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.25, gripFunction: 'Radius' });
    expect(s.log.at(-1)).toBe('** STRETCH **');
  });

  it('an array grip’s menu lists its functions and starts the one picked', async () => {
    const s = setup();
    await s.array();
    expect(s.bus.gripMenu({ x: 9, y: -20 }, 0.01)).toEqual({
      grip: { x: 9, y: -20 },
      items: ['Column count', 'Total spacing'],
    });
    expect(s.bus.gripMenu({ x: 3, y: -20 }, 0.01)?.items).toEqual([]);
    await s.bus.pick({ x: 9, y: -20 }, { grip: 0.01, gripFunction: 'Total spacing' });
    expect(s.log.at(-1)).toBe('** TOTAL SPACING **');
    expect(s.bus.promptText).toBe(
      'Specify the distance between first and last columns or [Column count/eXit]:',
    );
    // Ctrl cycles an array grip's functions, round again.
    expect(s.bus.prompt).toMatchObject({ ctrlCycles: true });
    await s.bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
    expect(s.log.at(-1)).toBe('** COLUMN COUNT **');
    await s.bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
    expect(s.log.at(-1)).toBe('** TOTAL SPACING **');
    await s.bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
    await s.bus.submit('5');
    expect(s.bus.command).toBeUndefined();
  });

  it('an array grip with one function does not cycle', async () => {
    const s = setup();
    await s.array();
    await s.bus.pick({ x: 3, y: -20 }, { grip: 0.01 });
    expect(s.log.at(-1)).toBe('** COLUMN SPACING **');
    expect(s.bus.prompt?.ctrlCycles).toBeUndefined();
  });
});

describe('Ctrl-copy at the grip modes', () => {
  it('a STRETCH point clicked with Ctrl held places a copy and goes on copying', async () => {
    const s = setup();
    await s.select('43');
    await s.bus.pick({ x: 50, y: 0 }, { grip: 0.25 });
    expect(s.bus.prompt).toMatchObject({ ctrlCopies: true });
    await s.bus.pick({ x: 60, y: 0 }, { ctrl: true });
    expect(s.circles()).toEqual([
      [50, 0],
      [60, 0],
    ]);
    expect(s.bus.command).toBe('GRIP');
    expect(s.log).toContain('** STRETCH (multiple) **');
    // Later points copy without Ctrl, as Copy does; Enter ends.
    await s.bus.pick({ x: 70, y: 0 });
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.circles()).toEqual([
      [50, 0],
      [60, 0],
      [70, 0],
    ]);
  });

  it('in MOVE and ROTATE too, while a plain click moves', async () => {
    const s = setup();
    await s.select('43');
    await s.bus.pick({ x: 52, y: 0 }, { grip: 0.25 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
    await s.bus.pick({ x: 52, y: 10 }, { ctrl: true });
    expect(s.circles()).toEqual([
      [50, 0],
      [50, 10],
    ]);
    await s.bus.submit('X');
    await s.bus.pick({ x: 50, y: 0 }, { grip: 0.25 });
    await s.bus.script(['', '', 'B', '40,0']);
    expect(s.bus.promptText).toBe(
      'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
    );
    await s.bus.pick({ x: 40, y: 10 }, { ctrl: true });
    expect(s.circles().sort()).toEqual([
      [40, 10],
      [50, 0],
      [50, 10],
    ]);
    await s.bus.submit('X');
    // No Ctrl: the circle moves, no copy.
    await s.bus.pick({ x: 50, y: 0 }, { grip: 0.25 });
    await s.bus.submit('');
    await s.bus.pick({ x: 50, y: -10 });
    expect(s.circles().sort()).toEqual(
      [
        [40, 10],
        [50, -10],
        [50, 10],
      ].sort(),
    );
  });

  it('Ctrl does not copy at a function’s prompt', async () => {
    const s = setup();
    await s.select('40');
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.25, gripFunction: 'Add Vertex' });
    expect(s.bus.prompt?.ctrlCopies).toBeUndefined();
    await s.bus.pick({ x: 12, y: 5 }, { ctrl: true });
    expect(s.verts()).toHaveLength(4);
    expect(s.bus.command).toBeUndefined();
  });
});

describe('EngineSession grip-menu', () => {
  it('answers a grip-menu input with the grip and its functions', async () => {
    const s = new EngineSession(drawing());
    const out: CommandOutput[] = [];
    s.onCommand((o) => out.push(o));
    await s.command({ kind: 'select-all' });
    await s.command({ kind: 'grip-menu', point: { x: 30.1, y: 0 }, within: 0.25 });
    expect(out.at(-1)).toEqual({
      type: 'grip-menu',
      point: { x: 30.1, y: 0 },
      grip: { x: 30, y: 0 },
      items: ['Stretch', 'Lengthen'],
    });
    await s.command({ kind: 'grip-menu', point: { x: 15, y: 5 }, within: 0.25 });
    expect(out.at(-1)).toEqual({ type: 'grip-menu', point: { x: 15, y: 5 }, items: [] });
    await s.command({
      kind: 'pick',
      point: { x: 30, y: 0 },
      grip: 0.25,
      gripFunction: 'Lengthen',
    });
    expect(out.filter((o) => o.type === 'log').at(-1)).toMatchObject({ line: '** LENGTHEN **' });
  });
});
