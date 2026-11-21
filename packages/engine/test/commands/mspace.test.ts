// M6-02 part 3: MSPACE and PSPACE, and a double click into and out of a layout viewport
// (AutoCAD 2024 Help, "MSPACE (Command)", "PSPACE (Command)"): while a floating viewport is
// current, commands work in model space; the tab shown stays the layout.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  IN_PAPER_SPACE,
  NOT_IN_MODEL_TAB,
  NO_VIEWPORTS,
  PromptBus,
  VIEWPORT_OFF,
  builtinCommands,
  firstViewport,
  viewportAt,
  workableViewport,
  type BusEvent,
  type EntityGeometry,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
  type ViewportGeometry,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

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

/** Viewport A: 1:1 about model 0,0 at paper 100,100; B: 1:2 about model 0,0 at paper 200,100. */
const A = '50';
const B = '51';
const TWO: [string, EntityGeometry][] = [
  [A, viewport({ id: 2, status: 3 })],
  [B, viewport({ id: 3, status: 2, center: { x: 200, y: 100 }, viewHeight: 60 })],
];

function drawing(o: { paper?: [string, EntityGeometry][]; space?: string } = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    entities: [
      ...(init.entities ?? []),
      ...(o.paper ?? TWO).map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 })),
    ],
  });
  const requests: ViewRequest[] = [];
  const picks: ViewReply = { ok: true, ids: [] };
  const view: ViewHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve(r.op === 'pick' ? picks : { ok: true });
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
  const told = () =>
    requests.flatMap((r) => (r.op === 'viewport' ? [r.viewport] : [])) as (string | null)[];
  /** The space the last entity added went into. */
  const lastOwner = () => {
    const ids = [...model.blockEntities(MODEL_SPACE), ...model.blockEntities(PAPER_SPACE)];
    return model.entity(Math.max(...ids))!.owner;
  };
  const tab = async () => {
    await bus.script(['SETVAR', 'CTAB', '']);
    await bus.script(['SETVAR', 'TILEMODE', '']);
    return log.filter((l) => l.startsWith('Enter new value')).slice(-2);
  };
  return { model, bus, log, told, lastOwner, tab };
}

describe('MSPACE and PSPACE', () => {
  it('are refused on the Model tab', async () => {
    const t = drawing({ space: MODEL_SPACE });
    await t.bus.script(['MSPACE']);
    await t.bus.script(['PS']);
    expect(t.log.filter((l) => l === NOT_IN_MODEL_TAB)).toHaveLength(2);
    expect(t.told()).toEqual([]);
  });

  it('MSPACE says so in a layout with no viewport to work in', async () => {
    const t = drawing({
      paper: [
        ['50', viewport({ id: 1, status: 1 })],
        ['51', viewport({ flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_OFF })],
        ['52', viewport({ viewDirection: { x: 1, y: -1, z: 1 } })],
      ],
    });
    await t.bus.script(['MS']);
    expect(t.log).toContain(NO_VIEWPORTS);
    expect(t.told()).toEqual([]);
  });

  it('MSPACE makes the viewport stacked first current: commands draw in model space there', async () => {
    const t = drawing();
    await t.bus.script(['MSPACE']);
    expect(t.told()).toEqual([B]);
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    // The tab shown is still the layout.
    expect(await t.tab()).toEqual([
      'Enter new value for CTAB <"Layout1">:',
      'Enter new value for TILEMODE <0>:',
    ]);
    // MSPACE again changes nothing.
    await t.bus.script(['MSPACE']);
    expect(t.told()).toEqual([B]);

    await t.bus.script(['PSPACE']);
    expect(t.told()).toEqual([B, null]);
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(PAPER_SPACE);
    await t.bus.script(['PS']);
    expect(t.log.at(-1)).toBe(IN_PAPER_SPACE);
  });

  it('a double click in a viewport works in it, in another switches, outside goes to paper space', async () => {
    const t = drawing();
    // Inside A's frame on the sheet: A is current.
    await t.bus.doubleClick({ x: 110, y: 95 });
    expect(t.told()).toEqual([A]);
    await t.bus.script(['LINE', '1,1', '2,2', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    // Now points are model space's: (100, 0) in A is paper (200, 100), inside B.
    await t.bus.doubleClick({ x: 100, y: 0 });
    expect(t.told()).toEqual([A, B]);
    // Inside B: (10, 10) in B is paper (205, 105). A double click edits what is there.
    await t.bus.doubleClick({ x: 10, y: 10 });
    expect(t.told()).toEqual([A, B]);
    // Off every viewport: (200, 0) in B is paper (300, 100).
    await t.bus.doubleClick({ x: 200, y: 0 });
    expect(t.told()).toEqual([A, B, null]);
    // MSPACE goes back to the viewport last current.
    await t.bus.script(['MS']);
    expect(t.told()).toEqual([A, B, null, B]);
  });

  it('a viewport made current deselects what was selected in paper space', async () => {
    const t = drawing();
    await t.bus.selectAll();
    expect(t.bus.selection.length).toBeGreaterThan(0);
    await t.bus.script(['MS']);
    expect(t.bus.selection).toEqual([]);
  });

  it('MVIEW from a viewport made current works in paper space', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.script(['MVIEW', 'OFF', 'ALL', '']);
    expect(t.told()).toEqual([B, null]);
    expect(t.log).not.toContain(NOT_IN_MODEL_TAB);
    // Both viewports off: none to work in.
    await t.bus.script(['MS']);
    expect(t.log.at(-1)).toBe(NO_VIEWPORTS);
  });

  it('the viewport erased (an undo of the MVIEW that made it) leaves the layout in paper space', async () => {
    const t = drawing({ paper: [] });
    await t.bus.script(['MVIEW', '10,10', '50,40']);
    await t.bus.script(['MS']);
    expect(t.told()).toHaveLength(1);
    await t.bus.script(['LINE', '0,0', '1,1', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    await t.bus.script(['U', 'U']);
    await t.bus.script(['LINE', '0,0', '1,1', '']);
    expect(t.lastOwner()).toBe(PAPER_SPACE);
  });
});

describe('the viewports one can work in', () => {
  it('are on and in plan, twisted or not (M6-02 part 15); the first is the one stacked first', () => {
    expect(workableViewport(viewport())).toBe(true);
    expect(workableViewport(viewport({ id: 1 }))).toBe(false);
    expect(workableViewport(viewport({ twist: 0.1 }))).toBe(true);
    expect(workableViewport(viewport({ viewDirection: { x: 1, y: -1, z: 1 } }))).toBe(false);
    const t = drawing();
    expect(firstViewport(t.model, PAPER_SPACE)?.handle).toBe(B);
    expect(viewportAt(t.model, PAPER_SPACE, { x: 85, y: 90 })?.handle).toBe(A);
    expect(viewportAt(t.model, PAPER_SPACE, { x: 150, y: 100 })).toBeUndefined();
    const unstacked = drawing({
      paper: TWO.map(([h, g]) => [h, { ...(g as ViewportGeometry), status: 0 }]),
    });
    expect(firstViewport(unstacked.model, PAPER_SPACE)?.handle).toBe(A);
  });
});
