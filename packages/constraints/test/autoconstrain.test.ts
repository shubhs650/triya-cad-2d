// M9-05 part 3: AUTOCONSTRAIN with the real solver (`constraintSolver` over PlaneGCS), as the
// app's engine worker runs it. A sketch drawn nearly square becomes exactly so, and the
// constraints the ones already applied make redundant are skipped, as AutoCAD skips them: a
// rectangle's two parallel pairs, one perpendicular, one horizontal and its equal sides, nothing
// that over-constrains it.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  isGeometricConstraint,
  toleranceForSize,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type LineGeometry,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { constraintSolver, loadPlaneGcs, type PlaneGcs } from '../src/index';

let gcs: PlaneGcs;
beforeAll(async () => {
  gcs = await loadPlaneGcs(() =>
    Promise.resolve(readFileSync(new URL('../wasm/planegcs.wasm', import.meta.url))),
  );
});

const MODEL = '1F';

type Vec = { x: number; y: number };

const entity = (handle: string, geom: EntityGeometry) => ({
  handle,
  owner: MODEL,
  type: geom.kind,
  layer: '10',
  color: { kind: 'byLayer' as const },
  linetype: 'ByLayer',
  lineweight: 'ByLayer' as const,
  transparency: 'ByLayer' as const,
  ltScale: 1,
  visible: true,
  geom,
});

const line = (handle: string, x1: number, y1: number, x2: number, y2: number) =>
  entity(handle, { kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });

function setup(entities: ReturnType<typeof entity>[]) {
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '40',
    header: new Map(),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL }],
    entities,
  };
  const model = DocumentModel.create(init);
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const ids: EntityId[] = [];
      for (const e of model.entities()) {
        if (closestPoint(e.geom as LineGeometry, r.point, toleranceForSize(100)).distance < 0.25) {
          ids.push(e.id);
        }
      }
      return Promise.resolve({ ok: true, ids });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    constraints: () => Promise.resolve(constraintSolver(gcs)),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const ends = (h: string) => {
    const g = model.entityByHandle(h)!.geom as LineGeometry;
    return [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  };
  const kinds = () => [...model.objects.values()].filter(isGeometricConstraint).map((c) => c.kind);
  const select = async (...points: { x: number; y: number }[]) => {
    for (const p of points) await bus.pick(p);
    await bus.submit('');
  };
  return { model, bus, log, ends, kinds, select };
}

