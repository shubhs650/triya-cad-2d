// M6-01 part 1: LAYOUT New, Delete, Rename, Set and ? (AutoCAD 2024 Help, "LAYOUT (Command)").
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  VIEWPORT_NON_RECT_CLIP,
  builtinCommands,
  copyObjects,
  moveBy,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type Handle,
  type LayoutPlot,
  type ViewHost,
  type ViewReply,
  type ViewportGeometry,
} from '../../src/index';
import {
  MODEL_SPACE as MODEL,
  PAPER_SPACE as SHEET1,
  blockRecord,
  LAYER_WALLS,
  entityInit,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

// SHEET1 is *Paper_Space: Layout1 is the drawing's current layout.
const SHEET2 = '30'; // *Paper_Space0: Layout2.
const OPTIONS = 'Enter layout option [Copy/Delete/New/Template/Rename/SAveas/Set/?] <Set>:';

/** Model, Layout1 (current, on *Paper_Space) and Layout2, each sheet with a line on it. */
function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([
      ...(base.header ?? []),
      ['$PLIMMIN', { x: 0, y: 0 }],
      ['$PLIMMAX', { x: 420, y: 297 }],
    ]),
    tables: {
      ...base.tables,
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord(SHEET2, '*Paper_Space0')],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: SHEET2, name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL },
      {
        handle: '1E',
        name: 'Layout1',
        tabOrder: 1,
        blockRecord: SHEET1,
        limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } },
      },
      { handle: '31', name: 'Layout2', tabOrder: 2, blockRecord: SHEET2 },
    ],
    entities: [...(base.entities ?? []), entityInit('32', lineGeom(0, 0, 5, 5), { owner: SHEET2 })],
  };
}

function setup(start: DocumentInit = init(), shown: Handle = MODEL) {
  const model = DocumentModel.create(start);
  let space = shown;
  const tabs: string[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'tab') return Promise.resolve({ ok: false, message: 'no' });
      tabs.push(r.name ?? '');
      const l = model.layouts.find((x) => x.name === r.name);
      if (l) space = l.blockRecord;
      return Promise.resolve({ ok: true });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const names = () => model.layouts.map((l) => `${l.tabOrder}:${l.name}`);
  const named = (n: string) => model.layouts.find((l) => l.name === n);
  const blockName = (h: Handle) => model.tables.blockRecords.get(h)?.name;
  return { model, bus, log, tabs, names, named, blockName, space: () => space };
}

