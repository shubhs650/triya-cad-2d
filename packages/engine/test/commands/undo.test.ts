// M2-05: undo and redo on the PromptBus. Each test drives typed commands the way the command line
// does and checks the drawing (by snapshot) and the command-line messages against AutoCAD's
// documented UNDO/U/REDO/OOPS behaviour. Where AutoCAD's help is silent the common drafter
// expectation is encoded and says so (DEC-049).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  UndoStack,
  estimateBytes,
  invertChangeSet,
  type BusEvent,
  ChangeSetBuilder,
  type ChangeSet,
  type CommandDef,
  type UndoState,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, sampleInit, snapshot } from '../model/fixtures';

let n = 0;
const line = (): {
  kind: 'LINE';
  start: { x: number; y: number };
  end: { x: number; y: number };
} => {
  n += 1;
  return { kind: 'LINE', start: { x: n, y: 0 }, end: { x: n, y: 10 } };
};

/** Adds one line. */
const ADD: CommandDef = {
  name: 'ADD',
  // eslint-disable-next-line require-yield -- edits without prompting
  async *run(ctx) {
    ctx.edit((b) => b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: line() }));
  },
};

/** Draws segments until Enter, one edit per segment, as LINE does. */
const SEGS: CommandDef = {
  name: 'SEGS',
  async *run(ctx) {
    for (;;) {
      const a = yield ctx.prompt.point({ message: 'Specify next point' });
      if (a.kind !== 'point') return;
      ctx.edit((b) =>
        b.addEntity({
          owner: MODEL_SPACE,
          layer: LAYER_0,
          geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: a.point },
        }),
      );
    }
  },
};

/** Moves the first model-space entity by 1 in X. */
const NUDGE: CommandDef = {
  name: 'NUDGE',
  // eslint-disable-next-line require-yield -- edits without prompting
  async *run(ctx) {
    const id = ctx.model.blockEntities(MODEL_SPACE)[0];
    if (id === undefined) return;
    ctx.edit((b) => {
      const e = b.entity(id)!;
      if (e.geom.kind !== 'LINE') {
        b.updateEntity(id, { color: { kind: 'aci', index: 1 } });
        return;
      }
      const { start, end } = e.geom;
      b.updateEntity(id, {
        geom: {
          kind: 'LINE',
          start: { x: start.x + 1, y: start.y },
          end: { x: end.x + 1, y: end.y },
        },
      });
    });
  },
};

/** Erases the model-space entities whose positions are typed (as ERASE will, M2-06). */
const ERASE: CommandDef = {
  name: 'ERASE',
  erases: true,
  async *run(ctx) {
    const a = yield ctx.prompt.integer({ message: 'Erase how many from the start' });
    if (a.kind !== 'number') return;
    const ids = ctx.model.blockEntities(MODEL_SPACE).slice(0, a.value);
    ctx.edit((b) => ids.forEach((id) => b.removeEntity(id)));
  },
};

/** Removes the last model-space entity, without being an erasing command. */
const POP: CommandDef = {
  name: 'POP',
  // eslint-disable-next-line require-yield -- edits without prompting
  async *run(ctx) {
    const id = ctx.model.blockEntities(MODEL_SPACE).at(-1);
    if (id !== undefined) ctx.edit((b) => b.removeEntity(id));
  },
};

/** Sets a header variable to the typed number. */
const SETV: CommandDef = {
  name: 'SETV',
  async *run(ctx) {
    const a = yield ctx.prompt.real({ message: 'Value' });
    if (a.kind === 'number') ctx.edit((b) => b.setHeader('$LTSCALE', a.value));
  },
};

/** Edits nothing. */
const LOOK: CommandDef = {
  name: 'LOOK',
  async *run() {},
};

