// M6-02 part 17: each layout viewport's own snap and grid settings. AutoCAD keeps SNAPUNIT,
// GRIDUNIT, SNAPBASE, SNAPANG, GRIDMAJOR and GRIDDISPLAY in the viewport worked in (AutoCAD 2024
// Help, each variable: "Saved in: Drawing"; DXF reference, VIEWPORT codes 13, 14, 15, 50, 61 and
// the 90 bits 262144 to 2097152): SNAP, GRID, the Drafting Settings dialog and SETVAR read and set
// them in the layout viewport made current, in a layout's paper-space viewport (id 1) on paper,
// and in model space's `*Active` VPORT on the Model tab, as before.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT_SNAP_GRID,
  DocumentModel,
  EngineSession,
  FLOATING_VIEWPORT_FLAGS,
  PAPER_VIEWPORT_FLAGS,
  PromptBus,
  VIEWPORT_GRID_DISPLAY_SHIFT,
  builtinCommands,
  snapGridHolder,
  viewportSnapGrid,
  withViewportSnapGrid,
  type BusEvent,
  type EntityGeometry,
  type ViewHost,
  type ViewReply,
  type ViewportGeometry,
  type VportRecord,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const VPORT = '29';

function vport(o: Partial<VportRecord> = {}): VportRecord {
  return {
    handle: VPORT,
    name: '*Active',
    center: { x: 0, y: 0 },
    height: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
    lowerLeft: { x: 0, y: 0 },
    upperRight: { x: 1, y: 1 },
    aspectRatio: 1,
    snapBase: { x: 0, y: 0 },
    snapSpacing: { x: 10, y: 10 },
    snapRotation: 0,
    snapOn: false,
    isometricSnap: false,
    isometricPlane: 0,
    gridSpacing: { x: 10, y: 10 },
    gridOn: false,
    gridFlags: 3,
    gridMajor: 5,
    circleZoom: 1000,
    ucsIcon: 3,
    ucs: {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      elevation: 0,
      orthographic: 0,
    },
    ...o,
  } as VportRecord;
}

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 40,
  height: 30,
  id: 2,
  status: 2,
  flags: FLOATING_VIEWPORT_FLAGS,
  viewCenter: { x: 0, y: 0 },
  viewHeight: 30,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...over,
});

/** The sheet's own viewport, A (current first) at 1 mm snap, B at 2.5. */
const SHEET = '4F';
const A = '50';
const B = '51';
const snapGrid = (snap: number, grid: number, major = 5) => ({
  snapBase: { x: 0, y: 0 },
  snapSpacing: { x: snap, y: snap },
  gridSpacing: { x: grid, y: grid },
  snapAngle: 0,
  gridMajor: major,
});
const PAPER: [string, EntityGeometry][] = [
  [
    SHEET,
    viewport({
      id: 1,
      status: 1,
      flags: PAPER_VIEWPORT_FLAGS,
      center: { x: 150, y: 100 },
      width: 300,
      height: 200,
      snapGrid: snapGrid(5, 20, 2),
    }),
  ],
  [A, viewport({ id: 2, status: 2, snapGrid: snapGrid(1, 1, 10) })],
  [
    B,
    viewport({
      id: 3,
      status: 3,
      center: { x: 200, y: 100 },
      viewHeight: 60,
      snapGrid: snapGrid(2.5, 0),
    }),
  ],
];

type Setup = { paper?: [string, EntityGeometry][]; space?: string; vport?: Partial<VportRecord> };

function initOf(o: Setup = {}) {
  const init = sampleInit();
  return {
    ...init,
    tables: { ...init.tables, vports: [vport(o.vport)] },
    entities: [
      ...(init.entities ?? []),
      ...(o.paper ?? PAPER).map(([h, g]) =>
        entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 }),
      ),
    ],
  };
}

