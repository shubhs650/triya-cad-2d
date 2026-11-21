// M6-02 part 11: VPORTS opens the Viewports dialog (AutoCAD 2024 Help, "VPORTS (Command)",
// "Viewports Dialog Box") and does what its OK answers: a standard arrangement on the Model tab
// (Display or Current Viewport, a New name saving it, Change view to's named views), the
// configuration selected on Named Viewports, renames and deletes, and in a layout the same as
// layout viewports in an area asked after OK.
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MODEL_CONFIGURATION,
  DocumentModel,
  NO_MODEL_VIEWPORT,
  PromptBus,
  builtinCommands,
  spacedViewports,
  standardViewports,
  type BusEvent,
  type Entity,
  type ViewHost,
  type ViewRecord,
  type ViewReply,
  type ViewRequest,
  type ViewState,
  type ViewportGeometry,
  type ViewportsDialogChoice,
  type VportRecord,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, sampleInit } from '../model/fixtures';

function vport(handle: string, name: string, o: Partial<VportRecord> = {}): VportRecord {
  return {
    handle,
    name,
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
    aspectRatio: 2,
    snapBase: { x: 0, y: 0 },
    snapSpacing: { x: 5, y: 5 },
    snapRotation: 0,
    snapOn: false,
    isometricSnap: false,
    isometricPlane: 0,
    gridSpacing: { x: 5, y: 5 },
    gridOn: false,
    gridFlags: 0,
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

function view(handle: string, name: string, o: Partial<ViewRecord> = {}): ViewRecord {
  return {
    handle,
    name,
    center: { x: 0, y: 0 },
    height: 10,
    width: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
    ...o,
  } as ViewRecord;
}

/** Two tiles side by side (the left one current) and a saved configuration TWO of two tiles. */
const TILED: VportRecord[] = [
  vport('29', '*Active', { upperRight: { x: 0.5, y: 1 }, center: { x: 5, y: 5 }, aspectRatio: 1 }),
  vport('2A', '*Active', {
    lowerLeft: { x: 0.5, y: 0 },
    center: { x: 50, y: 50 },
    height: 20,
    aspectRatio: 1,
  }),
  vport('2B', 'Two', { upperRight: { x: 1, y: 0.5 }, center: { x: 1, y: 2 }, height: 4 }),
  vport('2C', 'TWO', { lowerLeft: { x: 0, y: 0.5 }, center: { x: 3, y: 4 }, height: 8 }),
];

/** Named views: a model view (its centre in display coordinates), a paper one and a 3D one. */
const VIEWS: ViewRecord[] = [
  view('40', 'Detail', {
    center: { x: 10, y: 0 },
    target: { x: 90, y: 20, z: 0 },
    height: 30,
    width: 120,
  }),
  view('41', 'Sheet', { flags: 1 }),
  view('42', 'Iso', { direction: { x: 1, y: -1, z: 1 } }),
];

const live = (x: number, y: number, height: number, width: number): ViewState => ({
  center: { x, y },
  height,
  width,
  paper: false,
});

interface Options {
  vports?: VportRecord[];
  space?: string;
  tiles?: { views: (ViewState | null)[]; current: number };
  /** The dialog's answer, one per VPORTS; none is Cancel. */
  choices?: (ViewportsDialogChoice | undefined)[];
}

function drawing(o: Options = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: { ...init.tables, vports: o.vports ?? TILED, views: VIEWS },
  });
  const requests: ViewRequest[] = [];
  const choices = [...(o.choices ?? [])];
  const host: ViewHost = {
    request: (r) => {
      requests.push(r);
      if (r.op === 'tiles' && o.tiles) return Promise.resolve({ ok: true, tiles: o.tiles });
      if (r.op === 'viewportsDialog') {
        const c = choices.shift();
        return Promise.resolve<ViewReply>({ ok: true, ...(c && { viewports: c }) });
      }
      return Promise.resolve({ ok: false, message: 'no view' });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host,
    space: () => o.space ?? MODEL_SPACE,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const records = () => [...model.tables.vports.values()];
  const named = (n: string) => records().filter((v) => v.name === n);
  const corners = (v: VportRecord) => [
    v.lowerLeft.x,
    v.lowerLeft.y,
    v.upperRight.x,
    v.upperRight.y,
  ];
  const dialogs = () =>
    requests.filter(
      (r): r is Extract<ViewRequest, { op: 'viewportsDialog' }> => r.op === 'viewportsDialog',
    );
  return { model, bus, log, records, named, corners, dialogs };
}

const fresh = (
  standard: string,
  o: Partial<{ name: string; applyTo: 'Display' | 'Current viewport'; spacing: number }> = {},
  views: (string | null)[] = [],
): ViewportsDialogChoice => ({
  renamed: [],
  deleted: [],
  apply: {
    tab: 'new',
    standard: standard as typeof ACTIVE_MODEL_CONFIGURATION,
    applyTo: o.applyTo ?? 'Display',
    spacing: o.spacing ?? 0,
    views,
    ...(o.name !== undefined && { name: o.name }),
  },
});

describe('the Viewports dialog’s standard arrangements', () => {
  const area = { minX: 0, minY: 0, maxX: 120, maxY: 60 };
  it('puts Four: Right’s large viewport on the right and the other three in rows', () => {
    expect(standardViewports('Four: Right', area)).toEqual([
      { minX: 60, minY: 0, maxX: 120, maxY: 60 },
      { minX: 0, minY: 40, maxX: 60, maxY: 60 },
      { minX: 0, minY: 20, maxX: 60, maxY: 40 },
      { minX: 0, minY: 0, maxX: 60, maxY: 20 },
    ]);
    expect(standardViewports('Four: Left', area)[0]).toEqual({
      minX: 0,
      minY: 0,
      maxX: 60,
      maxY: 60,
    });
    expect(standardViewports('Three: Left', area)[0]).toEqual({
      minX: 0,
      minY: 0,
      maxX: 60,
      maxY: 60,
    });
    expect(standardViewports('Two: Horizontal', area)).toHaveLength(2);
    expect(standardViewports('Single', area)).toEqual([area]);
  });

  it('leaves Viewport Spacing between viewports, none at the area’s edges', () => {
    const frames = standardViewports('Four: Equal', area);
    expect(spacedViewports(frames, area, 10)).toEqual([
      { minX: 0, minY: 35, maxX: 55, maxY: 60 },
      { minX: 65, minY: 35, maxX: 120, maxY: 60 },
      { minX: 0, minY: 0, maxX: 55, maxY: 25 },
      { minX: 65, minY: 0, maxX: 120, maxY: 25 },
    ]);
    // So much that a viewport would have no size: none.
    expect(spacedViewports(frames, area, 200)).toEqual(frames);
  });
});

describe('VPORTS on the Model tab', () => {
  it('opens the dialog with the configurations and model views, and Cancel changes nothing', async () => {
    const t = drawing({ choices: [undefined] });
    await t.bus.script(['VPORTS']);
    expect(t.bus.command).toBeUndefined();
    const [r] = t.dialogs();
    expect(r).toMatchObject({
      layout: false,
      current: '*Active',
      configurations: [
        {
          name: 'Two',
          tiles: [
            { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
            { minX: 0, minY: 0.5, maxX: 1, maxY: 1 },
          ],
        },
      ],
      active: [
        { minX: 0, minY: 0, maxX: 0.5, maxY: 1 },
        { minX: 0.5, minY: 0, maxX: 1, maxY: 1 },
      ],
      // A layout's view and a 3D one are not offered.
      views: ['Detail'],
    });
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('lists the current tile first', async () => {
    const t = drawing({ tiles: { views: [null, null], current: 1 }, choices: [undefined] });
    await t.bus.script(['VPORTS']);
    expect(t.dialogs()[0]!.active[0]).toEqual({ minX: 0.5, minY: 0, maxX: 1, maxY: 1 });
  });

  it('applies a standard arrangement to the display, saved under the New name', async () => {
    const t = drawing({
      tiles: { views: [live(5, 5, 10, 10), live(50, 50, 20, 20)], current: 0 },
      choices: [fresh('Three: Left', { name: 'Mine' }), undefined],
    });
    await t.bus.script(['VPORTS']);
    const active = t.named('*Active');
    // The first record keeps its handle and is the large viewport, the current one.
    expect(active.map((v) => v.handle).slice(0, 2)).toEqual(['29', '2A']);
    expect(active.map(t.corners)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0.5, 1, 1],
      [0.5, 0, 1, 0.5],
    ]);
    // Each starts on the current view.
    expect(active.map((v) => v.center)).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(t.named('Mine').map(t.corners)).toEqual(active.map(t.corners));
    expect(t.bus.undo.state.nextUndo).toBe('VPORTS');
    // The dialog names it the current configuration next time.
    await t.bus.script(['VPORTS']);
    expect(t.dialogs()[1]!.current).toBe('Mine');
    await t.bus.script(['U']);
    expect(t.named('Mine')).toHaveLength(0);
    expect(t.named('*Active').map(t.corners)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 1],
    ]);
  });

  it('divides only the current viewport under Apply to Current Viewport', async () => {
    const t = drawing({
      tiles: { views: [live(5, 5, 10, 10), live(50, 50, 20, 20)], current: 1 },
      choices: [fresh('Two: Horizontal', { applyTo: 'Current viewport' })],
    });
    await t.bus.script(['VPORTS']);
    const active = t.named('*Active');
    expect(active.map(t.corners)).toEqual([
      [0.5, 0.5, 1, 1],
      [0.5, 0, 1, 0.5],
      [0, 0, 0.5, 1],
    ]);
    expect(active.map((v) => v.center)).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 5, y: 5 },
    ]);
    // No New name: nothing saved.
    expect(t.records().filter((v) => v.name === 'Two')).toHaveLength(1);
  });

  it('shows the named view Change view to gives a viewport, whole', async () => {
    // The screen is twice as wide as high: each half of Two: Vertical is square.
    const t = drawing({
      vports: [vport('29', '*Active')],
      tiles: { views: [live(0, 0, 10, 20)], current: 0 },
      choices: [fresh('Two: Vertical', {}, [null, 'Detail'])],
    });
    await t.bus.script(['VPORTS']);
    const [left, right] = t.named('*Active');
    expect(left!.center).toEqual({ x: 0, y: 0 });
    expect(left!.height).toBe(10);
    // Detail is 120 × 30 about (100, 20): a square viewport 120 high shows it whole.
    expect(right!.center).toEqual({ x: 100, y: 20 });
    expect(right!.height).toBe(120);
    expect(right!.aspectRatio).toBe(1);
  });

  it('saves the current configuration as it is with *Active Model Configuration and a name', async () => {
    const t = drawing({
      tiles: { views: [live(5, 5, 10, 10), live(70, 30, 25, 25)], current: 1 },
      choices: [fresh(ACTIVE_MODEL_CONFIGURATION, { name: 'Now' })],
    });
    await t.bus.script(['VPORTS']);
    expect(t.named('*Active').map((v) => v.center)).toEqual([
      { x: 5, y: 5 },
      { x: 50, y: 50 },
    ]);
    expect(t.named('Now').map((v) => [t.corners(v), v.center])).toEqual([
      [[0.5, 0, 1, 1], { x: 70, y: 30 }],
      [[0, 0, 0.5, 1], { x: 5, y: 5 }],
    ]);
  });

  it('renames and deletes on Named Viewports, then restores the one selected', async () => {
    const t = drawing({
      vports: [...TILED, vport('2D', 'Old')],
      choices: [
        {
          renamed: [
            { from: 'two', to: 'Plan' },
            { from: 'Old', to: 'Bad|name' },
          ],
          deleted: [],
          apply: { tab: 'named', name: 'Plan' },
        },
        { renamed: [], deleted: ['old'] },
        undefined,
      ],
    });
    await t.bus.script(['VPORTS']);
    expect(t.log).toContain('Invalid viewport configuration name "Bad|name".');
    expect(t.named('Plan').map((v) => v.handle)).toEqual(['2B', '2C']);
    expect(t.named('*Active').map(t.corners)).toEqual([
      [0, 0, 1, 0.5],
      [0, 0.5, 1, 1],
    ]);
    expect(t.bus.undo.state.nextUndo).toBe('VPORTS');
    await t.bus.script(['VPORTS']);
    expect(t.named('Old')).toHaveLength(0);
    await t.bus.script(['VPORTS']);
    expect(t.dialogs()[2]!.current).toBe('Plan');
  });

  it('says so when the drawing has no model viewport', async () => {
    const t = drawing({ vports: [] });
    await t.bus.script(['VPORTS']);
    expect(t.log).toContain(NO_MODEL_VIEWPORT);
    expect(t.dialogs()).toHaveLength(0);
  });
});