function setup(options: { maxBytes?: number } = {}) {
  const model = DocumentModel.create(sampleInit());
  const registry = new CommandRegistry([
    ADD,
    SEGS,
    NUDGE,
    ERASE,
    POP,
    SETV,
    LOOK,
    ...UNDO_COMMANDS,
  ]);
  const bus = new PromptBus({ model, registry, undoLimitBytes: options.maxBytes });
  const log: string[] = [];
  const states: UndoState[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'undo') states.push(e.state);
  });
  const run = async (...lines: string[]): Promise<void> => {
    await bus.script(lines);
  };
  const shot = () => snapshot(model);
  const count = () => model.blockEntities(MODEL_SPACE).length;
  return { model, bus, log, states, run, shot, count };
}

describe('U and REDO', () => {
  it('undoes a whole command, however many edits it made, and names it', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('SEGS', '1,1', '2,2', '3,3', '');
    expect(t.count()).toBe(6);
    await t.run('U');
    expect(t.shot()).toEqual(before);
    expect(t.log.slice(-2)).toEqual(['Command: U', 'SEGS']);
  });

  it('undoes a cancelled command: Esc keeps its edits, and U takes them back (DEC-048)', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('SEGS', '1,1', '2,2');
    await t.bus.cancel();
    expect(t.count()).toBe(5);
    await t.run('U');
    expect(t.shot()).toEqual(before);
  });

  it('steps back one command at a time, then says nothing is left', async () => {
    const t = setup();
    const s0 = t.shot();
    await t.run('ADD');
    const s1 = t.shot();
    await t.run('NUDGE');
    await t.run('U');
    expect(t.shot()).toEqual(s1);
    await t.run('U');
    expect(t.shot()).toEqual(s0);
    await t.run('U');
    expect(t.shot()).toEqual(s0);
    expect(t.log.at(-1)).toBe('Nothing to undo');
  });

  it('keeps no record of a command that edited nothing', async () => {
    const t = setup();
    await t.run('ADD', 'LOOK', 'U');
    expect(t.log.at(-1)).toBe('ADD');
    expect(t.count()).toBe(3);
  });

  it('redoes what one U or UNDO undid, and each REDO reverses one more', async () => {
    const t = setup();
    await t.run('ADD', 'NUDGE', 'SETV', '3');
    const after = t.shot();
    await t.run('U', 'U', 'U');
    await t.run('REDO', 'REDO', 'REDO');
    expect(t.shot()).toEqual(after);
    await t.run('REDO');
    expect(t.log.at(-1)).toBe('Previous command did not undo things');
  });

  it('redoes all of an UNDO n with one REDO', async () => {
    const t = setup();
    await t.run('ADD', 'ADD', 'ADD');
    const after = t.shot();
    await t.run('UNDO', '3');
    expect(t.log.at(-1)).toBe('ADD ADD ADD');
    expect(t.count()).toBe(3);
    await t.run('REDO');
    expect(t.shot()).toEqual(after);
  });

  it('forgets the redo once a new command edits the drawing', async () => {
    const t = setup();
    await t.run('ADD', 'U', 'ADD', 'REDO');
    expect(t.log.at(-1)).toBe('Previous command did not undo things');
    expect(t.count()).toBe(4);
  });

  it('keeps the redo across a command that edits nothing', async () => {
    const t = setup();
    await t.run('ADD');
    const after = t.shot();
    await t.run('U', 'LOOK', 'REDO');
    expect(t.shot()).toEqual(after);
  });

  it('repeats U on Enter, as AutoCAD repeats the last command', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('ADD', 'ADD', 'U', '');
    expect(t.shot()).toEqual(before);
  });

  it('reports the stack depth to front-ends (the undo/redo buttons and the toast)', async () => {
    const t = setup();
    await t.run('ADD', 'NUDGE', 'U');
    expect(t.states.at(-1)).toEqual({
      undoable: 1,
      redoable: 1,
      nextUndo: 'ADD',
      nextRedo: 'NUDGE',
      grouping: false,
      control: 'all',
    });
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('cannot run inside another command', async () => {
    const t = setup();
    await t.run('SEGS', "'U");
    expect(t.log.at(-1)).toBe('** That command may not be invoked transparently **');
  });
});