function setup(o: Setup = {}) {
  const model = DocumentModel.create(initOf(o));
  const app: Record<string, number> = { SNAPMODE: 0, GRIDMODE: 0, SNAPTYPE: 0 };
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'sysvar') {
        if (!(r.name in app)) return Promise.resolve({ ok: false, message: 'Not here.' });
        if (r.value !== undefined) app[r.name] = r.value;
        return Promise.resolve({ ok: true, value: app[r.name]! });
      }
      return Promise.resolve(r.op === 'pick' ? { ok: true, ids: [] } : { ok: true });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    space: () => o.space ?? PAPER_SPACE,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const vp = (h: string) => model.entityByHandle(h)!.geom as ViewportGeometry;
  const active = () => model.tables.vports.get(VPORT)!;
  /** What SETVAR prints for `name` now. */
  const variable = async (name: string) => {
    await bus.script(['SETVAR', name, '']);
    return log.filter((l) => l.startsWith('Enter new value')).at(-1);
  };
  return { model, bus, log, vp, active, app, variable };
}

describe('a VIEWPORT’s own snap and grid settings', () => {
  it('reads as the VPORT names them, GRIDDISPLAY from its 90 bits', () => {
    const g = viewport({
      flags: FLOATING_VIEWPORT_FLAGS,
      snapGrid: { ...snapGrid(2, 4, 3), snapBase: { x: 1, y: 2 }, snapAngle: 0.5 },
    });
    expect(viewportSnapGrid(g)).toEqual({
      snapBase: { x: 1, y: 2 },
      snapSpacing: { x: 2, y: 2 },
      snapRotation: 0.5,
      gridSpacing: { x: 4, y: 4 },
      gridMajor: 3,
      // FLOATING_VIEWPORT_FLAGS has 262144 and 524288: beyond the limits and adaptive.
      gridFlags: 3,
      // And 32, the UCS icon shown; snap and grid off (M6-02 part 19).
      snapOn: false,
      gridOn: false,
      ucsIcon: 1,
    });
    // A viewport made without them works with AutoCAD's defaults.
    const { snapGrid: _none, ...bare } = g;
    expect(viewportSnapGrid(bare)).toMatchObject({
      snapSpacing: DEFAULT_VIEWPORT_SNAP_GRID.snapSpacing,
      gridMajor: 5,
    });
  });

  it('is set without touching the 90 flags’ other bits', () => {
    const g = withViewportSnapGrid(viewport({ flags: FLOATING_VIEWPORT_FLAGS | 16384 }), {
      gridFlags: 4,
      snapSpacing: { x: 3, y: 3 },
    });
    expect(g.flags).toBe(((FLOATING_VIEWPORT_FLAGS | 16384) & ~(15 << 18)) | (4 << 18));
    expect(VIEWPORT_GRID_DISPLAY_SHIFT).toBe(18);
    expect(g.snapGrid?.snapSpacing).toEqual({ x: 3, y: 3 });
    expect(viewportSnapGrid(g).gridFlags).toBe(4);
  });

  it('is kept where the drafter works: current viewport, paper space, else the *Active VPORT', () => {
    const { model } = setup();
    expect(snapGridHolder(model, { sheet: PAPER_SPACE, current: A })?.handle).toBe(A);
    expect(snapGridHolder(model, { sheet: PAPER_SPACE })?.handle).toBe(SHEET);
    expect(snapGridHolder(model, { sheet: MODEL_SPACE })?.handle).toBe(VPORT);
    expect(snapGridHolder(model)?.kind).toBe('vport');
    // A layout with no paper-space viewport yet (AutoCAD makes it when the layout is shown).
    const bare = setup({ paper: [[A, PAPER[1]![1]]] });
    expect(snapGridHolder(bare.model, { sheet: PAPER_SPACE })?.handle).toBe(VPORT);
  });
});

