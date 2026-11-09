// M2-08: REVCLOUD and WIPEOUT on the PromptBus, driven as the command line drives them, with
// AutoCAD 2024's prompts (AutoCAD 2024 Help, "REVCLOUD (Command)", "WIPEOUT (Command)"). The
// roadmap's acceptance is AutoCAD's structure: a cloud is a closed LWPOLYLINE whose every
// segment has the bulge AutoCAD writes (0.520567, ezdxf `revcloud.REQUIRED_BULGE`) with
// `RevcloudProps` xdata; a wipeout a WIPEOUT framed as AutoCAD 2018 frames one.
// The sample drawing's model space holds 20 (0,0)-(10,0), 21 a circle at (5,5) r 2 and
// 23 (0,0)-(0,10).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  REVCLOUD_BULGE,
  builtinCommands,
  chordLengths,
  cloudPoints,
  cloudRandom,
  cloudRunsOf,
  distinctVertices,
  rectangleCorners,
  signedArea2,
  wipeoutGeometry,
  wipeoutFrame,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityId,
  type HeaderValue,
  type ImageGeometry,
  type LwPolylineGeometry,
  type Vec2,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** A canvas that shows `view` and whose picks take `picked()`. */
function host(view = { width: 300, height: 400 }, picked: () => EntityId[] = () => []): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'get') {
        return Promise.resolve({
          ok: true,
          view: { center: { x: 0, y: 0 }, ...view, paper: false },
        });
      }
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picked() });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

function setup(init: DocumentInit = sampleInit(), view?: ViewHost) {
  const model = DocumentModel.create(init);
  const bus = new PromptBus({ model, registry: builtinCommands(), ...(view && { view }) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const original = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !original.has(e.id));
  return { model, bus, log, added };
}

const withHeader = (entries: [string, HeaderValue][]): DocumentInit => {
  const base = sampleInit();
  return { ...base, header: new Map([...(base.header ?? []), ...entries]) };
};

/** The point halfway along a bulged segment (the arc's middle). */
function arcMiddle(a: Vec2, b: Vec2, bulge: number): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A positive bulge runs counter-clockwise: its middle is right of the chord.
  return { x: (a.x + b.x) / 2 + (bulge * dy) / 2, y: (a.y + b.y) / 2 - (bulge * dx) / 2 };
}

const cloudOf = (e: Entity) => e.geom as LwPolylineGeometry;

/** Every arc's middle outside the box (min, max), as Normal clouds bulge out. */
function bulgesOut(g: LwPolylineGeometry, min: Vec2, max: Vec2): boolean {
  return g.vertices.every((v, i) => {
    const w = g.vertices[(i + 1) % g.vertices.length]!;
    const m = arcMiddle(v, w, v.bulge);
    return m.x < min.x || m.x > max.x || m.y < min.y || m.y > max.y;
  });
}