describe('UNDO options', () => {
  it('prompts as AutoCAD does, with 1 as the default', async () => {
    const t = setup();
    await t.run('ADD', 'ADD', 'UNDO');
    expect(t.bus.promptText).toBe(
      'Enter the number of operations to undo or [Auto/Control/BEgin/End/Mark/Back] <1>:',
    );
    await t.run('');
    expect(t.count()).toBe(4);
  });

  it('undoes everything when asked for more than there is', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('ADD', 'NUDGE', 'UNDO', '10');
    expect(t.shot()).toEqual(before);
    expect(t.log.slice(-2)).toEqual(['NUDGE ADD', 'Everything has been undone']);
  });

  it('refuses a number below one', async () => {
    const t = setup();
    await t.run('ADD', 'UNDO', '0');
    expect(t.log.at(-1)).toBe('Value must be positive and nonzero.');
    expect(t.bus.command).toBe('UNDO');
    await t.run('1');
    expect(t.count()).toBe(3);
  });

  it('Back undoes to the last Mark and removes it; Back again reaches the one before', async () => {
    const t = setup();
    await t.run('ADD');
    const s1 = t.shot();
    await t.run('UNDO', 'M', 'ADD');
    const s2 = t.shot();
    await t.run('UNDO', 'M', 'ADD', 'NUDGE', 'UNDO', 'B');
    expect(t.shot()).toEqual(s2);
    expect(t.log.slice(-2)).toEqual(['NUDGE ADD', 'Mark encountered']);
    await t.run('UNDO', 'B');
    expect(t.shot()).toEqual(s1);
  });

  it('Back with no mark asks before undoing everything', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('ADD', 'ADD', 'UNDO', 'B');
    expect(t.bus.promptText).toBe('This will undo everything. OK? [Yes/No] <Yes>:');
    await t.run('N');
    expect(t.count()).toBe(5);
    await t.run('UNDO', 'B', '');
    expect(t.shot()).toEqual(before);
    expect(t.log.at(-1)).toBe('Everything has been undone');
  });

  it('U steps over marks, and REDO puts them back', async () => {
    const t = setup();
    await t.run('ADD', 'UNDO', 'M', 'ADD', 'U', 'U');
    expect(t.count()).toBe(3);
    await t.run('REDO', 'REDO', 'ADD', 'UNDO', 'B');
    // The mark came back with the first ADD's redo, so Back stops after the second ADD.
    expect(t.count()).toBe(4);
  });

  it('BEgin and End make one undo step of the commands between them', async () => {
    const t = setup();
    await t.run('ADD');
    const s1 = t.shot();
    await t.run('UNDO', 'BE', 'ADD', 'NUDGE', 'SETV', '2', 'UNDO', 'E');
    const s2 = t.shot();
    await t.run('U');
    expect(t.shot()).toEqual(s1);
    expect(t.log.at(-1)).toBe('GROUP');
    await t.run('REDO');
    expect(t.shot()).toEqual(s2);
  });

  it('BEgin while a group is open ends it and starts another', async () => {
    const t = setup();
    await t.run('UNDO', 'BE', 'ADD', 'ADD', 'UNDO', 'BE', 'ADD', 'UNDO', 'E');
    expect(t.bus.undo.state.undoable).toBe(2);
    await t.run('U');
    expect(t.count()).toBe(5);
  });

  it('U while a group is open ends the group and undoes all of it', async () => {
    const t = setup();
    const before = t.shot();
    await t.run('UNDO', 'BE', 'ADD', 'ADD');
    expect(t.bus.undo.state.grouping).toBe(true);
    await t.run('U');
    expect(t.shot()).toEqual(before);
    expect(t.bus.undo.state.grouping).toBe(false);
  });

  it('End with no group open does nothing; an empty group is no step', async () => {
    const t = setup();
    await t.run('ADD', 'UNDO', 'E', 'UNDO', 'BE', 'LOOK', 'UNDO', 'E');
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('Control None turns undo off and drops the history; All turns it back on', async () => {
    const t = setup();
    await t.run('ADD', 'UNDO', 'C');
    expect(t.bus.promptText).toBe(
      'Enter an UNDO control option [All/None/One/Combine/Layer] <All>:',
    );
    await t.run('N', 'U');
    expect(t.log.at(-1)).toBe('** U command disabled. Use UNDO command to turn it on **');
    expect(t.count()).toBe(4);
    await t.run('ADD', 'UNDO');
    // With undo off, UNDO goes straight to its control options.
    expect(t.bus.promptText).toBe(
      'Enter an UNDO control option [All/None/One/Combine/Layer] <All>:',
    );
    await t.run('A', 'ADD', 'U');
    expect(t.count()).toBe(5);
    expect(t.bus.undo.state.control).toBe('all');
  });

  it('Control One keeps a single step', async () => {
    const t = setup();
    await t.run('ADD', 'UNDO', 'C', 'O', 'ADD', 'ADD');
    expect(t.bus.undo.state).toMatchObject({ undoable: 1, control: 'one' });
    expect(t.bus.promptText).toBe('Command:');
    await t.run('UNDO');
    expect(t.bus.promptText).toBe('Enter the number of operations to undo or [Control] <1>:');
    await t.run('5');
    expect(t.count()).toBe(5);
    await t.run('U');
    expect(t.log.at(-1)).toBe('Nothing to undo');
  });

  it('keeps the Combine, Layer and Auto settings', async () => {
    const t = setup();
    await t.run('UNDO', 'C', 'C');
    expect(t.bus.promptText).toBe('Combine zoom and pan operations? [Yes/No] <Yes>:');
    await t.run('N', 'UNDO', 'C', 'L', 'N', 'UNDO', 'A');
    expect(t.bus.promptText).toBe('Enter UNDO Auto mode [ON/OFF] <ON>:');
    await t.run('OFF');
    expect(t.bus.undo.settings).toEqual({
      auto: false,
      combineZoomPan: false,
      combineLayer: false,
    });
  });
});

