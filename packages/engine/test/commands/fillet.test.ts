// M3-02 part 3: FILLET and CHAMFER on the PromptBus, driven as the command line and the canvas
// drive them, with AutoCAD 2024's prompts and options (AutoCAD 2024 Help, "FILLET (Command)",
// "CHAMFER (Command)"): Radius, Trim/No trim, Multiple, Undo, Polyline, Shift for a sharp
// corner; Distance, Angle and mEthod. The geometry is `edit/corner.ts`'s (test/edit/corner.test.ts).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** A canvas whose picks take the objects within 0.25 of the pick, nearest first. */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') {
        const hits: [number, EntityId][] = [];
        for (const e of model().entities()) {
          if (e.owner !== MODEL_SPACE) continue;
          const c = offsetCurveOf(e.geom);
          const d = c ? closestPoint(c, r.point, toleranceForSize(100)).distance : Infinity;
          if (d < 0.25) hits.push([d, e.id]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

/**
 * A drawing of its own: an L of lines 30 (0,0)-(10,0) and 31 (0,0)-(0,10), lines 32
 * (20,0)-(30,0) and 33 (32,2)-(32,10) short of meeting, a circle 34 at (50,5) r 2, and
 * whatever `extra` adds (handles from 40 on, on WALLS).
 */
function setup(
  extra: EntityGeometry[] = [],
  o: { lockedWalls?: boolean; header?: [string, HeaderValue][] } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ...(o.header ?? [])]),
    tables: {
      ...init.tables,
      layers: [
        layer(LAYER_0, '0'),
        { ...layer(LAYER_WALLS, 'WALLS'), locked: o.lockedWalls ?? false },
      ],
    },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', lineGeom(0, 0, 0, 10)),
      entityInit('32', lineGeom(20, 0, 30, 0)),
      entityInit('33', lineGeom(32, 2, 32, 10)),
      entityInit('34', { kind: 'CIRCLE', center: { x: 50, y: 5 }, radius: 2 }),
      ...extra.map((g, i) =>
        entityInit((0x40 + i).toString(16).toUpperCase(), g, { layer: LAYER_WALLS }),
      ),
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
  const arcs = () =>
    [...model.entities()].filter((e) => e.geom.kind === 'ARC' && e.owner === MODEL_SPACE);
  const lines = () =>
    [...model.entities()].filter((e) => e.geom.kind === 'LINE' && e.owner === MODEL_SPACE);
  return { model, bus, log, byHandle, arcs, lines };
}

const FILLET_FIRST = 'Select first object or [Undo/Polyline/Radius/Trim/Multiple]:';
const FILLET_SECOND = 'Select second object or shift-select to apply corner or [Radius]:';
const CHAMFER_FIRST = 'Select first line or [Undo/Polyline/Distance/Angle/Trim/mEthod/Multiple]:';
const CHAMFER_SECOND =
  'Select second line or shift-select to apply corner or [Distance/Angle/Method]:';