describe('REVCLOUD', () => {
  it('says its settings and asks for a corner, Object by default', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD']);
    expect(s.log).toContain(
      'Minimum arc length: 0.5000   Maximum arc length: 0.5000   Style: Normal   Type: Rectangular',
    );
    expect(s.bus.promptText).toBe(
      'Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style] <Object>:',
    );
  });

  it('draws a rectangular cloud: a closed LWPOLYLINE of equal arcs bulging out, with RevcloudProps xdata', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '1', '0,0', '10,5']);
    expect(s.bus.command).toBeUndefined();
    const [cloud] = s.added();
    expect(cloud).toMatchObject({ type: 'LWPOLYLINE', owner: MODEL_SPACE, layer: LAYER_WALLS });
    const g = cloudOf(cloud!);
    expect(g.closed).toBe(true);
    // 30 units of perimeter in 1-unit chords, corners kept.
    expect(g.vertices).toHaveLength(30);
    expect(g.vertices.every((v) => v.bulge === REVCLOUD_BULGE)).toBe(true);
    for (const corner of [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ]) {
      expect(g.vertices.some((v) => r6(v.x) === corner[0] && r6(v.y) === corner[1])).toBe(true);
    }
    expect(bulgesOut(g, { x: 0, y: 0 }, { x: 10, y: 5 })).toBe(true);
    const app = [...s.model.tables.appIds.values()].find((r) => r.name === 'RevcloudProps');
    expect(app).toBeDefined();
    expect(cloud!.xdata).toEqual([
      {
        appId: app!.handle,
        values: [
          { code: 1070, value: 0 },
          { code: 1040, value: 1 },
        ],
      },
    ]);
    // A second cloud reuses the application.
    await s.bus.script(['REVCLOUD', '20,0', '15,5']);
    expect(s.added()).toHaveLength(2);
    expect(
      [...s.model.tables.appIds.values()].filter((r) => r.name === 'RevcloudProps'),
    ).toHaveLength(1);
    const second = cloudOf(s.added()[1]!);
    // Corners given right to left: the arcs still bulge out.
    expect(bulgesOut(second, { x: 15, y: 0 }, { x: 20, y: 5 })).toBe(true);
  });

  it('sizes the first arcs from the view, and keeps the settings for the next cloud', async () => {
    const s = setup(sampleInit(), host({ width: 300, height: 400 }));
    await s.bus.script(['REVCLOUD']);
    // Diagonal 500 / 40 = 12.5, to two figures.
    expect(s.log.at(-1)).toMatch(/^Minimum arc length: 13\.0000 {3}Maximum arc length: 13\.0000/);
    await s.bus.script(['S', 'C', 'P']);
    expect(s.log).toContain('Arc style = Calligraphy');
    expect(s.bus.promptText).toMatch(/^Specify start point or/);
    await s.bus.cancel();
    await s.bus.script(['REVCLOUD']);
    expect(s.log.at(-1)).toBe(
      'Minimum arc length: 13.0000   Maximum arc length: 13.0000   Style: Calligraphy   Type: Polygonal',
    );
  });

  it('starts from 0.5 × DIMSCALE without a view', async () => {
    const s = setup(withHeader([['$DIMSCALE', 4]]));
    await s.bus.script(['REVCLOUD']);
    expect(s.log.at(-1)).toMatch(/^Minimum arc length: 2\.0000/);
  });

  it('varies the arcs between the minimum and maximum, and refuses a maximum over 3 × the minimum', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '0.5']);
    expect(s.log).toContain('Maximum arc length cannot be less than minimum arc length.');
    await s.bus.script(['4']);
    expect(s.log).toContain('Maximum arc length cannot exceed 3 times the minimum arc length.');
    await s.bus.script(['2', '0,0', '40,40']);
    const g = cloudOf(s.added()[0]!);
    const chords = g.vertices.map((v, i) => {
      const w = g.vertices[(i + 1) % g.vertices.length]!;
      return Math.hypot(w.x - v.x, w.y - v.y);
    });
    expect(Math.min(...chords)).toBeGreaterThan(0.9);
    expect(Math.max(...chords)).toBeLessThan(2.1);
    expect(new Set(chords.map((c) => c.toFixed(3))).size).toBeGreaterThan(5);
  });

  it('draws a calligraphy cloud with arcs widening from 0', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '2', '2', 'S', '', 'S', 'C', '0,0', '10,10']);
    const g = cloudOf(s.added()[0]!);
    expect(g.vertices.every((v) => v.startWidth === 0 && r6(v.endWidth!) === 0.2)).toBe(true);
  });

  it('draws a polygonal cloud through the points given, closed on Enter', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '1', 'P', '0,0']);
    expect(s.bus.promptText).toBe('Specify next point:');
    expect(s.bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 } } });
    await s.bus.script(['5,0']);
    expect(s.bus.promptText).toBe('Specify next point or [Undo]:');
    await s.bus.script(['']);
    expect(s.log).toContain('A polygonal cloud needs three or more points.');
    await s.bus.script(['9,9', 'U', '5,5', '']);
    const g = cloudOf(s.added()[0]!);
    expect(g.closed).toBe(true);
    // Sides 5, 5 and 7.07: 5 + 5 + 7 arcs.
    expect(g.vertices).toHaveLength(17);
    expect(g.vertices.every((v) => Math.abs(v.bulge) === REVCLOUD_BULGE)).toBe(true);
    // Clockwise points (0,0) (5,0) (5,5) go counter-clockwise: positive bulges, out.
    expect(g.vertices[0]!.bulge).toBe(REVCLOUD_BULGE);
  });

  it('follows the crosshairs freehand and closes back at the start', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '1', 'F', '0,0']);
    expect(s.bus.promptText).toBe('Guide crosshairs along cloud path:');
    expect(s.bus.prompt).toMatchObject({ trace: { from: { x: 0, y: 0 }, spacing: 1 } });
    for (const p of ['1,0', '2,0', '2,1', '2,2', '1,2', '0,2', '0,1']) await s.bus.submit(p);
    expect(s.added()).toHaveLength(0);
    expect(s.bus.prompt).toMatchObject({ trace: { from: { x: 0, y: 1 } } });
    await s.bus.submit('0,0.2');
    expect(s.log).toContain('Revision cloud finished.');
    const g = cloudOf(s.added()[0]!);
    expect(g.closed).toBe(true);
    expect(g.vertices).toHaveLength(8);
    expect(bulgesOut(g, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });

  it('ends a freehand cloud open on Enter, and reverses it when asked', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '1', 'F', '0,0', '1,0', '2,0', '']);
    expect(s.bus.promptText).toBe('Reverse direction [Yes/No] <No>:');
    await s.bus.script(['Y']);
    const g = cloudOf(s.added()[0]!);
    expect(g.closed).toBe(false);
    expect(g.vertices.map((v) => v.bulge)).toEqual(
      [REVCLOUD_BULGE, REVCLOUD_BULGE, 0].map((b, i) => (i < 2 ? -b : b) + 0),
    );
  });

  it('turns a circle into a cloud in its place, with its properties', async () => {
    const init = sampleInit();
    let picks: EntityId[] = [];
    const s = setup(
      init,
      host(undefined, () => picks),
    );
    const circle = s.model.entityByHandle('21')!;
    picks = [circle.id];
    await s.bus.script(['REVCLOUD', 'A', '1', '1', '']);
    expect(s.bus.promptText).toBe('Select object:');
    await s.bus.script(['5,7']);
    expect(s.bus.promptText).toBe('Reverse direction [Yes/No] <No>:');
    await s.bus.script(['']);
    expect(s.model.entityByHandle('21')).toBeUndefined();
    const [cloud] = s.added();
    expect(cloud).toMatchObject({ type: 'LWPOLYLINE', layer: circle.layer, owner: MODEL_SPACE });
    const g = cloudOf(cloud!);
    // Circumference 4π ≈ 12.57: 13 arcs.
    expect(g.vertices).toHaveLength(13);
    expect(g.vertices.every((v) => Math.abs(Math.hypot(v.x - 5, v.y - 5) - 2) < 1e-3)).toBe(true);
    expect(bulgesOut(g, { x: 3.6, y: 3.6 }, { x: 6.4, y: 6.4 })).toBe(true);
    expect(s.log.at(-1)).toBe('Revision cloud finished.');
  });

  it('refuses objects it cannot convert, and asks again', async () => {
    let picks: EntityId[] = [];
    const s = setup(
      sampleInit(),
      host(undefined, () => picks),
    );
    picks = [s.model.entityByHandle('20')!.id];
    await s.bus.script(['REVCLOUD', 'O', '5,0']);
    expect(s.log).toContain('Select a circle, ellipse, polyline or spline.');
    expect(s.bus.promptText).toBe('Select object:');
    await s.bus.cancel();
    expect(s.added()).toHaveLength(0);
  });

  it('refuses a cloud that would need too many arcs', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '0.001', '0.001', '0,0', '10000,10000']);
    expect(s.log.at(-1)).toMatch(/^The arc length is too small for this cloud/);
    expect(s.added()).toHaveLength(0);
  });
});

