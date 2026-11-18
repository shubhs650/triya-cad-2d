// M5-06 part 1: the layer tool row's commands, with AutoCAD 2024's prompts (AutoCAD Help,
// "LAYOFF (Command)", "LAYON", "LAYFRZ", "LAYTHW", "LAYLCK", "LAYULK", "LAYMCUR", "LAYCUR",
// "LAYMCH", "LAYISO", "LAYUNISO" and "LAYLOCKFADECTL (System Variable)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type LayerRecord,
} from '../../src/index';
import { entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
};

/**
 * Four layers, each holding one line from x 0 to 10: 0 at y 0 (handle 30), WALLS at y 10 (31),
 * DOORS at y 20 (32) and NOTES at y 30 (33). WALLS is current unless `current` says otherwise.
 */
function setup(
  o: { current?: string; layers?: Partial<Record<string, Partial<LayerRecord>>> } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ['$CLAYER', o.current ?? 'WALLS']]),
    tables: {
      ...init.tables,
      layers: [L0, WALLS, DOORS, NOTES].map((h) => ({
        ...layer(h, NAMES[h]!),
        ...o.layers?.[h],
      })),
    },
    entities: [L0, WALLS, DOORS, NOTES].map((h, i) =>
      entityInit((0x30 + i).toString(16).toUpperCase(), lineGeom(0, i * 10, 10, i * 10), {
        layer: h,
      }),
    ),
  });
  const variables = new Map<string, number>([['LAYLOCKFADECTL', 50]]);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model, variables),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const lay = (h: string) => model.tables.layers.get(h)!;
  const states = (key: 'on' | 'frozen' | 'locked') =>
    [L0, WALLS, DOORS, NOTES].map((h) => lay(h)[key]);
  const current = () => model.header.get('$CLAYER');
  const layerOf = (h: string) => model.entity(model.ids.idOf(h)!)!.layer;
  /** A pick on the line of the layer `h`. */
  const on = (h: string) => ({ x: 5, y: [L0, WALLS, DOORS, NOTES].indexOf(h) * 10 });
  return { model, bus, log, lay, states, current, layerOf, on, variables };
}

describe('LAYOFF and LAYON', () => {
  it('turns off the layer of each object picked until Enter, and LAYON turns them all on', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Block');
    expect(t.bus.promptText).toBe(
      'Select an object on the layer to be turned off or [Settings/Undo]:',
    );
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" has been turned off.');
    await t.bus.pick(t.on(NOTES));
    expect(t.states('on')).toEqual([true, true, false, false]);
    await t.bus.script(['']);
    expect(t.bus.prompt).toBeUndefined();
    // One command, one undo step.
    await t.bus.script(['U']);
    expect(t.states('on')).toEqual([true, true, true, true]);
    await t.bus.script(['REDO']);
    expect(t.states('on')).toEqual([true, true, false, false]);
    await t.bus.script(['LAYON']);
    expect(t.log).toContain('All layers have been turned on.');
    expect(t.states('on')).toEqual([true, true, true, true]);
  });

  it('Undo turns the last layer back on; with none left it says so', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['U']);
    expect(t.states('on')).toEqual([true, true, false, true]);
    await t.bus.script(['U']);
    expect(t.states('on')).toEqual([true, true, true, true]);
    await t.bus.script(['U']);
    expect(t.log).toContain('Nothing to undo.');
    expect(t.bus.promptText).toMatch(/^Select an object on the layer to be turned off/);
  });

  it('asks before turning off the current layer, No by default', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(WALLS));
    expect(t.bus.promptText).toBe(
      'Layer "WALLS" is the current layer, do you want to turn it off? [Yes/No] <No>:',
    );
    await t.bus.script(['']);
    expect(t.lay(WALLS).on).toBe(true);
    await t.bus.pick(t.on(WALLS));
    await t.bus.script(['Y']);
    expect(t.lay(WALLS).on).toBe(false);
    expect(t.log).toContain('Layer "WALLS" has been turned off.');
  });

  it('Settings keeps the viewport choice for the drawing', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF', 'S', 'V']);
    expect(t.bus.promptText).toBe('In paper space viewport use [Vpfreeze/Off] <Vpfreeze>:');
    await t.bus.script(['O', '']);
    await t.bus.script(['LAYOFF']);
    expect(t.log).toContain('Current settings: Viewports=Off, Block nesting level=Block');
  });

  it('LAYON with every layer on changes nothing and is no undo step', async () => {
    const t = setup();
    await t.bus.script(['LAYON']);
    expect(t.log).toContain('All layers have been turned on.');
    expect(t.bus.undo.state.undoable).toBe(0);
  });
});

