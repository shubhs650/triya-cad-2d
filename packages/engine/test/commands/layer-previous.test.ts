// M5-06 part 2: LAYERP and LAYERPMODE (AutoCAD 2024 Help, "LAYERP (Command)": "Undoes the last
// change or set of changes made to layer settings"; renamed layers keep their new name, deleted
// layers stay deleted, new layers stay; "LAYERPMODE (Command)": tracking on and off).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
} from '../../src/index';
import { entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const LAYERS = [L0, WALLS, DOORS, NOTES];
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
};

/** Four layers with a line each, at y 0, 10, 20 and 30; WALLS current. */
function init() {
  const base = sampleInit();
  return {
    ...base,
    tables: { ...base.tables, layers: LAYERS.map((h) => layer(h, NAMES[h]!)) },
    entities: LAYERS.map((h, i) =>
      entityInit((0x30 + i).toString(16).toUpperCase(), lineGeom(0, i * 10, 10, i * 10), {
        layer: h,
      }),
    ),
  };
}

function setup() {
  const model = DocumentModel.create(init());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model, new Map()),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const lay = (h: string) => model.tables.layers.get(h)!;
  const on = (h: string) => ({ x: 5, y: LAYERS.indexOf(h) * 10 });
  return { model, bus, log, lay, on, current: () => model.header.get('$CLAYER') };
}

describe('LAYERP', () => {
  it('puts back the newest set of layer changes, one command at a time, never its own', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.script(['LAYLCK']);
    await t.bus.pick(t.on(NOTES));
    expect([t.lay(DOORS).on, t.lay(NOTES).locked]).toEqual([false, true]);
    await t.bus.script(['LAYERP']);
    expect(t.log).toContain('Restored previous layer state.');
    expect([t.lay(DOORS).on, t.lay(NOTES).locked]).toEqual([false, false]);
    await t.bus.script(['LAYERP']);
    expect([t.lay(DOORS).on, t.lay(NOTES).locked]).toEqual([true, false]);
    await t.bus.script(['LAYERP']);
    expect(t.log.at(-1)).toBe('No previous layer state to restore.');
    // LAYERP is an undo step of its own.
    await t.bus.script(['U']);
    expect(t.lay(DOORS).on).toBe(false);
  });

  it('puts back the current layer, and takes no set from objects moved between layers', async () => {
    const t = setup();
    await t.bus.script(['LAYMCUR']);
    await t.bus.pick(t.on(DOORS));
    expect(t.current()).toBe('DOORS');
    await t.bus.script(['LAYCUR']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    await t.bus.script(['LAYERP']);
    expect(t.current()).toBe('WALLS');
    // Only one set: LAYCUR changed objects, not layer settings.
    await t.bus.script(['LAYERP']);
    expect(t.log.at(-1)).toBe('No previous layer state to restore.');
  });

  it('keeps every layer change a LAYOFF made with Undo in it as one set', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['']);
    await t.bus.script(['LAYERP']);
    expect([t.lay(DOORS).on, t.lay(NOTES).on]).toEqual([true, true]);
  });

  it('restores properties but not the name of a renamed layer; new layers stay, deleted ones stay gone', async () => {
    const s = new EngineSession(init());
    expect(
      s.edit({ kind: 'layer', layer: DOORS, name: 'Openings', color: { kind: 'aci', index: 1 } })
        .ok,
    ).toBe(true);
    expect(s.edit({ kind: 'layer-new' }).ok).toBe(true);
    expect(s.edit({ kind: 'layer-new' }).ok).toBe(true);
    const made = [...s.model.tables.layers.values()].filter((l) => /^Layer\d$/.test(l.name));
    expect(made.map((l) => l.name)).toEqual(['Layer1', 'Layer2']);
    expect(s.edit({ kind: 'layer', layer: made[1]!.handle, locked: true }).ok).toBe(true);
    expect(s.edit({ kind: 'layer-delete', layers: [made[1]!.handle] }).ok).toBe(true);
    const count = s.model.tables.layers.size;
    // The newest set names a deleted layer: nothing to put back but it is used up.
    await s.command({ kind: 'submit', text: 'LAYERP' });
    expect(s.model.tables.layers.has(made[1]!.handle)).toBe(false);
    await s.command({ kind: 'submit', text: 'LAYERP' });
    const doors = s.model.tables.layers.get(DOORS)!;
    expect(doors.name).toBe('Openings');
    expect(doors.color).toEqual(layer(DOORS, 'DOORS').color);
    expect(s.model.tables.layers.size).toBe(count);
  });

  it('puts back a renamed current layer without making another current', async () => {
    const s = new EngineSession(init());
    s.edit({ kind: 'layer', layer: WALLS, name: 'Walls-new', locked: true });
    expect(s.model.header.get('$CLAYER')).toBe('Walls-new');
    await s.command({ kind: 'submit', text: 'LAYERP' });
    expect(s.model.header.get('$CLAYER')).toBe('Walls-new');
    expect(s.model.tables.layers.get(WALLS)!.locked).toBe(false);
  });

  it('never freezes the layer it leaves current', async () => {
    const t = setup();
    await t.bus.script(['LAYFRZ']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.script(['LAYTHW']);
    await t.bus.script(['LAYMCUR']);
    await t.bus.pick(t.on(DOORS));
    // LAYMCUR's set first (WALLS current again), then LAYTHW's (DOORS frozen again).
    await t.bus.script(['LAYERP']);
    expect(t.current()).toBe('WALLS');
    await t.bus.script(['LAYERP']);
    expect(t.lay(DOORS).frozen).toBe(true);
    // DOORS made current outside any step, then LAYTHW's set put back: DOORS stays thawed.
    const u = setup();
    await u.bus.script(['LAYFRZ']);
    await u.bus.pick(u.on(DOORS));
    await u.bus.script(['', 'LAYTHW']);
    const b = new ChangeSetBuilder(u.model);
    b.setHeader('$CLAYER', 'DOORS');
    u.model.apply(b.build());
    await u.bus.script(['LAYERP']);
    expect([u.current(), u.lay(DOORS).frozen]).toEqual(['DOORS', false]);
  });
});

