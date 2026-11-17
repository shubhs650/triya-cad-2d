// M5-07 part 1: named layer states (the Layer States Manager), as the engine session applies
// them. New saves every layer's settings and the current layer; Restore sets back what the
// state's "Layer properties to restore" check, makes its current layer current and, asked to,
// turns off the layers it does not name; Delete, Edit and Rename change the list; Import takes a
// `.las` file's state. Each is one LAYERSTATE undo step.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  LAYER_STATE_MASK,
  layerStateDictionary,
  layerStateMatches,
  layerStateNamed,
  layerStates,
  type DocumentInit,
  type LayerRecord,
  type LayerState,
  type LayerStateInit,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, layer, linetype, sampleInit } from '../model/fixtures';

const LAYER_DOORS = '12';
const DASHED = '16';
const STATES = '50';
const SAVED = '51';

function statesInit(withDictionary = true): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    meta: { ...init.meta, ...(withDictionary ? { layerStateDictionary: STATES } : {}) },
    tables: {
      ...init.tables,
      layers: [...init.tables!.layers!, layer(LAYER_DOORS, 'Doors')],
      linetypes: [...init.tables!.linetypes!, linetype(DASHED, 'DASHED')],
    },
    passthrough: [...(init.passthrough ?? []), ...(withDictionary ? [STATES] : [])],
  };
}

const layerOf = (s: EngineSession, h: string): LayerRecord => s.model.tables.layers.get(h)!;
const stateOf = (s: EngineSession, name: string): LayerState => layerStateNamed(s.model, name)!;

function edited(s: EngineSession, h: string, patch: Partial<LayerRecord>): void {
  const r = s.edit({ kind: 'layer', layer: h, ...patch } as never);
  expect(r).toMatchObject({ ok: true });
}