describe('LAYFRZ and LAYTHW', () => {
  it('freezes the layer of each object picked, never the current one', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ']);
    expect(t.log).toContain('Current settings: Viewports=Vpfreeze, Block nesting level=Block');
    expect(t.bus.promptText).toBe('Select an object on a layer to be frozen or [Settings/Undo]:');
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" has been frozen.');
    await t.bus.pick(t.on(WALLS));
    expect(t.log).toContain('Cannot freeze layer "WALLS".  It is the CURRENT layer.');
    await t.bus.pick(t.on(L0));
    expect(t.states('frozen')).toEqual([true, false, true, false]);
    await t.bus.script(['U']);
    expect(t.states('frozen')).toEqual([false, false, true, false]);
    await t.bus.script(['S', 'V']);
    expect(t.bus.promptText).toBe('In paper space viewport use [Freeze/Vpfreeze] <Vpfreeze>:');
    await t.bus.script(['F', '']);
    await t.bus.script(['LAYFRZ']);
    expect(t.log).toContain('Current settings: Viewports=Freeze, Block nesting level=Block');
    await t.bus.script(['']);
    await t.bus.script(['LAYTHW']);
    expect(t.log).toContain('All layers have been thawed.');
    expect(t.states('frozen')).toEqual([false, false, false, false]);
  });
});

describe('LAYLCK and LAYULK', () => {
  it('locks the layer of the object picked, and unlocks it again', async () => {
    const t = setup();
    await t.bus.script(['LAYLCK']);
    expect(t.bus.promptText).toBe('Select an object on the layer to be locked:');
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" has been locked.');
    expect(t.lay(DOORS).locked).toBe(true);
    expect(t.bus.prompt).toBeUndefined();
    await t.bus.script(['LAYLCK']);
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" is already locked.');
    await t.bus.script(['LAYULK']);
    expect(t.bus.promptText).toBe('Select an object on the layer to be unlocked:');
    // An object on a locked layer can be picked: LAYULK edits the layer, not the object.
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" has been unlocked.');
    expect(t.lay(DOORS).locked).toBe(false);
    await t.bus.script(['LAYULK']);
    await t.bus.pick(t.on(NOTES));
    expect(t.log).toContain('Layer "NOTES" is not locked.');
  });

  it('Enter without a pick changes nothing', async () => {
    const t = setup();
    await t.bus.script(['LAYLCK', '']);
    await t.bus.script(['LAYULK', '']);
    await t.bus.script(['LAYMCUR', '']);
    expect(t.states('locked')).toEqual([false, false, false, false]);
    expect(t.current()).toBe('WALLS');
    expect(t.bus.prompt).toBeUndefined();
  });
});

describe('LAYMCUR', () => {
  it("makes the picked object's layer current", async () => {
    const t = setup();
    await t.bus.script(['LAYMCUR']);
    expect(t.bus.promptText).toBe('Select object whose layer will become current:');
    await t.bus.pick(t.on(NOTES));
    expect(t.current()).toBe('NOTES');
    expect(t.log).toContain('NOTES is now the current layer.');
    await t.bus.script(['U']);
    expect(t.current()).toBe('WALLS');
    await t.bus.script(['LAYMCUR']);
    await t.bus.pick(t.on(WALLS));
    expect(t.log.at(-1)).toBe('WALLS is now the current layer.');
  });
});

describe('LAYCUR', () => {
  it('moves the objects selected to the current layer', async () => {
    const t = setup();
    await t.bus.script(['LAYCUR']);
    expect(t.bus.promptText).toBe('Select objects to be changed to the current layer:');
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(WALLS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    expect(t.layerOf('32')).toBe(WALLS);
    expect(t.layerOf('33')).toBe(WALLS);
    expect(t.log).toContain('2 objects changed to layer "WALLS" (the current layer).');
    await t.bus.script(['LAYCUR']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['']);
    expect(t.log).toContain('1 object changed to layer "WALLS" (the current layer).');
  });

  it('leaves objects on locked layers alone', async () => {
    const t = setup({ layers: { [DOORS]: { locked: true } } });
    await t.bus.script(['LAYCUR']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    expect(t.layerOf('32')).toBe(DOORS);
    expect(t.bus.prompt).toBeUndefined();
  });
});

describe('LAYMCH', () => {
  it('moves the objects selected to the layer of the object picked', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH']);
    expect(t.bus.promptText).toBe('Select objects to be changed:');
    await t.bus.pick(t.on(L0));
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    await t.bus.pick(t.on(NOTES));
    expect(t.layerOf('30')).toBe(NOTES);
    expect(t.layerOf('32')).toBe(NOTES);
    expect(t.log).toContain('2 objects changed to layer "NOTES".');
    await t.bus.script(['U']);
    expect(t.layerOf('30')).toBe(L0);
  });

  it('Name takes a layer by its name, asking again for one the drawing lacks', async () => {
    const t = setup();
    await t.bus.script(['-LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', 'N']);
    expect(t.bus.promptText).toBe('Enter layer name:');
    await t.bus.script(['ROOF']);
    expect(t.log).toContain('Layer "ROOF" not found.');
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    await t.bus.script(['N', 'doors']);
    expect(t.layerOf('30')).toBe(DOORS);
    expect(t.log).toContain('1 object changed to layer "DOORS".');
  });

  it('ends without a change when nothing is selected or no destination is given', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH', '']);
    expect(t.bus.prompt).toBeUndefined();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', '']);
    expect(t.bus.prompt).toBeUndefined();
    expect(t.layerOf('30')).toBe(L0);
  });
});

