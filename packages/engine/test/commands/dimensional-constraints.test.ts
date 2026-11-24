// M9-03 part 3: DIMCONSTRAINT and DCLINEAR … DCDIAMETER on the PromptBus, with AutoCAD 2024's
// prompts ("DIMCONSTRAINT (Command)" and each DC* command's page). The solver is a stand-in that
// records what it was asked and answers as told; packages/constraints/test/solver.test.ts runs
// the commands against PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  edgeCurvesOf,
  isDimensionalConstraint,
  linearDirection,
  parseDimensionText,
  toleranceForSize,
  type BusEvent,
  type ConstraintSolver,
  type DimensionAddResult,
  type DimensionalConstraintSpec,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { NO_PARAMETERS } from './solver-stub';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

/** Picks take the model-space objects within 0.25 of the pick. */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const hits: [number, EntityId][] = [];
      for (const e of model().entities()) {
        if (e.owner !== MODEL_SPACE) continue;
        const c = edgeCurvesOf(e.geom, false)[0];
        const d = c ? closestPoint(c, r.point, toleranceForSize(100)).distance : Infinity;
        if (d < 0.25) hits.push([d, e.id]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
    },
  };
}

type Answer = (spec: DimensionalConstraintSpec, existing: number) => DimensionAddResult;

const accepted =
  (value = 10, expression = '10'): Answer =>
  (spec, existing) => ({
    ok: true,
    dimension: spec.dimension === 'linear' ? 'horizontal' : spec.dimension,
    parameter: spec.parameter ?? `d${existing + 1}`,
    expression: spec.expression ?? expression,
    value,
    updated: [],
    dofs: 2,
    expressions: [],
  });

/**
 * Line 30 (0,0)-(10,0), line 31 (0,5)-(10,8), circle 32 at (20,0) r 2, a polyline 33
 * (30,0)-(40,0)-(40,10) and an arc 34 at (60,0) r 5 from 0° to 90°. The solver measures 10
 * (an angle 90) and names a new parameter d1 (ang1, rad1, dia1).
 */
function setup(answer: Answer = accepted()) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', lineGeom(0, 5, 10, 8)),
      entityInit('32', { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 2 }),
      entityInit('33', {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 30, y: 0, bulge: 0 },
          { x: 40, y: 0, bulge: 0 },
          { x: 40, y: 10, bulge: 0 },
        ],
      } as EntityGeometry),
      entityInit('34', {
        kind: 'ARC',
        center: { x: 60, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
    ],
  });
  const asked: DimensionalConstraintSpec[] = [];
  const measured: DimensionalConstraintSpec[] = [];
  const prefix = { angular: 'ang', radial: 'rad', diameter: 'dia' } as Record<string, string>;
  const service: ConstraintSolver = {
    ...NO_PARAMETERS,
    add: () => {
      throw new Error('no geometric constraints here');
    },
    // The DC* commands solve their own edits: the bus never re-solves after them (M9-06).
    solveEdit: () => {
      throw new Error('not asked');
    },
    measure: (dims, spec, lookup) => {
      expect(lookup(spec.refs[0]!.entity)).toBeDefined();
      measured.push(spec);
      const dimension = spec.dimension === 'linear' ? 'horizontal' : spec.dimension;
      return {
        ok: true,
        dimension,
        value: dimension === 'angular' ? 90 : 10,
        parameter: `${prefix[dimension] ?? 'd'}${dims.length + 1}`,
      };
    },
    addDimension: (constraints, dims, spec, _lookup, tol) => {
      expect(tol.linear).toBeGreaterThan(0);
      expect(constraints).toEqual([]);
      asked.push(spec);
      return answer(spec, dims.length);
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model),
    constraints: () => Promise.resolve(service),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dims = () => [...model.objects.values()].filter(isDimensionalConstraint);
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  return { model, bus, log, asked, measured, dims, byHandle };
}

