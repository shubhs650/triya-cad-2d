// M6-07: a layer's plot style overridden in a layout viewport (AutoCAD 2024 Help, "Layer
// Properties Manager": VP Plot Style "sets an override for the plot style ... for the active
// layout viewport"; "VPLAYER (Command)": PStyle "Sets an override for the plot style assigned to a
// layer. ... not available if you are using color-dependent plot styles"). The override is a
// named plot style of ACAD_PLOTSTYLENAME, so only a drawing with named plot styles ($PSTYLEMODE 0)
// takes one; the viewport's layers carry it to the plot.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  colorPlotStyleName,
  layerPlotStyle,
  layerStateNamed,
  viewportLayers,
  viewportOverrideLayers,
  type DocumentInit,
  type ViewHost,
  type ViewportGeometry,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  PAPER_SPACE,
  entityInit,
  layer,
  record,
  sampleInit,
} from '../model/fixtures';

const LAYER_DOORS = '12';
const NORMAL = '80';
const HEAVY = '81';
const LIGHT = '82';
const SHEET_VP = '60';
const VP_A = '61';
const VP_B = '62';

const viewport = (id: number): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100 * id, y: 100 },
  width: 80,
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
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
});

/** WALLS plots by Heavy, Doors names no plot style (Normal); two floating viewports. */
function init(named = true): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ['$PSTYLEMODE', named ? 0 : 1]]),
    tables: {
      ...base.tables,
      plotStyles: [record(NORMAL, 'Normal'), record(HEAVY, 'Heavy'), record(LIGHT, 'Light')],
      layers: base
        .tables!.layers!.map((l) => (l.handle === LAYER_WALLS ? { ...l, plotStyle: HEAVY } : l))
        .concat([layer(LAYER_DOORS, 'Doors')]),
    },
    entities: [
      ...base.entities!,
      entityInit(SHEET_VP, { ...viewport(1), flags: 557088 }, { owner: PAPER_SPACE }),
      entityInit(VP_A, viewport(2), { owner: PAPER_SPACE }),
      entityInit(VP_B, viewport(3), { owner: PAPER_SPACE }),
    ],
  };
}

const ok = (r: { ok: boolean; message?: string }) => expect(r).toMatchObject({ ok: true });
const undo = (s: EngineSession) => s.command({ kind: 'submit', text: 'U' });
const overrides = (m: DocumentModel, h: string) => m.tables.layers.get(h)!.viewportOverrides;

describe('VP Plot Style in the viewport made current (M6-07)', () => {
  it('overrides the layers’ plot style there, one LAYER step; the plot reads it', async () => {
    const s = new EngineSession(init());
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: [LAYER_WALLS, LAYER_DOORS],
        viewport: VP_A,
        plotStyle: LIGHT,
      }),
    );
    expect(overrides(s.model, LAYER_WALLS)).toEqual([{ viewport: VP_A, plotStyle: LIGHT }]);
    expect(overrides(s.model, LAYER_DOORS)).toEqual([{ viewport: VP_A, plotStyle: LIGHT }]);
    // The layer keeps its own; the viewport's layers (what the plot of it reads) carry Light.
    expect(s.model.tables.layers.get(LAYER_WALLS)!.plotStyle).toBe(HEAVY);
    const shown = viewportLayers(s.model.tables.layers, VP_A)!;
    expect(shown.layers.get(LAYER_WALLS)!.plotStyle).toBe(LIGHT);
    expect(viewportLayers(s.model.tables.layers, VP_B)).toBeUndefined();
    // The Viewport Overrides node lists them.
    expect(viewportOverrideLayers(s.model.tables.layers.values(), VP_A).map((l) => l.name)).toEqual(
      ['WALLS', 'Doors'],
    );
    expect(s.undoState.nextUndo).toBe('LAYER');
    await undo(s);
    expect(overrides(s.model, LAYER_WALLS)).toBeUndefined();
  });

  it("set back to the layer's own plot style, the override goes; Normal is a layer's own when it names none", () => {
    const s = new EngineSession(init());
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, plotStyle: LIGHT }));
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_A,
        color: { kind: 'aci', index: 3 },
      }),
    );
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, plotStyle: HEAVY }));
    expect(overrides(s.model, LAYER_WALLS)).toEqual([
      { viewport: VP_A, color: { kind: 'aci', index: 3 } },
    ]);
    expect(layerPlotStyle(s.model, s.model.tables.layers.get(LAYER_DOORS)!)).toBe(NORMAL);
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_DOORS, viewport: VP_A, plotStyle: NORMAL }));
    expect(overrides(s.model, LAYER_DOORS)).toBeUndefined();
  });

  it('is refused in a colour-dependent drawing and for a plot style the drawing lacks', () => {
    const ctb = new EngineSession(init(false));
    expect(
      ctb.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, plotStyle: LIGHT }),
    ).toMatchObject({ ok: false, message: 'The drawing uses color-dependent plot styles.' });
    const s = new EngineSession(init());
    expect(
      s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_A, plotStyle: 'FF' }),
    ).toMatchObject({ ok: false, message: 'No plot style FF.' });
    expect(overrides(s.model, LAYER_WALLS)).toBeUndefined();
  });

  it('Remove Viewport Overrides For on the VP Plot Style column removes only that override', () => {
    const s = new EngineSession(init());
    ok(
      s.edit({
        kind: 'viewport-layer',
        layer: LAYER_WALLS,
        viewport: VP_A,
        plotStyle: LIGHT,
        lineweight: 50,
      }),
    );
    ok(s.edit({ kind: 'viewport-layer', layer: LAYER_WALLS, viewport: VP_B, plotStyle: LIGHT }));
    ok(
      s.edit({
        kind: 'viewport-overrides-remove',
        layers: [LAYER_WALLS],
        viewport: VP_A,
        property: 'plotStyle',
      }),
    );
    expect(overrides(s.model, LAYER_WALLS)).toEqual([
      { viewport: VP_A, lineweight: 50 },
      { viewport: VP_B, plotStyle: LIGHT },
    ]);
    ok(s.edit({ kind: 'viewport-overrides-remove', property: 'plotStyle' }));
    expect(overrides(s.model, LAYER_WALLS)).toEqual([{ viewport: VP_A, lineweight: 50 }]);
  });

  it('Apply properties as viewport overrides restores a saved plot style as an override', () => {
    const s = new EngineSession(init());
    ok(s.edit({ kind: 'layer-state-save', name: 'Light walls' }));
    const state = layerStateNamed(s.model, 'Light walls')!.handle;
    ok(s.edit({ kind: 'layer', layer: LAYER_WALLS, plotStyle: LIGHT }));
    // The state saved WALLS on Heavy; the layer is on Light now.
    ok(s.edit({ kind: 'layer-state-restore', state, viewport: VP_A, asOverrides: true }));
    expect(s.model.tables.layers.get(LAYER_WALLS)!.plotStyle).toBe(LIGHT);
    expect(overrides(s.model, LAYER_WALLS)).toEqual([{ viewport: VP_A, plotStyle: HEAVY }]);
  });

  it("names a colour-dependent layer's plot style after its colour, a true colour by its nearest ACI", () => {
    expect(colorPlotStyleName({ kind: 'aci', index: 1 })).toBe('Color_1');
    expect(colorPlotStyleName({ kind: 'rgb', r: 255, g: 0, b: 0 })).toBe('Color_1');
  });
});

