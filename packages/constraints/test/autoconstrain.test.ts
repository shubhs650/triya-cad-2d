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
