// M9-05 part 7: Infer Constraints with the real solver (`constraintSolver` over PlaneGCS), as
// the app's engine worker runs it. What is inferred already holds, so the solver takes it all
// without moving anything: LINE's segments joined end to start and closed, a segment from a
// line's end, RECTANG's sides, a line drawn perpendicular to another and one tangent to a circle.
// Part 8: a fillet's arc Coincident with and Tangent to both lines (solved at the shared ends), a
// line on the Parallel path, and a copy tracked horizontally from another line's end.
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
      // The bars' requests answered.
      if (r.op === 'constraintBars') return Promise.resolve({ ok: true });
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
  // CONSTRAINTINFER on, as the app tells each drawing's engine.
  bus.setConstraintInfer(true);
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

const kindsOf = (model: DocumentModel) =>
  [...model.objects.values()].filter(isGeometricConstraint).map((c) => c.kind);

describe('Infer Constraints with PlaneGCS (M9-05 part 7)', () => {
  it("LINE from a line's end, closed: every joint Coincident, nothing moved", async () => {
    const s = setup([line('30', 0, 0, 10, 0)]);
    const id = s.model.entityByHandle('30')!.id;
    await s.bus.script(['LINE']);
    await s.bus.pick({ x: 10, y: 0 }, { snap: { mode: 'END', id } });
    for (const p of ['13,7', '4,9', 'C']) await s.bus.submit(p);
    expect(s.bus.command).toBeUndefined();
    expect(kindsOf(s.model)).toEqual(['coincident', 'coincident', 'coincident', 'coincident']);
    expect(s.ends('30')).toEqual([0, 0, 10, 0]);
    const made = [...s.model.entities()]
      .filter((e) => e.handle !== '30')
      .map((e) => s.ends(e.handle));
    expect(made).toEqual([
      [10, 0, 13, 7],
      [13, 7, 4, 9],
      [4, 9, 10, 0],
    ]);
  });

  it('RECTANG takes two Parallel and one Perpendicular, and stays where it was drawn', async () => {
    const s = setup([]);
    await s.bus.script(['RECTANG', '2,3', '9,7']);
    expect(kindsOf(s.model)).toEqual(['parallel', 'parallel', 'perpendicular']);
    const [r] = [...s.model.entities()];
    const g = r!.geom as { vertices: { x: number; y: number }[] };
    expect(g.vertices.map((v) => [v.x, v.y])).toEqual([
      [2, 3],
      [9, 3],
      [9, 7],
      [2, 7],
    ]);
  });

  it('a line PERpendicular to another, and one TANgent to a circle', async () => {
    const s = setup([
      line('30', 0, 0, 10, 0),
      entity('31', { kind: 'CIRCLE', center: { x: 50, y: 0 }, radius: 5 }),
    ]);
    const idOf = (h: string) => s.model.entityByHandle(h)!.id;
    await s.bus.script(['LINE', '6,8']);
    await s.bus.pick({ x: 6, y: 0 }, { snap: { mode: 'PER', id: idOf('30') } });
    await s.bus.submit('');
    await s.bus.script(['LINE', '55,10']);
    await s.bus.pick({ x: 55, y: 0 }, { snap: { mode: 'TAN', id: idOf('31') } });
    await s.bus.submit('');
    expect(kindsOf(s.model)).toEqual(['coincident', 'perpendicular', 'tangent']);
    const made = [...s.model.entities()].filter((e) => e.geom.kind === 'LINE' && e.handle !== '30');
    expect(made.map((e) => s.ends(e.handle))).toEqual([
      [6, 8, 6, 0],
      [55, 10, 55, 0],
    ]);
  });
});

describe('Infer Constraints with PlaneGCS (M9-05 part 8)', () => {
  it('FILLET: both ends Coincident and both lines Tangent, the arc where it was made', async () => {
    const s = setup([line('30', 0, 0, 10, 0), line('31', 12, 2, 12, 10)]);
    await s.bus.script(['FILLET', 'R', '1']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 12, y: 6 });
    expect(s.bus.command).toBeUndefined();
    expect(kindsOf(s.model).sort()).toEqual(['coincident', 'coincident', 'tangent', 'tangent']);
    expect(s.ends('30')).toEqual([0, 0, 11, 0]);
    expect(s.ends('31')).toEqual([12, 1, 12, 10]);
    const arc = [...s.model.entities()].find((e) => e.geom.kind === 'ARC')!.geom;
    expect(arc).toMatchObject({ center: { x: 11, y: 1 }, radius: 1 });
  });

  it('a line on the Parallel path, and a copy tracked horizontally from an end', async () => {
    const s = setup([line('30', 0, 0, 10, 0), line('31', 20, 20, 30, 25)]);
    const idOf = (h: string) => s.model.entityByHandle(h)!.id;
    await s.bus.script(['LINE', '0,10']);
    await s.bus.pick(
      { x: 8, y: 14 },
      { tracks: [{ mode: 'PAR', id: idOf('31'), from: { x: 24, y: 22 } }] },
    );
    await s.bus.submit('');
    await s.bus.script(['COPY']);
    await s.select({ x: 5, y: 0 });
    await s.bus.pick({ x: 0, y: 0 }, { snap: { mode: 'END', id: idOf('30') } });
    await s.bus.pick(
      { x: 40, y: 25 },
      {
        tracks: [{ mode: 'END', id: idOf('31'), from: { x: 30, y: 25 }, along: 'horizontal' }],
      },
    );
    await s.bus.submit('');
    expect(kindsOf(s.model)).toEqual(['parallel', 'horizontal']);
    const made = [...s.model.entities()].filter((e) => !['30', '31'].includes(e.handle));
    expect(made.map((e) => s.ends(e.handle))).toEqual([
      [0, 10, 8, 14],
      [40, 25, 50, 25],
    ]);
  });
});
