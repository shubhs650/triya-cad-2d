// M6-02 part 14: MVIEW NEw and NAmed place a view of model space on the layout in a new
// display-locked viewport at a scale (AutoCAD 2024 Help, "MVIEW (Command)"), and -VIEW Restore
// of a model view in a layout restores it in a layout viewport ("-VIEW (Command)": "you are
// prompted to select a viewport in which to restore that view").
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT_SCALES,
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PromptBus,
  VIEWPORT_LOCKED,
  builtinCommands,
  fittingScale,
  parseViewportScale,
  type Entity,
  type EntityGeometry,
  type LayoutPlot,
  type ViewHost,
  type ViewRecord,
  type ViewReply,
  type ViewRequest,
  type ViewportGeometry,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  PAPER_SPACE,
  entityInit,
  sampleInit,
} from '../model/fixtures';

/** A 297 × 210 mm sheet with 5 mm margins: printable (0,0)–(287,200). */
const PLOT: LayoutPlot = {
  paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
  paperWidth: 297,
  paperHeight: 210,
  margins: { left: 5, bottom: 5, right: 5, top: 5 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 688,
};

const view = (handle: string, name: string, over: Partial<ViewRecord> = {}): ViewRecord => ({
  handle,
  name,
  center: { x: 50, y: 25 },
  height: 50,
  width: 100,
  direction: { x: 0, y: 0, z: 1 },
  target: { x: 0, y: 0, z: 0 },
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  twist: 0,
  viewMode: 0,
  renderMode: 0,
  ...over,
});

/** Plan: model (0,0)–(100,50); Sheet: a layout view; Iso: a 3D view. */
const VIEWS: ViewRecord[] = [
  view('A1', 'Plan'),
  view('A2', 'Sheet', { flags: 1, center: { x: 140, y: 100 }, width: 280, height: 200 }),
  view('A3', 'Iso', { direction: { x: 1, y: 1, z: 1 } }),
  // Display centre 10,0 from target 40,25: the window's centre is model 50,25.
  view('A4', 'Offset', { center: { x: 10, y: 0 }, target: { x: 40, y: 25, z: 0 } }),
];

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

interface Options {
  /** Viewports of Layout1's paper space. */
  paper?: [string, EntityGeometry][];
  /** The drawing's scale list. */
  scales?: { name: string; value: number }[];
  /** CANNOSCALE. */
  annotationScale?: string;
  /** Layout1 without a page setup or limits: no area to fit. */
  noArea?: boolean;
  /** What the canvas answers a request with (else ok). */
  answer?: (r: ViewRequest) => ViewReply | undefined;
}

/** SCALE objects of a scale list (M6-02 part 21), `value` paper units to one drawing unit. */
const scaleObjects = (
  scales: readonly { name: string; value: number; handle?: string }[],
  first = 0xa00,
) =>
  scales.map((s, i) => ({
    type: 'SCALE' as const,
    handle: s.handle ?? (first + i).toString(16).toUpperCase(),
    owner: '9F0',
    key: `A${i}`,
    name: s.name,
    paperUnits: s.value,
    drawingUnits: 1,
    unitScale: false,
  }));

function drawing(o: Options = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    objects: [...(init.objects ?? []), ...scaleObjects(o.scales ?? [])],
    header: new Map([
      ...(init.header ?? []),
      ...((o.annotationScale ? [['CANNOSCALE', o.annotationScale]] : []) as [string, never][]),
    ]),
    tables: { ...init.tables, views: VIEWS },
    layouts: init.layouts!.map((l) =>
      l.name === 'Layout1' && !o.noArea ? { ...l, plot: PLOT } : l,
    ),
    entities: [
      ...(init.entities ?? []),
      ...(o.paper ?? []).map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 })),
    ],
  });
  let space = PAPER_SPACE;
  const requests: ViewRequest[] = [];
  const host: ViewHost = {
    request: (r) => {
      requests.push(r);
      if (r.op === 'tab') space = r.name === 'Model' ? MODEL_SPACE : PAPER_SPACE;
      const reply: ViewReply =
        o.answer?.(r) ?? (r.op === 'pick' ? { ok: true, ids: [] } : { ok: true });
      return Promise.resolve(reply);
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host, space: () => space });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const viewports = (): (Entity & { geom: ViewportGeometry })[] =>
    model
      .blockEntities(PAPER_SPACE)
      .map((id) => model.entity(id)!)
      .filter((e): e is Entity & { geom: ViewportGeometry } => e.geom.kind === 'VIEWPORT')
      .filter((e) => e.geom.id !== 1);
  const tabs = () => requests.flatMap((r) => (r.op === 'tab' ? [r.name] : []));
  const shownSpace = () => space;
  return { model, bus, log, requests, viewports, tabs, shownSpace };
}

