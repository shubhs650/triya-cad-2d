// M3-05 part 1: multi-functional grips at the hot grip. AutoCAD 2024 offers a grip's functions
// in a menu as the cursor rests on it and cycles through them with Ctrl once the grip is hot
// ("To Modify Polylines With Grips"; "The Stretch and Lengthen Commands"). Here a Ctrl tap
// answers GRIP_CYCLE, and each function can be typed; the prompts stay AutoCAD's own. The grip
// mode names (ST, MO, RO, SC, MI) can be typed at any grip prompt.
//
// The drawing: model space holds 40 an open polyline (0,0) (10,0) (10,10), 41 a line
// (20,0)-(30,0) and 42 an arc about (50,0) of radius 10 from 0° to 90°.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  GRIP_CYCLE,
  PromptBus,
  builtinCommands,
  type ArcGeometry,
  type BusEvent,
  type DocumentInit,
  type LineGeometry,
  type LwPolylineGeometry,
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
      entityInit('42', {
        kind: 'ARC',
        center: { x: 50, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
    ],
  };
}

function setup() {
  const model = DocumentModel.create(drawing());
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const geom = <T>(h: string) => model.entityByHandle(h)!.geom as T;
  const verts = () =>
    geom<LwPolylineGeometry>('40').vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)]);
  const hot = async (x: number, y: number) => {
    await bus.selectAll();
    await bus.pick({ x, y }, { grip: 0.25 });
    expect(bus.command).toBe('GRIP');
  };
  const ctrl = () => bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
  return { model, bus, log, geom, verts, hot, ctrl };
}

