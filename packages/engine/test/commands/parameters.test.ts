// M9-03 part 5: PARAMETERS and PARAMETERSCLOSE open and close the Parameters Manager, and the
// palette's edits run as commands on the bus, each one undo step. The solver is a stand-in that
// records what it was asked; packages/constraints/test/solver.test.ts runs the edits against
// PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  isDimensionalConstraint,
  isUserParameter,
  parameterEditCommand,
  type BusEvent,
  type CommandOutput,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type Entity,
  type ParameterChangeResult,
  type ParameterEdit,
  type ParameterInfo,
  type ParameterObject,
  type UserParameterObject,
  type ViewRequest,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';

const D1: DimensionalConstraintObject = {
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [{ entity: '30' }],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: 2 },
  form: 'dynamic',
};
const D2: DimensionalConstraintObject = {
  ...D1,
  handle: 'D2',
  parameter: 'd2',
  expression: 'd1/2',
};
const U1: UserParameterObject = {
  handle: 'E1',
  type: 'TRIYA_USERPARAMETER',
  owner: 'C',
  parameter: 'user1',
  expression: 'd1*3',
};

function setup(
  answer: (asked: string) => ParameterChangeResult = () => ({
    ok: true,
    updated: [],
    expressions: [],
  }),
  solver: 'stub' | 'none' | 'broken' = 'stub',
  extra: readonly ParameterObject[] = [],
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    entities: [entityInit('30', lineGeom(0, 0, 10, 0))],
    objects: [...(init.objects ?? []), D1, D2, ...extra],
  });
  const asked: string[] = [];
  const passed: string[][] = [];
  const views: ViewRequest[] = [];
  const service = {
    setExpression: (_c, dims, name, expression, lookup, tol) => {
      passed.push(dims.map((d) => d.parameter));
      expect(lookup('30')).toBeDefined();
      expect(tol.linear).toBeGreaterThan(0);
      asked.push(`expression ${name}=${expression}`);
      return answer(asked.at(-1)!);
    },
    renameParameter: (dims, from, to) => {
      passed.push(dims.map((d) => d.parameter));
      asked.push(`rename ${from} ${to}`);
      return answer(asked.at(-1)!);
    },
    deleteParameter: (dims, name) => {
      passed.push(dims.map((d) => d.parameter));
      asked.push(`delete ${name}`);
      return answer(asked.at(-1)!);
    },
  } as Partial<ConstraintSolver> as ConstraintSolver;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        views.push(r);
        return Promise.resolve({ ok: true });
      },
    },
    ...(solver === 'stub' && { constraints: () => Promise.resolve(service) }),
    ...(solver === 'broken' && { constraints: () => Promise.reject(new Error('no WASM')) }),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dims = () => [...model.objects.values()].filter(isDimensionalConstraint);
  const users = () => [...model.objects.values()].filter(isUserParameter);
  const edit = (e: ParameterEdit) => bus.run(parameterEditCommand(e));
  return { model, bus, log, asked, passed, views, dims, users, edit };
}

describe('PARAMETERS and PARAMETERSCLOSE', () => {
  it.each([
    ['PARAMETERS', true],
    ['PAR', true],
    ['PARAMETERSCLOSE', false],
  ] as const)('%s asks the app for the palette', async (name, open) => {
    const s = setup();
    const version = s.model.version;
    await s.bus.submit(name);
    expect(s.views).toEqual([{ op: 'palette', palette: 'parameters', open }]);
    expect(s.bus.command).toBeUndefined();
    expect(s.model.version).toBe(version);
  });
});

