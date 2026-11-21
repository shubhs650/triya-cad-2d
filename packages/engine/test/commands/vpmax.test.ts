// M6-02 part 7: VPMAX and VPMIN (AutoCAD 2024 Help, "VPMAX (Command)": "Expands the current
// layout viewport for editing"; "VPMIN (Command)": "Restores the current layout viewport. The
// center point and magnification are returned to the settings that were in effect before the
// viewport was maximized"). The engine works in the viewport's model space while it is
// maximized and tells the canvas, which fills itself with it; the drawing is not edited.
import { describe, expect, it } from 'vitest';
import {
  ALREADY_MAXIMIZED,
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  NOT_IN_MODEL_TAB,
  NOT_MAXIMIZED,
  NOT_WORKABLE,
  NO_VIEWPORTS,
  PromptBus,
  VIEWPORT_OFF,
  builtinCommands,
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
  let picks: ViewReply = { ok: true, ids: [] };
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
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  /** What the canvas was told of the viewport worked in: its handle, `+` when maximized. */
  const told = () =>
    requests.flatMap((r) =>
      r.op === 'viewport' ? [`${r.viewport ?? 'paper'}${r.maximized ? '+' : ''}`] : [],
    );
  const lastOwner = () => {
    const ids = [...model.blockEntities(MODEL_SPACE), ...model.blockEntities(PAPER_SPACE)];
    return model.entity(Math.max(...ids))!.owner;
  };
  const id = (h: string) => model.ids.idOf(h)!;
  const pickReturns = (ids: number[]) => void (picks = { ok: true, ids });
  return { model, bus, log, told, lastOwner, id, pickReturns };
}

describe('VPMAX and VPMIN', () => {
  it('are refused on the Model tab', async () => {
    const t = drawing({ space: MODEL_SPACE });
    await t.bus.script(['VPMAX']);
    await t.bus.script(['VPMIN']);
    expect(t.log.filter((l) => l === NOT_IN_MODEL_TAB)).toHaveLength(2);
    expect(t.told()).toEqual([]);
  });

  it('VPMAX maximizes the viewport made current; VPMIN restores it, still current', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.script(['VPMAX']);
    expect(t.told()).toEqual([B, `${B}+`]);
    // The drawing is not edited: no undo step.
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    await t.bus.script(['VPMAX']);
    expect(t.log.at(-1)).toBe(ALREADY_MAXIMIZED);
    await t.bus.script(['VPMIN']);
    expect(t.told()).toEqual([B, `${B}+`, B]);
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    await t.bus.script(['VPMIN']);
    expect(t.log.at(-1)).toBe(NOT_MAXIMIZED);
  });

  it('VPMAX in paper space asks for the viewport and VPMIN goes back to paper space', async () => {
    const t = drawing();
    await t.bus.script(['VPMAX']);
    expect(t.bus.prompt?.message).toBe('Select a viewport to maximize');
    await t.bus.answer({ kind: 'selection', ids: [] });
    expect(t.bus.command).toBeUndefined();
    expect(t.told()).toEqual([]);
    await t.bus.script(['VPMAX']);
    await t.bus.answer({ kind: 'selection', ids: [t.id('24')] });
    expect(t.log).toContain('Object is not a viewport.');
    await t.bus.answer({ kind: 'selection', ids: [t.id(A)] });
    expect(t.told()).toEqual([`${A}+`]);
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(MODEL_SPACE);
    await t.bus.script(['VPMIN']);
    expect(t.told()).toEqual([`${A}+`, 'paper']);
    await t.bus.script(['LINE', '0,0', '10,0', '']);
    expect(t.lastOwner()).toBe(PAPER_SPACE);
  });

  it('VPMAX takes the one viewport there is, or the viewport preselected, without asking', async () => {
    const one = drawing({
      paper: [
        [A, viewport()],
        [B, viewport({ flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_OFF })],
      ],
    });
    await one.bus.script(['VPMAX']);
    expect(one.told()).toEqual([`${A}+`]);

    const t = drawing();
    // A click on B's frame at `Command:` preselects it.
    t.pickReturns([t.id(B)]);
    await t.bus.pick({ x: 180, y: 100 });
    expect(t.bus.selection).toEqual([t.id(B)]);
    t.pickReturns([]);
    await t.bus.script(['VPMAX']);
    expect(t.told()).toEqual([`${B}+`]);
  });

  it('VPMAX refuses a viewport twisted or not in plan, which cannot be worked in', async () => {
    const t = drawing({ paper: [...TWO, ['52', viewport({ id: 4, twist: Math.PI / 6 })]] });
    await t.bus.script(['VPMAX']);
    await t.bus.answer({ kind: 'selection', ids: [t.id('52')] });
    expect(t.log.at(-1)).toBe(NOT_WORKABLE);
    expect(t.bus.prompt?.message).toBe('Select a viewport to maximize');
    await t.bus.answer({ kind: 'selection', ids: [t.id(B)] });
    expect(t.told()).toEqual([`${B}+`]);
  });

  it('VPMAX says so in a layout with no viewport to work in', async () => {
    const t = drawing({ paper: [[A, viewport({ id: 1, status: 1 })]] });
    await t.bus.script(['VPMAX']);
    expect(t.log.at(-1)).toBe(NO_VIEWPORTS);
    expect(t.told()).toEqual([]);
  });

  it('a double click on a viewport’s frame in paper space maximizes it', async () => {
    const t = drawing();
    t.pickReturns([t.id(A)]);
    await t.bus.doubleClick({ x: 80, y: 100 });
    expect(t.told()).toEqual([`${A}+`]);
  });

  it('while maximized a double click does not switch viewports; PSPACE restores it first', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.script(['VPMAX']);
    // (100, 0) in B is paper (250, 100): outside B's frame, but B fills the canvas.
    await t.bus.doubleClick({ x: 100, y: 0 });
    // (-100, 0) in B is paper (150, 100): in no frame.
    await t.bus.doubleClick({ x: -200, y: 0 });
    expect(t.told()).toEqual([B, `${B}+`]);
    await t.bus.script(['PS']);
    expect(t.told()).toEqual([B, `${B}+`, 'paper']);
    await t.bus.script(['VPMIN']);
    expect(t.log.at(-1)).toBe(NOT_MAXIMIZED);
    // MSPACE afterwards is not maximized.
    await t.bus.script(['MS']);
    expect(t.told()).toEqual([B, `${B}+`, 'paper', B]);
  });

  it('a viewport erased (an undo of the MVIEW that made it) is maximized no longer', async () => {
    const t = drawing({ paper: [] });
    await t.bus.script(['MVIEW', '10,10', '50,40']);
    await t.bus.script(['VPMAX']);
    expect(t.told()).toHaveLength(1);
    expect(t.told()[0]!.endsWith('+')).toBe(true);
    await t.bus.script(['U']);
    await t.bus.script(['VPMIN']);
    expect(t.log.at(-1)).toBe(NOT_MAXIMIZED);
    await t.bus.script(['LINE', '0,0', '1,1', '']);
    expect(t.lastOwner()).toBe(PAPER_SPACE);
  });
});
