// M5-07 part 6: the Layer Properties Manager's filter menu on a node of the filter tree (All,
// All Used Layers or a filter): Visibility (On, Off, Thawed, Frozen) and Lock (Lock, Unlock) on
// every layer the node lists, Isolate Group (model space: the other layers turned off; a layout:
// the other layers frozen in each of its viewports) and Convert to Group Filter. One LAYER undo
// step each (the manager's steps one after another combine, UNDO Control Layer).
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  UNRECONCILED_NODE,
  XREF_NODE,
  filterNodeLayers,
  layerFilterNamed,
  unreconciledLayers,
  xrefNode,
  xrefNodeNames,
  type CommandOutput,
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
  blockRecord,
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

// M5-07 part 8: the Xref node (AutoCAD 2024 Help, "Layer Properties Manager": the tree lists
// "Xref" with a node for each external reference attached, which lists the layers it brings).
describe('the Xref node (M5-07 part 8)', () => {
  /** The host with the xref PLAN (its layers PLAN|WALLS and PLAN|DOORS) and NEST (NEST|GRID). */
  function xrefInit(): DocumentInit {
    const init = menuInit();
    const dependent = (h: string, name: string) => ({ ...layer(h, name), flags: 48 });
    return {
      ...init,
      tables: {
        ...init.tables,
        layers: [
          ...init.tables!.layers!,
          dependent('70', 'PLAN|WALLS'),
          dependent('71', 'plan|Doors'),
          dependent('72', 'NEST|GRID'),
        ],
        blockRecords: [
          ...init.tables!.blockRecords!,
          { ...blockRecord('80', 'Plan'), flags: 4 },
          { ...blockRecord('81', 'NEST'), flags: 8 },
          blockRecord('82', 'DOOR'),
        ],
      },
    };
  }

  it('names a node for each xref, by name, and lists the layers each brings', () => {
    const s = new EngineSession(xrefInit());
    expect(xrefNodeNames(s.model.tables.blockRecords.values())).toEqual(['NEST', 'Plan']);
    expect(xrefNode('Plan')).toBe('xref:Plan');
    const names = (n: string) => {
      const r = filterNodeLayers(s.model, n);
      return typeof r === 'string' ? r : r.map((l) => l.name);
    };
    expect(names(XREF_NODE)).toEqual(['PLAN|WALLS', 'plan|Doors', 'NEST|GRID']);
    expect(names(xrefNode('Plan'))).toEqual(['PLAN|WALLS', 'plan|Doors']);
    expect(names(xrefNode('NEST'))).toEqual(['NEST|GRID']);
    expect(names(xrefNode('Gone'))).toEqual([]);
  });

  it('takes Visibility, Lock and Isolate Group like any node', () => {
    const s = new EngineSession(xrefInit());
    ok(s.edit({ kind: 'layer-filter-set', node: xrefNode('Plan'), set: 'off' }));
    expect(['70', '71', '72'].map((h) => layerOf(s, h).on)).toEqual([false, false, true]);
    ok(s.edit({ kind: 'layer-filter-isolate', node: XREF_NODE }));
    expect(layerOf(s, LAYER_WALLS).on).toBe(false);
    expect(layerOf(s, '72').on).toBe(true);
  });
});

// M5-19 part 2: the Unreconciled New Layers node (AutoCAD 2024 Help, "Layer Properties Manager":
// the filter lists the new layers not yet reconciled; the layer list's Reconcile Layer "Removes
// new layers from the unreconciled layers filter"). The manager's Reconcile Layer is the `layer`
// edit with `reconcile`, one LAYER step as -LAYER rEconcile's.
describe('the Unreconciled New Layers node (M5-19 part 2)', () => {
  /** The host with the xref PLAN's layers, PLAN|DOORS and PLAN|GRID new since the last load. */
  function unreconciledInit(): DocumentInit {
    const init = menuInit();
    const dependent = (h: string, name: string, unreconciled = false) => ({
      ...layer(h, name),
      flags: 48,
      ...(unreconciled && { unreconciled: true as const }),
    });
    return {
      ...init,
      tables: {
        ...init.tables,
        layers: [
          ...init.tables!.layers!,
          dependent('70', 'PLAN|WALLS'),
          dependent('71', 'PLAN|DOORS', true),
          dependent('72', 'PLAN|GRID', true),
        ],
        blockRecords: [...init.tables!.blockRecords!, { ...blockRecord('80', 'Plan'), flags: 4 }],
      },
    };
  }
  const names = (s: EngineSession) => {
    const r = filterNodeLayers(s.model, UNRECONCILED_NODE);
    return typeof r === 'string' ? r : r.map((l) => l.name);
  };

  it('lists the unreconciled layers, in the table’s order; none in a drawing without', () => {
    expect(UNRECONCILED_NODE).toBe('unreconciled');
    const s = new EngineSession(unreconciledInit());
    expect(names(s)).toEqual(['PLAN|DOORS', 'PLAN|GRID']);
    expect(unreconciledLayers(s.model.tables.layers.values()).map((l) => l.handle)).toEqual([
      '71',
      '72',
    ]);
    expect(names(new EngineSession(menuInit()))).toEqual([]);
  });

  it('takes Visibility like any node', () => {
    const s = new EngineSession(unreconciledInit());
    ok(s.edit({ kind: 'layer-filter-set', node: UNRECONCILED_NODE, set: 'off' }));
    expect(['70', '71', '72'].map((h) => layerOf(s, h).on)).toEqual([true, false, false]);
  });

  it('Reconcile Layer takes the layers selected out of it, one LAYER step that U undoes', async () => {
    const s = new EngineSession(unreconciledInit());
    // A reconciled layer among those selected is left as it is.
    ok(s.edit({ kind: 'layer', layer: ['70', '71'], reconcile: true }));
    expect(names(s)).toEqual(['PLAN|GRID']);
    expect(layerOf(s, '70').unreconciled).toBeUndefined();
    await undo(s);
    expect(names(s)).toEqual(['PLAN|DOORS', 'PLAN|GRID']);
    ok(s.edit({ kind: 'layer', layer: ['71', '72'], reconcile: true }));
    expect(names(s)).toEqual([]);
  });
});

