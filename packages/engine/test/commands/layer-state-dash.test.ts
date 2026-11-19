// M5-18 part 2: -LAYER's stAte option, the Layer States Manager's Save, Restore, Edit, Name
// (rename) and Delete at the command line (AutoCAD Help, "-LAYER (Command)", State).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  LAYER_STATE_MASK,
  PromptBus,
  builtinCommands,
  layerStates,
  type BusEvent,
  type DocumentInit,
  type LayerStateInit,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { layer, linetype, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const HANDLES = [L0, WALLS, DOORS, NOTES];
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
};

const STATE_OPTIONS = 'Enter an option [?/Save/Restore/Edit/Name/Delete/Import/EXport]:';
const PROPERTIES =
  'Enter states to change [On/Frozen/Lock/Plot/Newvpfreeze/Color/lineType/lineWeight/TRansparency/plotStyle]:';
const ALL =
  'Layer properties to restore: On, Frozen, Lock, Plot, New VP Freeze, Color, Linetype, Lineweight, Transparency, Plot Style';

/** Four layers (0, WALLS, DOORS, NOTES), WALLS current; no layer states. */
function setup(files?: (r: ViewRequest) => ViewReply | undefined) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ['$CLAYER', 'WALLS']]),
    tables: {
      ...init.tables,
      linetypes: [linetype('14', 'Continuous')],
      layers: HANDLES.map((h) => layer(h, NAMES[h]!)),
    },
  });
  const base = host(() => model);
  const requests: ViewRequest[] = [];
  const view = {
    request: (r: ViewRequest): Promise<ViewReply> => {
      requests.push(r);
      const reply = files?.(r);
      return reply ? Promise.resolve(reply) : base.request(r);
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const lay = (h: string) => model.tables.layers.get(h)!;
  const states = () => layerStates(model);
  const state = (name: string) => states().find((s) => s.name === name);
  return { model, bus, log, lay, states, state, requests };
}

describe('-LAYER stAte', () => {
  it('asks for a state option until Enter, then -LAYER options again', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A']);
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
    await t.bus.script(['']);
    expect(t.bus.promptText).toMatch(
      /^Enter an option \[\?\/Make\/.*\/stAte\/Description\/rEconcile\/Xref\]:$/,
    );
    await t.bus.script(['STATE', '?', '']);
    expect(t.log.at(-1)).toBe('No matching layer states found.');
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
  });

  it('Save saves every layer and the current layer, with the properties to restore', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A', 'S']);
    expect(t.bus.promptText).toBe('Enter new layer state name:');
    await t.bus.script(['PLAN']);
    expect(t.log.at(-1)).toBe(ALL);
    expect(t.bus.promptText).toBe(PROPERTIES);
    // Color off, then Lock off and on again: a property typed is turned on or off.
    await t.bus.script(['C', 'L', 'L']);
    expect(t.log.at(-1)).toBe(
      'Layer properties to restore: On, Frozen, Lock, Plot, New VP Freeze, Linetype, Lineweight, Transparency, Plot Style',
    );
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
    const plan = t.state('PLAN')!;
    expect(plan.mask).toBe(LAYER_STATE_MASK.all & ~LAYER_STATE_MASK.color);
    expect(plan.currentLayer).toBe('WALLS');
    expect(plan.layers.map((e) => e.name)).toEqual(['0', 'WALLS', 'DOORS', 'NOTES']);
    await t.bus.script(['', '']);
    expect(t.bus.prompt).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('Save of a name in use asks to overwrite it; a bad name is refused', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A', 'S', 'PLAN', '', '']);
    await t.bus.script(['OFF', 'DOORS', 'A', 'S', 'plan']);
    expect(t.bus.promptText).toBe('Layer state "PLAN" already exists. Overwrite it? <N>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
    expect(t.state('PLAN')!.layers.find((e) => e.name === 'DOORS')!.on).toBe(true);
    await t.bus.script(['S', 'plan', 'Y', 'T', '']);
    expect(t.states().map((s) => s.name)).toEqual(['PLAN']);
    const plan = t.state('PLAN')!;
    expect(plan.layers.find((e) => e.name === 'DOORS')!.on).toBe(false);
    expect(plan.mask).toBe(LAYER_STATE_MASK.all & ~LAYER_STATE_MASK.linetype);
    await t.bus.script(['S', 'A<B', '']);
    expect(t.log.at(-1)).toBe('Invalid layer state name.');
    await t.bus.script(['S', '']);
    expect(t.states()).toHaveLength(1);
  });

  it('Restore sets the properties it restores and the current layer', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A', 'S', 'PLAN', 'C', '', '']);
    await t.bus.script(['OFF', 'DOORS', 'C', '1', 'NOTES', 'S', 'NOTES']);
    expect(t.model.header.get('$CLAYER')).toBe('NOTES');
    await t.bus.script(['A', 'R']);
    expect(t.bus.promptText).toBe('Enter name of layer state to restore or [?]:');
    await t.bus.script(['?']);
    expect(t.log.at(-1)).toMatch(/^"PLAN" +Model$/);
    expect(t.bus.promptText).toBe('Enter name of layer state to restore or [?]:');
    await t.bus.script(['plan']);
    expect(t.lay(DOORS).on).toBe(true);
    // Color was not saved to be restored.
    expect(t.lay(NOTES).color).toEqual({ kind: 'aci', index: 1 });
    expect(t.model.header.get('$CLAYER')).toBe('WALLS');
    expect((t.state('PLAN')!.mask & LAYER_STATE_MASK.lastRestored) !== 0).toBe(true);
    await t.bus.script(['R', 'NONE']);
    expect(t.log.at(-1)).toBe('Cannot find layer state "NONE".');
    await t.bus.script(['R', '', '', '']);
    expect(t.bus.prompt).toBeUndefined();
    // The whole command, saves and restores included, is one undo step.
    expect(t.bus.undo.state.undoable).toBe(1);
    await t.bus.script(['U']);
    expect(t.states()).toEqual([]);
    expect(t.lay(NOTES).color).toEqual({ kind: 'aci', index: 7 });
  });

  it('Edit changes the properties a state restores', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A', 'S', 'PLAN', '', 'E']);
    expect(t.bus.promptText).toBe('Enter name of layer state to edit or [?]:');
    await t.bus.script(['PLAN']);
    expect(t.log.at(-1)).toBe(ALL);
    await t.bus.script(['O', 'F', 'Lock', 'P', 'N', 'C', 'T', 'W', 'TR', 'S']);
    expect(t.log.at(-1)).toBe('Layer properties to restore: none');
    await t.bus.script(['O', '']);
    expect(t.state('PLAN')!.mask & LAYER_STATE_MASK.all).toBe(
      LAYER_STATE_MASK.on | LAYER_STATE_MASK.vpFrozen,
    );
    await t.bus.script(['E', '']);
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
  });

  it('Name renames a state; Delete deletes one', async () => {
    const t = setup();
    await t.bus.script(['-LAYER', 'A', 'S', 'PLAN', '', 'S', 'ELEV', '', 'N']);
    expect(t.bus.promptText).toBe('Enter name of layer state to rename or [?]:');
    await t.bus.script(['PLAN']);
    expect(t.bus.promptText).toBe('Enter new layer state name:');
    await t.bus.script(['elev']);
    expect(t.log.at(-1)).toBe('A layer state named "ELEV" already exists.');
    await t.bus.script(['N', 'PLAN', '', 'N', '']);
    await t.bus.script(['N', 'PLAN', 'GROUND']);
    expect(t.states().map((s) => s.name)).toEqual(['ELEV', 'GROUND']);
    await t.bus.script(['?', 'G*']);
    expect(t.log.at(-1)).toMatch(/^"GROUND" +Model$/);
    await t.bus.script(['D']);
    expect(t.bus.promptText).toBe('Enter name of layer state to delete or [?]:');
    await t.bus.script(['elev']);
    expect(t.states().map((s) => s.name)).toEqual(['GROUND']);
    await t.bus.script(['D', 'ELEV']);
    expect(t.log.at(-1)).toBe('Cannot find layer state "ELEV".');
  });
});

