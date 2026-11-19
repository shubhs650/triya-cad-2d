// M5-07 part 7: a named view's layer snapshot. New View's "Save layer snapshot with view", the
// View Manager's Update Layers and Layer snapshot row save the layers' settings as a layer state
// hidden from the Layer States Manager, `ACAD_VIEWS_<view>` (mask 0x8200, as AutoCAD 2018 wrote
// sample_AC1032_ascii.dxf's), which the view names; restoring the view (the View Manager's OK and
// Apply, -VIEW Restore) restores the layers' On and Freeze settings from it.
import { describe, expect, it } from 'vitest';
import type { DocumentModel } from '../../src/index';
import {
  EngineSession,
  LAYER_STATE_MASK,
  PromptBus,
  VIEW_LAYER_STATE_MASK,
  builtinCommands,
  isLayerState,
  layerStates,
  viewLayerStateName,
  type LayerState,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, sampleInit } from '../model/fixtures';

const VIEW = { center: { x: 50, y: 25 }, height: 40, width: 80, paper: false };

const statesOf = (model: DocumentModel): LayerState[] =>
  [...model.objects.values()].filter(isLayerState);
const viewNamed = (model: DocumentModel, name: string) =>
  [...model.tables.views.values()].find((v) => v.name === name);
const walls = (model: DocumentModel) => model.tables.layers.get(LAYER_WALLS)!;