describe('layer states (M5-07)', () => {
  it('New saves every layer and the current layer in ACAD_LAYERSTATES, one LAYERSTATE step', () => {
    const s = new EngineSession(statesInit());
    edited(s, LAYER_DOORS, { frozen: true, color: { kind: 'aci', index: 1 }, linetype: DASHED });
    const r = s.edit({ kind: 'layer-state-save', name: 'Plan', description: 'For plotting' });
    expect(r.ok).toBe(true);
    expect(s.undoState.nextUndo).toBe('LAYERSTATE');
    const st = stateOf(s, 'plan');
    expect(st).toMatchObject({
      type: 'LAYER_STATE',
      owner: STATES,
      name: 'Plan',
      description: 'For plotting',
      mask: LAYER_STATE_MASK.all,
      paperSpace: false,
      currentLayer: 'WALLS',
    });
    expect(st.layers.map((l) => l.name)).toEqual(['0', 'WALLS', 'Doors']);
    expect(st.layers[2]).toEqual({
      layer: LAYER_DOORS,
      name: 'Doors',
      on: true,
      frozen: true,
      locked: false,
      plot: true,
      newVpFrozen: false,
      vpFrozen: false,
      color: { kind: 'aci', index: 1 },
      linetype: DASHED,
      linetypeName: 'DASHED',
      lineweight: layerOf(s, LAYER_DOORS).lineweight,
      plotStyle: 'Color_1',
      transparency: layerOf(s, LAYER_DOORS).transparency,
    });
    expect(layerStates(s.model).map((x) => x.name)).toEqual(['Plan']);
  });

  it('Restore sets the layers and the current layer back, and Undo takes it back', async () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'Plan' });
    const plan = stateOf(s, 'Plan').handle;
    edited(s, LAYER_DOORS, { on: false, locked: true, color: { kind: 'aci', index: 3 } });
    edited(s, LAYER_0, { frozen: true, linetype: DASHED, transparency: { alpha: 76 } });
    s.edit({ kind: 'layer-current', layer: LAYER_DOORS });
    const r = s.edit({ kind: 'layer-state-restore', state: plan });
    expect(r.ok).toBe(true);
    expect(layerOf(s, LAYER_DOORS)).toMatchObject({ on: true, locked: false });
    expect(layerOf(s, LAYER_DOORS).color).toEqual({ kind: 'aci', index: 7 });
    expect(layerOf(s, LAYER_0)).toMatchObject({ frozen: false, linetype: '14' });
    expect(layerOf(s, LAYER_0).transparency).toEqual(statesInit().tables!.layers![0]!.transparency);
    expect(s.model.header.get('$CLAYER')).toBe('WALLS');
    expect(s.undoState.nextUndo).toBe('LAYERSTATE');
    await s.command({ kind: 'submit', text: 'U' });
    expect(layerOf(s, LAYER_DOORS).on).toBe(false);
    expect(s.model.header.get('$CLAYER')).toBe('Doors');
  });

  it('restores only the properties checked under Layer properties to restore', () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'Visibility', mask: LAYER_STATE_MASK.on });
    edited(s, LAYER_DOORS, { on: false, color: { kind: 'aci', index: 3 } });
    s.edit({ kind: 'layer-state-restore', state: stateOf(s, 'Visibility').handle });
    expect(layerOf(s, LAYER_DOORS).on).toBe(true);
    expect(layerOf(s, LAYER_DOORS).color).toEqual({ kind: 'aci', index: 3 });
  });

  it('turns off layers the state does not name when asked, and never freezes the current layer', () => {
    const s = new EngineSession(statesInit());
    edited(s, LAYER_DOORS, { frozen: true });
    s.edit({ kind: 'layer-state-save', name: 'Doors frozen' });
    const st = stateOf(s, 'Doors frozen').handle;
    s.edit({ kind: 'layer-new', name: 'Later' });
    edited(s, LAYER_DOORS, { frozen: false });
    s.edit({ kind: 'layer-current', layer: LAYER_DOORS });
    // The state's current layer is WALLS, so Doors may be frozen again.
    s.edit({ kind: 'layer-state-restore', state: st, turnOffMissing: true });
    const later = [...s.model.tables.layers.values()].find((l) => l.name === 'Later')!;
    expect(later.on).toBe(false);
    expect(layerOf(s, LAYER_DOORS).frozen).toBe(true);
    expect(s.model.header.get('$CLAYER')).toBe('WALLS');
    // A state whose current layer the drawing lacks keeps the current layer, never frozen.
    const elsewhere = {
      ...stateOf(s, 'Doors frozen'),
      name: 'Elsewhere',
      currentLayer: 'Gone',
    } as LayerStateInit;
    s.edit({ kind: 'layer-state-import', state: elsewhere });
    edited(s, LAYER_DOORS, { frozen: false });
    s.edit({ kind: 'layer-current', layer: LAYER_DOORS });
    s.edit({ kind: 'layer-state-restore', state: stateOf(s, 'Elsewhere').handle });
    expect(layerOf(s, LAYER_DOORS).frozen).toBe(false);
    expect(s.model.header.get('$CLAYER')).toBe('Doors');
  });

  it('overwrites a state of the same name in place, keeping its description', () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'Plan', description: 'Kept' });
    const h = stateOf(s, 'Plan').handle;
    edited(s, LAYER_DOORS, { on: false });
    s.edit({ kind: 'layer-state-save', name: 'PLAN' });
    expect(layerStates(s.model)).toHaveLength(1);
    expect(stateOf(s, 'Plan')).toMatchObject({ handle: h, name: 'PLAN', description: 'Kept' });
    expect(stateOf(s, 'Plan').layers.find((l) => l.name === 'Doors')!.on).toBe(false);
  });

  it('renames, edits and deletes, refusing names AutoCAD refuses', () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'A' });
    s.edit({ kind: 'layer-state-save', name: 'B' });
    const a = stateOf(s, 'A').handle;
    expect(s.edit({ kind: 'layer-state-edit', state: a, name: 'b' })).toEqual({
      ok: false,
      message: 'A layer state named "B" already exists.',
    });
    expect(s.edit({ kind: 'layer-state-save', name: 'x|y' })).toMatchObject({ ok: false });
    expect(s.edit({ kind: 'layer-state-save', name: ' ' })).toMatchObject({ ok: false });
    expect(
      s.edit({ kind: 'layer-state-save', name: 'Long', description: 'd'.repeat(256) }),
    ).toMatchObject({ ok: false });
    expect(s.edit({ kind: 'layer-state-edit', state: a, mask: -1 })).toMatchObject({ ok: false });
    expect(s.edit({ kind: 'layer-state-restore', state: 'FFF' })).toMatchObject({ ok: false });
    s.edit({ kind: 'layer-state-edit', state: a, name: 'Site', description: 'Site plan' });
    expect(stateOf(s, 'Site')).toMatchObject({ handle: a, description: 'Site plan' });
    expect(s.edit({ kind: 'layer-state-edit', state: a, name: 'Site' })).toEqual({
      ok: true,
      change: {},
    });
    s.edit({ kind: 'layer-state-delete', state: a });
    expect(layerStates(s.model).map((x) => x.name)).toEqual(['B']);
    expect(s.edit({ kind: 'layer-state-delete', state: a })).toMatchObject({ ok: false });
  });

  it('imports a .las state, finding layers and linetypes by name and keeping the others', () => {
    const s = new EngineSession(statesInit());
    const entry = {
      name: 'DOORS',
      on: false,
      frozen: false,
      locked: true,
      plot: true,
      newVpFrozen: true,
      vpFrozen: false,
      color: { kind: 'rgb', r: 10, g: 20, b: 30 },
      linetypeName: 'dashed',
      lineweight: 35,
      plotStyle: 'Color_7',
      transparency: { alpha: 76 },
    } as const;
    const imported: LayerStateInit = {
      name: 'From file',
      description: '',
      mask: LAYER_STATE_MASK.all,
      paperSpace: false,
      currentLayer: 'Doors',
      layers: [entry, { ...entry, name: 'Not here', linetypeName: 'Nowhere' }],
    };
    expect(s.edit({ kind: 'layer-state-import', state: imported }).ok).toBe(true);
    expect(stateOf(s, 'From file').layers).toEqual([
      { ...entry, layer: LAYER_DOORS, linetype: DASHED },
      { ...entry, name: 'Not here', linetypeName: 'Nowhere' },
    ]);
    expect(s.edit({ kind: 'layer-state-import', state: imported })).toMatchObject({ ok: false });
    s.edit({ kind: 'layer-state-restore', state: stateOf(s, 'From file').handle });
    expect(layerOf(s, LAYER_DOORS)).toMatchObject({
      on: false,
      locked: true,
      linetype: DASHED,
      lineweight: 35,
      flags: 2,
      transparency: { alpha: 76 },
      color: { kind: 'rgb', r: 10, g: 20, b: 30 },
    });
    expect(s.model.header.get('$CLAYER')).toBe('Doors');
  });

  it('files the first state of a drawing without ACAD_LAYERSTATES in a new dictionary', () => {
    const s = new EngineSession(statesInit(false));
    expect(layerStateDictionary(s.model)).toBeUndefined();
    s.edit({ kind: 'layer-state-save', name: 'One' });
    const owner = stateOf(s, 'One').owner;
    expect(owner).not.toBe(STATES);
    expect(layerStateDictionary(s.model)).toBe(owner);
    s.edit({ kind: 'layer-state-save', name: 'Two' });
    expect(stateOf(s, 'Two').owner).toBe(owner);
  });

  it('hides view snapshots from the list, and deleting a layer drops it from each state', () => {
    const init = statesInit();
    const snapshot: LayerState = {
      handle: SAVED,
      type: 'LAYER_STATE',
      owner: STATES,
      name: 'ACAD_VIEWS_Front',
      description: '',
      mask: LAYER_STATE_MASK.hidden | LAYER_STATE_MASK.vpFrozen,
      paperSpace: false,
      currentLayer: '0',
      layers: [],
    };
    const s = new EngineSession({ ...init, objects: [...(init.objects ?? []), snapshot] });
    expect(layerStates(s.model)).toEqual([]);
    expect(layerStates(s.model, true).map((x) => x.name)).toEqual(['ACAD_VIEWS_Front']);
    s.edit({ kind: 'layer-state-save', name: 'Plan' });
    s.edit({ kind: 'layer-delete', layers: [LAYER_DOORS] });
    expect(stateOf(s, 'Plan').layers.map((l) => l.layer)).toEqual([LAYER_0, LAYER_WALLS]);
  });
});

