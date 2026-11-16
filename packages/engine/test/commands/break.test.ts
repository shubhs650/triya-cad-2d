// M3-02 part 4: BREAK, BREAKATPOINT, LENGTHEN, JOIN, EXPLODE, REVERSE and ALIGN on the PromptBus,
// driven as the command line and the canvas drive them, with AutoCAD 2024's prompts (AutoCAD
// Help, "BREAK (Command)", "LENGTHEN (Command)", "JOIN (Command)", "EXPLODE (Command)",
// "REVERSE (Command)", "ALIGN (Command)"). The geometry is test/edit/break.test.ts's.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  edgeCurvesOf,
  closestPoint,
  flatten,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type SplineGeometry,
  type ViewHost,
  type Vec2,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const BLOCK = '50';

/** A canvas whose picks take the objects within 0.25 of the pick, nearest first. */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') {
        const hits: [number, EntityId][] = [];
        for (const e of model().entities()) {
          if (e.owner !== MODEL_SPACE) continue;
          // A 3D polyline is picked by its plan view (M3-17).
          const c = offsetCurveOf(e.geom) ?? edgeCurvesOf(e.geom, false)[0];
          const d = c ? closestPoint(c, r.point, toleranceForSize(100)).distance : Infinity;
          if (d < 0.25) hits.push([d, e.id]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
      }
      if (r.op === 'select') {
        // A window holds an object with all its points inside, a crossing one with any.
        const inside = (p: Vec2) =>
          p.x >= Math.min(r.a.x, r.b.x) &&
          p.x <= Math.max(r.a.x, r.b.x) &&
          p.y >= Math.min(r.a.y, r.b.y) &&
          p.y <= Math.max(r.a.y, r.b.y);
        const ids = model()
          .blockEntities(MODEL_SPACE)
          .filter((id) => {
            const g = model().entity(id)!.geom;
            const c = offsetCurveOf(g) ?? edgeCurvesOf(g, false)[0];
            const bounded = c && c.kind !== 'RAY' && c.kind !== 'XLINE' ? c : undefined;
            const pts = bounded
              ? flatten(bounded, 0.01).points
              : g.kind === 'INSERT'
                ? [g.position]
                : [];
            const n = pts.filter(inside).length;
            return r.crossing ? n > 0 : n === pts.length && n > 0;
          });
        return Promise.resolve({ ok: true, ids });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

/**
 * A drawing of its own: line 30 (0,0)-(10,0), circle 31 at (50,0) r 5, and whatever `extra`
 * adds (handles from 40 on, on WALLS). Block "B" (record 50) holds a line (0,0)-(1,0) on layer 0
 * coloured ByBlock and a circle at (1,0) r 0.5.
 */
function setup(extra: (EntityGeometry | [EntityGeometry, Partial<Entity>])[] = []) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      blockRecords: [...(init.tables?.blockRecords ?? []), blockRecord(BLOCK, 'B')],
    },
    blocks: [...(init.blocks ?? []), { handle: BLOCK, name: 'B', basePoint: { x: 0, y: 0 } }],
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', { kind: 'CIRCLE', center: { x: 50, y: 0 }, radius: 5 }),
      entityInit('51', lineGeom(0, 0, 1, 0), { owner: BLOCK, color: { kind: 'byBlock' } }),
      entityInit('52', { kind: 'CIRCLE', center: { x: 1, y: 0 }, radius: 0.5 }, { owner: BLOCK }),
      ...extra.map((x, i) => {
        const [g, props] = Array.isArray(x) ? x : [x, {}];
        return entityInit((0x40 + i).toString(16).toUpperCase(), g, {
          layer: LAYER_WALLS,
          ...props,
        } as never);
      }),
    ],
  });
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => model) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity | undefined => {
    const id = model.ids.idOf(h);
    return id === undefined ? undefined : model.entity(id);
  };
  const space = () => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  const kinds = () => space().map((e) => e.geom.kind);
  const ends = (e: Entity) => {
    const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
  };
  return { model, bus, log, byHandle, space, kinds, ends };
}

/** A spline's first and last control points. */
const cvs = (e: Entity) => {
  const p = (e.geom as SplineGeometry).controlPoints;
  return [p[0]!.x, p[0]!.y, p.at(-1)!.x, p.at(-1)!.y].map(r6);
};

