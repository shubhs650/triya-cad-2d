// M9-05 part 1 and M9-03 parts 3 and 5: the engine's GC* and DC* commands and the Parameters Manager's edits with the real solver (`constraintSolver` over PlaneGCS),
// as the app's engine worker runs them: the second object adjusts to the first, a constraint
// that conflicts with the drawing's others is refused, and U takes a constraint back with what
// it moved.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  isDimensionalConstraint,
  isGeometricConstraint,
  parameterEditCommand,
  toleranceForSize,
  type BusEvent,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type LineGeometry,
  type ParameterEdit,
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

const line = (handle: string, x1: number, y1: number, x2: number, y2: number) => ({
  handle,
  owner: MODEL,
  type: 'LINE',
  layer: '10',
  color: { kind: 'byLayer' as const },
  linetype: 'ByLayer',
  lineweight: 'ByLayer' as const,
  transparency: 'ByLayer' as const,
  ltScale: 1,
  visible: true,
  geom: { kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } } as EntityGeometry,
});

/** Line 30 (0,0)-(10,0) and line 31 (0,5)-(10,8), with the solver loaded. */
function setup() {
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
    entities: [line('30', 0, 0, 10, 0), line('31', 0, 5, 10, 8)],
  };
  const model = DocumentModel.create(init);
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const ids: EntityId[] = [];
      for (const e of model.entities()) {
        const g = e.geom as LineGeometry;
        if (closestPoint(g, r.point, toleranceForSize(100)).distance < 0.25) ids.push(e.id);
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
  const geom = (h: string) => model.entityByHandle(h)!.geom as LineGeometry;
  const constraints = () => [...model.objects.values()].filter(isGeometricConstraint);
  const dims = () => [...model.objects.values()].filter(isDimensionalConstraint);
  return { model, bus, log, geom, constraints, dims };
}

const mid = (g: LineGeometry) => ({ x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 });

const direction = (g: LineGeometry) => {
  const dx = g.end.x - g.start.x;
  const dy = g.end.y - g.start.y;
  const n = Math.hypot(dx, dy);
  return { x: dx / n, y: dy / n };
};

describe('geometric constraint commands with PlaneGCS', () => {
  it('GCPARALLEL turns the second line to the first, which stays', async () => {
    const s = setup();
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.bus.command).toBeUndefined();
    expect(s.geom('30')).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(Math.abs(direction(s.geom('31')).y)).toBeLessThan(1e-9);
    expect(s.constraints().map((c) => c.kind)).toEqual(['parallel']);
  });

  it('refuses a constraint that conflicts with the others, and U takes one back whole', async () => {
    const s = setup();
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    const parallel = s.geom('31');
    await s.bus.script(['GCPERPENDICULAR']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick(mid(parallel));
    expect(s.log.some((l) => /over-constrain/.test(l))).toBe(true);
    expect(s.geom('31')).toEqual(parallel);
    await s.bus.cancel();
    expect(s.constraints()).toHaveLength(1);

    await s.bus.script(['U']);
    expect(s.constraints()).toEqual([]);
    expect(s.geom('31')).toMatchObject({ start: { x: 0, y: 5 }, end: { x: 10, y: 8 } });
  });

  it('GCHORIZONTAL then GCCOINCIDENT: the constrained line follows its points', async () => {
    const s = setup();
    await s.bus.script(['GCHORIZONTAL']);
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(Math.abs(direction(s.geom('31')).y)).toBeLessThan(1e-9);
    // Line 31's end onto line 30's end: line 31 stays horizontal, so it drops onto y = 0.
    await s.bus.script(['GCCOINCIDENT']);
    await s.bus.pick({ x: 9.9, y: 0 });
    const level = s.geom('31');
    await s.bus.pick({ x: level.end.x - 0.1, y: level.end.y });
    expect(s.bus.command).toBeUndefined();
    const g = s.geom('31');
    expect(Math.hypot(g.end.x - 10, g.end.y)).toBeLessThan(1e-7);
    expect(Math.abs(g.start.y)).toBeLessThan(1e-7);
    expect(s.constraints().map((c) => c.kind)).toEqual(['horizontal', 'coincident']);
  });
});

const length = (g: LineGeometry) => Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);

describe('dimensional constraint commands with PlaneGCS', () => {
  it('DCALIGNED sets a line to the length typed, its start staying; U takes it back', async () => {
    const s = setup();
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 4, y: 10 });
    expect(s.bus.promptText).toBe('Dimension text <d1=10.4403>:');
    await s.bus.script(['width=2*10']);
    expect(s.bus.command).toBeUndefined();
    expect(length(s.geom('31'))).toBeCloseTo(20, 9);
    expect(s.geom('31').start).toEqual({ x: 0, y: 5 });
    expect(s.dims()).toEqual([
      expect.objectContaining({ dimension: 'aligned', parameter: 'width', expression: '2*10' }),
    ]);
    await s.bus.script(['U']);
    expect(s.dims()).toEqual([]);
    expect(s.geom('31')).toMatchObject({ start: { x: 0, y: 5 }, end: { x: 10, y: 8 } });
  });

  it('Enter keeps the measured value; a second value on the same distance becomes a reference', async () => {
    const s = setup();
    await s.bus.script(['DCLINEAR']);
    await s.bus.pick({ x: 0.1, y: 0 });
    await s.bus.pick({ x: 9.9, y: 0 });
    await s.bus.pick({ x: 5, y: -3 });
    await s.bus.script(['']);
    expect(s.dims()).toEqual([
      expect.objectContaining({ dimension: 'horizontal', parameter: 'd1', expression: '10' }),
    ]);
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: -5 });
    expect(s.bus.promptText).toBe('Dimension text <d2=10.0000>:');
    await s.bus.script(['15']);
    expect(s.bus.promptText).toBe('Create a reference constraint? [Yes/No] <Yes>:');
    await s.bus.script(['']);
    expect(s.geom('30')).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(s.dims().map((d) => [d.parameter, d.expression, d.reference])).toEqual([
      ['d1', '10', undefined],
      ['d2', '10', true],
    ]);
    // The reference follows the geometry when the driving value changes the line.
    await s.bus.script(['GCHORIZONTAL']);
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.dims()[1]!.expression).toBe('10');
  });

  it("a geometric constraint added later keeps the dimensional constraints' values", async () => {
    const s = setup();
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 4, y: 10 });
    await s.bus.script(['20']);
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick(mid(s.geom('31')));
    expect(s.bus.command).toBeUndefined();
    expect(Math.abs(direction(s.geom('31')).y)).toBeLessThan(1e-9);
    expect(length(s.geom('31'))).toBeCloseTo(20, 7);
  });
});