describe('multi-functional grips', () => {
  it('a hot multi-functional grip starts in STRETCH with AutoCAD’s prompt, Ctrl to cycle', async () => {
    const s = setup();
    await s.hot(10, 0);
    expect(s.log.at(-1)).toBe('** STRETCH **');
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    expect(s.bus.prompt).toMatchObject({ ctrlCycles: true });
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** ADD VERTEX **');
    expect(s.bus.promptText).toBe('Specify new vertex point or [eXit]:');
    expect(s.bus.prompt).toMatchObject({
      ctrlCycles: true,
      drag: { kind: 'grip', grip: { x: 10, y: 0 }, fn: 'Add Vertex' },
    });
    // Remove Vertex takes no point: Ctrl passes it by, back to Stretch.
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** STRETCH **');
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  });

  it('a grip with one function does not cycle', async () => {
    const s = setup();
    await s.hot(25, 0);
    expect(s.bus.prompt?.ctrlCycles).toBeUndefined();
    // The front-end sends no Ctrl there; the bus would refuse it.
    await s.ctrl();
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  });

  it('Add Vertex adds a vertex after the hot one in one undo step, the selection kept', async () => {
    const s = setup();
    await s.hot(10, 0);
    await s.ctrl();
    await s.bus.submit('12,5');
    expect(s.verts()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [12, 5, 0],
      [10, 10, 0],
    ]);
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.selection).toHaveLength(3);
    await s.bus.script(['U']);
    expect(s.verts()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
  });

  it('functions can be typed: Remove Vertex at once', async () => {
    const s = setup();
    await s.hot(10, 0);
    await s.bus.submit('REM');
    expect(s.verts()).toEqual([
      [0, 0, 0],
      [10, 10, 0],
    ]);
    expect(s.bus.command).toBeUndefined();
  });

  it('Remove Vertex reports a polyline that cannot lose one', async () => {
    const s = setup();
    await s.hot(10, 0);
    await s.bus.submit('REM');
    await s.hot(0, 0);
    await s.bus.submit('REM');
    expect(s.log).toContain('A polyline needs at least two vertices.');
    expect(s.bus.command).toBe('GRIP');
    await s.bus.submit('X');
    expect(s.bus.command).toBeUndefined();
  });

  it('Extend Vertex at an end; Convert to Arc and Convert to Line at a segment midpoint', async () => {
    const s = setup();
    await s.hot(10, 10);
    await s.bus.submit('EXT');
    expect(s.log.at(-1)).toBe('** EXTEND VERTEX **');
    await s.bus.submit('0,10');
    expect(s.verts()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ]);
    await s.hot(5, 0);
    await s.ctrl();
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** CONVERT TO ARC **');
    expect(s.bus.promptText).toBe('Specify arc midpoint or [eXit]:');
    await s.bus.submit('5,-5');
    expect(s.verts()[0]).toEqual([0, 0, 1]);
    // The arc segment's midpoint grip.
    await s.hot(5, -5);
    await s.bus.submit('LI');
    expect(s.verts()[0]).toEqual([0, 0, 0]);
  });

  it('a point that makes no shape asks again', async () => {
    const s = setup();
    await s.hot(5, 0);
    await s.bus.submit('AR');
    await s.bus.submit('7,0');
    expect(s.log).toContain('The point gives no shape.');
    expect(s.bus.promptText).toBe('Specify arc midpoint or [eXit]:');
    await s.bus.submit('');
    // Enter goes on to MOVE, as from STRETCH.
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
  });

  it('Lengthen carries a line’s end along it', async () => {
    const s = setup();
    await s.hot(30, 0);
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** LENGTHEN **');
    expect(s.bus.promptText).toBe('Specify new end point or [eXit]:');
    await s.bus.submit('34,6');
    expect(s.geom<LineGeometry>('41')).toMatchObject({
      start: { x: 20, y: 0 },
      end: { x: 34, y: 0 },
    });
  });

  it('Radius at an arc’s midpoint: picked or typed', async () => {
    const s = setup();
    const mid = { x: 50 + 10 * Math.SQRT1_2, y: 10 * Math.SQRT1_2 };
    await s.hot(mid.x, mid.y);
    await s.bus.submit('RA');
    expect(s.log.at(-1)).toBe('** RADIUS **');
    expect(s.bus.promptText).toBe('Specify radius or [eXit]:');
    await s.bus.submit('6');
    expect(s.geom<ArcGeometry>('42')).toMatchObject({
      center: { x: 50, y: 0 },
      radius: 6,
      startAngle: 0,
    });
    const m6 = { x: 50 + 6 * Math.SQRT1_2, y: 6 * Math.SQRT1_2 };
    await s.hot(m6.x, m6.y);
    await s.bus.submit('RA');
    await s.bus.submit('50,8');
    expect(r6(s.geom<ArcGeometry>('42').radius)).toBe(8);
    await s.hot(50 + 8 * Math.SQRT1_2, 8 * Math.SQRT1_2);
    await s.bus.submit('RA');
    await s.bus.submit('0');
    expect(s.log).toContain('The point gives no shape.');
    await s.bus.submit('ST');
    expect(s.log.at(-1)).toBe('** STRETCH **');
  });

  it('typed grip mode names switch the mode, and eXit leaves a function', async () => {
    const s = setup();
    await s.hot(25, 0);
    await s.bus.submit('MI');
    expect(s.bus.promptText).toBe('Specify second point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('RO');
    expect(s.bus.promptText).toBe(
      'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
    );
    await s.bus.submit('SC');
    expect(s.bus.promptText).toBe('Specify scale factor or [Base point/Copy/Undo/Reference/eXit]:');
    await s.bus.submit('MO');
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('ST');
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('X');
    await s.hot(10, 0);
    await s.bus.submit('AD');
    await s.bus.submit('X');
    expect(s.bus.command).toBeUndefined();
    expect(s.verts()).toHaveLength(3);
  });

  it('another function typed at a function’s prompt goes there', async () => {
    const s = setup();
    await s.hot(10, 0);
    await s.ctrl();
    await s.bus.submit('REM');
    expect(s.verts()).toEqual([
      [0, 0, 0],
      [10, 10, 0],
    ]);
    // A Lengthen point behind the fixed end asks again.
    await s.hot(30, 0);
    await s.bus.submit('LE');
    await s.bus.submit('10,0');
    expect(s.log).toContain('The point gives no shape.');
    expect(s.bus.promptText).toBe('Specify new end point or [eXit]:');
    await s.ctrl();
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  });

  it('Esc at a function ends grip editing with nothing changed', async () => {
    const s = setup();
    await s.hot(10, 0);
    await s.ctrl();
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.verts()).toHaveLength(3);
  });
});