describe('SNAP, GRID, SETVAR and DSETTINGS in a layout viewport made current', () => {
  it('SNAP and GRID show and set the current viewport’s, one undo step each', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    await t.bus.submit('SNAP');
    expect(t.bus.promptText).toBe('Specify snap spacing or [ON/OFF/Aspect/Type] <1.0000>:');
    await t.bus.submit('0.5');
    expect(t.vp(A).snapGrid?.snapSpacing).toEqual({ x: 0.5, y: 0.5 });
    // Snap turned on in the viewport too (M6-02 part 19), not the status bar's own.
    expect(viewportSnapGrid(t.vp(A)).snapOn).toBe(true);
    expect(t.app['SNAPMODE']).toBe(0);
    await t.bus.script(['GRID', 'Major']);
    expect(t.bus.promptText).toContain('<10>');
    await t.bus.submit('4');
    await t.bus.script(['GRID', '2']);
    expect(t.vp(A).snapGrid).toMatchObject({ gridSpacing: { x: 2, y: 2 }, gridMajor: 4 });
    // Nothing else changed: B, the sheet's own viewport and model space's VPORT.
    expect(t.vp(B).snapGrid).toEqual(snapGrid(2.5, 0));
    expect(t.vp(SHEET).snapGrid).toEqual(snapGrid(5, 20, 2));
    expect(t.active()).toMatchObject({ snapSpacing: { x: 10, y: 10 }, gridMajor: 5 });
    expect(t.bus.undo.state.undoable).toBe(3);
    await t.bus.submit('U');
    expect(t.vp(A).snapGrid?.gridSpacing).toEqual({ x: 1, y: 1 });
  });

  it('GRID aDaptive and Limits set the viewport’s 90 bits', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    await t.bus.script(['GRID', 'D', 'Y', 'Y']);
    await t.bus.script(['GRID', 'L', 'N']);
    expect(viewportSnapGrid(t.vp(A)).gridFlags).toBe(6);
    expect(t.vp(A).flags & 0x8000).toBe(0x8000);
    expect(t.active().gridFlags).toBe(3);
  });

  it('SETVAR reads and sets SNAPUNIT, GRIDUNIT, GRIDMAJOR, GRIDDISPLAY, SNAPBASE and SNAPANG there', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    expect(await t.variable('SNAPUNIT')).toContain('<1.0000,1.0000>');
    expect(await t.variable('GRIDMAJOR')).toContain('<10>');
    await t.bus.script(['SETVAR', 'GRIDUNIT', '3,4']);
    await t.bus.script(['SETVAR', 'GRIDMAJOR', '7']);
    await t.bus.script(['SETVAR', 'GRIDDISPLAY', '1']);
    await t.bus.script(['SETVAR', 'SNAPBASE', '2,3']);
    await t.bus.script(['SETVAR', 'SNAPANG', '30']);
    expect(viewportSnapGrid(t.vp(A))).toMatchObject({
      gridSpacing: { x: 3, y: 4 },
      gridMajor: 7,
      gridFlags: 1,
      snapBase: { x: 2, y: 3 },
    });
    expect(viewportSnapGrid(t.vp(A)).snapRotation).toBeCloseTo(Math.PI / 6, 12);
    // Refused as the Snap and Grid tab refuses it.
    await t.bus.script(['SETVAR', 'GRIDMAJOR', '0']);
    await t.bus.cancel();
    expect(t.vp(A).snapGrid?.gridMajor).toBe(7);
    // Model space's VPORT keeps its own; UCSICON is the viewport's too (M6-02 part 19: 90 bit 32).
    expect(t.active()).toMatchObject({ gridSpacing: { x: 10, y: 10 }, snapRotation: 0 });
    expect(await t.variable('UCSICON')).toContain('<1>');
  });

  it('switching viewports shows the other one’s', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    expect(await t.variable('SNAPUNIT')).toContain('<1.0000,1.0000>');
    // A double click in B (model point under paper 200,100 through A is off its frame).
    await t.bus.doubleClick({ x: 200, y: 100 }, true);
    expect(await t.variable('SNAPUNIT')).toContain('<2.5000,2.5000>');
  });

  it('the Drafting Settings dialog opens with the viewport’s and OK sets them there', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    await t.bus.submit('DSETTINGS');
    expect(t.bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: {
        snapGrid: {
          snapSpacing: { x: 1, y: 1 },
          gridSpacing: { x: 1, y: 1 },
          gridMajor: 10,
          gridDisplay: 3,
        },
      },
    });
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      snapGrid: { snapSpacing: { x: 2, y: 2 }, gridSpacing: { x: 0, y: 0 }, gridMajor: 2 },
    });
    expect(t.vp(A).snapGrid).toMatchObject({
      snapSpacing: { x: 2, y: 2 },
      gridSpacing: { x: 0, y: 0 },
      gridMajor: 2,
    });
    expect(t.bus.undo.state.undoable).toBe(1);
  });
});