describe("the Parameters Manager's edits", () => {
  it('sets an expression: the geometry moves and the expressions change, one undo step', async () => {
    const s = setup();
    const line = s.model.entityByHandle('30')!;
    const moved = { ...line, geom: lineGeom(0, 0, 12, 0) } as Entity;
    const t = setup(() => ({
      ok: true,
      updated: [{ before: line, after: { ...moved, id: t.model.entityByHandle('30')!.id } }],
      expressions: [{ parameter: 'd1', expression: '12' }],
    }));
    await t.edit({ kind: 'expression', name: 'd1', expression: ' 12 ' });
    expect(t.asked).toEqual(['expression d1=12']);
    expect(t.passed).toEqual([['d1', 'd2']]);
    expect(t.model.entityByHandle('30')!.geom).toEqual(lineGeom(0, 0, 12, 0));
    expect(t.dims()[0]).toMatchObject({ parameter: 'd1', expression: '12' });
    expect(t.log).toEqual([]);
    await t.bus.script(['U']);
    expect(t.model.entityByHandle('30')!.geom).toEqual(lineGeom(0, 0, 10, 0));
    expect(t.dims()[0]!.expression).toBe('10');
    expect(s.asked).toEqual([]);
  });

  it('renames a parameter, rewriting the expressions that use it', async () => {
    const s = setup(() => ({
      ok: true,
      updated: [],
      expressions: [{ parameter: 'd2', expression: 'width/2' }],
    }));
    await s.edit({ kind: 'rename', name: 'd1', to: 'width ' });
    expect(s.asked).toEqual(['rename d1 width']);
    expect(s.dims().map((d) => [d.parameter, d.expression])).toEqual([
      ['width', '10'],
      ['d2', 'width/2'],
    ]);
  });

  it('deletes a parameter with its constraint', async () => {
    const s = setup(() => ({
      ok: true,
      updated: [],
      expressions: [{ parameter: 'd2', expression: '5' }],
    }));
    await s.edit({ kind: 'delete', name: 'd1' });
    expect(s.dims().map((d) => [d.parameter, d.expression])).toEqual([['d2', '5']]);
    await s.bus.script(['U']);
    expect(s.dims()).toHaveLength(2);
  });

  it('keeps a description trimmed; an empty one clears it', async () => {
    const s = setup();
    await s.edit({ kind: 'description', name: 'd2', description: '  Half the width ' });
    expect(s.dims()[1]!.description).toBe('Half the width');
    const version = s.model.version;
    await s.edit({ kind: 'description', name: 'd2', description: 'Half the width' });
    expect(s.model.version).toBe(version);
    await s.edit({ kind: 'description', name: 'd2', description: ' ' });
    expect(s.dims()[1]!.description).toBeUndefined();
  });

  it('does nothing for an edit that changes nothing', async () => {
    const s = setup();
    const version = s.model.version;
    await s.edit({ kind: 'expression', name: 'd1', expression: '10 ' });
    await s.edit({ kind: 'rename', name: 'd1', to: ' d1' });
    await s.edit({ kind: 'description', name: 'd1', description: '' });
    expect(s.asked).toEqual([]);
    expect(s.model.version).toBe(version);
  });

  it('says why when the solver refuses, or the parameter or the solver is missing', async () => {
    const refused = setup(() => ({
      ok: false,
      reason: 'invalid',
      message: 'name in use',
      conflicting: [],
    }));
    await refused.edit({ kind: 'rename', name: 'd1', to: 'd2' });
    expect(refused.log).toEqual(['Name in use.']);
    expect(refused.dims()[0]!.parameter).toBe('d1');

    const missing = setup();
    await missing.edit({ kind: 'delete', name: 'd9' });
    expect(missing.log).toEqual(['No parameter named "d9".']);

    const none = setup(undefined, 'none');
    await none.edit({ kind: 'delete', name: 'd1' });
    expect(none.log).toEqual(['Dimensional constraints are not available here.']);

    const broken = setup(undefined, 'broken');
    await broken.edit({ kind: 'delete', name: 'd1' });
    expect(broken.log).toEqual(['The constraint solver could not load: no WASM']);
    expect(broken.dims()).toHaveLength(2);
  });
});

describe('user parameters (M9-03 part 6)', () => {
  it('New makes user1 = 1, then user2, each one undo step, filed under the root dictionary', async () => {
    const s = setup();
    await s.edit({ kind: 'new' });
    expect(s.users()).toEqual([
      expect.objectContaining({
        type: 'TRIYA_USERPARAMETER',
        owner: 'C',
        parameter: 'user1',
        expression: '1',
      }),
    ]);
    expect(s.users()[0]!.description).toBeUndefined();
    await s.edit({ kind: 'new' });
    expect(s.users().map((u) => u.parameter)).toEqual(['user1', 'user2']);
    expect(s.asked).toEqual([]);
    expect(s.log).toEqual([]);
    await s.bus.script(['U']);
    expect(s.users().map((u) => u.parameter)).toEqual(['user1']);
    await s.bus.script(['U']);
    expect(s.users()).toEqual([]);
  });

  it('New takes the lowest name no parameter has, a dimensional one included', async () => {
    const s = setup(undefined, 'stub', [{ ...U1, handle: 'E2', parameter: 'user2' }]);
    await s.edit({ kind: 'new' });
    expect(s.users().map((u) => u.parameter)).toEqual(['user2', 'user1']);
    const t = setup(undefined, 'stub', [{ ...D1, handle: 'D3', parameter: 'user1' }]);
    await t.edit({ kind: 'new' });
    expect(t.users().map((u) => u.parameter)).toEqual(['user2']);
  });

  it('New needs no solver', async () => {
    const s = setup(undefined, 'none');
    await s.edit({ kind: 'new' });
    expect(s.users()).toHaveLength(1);
    expect(s.log).toEqual([]);
  });

  it('gives the solver the user parameters with the constraints', async () => {
    const s = setup(
      () => ({ ok: true, updated: [], expressions: [{ parameter: 'user1', expression: '7' }] }),
      'stub',
      [U1],
    );
    await s.edit({ kind: 'expression', name: 'user1', expression: '7' });
    expect(s.asked).toEqual(['expression user1=7']);
    expect(s.passed).toEqual([['d1', 'd2', 'user1']]);
    expect(s.users()[0]!.expression).toBe('7');
  });

  it('renames one, and a rename rewrites the user parameters naming it', async () => {
    const s = setup(
      () => ({
        ok: true,
        updated: [],
        expressions: [{ parameter: 'user1', expression: 'width*3' }],
      }),
      'stub',
      [U1],
    );
    await s.edit({ kind: 'rename', name: 'd1', to: 'width' });
    expect(s.users()[0]).toMatchObject({ parameter: 'user1', expression: 'width*3' });
    const t = setup(undefined, 'stub', [U1]);
    await t.edit({ kind: 'rename', name: 'user1', to: 'gap' });
    expect(t.asked).toEqual(['rename user1 gap']);
    expect(t.users()[0]!.parameter).toBe('gap');
  });

  it('deletes one: its object goes, the expressions naming it keep its value', async () => {
    const s = setup(
      () => ({ ok: true, updated: [], expressions: [{ parameter: 'd2', expression: '30' }] }),
      'stub',
      [U1],
    );
    await s.edit({ kind: 'delete', name: 'user1' });
    expect(s.users()).toEqual([]);
    expect(s.dims().map((d) => [d.parameter, d.expression])).toEqual([
      ['d1', '10'],
      ['d2', '30'],
    ]);
    await s.bus.script(['U']);
    expect(s.users()).toHaveLength(1);
  });

  it('keeps a description', async () => {
    const s = setup(undefined, 'stub', [U1]);
    await s.edit({ kind: 'description', name: 'user1', description: 'Bolt pitch' });
    expect(s.users()[0]!.description).toBe('Bolt pitch');
  });
});

