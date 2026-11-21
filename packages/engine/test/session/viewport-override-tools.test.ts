// M6-02 part 12: the Layer Properties Manager's tools for viewport overrides (AutoCAD 2024 Help,
// "Layer Properties Manager"): the layer list menu's Remove Viewport Overrides For (selected or
// all layers, the current viewport only or all viewports, one property or every one), the
// Viewport Overrides filter node (the layers the current viewport overrides), the Layer States
// Manager's VP Freeze in the current viewport and "Apply properties as viewport overrides", and
// a named view's layer snapshot keeping and restoring VP Freeze in the viewport made current.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  LAYER_STATE_MASK,
  filterNodeLayers,
  layerStateNamed,
  viewportOverridesNode,
  type DocumentInit,
  type Entity,
  type ViewportGeometry,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  PAPER_SPACE,
  entityInit,
  layer,
  linetype,
  sampleInit,
} from '../model/fixtures';

const LAYER_DOORS = '12';
const DASHED = '16';
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

function vpInit(): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    tables: {
      ...init.tables,
      layers: [...init.tables!.layers!, layer(LAYER_DOORS, 'Doors')],
      linetypes: [...init.tables!.linetypes!, linetype(DASHED, 'DASHED')],
    },
    entities: [
      ...init.entities!,
      entityInit(SHEET_VP, viewport(1), { owner: PAPER_SPACE }),
      entityInit(VP_A, viewport(2), { owner: PAPER_SPACE }),
      entityInit(VP_B, viewport(3, [LAYER_DOORS]), { owner: PAPER_SPACE }),
    ],
  };
}

const undo = (s: EngineSession) => s.command({ kind: 'submit', text: 'U' });
const ok = (r: { ok: boolean; message?: string }) => expect(r).toMatchObject({ ok: true });
const overridesOf = (s: EngineSession, h: string) =>
  s.model.tables.layers.get(h)!.viewportOverrides;
const frozenIn = (s: EngineSession, vp: string) =>
  (s.model.entityByHandle(vp) as Entity & { geom: ViewportGeometry }).geom.frozenLayers;
const RED = { kind: 'aci', index: 1 } as const;
const BLUE = { kind: 'aci', index: 5 } as const;
const WHITE = { kind: 'aci', index: 7 } as const;

/** Walls red and 0.50 mm in A, blue in B; Doors red in A. */
function overridden(): EngineSession {
  const s = new EngineSession(vpInit());
  ok(
    s.edit({
      kind: 'viewport-layer',
      layer: [LAYER_WALLS, LAYER_DOORS],
      viewport: VP_A,
      color: RED,
    }),
  );
  ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, lineweight: 50 }));
  ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_B, color: BLUE }));
  return s;
}

describe('Remove Viewport Overrides For', () => {
  it('the selected layers in the current viewport only: their overrides there go, as one step', async () => {
    const s = overridden();
    ok(s.edit({ kind: 'viewport-overrides-remove', layers: [LAYER_WALLS], viewport: VP_A }));
    expect(overridesOf(s, LAYER_WALLS)).toEqual([{ viewport: VP_B, color: BLUE }]);
    expect(overridesOf(s, LAYER_DOORS)).toEqual([{ viewport: VP_A, color: RED }]);
    expect(s.undoState.nextUndo).toBe('LAYER');
    await undo(s);
    // The manager's consecutive LAYER steps combine (UNDO Control Layer): all undone together.
    expect(overridesOf(s, LAYER_WALLS)).toBeUndefined();
  });

  it('all layers in all viewports, and all layers in the current viewport only', () => {
    const s = overridden();
    ok(s.edit({ kind: 'viewport-overrides-remove', viewport: VP_A }));
    expect(overridesOf(s, LAYER_WALLS)).toEqual([{ viewport: VP_B, color: BLUE }]);
    expect(overridesOf(s, LAYER_DOORS)).toBeUndefined();
    ok(s.edit({ kind: 'viewport-overrides-remove' }));
    expect(overridesOf(s, LAYER_WALLS)).toBeUndefined();
  });

  it('one property (the VP cell right-clicked) leaves the others', () => {
    const s = overridden();
    ok(
      s.edit({
        kind: 'viewport-overrides-remove',
        layers: [LAYER_WALLS],
        property: 'color',
      }),
    );
    // A's lineweight stays; B's entry, color only, goes with its last override.
    expect(overridesOf(s, LAYER_WALLS)).toEqual([{ viewport: VP_A, lineweight: 50 }]);
    expect(overridesOf(s, LAYER_DOORS)).toEqual([{ viewport: VP_A, color: RED }]);
  });

  it('VP Freeze is not an override; nothing to remove is no step; bad handles are refused', () => {
    const s = new EngineSession(vpInit());
    const before = s.undoState.undoable;
    expect(s.edit({ kind: 'viewport-overrides-remove', viewport: VP_B })).toEqual({
      ok: true,
      change: {},
    });
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS]);
    expect(s.undoState.undoable).toBe(before);
    expect(s.edit({ kind: 'viewport-overrides-remove', viewport: SHEET_VP })).toEqual({
      ok: false,
      message: `No layout viewport ${SHEET_VP}.`,
    });
    expect(s.edit({ kind: 'viewport-overrides-remove', layers: ['999'] })).toEqual({
      ok: false,
      message: 'No layer 999.',
    });
  });
});