describe('REVCLOUD ends and refusals', () => {
  it('refuses an arc length that is not positive', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '0']);
    expect(s.log).toContain('Requires a positive value.');
    expect(s.bus.promptText).toBe('Specify minimum length of arc <0.5000>:');
  });

  it('ends without a cloud on Enter at the opposite corner, or with corners in a line', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', '0,0', '']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['REVCLOUD', '0,0', '5,0']);
    expect(s.log).toContain('The corners must not be on one horizontal or vertical line.');
    expect(s.added()).toHaveLength(0);
  });

  it('ends a polygonal cloud of one point on Enter, and refuses one of too many arcs', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'P', '0,0', '']);
    expect(s.log).toContain('A polygonal cloud needs three or more points.');
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['REVCLOUD', 'A', '0.01', '0.01', '0,0', '100,0', '100,100', '']);
    expect(s.log.at(-1)).toMatch(/^The arc length is too small/);
    expect(s.added()).toHaveLength(0);
  });

  it('ends a freehand cloud of one point on Enter, and ignores a point given twice', async () => {
    const s = setup();
    await s.bus.script(['REVCLOUD', 'A', '1', '1', 'F', '0,0', '']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['REVCLOUD', '0,0', '0,0']);
    expect(s.bus.prompt).toMatchObject({ trace: { from: { x: 0, y: 0 } } });
    await s.bus.cancel();
    expect(s.added()).toHaveLength(0);
  });

  it('ends Object on Enter with nothing selected', async () => {
    const s = setup(sampleInit(), host());
    await s.bus.script(['REVCLOUD', 'O', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toHaveLength(0);
  });
});

