// M5-02 part 1: the Block Editor on the PromptBus, as AutoCAD 2024's (AutoCAD Help, "BEDIT
// (Command)", "-BEDIT", "Edit Block Definition Dialog Box", "BSAVE (Command)", "BCLOSE
// (Command)", "Block - Changes Not Saved Dialog Box", "BLOCKEDITOR (System Variable)"):
//   - BEDIT opens Edit Block Definition on the drawing's blocks (a block reference selected first
//     names its block; a double click on a reference without attributes runs BEDIT on it); OK
//     shows the block in the editor, where commands draw and edit in its definition, so every
//     reference follows at once; -BEDIT asks "Enter block name or [?]";
//   - BSAVE keeps the edits; BCLOSE closes the editor, asking first (Block - Changes Not Saved)
//     whether to save or discard edits not saved: Discard takes them back in BCLOSE's undo step,
//     Cancel leaves the editor open;
//   - BLOCKEDITOR is 1 while it is open; BASE moves the block's base point; INSERT refuses the
//     block being edited, which may not reference itself.
import { describe, expect, it } from 'vitest';
import {
  PromptBus,
  builtinCommands,
  doubleClickCommand,
  type BusEvent,
  type DialogRequest,
  type EntityId,
  type InsertGeometry,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { setup } from './edit-harness';

const B = '50';

/**
 * The harness drawing (block B, record 50: line 51 and circle 52) with a reference to B at
 * (100,100) (handle 40) and block OUTER holding a reference to B, on a bus whose canvas records
 * what it is asked and picks `picked`.
 */
async function editor() {
  const t = setup([
    {
      kind: 'INSERT',
      block: B,
      position: { x: 100, y: 100 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    },
  ]);
  const requests: ViewRequest[] = [];
  const state = { picked: [] as EntityId[] };
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op === 'pick') return Promise.resolve({ ok: true, ids: state.picked });
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string) => t.model.ids.idOf(h)!;
  const contents = (block = B) =>
    t.model.blockEntities(block).map((i) => t.model.entity(i)!.handle);
  const editorRequests = () => requests.filter((r) => r.op === 'blockEditor');
  const dialog = () => (bus.prompt as { dialog?: DialogRequest } | undefined)?.dialog;
  /** What SETVAR says of `name`: its prompt (Esc then), or the read-only line. */
  const variable = async (name: string) => {
    await bus.script(['SETVAR', name]);
    if (bus.promptText === 'Command:') return log.at(-1)!;
    const shown = bus.promptText;
    await bus.cancel();
    return shown;
  };
  return { ...t, bus, log, id, contents, editorRequests, dialog, state, variable };
}

describe('BEDIT', () => {
  it('opens Edit Block Definition; OK shows the block, where commands draw in its definition', async () => {
    const t = await editor();
    await t.bus.submit('BEDIT');
    const d = t.dialog() as Extract<DialogRequest, { type: 'bedit' }>;
    expect(d.type).toBe('bedit');
    expect(d.blocks.map((b) => [b.name, b.handle])).toEqual([['B', B]]);
    expect(d.name).toBe('B');
    await t.bus.answer({ kind: 'dialog', action: 'ok', bedit: { name: 'b' } });
    expect(t.bus.promptText).toBe('Command:');
    expect(t.editorRequests()).toEqual([{ op: 'blockEditor', block: B, name: 'B' }]);
    await t.bus.script(['LINE', '0,0', '0,3', '']);
    // The line is the block's, so the reference at (100,100) draws it; model space has none.
    expect(t.contents()).toHaveLength(3);
    expect(t.model.blockEntities(MODEL_SPACE).map((i) => t.model.entity(i)!.geom.kind)).toEqual([
      'LINE',
      'CIRCLE',
      'INSERT',
    ]);
  });

  it('names a block reference selected first; a double click on one runs it', async () => {
    const t = await editor();
    t.state.picked = [t.id('40')];
    expect(doubleClickCommand(t.model.entity(t.id('40')), t.model)).toBe('BEDIT');
    // Without the drawing the block is not known: nothing opens.
    expect(doubleClickCommand(t.model.entity(t.id('40')))).toBeUndefined();
    await t.bus.doubleClick({ x: 100, y: 100 });
    expect(t.bus.command).toBe('BEDIT');
    expect(t.dialog()?.type).toBe('bedit');
  });

  it('notes a block it cannot open and asks again; Cancel opens nothing', async () => {
    const t = await editor();
    await t.bus.submit('BEDIT');
    await t.bus.answer({ kind: 'dialog', action: 'ok', bedit: { name: 'A<B' } });
    const d = t.dialog() as Extract<DialogRequest, { type: 'bedit' }>;
    expect(d.note).toBe('Invalid block name.');
    expect(d.name).toBe('A<B');
    await t.bus.cancel();
    expect(t.editorRequests()).toEqual([]);
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 0 /);
  });

  it('-BEDIT asks for the name, lists blocks with ?, refuses what it cannot open', async () => {
    const t = await editor();
    await t.bus.submit('-BEDIT');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.script(['?', '*']);
    expect(t.log).toContain('  "B"');
    await t.bus.submit('*Model_Space');
    expect(t.log.at(-1)).toBe('Block "*Model_Space" not found.');
    await t.bus.submit('B');
    expect(t.bus.promptText).toBe('Command:');
    expect(t.editorRequests()).toHaveLength(1);
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 1 /);
    // TILEMODE: the editor works as model space does.
    expect(await t.variable('TILEMODE')).toContain('<1>');
    await t.bus.script(['-BEDIT']);
    expect(t.log.at(-1)).toBe('** The Block Editor is already open **');
  });

  it('Enter at -BEDIT ends it', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', '']);
    expect(t.bus.promptText).toBe('Command:');
    expect(t.editorRequests()).toEqual([]);
  });
});

