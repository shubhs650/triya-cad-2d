// M9-03 part 9: DCCONVERT and DIMCONSTRAINT's "Select associative dimension to convert" on the
// PromptBus (AutoCAD 2024 Help, "DCCONVERT (Command)": "Converts associative dimensions to
// dimensional constraints"; "DIMCONSTRAINT (Command)"). The solver is a stand-in that records
// what it was asked; packages/constraints/test/solver.test.ts converts with PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  isDimensionalConstraint,
  toleranceForSize,
  type BusEvent,
  type ConstraintSolver,
  type DimensionAddResult,
  type DimensionalConstraintSpec,
  type DimensionGeometry,
  type EntityGeometry,
  type EntityId,
  type LineGeometry,
  type Vec2,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { NO_PARAMETERS } from './solver-stub';
import { MODEL_SPACE, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

const FIELDS = {
  style: '27',
  textUserPositioned: false,
  text: '',
  textRotation: 0,
  horizontalDirection: 0,
  attachment: 5,
  lineSpacingStyle: 1,
  lineSpacing: 1,
};

const linear = (first: Vec2, second: Vec2, at: Vec2, rotation?: number) =>
  ({
    kind: 'DIMENSION',
    ...FIELDS,
    dimType: rotation === undefined ? 'aligned' : 'linear',
    first,
    second,
    definitionPoint: at,
    textPosition: at,
    ...(rotation !== undefined && { rotation }),
  }) as EntityGeometry;

const radius = (center: Vec2, chordPoint: Vec2, at: Vec2) =>
  ({
    kind: 'DIMENSION',
    ...FIELDS,
    dimType: 'radius',
    definitionPoint: center,
    chordPoint,
    leaderLength: 0,
    textPosition: at,
  }) as EntityGeometry;

const ordinate = {
  kind: 'DIMENSION',
  ...FIELDS,
  dimType: 'ordinate',
  axis: 'x',
  feature: { x: 0, y: 0 },
  leaderEnd: { x: 0, y: 5 },
  definitionPoint: { x: 0, y: 0 },
  textPosition: { x: 0, y: 6 },
} as EntityGeometry;

type Answer = (spec: DimensionalConstraintSpec, existing: number) => DimensionAddResult;

const prefix: Record<string, string> = { angular: 'ang', radial: 'rad', diameter: 'dia' };

/** Takes every constraint at a measured value of 10, naming it after the parameters so far. */
const accepted: Answer = (spec, existing) => ({
  ok: true,
  dimension: spec.dimension === 'linear' ? 'horizontal' : spec.dimension,
  parameter: spec.parameter ?? `${prefix[spec.dimension] ?? 'd'}${existing + 1}`,
  expression: '10',
  value: 10,
  updated: [],
  dofs: 2,
  expressions: [],
});

/**
 * Line 30 (0,0)-(10,0), circle 31 at (20,0) r 2, line 32 (0,20)-(10,20) on the locked layer
 * LOCKED; dimensions: 40 horizontal over line 30, 41 the circle's radius, 42 an ordinate one,
 * 43 vertical between nothing, 44 horizontal over line 32. A pick takes a dimension within 0.5
 * of its text, else a line within 0.25.
 */
function setup(answer: Answer = accepted, vars?: Map<string, number>) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    tables: {
      ...init.tables,
      layers: [...init.tables!.layers!, { ...layer('12', 'LOCKED'), locked: true }],
    },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 2 }),
      entityInit('32', lineGeom(0, 20, 10, 20), { layer: '12' }),
      entityInit('40', linear({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, 0)),
      entityInit('41', radius({ x: 20, y: 0 }, { x: 22, y: 0 }, { x: 25, y: 1 })),
      entityInit('42', ordinate),
      entityInit('43', linear({ x: 0, y: 7 }, { x: 0, y: 9 }, { x: -3, y: 8 }, Math.PI / 2)),
      entityInit('44', linear({ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 5, y: 23 }, 0)),
    ],
  });
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'sysvar' && vars) {
        if (r.value !== undefined) vars.set(r.name, r.value as number);
        return Promise.resolve({ ok: true, value: vars.get(r.name) ?? 0 });
      }
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const ids: EntityId[] = [];
      for (const e of model.entities()) {
        if (e.owner !== MODEL_SPACE) continue;
        const g = e.geom;
        if (g.kind === 'DIMENSION') {
          const t = (g as DimensionGeometry).textPosition;
          if (Math.hypot(t.x - r.point.x, t.y - r.point.y) < 0.5) ids.push(e.id);
        } else if (g.kind === 'LINE') {
          const d = closestPoint(g as LineGeometry, r.point, toleranceForSize(100)).distance;
          if (d < 0.25) ids.push(e.id);
        }
      }
      return Promise.resolve({ ok: true, ids });
    },
  };
  const asked: DimensionalConstraintSpec[] = [];
  const service: ConstraintSolver = {
    ...NO_PARAMETERS,
    add: () => {
      throw new Error('no geometric constraints here');
    },
    solveEdit: () => {
      throw new Error('not asked');
    },
    measure: () => {
      throw new Error('not asked');
    },
    addDimension: (constraints, dims, spec, lookup, tol) => {
      expect(tol.linear).toBeGreaterThan(0);
      expect(constraints).toEqual([]);
      expect(lookup(spec.refs[0]!.entity)).toBeDefined();
      asked.push(spec);
      return answer(spec, dims.length);
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    constraints: () => Promise.resolve(service),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dims = () => [...model.objects.values()].filter(isDimensionalConstraint);
  const has = (h: string) => model.entityByHandle(h) !== undefined;
  const id = (h: string) => model.entityByHandle(h)!.id;
  return { model, bus, log, asked, dims, has, id };
}

describe('DCCONVERT (M9-03 part 9)', () => {
  it('converts the dimensions selected to constraints of their values; the dimensions go', async () => {
    const s = setup();
    await s.bus.script(['DCCONVERT']);
    expect(s.bus.promptText).toBe('Select associative dimensions to convert:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('40'), s.id('41'), s.id('30')] });
    expect(s.bus.command).toBeUndefined();
    // Enter's measured value: no expression asked for.
    expect(s.asked).toEqual([
      { dimension: 'horizontal', refs: [{ entity: '30' }] },
      { dimension: 'radial', refs: [{ entity: '31' }] },
    ]);
    expect(s.dims()).toEqual([
      expect.objectContaining({
        type: 'TRIYA_DIMCONSTRAINT',
        owner: 'C',
        dimension: 'horizontal',
        refs: [{ entity: '30' }],
        parameter: 'd1',
        expression: '10',
        location: { x: 5, y: -3 },
        form: 'dynamic',
      }),
      expect.objectContaining({
        dimension: 'radial',
        refs: [{ entity: '31' }],
        // The constraint converted before it counts among the parameters.
        parameter: 'rad2',
        location: { x: 25, y: 1 },
      }),
    ]);
    expect(s.has('40')).toBe(false);
    expect(s.has('41')).toBe(false);
    expect(s.has('30')).toBe(true);
    expect(s.log).toContain('2 dimensions converted.');
  });

  it('U puts the dimensions back and takes the constraints away, as one step', async () => {
    const s = setup();
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('40'), s.id('41')] });
    await s.bus.script(['U']);
    expect(s.dims()).toEqual([]);
    expect(s.has('40')).toBe(true);
    expect(s.has('41')).toBe(true);
  });

  it('says why the others are not converted, and leaves them', async () => {
    const s = setup();
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({
      kind: 'selection',
      ids: [s.id('42'), s.id('43'), s.id('44'), s.id('40')],
    });
    expect(s.log).toContain('1 dimension converted.');
    expect(s.log).toContain(
      '1 dimension not converted: ordinate, arc length and jogged dimensions have no dimensional constraint.',
    );
    expect(s.log).toContain(
      '1 dimension not converted: their points are not on objects a constraint can take.',
    );
    expect(s.log).toContain(
      '1 dimension not converted: they or the objects they measure are on a locked layer.',
    );
    expect(['42', '43', '44'].map(s.has)).toEqual([true, true, true]);
    expect(s.dims()).toHaveLength(1);
  });

  it('says so when nothing selected is a dimension', async () => {
    const s = setup();
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('30')] });
    expect(s.log).toContain('No dimensions selected.');
    expect(s.dims()).toEqual([]);
  });

  it('a value that would over-constrain becomes a reference constraint', async () => {
    const s = setup((spec, n) =>
      spec.reference || spec.dimension !== 'radial'
        ? accepted(spec, n)
        : {
            ok: false,
            reason: 'overconstrained',
            message: 'the value over-constrains the geometry',
            conflicting: [],
          },
    );
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('40'), s.id('41')] });
    expect(s.asked.map((a) => [a.dimension, a.reference])).toEqual([
      ['horizontal', undefined],
      ['radial', undefined],
      ['radial', true],
    ]);
    expect(s.dims().map((d) => d.reference)).toEqual([undefined, true]);
    expect(s.log).toContain('2 dimensions converted, 1 as a reference constraint.');
  });

  it('a value the solver refuses outright leaves the dimension, with its reason', async () => {
    const s = setup((spec, n) =>
      spec.dimension === 'radial'
        ? { ok: false, reason: 'invalid', message: 'the circle cannot take it', conflicting: [] }
        : accepted(spec, n),
    );
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('40'), s.id('41')] });
    expect(s.log).toContain('1 dimension not converted: the circle cannot take it.');
    expect(s.has('41')).toBe(true);
    expect(s.dims()).toHaveLength(1);
  });

  it('takes the Constraint Form from CCONSTRAINTFORM', async () => {
    const s = setup(accepted, new Map([['CCONSTRAINTFORM', 1]]));
    await s.bus.script(['DCCONVERT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('40')] });
    expect(s.dims().map((d) => d.form)).toEqual(['annotational']);
    // Annotational, it looks as the dimension did: the dimension's style (M9-03 part 15).
    expect(s.dims()[0]!.style).toBe('27');
  });
});

describe("DIMCONSTRAINT's Select associative dimension to convert", () => {
  it('converts the dimension picked and ends', async () => {
    const s = setup();
    await s.bus.script(['DIMCONSTRAINT']);
    await s.bus.pick({ x: 5, y: -3 });
    expect(s.bus.command).toBeUndefined();
    expect(s.dims()).toEqual([
      expect.objectContaining({ dimension: 'horizontal', form: 'dynamic' }),
    ]);
    expect(s.has('40')).toBe(false);
  });

  it('a dimension that does not convert says why and ends; anything else asks again', async () => {
    const s = setup();
    await s.bus.script(['DIMCONSTRAINT']);
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.log).toContain('Invalid selection. Select an associative dimension.');
    expect(s.bus.promptText).toMatch(/^Select associative dimension to convert or/);
    await s.bus.pick({ x: -3, y: 8 });
    expect(s.log).toContain(
      '1 dimension not converted: their points are not on objects a constraint can take.',
    );
    expect(s.bus.command).toBeUndefined();
  });
});
