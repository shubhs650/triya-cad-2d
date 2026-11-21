// M6-02 part 16: edits that turn with a layout viewport.
//
// - A window dragged in a twisted viewport is square to the screen (part 15), so in model space
//   it is a turned rectangle: STRETCH (with its window given at its prompt or before it, at
//   `Command:`) and TRIM's and EXTEND's crossing windows take what that rectangle holds, not
//   the box round its two corners.
// - ROTATE turns a viewport by any angle, its view with it (VPROTATEASSOC 1, AutoCAD's default:
//   "the view within a viewport is rotated with the viewport"). A VIEWPORT's frame is square to
//   the sheet, so one turned by other than right angles is clipped to its turned frame, as
//   AutoCAD makes a turned rectangular viewport a clipped one; a clipped one turns with its
//   boundary and is framed by the boundary's box.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  FLOATING_VIEWPORT_FLAGS,
  PromptBus,
  VIEWPORT_NON_RECT_CLIP,
  builtinCommands,
  modelPointOf,
  type EntityGeometry,
  type LwPolylineGeometry,
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
  entityInit,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 40,
  height: 30,
  id: 2,
  status: 2,
  flags: FLOATING_VIEWPORT_FLAGS,
  viewCenter: { x: 3, y: -4 },
  viewHeight: 15,
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

const close = (p: { x: number; y: number }, x: number, y: number, digits = 9) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};

/** `q` turned by `angle` about `c`. */
const turned = (q: { x: number; y: number }, c: { x: number; y: number }, angle: number) => ({
  x: c.x + (q.x - c.x) * Math.cos(angle) - (q.y - c.y) * Math.sin(angle),
  y: c.y + (q.x - c.x) * Math.sin(angle) + (q.y - c.y) * Math.cos(angle),
});

const CORNERS = [
  { x: 80, y: 85 },
  { x: 120, y: 85 },
  { x: 120, y: 115 },
  { x: 80, y: 115 },
];

const VP = '50';
const BOUNDARY = '4F';

/** A layout holding `paper`, worked in with `answer` giving the canvas's replies. */
function drawing(
  paper: [string, EntityGeometry, string[]?][],
  model: [string, EntityGeometry][] = [],
  answer: (r: ViewRequest) => ViewReply = (r) =>
    r.op === 'pick' ? { ok: true, ids: [] } : { ok: true },
) {
  const init = sampleInit();
  const doc = DocumentModel.create({
    ...init,
    entities: [
      ...model.map(([h, g]) => entityInit(h, g)),
      ...paper.map(([h, g, reactors]) =>
        entityInit(h, g, {
          owner: PAPER_SPACE,
          layer: h === VP ? LAYER_WALLS : LAYER_0,
          ...(reactors && { reactors }),
        }),
      ),
    ],
  });
  const requests: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r) => {
      requests.push(r);
      return Promise.resolve(answer(r));
    },
  };
  const bus = new PromptBus({
    model: doc,
    registry: builtinCommands(),
    view,
    space: () => PAPER_SPACE,
  });
  const byHandle = (h: string) => doc.entityByHandle(h)!;
  const vp = (h = VP) => byHandle(h).geom as ViewportGeometry;
  const paperKinds = () => doc.blockEntities(PAPER_SPACE).map((id) => doc.entity(id)!.geom.kind);
  return { model: doc, bus, requests, byHandle, vp, paperKinds };
}

/** Each frame corner of `before` shows, turned by `angle` about `c`, the same model point. */
function keepsModel(
  before: ViewportGeometry,
  after: ViewportGeometry,
  c: { x: number; y: number },
  angle: number,
) {
  for (const q of [...CORNERS, before.center]) {
    const was = modelPointOf(before, q);
    close(modelPointOf(after, turned(q, c, angle)), was.x, was.y);
  }
}