describe('VPLAYER PStyle (M6-07)', () => {
  function bus(named: boolean) {
    const model = DocumentModel.create(init(named));
    const view: ViewHost = { request: () => Promise.resolve({ ok: true }) };
    const b = new PromptBus({ model, registry: builtinCommands(), view, space: () => PAPER_SPACE });
    const log: string[] = [];
    b.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    return { model, bus: b, log };
  }

  it('is offered with named plot styles only, after LWeight as AutoCAD lists it', async () => {
    const ctb = bus(false);
    await ctb.bus.script(['VPLAYER']);
    expect(ctb.bus.prompt?.options).not.toContain('PStyle');
    const t = bus(true);
    await t.bus.script(['VPLAYER']);
    expect(t.bus.prompt?.options).toEqual([
      '?',
      'Color',
      'Ltype',
      'LWeight',
      'PStyle',
      'TRansparency',
      'Freeze',
      'Thaw',
      'Reset',
      'Newfrz',
      'Vpvisdflt',
    ]);
  });

  it('overrides the layers named in the viewports chosen, ? listing the plot styles', async () => {
    const t = bus(true);
    await t.bus.script(['VPLAYER', 'PS']);
    expect(t.bus.prompt?.message).toBe('Enter plot style or');
    expect(t.bus.prompt?.options).toEqual(['?']);
    await t.bus.script(['?', 'L*']);
    expect(t.log).toContain('Light');
    expect(t.log).not.toContain('Heavy');
    await t.bus.script(['light']);
    expect(t.bus.prompt?.message).toBe(
      'Enter layer name(s) to change plot style to "Light" or <select objects>',
    );
    await t.bus.script(['WALLS,0', 'A', '']);
    expect(t.bus.command).toBeUndefined();
    expect(overrides(t.model, LAYER_WALLS)).toEqual([
      { viewport: VP_A, plotStyle: LIGHT },
      { viewport: VP_B, plotStyle: LIGHT },
    ]);
    expect(overrides(t.model, LAYER_0)).toHaveLength(2);
    expect(t.bus.undo.state.nextUndo).toBe('VPLAYER');
  });

  it('says so for a plot style the drawing lacks, and asks for an option again', async () => {
    const t = bus(true);
    await t.bus.script(['VPLAYER', 'PS', 'Bold']);
    expect(t.log).toContain('Cannot find plot style "Bold".');
    expect(t.bus.prompt?.message).toBe('Enter an option');
  });
});