describe('viewport scales (M6-02 part 14)', () => {
  const s = (name: string, value: number) => ({ name, value });

  it('picks the largest scale of the list at which the view fits the area, else the smallest', () => {
    const area = { minX: 0, minY: 0, maxX: 287, maxY: 200 };
    const one = s('1:1', 1);
    expect(fittingScale(DEFAULT_VIEWPORT_SCALES, { width: 100, height: 50 }, area, one)).toEqual(
      s('2:1', 2),
    );
    expect(fittingScale(DEFAULT_VIEWPORT_SCALES, { width: 5000, height: 50 }, area, one)).toEqual(
      s('1:20', 1 / 20),
    );
    // Larger than the area at every scale: the smallest.
    const huge = { width: 1e9, height: 1 };
    expect(fittingScale(DEFAULT_VIEWPORT_SCALES, huge, area, one)).toEqual(s('1:100', 1 / 100));
    expect(fittingScale(DEFAULT_VIEWPORT_SCALES, huge, undefined, one)).toBe(one);
  });

  it('reads a scale of the list, a:b, a=b and nXP', () => {
    const list = [s('1:50', 0.02), s('Detail', 4)];
    expect(parseViewportScale('detail', list)).toEqual(s('Detail', 4));
    expect(parseViewportScale(' 1:50 ', list)).toEqual(s('1:50', 0.02));
    expect(parseViewportScale('1:4', list)).toEqual(s('1:4', 0.25));
    expect(parseViewportScale('3=1', list)).toEqual(s('3:1', 3));
    expect(parseViewportScale('0.5XP', list)).toEqual(s('0.5xp', 0.5));
    expect(parseViewportScale('0:1', list)).toBeUndefined();
    expect(parseViewportScale('big', list)).toBeUndefined();
  });
});