describe('ROTATE turns a viewport by any angle', () => {
  it('turned by a quarter, it shows the same part of the model, unclipped', async () => {
    const t = drawing([[VP, viewport()]]);
    const before = t.vp();
    await t.bus.script(['ROTATE', 'ALL', '', '110,100', '90']);
    const after = t.vp();
    expect(after.twist).toBeCloseTo(Math.PI / 2, 12);
    expect([after.width, after.height]).toEqual([30, 40]);
    expect(after.clipBoundary).toBeUndefined();
    keepsModel(before, after, { x: 110, y: 100 }, Math.PI / 2);
  });

  it('turned by 30°, it is clipped to its turned frame and keeps its view', async () => {
    const t = drawing([[VP, viewport({ twist: 0.2 })]]);
    const before = t.vp();
    await t.bus.script(['ROTATE', 'ALL', '', '100,100', '30']);
    const a = Math.PI / 6;
    const after = t.vp();
    expect(after.twist).toBeCloseTo(0.2 + a, 12);
    expect(after.flags).toBe(FLOATING_VIEWPORT_FLAGS | VIEWPORT_NON_RECT_CLIP);
    close(after.center, 100, 100);
    expect(after.width).toBeCloseTo(40 * Math.cos(a) + 30 * Math.sin(a), 9);
    expect(after.height).toBeCloseTo(40 * Math.sin(a) + 30 * Math.cos(a), 9);
    keepsModel(before, after, { x: 100, y: 100 }, a);
    // Its boundary: a closed polyline through the turned frame's corners, with the
    // viewport's layer, listing the viewport among its reactors.
    const boundary = t.byHandle(after.clipBoundary!);
    const g = boundary.geom as LwPolylineGeometry;
    expect(g.kind).toBe('LWPOLYLINE');
    expect(g.closed).toBe(true);
    g.vertices.forEach((v, i) => {
      const q = turned(CORNERS[i]!, { x: 100, y: 100 }, a);
      close(v, q.x, q.y);
      expect(v.bulge).toBe(0);
    });
    expect(boundary.owner).toBe(PAPER_SPACE);
    expect(boundary.layer).toBe(LAYER_WALLS);
    expect(boundary.reactors).toEqual([VP]);
    // One undo step takes it all back.
    await t.bus.script(['U']);
    expect(t.vp()).toEqual(before);
    expect(t.paperKinds()).toEqual(['VIEWPORT']);
  });

  it('a clipped viewport turns with its boundary, framed by the boundary’s box', async () => {
    const triangle: LwPolylineGeometry = {
      kind: 'LWPOLYLINE',
      vertices: [
        { x: 80, y: 85, bulge: 0 },
        { x: 120, y: 85, bulge: 0 },
        { x: 100, y: 115, bulge: 0 },
      ],
      closed: true,
    };
    const clipped = viewport({
      clipBoundary: BOUNDARY,
      flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_NON_RECT_CLIP,
    });
    const t = drawing([
      [BOUNDARY, triangle, [VP]],
      [VP, clipped],
    ]);
    const before = t.vp();
    await t.bus.script(['ROTATE', 'ALL', '', '100,100', '-45']);
    const a = -Math.PI / 4;
    const after = t.vp();
    expect(after.clipBoundary).toBe(BOUNDARY);
    expect(t.paperKinds()).toEqual(['LWPOLYLINE', 'VIEWPORT']);
    const vs = (t.byHandle(BOUNDARY).geom as LwPolylineGeometry).vertices;
    vs.forEach((v, i) => {
      const q = turned(triangle.vertices[i]!, { x: 100, y: 100 }, a);
      close(v, q.x, q.y);
    });
    const xs = vs.map((v) => v.x);
    const ys = vs.map((v) => v.y);
    close(
      after.center,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    expect(after.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 9);
    expect(after.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 9);
    expect(after.twist).toBeCloseTo(2 * Math.PI + a, 12);
    keepsModel(before, after, { x: 100, y: 100 }, a);
  });

  it('a turned copy is clipped by a boundary of its own, the original left as it was', async () => {
    const t = drawing([[VP, viewport()]]);
    const before = t.vp();
    await t.bus.script(['ROTATE', 'ALL', '', '200,100', 'C', '60']);
    expect(t.vp()).toEqual(before);
    const copies = t.model
      .blockEntities(PAPER_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.handle !== VP);
    expect(copies.map((e) => e.geom.kind).sort()).toEqual(['LWPOLYLINE', 'VIEWPORT']);
    const copy = copies.find((e) => e.geom.kind === 'VIEWPORT')!;
    const g = copy.geom as ViewportGeometry;
    const boundary = copies.find((e) => e.geom.kind === 'LWPOLYLINE')!;
    expect(g.clipBoundary).toBe(boundary.handle);
    expect(boundary.reactors).toEqual([copy.handle]);
    expect(g.id).toBe(3);
    keepsModel(before, g, { x: 200, y: 100 }, Math.PI / 3);
  });
});

/**
 * A viewport twisted 45°, 1:1, showing model 0,0 at paper 300,100, made current. A window from
 * model (−d, 0) to (d, 0), d = 5√2, is square to the screen: on the sheet it runs from 5 left
 * and 5 below the centre to 5 right and 5 above, and in model space it is the square turned 45°
 * whose corners are (±d, 0) and (0, ±d). The box round its two corners is the line y = 0.
 */
const D = 5 * Math.SQRT2;
const TWISTED = viewport({
  center: { x: 300, y: 100 },
  viewCenter: { x: 0, y: 0 },
  viewHeight: 30,
  twist: Math.PI / 4,
});
const LINE = '60';
const UPRIGHT = '61';

function twisted(model: [string, EntityGeometry][]) {
  const shown: { model?: DocumentModel } = {};
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op === 'pick') return { ok: true, ids: [] };
    // The canvas's own answer: the line crosses the window and lies wholly in none.
    const line = shown.model!.ids.idOf(LINE)!;
    if (r.op === 'select') return { ok: true, ids: [line] };
    if (r.op === 'selectPath') return { ok: true, ids: r.kind === 'crossing' ? [line] : [] };
    return { ok: true };
  };
  const t = drawing([[VP, TWISTED]], model, answer);
  shown.model = t.model;
  const line = (h: string) => {
    const g = t.byHandle(h).geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v * 1e9) / 1e9);
  };
  return { ...t, line };
}