describe('LAYOUT', () => {
  it('New adds the next Layout<n> after the last tab on the units’ own sheet, one LAYOUT step', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT']);
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['N']);
    expect(t.bus.promptText).toBe('Enter name of new layout <Layout3>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2', '3:Layout3']);
    const made = t.named('Layout3')!;
    expect(t.blockName(made.blockRecord)).toBe('*Paper_Space1');
    // The sample drawing is metric: ISO A4 landscape in millimetres, 1:1, plotting the layout.
    expect(made.plot).toMatchObject({
      paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
      paperWidth: 297,
      paperHeight: 210,
      paperUnits: 'millimeters',
      plotType: 5,
      scale: { numerator: 1, denominator: 1 },
    });
    expect(made.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 297, y: 210 } });
    // LAYOUT New does not show the new tab.
    expect(t.tabs).toEqual([]);
    expect(t.bus.undo.state.nextUndo).toBe('LAYOUT');
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
  });

  it('New in an imperial drawing is on ANSI A in inches', async () => {
    const base = init();
    const t = setup({
      ...base,
      header: new Map([...(base.header ?? []), ['$MEASUREMENT', 0]]),
    });
    await t.bus.script(['LAYOUT', 'N', 'Sheet A']);
    const made = t.named('Sheet A')!;
    expect(made.plot).toMatchObject({
      paperSize: 'ANSI_full_bleed_A_(11.00_x_8.50_Inches)',
      paperWidth: 279.4,
      paperHeight: 215.9,
      paperUnits: 'inches',
    });
    expect(made.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 11, y: 8.5 } });
  });

  it('New refuses a name in use (any case) or with characters AutoCAD refuses, and asks again', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'N', 'layout2']);
    expect(t.log.at(-1)).toBe('A layout named "layout2" already exists.');
    expect(t.bus.promptText).toBe('Enter name of new layout <Layout3>:');
    await t.bus.script(['A<B']);
    expect(t.log.at(-1)).toBe('Invalid layout name.');
    await t.bus.script(['Detail 1']);
    expect(t.bus.command).toBeUndefined();
    expect(t.names().at(-1)).toBe('3:Detail 1');
  });

  it('Rename defaults to the layout shown, keeps it on Enter and renames it, one undo step', async () => {
    const t = setup(init(), SHEET2);
    await t.bus.script(['LAYOUT', 'R']);
    expect(t.bus.promptText).toBe('Enter layout to rename <Layout2>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Enter new layout name <Layout2>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(0);
    await t.bus.script(['LAYOUT', 'R', 'layout1', 'Layout2']);
    expect(t.log.at(-1)).toBe('A layout named "Layout2" already exists.');
    await t.bus.script(['Plan']);
    expect(t.log.at(-1)).toBe('Layout "Layout1" renamed to "Plan".');
    expect(t.names()).toEqual(['0:Model', '1:Plan', '2:Layout2']);
    // Its case alone changes too.
    await t.bus.script(['LAYOUT', 'R', 'plan', 'PLAN']);
    expect(t.names()).toEqual(['0:Model', '1:PLAN', '2:Layout2']);
    await t.bus.script(['U', 'U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
  });

  it('a name the drawing lacks is asked again; the Model tab is not offered to Rename or Delete', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'R', 'Sheet9']);
    expect(t.log.at(-1)).toBe('No layout named "Sheet9".');
    expect(t.bus.promptText).toBe('Enter layout to rename <Layout1>:');
    await t.bus.script(['model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
    await t.bus.cancel();
    await t.bus.script(['LAYOUT', 'D', 'Model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
  });

  it('Delete of a layout not current removes it, its block and its sheet; U brings them back', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'D']);
    // On the Model tab, the drawing's current layout is the default.
    expect(t.bus.promptText).toBe('Enter name of layout to delete <Layout1>:');
    await t.bus.script(['Layout2']);
    expect(t.log.at(-1)).toBe('Layout "Layout2" deleted.');
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
    expect(t.model.blocks.has(SHEET2)).toBe(false);
    expect(t.model.entityByHandle('32')).toBeUndefined();
    expect(t.tabs).toEqual([]);
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
    expect(t.model.entityByHandle('32')).toBeDefined();
  });

  it('Delete of the current layout makes the next one current first and shows the Model tab', async () => {
    const t = setup(init(), SHEET1);
    await t.bus.script(['LAYOUT', 'D', '']);
    expect(t.log.at(-1)).toBe('Layout "Layout1" deleted.');
    expect(t.tabs).toEqual(['Model']);
    expect(t.space()).toBe(MODEL);
    expect(t.names()).toEqual(['0:Model', '1:Layout2']);
    // Layout2's sheet block took the name *Paper_Space, as AutoCAD swaps them.
    expect(t.blockName(SHEET2)).toBe('*Paper_Space');
    expect(t.model.blocks.has(SHEET1)).toBe(false);
  });

  it('the current layout cannot go while its other layouts are all new since the drawing opened', async () => {
    const start = init();
    const t = setup({
      ...start,
      layouts: start.layouts!.filter((l) => l.name !== 'Layout2'),
      tables: {
        ...start.tables,
        blockRecords: start.tables!.blockRecords!.filter((r) => r.handle !== SHEET2),
      },
      blocks: start.blocks!.filter((b) => b.handle !== SHEET2),
      entities: start.entities!.filter((e) => e.owner !== SHEET2),
    });
    await t.bus.script(['LAYOUT', 'N', '', 'LAYOUT', 'D', 'Layout1']);
    expect(t.log.at(-1)).toBe(
      'Layout "Layout1" cannot be deleted until the drawing is saved and opened again: its other layouts are new.',
    );
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('Delete of the only layout leaves it emptied as Layout1 on a new layout’s sheet', async () => {
    const start = init();
    const t = setup(
      {
        ...start,
        layouts: start.layouts!.map((l) => (l.handle === '1E' ? { ...l, name: 'Plan' } : l)),
      },
      SHEET1,
    );
    await t.bus.script(['LAYOUT', 'D', 'Layout2', 'LAYOUT', 'D', 'Plan']);
    expect(t.log.at(-1)).toBe('Layout "Plan" deleted.');
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
    const sheet = t.named('Layout1')!;
    expect(sheet.handle).toBe('1E');
    expect(t.model.blockEntities(SHEET1)).toEqual([]);
    expect(sheet.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 297, y: 210 } });
    // The header held the current layout's limits: they follow.
    expect(t.model.header.get('$PLIMMAX')).toEqual({ x: 297, y: 210 });
    // Still shown: nothing else to show.
    expect(t.tabs).toEqual([]);
  });

  it('Set shows the tab named (Model too); Enter keeps the one shown', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', '']);
    expect(t.bus.promptText).toBe('Enter layout to make current <Model>:');
    await t.bus.script(['layout2']);
    expect(t.tabs).toEqual(['Layout2']);
    await t.bus.script(['LAYOUT', 'S', '']);
    expect(t.tabs).toEqual(['Layout2']);
    await t.bus.script(['LAYOUT', 'S', 'model']);
    expect(t.tabs).toEqual(['Layout2', 'Model']);
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('? lists the layout shown and every layout; Template and SAveas say why the app cannot', async () => {
    const t = setup(init(), SHEET2);
    await t.bus.script(['LAYOUT', '?']);
    expect(t.log.slice(-4)).toEqual(['Active Layout: Layout2', 'Model', 'Layout1', 'Layout2']);
    // The view host here answers nothing but tabs (layout-template.test.ts has the rest).
    await t.bus.script(['LAYOUT', 'T', '']);
    expect(t.log.at(-1)).toBe('no');
    await t.bus.script(['LAYOUT', 'SA', '', '']);
    expect(t.log.at(-1)).toBe('no');
    expect(t.bus.command).toBeUndefined();
  });

  it('New refuses a 256th layout', async () => {
    const start = DocumentModel.create(init());
    const b = new ChangeSetBuilder(start);
    for (let i = 3; i <= 255; i++) b.addLayout({ name: `L${i}` });
    start.apply(b.build());
    const bus = new PromptBus({ model: start, registry: builtinCommands() });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['LAYOUT', 'N']);
    expect(log.at(-1)).toBe('A drawing can have 255 layouts at most.');
    expect(bus.command).toBeUndefined();
  });
});

