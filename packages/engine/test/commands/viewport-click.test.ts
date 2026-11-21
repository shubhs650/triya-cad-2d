// M6-02 part 9: a single click into another layout viewport while one is current (AutoCAD 2024
// Help, "To Make a Layout Viewport Current": "click inside its border"; "Switch Between
// Viewports": "you can switch from one viewport to another during command execution"), and
// VPMAXIMIZEDSTATE ("Indicates whether the viewport is maximized or not", 0 or 1, read-only).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PromptBus,
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

/**
 * Viewport A: 1:1 about model 0,0, its frame paper 80..120 × 85..115; B: 1:2 about model 0,0,
 * its frame paper 180..220 × 85..115. B is stacked first, so MSPACE makes it current.
 */
const A = '50';
const B = '51';
const TWO: [string, EntityGeometry][] = [
  [A, viewport({ id: 2, status: 3 })],
  [B, viewport({ id: 3, status: 2, center: { x: 200, y: 100 }, viewHeight: 60 })],
];

/** Model points as the current viewport takes them (the canvas sends model space's). */
const IN_A_FROM_B = { x: -200, y: 0 }; // paper 100,100
const IN_B_FROM_A = { x: 100, y: 0 }; // paper 200,100
const PAPER_FROM_A = { x: 40, y: 0 }; // paper 140,100: between the frames

function drawing() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    entities: [
      ...(init.entities ?? []),
      ...TWO.map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 })),
    ],
  });
  const requests: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r) => {
      requests.push(r);
      const reply: ViewReply = r.op === 'pick' ? { ok: true, ids: [] } : { ok: true };
      return Promise.resolve(reply);
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    space: () => PAPER_SPACE,
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const told = () => requests.flatMap((r) => (r.op === 'viewport' ? [r.viewport] : []));
  const picked = () => requests.filter((r) => r.op === 'pick').length;
  const lastLine = () => {
    const ids = [...model.blockEntities(MODEL_SPACE)];
    const e = model.entity(Math.max(...ids))!;
    return e.geom.kind === 'LINE' ? { start: e.geom.start, end: e.geom.end } : undefined;
  };
  return { model, bus, log, told, picked, lastLine };
}

describe('a click into another layout viewport', () => {
  it('at Command: makes the viewport under it current and picks nothing', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    expect(t.told()).toEqual([B]);
    const before = t.picked();
    await t.bus.pick(IN_A_FROM_B);
    expect(t.told()).toEqual([B, A]);
    // The click was taken for the switch: nothing was picked and no window was started.
    expect(t.picked()).toBe(before);
    expect(t.bus.promptText).toBe('Command:');
    // From A, a click in B goes back.
    await t.bus.pick(IN_B_FROM_A);
    expect(t.told()).toEqual([B, A, B]);
  });

  it('inside the current viewport picks as before', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    const before = t.picked();
    await t.bus.pick({ x: 2, y: 2 });
    expect(t.told()).toEqual([B]);
    expect(t.picked()).toBe(before + 1);
  });

  it('on paper outside every viewport does nothing', async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 110, y: 95 });
    expect(t.told()).toEqual([A]);
    const before = t.picked();
    await t.bus.pick(PAPER_FROM_A);
    expect(t.told()).toEqual([A]);
    expect(t.picked()).toBe(before);
    expect(t.bus.promptText).toBe('Command:');
  });

  it('keeps what is selected: both viewports show the same model space', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.selectAll();
    const selected = [...t.bus.selection];
    expect(selected.length).toBeGreaterThan(0);
    await t.bus.pick(IN_A_FROM_B);
    expect(t.told()).toEqual([B, A]);
    expect(t.bus.selection).toEqual(selected);
    // Paper space is another space: going there still deselects.
    await t.bus.script(['PS']);
    expect(t.bus.selection).toEqual([]);
  });

  it('during a command switches viewports and the command goes on in the other one', async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 110, y: 95 });
    await t.bus.script(['LINE']);
    await t.bus.pick({ x: 1, y: 1 });
    await t.bus.pick(IN_B_FROM_A);
    expect(t.told()).toEqual([A, B]);
    expect(t.bus.promptText).toMatch(/^Specify next point/);
    // In B, (10, 10) is paper (205, 105): the line's end.
    await t.bus.pick({ x: 10, y: 10 });
    await t.bus.submit('');
    expect(t.lastLine()).toEqual({ start: { x: 1, y: 1 }, end: { x: 10, y: 10 } });
  });

  it("leaves a selection window's other corner beyond the frame alone", async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 110, y: 95 });
    // A click on nothing at Command: starts a window; its other corner may lie in B.
    await t.bus.pick({ x: 2, y: 2 });
    expect(t.bus.promptText).toMatch(/opposite corner/i);
    await t.bus.pick(IN_B_FROM_A);
    expect(t.told()).toEqual([A]);
    expect(t.bus.promptText).toBe('Command:');
  });

  it('is an ordinary pick while the viewport is maximized: no other viewport is shown', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.script(['VPMAX']);
    const before = t.picked();
    await t.bus.pick(IN_A_FROM_B);
    expect(t.told()).toEqual([B, B]);
    expect(t.picked()).toBe(before + 1);
  });
});

describe('a double click begun outside the current viewport', () => {
  it('is the switch alone, or paper space on the sheet: the canvas sends the sheet point', async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 110, y: 95 });
    expect(t.told()).toEqual([A]);
    // Paper (200, 100) is inside B: B is current, nothing is edited.
    await t.bus.doubleClick({ x: 200, y: 100 }, true);
    expect(t.told()).toEqual([A, B]);
    // Again (the first click's switch already made B current): nothing changes.
    await t.bus.doubleClick({ x: 200, y: 100 }, true);
    expect(t.told()).toEqual([A, B]);
    // Paper (140, 100) is between the frames: paper space.
    await t.bus.doubleClick({ x: 140, y: 100 }, true);
    expect(t.told()).toEqual([A, B, null]);
  });

  it('does nothing inside a command, in paper space or while maximized', async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 200, y: 100 }, true);
    expect(t.told()).toEqual([]);
    await t.bus.doubleClick({ x: 110, y: 95 });
    await t.bus.script(['LINE']);
    await t.bus.doubleClick({ x: 140, y: 100 }, true);
    expect(t.told()).toEqual([A]);
    await t.bus.cancel();
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.script(['VPMAX']);
    await t.bus.doubleClick({ x: 140, y: 100 }, true);
    expect(t.told()).toEqual([A, A]);
  });
});

describe('VPMAXIMIZEDSTATE', () => {
  it('is 1 while the current viewport is maximized, else 0, and read-only', async () => {
    const t = drawing();
    await t.bus.script(['VPMAXIMIZEDSTATE']);
    expect(t.log.at(-1)).toMatch(/VPMAXIMIZEDSTATE = 0 \(read only\)/);
    await t.bus.script(['MS']);
    await t.bus.script(['VPMAX']);
    await t.bus.script(['VPMAXIMIZEDSTATE']);
    expect(t.log.at(-1)).toMatch(/VPMAXIMIZEDSTATE = 1 \(read only\)/);
    await t.bus.script(['VPMIN']);
    await t.bus.script(['SETVAR', 'VPMAXIMIZEDSTATE']);
    expect(t.log.at(-1)).toMatch(/VPMAXIMIZEDSTATE = 0 \(read only\)/);
  });
});
