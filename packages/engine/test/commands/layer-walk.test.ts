// M5-06 part 4: LAYWALK and its LayerWalk dialog, as AutoCAD 2024's (AutoCAD Help, "LAYWALK
// (Command)", "LayerWalk Dialog Box"): the layers chosen in the list are shown and every other
// one hidden while the dialog is open; Always Show (held) layers stay shown; Select Objects
// chooses the layers of objects selected; Purge removes the chosen unreferenced layers; Save
// Layer State saves the layers as shown; Restore on Exit puts the layers back at Close. One
// undo step.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  layerStates,
  type BusEvent,
  type DialogRequest,
  type LayerRecord,
  type LayerWalkSettings,
} from '../../src/index';
import { entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const EMPTY = '16';
const OLD = '17';
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
  [EMPTY]: 'EMPTY',
  [OLD]: 'OLD',
};
const ALL = [L0, WALLS, DOORS, NOTES, EMPTY, OLD];

/**
 * Six layers: 0, WALLS (current), DOORS (two lines) and NOTES each hold lines (0 at y 0,
 * handle 30; WALLS y 10, 31; DOORS y 20 and 25, 32 and 36; NOTES y 30, 33); EMPTY and OLD hold
 * nothing, and OLD is off.
 */
function setup() {
  const init = sampleInit();
  const lines: [string, string, number][] = [
    ['30', L0, 0],
    ['31', WALLS, 10],
    ['32', DOORS, 20],
    ['36', DOORS, 25],
    ['33', NOTES, 30],
  ];
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ['$CLAYER', 'WALLS']]),
    tables: {
      ...init.tables,
      layers: ALL.map((h): LayerRecord => ({
        ...layer(h, NAMES[h]!),
        ...(h === OLD ? { on: false } : {}),
      })),
    },
    entities: lines.map(([h, l, y]) => entityInit(h, lineGeom(0, y, 10, y), { layer: l })),
  });
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => model) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dialog = (): Extract<DialogRequest, { type: 'laywalk' }> => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'laywalk') throw new Error('no LayerWalk');
    return p.dialog;
  };
  /** The layers on, by name, in the drawing's order. */
  const shown = () => ALL.filter((h) => model.tables.layers.get(h)?.on).map((h) => NAMES[h]);
  /** A walk step: the dialog's settings with `patch`. */
  const walk = (patch: Partial<LayerWalkSettings>, extra: object = {}) =>
    bus.answer({
      kind: 'dialog',
      action: 'apply',
      laywalk: { walk: { ...dialog().walk, ...patch }, ...extra },
    });
  const close = (patch: Partial<LayerWalkSettings> = {}) =>
    bus.answer({ kind: 'dialog', action: 'ok', laywalk: { walk: { ...dialog().walk, ...patch } } });
  return { model, bus, log, dialog, shown, walk, close };
}