describe('MVIEW NAmed (M6-02 part 14)', () => {
  it('places a named model view in a locked viewport at the scale that fits the printable area', async () => {
    const t = drawing();
    await t.bus.script(['MV']);
    expect(t.bus.prompt?.options).toEqual([
      'ON',
      'OFF',
      'Fit',
      'Lock',
      'NEw',
      'NAmed',
      'Object',
      'Polygonal',
      'Restore',
      'LAyer',
      '2',
      '3',
      '4',
    ]);
    await t.bus.script(['NA']);
    expect(t.bus.prompt?.message).toBe('Enter view name or');
    await t.bus.script(['?']);
    // Model space's views only, 3D ones too (they are named but refused).
    expect(t.log.slice(-4)).toEqual(['Model space views:', '  Plan', '  Iso', '  Offset']);
    await t.bus.script(['Sheet']);
    expect(t.log.at(-1)).toBe('Cannot find model space view "Sheet".');
    await t.bus.script(['iso']);
    expect(t.log.at(-1)).toBe('View "Iso" is not a plan view; it cannot be placed yet.');
    await t.bus.script(['plan']);
    expect(t.bus.prompt?.message).toBe('Specify viewport location or');
    expect(t.bus.prompt?.options).toEqual(['Scale']);
    expect(t.bus.prompt?.kind === 'point' && t.bus.prompt.drag).toEqual({
      kind: 'preview',
      from: { x: 0, y: 0 },
    });
    // 100 × 50 fits 287 × 200 at 2:1 (200 × 100), not at 4:1.
    expect(t.log.at(-1)).toBe('Viewport scale: 2:1');
    await t.bus.script(['143.5,100']);
    expect(t.bus.command).toBeUndefined();
    const [vp] = t.viewports();
    expect(vp!.layer).toBe(LAYER_WALLS);
    expect(vp!.geom).toMatchObject({
      center: { x: 143.5, y: 100 },
      width: 200,
      height: 100,
      viewCenter: { x: 50, y: 25 },
      viewHeight: 50,
      flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_LOCKED,
    });
    expect(t.bus.undo.state.nextUndo).toBe('MVIEW');
    await t.bus.script(['U']);
    expect(t.viewports()).toEqual([]);
  });

  it('takes another scale typed at Scale, and the drawing’s own list', async () => {
    const t = drawing({
      scales: [
        { name: 'Half', value: 0.5 },
        { name: 'Full', value: 1 },
      ],
    });
    await t.bus.script(['MVIEW', 'NAmed', 'Offset']);
    // The drawing's list: 1 fits (100 × 50), and is its largest.
    expect(t.log.at(-1)).toBe('Viewport scale: Full');
    await t.bus.script(['S']);
    expect(t.bus.prompt?.message).toBe('Enter viewport scale or');
    expect(t.bus.prompt?.default).toEqual({ kind: 'string', value: 'Full' });
    await t.bus.script(['?']);
    expect(t.log.at(-1)).toBe('Scales: Half, Full');
    await t.bus.script(['bogus']);
    expect(t.log.at(-1)).toBe('Invalid scale.');
    await t.bus.script(['half']);
    expect(t.log.at(-1)).toBe('Viewport scale: Half');
    await t.bus.script(['S', '1:4', '50,50']);
    const [vp] = t.viewports();
    expect(vp!.geom).toMatchObject({
      center: { x: 50, y: 50 },
      width: 25,
      height: 12.5,
      viewCenter: { x: 50, y: 25 },
      viewHeight: 50,
    });
  });

  it('starts at the current annotation scale when the layout has no area to fit', async () => {
    const t = drawing({
      noArea: true,
      scales: [{ name: '1:10', value: 0.1 }],
      annotationScale: '1:10',
    });
    await t.bus.script(['MVIEW', 'NAmed', 'Plan']);
    expect(t.log.at(-1)).toBe('Viewport scale: 1:10');
    await t.bus.script(['0,0']);
    expect(t.viewports()[0]!.geom).toMatchObject({ width: 10, height: 5 });
  });

  it('makes nothing at Esc while the viewport is placed', async () => {
    const t = drawing();
    await t.bus.script(['MVIEW', 'NAmed', 'Plan']);
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.viewports()).toEqual([]);
  });
});

describe('MVIEW NEw (M6-02 part 14)', () => {
  it('takes the window on the Model tab, shows the layout again and places it there', async () => {
    const t = drawing();
    await t.bus.script(['MVIEW', 'NEw']);
    expect(t.tabs()).toEqual(['Model']);
    expect(t.shownSpace()).toBe(MODEL_SPACE);
    expect(t.bus.prompt?.message).toBe('Specify first corner');
    await t.bus.script(['0,0']);
    expect(t.bus.prompt?.message).toBe('Specify opposite corner');
    await t.bus.script(['40,0']);
    expect(t.log.at(-1)).toBe('Invalid window specification.');
    await t.bus.script(['0,0', '40,20']);
    expect(t.tabs()).toEqual(['Model', 'Layout1']);
    expect(t.shownSpace()).toBe(PAPER_SPACE);
    // 40 × 20 fits 287 × 200 at 4:1 (160 × 80), not at 8:1.
    expect(t.log.at(-1)).toBe('Viewport scale: 4:1');
    await t.bus.script(['100,100']);
    expect(t.viewports()[0]!.geom).toMatchObject({
      center: { x: 100, y: 100 },
      width: 160,
      height: 80,
      viewCenter: { x: 20, y: 10 },
      viewHeight: 20,
      flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_LOCKED,
    });
  });

  it('shows the layout again at Esc on the Model tab', async () => {
    const t = drawing();
    await t.bus.script(['MVIEW', 'NEw', '0,0']);
    await t.bus.cancel();
    expect(t.tabs()).toEqual(['Model', 'Layout1']);
    expect(t.shownSpace()).toBe(PAPER_SPACE);
    expect(t.viewports()).toEqual([]);
  });

  it('says why when the Model tab cannot be shown', async () => {
    const t = drawing({
      answer: (r) => (r.op === 'tab' ? { ok: false, message: 'No tabs here.' } : undefined),
    });
    await t.bus.script(['MVIEW', 'NEw']);
    expect(t.log.at(-1)).toBe('No tabs here.');
    expect(t.bus.command).toBeUndefined();
  });
});