// M6-01 part 2: LAYOUT Copy, the Move or Copy dialog's edits and dragging a tab.
const PLOT: LayoutPlot = {
  paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
  paperWidth: 420,
  paperHeight: 297,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 16 | 32 | 128 | 512,
  standardScaleType: 16,
};

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 210, y: 148.5 },
  width: 420,
  height: 297,
  id: 1,
  status: 1,
  flags: 557_088,
  viewCenter: { x: 210, y: 148.5 },
  viewHeight: 297,
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

const square = (x: number, y: number, size: number): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x, y, bulge: 0 },
    { x: x + size, y, bulge: 0 },
    { x: x + size, y: y + size, bulge: 0 },
    { x, y: y + size, bulge: 0 },
  ],
});

/**
 * init() with Layout2 given a page setup, xdata-less limits, its paper viewport (id 1), a
 * floating viewport numbered 4 and stacked 3 (ids need not be dense), and one clipped by a
 * polyline (id 5); the floating one has a VP Color override on Walls. The line (32) is drawn on
 * top through a draw order table that puts it first.
 */
function viewportsInit(): DocumentInit {
  const base = init();
  return {
    ...base,
    tables: {
      ...base.tables,
      layers: (base.tables?.layers ?? []).map((l) =>
        l.handle === LAYER_WALLS
          ? { ...l, viewportOverrides: [{ viewport: '41', color: { kind: 'aci', index: 1 } }] }
          : l,
      ),
    },
    layouts: base.layouts!.map((l) =>
      l.name === 'Layout2'
        ? {
            ...l,
            flags: 3,
            plot: PLOT,
            limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } },
          }
        : l,
    ),
    entities: [
      ...(base.entities ?? []),
      entityInit('40', viewport(), { owner: SHEET2 }),
      entityInit(
        '41',
        viewport({ id: 4, status: 3, flags: 819_232, center: { x: 100, y: 100 }, width: 80 }),
        { owner: SHEET2, layer: LAYER_WALLS },
      ),
      entityInit('42', square(200, 50, 60), { owner: SHEET2, reactors: ['43'] }),
      entityInit(
        '43',
        viewport({
          id: 5,
          status: 2,
          flags: 819_232 | VIEWPORT_NON_RECT_CLIP,
          center: { x: 230, y: 80 },
          width: 60,
          height: 60,
          clipBoundary: '42',
        }),
        { owner: SHEET2 },
      ),
    ],
  };
}

