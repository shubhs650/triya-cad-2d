// M6-02 part 5: VPLAYER freezes, thaws and overrides layers in layout viewports, and MVIEW LAyer
// removes the overrides (AutoCAD 2024 Help, "VPLAYER (Command)", "MVIEW (Command)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  NEW_VP_FROZEN,
  PAPER_VIEWPORT_FLAGS,
  PromptBus,
  builtinCommands,
  viewportLayers,
  type BusEvent,
  type EntityGeometry,
  type ViewHost,
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

const LAYOUT2 = '70';
const SHEET = '60';
const A = '61';
const B = '62';
const C = '63';

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

function drawing(o: { space?: string } = {}) {
  const init = sampleInit();
  const paper: [string, string, EntityGeometry][] = [
    [SHEET, PAPER_SPACE, viewport({ id: 1, status: 1, flags: PAPER_VIEWPORT_FLAGS })],
    [A, PAPER_SPACE, viewport({ id: 2, status: 2 })],
    [B, PAPER_SPACE, viewport({ id: 3, status: 3, center: { x: 200, y: 100 } })],
    [C, LAYOUT2, viewport({ id: 4, status: 0 })],
  ];
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      blockRecords: [...(init.tables?.blockRecords ?? []), blockRecord(LAYOUT2, '*Paper_Space0')],
    },
    blocks: [
      ...(init.blocks ?? []),
      { handle: LAYOUT2, name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      ...init.layouts!,
      {
        handle: '71',
        name: 'Layout2',
        tabOrder: 2,
        blockRecord: LAYOUT2,
        limits: { min: { x: 0, y: 0 }, max: { x: 12, y: 9 } },
      },
    ],
    entities: [
      ...(init.entities ?? []),
      ...paper.map(([h, owner, g]) => entityInit(h, g, { owner, layer: LAYER_0 })),
    ],
  });
  const view: ViewHost = { request: () => Promise.resolve({ ok: true }) };
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
  const frozen = (h: string) => {
    const g = model.entityByHandle(h)!.geom as ViewportGeometry;
    return g.frozenLayers;
  };
  const ids = (...hs: string[]) => hs.map((h) => model.ids.idOf(h)!);
  const walls = () => model.tables.layers.get(LAYER_WALLS)!;
  return { model, bus, log, frozen, ids, walls };
}