describe('BREAK', () => {
  it('takes the pick as the first point and erases up to the second', async () => {
    const { bus, byHandle, space, ends } = setup();
    await bus.script(['BR']);
    expect(bus.promptText).toBe('Select object:');
    await bus.pick({ x: 3, y: 0 });
    expect(bus.promptText).toBe('Specify second break point or [First point]:');
    await bus.script(['7,1']);
    expect(bus.command).toBeUndefined();
    // The first piece keeps the line's handle; the second is a new line.
    expect(ends(byHandle('30')!)).toEqual([0, 0, 3, 0]);
    const lines = space().filter((e) => e.geom.kind === 'LINE');
    expect(lines.map(ends)).toEqual([
      [0, 0, 3, 0],
      [7, 0, 10, 0],
    ]);
  });

  it('splits at the first point with @, and gives the first point again with First point', async () => {
    const { bus, space, ends } = setup();
    await bus.script(['BREAK']);
    await bus.pick({ x: 4, y: 0 });
    await bus.script(['@']);
    expect(
      space()
        .filter((e) => e.geom.kind === 'LINE')
        .map(ends),
    ).toEqual([
      [0, 0, 4, 0],
      [4, 0, 10, 0],
    ]);
    await bus.script(['BREAK']);
    await bus.pick({ x: 6, y: 0 });
    await bus.script(['F']);
    expect(bus.promptText).toBe('Specify first break point:');
    await bus.script(['8,0']);
    expect(bus.promptText).toBe('Specify second break point:');
    await bus.script(['12,0']);
    expect(
      space()
        .filter((e) => e.geom.kind === 'LINE')
        .map(ends),
    ).toEqual([
      [0, 0, 4, 0],
      [4, 0, 8, 0],
    ]);
  });

  it('asks for the first point of an object taken by a window, and turns a circle into an arc', async () => {
    const { bus, log, byHandle, kinds } = setup();
    await bus.script(['BREAK', 'W', '44,-6', '56,6']);
    expect(bus.promptText).toBe('Specify first break point:');
    await bus.script(['55,0', '50,5']);
    // The circle is now an arc from 90° round to 0°: a new object, the circle gone.
    expect(byHandle('31')).toBeUndefined();
    expect(kinds()).toContain('ARC');
    await bus.script(['BREAKATPOINT']);
    expect(bus.promptText).toBe('Select object:');
    await bus.pick({ x: 2, y: 0 });
    expect(bus.promptText).toBe('Specify break point:');
    await bus.script(['2,0']);
    expect(kinds().filter((k) => k === 'LINE')).toHaveLength(2);
    // A circle cannot be broken at a single point.
    const s = setup();
    await s.bus.script(['BREAK']);
    await s.bus.pick({ x: 55, y: 0 });
    await s.bus.script(['@']);
    expect(s.log).toContain('Arc cannot be full 360 degrees.');
    expect(log).not.toContain('Arc cannot be full 360 degrees.');
  });

  it('takes a pre-selected object and the point it was picked at', async () => {
    const { bus, space, ends } = setup();
    await bus.pick({ x: 2, y: 0 });
    await bus.script(['BREAK']);
    expect(bus.promptText).toBe('Specify second break point or [First point]:');
    await bus.script(['-5,0']);
    expect(
      space()
        .filter((e) => e.geom.kind === 'LINE')
        .map(ends),
    ).toEqual([[2, 0, 10, 0]]);
  });

  it('refuses an object it cannot break', async () => {
    const { bus, log } = setup([{ kind: 'POINT', position: { x: 20, y: 0 } } as EntityGeometry]);
    await bus.script(['BREAK', 'L']);
    expect(log).toContain('Cannot break that object.');
    expect(bus.command).toBeUndefined();
  });
});