describe('the Viewport Overrides filter node', () => {
  it('lists the layers the viewport overrides, for the filter menu as for the tree', () => {
    const s = overridden();
    const names = (vp: string) => {
      const listed = filterNodeLayers(s.model, viewportOverridesNode(vp));
      return typeof listed === 'string' ? listed : listed.map((l) => l.name);
    };
    expect(names(VP_A)).toEqual(['WALLS', 'Doors']);
    expect(names(VP_B)).toEqual(['WALLS']);
    // The filter menu's items act on the node's layers.
    ok(
      s.edit({
        kind: 'layer-filter-viewport',
        node: viewportOverridesNode(VP_B),
        viewport: VP_B,
        frozen: true,
      }),
    );
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS, LAYER_WALLS]);
  });
});

describe('layer states with a layout viewport current', () => {
  it("New saves VP Freeze in that viewport; Restore sets it there again, the state's space Layout", () => {
    const s = new EngineSession(vpInit());
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, frozen: true }));
    ok(s.edit({ kind: 'layer-state-save', name: 'S', viewport: VP_A }));
    const state = layerStateNamed(s.model, 'S')!;
    expect(state.paperSpace).toBe(true);
    expect(state.layers.filter((e) => e.vpFrozen).map((e) => e.name)).toEqual(['WALLS']);
    // Changed in A, then restored there.
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, frozen: false }));
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_DOORS, viewport: VP_A, frozen: true }));
    ok(s.edit({ kind: 'layer-state-restore', state: state.handle, viewport: VP_A }));
    expect(frozenIn(s, VP_A)).toEqual([LAYER_WALLS]);
    // Restored in B instead: B gets the state's VP Freeze.
    ok(s.edit({ kind: 'layer-state-restore', state: state.handle, viewport: VP_B }));
    expect(frozenIn(s, VP_B)).toEqual([LAYER_WALLS]);
  });

  it('Current VP Frozen/Thawed unchecked, a model-space state, or no viewport leave VP Freeze', () => {
    const s = new EngineSession(vpInit());
    ok(s.edit({ kind: 'layer-state-save', name: 'Model' }));
    ok(s.edit({ kind: 'layer-state-save', name: 'Unchecked', viewport: VP_A }));
    const unchecked = layerStateNamed(s.model, 'Unchecked')!;
    ok(
      s.edit({
        kind: 'layer-state-edit',
        state: unchecked.handle,
        mask: LAYER_STATE_MASK.all & ~LAYER_STATE_MASK.vpFrozen,
      }),
    );
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, frozen: true }));
    ok(s.edit({ kind: 'layer-state-restore', state: unchecked.handle, viewport: VP_A }));
    ok(
      s.edit({
        kind: 'layer-state-restore',
        state: layerStateNamed(s.model, 'Model')!.handle,
        viewport: VP_A,
      }),
    );
    ok(s.edit({ kind: 'layer-state-restore', state: unchecked.handle }));
    expect(frozenIn(s, VP_A)).toEqual([LAYER_WALLS]);
    expect(layerStateNamed(s.model, 'Model')!.paperSpace).toBe(false);
  });

  it('Apply properties as viewport overrides: the colour, linetype, lineweight, transparency go to the viewport', () => {
    const s = new EngineSession(vpInit());
    ok(
      s.edit({
        kind: 'layer',
        layer: LAYER_WALLS,
        color: RED,
        linetype: DASHED,
        lineweight: 50,
        transparency: { alpha: 128 },
      }),
    );
    ok(s.edit({ kind: 'layer-state-save', name: 'Red' }));
    ok(
      s.edit({
        kind: 'layer',
        layer: LAYER_WALLS,
        color: WHITE,
        linetype: s.model.tables.layers.get(LAYER_0)!.linetype,
        lineweight: 'Default',
        transparency: { alpha: 255 },
        on: true,
      }),
    );
    ok(s.edit({ kind: 'layer', layer: LAYER_DOORS, on: false }));
    const red = layerStateNamed(s.model, 'Red')!.handle;
    ok(s.edit({ kind: 'layer-state-restore', state: red, viewport: VP_A, asOverrides: true }));
    const walls = s.model.tables.layers.get(LAYER_WALLS)!;
    // The layer keeps its own properties; the viewport overrides them.
    expect(walls.color).toEqual(WHITE);
    expect(walls.lineweight).toBe('Default');
    expect(walls.viewportOverrides).toEqual([
      {
        viewport: VP_A,
        color: RED,
        linetype: DASHED,
        lineweight: 50,
        transparency: { alpha: 128 },
      },
    ]);
    // On/Off is not a viewport property: it is restored on the layer.
    expect(s.model.tables.layers.get(LAYER_DOORS)!.on).toBe(true);
    // Doors' own values equal the state's, so it gets no override.
    expect(overridesOf(s, LAYER_DOORS)).toBeUndefined();
  });

  it('a viewport that is not a layout viewport is refused', () => {
    const s = new EngineSession(vpInit());
    ok(s.edit({ kind: 'layer-state-save', name: 'S' }));
    const h = layerStateNamed(s.model, 'S')!.handle;
    expect(s.edit({ kind: 'layer-state-restore', state: h, viewport: SHEET_VP })).toEqual({
      ok: false,
      message: `No layout viewport ${SHEET_VP}.`,
    });
    expect(s.edit({ kind: 'layer-state-save', name: 'T', viewport: '999' })).toEqual({
      ok: false,
      message: 'No layout viewport 999.',
    });
  });
});