/** Line 31 driven by `width=20`, line 30 by `height=width/2` (its 10 already). */
async function twoParameters() {
  const s = setup();
  await s.bus.script(['DCALIGNED', 'O']);
  await s.bus.pick({ x: 5, y: 6.5 });
  await s.bus.pick({ x: 4, y: 10 });
  await s.bus.script(['width=20']);
  await s.bus.script(['DCLINEAR']);
  await s.bus.pick({ x: 0.1, y: 0 });
  await s.bus.pick({ x: 9.9, y: 0 });
  await s.bus.pick({ x: 5, y: -3 });
  await s.bus.script(['height=width/2']);
  expect(s.bus.command).toBeUndefined();
  const edit = (e: ParameterEdit) => s.bus.run(parameterEditCommand(e));
  const rows = () => s.dims().map((d) => [d.parameter, d.expression]);
  return { ...s, edit, rows };
}

describe('the Parameters Manager with PlaneGCS (M9-03 part 5)', () => {
  it('lists each parameter with its expression, value and type', async () => {
    const s = await twoParameters();
    expect(constraintSolver(gcs).parameters(s.dims())).toEqual([
      expect.objectContaining({
        name: 'width',
        expression: '20',
        value: 20,
        type: 'Aligned',
        description: '',
        reference: false,
      }),
      expect.objectContaining({
        name: 'height',
        expression: 'width/2',
        value: 10,
        type: 'Horizontal',
      }),
    ]);
  });

  it('a new expression moves the geometry, the parameters using it too, and one U puts it back', async () => {
    const s = await twoParameters();
    await s.edit({ kind: 'expression', name: 'width', expression: '30' });
    expect(length(s.geom('31'))).toBeCloseTo(30, 7);
    expect(length(s.geom('30'))).toBeCloseTo(15, 7);
    expect(s.rows()).toEqual([
      ['width', '30'],
      ['height', 'width/2'],
    ]);
    await s.bus.script(['U']);
    expect(length(s.geom('31'))).toBeCloseTo(20, 9);
    expect(length(s.geom('30'))).toBeCloseTo(10, 9);
    expect(s.rows()[0]).toEqual(['width', '20']);
  });

  it('renaming a parameter renames it in the expressions that use it', async () => {
    const s = await twoParameters();
    await s.edit({ kind: 'rename', name: 'width', to: 'w' });
    expect(s.rows()).toEqual([
      ['w', '20'],
      ['height', 'w/2'],
    ]);
    await s.edit({ kind: 'rename', name: 'height', to: 'w' });
    expect(s.log.at(-1)).toMatch(/w/);
    expect(s.rows()[1]).toEqual(['height', 'w/2']);
  });

  it('deleting a parameter deletes its constraint; expressions that used it keep its value', async () => {
    const s = await twoParameters();
    await s.edit({ kind: 'delete', name: 'width' });
    expect(s.rows()).toEqual([['height', '10']]);
    expect(length(s.geom('30'))).toBeCloseTo(10, 9);
    // Undone, the constraint comes back (after the others, as the drawing keeps it).
    await s.bus.script(['U']);
    expect(s.rows()).toEqual([
      ['height', 'width/2'],
      ['width', '20'],
    ]);
  });

  it('refuses an expression that makes a cycle, saying why, and changes nothing', async () => {
    const s = await twoParameters();
    const before = s.geom('31');
    await s.edit({ kind: 'expression', name: 'width', expression: 'height*2' });
    expect(s.log.at(-1)).toMatch(/circular|cycle|itself/i);
    expect(s.rows()[0]).toEqual(['width', '20']);
    expect(s.geom('31')).toEqual(before);
  });

  it('keeps a description, and an empty one clears it', async () => {
    const s = await twoParameters();
    await s.edit({ kind: 'description', name: 'width', description: ' Bracket width ' });
    expect(s.dims()[0]!.description).toBe('Bracket width');
    expect(constraintSolver(gcs).parameters(s.dims())[0]!.description).toBe('Bracket width');
    await s.edit({ kind: 'description', name: 'width', description: '' });
    expect(s.dims()[0]!.description).toBeUndefined();
    await s.edit({ kind: 'description', name: 'nothing', description: 'x' });
    expect(s.log.at(-1)).toBe('No parameter named "nothing".');
  });
});