describe('LENGTHEN', () => {
  const MEASURE = 'Select an object to measure or [DElta/Percent/Total/DYnamic] <DElta>:';
  const CHANGE = 'Select an object to change or [Undo]:';

  it('measures what is picked, then lengthens by a delta at the end nearer each pick', async () => {
    const { bus, log, byHandle, ends } = setup([
      {
        kind: 'ARC',
        center: { x: 20, y: 0 },
        radius: 2,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
    ]);
    await bus.script(['LEN']);
    expect(bus.promptText).toBe(MEASURE);
    expect(bus.prompt).toMatchObject({ kind: 'point', pickbox: true });
    await bus.pick({ x: 5, y: 0 });
    expect(log).toContain('Current length: 10.0000');
    await bus.pick({ x: 22, y: 0 });
    expect(log).toContain('Current length: 3.1416, included angle: 90');
    await bus.script(['DE']);
    expect(bus.promptText).toBe('Enter delta length or [Angle] <0.0000>:');
    await bus.script(['2']);
    expect(bus.promptText).toBe(CHANGE);
    await bus.pick({ x: 9, y: 0 });
    expect(ends(byHandle('30')!)).toEqual([0, 0, 12, 0]);
    await bus.pick({ x: 1, y: 0 });
    expect(ends(byHandle('30')!)).toEqual([-2, 0, 12, 0]);
    await bus.script(['U']);
    expect(ends(byHandle('30')!)).toEqual([0, 0, 12, 0]);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
    // The next LENGTHEN remembers the mode and the delta.
    await bus.script(['LENGTHEN', '']);
    expect(bus.promptText).toBe('Enter delta length or [Angle] <2.0000>:');
  });

  it('changes an arc by an angle, by a percentage and to a total', async () => {
    const { bus, byHandle, ends } = setup([
      {
        kind: 'ARC',
        center: { x: 20, y: 0 },
        radius: 2,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
    ]);
    await bus.script(['LENGTHEN', 'DE', 'A']);
    expect(bus.promptText).toBe('Enter delta angle <0>:');
    await bus.script(['30']);
    await bus.pick({ x: 20, y: 2 });
    const a = byHandle('40')!.geom as { startAngle: number; endAngle: number };
    expect(r6((a.endAngle * 180) / Math.PI)).toBe(120);
    await bus.submit('');
    await bus.script(['LENGTHEN', 'P']);
    expect(bus.promptText).toBe('Enter percentage length <100.0000>:');
    await bus.script(['50']);
    await bus.pick({ x: 8, y: 0 });
    expect(ends(byHandle('30')!)).toEqual([0, 0, 5, 0]);
    await bus.submit('');
    await bus.script(['LENGTHEN', 'T']);
    expect(bus.promptText).toBe('Specify total length or [Angle] <1.0000>:');
    await bus.script(['8']);
    await bus.pick({ x: 1, y: 0 });
    expect(ends(byHandle('30')!)).toEqual([-3, 0, 5, 0]);
    await bus.submit('');
    await bus.script(['LENGTHEN', 'T', 'A']);
    expect(bus.promptText).toBe('Specify total angle <57>:');
    await bus.script(['180']);
    await bus.pick({ x: 22, y: 0 });
    // The pick nearer the start moves the start: 180° ending at 120°.
    const b = byHandle('40')!.geom as { startAngle: number; endAngle: number };
    expect([r6((b.startAngle * 180) / Math.PI), r6((b.endAngle * 180) / Math.PI)]).toEqual([
      300, 120,
    ]);
  });

  it('drags an end to a point (DYnamic) and refuses what it cannot change', async () => {
    const { bus, log, byHandle, ends } = setup();
    await bus.script(['LENGTHEN', 'DY']);
    expect(bus.promptText).toBe(CHANGE);
    await bus.pick({ x: 9, y: 0 });
    expect(bus.promptText).toBe('Specify new end point:');
    await bus.script(['15,3']);
    expect(ends(byHandle('30')!)).toEqual([0, 0, 15, 0]);
    await bus.pick({ x: 55, y: 0 });
    expect(log).toContain('Cannot lengthen a closed object.');
    await bus.pick({ x: 100, y: 100 });
    expect(log).toContain('Cannot lengthen that object.');
    expect(bus.promptText).toBe(CHANGE);
  });
});

describe('JOIN', () => {
  it('joins several objects at once into a polyline and says what it did', async () => {
    const { bus, log, kinds, space } = setup([
      lineGeom(20, 0, 30, 0),
      lineGeom(30, 0, 30, 10),
      lineGeom(30, 10, 20, 0),
    ]);
    await bus.script(['J']);
    expect(bus.promptText).toBe('Select source object or multiple objects to join at once:');
    await bus.script(['W', '19,-1', '31,11', '']);
    expect(log).toContain('3 objects converted to 1 polyline');
    expect(kinds().filter((k) => k === 'LWPOLYLINE')).toHaveLength(1);
    const p = space().find((e) => e.geom.kind === 'LWPOLYLINE')!;
    // On the first line's layer, closed.
    expect(p).toMatchObject({ layer: LAYER_WALLS, geom: { closed: true } });
  });

  it('joins collinear lines to a source line, discarding the rest', async () => {
    const { bus, log, byHandle, ends } = setup([lineGeom(12, 0, 15, 0), lineGeom(10, 0, 10, 5)]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 5, y: 0 });
    await bus.submit('');
    expect(bus.promptText).toBe('Select objects to join:');
    await bus.script(['C', '9,-1', '16,1', '']);
    expect(log).toContain('2 lines joined into 1 line');
    expect(log).toContain('1 object discarded from the operation');
    expect(ends(byHandle('30')!)).toEqual([0, 0, 15, 0]);
    expect(byHandle('40')).toBeUndefined();
    expect(byHandle('41')).toBeDefined();
  });

  it('adds lines to a source polyline', async () => {
    const { bus, log, byHandle } = setup([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 20, y: 0, bulge: 0 },
          { x: 30, y: 0, bulge: 0 },
        ],
      },
      lineGeom(30, 0, 30, 10),
      lineGeom(20, 0, 20, 10),
    ]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 25, y: 0 });
    await bus.script(['', 'C', '19,-1', '31,11', '']);
    expect(log).toContain('2 segments added to polyline');
    const g = byHandle('40')!.geom as unknown as { vertices: { x: number; y: number }[] };
    expect(g.vertices.map((v) => [v.x, v.y])).toEqual([
      [20, 10],
      [20, 0],
      [30, 0],
      [30, 10],
    ]);
    expect(byHandle('41')).toBeUndefined();
  });

  it('joins a line meeting a source spline into the spline (M3-12 part 2)', async () => {
    const { bus, log, byHandle, kinds } = setup([
      {
        kind: 'SPLINE',
        degree: 2,
        knots: [0, 0, 0, 1, 1, 1],
        controlPoints: [
          { x: 20, y: 0 },
          { x: 25, y: 5 },
          { x: 30, y: 0 },
        ],
        closed: false,
        periodic: false,
      } as EntityGeometry,
      lineGeom(30, 0, 35, 0),
    ]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 20, y: 0 });
    await bus.script(['', 'C', '29,-1', '36,1', '']);
    expect(log).toContain('2 objects converted to 1 spline');
    expect(cvs(byHandle('40')!)).toEqual([20, 0, 35, 0]);
    expect(byHandle('41')).toBeUndefined();
    expect(kinds().filter((k) => k === 'SPLINE')).toHaveLength(1);
  });

  it('joins 3D polylines meeting in plan and height into the source (M3-17)', async () => {
    const p3 = (pts: [number, number, number][]): EntityGeometry => ({
      kind: 'POLYLINE',
      is3d: true,
      closed: false,
      vertices: pts.map(([x, y, z]) => ({ x, y, bulge: 0, ...(z !== 0 && { z }) })),
    });
    const { bus, log, byHandle } = setup([
      p3([
        [20, 0, 0],
        [30, 0, 4],
      ]),
      p3([
        [40, 10, 9],
        [30, 10, 6],
        [30, 0, 4],
      ]),
      // Over the source's start in plan, but higher.
      p3([
        [20, 0, 2],
        [20, 10, 2],
      ]),
    ]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 25, y: 0 });
    await bus.script(['', 'C', '19,-1', '41,11', '']);
    expect(log).toContain('1 segment added to polyline');
    expect(log).toContain('1 object discarded from the operation');
    const g = byHandle('40')!.geom as unknown as {
      is3d: boolean;
      vertices: { x: number; y: number; z?: number }[];
    };
    expect(g.is3d).toBe(true);
    expect(g.vertices.map((v) => [v.x, v.y, v.z ?? 0])).toEqual([
      [20, 0, 0],
      [30, 0, 4],
      [30, 10, 6],
      [40, 10, 9],
    ]);
    expect(byHandle('41')).toBeUndefined();
    expect(byHandle('42')).toBeDefined();
  });

  it('joins a sloped line and a curve-free chain onto a source 3D polyline (M3-18)', async () => {
    const { bus, log, byHandle, kinds } = setup([
      {
        kind: 'POLYLINE',
        is3d: true,
        closed: false,
        vertices: [
          { x: 20, y: 0, bulge: 0 },
          { x: 30, y: 0, bulge: 0, z: 4 },
        ],
      },
      { kind: 'LINE', start: { x: 30, y: 0 }, end: { x: 30, y: 10 }, heights: [4, 6] },
      // A sloped line meeting nothing in height stays as it is.
      { kind: 'LINE', start: { x: 20, y: 0 }, end: { x: 20, y: 10 }, heights: [1, 6] },
    ]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 25, y: 0 });
    await bus.script(['', 'C', '19,-1', '31,11', '']);
    expect(log).toContain('1 segment added to polyline');
    expect(log).toContain('1 object discarded from the operation');
    const g = byHandle('40')!.geom as unknown as {
      vertices: { x: number; y: number; z?: number }[];
    };
    expect(g.vertices.map((v) => [v.x, v.y, v.z ?? 0])).toEqual([
      [20, 0, 0],
      [30, 0, 4],
      [30, 10, 6],
    ]);
    expect(byHandle('41')).toBeUndefined();
    expect(kinds().filter((k) => k === 'LINE')).toHaveLength(2);
  });

  it('joins noncoplanar lines at once into a 3D polyline (M3-18)', async () => {
    const { bus, log, kinds, space } = setup([
      { kind: 'LINE', start: { x: 20, y: 0 }, end: { x: 30, y: 0 }, heights: [0, 3] },
      { kind: 'LINE', start: { x: 30, y: 0 }, end: { x: 30, y: 10 }, elevation: 3 },
    ]);
    await bus.script(['J', 'C', '19,-1', '31,11', '']);
    expect(log).toContain('2 objects converted to 1 polyline');
    const p = space().find((e) => e.geom.kind === 'POLYLINE')!;
    expect(p).toMatchObject({ layer: LAYER_WALLS, geom: { is3d: true } });
    expect(kinds().filter((k) => k === 'LINE')).toHaveLength(1);
  });

  it('closes a source arc into a circle', async () => {
    const { bus, log, kinds } = setup([
      { kind: 'ARC', center: { x: 20, y: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI },
    ]);
    await bus.script(['JOIN']);
    await bus.pick({ x: 20, y: 2 });
    await bus.submit('');
    expect(bus.promptText).toBe('Select arcs to join to source or [cLose]:');
    await bus.script(['L']);
    expect(log).toContain('Arc converted to a circle.');
    expect(kinds().filter((k) => k === 'CIRCLE')).toHaveLength(2);
  });
});