describe('EngineSession and the Parameters Manager', () => {
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const row = (d: ParameterObject): ParameterInfo => ({
    name: d.parameter,
    expression: d.expression,
    value: 10,
    type: 'Aligned',
    description: d.description ?? '',
    reference: false,
    constraint: d.handle,
  });

  function session(objects: readonly ParameterObject[], loads = true) {
    const init = sampleInit();
    let asked = 0;
    const solver = {
      parameters: (dims) => {
        asked++;
        return dims.map(row);
      },
    } as Partial<ConstraintSolver> as ConstraintSolver;
    const se = new EngineSession(
      {
        ...init,
        meta: { ...init.meta, rootDictionary: 'C' },
        entities: [entityInit('30', lineGeom(0, 0, 10, 0))],
        objects: [...(init.objects ?? []), ...objects],
      },
      {
        constraints: () => (loads ? Promise.resolve(solver) : Promise.reject(new Error('no'))),
      },
    );
    const out: CommandOutput[] = [];
    se.onCommand((o) => out.push(o));
    const rows = () =>
      out
        .filter((o): o is Extract<CommandOutput, { type: 'parameters' }> => o.type === 'parameters')
        .map((o) => o.rows.map((r) => `${r.name}=${r.expression}:${r.description}`));
    return { se, rows, asked: () => asked };
  }

  it('sends the rows while the palette is open, again after each edit and undo', async () => {
    const s = session([D1, D2]);
    await s.se.command({ kind: 'parameters', open: true });
    expect(s.rows()).toEqual([['d1=10:', 'd2=d1/2:']]);
    await s.se.command({
      kind: 'parameter',
      edit: { kind: 'description', name: 'd1', description: 'Width' },
    });
    await flush();
    expect(s.rows().at(-1)).toEqual(['d1=10:Width', 'd2=d1/2:']);
    await s.se.command({ kind: 'submit', text: 'U' });
    await flush();
    expect(s.rows().at(-1)).toEqual(['d1=10:', 'd2=d1/2:']);
    await s.se.command({ kind: 'parameters', open: false });
    const sent = s.rows().length;
    await s.se.command({
      kind: 'parameter',
      edit: { kind: 'description', name: 'd2', description: 'Half' },
    });
    await flush();
    expect(s.rows()).toHaveLength(sent);
  });

  it('sends the rows of a drawing with user parameters only', async () => {
    const s = session([{ ...U1, expression: '4' }]);
    await s.se.command({ kind: 'parameters', open: true });
    expect(s.rows()).toEqual([['user1=4:']]);
    await s.se.command({ kind: 'parameter', edit: { kind: 'new' } });
    await flush();
    expect(s.rows().at(-1)).toEqual(['user1=4:', 'user2=1:']);
  });

  it('sends no rows without constraints, and none when the solver does not load', async () => {
    const none = session([]);
    await none.se.command({ kind: 'parameters', open: true });
    expect(none.rows()).toEqual([[]]);
    expect(none.asked()).toBe(0);
    const broken = session([D1], false);
    await broken.se.command({ kind: 'parameters', open: true });
    expect(broken.rows()).toEqual([[]]);
  });
});
