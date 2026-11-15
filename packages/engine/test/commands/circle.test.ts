// M3-01: CIRCLE scripted on the PromptBus as the command line drives it, one test per method
// AutoCAD 2024 offers (Center Radius/Diameter, 3P, 2P, Ttr), with its prompts and refusals.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
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