describe('OOPS', () => {
  it('restores the last erased set after other commands, under the same handles and ids', async () => {
    const t = setup();
    const ids = t.model.blockEntities(MODEL_SPACE).slice(0, 2);
    const handles = ids.map((id) => t.model.entity(id)!.handle);
    await t.run('ERASE', '2', 'ADD', 'OOPS');
    expect(t.count()).toBe(4);
    const now = t.model.blockEntities(MODEL_SPACE);
    expect(now.slice(-2)).toEqual(ids);
    expect(now.slice(-2).map((id) => t.model.entity(id)!.handle)).toEqual(handles);
    // The ADD after the ERASE stays: OOPS is not U.
    expect(t.bus.undo.state.nextUndo).toBe('OOPS');
  });

  it('is itself one undo step', async () => {
    const t = setup();
    await t.run('ERASE', '1');
    const erased = t.shot();
    await t.run('OOPS', 'U');
    expect(t.shot()).toEqual(erased);
  });

  it('remembers only the last erasing command, and not removals by other commands', async () => {
    const t = setup();
    await t.run('ERASE', '1', 'ERASE', '1', 'POP', 'OOPS');
    // Only the second ERASE's entity comes back; POP's is not an erased set.
    expect(t.count()).toBe(1);
  });

  it('restores nothing that is already back (U of the ERASE, or a second OOPS)', async () => {
    const t = setup();
    await t.run('ERASE', '1', 'U', 'OOPS');
    expect(t.log.at(-1)).toBe('Nothing to restore.');
    await t.run('REDO', 'OOPS', 'OOPS');
    expect(t.count()).toBe(3);
    expect(t.log.at(-1)).toBe('Nothing to restore.');
  });

  it('has nothing to restore before anything is erased', async () => {
    const t = setup();
    await t.run('OOPS');
    expect(t.log.at(-1)).toBe('Nothing to restore.');
  });
});