describe('LAYWALK', () => {
  it('opens the LayerWalk dialog on every layer, the layers on chosen', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    const d = t.dialog();
    expect(d.layers.map((l) => l.name)).toEqual(['0', 'DOORS', 'EMPTY', 'NOTES', 'OLD', 'WALLS']);
    expect(d.layers.find((l) => l.handle === DOORS)).toMatchObject({
      objects: 2,
      referenced: true,
      purgeable: false,
    });
    expect(d.layers.find((l) => l.handle === EMPTY)).toMatchObject({
      objects: 0,
      referenced: false,
      purgeable: true,
    });
    // Layer 0 and the current layer can never be purged, objects or not.
    expect(d.layers.find((l) => l.handle === L0)?.purgeable).toBe(false);
    expect(d.layers.find((l) => l.handle === WALLS)?.purgeable).toBe(false);
    expect(new Set(d.walk.selected)).toEqual(new Set([L0, WALLS, DOORS, NOTES, EMPTY]));
    expect(d.walk).toMatchObject({ held: [], restore: true, filter: '', filterOn: false });
    // Opening shows the drawing as it was.
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
  });

  it('shows only the layers chosen, and the held ones; Restore on Exit puts them back', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [DOORS] });
    expect(t.shown()).toEqual(['DOORS']);
    expect(t.dialog().walk.selected).toEqual([DOORS]);
    await t.walk({ selected: [NOTES], held: [L0] });
    expect(t.shown()).toEqual(['0', 'NOTES']);
    // An off layer chosen is shown too.
    await t.walk({ selected: [OLD] });
    expect(t.shown()).toEqual(['0', 'OLD']);
    await t.close();
    expect(t.bus.prompt).toBeUndefined();
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
  });

  it('keeps the layers as walked when Restore on Exit is cleared, one undo step', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [DOORS] });
    await t.walk({ selected: [DOORS, NOTES] });
    await t.close({ restore: false });
    expect(t.shown()).toEqual(['DOORS', 'NOTES']);
    await t.bus.script(['U']);
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
    // The next LAYWALK opens with Restore on Exit as it was left.
    await t.bus.script(['REDO', 'LAYWALK']);
    expect(t.dialog().walk.restore).toBe(false);
  });

  it('Esc closes the dialog as Close does', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [EMPTY] });
    expect(t.shown()).toEqual(['EMPTY']);
    await t.bus.cancel();
    expect(t.bus.prompt).toBeUndefined();
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
  });

  it('Select Objects chooses the layers of the objects selected', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [L0, DOORS, NOTES] });
    await t.bus.answer({ kind: 'dialog', action: 'select', laywalk: { walk: t.dialog().walk } });
    expect(t.bus.promptText).toBe('Select objects:');
    expect(t.bus.prompt?.kind).toBe('selection');
    await t.bus.answer({
      kind: 'selection',
      ids: [t.model.ids.idOf('32')!, t.model.ids.idOf('33')!],
    });
    expect(new Set(t.dialog().walk.selected)).toEqual(new Set([DOORS, NOTES]));
    expect(t.shown()).toEqual(['DOORS', 'NOTES']);
    // Nothing selected (Enter or Esc) leaves the layers chosen as they were.
    await t.bus.answer({ kind: 'dialog', action: 'select', laywalk: { walk: t.dialog().walk } });
    await t.bus.script(['']);
    expect(new Set(t.dialog().walk.selected)).toEqual(new Set([DOORS, NOTES]));
    await t.bus.answer({ kind: 'dialog', action: 'select', laywalk: { walk: t.dialog().walk } });
    await t.bus.cancel();
    expect(new Set(t.dialog().walk.selected)).toEqual(new Set([DOORS, NOTES]));
  });

  it('Purge removes the chosen layers nothing is on, and says how many', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [EMPTY, OLD, DOORS, L0] }, { purge: true });
    expect(t.log).toContain('2 layers purged.');
    expect(t.model.tables.layers.has(EMPTY) || t.model.tables.layers.has(OLD)).toBe(false);
    expect(t.dialog().layers.map((l) => l.name)).toEqual(['0', 'DOORS', 'NOTES', 'WALLS']);
    expect(t.dialog().walk.selected).toEqual([DOORS, L0]);
    await t.walk({ selected: [DOORS] }, { purge: true });
    expect(t.dialog().note).toBe('No unreferenced layers are selected.');
    await t.close();
    // Restore on Exit cannot bring back a purged layer; U does, with the walk.
    expect(t.model.tables.layers.has(EMPTY)).toBe(false);
    await t.bus.script(['U']);
    expect(t.model.tables.layers.has(EMPTY) && t.model.tables.layers.has(OLD)).toBe(true);
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
  });

  it('Save Layer State saves the layers as shown', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    expect(t.dialog().states).toEqual([]);
    await t.walk({ selected: [DOORS] }, { saveState: { name: 'Doors only', description: 'd' } });
    expect(t.dialog().states).toEqual(['Doors only']);
    await t.close();
    const [state] = layerStates(t.model);
    expect(state).toMatchObject({ name: 'Doors only', description: 'd' });
    const on = state!.layers.filter((l) => l.on).map((l) => l.name);
    expect(on).toEqual(['DOORS']);
    // A name a layer state cannot have says why, in the dialog.
    await t.bus.script(['LAYWALK']);
    await t.walk({}, { saveState: { name: 'a<b', description: '' } });
    expect(t.dialog().note).toMatch(/name/i);
  });

  it('remembers the filters saved and the filter typed for the next LAYWALK', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ filter: 'D*,N*', filterOn: true, filters: ['D*,N*'] });
    // Filtering the list does not change what is shown.
    expect(t.shown()).toEqual(['0', 'WALLS', 'DOORS', 'NOTES', 'EMPTY']);
    await t.close();
    await t.bus.script(['LAYWALK']);
    expect(t.dialog().walk).toMatchObject({ filter: 'D*,N*', filterOn: true, filters: ['D*,N*'] });
  });

  it('ignores layers the drawing does not have', async () => {
    const t = setup();
    await t.bus.script(['LAYWALK']);
    await t.walk({ selected: [DOORS, 'FFFF'], held: ['EEEE'] });
    expect(t.dialog().walk).toMatchObject({ selected: [DOORS], held: [] });
    expect(t.shown()).toEqual(['DOORS']);
  });
});