describe('a new block (M5-02 part 2)', () => {
  const recordNamed = (t: Awaited<ReturnType<typeof editor>>, name: string) =>
    [...t.model.tables.blockRecords.values()].find((r) => r.name === name);

  it('a name no block has makes an empty block at 0,0 and opens it', async () => {
    const t = await editor();
    await t.bus.submit('BEDIT');
    await t.bus.answer({ kind: 'dialog', action: 'ok', bedit: { name: ' Door ' } });
    expect(t.bus.promptText).toBe('Command:');
    const r = recordNamed(t, 'Door')!;
    expect(r).toBeDefined();
    expect(t.model.blocks.get(r.handle)!.basePoint).toEqual({ x: 0, y: 0 });
    expect(t.contents(r.handle)).toEqual([]);
    expect(t.editorRequests()).toEqual([{ op: 'blockEditor', block: r.handle, name: 'Door' }]);
    await t.bus.script(['LINE', '0,0', '0,3', '']);
    expect(t.contents(r.handle)).toHaveLength(1);
    expect(t.model.blockEntities(MODEL_SPACE)).toHaveLength(3);
  });

  it('-BEDIT takes a new name too; one AutoCAD refuses is refused', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'A|B']);
    expect(t.log.at(-1)).toBe('Invalid block name.');
    expect(t.bus.promptText).toBe('Enter block name or [?]:');
    await t.bus.submit('WINDOW');
    expect(t.bus.promptText).toBe('Command:');
    expect(recordNamed(t, 'WINDOW')).toBeDefined();
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 1 /);
  });

  it('is not saved until BSAVE: Discard takes the block away, U brings it back', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'DOOR', 'BCLOSE']);
    expect(t.dialog()).toEqual({ type: 'bclose', name: 'DOOR' });
    await t.bus.answer({ kind: 'dialog', action: 'ok', bclose: 'discard' });
    expect(recordNamed(t, 'DOOR')).toBeUndefined();
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 0 /);
    await t.bus.submit('U');
    expect(recordNamed(t, 'DOOR')).toBeDefined();
  });

  it('BSAVE keeps it, empty or not; BCLOSE then asks nothing', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'DOOR', 'CIRCLE', '0,0', '1', 'BSAVE', 'BCLOSE']);
    expect(t.dialog()).toBeUndefined();
    const r = recordNamed(t, 'DOOR')!;
    expect(t.contents(r.handle)).toHaveLength(1);
    // It is a block like any other now: -INSERT places it.
    await t.bus.script(['-INSERT', 'DOOR', '10,10', '1', '', '0']);
    expect(t.model.blockEntities(MODEL_SPACE)).toHaveLength(4);
  });

  it('the Block Definition dialog\'s "Open in block editor" opens the block it made', async () => {
    const t = await editor();
    await t.bus.submit('BLOCK');
    const d = t.dialog() as Extract<DialogRequest, { type: 'block' }>;
    expect(d.editing).toBeUndefined();
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      block: {
        settings: { ...d.settings, name: 'PART', objectsOnScreen: true, openInEditor: true },
      },
    });
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.answer({ kind: 'selection', ids: [t.id('30')] });
    const r = recordNamed(t, 'PART')!;
    expect(t.editorRequests()).toEqual([{ op: 'blockEditor', block: r.handle, name: 'PART' }]);
    // Made before the editor opened: nothing to save, closing keeps it.
    await t.bus.submit('BCLOSE');
    expect(t.dialog()).toBeUndefined();
    expect(recordNamed(t, 'PART')).toBeDefined();
    // Inside the editor the option is not offered, and a block made there opens nothing.
    await t.bus.script(['-BEDIT', 'B', 'BLOCK']);
    const inside = t.dialog() as Extract<DialogRequest, { type: 'block' }>;
    expect(inside.editing).toBe(true);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      block: {
        settings: { ...inside.settings, name: 'NESTED', objectsOnScreen: true, openInEditor: true },
      },
    });
    await t.bus.answer({ kind: 'selection', ids: [t.id('51')] });
    expect(recordNamed(t, 'NESTED')).toBeDefined();
    expect(t.editorRequests().at(-1)).toEqual({ op: 'blockEditor', block: B, name: 'B' });
  });
});

