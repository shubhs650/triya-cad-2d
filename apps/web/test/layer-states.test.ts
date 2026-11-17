// M5-07 part 2: the Layer States Manager's list (Name, Space, Same as DWG, Description), read
// from the drawing as opened plus the changes applied since; the state the Layer Properties
// Manager names; the Layer Properties to Restore; Export's file name; and the dialog LAYERSTATE
// waits for.
import {
  LAYER_STATE_MASK,
  type ChangeSet,
  type DocumentInit,
  type LayerRecord,
  type LayerState,
  type LayerStateLayer,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  UNSAVED_LAYER_STATE,
  allRestoreProperties,
  currentLayerStateName,
  drawingLayerStates,
  lasFileName,
  layerStateRows,
  layerStateTables,
  layerStatesManager,
  withRestoreProperty,
} from '../src/layer-states';

const layer = (handle: string, name: string, extra: Partial<LayerRecord> = {}): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

const entry = (l: LayerRecord): LayerStateLayer => ({
  layer: l.handle,
  name: l.name,
  on: l.on,
  frozen: l.frozen,
  locked: l.locked,
  plot: l.plot,
  newVpFrozen: false,
  vpFrozen: false,
  color: l.color,
  linetype: l.linetype,
  linetypeName: 'Continuous',
  lineweight: l.lineweight,
  plotStyle: 'Color_7',
  transparency: l.transparency,
});

const WALLS = layer('10', 'Walls');
const DOORS = layer('11', 'Doors');

const state = (handle: string, name: string, more: Partial<LayerState> = {}): LayerState => ({
  handle,
  owner: '50',
  type: 'LAYER_STATE',
  name,
  description: '',
  mask: LAYER_STATE_MASK.all,
  paperSpace: false,
  currentLayer: 'Walls',
  layers: [entry(WALLS), entry(DOORS)],
  ...more,
});

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '100',
  tables: {
    layers: [WALLS, DOORS],
    linetypes: [{ handle: '14', name: 'Continuous', description: '', elements: [] } as never],
  },
  objects: [
    state('51', 'plan'),
    state('52', 'Electrical', { description: 'Lights', paperSpace: true }),
    state('53', 'ACAD_VIEWS_Front', { mask: LAYER_STATE_MASK.all | LAYER_STATE_MASK.hidden }),
  ],
};

describe('drawingLayerStates', () => {
  it('lists the states as the engine has them, by name, without view snapshots', () => {
    expect(drawingLayerStates(init, []).map((s) => s.name)).toEqual(['Electrical', 'plan']);
    const changes: ChangeSet[] = [
      { objects: { added: [state('54', 'Doors off')] } },
      { objects: { updated: [{ before: state('51', 'plan'), after: state('51', 'Site') }] } },
      { objects: { removed: [state('52', 'Electrical')] } },
    ];
    expect(drawingLayerStates(init, changes).map((s) => s.name)).toEqual(['Doors off', 'Site']);
  });
});

describe('layerStateRows', () => {
  it('shows Space, Same as DWG and Description, and the state the manager names', () => {
    const doorsOff: ChangeSet = {
      tables: { layers: { updated: [{ before: DOORS, after: { ...DOORS, on: false } }] } },
    };
    const restored: ChangeSet = {
      objects: {
        updated: [
          {
            before: state('51', 'plan'),
            after: state('51', 'plan', {
              mask: LAYER_STATE_MASK.all | LAYER_STATE_MASK.lastRestored,
            }),
          },
        ],
      },
    };
    const rowsAfter = (changes: ChangeSet[]) =>
      layerStateRows(drawingLayerStates(init, changes), layerStateTables(init, changes));

    const rows = rowsAfter([]);
    expect(rows.map((r) => [r.name, r.space, r.same, r.description])).toEqual([
      ['Electrical', 'Layout', true, 'Lights'],
      ['plan', 'Model', true, ''],
    ]);
    expect(currentLayerStateName(init, [])).toBe(UNSAVED_LAYER_STATE);

    const after = rowsAfter([restored]);
    expect(after.map((r) => r.lastRestored)).toEqual([false, true]);
    expect(currentLayerStateName(init, [restored])).toBe('plan');

    const changed = rowsAfter([restored, doorsOff]);
    expect(changed.map((r) => r.same)).toEqual([false, false]);
    expect(currentLayerStateName(init, [restored, doorsOff])).toBe(UNSAVED_LAYER_STATE);
  });
});

describe('Layer Properties to Restore', () => {
  it("sets and clears a property, keeping the state's own bits", () => {
    const own = LAYER_STATE_MASK.lastRestored;
    const m = withRestoreProperty(LAYER_STATE_MASK.all | own, LAYER_STATE_MASK.color, false);
    expect(m & LAYER_STATE_MASK.color).toBe(0);
    expect(m & own).toBe(own);
    expect(withRestoreProperty(m, LAYER_STATE_MASK.color, true)).toBe(LAYER_STATE_MASK.all | own);
    expect(allRestoreProperties(LAYER_STATE_MASK.all | own, false)).toBe(own);
    expect(allRestoreProperties(own, true)).toBe(LAYER_STATE_MASK.all | own);
  });
});

describe('lasFileName', () => {
  it("is the state's name with characters a file name refuses replaced", () => {
    expect(lasFileName('Plan')).toBe('Plan.las');
    expect(lasFileName('A?B')).toBe('A_B.las');
  });
});

describe('layerStatesManager', () => {
  it('is open on one drawing at a time and answers LAYERSTATE when it closes', async () => {
    let done = 0;
    const first = layerStatesManager.show(1).then(() => done++);
    expect(layerStatesManager.get()).toBe(1);
    const second = layerStatesManager.show(2).then(() => done++);
    await first;
    expect(done).toBe(1);
    expect(layerStatesManager.get()).toBe(2);
    layerStatesManager.close();
    await second;
    expect(done).toBe(2);
    expect(layerStatesManager.get()).toBeUndefined();
  });
});
