// M6-02 part 1: MVIEW makes, shows, hides and locks layout viewports, on AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "MVIEW (Command)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PAPER_VIEWPORT_FLAGS,
  PromptBus,
  VIEWPORT_LOCKED,
  VIEWPORT_OFF,
  builtinCommands,
  viewportArrangement,
  viewportFit,
  type BusEvent,
  type Entity,
  type LayoutPlot,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
  type ViewportGeometry,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  PAPER_SPACE,
  blockRecord,
  entityInit,
  sampleInit,
} from '../model/fixtures';

/** Layout2's paper space: a layout that is not the current one (*Paper_Space). */
const LAYOUT2 = '70';

/** A 297 × 210 mm sheet with 5 mm margins: printable (0,0)–(287,200), paper (−5,−5)–(292,205). */
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

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 40,
  height: 30,
  id: 3,
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
  /** The page setup of Layout1; none, and the layout has no printable area. */
  plot?: LayoutPlot | null;
  /** Entities of paper space beside the sample's line 24. */
  paper?: [string, ViewportGeometry][];
  /** What the canvas answers `bounds` and `get` with; by default nothing (the engine's own). */
  answer?: (r: ViewRequest) => ViewReply | undefined;
  /** The space shown; Layout1's paper space by default. */
  space?: string;
  /** Model space empty, and the drawing's header beside the sample's. */
  empty?: boolean;
  header?: [string, unknown][];
}

function drawing(o: Options = {}) {
  const init = sampleInit();
  const plot = o.plot === null ? undefined : (o.plot ?? PLOT);
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ...((o.header ?? []) as [string, never][])]),
    tables: {
      ...init.tables,
      blockRecords: [...(init.tables?.blockRecords ?? []), blockRecord(LAYOUT2, '*Paper_Space0')],
    },
    blocks: [
      ...(init.blocks ?? []),
      { handle: LAYOUT2, name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      ...init.layouts!.map((l) => (l.name === 'Layout1' && plot ? { ...l, plot } : l)),
      {
        handle: '71',
        name: 'Layout2',
        tabOrder: 2,
        blockRecord: LAYOUT2,
        limits: { min: { x: 0, y: 0 }, max: { x: 12, y: 9 } },
      },
    ],
    entities: [
      ...(init.entities ?? []).filter((e) => !o.empty || e.owner !== MODEL_SPACE),
      ...(o.paper ?? []).map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 })),
    ],
  });
  const requests: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve(o.answer?.(r) ?? { ok: false, message: 'no view' });
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
  const viewports = (space = PAPER_SPACE): (Entity & { geom: ViewportGeometry })[] =>
    model
      .blockEntities(space)
      .map((id) => model.entity(id)!)
      .filter((e): e is Entity & { geom: ViewportGeometry } => e.geom.kind === 'VIEWPORT');
  const frame = (g: ViewportGeometry) => ({
    minX: g.center.x - g.width / 2,
    minY: g.center.y - g.height / 2,
    maxX: g.center.x + g.width / 2,
    maxY: g.center.y + g.height / 2,
  });
  return { model, bus, log, requests, viewports, frame };
}