describe('BSAVE and BCLOSE', () => {
  it('are only allowed in the Block Editor', async () => {
    const t = await editor();
    await t.bus.submit('BSAVE');
    expect(t.log.at(-1)).toBe('** BSAVE is only allowed in the Block Editor **');
    await t.bus.submit('BCLOSE');
    expect(t.log.at(-1)).toBe('** BCLOSE is only allowed in the Block Editor **');
  });

  it('BSAVE keeps the edits; BCLOSE then closes at once, back to model space', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'CIRCLE', '0,0', '2']);
    await t.bus.submit('BSAVE');
    expect(t.log.at(-1)).toBe('Block "B" saved.');
    await t.bus.submit('BCLOSE');
    expect(t.dialog()).toBeUndefined();
    expect(t.editorRequests().at(-1)).toEqual({ op: 'blockEditor' });
    expect(t.contents()).toHaveLength(3);
    await t.bus.script(['LINE', '5,5', '6,6', '']);
    expect(t.contents()).toHaveLength(3);
    expect(t.model.blockEntities(MODEL_SPACE)).toHaveLength(4);
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 0 /);
  });

  it('asks about edits not saved: Discard takes them back, U puts them back', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'ERASE']);
    await t.bus.answer({ kind: 'selection', ids: [t.id('51')] });
    await t.bus.script(['CIRCLE', '3,0', '1']);
    expect(t.contents()).toHaveLength(2);
    expect(t.contents()).not.toContain('51');
    await t.bus.submit('BCLOSE');
    expect(t.dialog()).toEqual({ type: 'bclose', name: 'B' });
    await t.bus.answer({ kind: 'dialog', action: 'ok', bclose: 'discard' });
    expect(t.contents()).toEqual(['51', '52']);
    expect(t.editorRequests().at(-1)).toEqual({ op: 'blockEditor' });
    // The discard is BCLOSE's undo step.
    await t.bus.submit('U');
    expect(t.contents()).toHaveLength(2);
    expect(t.contents()).not.toContain('51');
  });

  it('Discard takes back only what was made after the last BSAVE', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'CIRCLE', '3,0', '1', 'BSAVE', 'CIRCLE', '6,0', '1']);
    expect(t.contents()).toHaveLength(4);
    await t.bus.submit('BCLOSE');
    await t.bus.answer({ kind: 'dialog', action: 'ok', bclose: 'discard' });
    expect(t.contents()).toHaveLength(3);
  });

  it('Save keeps the edits; Cancel leaves the editor open', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'CIRCLE', '3,0', '1', 'BCLOSE']);
    await t.bus.cancel();
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 1 /);
    await t.bus.submit('BCLOSE');
    await t.bus.answer({ kind: 'dialog', action: 'ok', bclose: 'save' });
    expect(await t.variable('BLOCKEDITOR')).toMatch(/BLOCKEDITOR = 0 /);
    expect(t.contents()).toHaveLength(3);
  });
});

describe('commands in the Block Editor', () => {
  it('BASE moves the block base point, which every reference places at its insertion point', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'BASE']);
    expect(t.bus.promptText).toBe('Enter base point <0.0000,0.0000,0.0000>:');
    await t.bus.submit('1,0');
    expect(t.model.blocks.get(B)!.basePoint).toEqual({ x: 1, y: 0 });
    expect(t.model.header.get('$INSBASE')).toBeUndefined();
    expect(t.model.header.get('$PINSBASE')).toBeUndefined();
  });

  it('INSERT refuses the block being edited', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', '-INSERT', 'B']);
    expect(t.log).toContain('Block "B" references itself.');
    expect(t.contents()).toEqual(['51', '52']);
  });

  it('a reference elsewhere keeps drawing the edited block', async () => {
    const t = await editor();
    await t.bus.script(['-BEDIT', 'B', 'BCLOSE']);
    const ref = t.model.entity(t.id('40'))!.geom as InsertGeometry;
    expect(ref.block).toBe(B);
  });
});
