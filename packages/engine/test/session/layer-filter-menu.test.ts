// M5-07 part 6: the Layer Properties Manager's filter menu on a node of the filter tree (All,
// All Used Layers or a filter): Visibility (On, Off, Thawed, Frozen) and Lock (Lock, Unlock) on
// every layer the node lists, Isolate Group (model space: the other layers turned off; a layout:
// the other layers frozen in each of its viewports) and Convert to Group Filter. One LAYER undo
// step each (the manager's steps one after another combine, UNDO Control Layer).
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  filterNodeLayers,
  layerFilterNamed,
  type DocumentInit,
  type Entity,
  type LayerFilter,
  type ViewportGeometry,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  PAPER_SPACE,
  entityInit,
  layer,
  sampleInit,
} from '../model/fixtures';

const LAYER_DOORS = '12';
const LAYER_A_WIN = '13';
const LAYER_A_DIM = '15';
const FILTERS = '50';
const SHEET_VP = '60';
const VP_A = '61';
const VP_B = '62';

const viewport = (id: number, frozenLayers: string[] = []): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 100,
  height: 80,
  id,
  status: id,
  flags: 819232,
  viewCenter: { x: 0, y: 0 },
  viewHeight: 80,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers,
  plotStyleSheet: '',
  renderMode: 0,
});

function menuInit(): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    meta: { ...init.meta, layerFilterDictionary: FILTERS },
    tables: {
      ...init.tables,
      layers: [
        ...init.tables!.layers!,
        { ...layer(LAYER_DOORS, 'Doors'), frozen: true },
        { ...layer(LAYER_A_WIN, 'A-WIN'), on: false, locked: true },
        layer(LAYER_A_DIM, 'A-DIM'),
      ],
    },
    passthrough: [...(init.passthrough ?? []), FILTERS],
    entities: [
      ...init.entities!,
      entityInit(
        '25',
        { kind: 'POINT', position: { x: 1, y: 1 } },
        {
          layer: LAYER_A_DIM,
        },
      ),
      entityInit(SHEET_VP, viewport(1), { owner: PAPER_SPACE }),
      entityInit(VP_A, viewport(2), { owner: PAPER_SPACE }),
      entityInit(VP_B, viewport(3, [LAYER_DOORS]), { owner: PAPER_SPACE }),
    ],
  };
}

const undo = (s: EngineSession) => s.command({ kind: 'submit', text: 'U' });
const ok = (r: { ok: boolean; message?: string }) => expect(r).toMatchObject({ ok: true });
const filterOf = (s: EngineSession, name: string): LayerFilter => layerFilterNamed(s.model, name)!;
const layerOf = (s: EngineSession, h: string) => s.model.tables.layers.get(h)!;
const frozenIn = (s: EngineSession, vp: string) =>
  (s.model.entityByHandle(vp) as Entity & { geom: ViewportGeometry }).geom.frozenLayers;

/** A session with the property filter A* (A-WIN, A-DIM) and the group filter G (0, Doors). */
function withFilters(): EngineSession {
  const s = new EngineSession(menuInit());
  ok(s.edit({ kind: 'layer-filter-new', name: 'A', expression: 'NAME=="A*"' }));
  ok(
    s.edit({
      kind: 'layer-filter-new',
      name: 'G',
      filterType: 'group',
      layers: [LAYER_0, LAYER_DOORS],
    }),
  );
  return s;
}