describe('windows square to a twisted viewport’s screen', () => {
  it('STRETCH moves the points inside the turned window, not inside its corners’ box', async () => {
    const t = twisted([[LINE, lineGeom(0, 3, 20, 3)]]);
    await t.bus.script(['MS']);
    await t.bus.script(['STRETCH', 'C', `${-D},0`, `${D},0`, '', '0,0', '0,1']);
    // (0, 3) is inside the turned square (|x| + |y| ≤ d), (20, 3) is not.
    expect(t.line(LINE)).toEqual([0, 4, 20, 3]);
    // The canvas was asked what the window's four corners hold.
    const paths = t.requests.flatMap((r) => (r.op === 'selectPath' ? [r] : []));
    expect(paths.map((r) => r.kind)).toEqual(['window', 'crossing']);
    const corners = paths[0]!.points;
    expect(corners).toHaveLength(4);
    close(corners[1]!, 0, -D);
    close(corners[3]!, 0, D);
  });

  it('STRETCH takes a window made at Command: before it the same way', async () => {
    const t = twisted([[LINE, lineGeom(0, 3, 20, 3)]]);
    await t.bus.script(['MS']);
    await t.bus.pick({ x: -D, y: 0 });
    await t.bus.pick({ x: D, y: 0 });
    await t.bus.script(['STRETCH', '0,0', '0,1']);
    expect(t.line(LINE)).toEqual([0, 4, 20, 3]);
  });

  it('TRIM’s crossing window trims what crosses the turned window', async () => {
    // The square round (5, 0): |x − 5| + |y| ≤ d. The line y = 3 crosses it; x = −3 does not.
    const t = twisted([
      [LINE, lineGeom(-10, 3, 10, 3)],
      [UPRIGHT, lineGeom(-3, -10, -3, 10)],
    ]);
    await t.bus.script(['MS']);
    await t.bus.script(['TRIM', 'C', `${5 - D},0`, `${5 + D},0`, '']);
    expect(t.line(LINE)).toEqual([-10, 3, -3, 3]);
    expect(t.line(UPRIGHT)).toEqual([-3, -10, -3, 10]);
    expect(t.model.blockEntities(MODEL_SPACE)).toHaveLength(2);
  });
});
