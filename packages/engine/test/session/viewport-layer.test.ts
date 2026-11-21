// M6-02 part 8: the Layer Properties Manager's VP columns while a layout viewport is current
// (AutoCAD 2024 Help, "Layer Properties Manager": VP Freeze "Freezes selected layer in the
// current layout viewport", VP Color, VP Linetype, VP Lineweight and VP Transparency "set an
// override ... for the active layout viewport"), and the filter menu's Viewport (Freeze, Thaw)
// and Isolate Group's Active Viewport Only, which act in that viewport. One LAYER step each.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  layerFilterNamed,
  viewportLayers,
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
const layerOf = (s: EngineSession, h: string) => s.model.tables.layers.get(h)!;
const frozenIn = (s: EngineSession, vp: string) =>
  (s.model.entityByHandle(vp) as Entity & { geom: ViewportGeometry }).geom.frozenLayers;
const RED = { kind: 'aci', index: 1 } as const;

describe("the manager's VP columns in the viewport made current", () => {
  it('VP Freeze freezes and thaws the layers in that viewport only, the current layer too', async () => {
    const s = new EngineSession(vpInit());
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: [LAYER_0, LAYER_WALLS],
        viewport: VP_A,
        frozen: true,
      }),
    );
    // VPLAYER freezes the current layer in a viewport too: only the layer's own Freeze refuses it.
    expect(frozenIn(s, VP_A)).toEqual([LAYER_0, LAYER_WALLS]);
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS]);
    expect(layerOf(s, LAYER_0).frozen).toBe(false);
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_DOORS, viewport: VP_B, frozen: false }));
    expect(frozenIn(s, VP_B)).toEqual([]);
    await undo(s);
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS]);
    await undo(s);
    expect(frozenIn(s, VP_A)).toEqual([]);
  });

  it('VP Color, Linetype, Lineweight and Transparency override the layers there, as one step', async () => {
    const s = new EngineSession(vpInit());
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: [LAYER_WALLS, LAYER_DOORS],
        viewport: VP_A,
        color: RED,
      }),
    );
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, linetype: DASHED }));
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, lineweight: 50 }));
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_A,
        transparency: { alpha: 128 },
      }),
    );
    expect(layerOf(s, LAYER_WALLS).viewportOverrides).toEqual([
      {
        viewport: VP_A,
        color: RED,
        linetype: DASHED,
        lineweight: 50,
        transparency: { alpha: 128 },
      },
    ]);
    expect(layerOf(s, LAYER_DOORS).viewportOverrides).toEqual([{ viewport: VP_A, color: RED }]);
    // The layer itself keeps its own values; the viewport shows the override.
    expect(layerOf(s, LAYER_WALLS).color).toEqual({ kind: 'aci', index: 7 });
    expect(viewportLayers(s.model.tables.layers, VP_A)?.layers.get(LAYER_WALLS)?.color).toEqual(
      RED,
    );
    expect(viewportLayers(s.model.tables.layers, VP_B)).toBeUndefined();
    expect(s.undoState.nextUndo).toBe('LAYER');
    // The manager's LAYER steps one after another are one step (UNDO Control Layer, on by default).
    await undo(s);
    expect(layerOf(s, LAYER_WALLS).viewportOverrides).toBeUndefined();
  });

  it("a VP value set back to the layer's own removes that override, and the entry with the last", () => {
    const s = new EngineSession(vpInit());
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_A,
        color: RED,
        lineweight: 50,
      }),
    );
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_B, color: RED }));
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_A,
        color: { kind: 'aci', index: 7 },
      }),
    );
    expect(layerOf(s, LAYER_WALLS).viewportOverrides).toEqual([
      { viewport: VP_A, lineweight: 50 },
      { viewport: VP_B, color: RED },
    ]);
    ok(
      s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, lineweight: 'Default' }),
    );
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_B,
        color: { kind: 'aci', index: 7 },
      }),
    );
    expect(layerOf(s, LAYER_WALLS).viewportOverrides).toBeUndefined();
  });

  it('a value the viewport has already is no step; the sheet itself and unknown handles are refused', () => {
    const s = new EngineSession(vpInit());
    const before = s.undoState.undoable;
    expect(
      s.edit({ kind: 'viewport-layer', layer: LAYER_DOORS, viewport: VP_B, frozen: true }),
    ).toEqual({ ok: true, change: {} });
    expect(s.undoState.undoable).toBe(before);
    expect(
      s.edit({ kind: 'viewport-layer', layer: LAYER_0, viewport: SHEET_VP, frozen: true }),
    ).toEqual({
      ok: false,
      message: `No layout viewport ${SHEET_VP}.`,
    });
    expect(s.edit({ kind: 'viewport-layer', layer: '999', viewport: VP_A, color: RED })).toEqual({
      ok: false,
      message: 'No layer 999.',
    });
  });
});

describe("the filter menu's Viewport items in the viewport made current", () => {
  function withGroup(): EngineSession {
    const s = new EngineSession(vpInit());
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
  const g = (s: EngineSession) => layerFilterNamed(s.model, 'G')!.handle;

  it("Viewport Freeze and Thaw freeze and thaw the node's layers in that viewport", async () => {
    const s = withGroup();
    ok(s.edit({ kind: 'layer-filter-viewport', node: g(s), viewport: VP_A, frozen: true }));
    expect(frozenIn(s, VP_A)).toEqual([LAYER_0, LAYER_DOORS]);
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS]);
    ok(s.edit({ kind: 'layer-filter-viewport', node: 'all', viewport: VP_B, frozen: false }));
    expect(frozenIn(s, VP_B)).toEqual([]);
    await undo(s);
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS]);
  });

  it('Isolate Group Active Viewport Only freezes the other layers in that viewport only', () => {
    const s = withGroup();
    ok(s.edit({ kind: 'layer-filter-isolate', node: g(s), space: PAPER_SPACE, viewport: VP_B }));
    expect(frozenIn(s, VP_A)).toEqual([]);
    // The layers in the filter keep their settings (Doors stays frozen there).
    expect(frozenIn(s, VP_B)).toEqual([LAYER_DOORS, LAYER_WALLS]);
    expect(
      s.edit({ kind: 'layer-filter-viewport', node: 'all', viewport: SHEET_VP, frozen: true }),
    ).toEqual({
      ok: false,
      message: `No layout viewport ${SHEET_VP}.`,
    });
  });
});