/** A `.las` file's state: WALLS off and red, a layer GONE the drawing lacks. */
const FILE_STATE: LayerStateInit = {
  name: 'PLAN',
  description: 'From the file',
  mask: LAYER_STATE_MASK.all | LAYER_STATE_MASK.lastRestored,
  paperSpace: false,
  currentLayer: 'DOORS',
  layers: ['WALLS', 'GONE'].map((name) => ({
    name,
    on: false,
    frozen: false,
    locked: false,
    plot: true,
    newVpFrozen: false,
    vpFrozen: false,
    color: { kind: 'aci', index: 1 } as const,
    linetypeName: 'CONTINUOUS',
    lineweight: 'Default',
    plotStyle: 'Color_1',
    transparency: { alpha: 255 },
  })),
};

/** Another drawing holding a state ELEV (layer 0 off), which a DWG or DXF import reads. */
async function drawingWithState(): Promise<DocumentInit> {
  const t = setup();
  await t.bus.script(['-LAYER', 'OFF', '0', 'A', 'S', 'ELEV', '', '', '']);
  const m = t.model;
  return {
    meta: m.meta,
    handSeed: m.handSeed,
    header: m.header,
    tables: Object.fromEntries(
      Object.entries(m.tables).map(([k, v]) => [k, [...v.values()]]),
    ) as NonNullable<DocumentInit['tables']>,
    blocks: [...m.blocks.values()],
    layouts: [...m.layouts],
    objects: [...m.objects.values()],
  };
}