describe('DCALIGNED', () => {
  it('takes a line (Object, the default), the location and the measured value on Enter', async () => {
    const s = setup();
    await s.bus.script(['DCALIGNED']);
    expect(s.bus.promptText).toBe(
      'Specify first constraint point or [Object/Point&line/2Line] <Object>:',
    );
    await s.bus.script(['']);
    expect(s.bus.promptText).toBe('Select object:');
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.bus.promptText).toBe('Specify dimension line location:');
    await s.bus.pick({ x: 4, y: 9 });
    expect(s.bus.promptText).toBe('Dimension text <d1=10.0000>:');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.asked).toEqual([{ dimension: 'aligned', refs: [{ entity: '31' }] }]);
    expect(s.dims()).toEqual([
      expect.objectContaining({
        type: 'TRIYA_DIMCONSTRAINT',
        owner: 'C',
        dimension: 'aligned',
        refs: [{ entity: '31' }],
        parameter: 'd1',
        expression: '10',
        location: { x: 4, y: 9 },
        form: 'dynamic',
      }),
    ]);
    expect(s.dims()[0]!.reference).toBeUndefined();
  });

  it('takes a name and expression typed, and U takes the constraint back', async () => {
    const before = setup().byHandle('31').geom;
    const s = setup((spec) => ({
      ...(accepted(20)(spec, 0) as DimensionAddResult & { ok: true }),
      updated: [
        {
          before: s.byHandle('31'),
          after: { ...s.byHandle('31'), geom: lineGeom(0, 5, 19.08, 11) } as Entity,
        },
      ],
    }));
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 4, y: 9 });
    await s.bus.script(['width = 2 * 10']);
    expect(s.asked[0]).toEqual({
      dimension: 'aligned',
      refs: [{ entity: '31' }],
      parameter: 'width',
      expression: '2 * 10',
    });
    expect(s.dims()[0]).toMatchObject({ parameter: 'width', expression: '2 * 10' });
    expect(s.byHandle('31').geom).toEqual(lineGeom(0, 5, 19.08, 11));
    await s.bus.script(['U']);
    expect(s.dims()).toEqual([]);
    expect(s.byHandle('31').geom).toEqual(before);
  });

  it('takes two points, a point and a line, or two lines', async () => {
    const s = setup();
    await s.bus.script(['DCALIGNED']);
    await s.bus.pick({ x: 0.1, y: 0 });
    expect(s.bus.promptText).toBe('Specify second constraint point:');
    await s.bus.pick({ x: 9.9, y: 7.9 });
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.script(['']);
    await s.bus.script(['DCALIGNED', 'P']);
    expect(s.bus.promptText).toBe('Specify constraint point:');
    await s.bus.pick({ x: 0.1, y: 0 });
    expect(s.bus.promptText).toBe('Select line:');
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.script(['']);
    await s.bus.script(['DCALIGNED', '2L']);
    expect(s.bus.promptText).toBe('Select first line:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select second line to make parallel:');
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 0, y: 10 });
    await s.bus.script(['']);
    expect(s.asked.map((a) => a.refs)).toEqual([
      [
        { entity: '30', point: 'start' },
        { entity: '31', point: 'end' },
      ],
      [{ entity: '30', point: 'start' }, { entity: '31' }],
      [{ entity: '30' }, { entity: '31' }],
    ]);
    // Each new constraint's parameter is the next name.
    expect(s.dims().map((d) => d.parameter)).toEqual(['d1', 'd2', 'd3']);
  });
});