describe('a view saved with a layer snapshot', () => {
  it('keeps the layers as a hidden ACAD_VIEWS_ state the view names, one VIEW step', async () => {
    const session = new EngineSession(sampleInit());
    const r = session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    expect(r.ok).toBe(true);
    const states = statesOf(session.model);
    expect(states.map((s) => [s.name, s.mask, s.paperSpace])).toEqual([
      ['ACAD_VIEWS_Front', 0x8200, false],
    ]);
    expect(VIEW_LAYER_STATE_MASK).toBe(LAYER_STATE_MASK.hidden | LAYER_STATE_MASK.vpFrozen);
    expect(states[0]!.layers.map((l) => l.name)).toEqual(['0', 'WALLS']);
    expect(viewNamed(session.model, 'Front')?.layerState).toBe('ACAD_VIEWS_Front');
    // The Layer States Manager does not list it.
    expect(layerStates(session.model)).toEqual([]);
    expect(session.undoState.nextUndo).toBe('VIEW');
    await session.command({ kind: 'submit', text: 'U' });
    expect(statesOf(session.model)).toEqual([]);
    expect(session.model.tables.views.size).toBe(0);
  });

  it('is not saved without the check box, and a layout view’s is saved in paper space', () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Plan', view: VIEW });
    session.edit({ kind: 'view', name: 'Sheet', view: { ...VIEW, paper: true }, layers: true });
    expect(viewNamed(session.model, 'Plan')?.layerState).toBeUndefined();
    expect(statesOf(session.model).map((s) => [s.name, s.paperSpace])).toEqual([
      ['ACAD_VIEWS_Sheet', true],
    ]);
  });

  it('saved again with the box cleared loses its snapshot, and left alone keeps it', () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    // The navigation bar's Save view says nothing of layers: the snapshot stays.
    session.edit({ kind: 'view', name: 'front', view: { ...VIEW, height: 20 } });
    expect(viewNamed(session.model, 'Front')?.layerState).toBe('ACAD_VIEWS_Front');
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: false });
    expect(viewNamed(session.model, 'Front')?.layerState).toBeUndefined();
    expect(statesOf(session.model)).toEqual([]);
  });

  it('restores On and Freeze with the view, nothing else, and never freezes the current layer', async () => {
    // WALLS is the sample drawing's current layer.
    const session = new EngineSession(sampleInit());
    const zero = () => session.model.tables.layers.get(LAYER_0)!;
    session.edit({ kind: 'layer', layer: LAYER_0, frozen: true });
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    session.edit({
      kind: 'layer',
      layer: LAYER_0,
      frozen: false,
      on: false,
      color: { kind: 'aci', index: 3 },
    });
    session.edit({ kind: 'layer', layer: LAYER_WALLS, on: false });
    const before = statesOf(session.model)[0]!.mask;

    const r = session.edit({ kind: 'view-restore', name: 'FRONT' });
    expect(r.ok).toBe(true);
    expect([zero().on, zero().frozen]).toEqual([true, true]);
    expect(zero().color).toEqual({ kind: 'aci', index: 3 });
    expect(walls(session.model).on).toBe(true);
    // Not marked restored last: the manager names only the states it lists.
    expect(statesOf(session.model)[0]!.mask).toBe(before);
    expect(session.undoState.nextUndo).toBe('VIEW');
    // Nothing to change, or a view without a snapshot: no change and no undo step.
    expect(session.edit({ kind: 'view-restore', name: 'Front' })).toEqual({ ok: true, change: {} });
    session.edit({ kind: 'view', name: 'Plan', view: VIEW });
    expect(session.edit({ kind: 'view-restore', name: 'Plan' })).toEqual({ ok: true, change: {} });
    expect(session.edit({ kind: 'view-restore', name: 'Side' })).toEqual({
      ok: false,
      message: 'Cannot find view "Side".',
    });

    // The snapshot freezes 0; made current, 0 stays thawed.
    session.edit({ kind: 'layer', layer: LAYER_0, frozen: false });
    session.edit({ kind: 'layer-current', layer: LAYER_0 });
    session.edit({ kind: 'view-restore', name: 'Front' });
    expect(zero().frozen).toBe(false);
  });

  it('Update Layers saves the layers now; the Layer snapshot row’s No takes it off', () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW });
    expect(session.edit({ kind: 'view-layers', name: 'front', save: true }).ok).toBe(true);
    const first = statesOf(session.model)[0]!;
    expect(first.layers.find((l) => l.name === 'WALLS')?.on).toBe(true);
    session.edit({ kind: 'layer', layer: LAYER_WALLS, on: false });
    session.edit({ kind: 'view-layers', name: 'Front', save: true });
    const second = statesOf(session.model);
    // The same state, overwritten.
    expect(second.map((s) => s.handle)).toEqual([first.handle]);
    expect(second[0]!.layers.find((l) => l.name === 'WALLS')?.on).toBe(false);

    expect(session.edit({ kind: 'view-layers', name: 'Front', save: false }).ok).toBe(true);
    expect(viewNamed(session.model, 'Front')?.layerState).toBeUndefined();
    expect(statesOf(session.model)).toEqual([]);
    expect(session.edit({ kind: 'view-layers', name: 'Front', save: false })).toEqual({
      ok: true,
      change: {},
    });
  });

  it('is renamed with its view and deleted with it', async () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    session.edit({ kind: 'view-rename', name: 'Front', newName: 'Elevation' });
    expect(statesOf(session.model).map((s) => s.name)).toEqual([viewLayerStateName('Elevation')]);
    expect(viewNamed(session.model, 'Elevation')?.layerState).toBe('ACAD_VIEWS_Elevation');
    session.edit({ kind: 'view-delete', name: 'Elevation' });
    expect(statesOf(session.model)).toEqual([]);
    await session.command({ kind: 'submit', text: 'U' });
    expect(statesOf(session.model).map((s) => s.name)).toEqual(['ACAD_VIEWS_Elevation']);
  });

  it('a state of the drawing’s by the new name is left alone, and the snapshot keeps its own', () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    session.edit({ kind: 'layer-state-save', name: 'ACAD_VIEWS_Back' });
    session.edit({ kind: 'view-rename', name: 'Front', newName: 'Back' });
    expect(statesOf(session.model).map((s) => s.name)).toEqual([
      'ACAD_VIEWS_Front',
      'ACAD_VIEWS_Back',
    ]);
    expect(viewNamed(session.model, 'Back')?.layerState).toBe('ACAD_VIEWS_Front');
    // Deleting the view takes only its own (hidden) state.
    session.edit({ kind: 'view-delete', name: 'Back' });
    expect(statesOf(session.model).map((s) => s.name)).toEqual(['ACAD_VIEWS_Back']);
  });
});

describe('-VIEW and a layer snapshot', () => {
  function setup(answer: (r: ViewRequest) => ViewReply = () => ({ ok: true })) {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW, layers: true });
    session.edit({ kind: 'layer', layer: LAYER_WALLS, on: false });
    const model = session.model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: (r) => Promise.resolve(answer(r)) },
    });
    return { bus, model };
  }

  it('Restore restores the layers once the canvas shows the view, as part of the command', async () => {
    const { bus, model } = setup();
    await bus.script(['-VIEW', 'R', 'front']);
    expect(walls(model).on).toBe(true);
    expect(bus.undo.state.nextUndo).toBe('VIEW');
  });

  it('Restore leaves the layers when the canvas refuses the view', async () => {
    const { bus, model } = setup(() => ({ ok: false, message: 'Not a plan view.' }));
    await bus.script(['-VIEW', 'R', 'Front']);
    expect(walls(model).on).toBe(false);
  });

  it('Delete deletes the snapshot with the view', async () => {
    const { bus, model } = setup();
    await bus.script(['-VIEW', 'D', 'F*']);
    expect(model.tables.views.size).toBe(0);
    expect(statesOf(model)).toEqual([]);
  });
});