describe('EXPLODE', () => {
  it('explodes a polyline into lines and arcs, warning of lost widths', async () => {
    const { bus, log, kinds, space } = setup([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        constantWidth: 0.2,
        vertices: [
          { x: 20, y: 0, bulge: 0 },
          { x: 30, y: 0, bulge: 1 },
          { x: 30, y: 10, bulge: 0 },
        ],
      },
    ]);
    await bus.script(['X', 'L', '']);
    expect(kinds()).toEqual(['LINE', 'CIRCLE', 'LINE', 'ARC']);
    expect(log).toContain('Exploding this polyline has lost width information.');
    // The pieces keep the polyline's layer.
    expect(
      space()
        .slice(2)
        .map((e) => e.layer),
    ).toEqual([LAYER_WALLS, LAYER_WALLS]);
  });

  // M3-18 (DEC-063): a 3D polyline's segments become lines from vertex to vertex in plan and
  // height, as AutoCAD's do.
  it('explodes a 3D polyline into lines keeping its heights', async () => {
    const { bus, space } = setup([
      {
        kind: 'POLYLINE',
        is3d: true,
        closed: false,
        vertices: [
          { x: 20, y: 0, bulge: 0, z: 2 },
          { x: 30, y: 0, bulge: 0, z: 2 },
          { x: 30, y: 10, bulge: 0, z: 5 },
        ],
      },
    ]);
    await bus.script(['X', 'L', '']);
    const made = space()
      .slice(2)
      .map((e) => e.geom);
    expect(made).toEqual([
      { kind: 'LINE', start: { x: 20, y: 0 }, end: { x: 30, y: 0 }, elevation: 2 },
      { kind: 'LINE', start: { x: 30, y: 0 }, end: { x: 30, y: 10 }, heights: [2, 5] },
    ]);
  });

  it('explodes a block reference into its contents, placed as it placed them', async () => {
    const { bus, model, space } = setup([
      [
        {
          kind: 'INSERT',
          block: BLOCK,
          position: { x: 100, y: 0 },
          scale: { x: 2, y: 2, z: 2 },
          rotation: Math.PI / 2,
          attributes: [],
        },
        { layer: LAYER_WALLS },
      ],
    ]);
    await bus.script(['EXPLODE', 'L', '']);
    const made = space().slice(2);
    expect(made.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    const l = made[0]!.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect([l.start.x, l.start.y, l.end.x, l.end.y].map(r6)).toEqual([100, 0, 100, 2]);
    // The pieces keep their own layer and colour (layer 0, ByBlock), as AutoCAD's do.
    expect(made[0]).toMatchObject({ layer: LAYER_0, color: { kind: 'byBlock' } });
    expect(made[1]!.geom).toMatchObject({ center: { x: 100, y: 2 }, radius: 1 });
    // The block definition is untouched.
    expect(model.blockEntities(BLOCK)).toHaveLength(2);
  });

  it('explodes a nonuniformly scaled reference, circles into ellipses (M3-12 part 7)', async () => {
    const { bus, kinds, space } = setup([
      {
        kind: 'INSERT',
        block: BLOCK,
        position: { x: 100, y: 0 },
        scale: { x: 2, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      },
    ]);
    await bus.script(['EXPLODE', 'L', '']);
    expect(kinds()).toEqual(['LINE', 'CIRCLE', 'LINE', 'ELLIPSE']);
    expect(space()[3]!.geom).toMatchObject({ center: { x: 102, y: 0 }, ratio: 0.5 });
  });

  it('refuses what cannot be exploded', async () => {
    const { bus, log, kinds } = setup([
      {
        kind: 'INSERT',
        block: BLOCK,
        position: { x: 100, y: 0 },
        scale: { x: 2, y: 2, z: 2 },
        rotation: 0,
        attributes: [],
        array: { columns: 2, rows: 1, columnSpacing: 5, rowSpacing: 0 },
      },
    ]);
    await bus.script(['EXPLODE', 'ALL', '']);
    expect(log).toContain('1 object was not exploded: MINSERT arrays cannot be exploded.');
    expect(log).toContain('1 object was not exploded: a LINE cannot be exploded.');
    expect(log).toContain('1 object was not exploded: a CIRCLE cannot be exploded.');
    expect(kinds()).toContain('INSERT');
  });
});

describe('REVERSE', () => {
  it('reverses lines and polylines and says how many', async () => {
    const { bus, log, byHandle, ends } = setup();
    await bus.script(['REVERSE']);
    expect(bus.promptText).toBe(
      'Select lines, polylines, splines, or helixes to reverse direction:',
    );
    await bus.script(['ALL', '']);
    expect(log).toContain('1 object(s) direction has been reversed.');
    expect(ends(byHandle('30')!)).toEqual([10, 0, 0, 0]);
  });
});

describe('ALIGN', () => {
  it('moves, turns and scales by two pairs of points', async () => {
    const { bus, byHandle, ends } = setup();
    await bus.script(['AL', 'W', '-1,-1', '11,1', '']);
    expect(bus.promptText).toBe('Specify first source point:');
    await bus.script(['0,0', '100,100']);
    expect(bus.promptText).toBe('Specify second source point or <continue>:');
    await bus.script(['10,0', '100,105']);
    expect(bus.promptText).toBe('Specify third source point or <continue>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Scale objects based on alignment points? [Yes/No] <N>:');
    await bus.script(['Y']);
    expect(ends(byHandle('30')!)).toEqual([100, 100, 100, 105]);
  });

  it('moves by one pair, and flips over with a third pair the other way round', async () => {
    const { bus, byHandle, ends } = setup();
    await bus.script(['ALIGN', 'W', '-1,-1', '11,1', '', '0,0', '5,5', '']);
    expect(ends(byHandle('30')!)).toEqual([5, 5, 15, 5]);
    // Source 5,5 → 15,5 with 5,6 above it; destination the same line with 5,4 below: a flip.
    await bus.script(['ALIGN', 'W', '4,4', '16,6', '', '5,5', '5,5', '15,5', '15,5', '5,6', '5,4']);
    expect(ends(byHandle('30')!)).toEqual([5, 5, 15, 5]);
    expect(bus.command).toBeUndefined();
  });
});

describe('the less common answers', () => {
  const ellipseArc: EntityGeometry = {
    kind: 'ELLIPSE',
    center: { x: 20, y: 0 },
    majorAxis: { x: 4, y: 0 },
    ratio: 0.5,
    startParam: 0,
    endParam: Math.PI,
  };

  it('ends BREAK and BREAKATPOINT on Esc or Enter at any prompt', async () => {
    const { bus, byHandle, ends } = setup();
    await bus.script(['BREAK', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['BREAK']);
    await bus.pick({ x: 3, y: 0 });
    await bus.cancel();
    await bus.script(['BREAK']);
    await bus.pick({ x: 3, y: 0 });
    await bus.script(['F']);
    await bus.cancel();
    await bus.script(['BREAK']);
    await bus.pick({ x: 3, y: 0 });
    await bus.script(['F', '4,0']);
    await bus.cancel();
    await bus.script(['BREAKATPOINT', '']);
    await bus.script(['BREAKATPOINT']);
    await bus.pick({ x: 3, y: 0 });
    await bus.cancel();
    await bus.script(['BREAK', 'W', '-1,-1', '11,1']);
    await bus.cancel();
    expect(ends(byHandle('30')!)).toEqual([0, 0, 10, 0]);
    // Both points at one end leave the line whole; past both ends there would be nothing left.
    await bus.script(['BREAK']);
    await bus.pick({ x: 0.1, y: 0 });
    await bus.script(['-5,0']);
    expect(ends(byHandle('30')!)).toEqual([0.1, 0, 10, 0].map(r6));
  });

  it('refuses at BREAKATPOINT what it cannot break', async () => {
    const { bus, log } = setup([{ kind: 'POINT', position: { x: 20, y: 0 } } as EntityGeometry]);
    await bus.script(['BREAKATPOINT', 'L']);
    expect(log).toContain('Cannot break that object.');
    const s = setup();
    await s.bus.script(['BREAK']);
    await s.bus.pick({ x: 1, y: 0 });
    await s.bus.script(['-1,0']);
    await s.bus.script(['BREAK']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.script(['F', '-1,0', '12,0']);
    expect(s.log).toContain('The break points leave nothing of the object.');
  });

  it('says what LENGTHEN cannot do and checks its values', async () => {
    const { bus, log, byHandle } = setup([
      ellipseArc,
      {
        kind: 'SPLINE',
        degree: 1,
        knots: [0, 0, 1, 1],
        controlPoints: [
          { x: 30, y: 10 },
          { x: 40, y: 10 },
        ],
        closed: false,
        periodic: false,
      } as EntityGeometry,
      { kind: 'XLINE', base: { x: 0, y: 30 }, direction: { x: 1, y: 0 } },
    ]);
    await bus.script(['LENGTHEN']);
    await bus.pick({ x: 100, y: 100 });
    expect(log).toContain('That object has no length to measure.');
    await bus.script(['P', '0']);
    expect(log).toContain('Value must be positive and nonzero.');
    await bus.script(['-5']);
    await bus.cancel();
    await bus.script(['LENGTHEN', 'T', '-1']);
    expect(bus.promptText).toBe('Specify total length or [Angle] <1.0000>:');
    await bus.script(['100']);
    await bus.pick({ x: 38, y: 10 });
    // A spline grows by a straight piece along its end (M3-12 part 2).
    expect(cvs(byHandle('41')!)).toEqual([30, 10, 130, 10]);
    await bus.pick({ x: 5, y: 30 });
    expect(log).toContain('Cannot lengthen that object.');
    await bus.script(['U']);
    expect(cvs(byHandle('41')!)).toEqual([30, 10, 40, 10]);
    await bus.script(['U']);
    expect(log).toContain('Nothing to undo.');
    await bus.pick({ x: 24, y: 0 });
    expect(log).toContain('Arc cannot be full 360 degrees.');
    await bus.cancel();
    await bus.script(['LENGTHEN', 'T', 'A', '90']);
    await bus.pick({ x: 8, y: 0 });
    expect(log).toContain('Only an arc has an included angle.');
    await bus.cancel();
    await bus.script(['LENGTHEN', 'DE', '-20']);
    await bus.pick({ x: 8, y: 0 });
    expect(log).toContain('The new length must be more than zero.');
    await bus.cancel();
    await bus.script(['LENGTHEN', 'DE', 'A']);
    await bus.cancel();
    await bus.script(['LENGTHEN', 'T', 'A']);
    await bus.cancel();
    await bus.script(['LENGTHEN', 'DY']);
    await bus.pick({ x: 8, y: 0 });
    await bus.cancel();
    await bus.script(['LENGTHEN', 'DE']);
    await bus.cancel();
    await bus.script(['LENGTHEN', 'P']);
    await bus.cancel();
    await bus.script(['LENGTHEN', 'T']);
    await bus.cancel();
    await bus.script(['LENGTHEN']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });

  it('joins and closes elliptical arcs, and ends JOIN on an empty selection', async () => {
    const { bus, log, kinds } = setup([
      ellipseArc,
      { ...ellipseArc, startParam: Math.PI, endParam: 1.5 * Math.PI } as EntityGeometry,
    ]);
    await bus.script(['JOIN', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['JOIN', 'C', '15,-3', '25,3', '']);
    expect(log).toContain('2 elliptical arcs joined into 1 elliptical arc');
    await bus.script(['JOIN', 'L', '']);
    expect(bus.promptText).toBe('Select elliptical arcs to join to source or [cLose]:');
    await bus.script(['L']);
    expect(log).toContain('Elliptical arc converted to an ellipse.');
    expect(kinds().filter((k) => k === 'ELLIPSE')).toHaveLength(1);
    const s = setup([
      ellipseArc,
      { ...ellipseArc, startParam: Math.PI, endParam: 2 * Math.PI } as EntityGeometry,
      { kind: 'ARC', center: { x: 50, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI },
      {
        kind: 'ARC',
        center: { x: 50, y: 0 },
        radius: 5,
        startAngle: Math.PI,
        endAngle: 2 * Math.PI - 1e-12,
      },
    ]);
    await s.bus.script(['JOIN', 'ALL', '']);
    expect(s.log).toContain('2 elliptical arcs joined into 1 ellipse');
    expect(s.log).toContain('2 arcs joined into 1 circle');
    await s.bus.script(['JOIN']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.script(['']);
    await s.bus.cancel();
  });

  it('explodes a polyline without widths quietly and refuses MINSERTs and xrefs', async () => {
    const { bus, log } = setup([
      {
        kind: 'POLYLINE',
        closed: true,
        is3d: true,
        vertices: [
          { x: 0, y: 20, bulge: 0 },
          { x: 10, y: 20, bulge: 0 },
          { x: 10, y: 30, bulge: 0 },
        ],
      },
      {
        kind: 'INSERT',
        block: BLOCK,
        position: { x: 100, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
        array: { columns: 2, rows: 1, columnSpacing: 5, rowSpacing: 0 },
      },
    ]);
    await bus.script(['EXPLODE', 'C', '-1,19', '11,31', '']);
    expect(log.some((l) => l.includes('lost width'))).toBe(false);
    // The polyline exploded into lines, so Last is no longer the MINSERT: pick it by its point.
    await bus.script(['EXPLODE', 'C', '99,-1', '101,1', '']);
    expect(log).toContain('1 object was not exploded: MINSERT arrays cannot be exploded.');
    await bus.script(['EXPLODE', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['REVERSE', '']);
    expect(bus.command).toBeUndefined();
  });

  it('ends ALIGN on Esc or Enter, keeps three pairs that do not flip, and refuses a zero length', async () => {
    const { bus, log, byHandle, ends } = setup();
    await bus.script(['ALIGN', '']);
    await bus.script(['ALIGN', 'W', '-1,-1', '11,1', '', '']);
    await bus.script(['ALIGN', 'W', '-1,-1', '11,1', '', '0,0']);
    await bus.cancel();
    await bus.script(['ALIGN', 'W', '-1,-1', '11,1', '', '0,0', '0,0', '0,0', '5,5', '']);
    expect(log).toContain('Source and destination points must differ.');
    await bus.script(['ALIGN', 'W', '-1,-1', '11,1', '', '0,0', '0,10', '10,0', '0,20']);
    await bus.script(['5,5', '-5,15']);
    expect(ends(byHandle('30')!)).toEqual([0, 10, 0, 20]);
    await bus.script(['ALIGN', 'W', '-1,9', '1,21', '', '0,10', '0,10', '0,20', '0,20', '']);
    expect(bus.promptText).toBe('Scale objects based on alignment points? [Yes/No] <N>:');
    await bus.submit('');
    expect(ends(byHandle('30')!)).toEqual([0, 10, 0, 20]);
  });
});
