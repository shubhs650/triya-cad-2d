// M3-01: CIRCLE scripted on the PromptBus as the command line drives it, one test per method
// AutoCAD 2024 offers (Center Radius/Diameter, 3P, 2P, Ttr), with its prompts and refusals.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  OSNAP,
  PromptBus,
  SpatialIndex,
  osnap,
  toleranceForSize,
  type DeferredModes,
  type PointPrompt,
  builtinCommands,
  dragMotion,
  tangentTarget,
  type BusEvent,
  type Entity,
  type EntityGeometry,
  type ViewHost,
} from '../../src/index';
import { entityInit, LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** The canvas's pick: what lies within 0.5 of the point (lines and circles here). */
export function pickHost(model: DocumentModel): ViewHost {
  const near = (g: EntityGeometry, p: { x: number; y: number }): boolean => {
    if (g.kind === 'LINE') {
      const dx = g.end.x - g.start.x;
      const dy = g.end.y - g.start.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - g.start.x) * dx + (p.y - g.start.y) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(p.x - g.start.x - t * dx, p.y - g.start.y - t * dy) <= 0.5;
    }
    if (g.kind === 'CIRCLE' || g.kind === 'ARC') {
      return Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius) <= 0.5;
    }
    return false;
  };
  return {
    request: (r) =>
      Promise.resolve(
        r.op === 'pick'
          ? {
              ok: true,
              ids: [...model.entities()].filter((e) => near(e.geom, r.point)).map((e) => e.id),
            }
          : { ok: false, message: 'not drawn' },
      ),
  };
}

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands(), view: pickHost(model) });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const circles = () =>
    added().map((e) => {
      const g = e.geom as { center: { x: number; y: number }; radius: number };
      return [r6(g.center.x), r6(g.center.y), r6(g.radius)];
    });
  return { model, bus, events, added, circles };
}