describe('DCLINEAR, DCHORIZONTAL and DCVERTICAL', () => {
  it('DCLINEAR is horizontal or vertical by where the dimension line goes', async () => {
    const s = setup();
    await s.bus.script(['DCLINEAR']);
    expect(s.bus.promptText).toBe('Specify first constraint point or [Object] <Object>:');
    await s.bus.pick({ x: 0.1, y: 0 });
    await s.bus.pick({ x: 9.9, y: 7.9 });
    // Beside the points: vertical.
    await s.bus.pick({ x: 14, y: 4 });
    await s.bus.script(['']);
    expect(s.measured.map((m) => m.dimension)).toEqual(['linear', 'vertical']);
    expect(s.asked[0]!.dimension).toBe('vertical');
    await s.bus.script(['DCLINEAR', 'O']);
    await s.bus.pick({ x: 5, y: 0 });
    // Below the line: horizontal.
    await s.bus.pick({ x: 5, y: -3 });
    await s.bus.script(['']);
    expect(s.asked[1]).toMatchObject({ dimension: 'horizontal', refs: [{ entity: '30' }] });
  });

  it('DCHORIZONTAL and DCVERTICAL keep their direction', async () => {
    const s = setup();
    await s.bus.script(['DCVERTICAL', 'O']);
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 5, y: -3 });
    await s.bus.script(['']);
    await s.bus.script(['DCHORIZONTAL', 'O']);
    await s.bus.pick({ x: 35, y: 0 });
    await s.bus.pick({ x: 50, y: 5 });
    await s.bus.script(['']);
    expect(s.asked.map((a) => [a.dimension, a.refs])).toEqual([
      ['vertical', [{ entity: '31' }]],
      ['horizontal', [{ entity: '33', segment: 0 }]],
    ]);
  });

  it('linearDirection: above or below horizontal, beside vertical, inside by the points', () => {
    const p = { x: 0, y: 0 };
    const q = { x: 10, y: 4 };
    expect(linearDirection(p, q, { x: 5, y: 9 })).toBe('horizontal');
    expect(linearDirection(p, q, { x: 5, y: -2 })).toBe('horizontal');
    expect(linearDirection(p, q, { x: 13, y: 2 })).toBe('vertical');
    expect(linearDirection(p, q, { x: -1, y: 2 })).toBe('vertical');
    expect(linearDirection(p, q, { x: 5, y: 2 })).toBe('horizontal');
    expect(linearDirection(p, { x: 2, y: 9 }, { x: 1, y: 5 })).toBe('vertical');
    // A corner: the farther side decides.
    expect(linearDirection(p, q, { x: 11, y: 8 })).toBe('horizontal');
    expect(linearDirection(p, q, { x: 15, y: 5 })).toBe('vertical');
  });
});

describe('DCANGULAR, DCRADIUS and DCDIAMETER', () => {
  it('DCANGULAR takes two lines, an arc, or three points (3Point, the default)', async () => {
    const s = setup();
    await s.bus.script(['DCANGULAR']);
    expect(s.bus.promptText).toBe('Select first line or arc or [3Point] <3Point>:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select second line:');
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 12, y: 3 });
    expect(s.bus.promptText).toBe('Dimension text <ang1=90>:');
    await s.bus.script(['']);
    await s.bus.script(['DCANGULAR']);
    await s.bus.pick({ x: 60 + 5 * Math.SQRT1_2, y: 5 * Math.SQRT1_2 });
    await s.bus.pick({ x: 70, y: 8 });
    await s.bus.script(['']);
    await s.bus.script(['DCANGULAR', '']);
    expect(s.bus.promptText).toBe('Specify angle vertex:');
    await s.bus.pick({ x: 39.9, y: 0 });
    expect(s.bus.promptText).toBe('Specify first angle constraint point:');
    await s.bus.pick({ x: 30.1, y: 0 });
    expect(s.bus.promptText).toBe('Specify second angle constraint point:');
    await s.bus.pick({ x: 40, y: 9.9 });
    await s.bus.pick({ x: 36, y: 4 });
    await s.bus.script(['']);
    expect(s.asked.map((a) => [a.dimension, a.refs])).toEqual([
      ['angular', [{ entity: '30' }, { entity: '31' }]],
      ['angular', [{ entity: '34' }]],
      [
        'angular',
        [
          { entity: '33', point: 'vertex', index: 1 },
          { entity: '33', point: 'vertex', index: 0 },
          { entity: '33', point: 'vertex', index: 2 },
        ],
      ],
    ]);
  });

  it('DCRADIUS and DCDIAMETER take a circle or arc', async () => {
    const s = setup();
    await s.bus.script(['DCRADIUS']);
    expect(s.bus.promptText).toBe('Select arc or circle:');
    await s.bus.pick({ x: 22, y: 0 });
    await s.bus.pick({ x: 25, y: 3 });
    expect(s.bus.promptText).toBe('Dimension text <rad1=10.0000>:');
    await s.bus.script(['']);
    await s.bus.script(['DCDIAMETER']);
    await s.bus.pick({ x: 65, y: 0 });
    await s.bus.pick({ x: 66, y: 3 });
    await s.bus.script(['']);
    expect(s.asked.map((a) => [a.dimension, a.refs])).toEqual([
      ['radial', [{ entity: '32' }]],
      ['diameter', [{ entity: '34' }]],
    ]);
  });
});