describe('-LAYER stAte Import and EXport (M5-18 part 3)', () => {
  it('Import reads every state of a .las file the app finds by name', async () => {
    const t = setup((r) =>
      r.op === 'layerStateFile' && r.file === 'plan.las'
        ? { ok: true, layerStateFile: { name: 'plan.las', states: [FILE_STATE] } }
        : r.op === 'layerStateFile'
          ? { ok: true }
          : undefined,
    );
    await t.bus.script(['-LAYER', 'A', 'I']);
    expect(t.bus.promptText).toBe('Enter file name to import:');
    await t.bus.script(['"nowhere.las"']);
    expect(t.log.at(-1)).toBe('File "nowhere.las" not found.');
    await t.bus.script(['I', '']);
    expect(t.bus.promptText).toBe(STATE_OPTIONS);
    await t.bus.script(['I', 'plan.las']);
    expect(t.log.at(-1)).toBe('Layer state "PLAN" imported.');
    const plan = t.state('PLAN')!;
    expect(plan.description).toBe('From the file');
    // Layers by name: WALLS is the drawing's, GONE stays a name; the file's own mark is dropped.
    expect(plan.layers.map((e) => [e.name, e.layer])).toEqual([
      ['WALLS', WALLS],
      ['GONE', undefined],
    ]);
    expect(plan.mask & LAYER_STATE_MASK.lastRestored).toBe(0);
    expect(t.requests.filter((r) => r.op === 'layerStateFile').map((r) => r.file)).toEqual([
      'nowhere.las',
      'plan.las',
    ]);
    // A state of the same name asks first: No keeps it, Yes replaces it.
    await t.bus.script(['I', 'plan.las']);
    expect(t.bus.promptText).toBe('Layer state "PLAN" already exists. Overwrite it? <N>:');
    await t.bus.script(['']);
    expect(t.states()).toHaveLength(1);
    await t.bus.script(['R', 'PLAN', 'I', 'plan.las', 'Y']);
    expect(t.states()).toHaveLength(1);
    expect(t.state('PLAN')!.mask & LAYER_STATE_MASK.lastRestored).toBe(0);
    await t.bus.script(['', '']);
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('Import of a drawing reads the states it holds; a bad file or name is said', async () => {
    const drawing = await drawingWithState();
    const bad = { ...FILE_STATE, name: 'A<B' };
    const t = setup((r) => {
      if (r.op !== 'layerStateFile') return undefined;
      if (r.file === 'site') return { ok: true, layerStateFile: { name: 'site.dxf', drawing } };
      if (r.file === 'empty.dxf')
        return { ok: true, layerStateFile: { name: 'empty.dxf', states: [] } };
      if (r.file === 'bad.las')
        return { ok: true, layerStateFile: { name: 'bad.las', states: [bad] } };
      return { ok: false, message: 'broken.las could not be read: no LAYERSTATEDICTIONARY' };
    });
    await t.bus.script(['-LAYER', 'A', 'I', 'site']);
    expect(t.log.at(-1)).toBe('Layer state "ELEV" imported.');
    const elev = t.state('ELEV')!;
    expect(elev.layers.find((e) => e.name === '0')!.on).toBe(false);
    expect(elev.layers.find((e) => e.name === '0')!.layer).toBe(L0);
    await t.bus.script(['I', 'empty.dxf']);
    expect(t.log.at(-1)).toBe('empty.dxf holds no layer state.');
    await t.bus.script(['I', 'bad.las']);
    expect(t.log.at(-1)).toBe('Invalid layer state name.');
    await t.bus.script(['I', 'broken.las']);
    expect(t.log.at(-1)).toBe('broken.las could not be read: no LAYERSTATEDICTIONARY');
    expect(t.states().map((s) => s.name)).toEqual(['ELEV']);
  });

  it('EXport hands the app a state with its layers and linetypes by name', async () => {
    let fail = false;
    const t = setup((r) =>
      r.op !== 'writeLayerState'
        ? undefined
        : fail
          ? { ok: false, message: 'PLAN.las was not written: disk full' }
          : { ok: true, file: r.file },
    );
    await t.bus.script(['-LAYER', 'A', 'S', 'PLAN', '', 'EX']);
    expect(t.bus.promptText).toBe('Enter name of layer state to export or [?]:');
    await t.bus.script(['NONE']);
    expect(t.log.at(-1)).toBe('Cannot find layer state "NONE".');
    await t.bus.script(['EX', 'plan']);
    // The state's name (a layer state name holds no character a file name cannot).
    expect(t.bus.promptText).toBe('Enter file name <PLAN.las>:');
    await t.bus.script(['']);
    expect(t.log.at(-1)).toBe('Layer state "PLAN" exported to PLAN.las.');
    const w = t.requests.find((r) => r.op === 'writeLayerState');
    expect(w).toMatchObject({ op: 'writeLayerState', file: 'PLAN.las' });
    const state = (w as Extract<ViewRequest, { op: 'writeLayerState' }>).state;
    expect(state.name).toBe('PLAN');
    expect(state.currentLayer).toBe('WALLS');
    expect(state.layers.map((e) => [e.name, e.linetypeName, e.layer, e.linetype])).toEqual([
      ['0', 'Continuous', undefined, undefined],
      ['WALLS', 'Continuous', undefined, undefined],
      ['DOORS', 'Continuous', undefined, undefined],
      ['NOTES', 'Continuous', undefined, undefined],
    ]);
    // A name typed without .las gets it; a failed write is said.
    await t.bus.script(['EX', 'PLAN', '"my plan"']);
    expect(t.log.at(-1)).toBe('Layer state "PLAN" exported to my plan.las.');
    fail = true;
    await t.bus.script(['EX', 'PLAN', 'a.LAS']);
    expect(t.log.at(-1)).toBe('PLAN.las was not written: disk full');
    // Exports change nothing in the drawing: the command's one step is the Save.
    await t.bus.script(['', '']);
    expect(t.bus.undo.state.undoable).toBe(1);
  });
});