describe('VPORTS in a layout', () => {
  const viewports = (model: DocumentModel) =>
    model
      .blockEntities(PAPER_SPACE)
      .map((id) => model.entity(id)!)
      .filter((e): e is Entity & { geom: ViewportGeometry } => e.geom.kind === 'VIEWPORT');

  it('makes the arrangement as layout viewports with spacing, in the area asked after OK', async () => {
    const t = drawing({
      space: PAPER_SPACE,
      choices: [fresh('Two: Vertical', { spacing: 10 }, ['Detail', null])],
    });
    await t.bus.script(['VPORTS']);
    expect(t.dialogs()[0]!.layout).toBe(true);
    expect(t.bus.prompt?.message).toBe('Specify first corner or');
    await t.bus.script(['0,0', '200,100']);
    expect(t.bus.command).toBeUndefined();
    const [, left, right] = viewports(t.model);
    expect(left!.geom).toMatchObject({
      center: { x: 47.5, y: 50 },
      width: 95,
      height: 100,
      viewCenter: { x: 100, y: 20 },
    });
    // 120 wide in a frame 95 wide and 100 high.
    expect(left!.geom.viewHeight).toBeCloseTo((120 * 100) / 95, 9);
    expect(right!.geom).toMatchObject({ center: { x: 152.5, y: 50 }, width: 95 });
    expect(t.bus.undo.state.nextUndo).toBe('VPORTS');
  });

  it('lays out the configuration selected on Named Viewports, as MVIEW Restore', async () => {
    const t = drawing({
      space: PAPER_SPACE,
      choices: [{ renamed: [], deleted: [], apply: { tab: 'named', name: 'TWO' } }],
    });
    await t.bus.script(['VPORTS', '0,0', '200,100']);
    const [, bottom, top] = viewports(t.model);
    expect(bottom!.geom).toMatchObject({ center: { x: 100, y: 25 }, viewHeight: 4 });
    expect(top!.geom).toMatchObject({ center: { x: 100, y: 75 }, viewHeight: 8 });
  });

  it('lays out model space’s tiles with *Active Model Configuration', async () => {
    const t = drawing({ space: PAPER_SPACE, choices: [fresh(ACTIVE_MODEL_CONFIGURATION)] });
    await t.bus.script(['VPORTS', '0,0', '100,100']);
    const [, left, right] = viewports(t.model);
    expect(left!.geom).toMatchObject({ center: { x: 25, y: 50 }, viewCenter: { x: 5, y: 5 } });
    expect(right!.geom).toMatchObject({ center: { x: 75, y: 50 }, viewHeight: 20 });
  });
});