describe('the dimension text and the solver', () => {
  it('parseDimensionText: name=expression, an expression alone, or nothing', () => {
    expect(parseDimensionText('')).toEqual({});
    expect(parseDimensionText(' 25 ')).toEqual({ expression: '25' });
    expect(parseDimensionText('w=d1/2')).toEqual({ parameter: 'w', expression: 'd1/2' });
    expect(parseDimensionText('w =')).toEqual({ error: 'Enter a value or expression after "w=".' });
    expect(parseDimensionText('2*(3+4)')).toEqual({ expression: '2*(3+4)' });
  });

  it('asks again for the text after a value the solver refuses', async () => {
    const s = setup((spec) =>
      spec.expression === '-5'
        ? {
            ok: false,
            reason: 'invalid',
            message: 'A distance must be greater than 0.',
            conflicting: ['0'],
          }
        : accepted()(spec, 0),
    );
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 3 });
    await s.bus.script(['-5']);
    expect(s.log).toContain('A distance must be greater than 0.');
    expect(s.bus.promptText).toBe('Dimension text <d1=10.0000>:');
    await s.bus.script(['5']);
    expect(s.dims()).toEqual([expect.objectContaining({ expression: '5' })]);
  });

  it('offers a reference constraint when the value over-constrains', async () => {
    const over: Answer = (spec) =>
      spec.reference
        ? accepted()(spec, 0)
        : {
            ok: false,
            reason: 'redundant',
            message: 'The constraint would over-constrain the geometry',
            conflicting: ['0'],
          };
    const s = setup(over);
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 3 });
    await s.bus.script(['']);
    expect(s.log).toContain('The constraint would over-constrain the geometry.');
    expect(s.bus.promptText).toBe('Create a reference constraint? [Yes/No] <Yes>:');
    await s.bus.script(['']);
    expect(s.asked.at(-1)).toMatchObject({ reference: true });
    expect(s.dims()).toEqual([expect.objectContaining({ reference: true, expression: '10' })]);

    const t = setup(over);
    await t.bus.script(['DCALIGNED', 'O']);
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.pick({ x: 5, y: 3 });
    await t.bus.script(['', 'N']);
    expect(t.bus.command).toBeUndefined();
    expect(t.dims()).toEqual([]);
  });

  it("keeps other constraints' expressions in step with the solve", async () => {
    let n = 0;
    const s = setup((spec) => ({
      ...(accepted()(spec, 0) as DimensionAddResult & { ok: true }),
      parameter: `d${++n}`,
      expressions: n === 2 ? [{ parameter: 'd1', expression: '12.5' }] : [],
    }));
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 3 });
    await s.bus.script(['']);
    await s.bus.script(['DCALIGNED', 'O']);
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 5, y: 9 });
    await s.bus.script(['']);
    expect(s.dims().map((d) => [d.parameter, d.expression])).toEqual([
      ['d1', '12.5'],
      ['d2', '10'],
    ]);
  });
});