// M5-06 part 3: LAYMCH's Name opens AutoCAD's Change to Layer dialog (AutoCAD Help, "LAYMCH
// (Command)", "Change to Layer Dialog Box": Current Layer, where a new name makes a layer, and the
// Destination Layer list); -LAYMCH keeps the name typed.
describe("LAYMCH's Change to Layer dialog", () => {
  const dialogOf = (t: ReturnType<typeof setup>) => {
    const p = t.bus.prompt;
    return p?.kind === 'dialog' && p.dialog.type === 'layerlist' ? p.dialog : undefined;
  };

  it('lists the layers with the current one, and OK moves the objects to the layer chosen', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', 'N']);
    expect(dialogOf(t)).toEqual({
      type: 'layerlist',
      title: 'Change to Layer',
      multiple: false,
      current: 'WALLS',
      layers: ['0', 'DOORS', 'NOTES', 'WALLS'].map((name) => ({
        handle: Object.keys(NAMES).find((h) => NAMES[h] === name),
        name,
      })),
    });
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [DOORS] });
    expect(t.layerOf('30')).toBe(DOORS);
    expect(t.log).toContain('1 object changed to layer "DOORS".');
  });

  it('makes a layer named in Current Layer that the drawing lacks, in one undo step', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['', 'N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layerName: ' ROOF ' });
    const roof = [...t.model.tables.layers.values()].find((l) => l.name === 'ROOF')!;
    expect(roof).toBeDefined();
    expect(t.layerOf('30')).toBe(roof.handle);
    expect(t.layerOf('33')).toBe(roof.handle);
    expect(t.log).toContain('Layer "ROOF" created.');
    expect(t.log).toContain('2 objects changed to layer "ROOF".');
    await t.bus.script(['U']);
    expect(t.layerOf('30')).toBe(L0);
    expect([...t.model.tables.layers.values()].some((l) => l.name === 'ROOF')).toBe(false);
  });

  it('takes an existing layer typed in Current Layer whatever its case', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', 'N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layerName: 'notes' });
    expect(t.layerOf('30')).toBe(NOTES);
    expect(t.model.tables.layers.size).toBe(4);
  });

  it('says why a name cannot be a layer and goes back, as Cancel does', async () => {
    const t = setup();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', 'N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layerName: 'A<B' });
    expect(t.log.at(-1)).toMatch(/invalid|cannot/i);
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    await t.bus.script(['N']);
    await t.bus.answer({ kind: 'escape' });
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    await t.bus.script(['N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [] });
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    expect(t.layerOf('30')).toBe(L0);
  });
});