describe("a named view's layer snapshot in the viewport made current", () => {
  const VIEW = {
    center: { x: 0, y: 0 },
    height: 80,
    width: 100,
    paper: false,
  } as const;

  it('saved from a viewport it keeps VP Freeze there, and restored in a viewport sets it', () => {
    const s = new EngineSession(vpInit());
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, frozen: true }));
    ok(s.edit({ kind: 'view', name: 'V', view: VIEW, layers: true, viewport: VP_A }));
    const view = [...s.model.tables.views.values()].find((v) => v.name === 'V')!;
    const snapshot = layerStateNamed(s.model, view.layerState!)!;
    expect(snapshot.layers.filter((e) => e.vpFrozen).map((e) => e.name)).toEqual(['WALLS']);
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, frozen: false }));
    ok(s.edit({ kind: 'view-restore', name: 'V', viewport: VP_A }));
    expect(frozenIn(s, VP_A)).toEqual([LAYER_WALLS]);
    // Doors, thawed when the view was saved, is thawed in B when the view is restored there.
    ok(s.edit({ kind: 'view-restore', name: 'V', viewport: VP_B }));
    expect(frozenIn(s, VP_B)).toEqual([LAYER_WALLS]);
  });

  it('Update Layers from a viewport keeps its VP Freeze; restored with no viewport it is left', () => {
    const s = new EngineSession(vpInit());
    ok(s.edit({ kind: 'view', name: 'V', view: VIEW, layers: true }));
    ok(s.edit({ kind: 'view-layers', name: 'V', save: true, viewport: VP_B }));
    const view = [...s.model.tables.views.values()].find((v) => v.name === 'V')!;
    const snapshot = layerStateNamed(s.model, view.layerState!)!;
    expect(snapshot.layers.filter((e) => e.vpFrozen).map((e) => e.name)).toEqual(['Doors']);
    ok(s.edit({ kind: 'view-restore', name: 'V' }));
    expect(frozenIn(s, VP_A)).toEqual([]);
    ok(s.edit({ kind: 'view-restore', name: 'V', viewport: VP_A }));
    expect(frozenIn(s, VP_A)).toEqual([LAYER_DOORS]);
  });
});
