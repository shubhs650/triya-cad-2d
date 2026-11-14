// M2-47 part 4: undoable views. AutoCAD keeps a ZOOM or PAN (from the command, the navigation bar
// or the wheel) as an undo step, and UNDO Control Combine (Yes by default) makes consecutive ones
// one step: "Controls whether multiple, consecutive zoom and pan commands are combined as a single
// operation for undo and redo operations" (AutoCAD 2024 help, UNDO). The canvas holds the view,
// so the step keeps the view it left and U asks the canvas to swap it back in; the view swapped
// out is what REDO brings back.
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  type BusEvent,
  type CommandDef,
  type UndoView,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, sampleInit } from '../model/fixtures';

const ADD: CommandDef = {
  name: 'ADD',
  // eslint-disable-next-line require-yield -- edits without prompting
  async *run(ctx) {
    ctx.edit((b) =>
      b.addEntity({
        owner: MODEL_SPACE,
        layer: LAYER_0,
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
      }),
    );
  },
};

const at = (x: number, height = 10): UndoView => ({ center: { x, y: 0 }, height });

/**
 * A canvas per viewport, as the app's: a swap shows the view asked for and answers with the one
 * it replaced. `refuse` makes it answer as a viewport no longer there does.
 */
function setup() {
  const model = DocumentModel.create(sampleInit());
  const shown = new Map<string, UndoView>([
    ['model', at(0)],
    ['layout', at(500)],
  ]);
  const swaps: { viewport: string; view: UndoView }[] = [];
  let refuse = false;
  const view = {
    request(r: ViewRequest): Promise<ViewReply> {
      if (r.op !== 'swap') return Promise.resolve({ ok: false, message: 'not here' });
      swaps.push({ viewport: r.viewport, view: r.view });
      const old = shown.get(r.viewport);
      if (refuse || !old)
        return Promise.resolve({ ok: false, message: 'There is no view to change.' });
      shown.set(r.viewport, r.view);
      return Promise.resolve({
        ok: true,
        view: { center: old.center, height: old.height, width: old.height, paper: false },
      });
    },
  };
  const bus = new PromptBus({
    model,
    registry: new CommandRegistry([ADD, ...UNDO_COMMANDS]),
    view,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  /** The drafter changes a viewport's view: the step keeps the view left. */
  const move = (label: 'ZOOM' | 'PAN' | 'VIEW', viewport: string, to: UndoView) => {
    bus.undo.pushView({ label, viewport, view: shown.get(viewport)! });
    shown.set(viewport, to);
  };
  const run = async (...lines: string[]) => {
    await bus.script(lines);
    // The swaps' replies settle after the command.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return {
    bus,
    log,
    swaps,
    shown,
    move,
    run,
    refuse: (on: boolean) => (refuse = on),
  };
}

describe('undoable views (M2-47 part 4)', () => {
  it('U takes a ZOOM back and REDO zooms again', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 2));
    expect(t.bus.undo.state).toMatchObject({ undoable: 1, nextUndo: 'ZOOM' });
    await t.run('U');
    expect(t.log.at(-1)).toBe('ZOOM');
    expect(t.shown.get('model')).toEqual(at(0));
    expect(t.bus.undo.state).toMatchObject({ undoable: 0, redoable: 1, nextRedo: 'ZOOM' });
    await t.run('REDO');
    expect(t.shown.get('model')).toEqual(at(0, 2));
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
  });

  it('combines consecutive ZOOM and PAN into one step under Combine Yes, the default', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    t.move('PAN', 'model', at(3, 5));
    t.move('ZOOM', 'model', at(3, 1));
    expect(t.bus.undo.state).toMatchObject({ undoable: 1, nextUndo: 'ZOOM', undoList: ['ZOOM'] });
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
    expect(t.swaps).toHaveLength(1);
    await t.run('REDO');
    expect(t.shown.get('model')).toEqual(at(3, 1));
  });

  it('keeps each ZOOM and PAN a step of its own under Combine No', async () => {
    const t = setup();
    await t.run('UNDO', 'C', 'C', 'N');
    t.move('ZOOM', 'model', at(0, 5));
    t.move('PAN', 'model', at(3, 5));
    expect(t.bus.undo.state.undoList).toEqual(['PAN', 'ZOOM']);
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0, 5));
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
  });

  it('combines only views changed one after another: a command between ends the run', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    await t.run('ADD');
    t.move('PAN', 'model', at(3, 5));
    expect(t.bus.undo.state.undoList).toEqual(['PAN', 'ADD', 'ZOOM']);
    await t.run('UNDO', '3');
    expect(t.shown.get('model')).toEqual(at(0));
    expect(t.log.at(-1)).toBe('PAN ADD ZOOM');
  });

  it('keeps a named view restored (VIEW) a step of its own', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    t.move('VIEW', 'model', at(9, 9));
    t.move('PAN', 'model', at(7, 9));
    expect(t.bus.undo.state.undoList).toEqual(['PAN', 'VIEW', 'ZOOM']);
  });

  it('a combined step takes back every viewport it moved, each to the view it first left', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    t.move('PAN', 'layout', at(510));
    t.move('ZOOM', 'model', at(0, 1));
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
    expect(t.shown.get('layout')).toEqual(at(500));
    await t.run('REDO');
    expect(t.shown.get('model')).toEqual(at(0, 1));
    expect(t.shown.get('layout')).toEqual(at(510));
  });

  it('a view change after U forgets the redo, as AutoCAD does', async () => {
    const t = setup();
    await t.run('ADD', 'U');
    expect(t.bus.undo.state.redoable).toBe(1);
    t.move('ZOOM', 'model', at(0, 5));
    expect(t.bus.undo.state).toMatchObject({ redoable: 0, undoable: 1 });
  });

  it('a view change after U starts a step of its own, not one with the step undone', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    await t.run('U');
    t.move('PAN', 'model', at(4));
    expect(t.bus.undo.state.undoList).toEqual(['PAN']);
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
  });

  it('keeps no view step under Control None, and one under Control One', async () => {
    const t = setup();
    await t.run('UNDO', 'C', 'N');
    t.move('ZOOM', 'model', at(0, 5));
    expect(t.bus.undo.state.undoable).toBe(0);
    // With undo off, UNDO goes straight to its control options.
    await t.run('UNDO', 'O', 'ADD');
    t.move('ZOOM', 'model', at(0, 2));
    expect(t.bus.undo.state.undoList).toEqual(['ZOOM']);
  });

  it('a view change inside UNDO BEgin and End is part of the group', async () => {
    const t = setup();
    await t.run('UNDO', 'BE', 'ADD');
    t.move('ZOOM', 'model', at(0, 5));
    await t.run('UNDO', 'E');
    expect(t.bus.undo.state.undoList).toEqual(['GROUP']);
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0));
  });

  it('a group of view changes only is a step too', async () => {
    const t = setup();
    await t.run('UNDO', 'BE');
    t.move('ZOOM', 'model', at(0, 5));
    expect(t.bus.undo.state.undoList).toEqual(['GROUP']);
    await t.run('UNDO', 'E', 'U');
    expect(t.shown.get('model')).toEqual(at(0));
  });

  it('a viewport no longer there keeps the step: REDO then has the view it left to show', async () => {
    const t = setup();
    t.move('ZOOM', 'model', at(0, 5));
    t.refuse(true);
    await t.run('U');
    expect(t.shown.get('model')).toEqual(at(0, 5));
    t.refuse(false);
    await t.run('REDO');
    // The canvas never swapped, so REDO asks for the view the step kept.
    expect(t.swaps.at(-1)).toEqual({ viewport: 'model', view: at(0) });
  });
});