describe('MVIEW', () => {
  it('is refused outside a layout’s paper space, as AutoCAD refuses it on the Model tab', async () => {
    const t = drawing({ space: MODEL_SPACE });
    await t.bus.script(['MVIEW']);
    expect(t.log).toContain('** Command not allowed in Model Tab **');
    expect(t.bus.command).toBeUndefined();
    expect(t.viewports()).toEqual([]);
  });

  it('makes a viewport from two corners showing model space’s extents, on the current layer', async () => {
    const t = drawing({
      answer: (r) =>
        r.op === 'bounds' ? { ok: true, box: { minX: 0, minY: 0, maxX: 20, maxY: 10 } } : undefined,
    });
    await t.bus.script(['MV']);
    expect(t.bus.prompt?.message).toBe('Specify corner of viewport or');
    expect(t.bus.prompt?.options).toEqual(['ON', 'OFF', 'Fit', 'Lock', '2', '3', '4']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Fit' });
    await t.bus.script(['110,60']);
    expect(t.bus.prompt?.message).toBe('Specify opposite corner');
    await t.bus.script(['10,10']);
    expect(t.bus.command).toBeUndefined();
    // The model-space objects were measured by the canvas (text by its glyphs).
    const bounds = t.requests.find((r) => r.op === 'bounds');
    expect(bounds && 'ids' in bounds ? bounds.ids.length : 0).toBe(3);

    const [sheet, vp] = t.viewports();
    // The layout had no viewport: its own paper-space one (id 1) comes first, on layer 0.
    expect(sheet!.geom).toMatchObject({
      id: 1,
      status: 1,
      flags: PAPER_VIEWPORT_FLAGS,
      center: { x: 143.5, y: 100 },
      width: 297,
      height: 210,
    });
    expect(sheet!.layer).toBe(LAYER_0);
    expect(vp!.layer).toBe(LAYER_WALLS);
    expect(vp!.geom).toMatchObject({
      id: 2,
      status: 2,
      flags: FLOATING_VIEWPORT_FLAGS,
      center: { x: 60, y: 35 },
      width: 100,
      height: 50,
      // 20 × 10 fits a 100 × 50 frame exactly.
      viewCenter: { x: 10, y: 5 },
      viewHeight: 10,
      viewDirection: { x: 0, y: 0, z: 1 },
      twist: 0,
    });
    expect(t.bus.undo.state.nextUndo).toBe('MVIEW');
    await t.bus.script(['U']);
    expect(t.viewports()).toEqual([]);
  });

  it('fits the extents the engine bounds when the canvas measures none, and numbers on', async () => {
    const t = drawing({ paper: [['60', viewport({ id: 7, status: 4 })]] });
    // Fit, the default: the printable area.
    await t.bus.script(['MVIEW', '']);
    expect(t.bus.command).toBeUndefined();
    const vps = t.viewports();
    // The layout had viewports: no paper-space one is made for it.
    expect(vps.map((e) => e.geom.id)).toEqual([7, 8]);
    const g = vps[1]!.geom;
    expect(t.frame(g)).toEqual({ minX: 0, minY: 0, maxX: 287, maxY: 200 });
    expect(g.status).toBe(5);
    // The sample's model space: lines (0,0)–(10,0) and (0,0)–(0,10), a circle at (5,5) r 2.
    expect(g.viewCenter).toEqual({ x: 5, y: 5 });
    expect(g.viewHeight).toBe(10);
  });

  it('fills the display with Fit when the layout has no page setup', async () => {
    const t = drawing({
      plot: null,
      answer: (r) =>
        r.op === 'get'
          ? { ok: true, view: { center: { x: 50, y: 40 }, height: 80, width: 100, paper: true } }
          : undefined,
    });
    await t.bus.script(['MVIEW', 'F']);
    const vp = t.viewports().find((e) => e.geom.id !== 1)!;
    expect(t.frame(vp.geom)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 80 });
  });

  it('arranges 2, 3 and 4 viewports in the area as AutoCAD does', async () => {
    const t = drawing({ paper: [['60', viewport()]] });
    await t.bus.script(['MVIEW', '2']);
    expect(t.bus.prompt?.message).toBe('Enter viewport arrangement');
    expect(t.bus.prompt?.options).toEqual(['Horizontal', 'Vertical']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Vertical' });
    await t.bus.script(['']);
    expect(t.bus.prompt?.message).toBe('Specify first corner or');
    expect(t.bus.prompt?.options).toEqual(['Fit']);
    await t.bus.script(['0,0', '100,50']);
    expect(
      t
        .viewports()
        .slice(1)
        .map((e) => t.frame(e.geom)),
    ).toEqual([
      { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      { minX: 50, minY: 0, maxX: 100, maxY: 50 },
    ]);
    // One undo step for the whole arrangement.
    await t.bus.script(['U']);
    expect(t.viewports()).toHaveLength(1);

    await t.bus.script(['MVIEW', '3']);
    expect(t.bus.prompt?.options).toEqual([
      'Horizontal',
      'Vertical',
      'Above',
      'Below',
      'Left',
      'Right',
    ]);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Right' });
    await t.bus.script(['', '0,0', '100,50']);
    expect(
      t
        .viewports()
        .slice(1)
        .map((e) => t.frame(e.geom)),
    ).toEqual([
      { minX: 50, minY: 0, maxX: 100, maxY: 50 },
      { minX: 0, minY: 25, maxX: 50, maxY: 50 },
      { minX: 0, minY: 0, maxX: 50, maxY: 25 },
    ]);
    await t.bus.script(['U', 'MVIEW', '4', 'F']);
    expect(t.viewports().slice(1)).toHaveLength(4);
    expect(new Set(t.viewports().map((e) => e.geom.id)).size).toBe(5);
  });

  it('numbers a layout that is not current 0, its own viewport framed by its limits', async () => {
    const t = drawing({
      space: LAYOUT2,
      empty: true,
      header: [
        ['$LIMMIN', { x: 0, y: 0 }],
        ['$LIMMAX', { x: 40, y: 30 }],
      ],
    });
    await t.bus.script(['MVIEW', '2,2', '6,5']);
    const [own, vp] = t.viewports(LAYOUT2).map((e) => e.geom);
    expect(own).toMatchObject({ id: 1, status: 0, center: { x: 6, y: 4.5 }, width: 12, height: 9 });
    // DXF 68 is 0 in a layout that is not current; model space is empty: its limits are shown.
    expect(vp).toMatchObject({ id: 2, status: 0, viewCenter: { x: 20, y: 15 }, viewHeight: 30 });
  });

  it('shows an empty model space with no limits 1:1 about the frame', async () => {
    const t = drawing({ empty: true });
    await t.bus.script(['MVIEW', '10,10', '50,40']);
    const vp = t.viewports()[1]!.geom;
    expect(vp.viewCenter).toEqual({ x: 30, y: 25 });
    expect(vp.viewHeight).toBe(30);
  });

  it('says so when there is nothing to fit', async () => {
    const t = drawing({ plot: null, space: LAYOUT2 });
    // Layout2 has limits: Fit fills them without a page setup or a canvas.
    await t.bus.script(['MVIEW', 'F']);
    expect(t.frame(t.viewports(LAYOUT2)[1]!.geom)).toEqual({ minX: 0, minY: 0, maxX: 12, maxY: 9 });
    const u = drawing({ plot: null });
    await u.bus.script(['MVIEW', '4', '']);
    expect(u.log).toContain('The layout has no printable area to fit.');
    expect(u.bus.command).toBeUndefined();
    expect(u.viewports()).toEqual([]);
  });

  it('asks again for a window with no area', async () => {
    const t = drawing();
    await t.bus.script(['MVIEW', '10,10', '10,50']);
    expect(t.log).toContain('Invalid window specification.');
    expect(t.bus.prompt?.message).toBe('Specify first corner or');
    await t.bus.script(['10,10', '50,50']);
    expect(t.viewports()).toHaveLength(2);
  });

  it('turns the viewports picked off and on, never the layout’s own', async () => {
    const t = drawing({
      paper: [
        ['60', viewport({ id: 1, status: 1, flags: PAPER_VIEWPORT_FLAGS })],
        ['61', viewport({ id: 2, status: 2 })],
        ['62', viewport({ id: 3, status: 3 })],
      ],
    });
    const ids = ['60', '61', '24'].map((h) => t.model.ids.idOf(h)!);
    await t.bus.script(['MVIEW', 'OFF']);
    expect(t.bus.prompt?.message).toBe('Select objects');
    await t.bus.answer({ kind: 'selection', ids });
    expect(t.bus.command).toBeUndefined();
    const [own, two, three] = t.viewports().map((e) => e.geom);
    expect(own!.flags & VIEWPORT_OFF).toBe(0);
    expect(two!.flags & VIEWPORT_OFF).toBe(VIEWPORT_OFF);
    // DXF 68 is 0 for a viewport that is off.
    expect(two!.status).toBe(0);
    expect(three!.flags & VIEWPORT_OFF).toBe(0);
    expect(t.bus.undo.state.nextUndo).toBe('MVIEW');

    await t.bus.script(['MVIEW', 'ON']);
    await t.bus.answer({ kind: 'selection', ids });
    const back = t.viewports()[1]!.geom;
    expect(back.flags).toBe(FLOATING_VIEWPORT_FLAGS);
    expect(back.status).toBe(4);
  });

  it('locks and unlocks the views of the viewports picked', async () => {
    const t = drawing({ paper: [['61', viewport({ id: 2 })]] });
    const id = t.model.ids.idOf('61')!;
    await t.bus.script(['MVIEW', 'L']);
    expect(t.bus.prompt?.message).toBe('Viewport View Locking');
    expect(t.bus.prompt?.options).toEqual(['ON', 'OFF']);
    await t.bus.script(['ON']);
    await t.bus.answer({ kind: 'selection', ids: [id] });
    expect(t.viewports()[0]!.geom.flags).toBe(FLOATING_VIEWPORT_FLAGS | VIEWPORT_LOCKED);
    await t.bus.script(['MVIEW', 'L', 'OFF']);
    await t.bus.answer({ kind: 'selection', ids: [id] });
    expect(t.viewports()[0]!.geom.flags).toBe(FLOATING_VIEWPORT_FLAGS);
  });
});

describe('viewport layouts', () => {
  const area = { minX: 0, minY: 0, maxX: 90, maxY: 60 };
  it('splits 2 and 3 as their arrangements say, the large one first', () => {
    expect(viewportArrangement(area, 2, 'Horizontal')).toEqual([
      { minX: 0, minY: 30, maxX: 90, maxY: 60 },
      { minX: 0, minY: 0, maxX: 90, maxY: 30 },
    ]);
    expect(viewportArrangement(area, 3, 'Horizontal').map((b) => [b.minY, b.maxY])).toEqual([
      [40, 60],
      [20, 40],
      [0, 20],
    ]);
    expect(viewportArrangement(area, 3, 'Vertical').map((b) => [b.minX, b.maxX])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
    ]);
    expect(viewportArrangement(area, 3, 'Above')[0]).toEqual({
      minX: 0,
      minY: 30,
      maxX: 90,
      maxY: 60,
    });
    expect(viewportArrangement(area, 3, 'Below')[0]).toEqual({
      minX: 0,
      minY: 0,
      maxX: 90,
      maxY: 30,
    });
    expect(viewportArrangement(area, 3, 'Left')[0]).toEqual({
      minX: 0,
      minY: 0,
      maxX: 45,
      maxY: 60,
    });
    expect(viewportArrangement(area, 1)).toEqual([area]);
  });

  it('fits extents by their height or their width, whichever the frame is short of', () => {
    const frame = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(viewportFit(frame, { minX: 0, minY: 0, maxX: 10, maxY: 20 })).toEqual({
      center: { x: 5, y: 10 },
      height: 20,
    });
    expect(viewportFit(frame, { minX: -40, minY: 0, maxX: 40, maxY: 20 })).toEqual({
      center: { x: 0, y: 10 },
      height: 40,
    });
    expect(viewportFit(frame, { minX: 3, minY: 3, maxX: 3, maxY: 3 })).toBeUndefined();
  });
});
