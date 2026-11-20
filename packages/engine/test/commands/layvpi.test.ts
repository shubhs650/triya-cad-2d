// M6-02 part 6: LAYVPI freezes the layer of each object picked in every layout viewport but the
// current one (AutoCAD 2024 Help, "LAYVPI (Command)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PAPER_VIEWPORT_FLAGS,
  PromptBus,
  builtinCommands,
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
/** A circle on WALLS and a line on 0, in model space (fixtures). */
const CIRCLE = '21';
const LINE = '20';

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

function drawing(o: { space?: string; only?: boolean } = {}) {
  const init = sampleInit();
  const paper: [string, string, EntityGeometry][] = [
    [SHEET, PAPER_SPACE, viewport({ id: 1, status: 1, flags: PAPER_VIEWPORT_FLAGS })],
    [A, PAPER_SPACE, viewport({ id: 2, status: 2, frozenLayers: [LAYER_WALLS] })],
    ...(o.only
      ? []
      : ([
          [B, PAPER_SPACE, viewport({ id: 3, status: 3, center: { x: 200, y: 100 } })],
          [C, LAYOUT2, viewport({ id: 4, status: 0 })],
        ] as [string, string, EntityGeometry][])),
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
  const frozen = (h: string) => (model.entityByHandle(h)!.geom as ViewportGeometry).frozenLayers;
  const pick = (h: string) => bus.answer({ kind: 'selection', ids: [model.ids.idOf(h)!] });
  return { model, bus, log, frozen, pick };
}

describe('LAYVPI', () => {
  it('freezes the layer picked in every viewport but the current one, which shows it', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE', 'LAYVPI']);
    expect(t.log).toContain('Current settings: Layouts=All layouts, Block nesting level=Block');
    expect(t.bus.prompt?.message).toBe('Select objects on the layer to be isolated in viewport');
    expect(t.bus.prompt?.options).toEqual(['Settings', 'Undo']);
    await t.pick(CIRCLE);
    expect(t.log).toContain('Layer "WALLS" has been isolated in the current viewport.');
    // A is current (MSPACE): WALLS was frozen there and is thawed; every other layout's
    // floating viewport freezes it, never a sheet's own.
    expect(t.frozen(A)).toEqual([]);
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    expect(t.frozen(C)).toEqual([LAYER_WALLS]);
    expect(t.frozen(SHEET)).toEqual([]);
    await t.pick(LINE);
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.frozen(B)).toEqual([LAYER_WALLS, LAYER_0]);
    expect(t.bus.undo.state.nextUndo).toBe('LAYVPI');
    await t.bus.script(['U']);
    expect([t.frozen(A), t.frozen(B), t.frozen(C)]).toEqual([[LAYER_WALLS], [], []]);
  });

  it('Undo takes the last layer back as it was in each viewport', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE', 'LAYVPI']);
    await t.pick(CIRCLE);
    await t.pick(LINE);
    await t.bus.script(['U']);
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    await t.bus.script(['U']);
    expect([t.frozen(A), t.frozen(B), t.frozen(C)]).toEqual([[LAYER_WALLS], [], []]);
    await t.bus.script(['U']);
    expect(t.log).toContain('Nothing to undo.');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
  });

  it('Settings keeps Current layout and the Block selection nesting level for later runs', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE', 'LAYVPI', 'S']);
    expect(t.bus.prompt?.message).toBe('Enter setting type for');
    expect(t.bus.prompt?.options).toEqual(['Layouts', 'Block selection']);
    await t.bus.script(['L']);
    expect(t.bus.prompt?.message).toBe('Isolate layers in all viewports except current for');
    expect(t.bus.prompt?.options).toEqual(['All layouts', 'Current layout']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'All layouts' });
    await t.bus.script(['C', 'S', 'B']);
    expect(t.bus.prompt?.message).toBe('Enter Block Selection nesting level');
    expect(t.bus.prompt?.options).toEqual(['Block', 'Entity', 'None']);
    await t.bus.script(['E']);
    await t.pick(CIRCLE);
    await t.bus.script(['']);
    // Only the current layout's viewports: Layout2's C keeps WALLS.
    expect(t.frozen(B)).toEqual([LAYER_WALLS]);
    expect(t.frozen(C)).toEqual([]);
    await t.bus.script(['LAYVPI']);
    expect(t.log.at(-1)).toBe(
      'Current settings: Layouts=Current layout, Block nesting level=Entity',
    );
  });

  it('is refused on the Model tab, in paper space and with fewer than two viewports', async () => {
    const m = drawing({ space: MODEL_SPACE });
    await m.bus.script(['LAYVPI']);
    expect(m.log).toContain('** Command not allowed in Model Tab **');
    expect(m.bus.command).toBeUndefined();

    const p = drawing();
    await p.bus.script(['LAYVPI']);
    expect(p.log).toContain(
      'No viewport is current. Use MSPACE or double-click in a viewport first.',
    );
    expect(p.bus.command).toBeUndefined();

    const one = drawing({ only: true });
    await one.bus.script(['MSPACE', 'LAYVPI']);
    expect(one.log).toContain('LAYVPI requires two or more layout viewports.');
    expect(one.bus.command).toBeUndefined();
  });
});