describe('DIMCONSTRAINT', () => {
  it('asks for the type (the last one its default) and keeps the Form for the DC* commands', async () => {
    const s = setup();
    await s.bus.script(['DCON']);
    expect(s.log).toContain('Current settings: Constraint Form = Dynamic');
    expect(s.bus.promptText).toBe(
      'Select associative dimension to convert or [LInear/Horizontal/Vertical/ALigned/ANgular/Radius/Diameter/Form] <ALigned>:',
    );
    await s.bus.script(['F']);
    expect(s.bus.promptText).toBe('Enter constraint form [Annotational/Dynamic] <Dynamic>:');
    await s.bus.script(['A']);
    expect(s.log).toContain('Current settings: Constraint Form = Annotational');
    await s.bus.script(['R']);
    expect(s.bus.promptText).toBe('Select arc or circle:');
    await s.bus.pick({ x: 22, y: 0 });
    await s.bus.pick({ x: 25, y: 3 });
    await s.bus.script(['']);
    await s.bus.script(['DIMCONSTRAINT']);
    expect(s.bus.promptText).toMatch(/<Radius>:$/);
    await s.bus.cancel();
    await s.bus.script(['DCDIAMETER']);
    await s.bus.pick({ x: 22, y: 0 });
    await s.bus.pick({ x: 25, y: 3 });
    await s.bus.script(['']);
    expect(s.dims().map((d) => [d.dimension, d.form])).toEqual([
      ['radial', 'annotational'],
      ['diameter', 'annotational'],
    ]);
  });

  it('says converting a dimension is not supported yet, and asks again', async () => {
    const s = setup();
    await s.bus.script(['DIMCONSTRAINT']);
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.log).toContain('Invalid selection. Select an associative dimension.');
    expect(s.bus.promptText).toMatch(/^Select associative dimension to convert or/);
    await s.bus.cancel();
  });
});

describe('when the solver is missing or refuses the references', () => {
  const drawing = () =>
    DocumentModel.create({ ...sampleInit(), entities: [entityInit('30', lineGeom(0, 0, 10, 0))] });

  it('says so when there is no solver, or it cannot load', async () => {
    for (const [constraints, line] of [
      [undefined, 'Dimensional constraints are not available here.'],
      [
        () => Promise.reject(new Error('no WebAssembly')),
        'The constraint solver could not load: no WebAssembly',
      ],
    ] as const) {
      const model = drawing();
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: host(() => model),
        ...(constraints && { constraints }),
      });
      const log: string[] = [];
      bus.on((e) => e.type === 'log' && log.push(e.line));
      await bus.script(['DCALIGNED', 'O']);
      await bus.pick({ x: 5, y: 0 });
      expect(log).toContain(line);
      expect(bus.command).toBeUndefined();
    }
  });

  it('says why the references cannot take the constraint and asks again', async () => {
    const model = drawing();
    const refuse: ConstraintSolver = {
      ...NO_PARAMETERS,
      add: () => ({ ok: false, reason: 'invalid', message: 'x', conflicting: [] }),
      measure: () => ({
        ok: false,
        reason: 'invalid',
        message: 'angular needs two different lines',
        conflicting: [],
      }),
      addDimension: () => ({ ok: false, reason: 'invalid', message: 'x', conflicting: [] }),
      solveEdit: () => ({ ok: false, reason: 'invalid', message: 'x', conflicting: [] }),
    };
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: host(() => model),
      constraints: () => Promise.resolve(refuse),
    });
    const log: string[] = [];
    bus.on((e) => e.type === 'log' && log.push(e.line));
    await bus.script(['DCANGULAR']);
    await bus.pick({ x: 5, y: 0 });
    await bus.pick({ x: 5, y: 0 });
    expect(log).toContain('Angular needs two different lines.');
    expect(bus.promptText).toBe('Select first line or arc or [3Point] <3Point>:');
    await bus.cancel();
  });
});