describe('-VIEW Restore in a layout (M6-02 part 14)', () => {
  const A = '50';
  const B = '51';
  const TWO: [string, EntityGeometry][] = [
    [A, viewport({ id: 2, status: 3 })],
    [
      B,
      viewport({
        id: 3,
        status: 2,
        center: { x: 200, y: 100 },
        flags: FLOATING_VIEWPORT_FLAGS | 0x20000,
      }),
    ],
  ];
  const restored = (requests: ViewRequest[]) =>
    requests.flatMap((r) => (r.op === 'restore' ? [r] : []));
  const told = (requests: ViewRequest[]) =>
    requests.flatMap((r) => (r.op === 'viewport' ? [r.viewport] : []));

  it('asks for the viewport in paper space, makes it current and restores the view there', async () => {
    const t = drawing({ paper: TWO });
    const id = (h: string) => t.model.ids.idOf(h)!;
    await t.bus.script(['-VIEW', 'Restore', 'offset']);
    expect(t.bus.prompt?.message).toBe('Select viewport for view');
    // A line of paper space is no viewport; B is off.
    const line = t.model
      .blockEntities(PAPER_SPACE)
      .find((i) => t.model.entity(i)!.geom.kind === 'LINE');
    await t.bus.answer({ kind: 'selection', ids: [line!] });
    expect(t.log.at(-1)).toBe('The object selected is not a viewport.');
    await t.bus.answer({ kind: 'selection', ids: [id(B)] });
    expect(t.log.at(-1)).toBe('The viewport must be on and in plan.');
    await t.bus.answer({ kind: 'selection', ids: [id(A)] });
    expect(t.bus.command).toBeUndefined();
    expect(told(t.requests)).toEqual([A]);
    expect(restored(t.requests)).toEqual([
      { op: 'restore', name: 'Offset', window: { minX: 0, minY: 0, maxX: 100, maxY: 50 } },
    ]);
  });

  it('restores in the viewport made current, and a layout view back in paper space', async () => {
    const t = drawing({ paper: TWO });
    await t.bus.script(['MSPACE']);
    expect(told(t.requests)).toEqual([A]);
    await t.bus.script(['-VIEW', 'R', 'Plan']);
    expect(restored(t.requests)).toEqual([
      { op: 'restore', name: 'Plan', window: { minX: 0, minY: 0, maxX: 100, maxY: 50 } },
    ]);
    await t.bus.script(['-VIEW', 'R', 'Sheet']);
    expect(told(t.requests)).toEqual([A, null]);
    expect(restored(t.requests).at(-1)).toEqual({ op: 'restore', name: 'Sheet' });
  });

  it('refuses a 3D model view in a layout, and Enter at the viewport changes nothing', async () => {
    const t = drawing({ paper: TWO });
    await t.bus.script(['-VIEW', 'Restore', 'Iso']);
    expect(t.log.at(-1)).toBe('View "Iso" is not a plan view; it cannot be shown yet.');
    await t.bus.script(['-VIEW', 'Restore', 'Plan']);
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.bus.command).toBeUndefined();
    expect(restored(t.requests)).toEqual([]);
  });
});
