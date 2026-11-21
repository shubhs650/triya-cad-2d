// M6-02 part 15: twisted layout viewports (DXF 51). A plan view turned on the sheet is worked
// in like any other (AutoCAD 2024 Help, "VIEWTWIST": "Stores the view rotation angle for the
// current viewport measured relative to the WCS"; "UCS (Command)", View: "Aligns the XY plane of
// the UCS to a plane perpendicular to your viewing direction"). The cursor's point on the sheet
// maps to model space's XY plane by a turn, a scale and a move, so MSPACE, a double click, a
// click into it, ZOOM and PAN in it and the UCS View option take it.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PromptBus,
  builtinCommands,
  modelPointOf,
  paperPointOf,
  ucsOf,
  viewportTwist,
  viewportViewOf,
  withViewportView,
  workableViewport,
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

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

/**
 * A: untwisted, 1:1 about model 0,0, its frame paper 80..120 × 85..115. T: twisted a quarter
 * turn, 1:1 about model 0,0 at paper 300,100 (model +X shows as paper +Y), frame 280..320 ×
 * 85..115. T is stacked first, so MSPACE makes it current.
 */
const A = '50';
const T = '51';
const QUARTER = Math.PI / 2;
const TWISTED = viewport({ id: 3, status: 2, center: { x: 300, y: 100 }, twist: QUARTER });

function drawing() {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    entities: [
      ...(init.entities ?? []),
      ...(
        [
          [A, viewport({ id: 2, status: 3 })],
          [T, TWISTED],
        ] as [string, EntityGeometry][]
      ).map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_0 })),
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
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => PAPER_SPACE });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const told = () => requests.flatMap((r) => (r.op === 'viewport' ? [r.viewport] : []));
  const picked = () => requests.filter((r) => r.op === 'pick').length;
  const lastLine = () => {
    const e = model.entity(Math.max(...model.blockEntities(MODEL_SPACE)))!;
    return e.geom.kind === 'LINE' ? { start: e.geom.start, end: e.geom.end } : undefined;
  };
  return { model, bus, log, told, picked, lastLine };
}

describe('a twisted viewport’s map between the sheet and model space', () => {
  it('can be worked in when in plan, whatever its twist', () => {
    for (const twist of [0.1, Math.PI / 6, QUARTER, Math.PI, 5.5]) {
      expect(workableViewport(viewport({ twist }))).toBe(true);
    }
    // Not in plan: a 3D view a 2D canvas cannot work through.
    expect(workableViewport(viewport({ twist: 0.3, viewDirection: { x: 1, y: -1, z: 1 } }))).toBe(
      false,
    );
    expect(workableViewport(viewport({ viewDirection: { x: 0, y: 0, z: -1 } }))).toBe(false);
  });

  it('turns model space counterclockwise on the sheet by the twist', () => {
    expect(viewportTwist(TWISTED)).toBeCloseTo(QUARTER, 12);
    expect(viewportTwist(viewport({ twist: 2 * Math.PI - 0.5 }))).toBeCloseTo(
      2 * Math.PI - 0.5,
      12,
    );
    expect(viewportTwist(viewport())).toBe(0);
    close(paperPointOf(TWISTED, { x: 10, y: 0 }), 300, 110);
    close(paperPointOf(TWISTED, { x: 0, y: 10 }), 290, 100);
    close(modelPointOf(TWISTED, { x: 300, y: 110 }), 10, 0);
    close(modelPointOf(TWISTED, { x: 290, y: 100 }), 0, 10);
  });

  it('gives and takes its view as model space has it', () => {
    const g = viewport({ twist: Math.PI / 6, viewCenter: { x: 4, y: -2 }, viewHeight: 60 });
    const v = viewportViewOf(g);
    close(paperPointOf(g, v.center), 100, 100);
    expect(v.height).toBe(60);
    const moved = withViewportView(g, { center: { x: 7, y: 3 }, height: 15 });
    close(viewportViewOf(moved).center, 7, 3);
    close(paperPointOf(moved, { x: 7, y: 3 }), 100, 100);
    expect(moved.twist).toBe(g.twist);
    expect(moved.viewHeight).toBe(15);
  });
});

describe('working in a twisted viewport', () => {
  it('MSPACE makes it current and commands draw in model space through it', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    expect(t.told()).toEqual([T]);
    await t.bus.script(['LINE', '0,0', '5,0', '']);
    expect(t.lastLine()).toEqual({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });
  });

  it('a double click inside its frame makes it current', async () => {
    const t = drawing();
    await t.bus.doubleClick({ x: 310, y: 95 });
    expect(t.told()).toEqual([T]);
  });

  it('a click is inside or outside its frame as the sheet shows it', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    const before = t.picked();
    // Model 12,0 shows at paper 300,112: inside T's frame (85..115), so it picks.
    await t.bus.pick({ x: 12, y: 0 });
    expect(t.told()).toEqual([T]);
    expect(t.picked()).toBe(before + 1);
    // Model 0,200 shows at paper 100,100, inside A: a click there switches to A.
    const u = drawing();
    await u.bus.script(['MS']);
    const was = u.picked();
    await u.bus.pick({ x: 0, y: 200 });
    expect(u.told()).toEqual([T, A]);
    expect(u.picked()).toBe(was);
  });

  it('VIEWTWIST is the current viewport’s twist, 0 in paper space, and read only', async () => {
    const t = drawing();
    await t.bus.script(['VIEWTWIST']);
    expect(t.log.at(-1)).toMatch(/^VIEWTWIST = 0 \(read only\)$/);
    await t.bus.script(['MS']);
    await t.bus.script(['VIEWTWIST']);
    expect(t.log.at(-1)).toMatch(/^VIEWTWIST = 90 \(read only\)$/);
    await t.bus.script(['SETVAR', 'VIEWTWIST']);
    expect(t.log.at(-1)).toMatch(/^VIEWTWIST = 90 \(read only\)$/);
    await t.bus.doubleClick({ x: 0, y: 200 });
    await t.bus.script(['VIEWTWIST']);
    expect(t.log.at(-1)).toMatch(/^VIEWTWIST = 0 \(read only\)$/);
  });

  it('UCS View lines the UCS up with the sheet: X across the twisted viewport', async () => {
    const t = drawing();
    await t.bus.script(['MS']);
    await t.bus.script(['UCS', 'V']);
    const ucs = ucsOf(t.model.header, false);
    // The view turns model space a quarter turn counterclockwise, so the screen's X is model -Y.
    expect(ucs.angle).toBeCloseTo((3 * Math.PI) / 2, 12);
  });
});