describe('LAYOUT Copy', () => {
  it('copies the layout shown by default as "<name> (2)", inserted before it, one LAYOUT step', async () => {
    const t = setup(init(), SHEET2);
    await t.bus.script(['LAYOUT', 'C']);
    expect(t.bus.promptText).toBe('Enter name of layout to copy <Layout2>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Enter layout name for copy <Layout2 (2)>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.log.at(-1)).toBe('Layout "Layout2" copied to "Layout2 (2)".');
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2 (2)', '3:Layout2']);
    const copy = t.named('Layout2 (2)')!;
    expect(t.blockName(copy.blockRecord)).toBe('*Paper_Space1');
    // The line on Layout2's sheet is on the copy's too, a new object in the same place.
    const [line] = t.model.blockEntities(copy.blockRecord).map((id) => t.model.entity(id)!);
    expect(line!.handle).not.toBe('32');
    expect(line!.geom).toEqual(t.model.entityByHandle('32')!.geom);
    // The copy is not shown (AutoCAD leaves the tab shown), and one U takes it back.
    expect(t.tabs).toEqual([]);
    expect(t.bus.undo.state.nextUndo).toBe('LAYOUT');
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
    // A second copy takes the next number.
    await t.bus.script(['LAYOUT', 'C', 'layout2', '', 'LAYOUT', 'C', 'Layout2', '']);
    expect(t.names()).toEqual([
      '0:Model',
      '1:Layout1',
      '2:Layout2 (2)',
      '3:Layout2 (3)',
      '4:Layout2',
    ]);
  });

  it('a taken or invalid name is asked again; the Model tab cannot be copied', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'C']);
    // On the Model tab: the drawing's current layout.
    expect(t.bus.promptText).toBe('Enter name of layout to copy <Layout1>:');
    await t.bus.script(['Model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
    await t.bus.script(['Layout1', 'LAYOUT2']);
    expect(t.log.at(-1)).toBe('A layout named "LAYOUT2" already exists.');
    await t.bus.script(['a|b']);
    expect(t.log.at(-1)).toBe('Invalid layout name.');
    expect(t.bus.promptText).toBe('Enter layout name for copy <Layout1 (2)>:');
    await t.bus.script(['Plan B']);
    expect(t.names()).toEqual(['0:Model', '1:Plan B', '2:Layout1', '3:Layout2']);
    // Layout1's page setup and limits are its copy's.
    const copy = t.named('Plan B')!;
    const source = t.named('Layout1')!;
    expect(copy.limits).toEqual(source.limits);
  });

  it('copies page setup, flags, viewports (ids and stacking kept) and a clipped viewport with its boundary', async () => {
    const t = setup(viewportsInit(), SHEET2);
    await t.bus.script(['LAYOUT', 'C', '', 'Copy']);
    // The floating viewport's VP Color override is not copied, and says so.
    expect(t.log.slice(-2)).toEqual([
      '1 viewport was copied without its layer overrides (not saved yet).',
      'Layout "Layout2" copied to "Copy".',
    ]);
    const copy = t.named('Copy')!;
    const source = t.named('Layout2')!;
    expect(copy.plot).toEqual(PLOT);
    expect(copy.flags).toBe(3);
    expect(copy.limits).toEqual(source.limits);
    const made = t.model.blockEntities(copy.blockRecord).map((id) => t.model.entity(id)!);
    // The paper-space viewport first (the sheet's view, see copyLayout), then the sheet.
    expect(made.map((e) => e.geom.kind)).toEqual([
      'VIEWPORT',
      'LINE',
      'VIEWPORT',
      'LWPOLYLINE',
      'VIEWPORT',
    ]);
    const vps = made.filter((e) => e.geom.kind === 'VIEWPORT');
    expect(
      vps.map((e) => [(e.geom as ViewportGeometry).id, (e.geom as ViewportGeometry).status]),
    ).toEqual([
      [1, 1],
      [4, 3],
      [5, 2],
    ]);
    expect(vps[1]!.layer).toBe(LAYER_WALLS);
    // The clipped one is clipped by the boundary's copy, which names it as its reactor.
    const boundary = made[3]!;
    const clipped = vps[2]!;
    expect((clipped.geom as ViewportGeometry).clipBoundary).toBe(boundary.handle);
    expect(boundary.reactors).toEqual([clipped.handle]);
    // The source's boundary still names only its own viewport.
    expect(t.model.entityByHandle('42')!.reactors).toEqual(['43']);
    expect(t.model.tables.layers.get(LAYER_WALLS)!.viewportOverrides).toHaveLength(1);
  });

  it('copies the sheet in its draw order', async () => {
    const start = viewportsInit();
    const t = setup(
      {
        ...start,
        objects: [
          ...(start.objects ?? []),
          {
            handle: '50',
            type: 'SORTENTSTABLE',
            owner: '51',
            block: SHEET2,
            // The line (32) drawn after everything else.
            entries: [{ entity: '32', sort: '60' }],
          } as never,
        ],
      },
      SHEET2,
    );
    await t.bus.script(['LAYOUT', 'C', '', '']);
    const copy = t.named('Layout2 (2)')!;
    const kinds = t.model
      .blockEntities(copy.blockRecord)
      .map((id) => t.model.entity(id)!.geom.kind);
    expect(kinds).toEqual(['VIEWPORT', 'VIEWPORT', 'LWPOLYLINE', 'VIEWPORT', 'LINE']);
  });

  it('a session layout edit copies at a tab place, and moves a tab; the Model tab does neither', () => {
    const s = new EngineSession(viewportsInit());
    const layouts = () => s.model.layouts.map((l) => `${l.tabOrder}:${l.name}`);
    const handle = (n: string) => s.model.layouts.find((l) => l.name === n)!.handle;
    // Before Layout1.
    let r = s.edit({ kind: 'layout', layout: handle('Layout2'), copy: true, tabOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.messages).toEqual([
      '1 viewport was copied without its layer overrides (not saved yet).',
    ]);
    expect(layouts()).toEqual(['0:Model', '1:Layout2 (2)', '2:Layout1', '3:Layout2']);
    // At the end, named.
    r = s.edit({ kind: 'layout', layout: handle('Layout1'), copy: true, tabOrder: 9, name: 'End' });
    expect(r.ok).toBe(true);
    expect(layouts()).toEqual(['0:Model', '1:Layout2 (2)', '2:Layout1', '3:Layout2', '4:End']);
    // Moved: Layout2 before Layout1.
    s.edit({ kind: 'layout', layout: handle('Layout2'), tabOrder: 2 });
    expect(layouts()).toEqual(['0:Model', '1:Layout2 (2)', '2:Layout2', '3:Layout1', '4:End']);
    expect(s.undoState.undoable).toBe(3);
    const model = handle('Model');
    expect(s.edit({ kind: 'layout', layout: model, copy: true })).toEqual({
      ok: false,
      message: 'The Model tab cannot be copied.',
    });
    expect(s.edit({ kind: 'layout', layout: model, tabOrder: 2 })).toEqual({
      ok: false,
      message: 'The Model tab cannot be renamed or moved.',
    });
    expect(s.edit({ kind: 'layout', layout: handle('End'), copy: true, name: 'layout1' })).toEqual({
      ok: false,
      message: 'A layout named "layout1" already exists.',
    });
  });

  it('COPY copies a clipped viewport with its boundary; without it, the viewport stays', () => {
    const model = DocumentModel.create(viewportsInit());
    const ids = (...hs: string[]) => hs.map((h) => model.ids.idOf(h)!);
    let b = new ChangeSetBuilder(model);
    const alone = copyObjects(b, model, ids('43'), moveBy({ x: 10, y: 0 }));
    expect(alone.ids).toEqual([]);
    expect([...alone.refused]).toEqual([['a clipped viewport cannot be copied', 1]]);
    b = new ChangeSetBuilder(model);
    const both = copyObjects(b, model, ids('43', '42'), moveBy({ x: 10, y: 0 }));
    expect(both.ids).toHaveLength(2);
    const vp = b.entity(both.copies.get('43')!.id)!;
    const boundary = b.entity(both.copies.get('42')!.id)!;
    expect((vp.geom as ViewportGeometry).clipBoundary).toBe(boundary.handle);
    expect(boundary.reactors).toEqual([vp.handle]);
    expect((vp.geom as ViewportGeometry).center).toEqual({ x: 240, y: 80 });
  });
});