describe('revision cloud geometry', () => {
  it('cuts a run into chords adding up to it, each within the limits where it can be', () => {
    const next = cloudRandom(7);
    const c = chordLengths(10, { minArc: 1, maxArc: 2, calligraphy: false }, next);
    expect(r6(c.reduce((a, b) => a + b, 0))).toBe(10);
    expect(c.every((x) => x >= 1 - 1e-9 && x <= 2 + 1e-9)).toBe(true);
    expect(chordLengths(0, { minArc: 1, maxArc: 1, calligraphy: false }, next)).toEqual([]);
    // Shorter than an arc: one.
    expect(chordLengths(0.3, { minArc: 1, maxArc: 1, calligraphy: false }, next)).toEqual([0.3]);
  });

  it('keeps clouds reproducible', () => {
    const a = cloudRandom();
    const b = cloudRandom();
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('orders rectangle corners counter-clockwise from the first', () => {
    expect(signedArea2(rectangleCorners({ x: 0, y: 0 }, { x: 4, y: -3 }))).toBeGreaterThan(0);
    expect(signedArea2(rectangleCorners({ x: 4, y: 3 }, { x: 0, y: 0 }))).toBeGreaterThan(0);
  });

  it('converts polylines segment by segment, ellipses and splines along their length', () => {
    const style = { minArc: 1, maxArc: 1, calligraphy: false };
    const square = cloudRunsOf(
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 4, y: 0, bulge: 0 },
          { x: 4, y: 4, bulge: 1 },
          { x: 0, y: 4, bulge: 0 },
        ],
      },
      0.01,
    )!;
    expect(square.closed).toBe(true);
    expect(square.runs).toHaveLength(4);
    const pts = cloudPoints(square.runs, true, style);
    // 4 + 2π (≈ 6) + 4 + 4 arcs.
    expect(pts).toHaveLength(18);
    const ellipse = cloudRunsOf(
      {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 3, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: Math.PI,
      },
      0.01,
    )!;
    expect(ellipse.closed).toBe(false);
    const open = cloudPoints(ellipse.runs, false, style);
    expect(open[0]).toEqual({ x: 3, y: 0 });
    expect(r6(open.at(-1)!.x)).toBe(-3);
    const spline = cloudRunsOf(
      {
        kind: 'SPLINE',
        degree: 1,
        knots: [0, 0, 1, 1],
        controlPoints: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
        ],
        closed: false,
        periodic: false,
      },
      0.01,
    )!;
    expect(cloudPoints(spline.runs, false, style)).toHaveLength(4);
    expect(cloudRunsOf({ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, 0.01)).toBe(
      undefined,
    );
    expect(
      cloudRunsOf({ kind: 'LWPOLYLINE', closed: false, vertices: [{ x: 0, y: 0, bulge: 0 }] }, 1),
    ).toBe(undefined);
  });
});