describe('CIRCLE', () => {
  it('draws C ↵ 10,10 ↵ 5 ↵ on the current layer, and offers the radius next time', async () => {
    const { bus, added, circles, events } = setup();
    await bus.script(['C', '10,10']);
    expect(bus.promptText).toBe('Specify radius of circle or [Diameter]:');
    await bus.submit('5');
    expect(circles()).toEqual([[10, 10, 5]]);
    expect(added()[0]).toMatchObject({ type: 'CIRCLE', owner: MODEL_SPACE, layer: LAYER_WALLS });
    expect(bus.history.slice(0, 2)).toEqual([
      'Command: C',
      'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]: 10,10',
    ]);
    expect(events.filter((e) => e.type === 'commit')).toHaveLength(1);
    // CIRCLERAD: the last radius is the next default.
    await bus.script(['CIRCLE', '0,0']);
    expect(bus.promptText).toBe('Specify radius of circle or [Diameter] <5.0000>:');
    await bus.submit('');
    expect(circles()).toEqual([
      [10, 10, 5],
      [0, 0, 5],
    ]);
  });

  it('takes a picked radius, and drags the circle with the cursor', async () => {
    const { bus, circles } = setup();
    await bus.script(['C', '0,0']);
    const drag = bus.prompt?.drag;
    expect(drag).toMatchObject({ kind: 'sketch', layer: LAYER_WALLS });
    expect(dragMotion(drag!, { x: 3, y: 4 })?.adding?.geom).toMatchObject({
      kind: 'CIRCLE',
      radius: 5,
    });
    expect(dragMotion(drag!, { x: 0, y: 0 })).toBeUndefined();
    await bus.answer({ kind: 'point', point: { x: 0, y: 7 } });
    expect(circles()).toEqual([[0, 0, 7]]);
  });

  it('Diameter halves the value, defaulting to twice the last radius', async () => {
    const { bus, circles } = setup();
    await bus.script(['C', '0,0', 'D']);
    expect(bus.promptText).toBe('Specify diameter of circle:');
    expect(dragMotion(bus.prompt!.drag!, { x: 6, y: 0 })?.adding?.geom).toMatchObject({
      radius: 3,
    });
    await bus.submit('8');
    await bus.script(['C', '1,1', 'D']);
    expect(bus.promptText).toBe('Specify diameter of circle <8.0000>:');
    await bus.submit('');
    expect(circles()).toEqual([
      [0, 0, 4],
      [1, 1, 4],
    ]);
  });

  it('refuses a zero radius and asks again', async () => {
    const { bus, circles } = setup();
    await bus.script(['C', '0,0', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    expect(bus.command).toBe('CIRCLE');
    await bus.submit('-2');
    expect(bus.command).toBe('CIRCLE');
    await bus.submit('2');
    expect(circles()).toEqual([[0, 0, 2]]);
  });

  it('3P: through three points, refusing collinear ones', async () => {
    const { bus, circles } = setup();
    await bus.script(['C', '3P', '10,0', '0,10']);
    expect(bus.promptText).toBe('Specify third point on circle:');
    expect(dragMotion(bus.prompt!.drag!, { x: -10, y: 0 })?.adding?.geom).toMatchObject({
      kind: 'CIRCLE',
      radius: 10,
    });
    await bus.submit('5,5');
    expect(bus.history.at(-1)).toBe('Circle does not exist.');
    await bus.submit('-10,0');
    expect(circles()).toEqual([[0, 0, 10]]);
    expect(bus.history).toContain('Specify first point on circle: 10,0');
  });

  it('3P takes deferred tangents: Tan, Tan, Tan in a triangle draws its inscribed circle', async () => {
    const { bus, circles } = setup();
    const line = (x: number, y: number, dx: number, dy: number) =>
      ({ kind: 'line', point: { x, y }, direction: { x: dx, y: dy } }) as const;
    const tan = (target: ReturnType<typeof line>, x: number, y: number) => ({
      deferred: { mode: 'TAN' as const, target, pick: { x, y } },
    });
    await bus.script(['C', '3P']);
    const tangents = { deferred: { modes: OSNAP.TAN, straight: true } };
    expect(bus.prompt).toMatchObject({ message: 'Specify first point on circle', ...tangents });
    // The ribbon's Tan, Tan, Tan is 3P with the TAN override at each point: "to", then a pick.
    await bus.submit('tan');
    expect(bus.promptText).toBe('to');
    expect(bus.prompt).toMatchObject({ osnap: OSNAP.TAN, ...tangents });
    await bus.pick({ x: 2, y: 0 }, tan(line(0, 0, 1, 0), 2, 0));
    // A tangent is no point to stretch a rubber band from.
    expect(bus.prompt).toMatchObject({ message: 'Specify second point on circle', ...tangents });
    expect(bus.prompt).not.toHaveProperty('rubberBand');
    await bus.submit('tan');
    await bus.pick({ x: 0, y: 1.5 }, tan(line(0, 0, 0, 1), 0, 1.5));
    expect(bus.prompt).toMatchObject({ message: 'Specify third point on circle', ...tangents });
    // Dragged: the circle through the cursor, tangent to both lines.
    expect(dragMotion(bus.prompt!.drag!, { x: 2, y: 2 })?.adding?.geom).toMatchObject({
      kind: 'CIRCLE',
    });
    await bus.submit('tan');
    // Still dragged while the override asks "to".
    expect(bus.prompt).toMatchObject({ message: 'to', drag: { kind: 'sketch' } });
    await bus.pick({ x: 2, y: 1.5 }, tan(line(4, 0, -4, 3), 2, 1.5));
    expect(circles()).toEqual([[1, 1, 1]]);
    expect(bus.history).toContain('Specify first point on circle: tan');
    expect(bus.history).toContain('to 2.0000,0.0000');
  });

  it('3P mixes points and deferred tangents, and says when no circle touches them', async () => {
    const { bus, circles } = setup();
    const xAxis = { kind: 'line', point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } } as const;
    await bus.script(['C', '3P', '-2,2']);
    // After a point the rubber band runs from it as before.
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: -2, y: 2 } } });
    await bus.script(['2,2']);
    await bus.pick(
      { x: 0, y: 0 },
      { deferred: { mode: 'TAN', target: xAxis, pick: { x: 0, y: 0 } } },
    );
    expect(circles()).toEqual([[0, 2, 2]]);
    // Three parallel lines: no circle touches them all.
    const flat = (y: number) =>
      ({ kind: 'line', point: { x: 0, y }, direction: { x: 1, y: 0 } }) as const;
    await bus.script(['C', '3P']);
    for (const y of [0, 1])
      await bus.pick(
        { x: 0, y },
        { deferred: { mode: 'TAN', target: flat(y), pick: { x: 0, y } } },
      );
    await bus.pick(
      { x: 0, y: 2 },
      { deferred: { mode: 'TAN', target: flat(2), pick: { x: 0, y: 2 } } },
    );
    expect(bus.history.at(-1)).toBe('Circle does not exist.');
    expect(bus.promptText).toBe('Specify third point on circle:');
    await bus.cancel();
    // A deferred PERpendicular is no tangent: 3P takes it as the point picked.
    await bus.script(['C', '3P', '0,0', '10,0']);
    await bus.pick(
      { x: 5, y: 5 },
      { deferred: { mode: 'PER', target: xAxis, pick: { x: 5, y: 5 } } },
    );
    expect(circles()).toEqual([
      [0, 2, 2],
      [5, 0, 5],
    ]);
  });

  it('Tan, Tan, Tan from the object snaps on drawn lines (the snap and the command together)', async () => {
    const { bus, model, added } = setup();
    await bus.script(['LINE', '100,100', '104,100', '100,103', 'C']);
    const tol = toleranceForSize(1000);
    const src = { model, index: SpatialIndex.build(model, { tol }), block: MODEL_SPACE, tol };
    await bus.script(['C', '3P']);
    for (const p of [
      { x: 102, y: 100.05 },
      { x: 100.05, y: 101.5 },
      { x: 102, y: 101.55 },
    ]) {
      const prompt = bus.prompt as PointPrompt;
      const [hit] = osnap(src, {
        point: p,
        aperture: 0.2,
        modes: OSNAP.TAN,
        deferred: prompt.deferred as DeferredModes,
      });
      expect(hit?.deferred?.mode).toBe('TAN');
      await bus.pick(hit!.point, { deferred: hit!.deferred! });
    }
    const drawn = added().filter((e) => e.geom.kind === 'CIRCLE');
    expect(drawn.map((e) => e.geom)).toEqual([
      {
        kind: 'CIRCLE',
        center: { x: expect.closeTo(101, 9), y: expect.closeTo(101, 9) },
        radius: expect.closeTo(1, 9),
      },
    ]);
  });

  it('2P: the two ends of a diameter', async () => {
    const { bus, circles } = setup();
    await bus.script(['C', '2p', '0,0']);
    expect(bus.promptText).toBe("Specify second end point of circle's diameter:");
    await bus.submit('0,0');
    expect(bus.history.at(-1)).toBe('Circle does not exist.');
    await bus.submit('@10<0');
    expect(circles()).toEqual([[5, 0, 5]]);
  });

  it('Ttr: tangent to two picked lines, nearest the picks', async () => {
    const { bus, circles } = setup();
    // The fixture's lines run along +X and +Y from the origin.
    await bus.script(['C', 'T']);
    expect(bus.promptText).toBe('Specify point on object for first tangent of circle:');
    await bus.pick({ x: 8, y: 0 });
    expect(bus.promptText).toBe('Specify point on object for second tangent of circle:');
    await bus.pick({ x: 0, y: 8 });
    expect(bus.promptText).toBe('Specify radius of circle:');
    await bus.submit('2');
    expect(circles()).toEqual([[2, 2, 2]]);
    // And the radius is the default next time.
    await bus.script(['C', 'Ttr']);
    await bus.pick({ x: 8, y: 0 });
    await bus.pick({ x: 5, y: 7 });
    expect(bus.promptText).toBe('Specify radius of circle <2.0000>:');
    await bus.submit('2.5');
    // Tangent to the axis and outside the circle at (5, 5) r 2, on the side of (8, 0).
    expect(circles()[1]).toEqual([r6(5 + Math.sqrt(4.5 ** 2 - 2.5 ** 2)), 2.5, 2.5]);
  });

  it('Ttr: says so when no circle of that radius touches both', async () => {
    const init = sampleInit();
    const model = DocumentModel.create({
      ...init,
      entities: [
        entityInit('20', { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
        entityInit('23', { kind: 'LINE', start: { x: 0, y: 6 }, end: { x: 10, y: 6 } }),
      ],
    });
    const bus = new PromptBus({ model, registry: builtinCommands(), view: pickHost(model) });
    await bus.script(['C', 'T']);
    await bus.pick({ x: 5, y: 0 });
    await bus.pick({ x: 5, y: 6 });
    await bus.submit('0');
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.submit('1');
    expect(bus.history.at(-1)).toBe('Circle does not exist.');
    expect(bus.command).toBeUndefined();
    expect([...model.entities()]).toHaveLength(2);
  });

  it('Ttr: Enter at a pick, or at the radius, ends it drawing nothing', async () => {
    const { bus, added } = setup();
    await bus.script(['C', 'T', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['C', 'T']);
    await bus.pick({ x: 8, y: 0 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    await bus.script(['C', 'T']);
    await bus.pick({ x: 8, y: 0 });
    await bus.pick({ x: 0, y: 8 });
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    expect(added()).toEqual([]);
  });

  it('Enter ends it at any point prompt', async () => {
    const { bus, added } = setup();
    for (const script of [
      ['C', ''],
      ['C', '3P', ''],
      ['C', '3P', '0,0', ''],
      ['C', '3P', '0,0', '1,0', ''],
      ['C', '2P', ''],
      ['C', '2P', '0,0', ''],
      ['C', '0,0', ''],
    ]) {
      await bus.script(script);
      expect(bus.command).toBeUndefined();
    }
    expect(added()).toEqual([]);
  });
});

describe('tangentTarget', () => {
  const e = (geom: Entity['geom']) => ({ ...entityInit('99', geom) }) as unknown as Entity;
  it('takes lines, rays, xlines, circles, arcs and the picked polyline segment', () => {
    expect(
      tangentTarget(e({ kind: 'RAY', base: { x: 1, y: 1 }, direction: { x: 0, y: 1 } }), {
        x: 1,
        y: 5,
      }),
    ).toEqual({
      kind: 'line',
      point: { x: 1, y: 1 },
      direction: { x: 0, y: 1 },
    });
    expect(
      tangentTarget(e({ kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }), {
        x: 1,
        y: 0,
      })?.kind,
    ).toBe('line');
    expect(
      tangentTarget(
        e({ kind: 'ARC', center: { x: 0, y: 0 }, radius: 3, startAngle: 0, endAngle: 1 }),
        { x: 3, y: 0 },
      ),
    ).toEqual({ kind: 'circle', center: { x: 0, y: 0 }, radius: 3 });
    const poly = e({
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 1 },
        { x: 10, y: 10, bulge: 0 },
      ],
    });
    expect(tangentTarget(poly, { x: 4, y: 0 })).toEqual({
      kind: 'line',
      point: { x: 0, y: 0, bulge: 0 },
      direction: { x: 10, y: 0 },
    });
    const arcSeg = tangentTarget(poly, { x: 15, y: 5 });
    expect(arcSeg?.kind).toBe('circle');
    expect(arcSeg && 'radius' in arcSeg && r6(arcSeg.radius)).toBe(5);
  });
  it('refuses what a circle cannot be tangent to', () => {
    expect(
      tangentTarget(e({ kind: 'LINE', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }), {
        x: 1,
        y: 1,
      }),
    ).toBeUndefined();
    expect(
      tangentTarget(
        e({ kind: 'LWPOLYLINE', closed: false, vertices: [{ x: 0, y: 0, bulge: 0 }] }),
        { x: 0, y: 0 },
      ),
    ).toBeUndefined();
    expect(
      tangentTarget(
        e({
          kind: 'LWPOLYLINE',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 0, y: 0, bulge: 0 },
          ],
        }),
        { x: 0, y: 0 },
      ),
    ).toBeUndefined();
    expect(
      tangentTarget(e({ kind: 'POINT', position: { x: 0, y: 0 } } as Entity['geom']), {
        x: 0,
        y: 0,
      }),
    ).toBeUndefined();
  });
});