describe('the filter menu (M5-07 part 6)', () => {
  it('lists the layers of All, All Used Layers and a filter', () => {
    const s = withFilters();
    const names = (n: Parameters<typeof filterNodeLayers>[1]) => {
      const r = filterNodeLayers(s.model, n);
      return typeof r === 'string' ? r : r.map((l) => l.name);
    };
    expect(names('all')).toEqual(['0', 'WALLS', 'Doors', 'A-WIN', 'A-DIM']);
    // Objects on 0 (lines, viewports), WALLS and A-DIM.
    expect(names('used')).toEqual(['0', 'WALLS', 'A-DIM']);
    expect(names(filterOf(s, 'A').handle)).toEqual(['A-WIN', 'A-DIM']);
    expect(names('999')).toBe('No layer filter 999.');
  });

  it('Visibility and Lock set every layer the node lists, as one LAYER step', async () => {
    const s = withFilters();
    const a = filterOf(s, 'A').handle;
    ok(s.edit({ kind: 'layer-filter-set', node: a, set: 'on' }));
    expect(layerOf(s, LAYER_A_WIN).on).toBe(true);
    expect(s.undoState.nextUndo).toBe('LAYER');
    ok(s.edit({ kind: 'layer-filter-set', node: a, set: 'unlock' }));
    expect(layerOf(s, LAYER_A_WIN).locked).toBe(false);
    ok(s.edit({ kind: 'layer-filter-set', node: a, set: 'lock' }));
    expect([layerOf(s, LAYER_A_WIN).locked, layerOf(s, LAYER_A_DIM).locked]).toEqual([true, true]);
    expect(layerOf(s, LAYER_WALLS).locked).toBe(false);
    ok(s.edit({ kind: 'layer-filter-set', node: 'all', set: 'off' }));
    expect([...s.model.tables.layers.values()].every((l) => !l.on)).toBe(true);
    ok(s.edit({ kind: 'layer-filter-set', node: filterOf(s, 'G').handle, set: 'thawed' }));
    expect(layerOf(s, LAYER_DOORS).frozen).toBe(false);
    await undo(s);
    expect(layerOf(s, LAYER_DOORS).frozen).toBe(true);
  });

  it('Frozen leaves the current layer thawed, and refuses a node that lists only it', () => {
    const s = withFilters();
    ok(s.edit({ kind: 'layer-filter-set', node: 'all', set: 'frozen' }));
    const frozen = [...s.model.tables.layers.values()].filter((l) => l.frozen).map((l) => l.name);
    expect(frozen).toEqual(['0', 'Doors', 'A-WIN', 'A-DIM']);
    ok(s.edit({ kind: 'layer-filter-new', name: 'W', filterType: 'group', layers: [LAYER_WALLS] }));
    expect(
      s.edit({ kind: 'layer-filter-set', node: filterOf(s, 'W').handle, set: 'frozen' }),
    ).toEqual({ ok: false, message: 'Cannot freeze the current layer.' });
  });

  it('Isolate Group in model space turns off every layer the node does not list', () => {
    const s = withFilters();
    ok(s.edit({ kind: 'layer-filter-isolate', node: filterOf(s, 'G').handle }));
    const on = [...s.model.tables.layers.values()].filter((l) => l.on).map((l) => l.name);
    // The group's own layers keep their settings (Doors stays frozen).
    expect(on).toEqual(['0', 'Doors']);
    expect(layerOf(s, LAYER_DOORS).frozen).toBe(true);
    expect(s.undoState.nextUndo).toBe('LAYER');
    ok(s.edit({ kind: 'layer-filter-isolate', node: 'all' }));
    expect(s.edit({ kind: 'layer-filter-isolate', node: 'all', space: MODEL_SPACE })).toMatchObject(
      { ok: true },
    );
  });

  it('Isolate Group in a layout freezes the other layers in each of its viewports', async () => {
    const s = withFilters();
    ok(s.edit({ kind: 'layer-filter-isolate', node: filterOf(s, 'A').handle, space: PAPER_SPACE }));
    // The sheet's own view (id 1) is not a viewport the drafter froze layers in.
    expect(frozenIn(s, SHEET_VP)).toEqual([]);
    expect(frozenIn(s, VP_A)).toEqual([LAYER_0, LAYER_WALLS, LAYER_DOORS]);
    // A layer frozen there already stays frozen once, in place.
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS, LAYER_0, LAYER_WALLS]);
    // The layers themselves are unchanged.
    expect([...s.model.tables.layers.values()].filter((l) => !l.on).map((l) => l.name)).toEqual([
      'A-WIN',
    ]);
    await undo(s);
    expect(frozenIn(s, VP_A)).toEqual([]);
  });

  it('Isolate Group refuses a layout without viewports and a node that lists no layer', () => {
    const s = new EngineSession({
      ...menuInit(),
      entities: menuInit().entities!.filter((e) => e.geom.kind !== 'VIEWPORT'),
    });
    expect(s.edit({ kind: 'layer-filter-isolate', node: 'all', space: PAPER_SPACE })).toEqual({
      ok: false,
      message: 'The layout has no viewports.',
    });
    ok(s.edit({ kind: 'layer-filter-new', name: 'None', expression: 'NAME=="X*"' }));
    expect(s.edit({ kind: 'layer-filter-isolate', node: filterOf(s, 'None').handle })).toEqual({
      ok: false,
      message: 'The filter lists no layers.',
    });
    expect(s.edit({ kind: 'layer-filter-isolate', node: 'all', space: '999' })).toEqual({
      ok: false,
      message: 'No layout 999.',
    });
  });

  it('Convert to Group Filter keeps the name, nested filters and the layers listed now', () => {
    const s = withFilters();
    const a = filterOf(s, 'A');
    ok(
      s.edit({
        kind: 'layer-filter-new',
        name: 'AW',
        expression: 'NAME=="*WIN"',
        parent: a.handle,
      }),
    );
    ok(s.edit({ kind: 'layer-filter-convert', filter: a.handle }));
    const g = filterOf(s, 'A');
    expect(g).toMatchObject({
      handle: a.handle,
      filterType: 'group',
      expression: '',
      layers: [LAYER_A_WIN, LAYER_A_DIM],
    });
    expect(filterOf(s, 'AW').parent).toBe(a.handle);
    expect(s.undoState.nextUndo).toBe('LAYER');
    // Changing a layer no longer changes the group.
    ok(s.edit({ kind: 'layer', layer: LAYER_A_DIM, name: 'DIM' }));
    expect(filterNodeLayers(s.model, a.handle)).toHaveLength(2);
  });

  it('Convert to Group Filter takes All Used Layers as the drawing has it, and refuses others', () => {
    const s = withFilters();
    ok(s.edit({ kind: 'layer-filter-new', name: 'U', expression: 'USED=="True"' }));
    ok(s.edit({ kind: 'layer-filter-convert', filter: filterOf(s, 'U').handle }));
    expect(filterOf(s, 'U').layers).toEqual([LAYER_0, LAYER_WALLS, LAYER_A_DIM]);
    expect(s.edit({ kind: 'layer-filter-convert', filter: filterOf(s, 'G').handle })).toEqual({
      ok: false,
      message: 'G is a group filter already.',
    });
    // A group filter cannot be nested in a property filter.
    const a = filterOf(s, 'A').handle;
    ok(s.edit({ kind: 'layer-filter-new', name: 'AW', expression: 'NAME=="*WIN"', parent: a }));
    expect(s.edit({ kind: 'layer-filter-convert', filter: filterOf(s, 'AW').handle })).toEqual({
      ok: false,
      message: 'A group filter cannot be nested in a property filter.',
    });
  });
});