describe('WIPEOUT', () => {
  const wipeouts = (s: ReturnType<typeof setup>) =>
    s.added().filter((e) => e.type === 'WIPEOUT') as (Entity & { geom: ImageGeometry })[];

  it('masks the polygon picked, framed as AutoCAD frames a wipeout', async () => {
    const s = setup();
    await s.bus.script(['WIPEOUT']);
    expect(s.bus.promptText).toBe('Specify first point or [Frames/Polyline] <Polyline>:');
    await s.bus.script(['0,0', '4,0']);
    expect(s.bus.promptText).toBe('Specify next point or [Undo]:');
    await s.bus.script(['4,2']);
    expect(s.bus.promptText).toBe('Specify next point or [Close/Undo]:');
    await s.bus.script(['0,2', 'C']);
    const [w] = wipeouts(s);
    expect(w).toMatchObject({ owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(w!.geom).toEqual({
      kind: 'WIPEOUT',
      position: { x: 0, y: 0 },
      u: { x: 4, y: 0 },
      v: { x: 0, y: 4 },
      size: { x: 1, y: 1 },
      displayFlags: 7,
      clipping: true,
      brightness: 50,
      contrast: 50,
      fade: 0,
      clip: {
        type: 'polygon',
        inverted: false,
        vertices: [
          { x: -0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0 },
          { x: -0.5, y: 0 },
          { x: -0.5, y: 0.5 },
        ],
      },
    });
  });

  it('needs three points, and takes back the last with Undo', async () => {
    const s = setup();
    await s.bus.script(['WIPEOUT', '0,0', '1,0', '']);
    expect(s.log).toContain('A wipeout needs three or more points.');
    await s.bus.script(['2,2', 'U', '1,1', '']);
    expect(wipeouts(s)).toHaveLength(1);
    expect(wipeouts(s)[0]!.geom.clip.vertices).toHaveLength(4);
  });

  it('turns a closed polyline into a wipeout, erasing it when asked', async () => {
    const init = sampleInit();
    const poly = entityInit('30', {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 2, y: 0, bulge: 0 },
        { x: 2, y: 2, bulge: 0 },
      ],
    });
    const open = entityInit('31', {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 5, y: 0, bulge: 0 },
        { x: 6, y: 0, bulge: 0 },
      ],
    });
    let picks: EntityId[] = [];
    const s = setup(
      { ...init, entities: [...init.entities!, poly, open] },
      host(undefined, () => picks),
    );
    picks = [s.model.entityByHandle('31')!.id];
    await s.bus.script(['WIPEOUT', '', '5,0']);
    expect(s.log).toContain('Polyline must be closed.');
    picks = [s.model.entityByHandle('30')!.id];
    await s.bus.script(['1,0']);
    expect(s.bus.promptText).toBe('Erase polyline [Yes/No] <No>:');
    await s.bus.script(['Y']);
    expect(s.model.entityByHandle('30')).toBeUndefined();
    expect(wipeouts(s)[0]!.geom.clip.vertices).toHaveLength(4);
    picks = [s.model.entityByHandle('31')!.id];
    await s.bus.script(['WIPEOUT', 'P', '5,0']);
    await s.bus.cancel();
  });

  it('refuses a closed polyline with no area, and ends on Enter with nothing selected', async () => {
    const init = sampleInit();
    const flat = entityInit('32', {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 3, y: 0, bulge: 0 },
      ],
    });
    let picks: EntityId[] = [];
    const s = setup(
      { ...init, entities: [...init.entities!, flat] },
      host(undefined, () => picks),
    );
    picks = [s.model.entityByHandle('32')!.id];
    await s.bus.script(['WIPEOUT', 'P', '1,0']);
    expect(s.log).toContain('Polyline must enclose an area.');
    picks = [];
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(wipeouts(s)).toHaveLength(0);
  });

  it('turns frames off and on through the drawing’s WIPEOUTVARIABLES', async () => {
    const init = { ...sampleInit(), meta: { ...sampleInit().meta, rootDictionary: 'C' } };
    const s = setup(init);
    expect(wipeoutFrame(s.model)).toBe(true);
    await s.bus.script(['WIPEOUT', 'F']);
    expect(s.bus.promptText).toBe('Enter mode [ON/OFF] <ON>:');
    await s.bus.script(['ON']);
    expect([...s.model.objects.values()].some((o) => o.type === 'WIPEOUTVARIABLES')).toBe(false);
    await s.bus.script(['WIPEOUT', 'F', 'OFF']);
    const vars = [...s.model.objects.values()].find((o) => o.type === 'WIPEOUTVARIABLES');
    expect(vars).toMatchObject({ owner: 'C', frame: false });
    expect(wipeoutFrame(s.model)).toBe(false);
    await s.bus.script(['WIPEOUT', 'F', '', 'WIPEOUT', 'F', 'ON']);
    expect(wipeoutFrame(s.model)).toBe(true);
  });

  it('says so when the drawing has nowhere to keep WIPEOUTFRAME', async () => {
    const s = setup();
    await s.bus.script(['WIPEOUT', 'F', 'OFF']);
    expect(s.log.at(-1)).toBe(
      'The drawing has no named object dictionary to keep WIPEOUTFRAME in.',
    );
  });

  it('frames the larger side square, with Y down in pixel space', () => {
    const g = wipeoutGeometry([
      { x: 10, y: 20 },
      { x: 12, y: 20 },
      { x: 12, y: 28 },
    ]);
    expect(g.position).toEqual({ x: 10, y: 20 });
    expect(g.u).toEqual({ x: 8, y: 0 });
    expect(g.clip.vertices).toEqual([
      { x: -0.5, y: 0.5 },
      { x: -0.25, y: 0.5 },
      { x: -0.25, y: -0.5 },
      { x: -0.5, y: 0.5 },
    ]);
    expect(
      distinctVertices(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 0 },
        ],
        0,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });
});