// M5-07 part 2: what the Layer States Manager dialog needs of the engine. AutoCAD 2024 Help,
// "Layer States Manager Dialog Box": Same as DWG says whether the drawing's layers are as the
// state has them; the Layer Properties Manager names the state restored last ("last restored",
// ObjectARX LayerStateMask kLastRestored); Import asks to overwrite a state of the same name.
describe('layer states in the Layer States Manager (M5-07 part 2)', () => {
  it('marks the state restored last, one state at a time, and Undo takes the mark back', async () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'A' });
    s.edit({ kind: 'layer-state-save', name: 'B' });
    const last = (name: string) => (stateOf(s, name).mask & LAYER_STATE_MASK.lastRestored) !== 0;
    expect([last('A'), last('B')]).toEqual([false, false]);
    s.edit({ kind: 'layer-state-restore', state: stateOf(s, 'A').handle });
    expect([last('A'), last('B')]).toEqual([true, false]);
    s.edit({ kind: 'layer-state-restore', state: stateOf(s, 'B').handle });
    expect([last('A'), last('B')]).toEqual([false, true]);
    expect(s.undoState.nextUndo).toBe('LAYERSTATE');
    await s.command({ kind: 'submit', text: 'U' });
    expect([last('A'), last('B')]).toEqual([true, false]);
    // Saving over a state (New with its name, Update) keeps its mark: it is the state's own.
    s.edit({ kind: 'layer-state-save', name: 'A' });
    expect([last('A'), last('B')]).toEqual([true, false]);
    s.edit({ kind: 'layer-state-save', name: 'A', mask: LAYER_STATE_MASK.on });
    expect(stateOf(s, 'A').mask).toBe(LAYER_STATE_MASK.on | LAYER_STATE_MASK.lastRestored);
  });

  it('says whether the layers are as a state has them, under what it restores', () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'Plan' });
    s.edit({ kind: 'layer-state-save', name: 'Colours', mask: LAYER_STATE_MASK.color });
    const same = (name: string) => layerStateMatches(s.model, stateOf(s, name));
    expect([same('Plan'), same('Colours')]).toEqual([true, true]);
    edited(s, LAYER_DOORS, { on: false });
    expect([same('Plan'), same('Colours')]).toEqual([false, true]);
    edited(s, LAYER_DOORS, { on: true, linetype: DASHED });
    expect([same('Plan'), same('Colours')]).toEqual([false, true]);
    edited(s, LAYER_DOORS, { linetype: statesInit().tables!.layers![2]!.linetype });
    expect(same('Plan')).toBe(true);
    edited(s, LAYER_WALLS, { color: { kind: 'aci', index: 3 } });
    expect([same('Plan'), same('Colours')]).toEqual([false, false]);
    // A layer added since, which the state does not name, does not count.
    s.edit({ kind: 'layer-state-save', name: 'Plan' });
    s.edit({ kind: 'layer-new', name: 'Later' });
    expect(same('Plan')).toBe(true);
  });

  it('imports over a state of the same name when asked to, as one step', async () => {
    const s = new EngineSession(statesInit());
    s.edit({ kind: 'layer-state-save', name: 'Plan', description: 'Mine' });
    const old = stateOf(s, 'Plan').handle;
    const imported: LayerStateInit = {
      name: 'PLAN',
      description: 'From the file',
      mask: LAYER_STATE_MASK.on,
      paperSpace: false,
      currentLayer: '0',
      layers: [],
    };
    expect(s.edit({ kind: 'layer-state-import', state: imported })).toMatchObject({ ok: false });
    expect(s.edit({ kind: 'layer-state-import', state: imported, replace: true }).ok).toBe(true);
    expect(layerStates(s.model).map((x) => [x.name, x.description])).toEqual([
      ['PLAN', 'From the file'],
    ]);
    expect(s.model.objects.has(old)).toBe(false);
    await s.command({ kind: 'submit', text: 'U' });
    expect(stateOf(s, 'Plan')).toMatchObject({ handle: old, description: 'Mine' });
  });
});