describe('AUTOCONSTRAIN with PlaneGCS (M9-05 part 3)', () => {
  it('squares up a sketch of a square, skipping what is redundant', async () => {
    // A 10 x 10 square drawn a little off: corners up to 0.03 apart, sides 0.3° off true.
    const s = setup([
      line('30', 0, 0, 10, 0.05),
      line('31', 10.02, 0.03, 10, 10),
      line('32', 10, 10.01, 0.03, 10.02),
      line('33', 0, 10, 0.01, 0.02),
    ]);
    await s.bus.script(['AUTOCONSTRAIN']);
    await s.select({ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 });
    expect(s.bus.command).toBeUndefined();
    // 4 corners, 2 parallel pairs, 1 perpendicular (the other three follow), 1 horizontal (the
    // vertical sides follow) and 1 equal (a rectangle's opposite sides are equal already).
    expect(s.kinds()).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'parallel',
      'parallel',
      'perpendicular',
      'horizontal',
      'equal',
    ]);
    expect(s.log).toContain('9 constraints applied to 4 objects.');
    // Square, with every corner shared.
    const [a, b, c, d] = ['30', '31', '32', '33'].map(s.ends);
    expect(a![1]).toBeCloseTo(a![3]!, 9);
    expect(b![0]).toBeCloseTo(b![2]!, 9);
    expect(a![2]).toBeCloseTo(b![0]!, 9);
    expect(b![3]).toBeCloseTo(c![1]!, 9);
    expect(c![2]).toBeCloseTo(d![0]!, 9);
    expect(d![3]).toBeCloseTo(a![1]!, 9);
    const len = (e: number[]) => Math.hypot(e[2]! - e[0]!, e[3]! - e[1]!);
    expect(len(a!)).toBeCloseTo(len(b!), 9);
    expect(len(a!)).toBeCloseTo(10, 1);
    // One undo step takes it all back.
    await s.bus.script(['U']);
    expect(s.kinds()).toEqual([]);
    expect(s.ends('30')).toEqual([0, 0, 10, 0.05]);
  });

  it('takes splines by their ends and ellipses by centre and curve (M9-05 part 5)', async () => {
    // An ellipse 10 by 4 about the origin; a line along its top 0.03 above it; a circle 0.02
    // off its centre; a spline from 0.02 off its right end to 0.03 short of a line's start.
    const s = setup([
      entity('30', {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 10, y: 0 },
        ratio: 0.4,
        startParam: 0,
        endParam: 2 * Math.PI,
      } as EntityGeometry),
      line('31', -5, 4.03, 5, 4.03),
      entity('32', { kind: 'CIRCLE', center: { x: 0.02, y: 0.01 }, radius: 2 } as EntityGeometry),
      entity('33', {
        kind: 'SPLINE',
        degree: 3,
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        controlPoints: [
          { x: 10.02, y: 0.01 },
          { x: 13, y: 3 },
          { x: 17, y: 3 },
          { x: 20, y: 0 },
        ],
        closed: false,
        periodic: false,
      } as unknown as EntityGeometry),
      line('34', 20.03, 0, 25, 0),
    ]);
    await s.bus.script(['AUTOCONSTRAIN']);
    await s.select(
      { x: 0, y: -4 },
      { x: 4, y: 4.03 },
      { x: -2, y: 0 },
      { x: 15, y: 2.25 },
      {
        x: 23,
        y: 0,
      },
    );
    expect(s.bus.command).toBeUndefined();
    expect(s.kinds()).toEqual([
      'coincident',
      'coincident',
      'parallel',
      'tangent',
      'concentric',
      'horizontal',
    ]);
    const geom = (h: string) => s.model.entityByHandle(h)!.geom;
    const e = geom('30') as { center: Vec; majorAxis: Vec; ratio: number };
    const c = geom('32') as { center: Vec };
    const sp = geom('33') as { controlPoints: Vec[] };
    const [, y31] = s.ends('31');
    const [x34, y34] = s.ends('34');
    // The circle shares the ellipse's centre.
    expect(c.center.x).toBeCloseTo(e.center.x, 9);
    expect(c.center.y).toBeCloseTo(e.center.y, 9);
    // The line touches the ellipse: as far from its centre as the ellipse reaches up.
    const a = Math.hypot(e.majorAxis.x, e.majorAxis.y);
    const reach = Math.hypot(e.majorAxis.y, e.ratio * e.majorAxis.x);
    expect(Math.abs(y31! - e.center.y)).toBeCloseTo(reach, 6);
    // The spline starts on the ellipse and ends on the line's start.
    const p0 = sp.controlPoints[0]!;
    const u = { x: e.majorAxis.x / a, y: e.majorAxis.y / a };
    const dx = p0.x - e.center.x;
    const dy = p0.y - e.center.y;
    const along = (dx * u.x + dy * u.y) / a;
    const across = (-dx * u.y + dy * u.x) / (a * e.ratio);
    expect(along ** 2 + across ** 2).toBeCloseTo(1, 9);
    expect(sp.controlPoints[3]!.x).toBeCloseTo(x34!, 9);
    expect(sp.controlPoints[3]!.y).toBeCloseTo(y34!, 9);
    expect(s.log).toContain('6 constraints applied to 5 objects.');
  });

  it('adds nothing more when run again', async () => {
    const s = setup([line('30', 0, 0, 10, 0), line('31', 10, 0, 10, 6)]);
    await s.bus.script(['AUTOCONSTRAIN']);
    await s.select({ x: 5, y: 0 }, { x: 10, y: 3 });
    const first = s.kinds();
    expect(first).toEqual(['coincident', 'perpendicular', 'horizontal']);
    await s.bus.script(['AUTOCONSTRAIN']);
    await s.select({ x: 5, y: 0 }, { x: 10, y: 3 });
    expect(s.kinds()).toEqual(first);
    expect(s.log.at(-1)).toBe('No constraints applied.');
    expect(s.bus.undo.state.undoable).toBe(1);
  });
});