describe('LAYISO and LAYUNISO', () => {
  it('locks and fades every other layer, then LAYUNISO restores them', async () => {
    const t = setup({ layers: { [NOTES]: { locked: true } } });
    await t.bus.script(['LAYISO']);
    expect(t.log).toContain('Current setting: Lock layers, Fade=50');
    expect(t.bus.promptText).toBe('Select objects on the layer(s) to be isolated or [Settings]:');
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    expect(t.log).toContain('2 layers have been isolated.');
    // The isolated layers are unlocked; the others locked (and faded by LAYLOCKFADECTL).
    expect(t.states('locked')).toEqual([true, true, false, false]);
    expect(t.states('on')).toEqual([true, true, true, true]);
    // The current layer was not isolated: new objects go on the first one picked.
    expect(t.current()).toBe('DOORS');
    // A layer changed since keeps its change.
    await t.bus.script(['LAYULK']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['LAYUNISO']);
    expect(t.log).toContain('Layers isolated by LAYISO command have been restored.');
    expect(t.states('locked')).toEqual([false, false, false, true]);
    expect(t.current()).toBe('DOORS');
    await t.bus.script(['LAYUNISO']);
    expect(t.log).toContain('No layers have been isolated with LAYISO.');
  });

  it('Settings Off turns the other layers off; Lock and fade sets LAYLOCKFADECTL', async () => {
    const t = setup();
    await t.bus.script(['LAYISO', 'S']);
    expect(t.bus.promptText).toBe(
      'Enter setting for layers not isolated [Off/Lock and fade] <Lock and fade>:',
    );
    await t.bus.script(['O']);
    expect(t.bus.promptText).toBe('In paper space viewport use [Vpfreeze/Off] <Vpfreeze>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Select objects on the layer(s) to be isolated or [Settings]:');
    await t.bus.pick(t.on(WALLS));
    await t.bus.script(['']);
    expect(t.log).toContain('Layer "WALLS" has been isolated.');
    expect(t.states('on')).toEqual([false, true, false, false]);
    expect(t.states('locked')).toEqual([false, false, false, false]);
    expect(t.current()).toBe('WALLS');
    await t.bus.script(['LAYUNISO']);
    expect(t.states('on')).toEqual([true, true, true, true]);

    await t.bus.script(['LAYISO']);
    expect(t.log).toContain('Current setting: Hide layers, Viewports=Vpfreeze');
    await t.bus.script(['S', 'L']);
    expect(t.bus.promptText).toBe('Enter fade value (0-90) <50>:');
    await t.bus.script(['95']);
    expect(t.log).toContain('Value must be between 0 and 90.');
    await t.bus.script(['70']);
    expect(t.variables.get('LAYLOCKFADECTL')).toBe(70);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['']);
    expect(t.states('locked')).toEqual([false, true, true, true]);
    await t.bus.script(['LAYISO']);
    expect(t.log).toContain('Current setting: Lock layers, Fade=70');
  });

  it('isolating again replaces what LAYUNISO restores; Esc and an empty selection change nothing', async () => {
    const t = setup();
    await t.bus.script(['LAYISO', '']);
    expect(t.bus.prompt).toBeUndefined();
    expect(t.states('locked')).toEqual([false, false, false, false]);
    await t.bus.script(['LAYISO']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.script(['LAYISO']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    expect(t.states('locked')).toEqual([true, true, true, false]);
    await t.bus.script(['LAYUNISO']);
    // Back to how the second LAYISO found them.
    expect(t.states('locked')).toEqual([true, true, false, true]);
    await t.bus.script(['U']);
    expect(t.states('locked')).toEqual([true, true, true, false]);
  });
});

describe('Esc', () => {
  it('ends each command at any of its prompts, keeping what was done', async () => {
    const t = setup();
    const esc = async (...lines: string[]) => {
      await t.bus.script(lines);
      await t.bus.cancel();
      expect(t.bus.prompt).toBeUndefined();
    };
    await esc('LAYOFF', 'S');
    await esc('LAYFRZ', 'S');
    await esc('LAYOFF');
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(WALLS));
    await t.bus.cancel();
    expect(t.lay(WALLS).on).toBe(true);
    await esc('LAYISO', 'S');
    await esc('LAYISO', 'S', 'O');
    await esc('LAYISO', 'S', 'L');
    await esc('LAYISO');
    await t.bus.script(['-LAYMCH']);
    await t.bus.pick(t.on(L0));
    await esc('', 'N');
    // Esc in the Change to Layer dialog is its Cancel: back to the pick, then a second ends it.
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await t.bus.script(['', 'N']);
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Select object on destination layer or [Name]:');
    await t.bus.cancel();
    expect(t.bus.prompt).toBeUndefined();
    await t.bus.script(['LAYMCH']);
    await t.bus.pick(t.on(L0));
    await esc('');
    await esc('LAYCUR');
    expect(t.states('on')).toEqual([true, true, true, true]);
    expect(t.states('locked')).toEqual([false, false, false, false]);
    expect(t.layerOf('30')).toBe(L0);
  });

  it('LAYISO takes AutoCAD’s initial fade of 50 when the app keeps no LAYLOCKFADECTL', async () => {
    const t = setup();
    t.variables.delete('LAYLOCKFADECTL');
    await t.bus.script(['LAYISO']);
    expect(t.log).toContain('Current setting: Lock layers, Fade=50');
    await t.bus.script(['S', 'L']);
    expect(t.bus.promptText).toBe('Enter fade value (0-90) <50>:');
  });
});