describe('memory bound', () => {
  it('drops the oldest steps with a warning once the history passes the limit', async () => {
    const t = setup({ maxBytes: 20_000 });
    for (let i = 0; i < 200; i += 1) await t.run('ADD');
    const { undoable } = t.bus.undo.state;
    expect(undoable).toBeGreaterThan(0);
    expect(undoable).toBeLessThan(200);
    expect(t.bus.undo.bytes).toBeLessThanOrEqual(20_000);
    expect(t.log.filter((l) => l.startsWith('Undo history full')).length).toBe(1);
    await t.run('UNDO', '1000');
    expect(t.count()).toBe(3 + 200 - undoable);
  });

  it('always keeps the newest step, however large', async () => {
    const t = setup({ maxBytes: 1 });
    await t.run('ADD', 'ADD');
    expect(t.bus.undo.state.undoable).toBe(1);
  });
});

describe('UndoStack on its own', () => {
  it('clears its history when a step no longer applies, rather than half-undoing', () => {
    const model = DocumentModel.create(sampleInit());
    const stack = new UndoStack({ apply: (cs) => model.apply(cs) });
    const b = new ChangeSetBuilder(model);
    b.updateEntity(model.blockEntities(MODEL_SPACE)[0]!, { color: { kind: 'aci', index: 3 } });
    const cs = b.build();
    model.apply(cs);
    stack.push({ command: 'X', changes: [cs] });
    // Someone changes the entity behind the stack's back: its "before" no longer matches.
    model.apply(invertChangeSet(cs));
    expect(() => stack.undo(1)).toThrow(/undo history was cleared/);
    expect(stack.state.undoable).toBe(0);
  });

  it('clears its history when a redo no longer applies', () => {
    const model = DocumentModel.create(sampleInit());
    const stack = new UndoStack({ apply: (cs) => model.apply(cs) });
    const b = new ChangeSetBuilder(model);
    b.updateEntity(model.blockEntities(MODEL_SPACE)[0]!, { color: { kind: 'aci', index: 3 } });
    const cs = b.build();
    model.apply(cs);
    stack.push({ command: 'X', changes: [cs] });
    stack.undo(1);
    model.apply(cs);
    expect(() => stack.redo()).toThrow(/undo history was cleared/);
    expect(stack.state).toMatchObject({ undoable: 0, redoable: 0 });
  });

  it('estimates binary and big-integer values too, counting shared values once', () => {
    // Entity xdata carries binary chunks (Uint8Array) and 64-bit integers (bigint).
    const blob = new Uint8Array(1000);
    const xdata = (values: unknown[]) =>
      ({
        objects: { added: [{ handle: 'A0', type: 'XRECORD', owner: '0', values }] },
      }) as unknown as ChangeSet;
    const one = estimateBytes(xdata([blob]));
    const two = estimateBytes(xdata([blob, blob, 1n]));
    expect(one).toBeGreaterThan(1000);
    expect(two - one).toBeLessThan(200);
  });
});