describe('FILLET', () => {
  it('fillets two lines at the radius set, trimming them, as AutoCAD 2024', async () => {
    const { bus, log, byHandle, arcs, model } = setup([], { header: [['$FILLETRAD', 0]] });
    await bus.script(['F']);
    expect(log).toContain('Current settings: Mode = TRIM, Radius = 0.0000');
    expect(bus.promptText).toBe(FILLET_FIRST);
    expect(bus.prompt).toMatchObject({ kind: 'point', pickbox: true });
    await bus.script(['R']);
    expect(bus.promptText).toBe('Specify fillet radius <0.0000>:');
    await bus.script(['2']);
    // FILLETRAD is the drawing's, saved with it.
    expect(model.header.get('$FILLETRAD')).toBe(2);
    expect(bus.promptText).toBe(FILLET_FIRST);
    await bus.pick({ x: 6, y: 0 });
    expect(bus.promptText).toBe(FILLET_SECOND);
    await bus.pick({ x: 0, y: 6 });
    // One fillet and the command ends.
    expect(bus.command).toBeUndefined();
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 2, y: 0 }, end: { x: 10, y: 0 } });
    expect(byHandle('31')!.geom).toMatchObject({ start: { x: 0, y: 2 }, end: { x: 0, y: 10 } });
    expect(arcs()).toHaveLength(1);
    expect(arcs()[0]!.geom).toMatchObject({ center: { x: 2, y: 2 }, radius: 2 });
    // Both lines are on layer 0, so the arc is too.
    expect(arcs()[0]).toMatchObject({ layer: LAYER_0 });
    // The next FILLET offers the radius as its default.
    await bus.script(['FILLET', 'R']);
    expect(bus.promptText).toBe('Specify fillet radius <2.0000>:');
  });

  it('extends lines short of the corner, and Shift makes a sharp corner whatever the radius', async () => {
    const { bus, byHandle, arcs } = setup();
    await bus.script(['FILLET', 'R', '1']);
    await bus.pick({ x: 25, y: 0 });
    await bus.pick({ x: 32, y: 6 }, { shift: true });
    expect(arcs()).toHaveLength(0);
    expect(byHandle('32')!.geom).toMatchObject({ start: { x: 20, y: 0 }, end: { x: 32, y: 0 } });
    expect(byHandle('33')!.geom).toMatchObject({ start: { x: 32, y: 0 }, end: { x: 32, y: 10 } });
  });

  it('keeps the objects in No trim mode, a setting FILLET and CHAMFER share', async () => {
    const { bus, log, byHandle, arcs } = setup();
    await bus.script(['FILLET', 'T']);
    expect(bus.promptText).toBe('Enter Trim mode option [Trim/No trim] <Trim>:');
    await bus.script(['N', 'R', '1']);
    await bus.pick({ x: 6, y: 0 });
    await bus.pick({ x: 0, y: 6 });
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(arcs()).toHaveLength(1);
    await bus.script(['CHAMFER']);
    expect(log).toContain('(NOTRIM mode) Current chamfer Dist1 = 0.0000, Dist2 = 0.0000');
  });

  it('fillets again and again with Multiple, and Undo takes back the last', async () => {
    const { bus, byHandle, arcs, log } = setup();
    await bus.script(['FILLET', 'R', '1', 'M']);
    await bus.pick({ x: 6, y: 0 });
    await bus.pick({ x: 0, y: 6 });
    expect(bus.promptText).toBe(FILLET_FIRST);
    await bus.pick({ x: 25, y: 0 });
    await bus.pick({ x: 32, y: 6 });
    expect(arcs()).toHaveLength(2);
    await bus.script(['U']);
    expect(arcs()).toHaveLength(1);
    expect(byHandle('32')!.geom).toMatchObject({ start: { x: 20, y: 0 }, end: { x: 30, y: 0 } });
    expect(byHandle('33')!.geom).toMatchObject({ start: { x: 32, y: 2 } });
    await bus.script(['U', 'U']);
    expect(arcs()).toHaveLength(0);
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 } });
    expect(log).toContain('Nothing to undo.');
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('changes the radius at the second prompt, and refuses what it cannot fillet', async () => {
    const { bus, log, arcs } = setup([
      {
        kind: 'ELLIPSE',
        center: { x: 70, y: 0 },
        majorAxis: { x: 3, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      },
    ]);
    await bus.script(['FILLET']);
    await bus.pick({ x: 73, y: 0 });
    expect(log).toContain('Cannot fillet that object.');
    expect(bus.promptText).toBe(FILLET_FIRST);
    await bus.pick({ x: 6, y: 0 });
    await bus.script(['R', '20']);
    expect(bus.promptText).toBe(FILLET_SECOND);
    await bus.pick({ x: 0, y: 6 });
    expect(log).toContain('Radius is too large.');
    expect(arcs()).toHaveLength(0);
    // Back at the first prompt after a failure.
    expect(bus.promptText).toBe(FILLET_FIRST);
    await bus.pick({ x: 6, y: 0 });
    await bus.pick({ x: 7, y: 0 });
    expect(log).toContain('Cannot fillet an object to itself.');
  });

  it('fillets a line to a circle, leaving the circle whole', async () => {
    const { bus, byHandle, arcs } = setup([lineGeom(40, 0, 60, 0)]);
    await bus.script(['FILLET', 'R', '2']);
    await bus.pick({ x: 58, y: 0 });
    await bus.pick({ x: 52, y: 5 });
    expect(byHandle('34')!.geom).toMatchObject({ kind: 'CIRCLE', radius: 2 });
    const arc = arcs()[0]!.geom as { center: { x: number; y: number } };
    expect([r6(arc.center.x), r6(arc.center.y)]).toEqual([r6(50 + Math.sqrt(7)), 2]);
    expect(r6((byHandle('40')!.geom as { start: { x: number } }).start.x)).toBe(
      r6(50 + Math.sqrt(7)),
    );
    // The circle (layer 0) and the line (WALLS) differ: the arc goes on the current layer.
    expect(arcs()[0]).toMatchObject({ layer: LAYER_WALLS });
  });

  it('joins a line filleted to a polyline into the polyline', async () => {
    const poly: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 100, y: 10, bulge: 0 },
        { x: 100, y: 0, bulge: 0 },
        { x: 110, y: 0, bulge: 0 },
      ],
    };
    const { bus, byHandle } = setup([poly, lineGeom(114, 2, 114, 10)]);
    await bus.script(['FILLET', 'R', '1']);
    await bus.pick({ x: 106, y: 0 });
    await bus.pick({ x: 114, y: 6 });
    expect(byHandle('41')).toBeUndefined();
    const g = byHandle('40')!.geom as unknown as { vertices: { x: number; y: number }[] };
    expect(g.vertices.map((v) => [r6(v.x), r6(v.y)])).toEqual([
      [100, 10],
      [100, 0],
      [113, 0],
      [114, 1],
      [114, 10],
    ]);
  });

  it('fillets every vertex of a polyline with Polyline', async () => {
    const rect: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 100, y: 0, bulge: 0 },
        { x: 110, y: 0, bulge: 0 },
        { x: 110, y: 4, bulge: 0 },
        { x: 100, y: 4, bulge: 0 },
      ],
    };
    const { bus, log, byHandle } = setup([rect]);
    await bus.script(['FILLET', 'P']);
    expect(bus.promptText).toBe('Select 2D polyline or [Radius]:');
    await bus.script(['R', '3']);
    await bus.pick({ x: 105, y: 0 });
    expect(log).toContain('2 lines were filleted');
    expect(log).toContain('2 were too short');
    expect(bus.command).toBeUndefined();
    const g = byHandle('40')!.geom as unknown as { vertices: unknown[] };
    expect(g.vertices).toHaveLength(6);
    // A line is no polyline.
    await bus.script(['FILLET', 'P']);
    await bus.pick({ x: 6, y: 0 });
    expect(log).toContain('Object selected is not a 2D polyline.');
  });

  it('refuses objects on locked layers', async () => {
    const { bus, log } = setup([lineGeom(100, 0, 110, 0)], { lockedWalls: true });
    await bus.script(['FILLET']);
    await bus.pick({ x: 105, y: 0 });
    expect(log).toContain('The object is on a locked layer.');
    expect(bus.promptText).toBe(FILLET_FIRST);
  });

  it('takes typed points as picks', async () => {
    const { bus, byHandle } = setup();
    await bus.script(['FILLET', '6,0', '0,6']);
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 0, y: 0 } });
    expect(bus.command).toBeUndefined();
  });

  it('fillets parallel lines with a half circle as wide as the gap', async () => {
    const { bus, arcs, byHandle } = setup([lineGeom(100, 0, 110, 0), lineGeom(102, 4, 114, 4)]);
    await bus.script(['FILLET', 'R', '1']);
    await bus.pick({ x: 108, y: 0 });
    await bus.pick({ x: 106, y: 4 });
    expect(arcs()[0]!.geom).toMatchObject({ center: { x: 110, y: 2 }, radius: 2 });
    expect(byHandle('41')!.geom).toMatchObject({ start: { x: 102, y: 4 }, end: { x: 110, y: 4 } });
  });
});