// M5-07 part 9: a group filter's Select Layers (AutoCAD 2024 Help, "Layer Properties Manager",
// the tree view's shortcut menu: "Add: Adds the layers of the selected objects to the group
// filter", "Replace: Replaces the layers of the selected group filter with the layers of the
// objects that are selected in the drawing"). The manager starts a "Select objects" prompt.
describe('Select Layers (M5-07 part 9)', () => {
  function setup() {
    const s = withFilters();
    const out: CommandOutput[] = [];
    s.onCommand((o) => out.push(o));
    const prompt = () => out.filter((o) => o.type === 'prompt' || o.type === 'idle').at(-1);
    const logs = () => out.flatMap((o) => (o.type === 'log' ? [o.line] : []));
    return { s, out, prompt, logs };
  }
  /** Objects selected: the circle on WALLS (21) and a line on 0 (20), by handle. */
  const select = (s: EngineSession, ...handles: string[]) =>
    s.command({
      kind: 'answer',
      answer: { kind: 'selection', ids: handles.map((h) => s.model.ids.idOf(h)!) },
    });

  it('Add asks for objects and adds their layers to the group, one LAYER step', async () => {
    const { s, prompt, logs } = setup();
    const g = filterOf(s, 'G').handle;
    // An object on a locked layer counts: its layer is taken, the object is not edited.
    ok(s.edit({ kind: 'layer', layer: LAYER_WALLS, locked: true }));
    await s.command({ kind: 'layer-filter-select', filter: g, replace: false });
    expect(prompt()).toMatchObject({ text: 'Select objects:' });
    await select(s, '21', '20');
    // Layer 0 is in the group already: only WALLS joins, after the group's own layers.
    expect(filterOf(s, 'G').layers).toEqual([LAYER_0, LAYER_DOORS, LAYER_WALLS]);
    expect(logs()).toContain('1 layer added to group filter "G".');
    expect(s.undoState.nextUndo).toBe('LAYER');
    // Enter at Command: does not repeat it (the manager started it, not the drafter).
    await s.command({ kind: 'submit', text: '' });
    expect(prompt()).not.toMatchObject({ text: 'Select objects:' });
    await s.command({ kind: 'cancel' });
    await undo(s);
    expect(filterOf(s, 'G').layers).toEqual([LAYER_0, LAYER_DOORS]);
  });

  it('Replace makes the layers of the objects selected the group’s', async () => {
    const { s, logs } = setup();
    const g = filterOf(s, 'G').handle;
    await s.command({ kind: 'layer-filter-select', filter: g, replace: true });
    await select(s, '21');
    expect(filterOf(s, 'G').layers).toEqual([LAYER_WALLS]);
    expect(logs()).toContain('Group filter "G" now lists 1 layer.');
  });

  it('changes nothing when no object is selected, or on Esc', async () => {
    const { s, out, prompt } = setup();
    const g = filterOf(s, 'G').handle;
    // A command running is cancelled first, as a menu's command is started.
    await s.command({ kind: 'submit', text: 'LINE' });
    await s.command({ kind: 'layer-filter-select', filter: g, replace: true });
    expect(prompt()).toMatchObject({ text: 'Select objects:' });
    await s.command({ kind: 'submit', text: '' });
    await s.command({ kind: 'layer-filter-select', filter: g, replace: true });
    await s.command({ kind: 'cancel' });
    expect(filterOf(s, 'G').layers).toEqual([LAYER_0, LAYER_DOORS]);
    expect(out.some((o) => o.type === 'change')).toBe(false);
  });

  it('refuses a property filter and a filter no longer in the drawing', async () => {
    const { s, prompt, logs } = setup();
    await s.command({
      kind: 'layer-filter-select',
      filter: filterOf(s, 'A').handle,
      replace: false,
    });
    expect(logs()).toContain('A is a property filter: only a group filter takes layers.');
    expect(prompt()).not.toMatchObject({ text: 'Select objects:' });
    await s.command({ kind: 'layer-filter-select', filter: '999', replace: false });
    expect(logs()).toContain('No layer filter 999.');
    // Deleted while the drafter selects (the manager stays open).
    const g = filterOf(s, 'G').handle;
    await s.command({ kind: 'layer-filter-select', filter: g, replace: false });
    ok(s.edit({ kind: 'layer-filter-delete', filter: g }));
    await select(s, '21');
    expect(logs().filter((l) => l === `No layer filter ${g}.`)).toHaveLength(1);
  });
});