describe('1000-step undo/redo property (M2-05 acceptance)', () => {
  type Op = 'ADD' | 'NUDGE' | 'POP' | 'SETV' | 'SEGS' | 'U' | 'REDO' | 'UNDO2' | 'MARK' | 'BACK';
  const edits: Op[] = ['ADD', 'NUDGE', 'POP', 'SETV', 'SEGS'];

  async function runEdit(t: ReturnType<typeof setup>, op: Op, k: number): Promise<void> {
    if (op === 'SETV') return t.run('SETV', String(k));
    if (op === 'SEGS') return t.run('SEGS', `${k},1`, `${k},2`, '');
    return t.run(op);
  }

  it('undoes 1000 commands one by one to the exact earlier drawing, and redoes them all', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...edits), { minLength: 1000, maxLength: 1000 }),
        async (ops) => {
          const t = setup({ maxBytes: Number.POSITIVE_INFINITY });
          const shots = [t.shot()];
          for (const [i, op] of ops.entries()) {
            await runEdit(t, op, i);
            const s = t.shot();
            // A POP or NUDGE on an empty drawing edits nothing and is no step.
            if (JSON.stringify(s) !== JSON.stringify(shots.at(-1))) shots.push(s);
          }
          expect(t.bus.undo.state.undoable).toBe(shots.length - 1);
          for (let i = shots.length - 2; i >= 0; i -= 1) {
            await t.run('U');
            expect(t.shot()).toEqual(shots[i]);
          }
          for (let i = 1; i < shots.length; i += 1) {
            await t.run('REDO');
            expect(t.shot()).toEqual(shots[i]);
          }
        },
      ),
      { numRuns: 2 },
    );
  }, 120_000);

  it('matches a model of the history under random edits, U, REDO, UNDO n, Mark and Back', async () => {
    const ops = fc.array(
      fc.constantFrom<Op>(...edits, 'U', 'U', 'REDO', 'REDO', 'UNDO2', 'MARK', 'BACK'),
      { minLength: 1000, maxLength: 1000 },
    );
    await fc.assert(
      fc.asyncProperty(ops, async (list) => {
        const t = setup({ maxBytes: Number.POSITIVE_INFINITY });
        // The reference: the drawing after each undo step, marks between them, and the redo
        // groups each U/UNDO left (REDO reverses one whole U or UNDO).
        type Entry = { kind: 'shot'; shot: unknown } | { kind: 'mark' };
        const undo: Entry[] = [];
        let redo: Entry[][] = [];
        const base = t.shot();
        const top = (): unknown => {
          for (let i = undo.length - 1; i >= 0; i -= 1) {
            const e = undo[i]!;
            if (e.kind === 'shot') return e.shot;
          }
          return base;
        };
        const takeSteps = (steps: number): Entry[] => {
          const out: Entry[] = [];
          while (steps > 0 && undo.length > 0) {
            const e = undo.pop()!;
            out.push(e);
            if (e.kind === 'shot') steps -= 1;
          }
          return out;
        };
        for (const [i, op] of list.entries()) {
          if (op === 'U' || op === 'UNDO2') {
            const taken = takeSteps(op === 'U' ? 1 : 2);
            await t.run(...(op === 'U' ? ['U'] : ['UNDO', '2']));
            if (taken.some((e) => e.kind === 'shot')) redo.push(taken);
            else undo.push(...taken.reverse());
          } else if (op === 'REDO') {
            const g = redo.pop();
            await t.run('REDO');
            if (g) undo.push(...[...g].reverse());
          } else if (op === 'MARK') {
            await t.run('UNDO', 'M');
            undo.push({ kind: 'mark' });
          } else if (op === 'BACK') {
            if (!undo.some((e) => e.kind === 'mark')) continue; // would ask "undo everything?"
            const taken: Entry[] = [];
            for (;;) {
              const e = undo.pop()!;
              taken.push(e);
              if (e.kind === 'mark') break;
            }
            await t.run('UNDO', 'B');
            redo.push(taken);
          } else {
            const before = t.shot();
            await runEdit(t, op, i);
            const s = t.shot();
            if (JSON.stringify(s) !== JSON.stringify(before)) {
              undo.push({ kind: 'shot', shot: s });
              redo = [];
            }
          }
          expect(t.shot()).toEqual(top());
        }
      }),
      { numRuns: 2 },
    );
  }, 120_000);
});