describe('in paper space and on the Model tab', () => {
  it('on paper SNAP and SETVAR set the layout’s paper-space viewport’s', async () => {
    const t = setup();
    expect(await t.variable('GRIDUNIT')).toContain('<20.0000,20.0000>');
    await t.bus.script(['SNAP', '2']);
    expect(t.vp(SHEET).snapGrid?.snapSpacing).toEqual({ x: 2, y: 2 });
    expect(t.vp(A).snapGrid?.snapSpacing).toEqual({ x: 1, y: 1 });
    expect(t.active().snapSpacing).toEqual({ x: 10, y: 10 });
  });

  it('a layout with no paper-space viewport yet works with model space’s VPORT', async () => {
    const t = setup({ paper: [[A, PAPER[1]![1]]] });
    await t.bus.script(['SNAP', '2']);
    expect(t.active().snapSpacing).toEqual({ x: 2, y: 2 });
  });

  it('the Model tab keeps them in the *Active VPORT', async () => {
    const t = setup({ space: MODEL_SPACE });
    await t.bus.script(['GRID', '4']);
    expect(t.active().gridSpacing).toEqual({ x: 4, y: 4 });
    expect(t.vp(SHEET).snapGrid?.gridSpacing).toEqual({ x: 20, y: 20 });
  });
});

describe('MVIEW', () => {
  it('starts each new viewport with model space’s snap and grid settings', async () => {
    const t = setup({
      vport: { snapSpacing: { x: 0.5, y: 0.5 }, gridMajor: 8, gridFlags: 5 },
    });
    await t.bus.script(['MVIEW', '10,10', '50,40']);
    const made = [...t.model.entities()].filter(
      (e) => e.geom.kind === 'VIEWPORT' && ![SHEET, A, B].includes(e.handle),
    );
    expect(made).toHaveLength(1);
    expect(viewportSnapGrid(made[0]!.geom as ViewportGeometry)).toMatchObject({
      snapSpacing: { x: 0.5, y: 0.5 },
      gridMajor: 8,
      gridFlags: 5,
    });
  });
});