describe('LAYERP sets', () => {
  it('puts back a LAYISO, layers and current layer together', async () => {
    const t = setup();
    await t.bus.script(['LAYISO']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    expect(t.current()).toBe('DOORS');
    expect(t.lay(NOTES).locked).toBe(true);
    await t.bus.script(['LAYERP']);
    expect(t.current()).toBe('WALLS');
    expect(LAYERS.map((h) => t.lay(h).locked)).toEqual([false, false, false, false]);
  });

  it('leaves a setting already as the set has it (undone with U since)', async () => {
    const t = setup();
    await t.bus.script(['LAYOFF']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['', 'U']);
    expect(t.lay(DOORS).on).toBe(true);
    const steps = t.bus.undo.state.undoable;
    await t.bus.script(['LAYERP']);
    expect(t.log.at(-1)).toBe('Restored previous layer state.');
    expect(t.bus.undo.state.undoable).toBe(steps);
  });
});

describe('LAYERPMODE', () => {
  it('turns tracking off (forgetting what was tracked) and on again', async () => {
    const t = setup();
    await t.bus.script(['LAYLCK']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['LAYERPMODE']);
    expect(t.bus.promptText).toBe('Enter LAYERP mode [ON/OFF] <ON>:');
    await t.bus.script(['OFF']);
    expect(t.log).toContain('*LAYERP mode is OFF*');
    await t.bus.script(['LAYERP']);
    expect(t.log.at(-1)).toBe('LAYERP is off. Turn it on with LAYERPMODE.');
    // Not tracked while off.
    await t.bus.script(['LAYLCK']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['LAYERPMODE']);
    expect(t.bus.promptText).toBe('Enter LAYERP mode [ON/OFF] <OFF>:');
    await t.bus.script(['ON']);
    await t.bus.script(['LAYERP']);
    expect(t.log.at(-1)).toBe('No previous layer state to restore.');
    expect(t.lay(DOORS).locked).toBe(true);
  });
});