describe('CHAMFER', () => {
  it('chamfers two lines at the distances set, as AutoCAD 2024', async () => {
    const { bus, log, byHandle, lines, model } = setup([], {
      header: [
        ['$CHAMFERA', 0],
        ['$CHAMFERB', 0],
      ],
    });
    await bus.script(['CHA']);
    expect(log).toContain('(TRIM mode) Current chamfer Dist1 = 0.0000, Dist2 = 0.0000');
    expect(bus.promptText).toBe(CHAMFER_FIRST);
    await bus.script(['D']);
    expect(bus.promptText).toBe('Specify first chamfer distance <0.0000>:');
    await bus.script(['2']);
    // The second distance offers the first.
    expect(bus.promptText).toBe('Specify second chamfer distance <2.0000>:');
    await bus.script(['3']);
    expect(model.header.get('$CHAMFERA')).toBe(2);
    expect(model.header.get('$CHAMFERB')).toBe(3);
    await bus.pick({ x: 6, y: 0 });
    expect(bus.promptText).toBe(CHAMFER_SECOND);
    await bus.pick({ x: 0, y: 6 });
    expect(bus.command).toBeUndefined();
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: 2, y: 0 } });
    expect(byHandle('31')!.geom).toMatchObject({ start: { x: 0, y: 3 } });
    expect(lines().map((e) => e.geom)).toContainEqual({
      kind: 'LINE',
      start: { x: 2, y: 0 },
      end: { x: 0, y: 3 },
    });
  });

  it('chamfers at a length and an angle, and mEthod switches between them', async () => {
    const { bus, log, byHandle } = setup();
    await bus.script(['CHAMFER', 'A']);
    expect(bus.promptText).toBe('Specify chamfer length on the first line <0.0000>:');
    await bus.script(['2']);
    expect(bus.promptText).toBe('Specify chamfer angle from the first line <0>:');
    await bus.script(['60']);
    await bus.pick({ x: 6, y: 0 });
    await bus.pick({ x: 0, y: 6 });
    const g = byHandle('31')!.geom as { start: { x: number; y: number } };
    expect(r6(g.start.y)).toBe(r6(2 * Math.sqrt(3)));
    await bus.script(['CHAMFER']);
    expect(log).toContain('(TRIM mode) Current chamfer Length = 2.0000, Angle = 60');
    await bus.script(['E']);
    expect(bus.promptText).toBe('Enter trim method [Distance/Angle] <Angle>:');
    await bus.script(['D']);
    await bus.submit('');
    await bus.script(['CHAMFER']);
    expect(log.at(-1)).toBe('(TRIM mode) Current chamfer Dist1 = 0.0000, Dist2 = 0.0000');
  });

  it('refuses arcs and parallel lines, and chamfers a polyline with Polyline', async () => {
    const rect: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 100, y: 0, bulge: 0 },
        { x: 110, y: 0, bulge: 0 },
        { x: 110, y: 4, bulge: 0 },
        { x: 100, y: 4, bulge: 0 },
      ],
    };
    const { bus, log, byHandle } = setup([rect, lineGeom(20, 5, 30, 5)]);
    await bus.script(['CHAMFER']);
    await bus.pick({ x: 52, y: 5 });
    expect(log).toContain('Cannot chamfer that object.');
    await bus.pick({ x: 25, y: 0 });
    await bus.pick({ x: 25, y: 5 });
    expect(log).toContain('Lines are parallel.');
    await bus.script(['D', '1', '1', 'P']);
    expect(bus.promptText).toBe('Select 2D polyline or [Distance/Angle/Method]:');
    await bus.pick({ x: 105, y: 0 });
    expect(log).toContain('4 lines were chamfered');
    expect((byHandle('40')!.geom as unknown as { vertices: unknown[] }).vertices).toHaveLength(8);
  });

  it('makes a sharp corner with Shift', async () => {
    const { bus, byHandle, lines } = setup();
    await bus.script(['CHAMFER', 'D', '1', '1']);
    await bus.pick({ x: 25, y: 0 });
    await bus.pick({ x: 32, y: 6 }, { shift: true });
    expect(byHandle('32')!.geom).toMatchObject({ end: { x: 32, y: 0 } });
    expect(byHandle('33')!.geom).toMatchObject({ start: { x: 32, y: 0 } });
    expect(lines()).toHaveLength(4);
  });
});