// M6-02 part 19: SNAPMODE, GRIDMODE and UCSICON are the viewport worked in's too (AutoCAD 2024
// Help, each "Saved in: Drawing"; DXF reference, VPORT 75, 76 and 74, VIEWPORT 90 bits 256, 512,
// 32 and 64), so each viewport has its own snap and grid on or off and its own UCS icon.
describe('SNAPMODE, GRIDMODE and UCSICON in the viewport worked in', () => {
  it('a VIEWPORT keeps them in its 90 bits, its other bits untouched', () => {
    const g = withViewportSnapGrid(viewport({ flags: FLOATING_VIEWPORT_FLAGS | 16384 }), {
      snapOn: true,
      gridOn: true,
      ucsIcon: 2,
    });
    expect(g.flags).toBe(((FLOATING_VIEWPORT_FLAGS | 16384) & ~32) | 64 | 256 | 512);
    expect(viewportSnapGrid(g)).toMatchObject({ snapOn: true, gridOn: true, ucsIcon: 2 });
    const off = withViewportSnapGrid(g, { snapOn: false, gridOn: false, ucsIcon: 1 });
    expect(off.flags).toBe(FLOATING_VIEWPORT_FLAGS | 16384);
  });

  it('SNAP and GRID ON and OFF turn the current viewport’s, the others kept', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    await t.bus.script(['GRID', 'ON']);
    await t.bus.script(['SNAP', 'ON']);
    expect(viewportSnapGrid(t.vp(A))).toMatchObject({ snapOn: true, gridOn: true });
    expect(viewportSnapGrid(t.vp(B))).toMatchObject({ snapOn: false, gridOn: false });
    expect(viewportSnapGrid(t.vp(SHEET))).toMatchObject({ snapOn: false, gridOn: false });
    expect(t.active()).toMatchObject({ snapOn: false, gridOn: false });
    expect(t.app).toMatchObject({ SNAPMODE: 0, GRIDMODE: 0 });
    // A GRID typed spacing turns it on as well, in the same undo step.
    await t.bus.doubleClick({ x: 200, y: 100 }, true);
    await t.bus.script(['GRID', '5']);
    expect(viewportSnapGrid(t.vp(B))).toMatchObject({ gridOn: true });
    await t.bus.submit('U');
    expect(viewportSnapGrid(t.vp(B))).toMatchObject({ gridOn: false });
    expect(t.vp(B).snapGrid?.gridSpacing).toEqual({ x: 0, y: 0 });
    expect(viewportSnapGrid(t.vp(A))).toMatchObject({ snapOn: true, gridOn: true });
    // ON and OFF are SNAP's and GRID's undo steps (AutoCAD's commands; F9 and F7 are not).
    await t.bus.submit('U');
    expect(viewportSnapGrid(t.vp(A))).toMatchObject({ snapOn: false, gridOn: true });
  });

  it('SETVAR reads and sets them where the drafter works', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    expect(await t.variable('GRIDMODE')).toContain('<0>');
    await t.bus.script(['SETVAR', 'GRIDMODE', '1']);
    await t.bus.script(['SETVAR', 'SNAPMODE', '1']);
    await t.bus.script(['SETVAR', 'UCSICON', '3']);
    expect(viewportSnapGrid(t.vp(A))).toMatchObject({ snapOn: true, gridOn: true, ucsIcon: 3 });
    expect(t.vp(A).flags & (32 | 64 | 256 | 512)).toBe(32 | 64 | 256 | 512);
    expect(await t.variable('GRIDMODE')).toContain('<1>');
    // On paper: the paper-space viewport's.
    await t.bus.script(['PSPACE']);
    expect(await t.variable('GRIDMODE')).toContain('<0>');
    await t.bus.script(['SETVAR', 'SNAPMODE', '1']);
    expect(viewportSnapGrid(t.vp(SHEET)).snapOn).toBe(true);
    // The Model tab: the *Active VPORT's (DXF 75, 76, 74).
    const m = setup({ space: MODEL_SPACE, vport: { gridOn: true } });
    expect(await m.variable('GRIDMODE')).toContain('<1>');
    await m.bus.script(['SETVAR', 'GRIDMODE', '0']);
    await m.bus.script(['SETVAR', 'UCSICON', '0']);
    expect(m.active()).toMatchObject({ gridOn: false, ucsIcon: 0 });
    expect(m.bus.undo.state.undoable).toBe(2);
  });

  it('a drawing with no viewport to keep them in asks the status bar’s', async () => {
    const init = sampleInit();
    const model = DocumentModel.create({ ...init, tables: { ...init.tables, vports: [] } });
    const app: Record<string, number> = { SNAPMODE: 0, GRIDMODE: 1 };
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r): Promise<ViewReply> => {
          if (r.op !== 'sysvar' || !(r.name in app)) return Promise.resolve({ ok: true });
          if (r.value !== undefined) app[r.name] = r.value;
          return Promise.resolve({ ok: true, value: app[r.name]! });
        },
      },
      space: () => MODEL_SPACE,
    });
    await bus.script(['SNAP', 'ON']);
    await bus.script(['SETVAR', 'GRIDMODE', '0']);
    expect(app).toEqual({ SNAPMODE: 1, GRIDMODE: 0 });
  });

  it('UCSICON sets the current viewport’s icon, else the paper-space viewport’s', async () => {
    const t = setup();
    await t.bus.script(['MSPACE']);
    await t.bus.script(['UCSICON', 'OFF']);
    expect(t.vp(A).flags & 32).toBe(0);
    expect(t.vp(B).flags & 32).toBe(32);
    await t.bus.script(['PSPACE']);
    await t.bus.script(['UCSICON', 'ORigin']);
    expect(viewportSnapGrid(t.vp(SHEET)).ucsIcon).toBe(3);
    expect(t.active().ucsIcon).toBe(3);
  });

  it('the status bar’s SNAP and GRID turn the viewport named, no undo step', () => {
    const session = new EngineSession(initOf());
    const model = session.model;
    expect(session.edit({ kind: 'viewport-mode', holder: B, grid: true, snap: true }).ok).toBe(
      true,
    );
    expect(viewportSnapGrid(t(model, B))).toMatchObject({ snapOn: true, gridOn: true });
    expect(session.edit({ kind: 'viewport-mode', holder: VPORT, grid: true }).ok).toBe(true);
    expect(model.tables.vports.get(VPORT)).toMatchObject({ gridOn: true, snapOn: false });
    expect(session.undoState.undoable).toBe(0);
    // Unchanged: nothing to do. Not a viewport: refused.
    expect(session.edit({ kind: 'viewport-mode', holder: B, grid: true })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.edit({ kind: 'viewport-mode', holder: 'FFFF', grid: true }).ok).toBe(false);
  });
});

const t = (model: DocumentModel, h: string) => model.entityByHandle(h)!.geom as ViewportGeometry;