describe('VPLAYER', () => {
  it('asks AutoCAD’s options again after each one until Enter, one VPLAYER undo step', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER']);
    expect(t.bus.prompt?.message).toBe('Enter an option');
    expect(t.bus.prompt?.options).toEqual([
      '?',
      'Color',
      'Ltype',
      'LWeight',
      'TRansparency',
      'Freeze',
      'Thaw',
      'Reset',
      'Newfrz',
      'Vpvisdflt',
    ]);
    await t.bus.script(['F', 'WALLS']);
    // In paper space no viewport is current: Select is the default.
    expect(t.bus.prompt?.message).toBe('Enter an option');
    expect(t.bus.prompt?.options).toEqual(['All', 'Select']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Select' });
    await t.bus.script(['S']);
    expect(t.bus.prompt?.message).toBe('Select objects');
    // The sheet's own viewport and a line are not taken.
    await t.bus.answer({ kind: 'selection', ids: t.ids(A, SHEET, '24') });
    expect(t.bus.prompt?.message).toBe('Enter an option');
    await t.bus.script(['F', '0', 'A']);
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.frozen(A)).toEqual([LAYER_WALLS, LAYER_0]);
    expect(t.frozen(B)).toEqual([LAYER_0]);
    // All is every layout's floating viewports, never a sheet's own.
    expect(t.frozen(C)).toEqual([LAYER_0]);
    expect(t.frozen(SHEET)).toEqual([]);
    expect(t.bus.undo.state.nextUndo).toBe('VPLAYER');
    await t.bus.script(['U']);
    expect(t.frozen(A)).toEqual([]);
    expect(t.frozen(C)).toEqual([]);
  });

  it('offers Current and Except current in a viewport made current, and thaws', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE']);
    // MSPACE: the viewport stacked first (lowest positive 68), A.
    await t.bus.script(['VPLAYER', 'F', 'WALLS']);
    expect(t.bus.prompt?.options).toEqual(['All', 'Select', 'Current', 'Except current']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Current' });
    await t.bus.script(['E']);
    expect(t.frozen(A)).toEqual([]);
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    expect(t.frozen(C)).toEqual([LAYER_WALLS]);
    await t.bus.script(['F', 'WALLS', '']);
    expect(t.frozen(A)).toEqual([LAYER_WALLS]);
    // Thaw has no Except current, and takes no objects at Enter.
    await t.bus.script(['T', 'W*']);
    expect(t.bus.prompt?.options).toEqual(['All', 'Select', 'Current']);
    await t.bus.script(['A', '']);
    expect([t.frozen(A), t.frozen(B), t.frozen(C)]).toEqual([[], [], []]);
  });

  it('switches to paper space to select viewports, and back', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE']);
    await t.bus.script(['VPLAYER', 'F', 'WALLS', 'S']);
    expect(t.bus.prompt?.message).toBe('Select objects');
    await t.bus.answer({ kind: 'selection', ids: t.ids(B) });
    await t.bus.script(['']);
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    expect(t.frozen(A)).toEqual([]);
    // A is current again: Current is offered.
    await t.bus.script(['VPLAYER', 'F', 'WALLS']);
    expect(t.bus.prompt?.options).toContain('Current');
  });

  it('on the Model tab offers All alone', async () => {
    const t = drawing({ space: MODEL_SPACE });
    await t.bus.script(['VPLAYER', 'F', 'WALLS']);
    expect(t.bus.prompt?.options).toEqual(['All']);
    await t.bus.script(['', '']);
    expect([t.frozen(A), t.frozen(B), t.frozen(C)]).toEqual([
      [LAYER_WALLS],
      [LAYER_WALLS],
      [LAYER_WALLS],
    ]);
  });

  it('overrides colour, linetype, lineweight and transparency in the viewports named', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE']);
    await t.bus.script(['VPLAYER', 'C', '1']);
    expect(t.bus.prompt?.message).toBe(
      'Enter layer name(s) to change color to 1 (red) or <select objects>',
    );
    await t.bus.script(['WALLS', '']);
    await t.bus.script(['LW', '0.5', 'WALLS', 'A']);
    await t.bus.script(['TR', '40', 'WALLS', '']);
    await t.bus.script(['L', 'Continuous', 'WALLS', '']);
    await t.bus.script(['']);
    const continuous = [...t.model.tables.linetypes.values()].find((l) => l.name === 'Continuous');
    expect(t.walls().viewportOverrides).toEqual([
      {
        viewport: A,
        color: { kind: 'aci', index: 1 },
        lineweight: 50,
        transparency: { alpha: 153 },
        ...(continuous && { linetype: continuous.handle }),
      },
      { viewport: B, lineweight: 50 },
      { viewport: C, lineweight: 50 },
    ]);
    // The viewport shows the layer with them; another shows its own values.
    expect(viewportLayers(t.model.tables.layers, A)?.layers.get(LAYER_WALLS)?.color).toEqual({
      kind: 'aci',
      index: 1,
    });
    expect(viewportLayers(t.model.tables.layers, B)?.layers.get(LAYER_WALLS)?.color).toEqual(
      t.walls().color,
    );
    // ByLayer is no override.
    await t.bus.script(['VPLAYER', 'C', 'bylayer']);
    expect(t.log).toContain('Invalid color.');
  });

  it('MVIEW LAyer removes the overrides of the viewports picked, VP Freeze kept', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER', 'C', '3', 'WALLS', 'A', 'F', 'WALLS', 'A', '']);
    await t.bus.script(['MVIEW']);
    expect(t.bus.prompt?.options).toContain('LAyer');
    await t.bus.script(['LA']);
    expect(t.bus.prompt?.message).toBe(
      'Reset viewport layer property overrides back to global properties',
    );
    await t.bus.script(['']);
    expect(t.bus.prompt?.message).toBe('Select viewports');
    await t.bus.answer({ kind: 'selection', ids: t.ids(A, B) });
    expect(t.walls().viewportOverrides).toEqual([
      { viewport: C, color: { kind: 'aci', index: 3 } },
    ]);
    expect(t.frozen(A)).toEqual([LAYER_WALLS]);
    expect(t.bus.undo.state.nextUndo).toBe('MVIEW');
  });

  it('Vpvisdflt sets the default, Reset applies it, and MVIEW’s new viewports start with it', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER', 'V', 'WALLS']);
    expect(t.bus.prompt?.options).toEqual(['Frozen', 'Thawed']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Thawed' });
    await t.bus.script(['F']);
    expect((t.walls().flags ?? 0) & NEW_VP_FROZEN).toBe(NEW_VP_FROZEN);
    await t.bus.script(['R', 'WALLS', 'A', '']);
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    await t.bus.script(['MVIEW', '10,10', '50,50']);
    const made = t.model
      .blockEntities(PAPER_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'VIEWPORT')
      .at(-1)!;
    expect((made.geom as ViewportGeometry).frozenLayers).toEqual([LAYER_WALLS]);
    await t.bus.script(['VPLAYER', 'V', 'WALLS', '', 'R', 'WALLS', 'A', '']);
    expect((t.walls().flags ?? 0) & NEW_VP_FROZEN).toBe(0);
    expect(t.frozen(B)).toEqual([]);
  });

  it('Newfrz makes layers frozen in every viewport and by default, refusing names taken', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER', 'N', 'NOTES,walls', '']);
    expect(t.log).toContain('Layer "walls" already exists.');
    const notes = [...t.model.tables.layers.values()].find((l) => l.name === 'NOTES')!;
    expect(notes).toMatchObject({ color: { kind: 'aci', index: 7 }, flags: NEW_VP_FROZEN });
    expect([t.frozen(A), t.frozen(B), t.frozen(C), t.frozen(SHEET)]).toEqual([
      [notes.handle],
      [notes.handle],
      [notes.handle],
      [],
    ]);
  });

  it('? lists the layers frozen in the viewport picked', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER', 'F', '0,WALLS', 'S']);
    await t.bus.answer({ kind: 'selection', ids: t.ids(B) });
    await t.bus.script(['?']);
    expect(t.bus.prompt?.message).toBe('Select a viewport');
    await t.bus.answer({ kind: 'selection', ids: t.ids(B) });
    expect(t.log.slice(-3)).toEqual(['Layers currently frozen in viewport 3:', '  0', '  WALLS']);
  });
  it('says what it cannot take, and changes nothing', async () => {
    const t = drawing();
    await t.bus.script(['VPLAYER', 'LW', 'heavy', 'LW', '', 'TR', '95', 'TR', '']);
    await t.bus.script(['L', 'NOPE', 'C', 'T', '1,2', 'F', 'NOPE', 'T', '']);
    await t.bus.script(['N', '', 'N', 'a<b', 'V', '', 'C', '2', 'WALLS', 'S']);
    await t.bus.answer({ kind: 'selection', ids: t.ids('24') });
    await t.bus.script(['F', '', 'S']);
    await t.bus.answer({ kind: 'selection', ids: [] });
    await t.bus.script(['?']);
    await t.bus.answer({ kind: 'selection', ids: [] });
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.log).toEqual(
      expect.arrayContaining([
        'Invalid lineweight.',
        'Value must be between 0 and 90.',
        'Linetype "NOPE" is not loaded.  Use the LINETYPE command to load it.',
        'Invalid color.',
        'No matching layer names found.',
      ]),
    );
    expect(t.walls().viewportOverrides).toBeUndefined();
    expect([t.frozen(A), t.frozen(B), t.frozen(C)]).toEqual([[], [], []]);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    const t2 = drawing({ space: MODEL_SPACE });
    await t2.bus.script(['VPLAYER', '?', '']);
    expect(t2.log).toContain('** Command not allowed in Model Tab **');
  });
});
