// M2-06 part 2: grip editing on the PromptBus, AutoCAD 2024's grip modes ("To Use Grips to
// Stretch, Move, Rotate, Scale or Mirror Objects"): a click on a grip of the selection at
// `Command:` makes it hot and starts STRETCH; Enter cycles MOVE, ROTATE, SCALE, MIRROR; Base
// point, Copy, Undo, Reference and eXit; the objects stay selected.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  builtinCommands,
  type BusEvent,
  type Entity,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** Model space: 20 (0,0)-(10,0), 21 a circle at (5,5) r 2, 23 (0,0)-(0,10). */
function setup() {
  const model = DocumentModel.create(sampleInit());
  const registry = builtinCommands();
  for (const def of UNDO_COMMANDS) registry.register(def);
  const bus = new PromptBus({ model, registry });
  const log: string[] = [];
  const grips: BusEvent[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'grips') grips.push(e);
  });
  const id = (h: string) => model.entityByHandle(h)!.id;
  const ends = (h: string) => {
    const g = model.entityByHandle(h)!.geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
  };
  const added = (before: readonly Entity[]) =>
    [...model.entities()].filter((e) => !before.some((b) => b.id === e.id));
  return { model, bus, log, grips, id, ends, added };
}

describe('grips', () => {
  it('shows grips on the selection at Command:, none while a command runs', async () => {
    const s = setup();
    await s.bus.selectAll();
    expect(s.grips.at(-1)).toEqual({ type: 'grips', ids: [s.id('20'), s.id('21'), s.id('23')] });
    await s.bus.script(['ERASE']);
    expect(s.grips.at(-1)).toEqual({ type: 'grips', ids: [] });
  });

  it('stretches by the hot grip, and keeps the selection', async () => {
    const s = setup();
    await s.bus.selectAll();
    // Within 0.5 of 20's end (10,0): that grip goes hot.
    await s.bus.pick({ x: 10.2, y: 0.1 }, { grip: 0.5 });
    expect(s.bus.command).toBe('GRIP');
    expect(s.log).toContain('** STRETCH **');
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    expect(s.grips.at(-1)).toMatchObject({ hot: { x: 10, y: 0 } });
    expect(s.bus.prompt).toMatchObject({
      drag: { kind: 'grip', grip: { x: 10, y: 0 }, from: { x: 10, y: 0 } },
    });
    await s.bus.submit('12,3');
    expect(s.ends('20')).toEqual([0, 0, 12, 3]);
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.selection).toHaveLength(3);
    expect(s.grips.at(-1)).toEqual({ type: 'grips', ids: [s.id('20'), s.id('21'), s.id('23')] });
    // One undo step.
    await s.bus.script(['U']);
    expect(s.ends('20')).toEqual([0, 0, 10, 0]);
  });

  it('moves every selected object whose grip is the hot one (shared end points)', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await s.bus.submit('-1,-1');
    expect(s.ends('20')).toEqual([-1, -1, 10, 0]);
    expect(s.ends('23')).toEqual([-1, -1, 0, 10]);
  });

  it('a click away from the grips picks as before', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 30, y: 30 }, { grip: 0.5 });
    expect(s.bus.command).toBeUndefined();
  });

  it('cycles MOVE, ROTATE, SCALE, MIRROR on Enter, and back to STRETCH', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.5 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe(
      'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
    );
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify scale factor or [Base point/Copy/Undo/Reference/eXit]:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify second point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('X');
    expect(s.bus.command).toBeUndefined();
  });

  it('moves, rotates and scales the selection about the hot grip', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await s.bus.script(['', '5,0']);
    expect(s.ends('20')).toEqual([5, 0, 15, 0]);
    await s.bus.pick({ x: 5, y: 0 }, { grip: 0.1 });
    await s.bus.script(['', '', '90']);
    expect(s.ends('20')).toEqual([5, 0, 5, 10]);
    await s.bus.pick({ x: 5, y: 0 }, { grip: 0.1 });
    await s.bus.script(['', '', '', '2']);
    expect(s.ends('20')).toEqual([5, 0, 5, 20]);
  });

  it('places copies with Copy until Enter, and Undo takes the last back', async () => {
    const s = setup();
    const before = [...s.model.entities()];
    await s.bus.selectAll();
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await s.bus.script(['', 'C', '20,0', '40,0']);
    expect(s.log).toContain('** MOVE (multiple) **');
    expect(s.added(before)).toHaveLength(6);
    await s.bus.script(['U']);
    expect(s.added(before)).toHaveLength(3);
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(s.ends('20')).toEqual([0, 0, 10, 0]);
  });

  it('stretches copies with Copy in the STRETCH mode', async () => {
    const s = setup();
    const before = [...s.model.entities()];
    await s.bus.selectAll();
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.5 });
    await s.bus.script(['C', '10,5', '']);
    const [copy] = s.added(before);
    expect(copy?.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 5 } });
    expect(s.ends('20')).toEqual([0, 0, 10, 0]);
  });

  it('takes another base point, and mirrors in place without Copy', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 10, y: 0 }, { grip: 0.5 });
    await s.bus.script(['', '', '', '', 'B', '0,0', '0,1']);
    expect(s.ends('20')).toEqual([0, 0, -10, 0]);
    expect(s.model.blockEntities(MODEL_SPACE)).toHaveLength(3);
  });

  it('rotates and scales by Reference', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await s.bus.script(['', '', 'R', '90', '180']);
    expect(s.ends('20')).toEqual([0, 0, 0, 10]);
    await s.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await s.bus.script(['', '', '', 'R', '10', '5']);
    expect(s.ends('20')).toEqual([0, 0, 0, 5]);
  });

  it('shows no grips past GRIPOBJLIMIT', async () => {
    const init = sampleInit();
    const many = Array.from({ length: 101 }, (_, i) => ({
      ...init.entities![0]!,
      handle: (0x100 + i).toString(16).toUpperCase(),
    }));
    const model = DocumentModel.create({ ...init, entities: many });
    const bus = new PromptBus({ model, registry: builtinCommands() });
    const grips: BusEvent[] = [];
    bus.on((e) => e.type === 'grips' && grips.push(e));
    await bus.selectAll();
    expect(bus.selection).toHaveLength(101);
    expect(grips.at(-1) ?? { ids: [] }).toMatchObject({ ids: [] });
  });
});
