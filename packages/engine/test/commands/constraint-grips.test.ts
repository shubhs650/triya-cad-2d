// M9-03 part 11: a selected dimensional constraint's grips and double-click editing of its
// text. AutoCAD 2024 Help, "To Change the Value of a Dimensional Constraint": "Select the
// constraint and click a triangular grip" and drag it; "Double-click the constraint" (or
// TEXTEDIT) and type a new value or expression; "About Applying Dimensional Constraints": the
// square grip moves the text and dimension line. The solver is a stand-in;
// packages/constraints/test/dimensional.test.ts runs a value set from either side on PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  isDimensionalConstraint,
  type BusEvent,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type ParameterChangeResult,
  type ViewReply,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';
import { NO_PARAMETERS } from './solver-stub';

const D1: DimensionalConstraintObject = {
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'horizontal',
  refs: [
    { entity: '30', point: 'start' },
    { entity: '30', point: 'end' },
  ],
  parameter: 'd1',
  expression: '10',
  location: { x: 5, y: 2 },
  form: 'dynamic',
};

function setup(answer: (asked: string) => ParameterChangeResult = () => ok()) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    entities: [entityInit('30', lineGeom(0, 0, 10, 0))],
    objects: [
      ...(init.objects ?? []),
      D1,
      { ...D1, handle: 'D2', parameter: 'd2', expression: 'd1/2', location: { x: 5, y: -3 } },
    ],
  });
  const asked: string[] = [];
  const service = {
    ...NO_PARAMETERS,
    setExpression: (_c, dims, name, expression, lookup, tol, side) => {
      expect(lookup('30')).toBeDefined();
      expect(tol.linear).toBeGreaterThan(0);
      expect(dims.map((d) => d.parameter)).toContain(name);
      asked.push(`expression ${name}=${expression}${side ? ` ${side}` : ''}`);
      return answer(asked.at(-1)!);
    },
    renameParameter: (_dims, from, to) => {
      asked.push(`rename ${from} ${to}`);
      return answer(asked.at(-1)!);
    },
  } as Partial<ConstraintSolver> as ConstraintSolver;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        if (r.op === 'constraintAt') {
          const c =
            r.point.x === 5 && r.point.y === 2
              ? 'D1'
              : r.point.x === 5 && r.point.y === -3
                ? 'D2'
                : undefined;
          return Promise.resolve({ ok: true, ...(c && { constraint: c }) });
        }
        if (r.op === 'pick') return Promise.resolve({ ok: true, ids: [] });
        return Promise.resolve({ ok: true });
      },
    },
    constraints: () => Promise.resolve(service),
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const dim = (h: string) =>
    [...model.objects.values()].filter(isDimensionalConstraint).find((d) => d.handle === h);
  const grips = () => events.flatMap((e) => (e.type === 'grips' ? [e] : []));
  const log = () => events.flatMap((e) => (e.type === 'log' ? [e.line] : []));
  const prompt = () => bus.prompt?.message;
  return { model, bus, asked, dim, grips, log, prompt };
}

function ok(extra: Partial<ParameterChangeResult & { ok: true }> = {}): ParameterChangeResult {
  return { ok: true, updated: [], expressions: [], ...extra };
}

describe('grips of a selected dimensional constraint', () => {
  it('show while it is selected at Command:, and go with it', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    expect(s.bus.constraintSelection).toEqual(['D1']);
    expect(s.grips().at(-1)).toMatchObject({ ids: [], constraints: ['D1'] });
    await s.bus.cancel();
    expect(s.grips().at(-1)?.constraints).toBeUndefined();
  });

  it('a triangle at the second end sets the value from it; one undo step', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: 10.1, y: 2 }, { grip: 0.5 });
    expect(s.bus.command).toBe('GRIP');
    expect(s.grips().at(-1)).toMatchObject({ constraints: ['D1'], hot: { x: 10, y: 2 } });
    expect(s.log()).toContain('** STRETCH **');
    expect(s.prompt()).toBe('Specify stretch point or');
    await s.bus.pick({ x: 12.5, y: 4 });
    expect(s.asked).toEqual(['expression d1=12.5 second']);
    expect(s.bus.command).toBeUndefined();
    // It stays selected, its grips shown again with none hot.
    expect(s.bus.constraintSelection).toEqual(['D1']);
    expect(s.grips().at(-1)?.hot).toBeUndefined();
  });

  it('a triangle at the first end holds the second side', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: 0, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: -2, y: 2 });
    expect(s.asked).toEqual(['expression d1=12 first']);
  });

  it('says why the solver refused, and leaves the value', async () => {
    const s = setup(() => ({
      ok: false,
      reason: 'invalid',
      message: 'd1: the value must be greater than 0',
      conflicting: [],
    }));
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: 10, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: -1, y: 2 });
    expect(s.log()).toContain('D1: the value must be greater than 0.');
    expect(s.dim('D1')?.expression).toBe('10');
  });

  it('the square moves the text and dimension line; U puts it back', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    expect(s.bus.command).toBe('GRIP');
    await s.bus.pick({ x: 6, y: 7 });
    expect(s.dim('D1')?.location).toEqual({ x: 6, y: 7 });
    expect(s.asked).toEqual([]);
    await s.bus.script(['U']);
    expect(s.dim('D1')?.location).toEqual({ x: 5, y: 2 });
  });

  it('eXit and Esc leave it as it was', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: 2 }, { grip: 0.5 });
    await s.bus.pick({ x: 10, y: 2 }, { grip: 0.5 });
    await s.bus.submit('X');
    expect(s.bus.command).toBeUndefined();
    await s.bus.pick({ x: 10, y: 2 }, { grip: 0.5 });
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.asked).toEqual([]);
    expect(s.dim('D1')?.location).toEqual({ x: 5, y: 2 });
  });

  it('a value that is an expression of others has only the square', async () => {
    const s = setup();
    await s.bus.pick({ x: 5, y: -3 }, { grip: 0.5 });
    expect(s.bus.constraintSelection).toEqual(['D2']);
    // Where the second triangle would be: no grip, so the click is no grip edit.
    await s.bus.pick({ x: 10, y: -3 }, { grip: 0.5 });
    expect(s.bus.command).toBeUndefined();
  });
});

describe('double-click editing of a dimensional constraint', () => {
  it('asks for its text, name=expression shown; a new name and value both apply', async () => {
    const s = setup();
    await s.bus.doubleClick({ x: 5, y: 2 });
    expect(s.prompt()).toBe('Dimension text');
    expect(s.bus.prompt).toMatchObject({ default: { kind: 'string', value: 'd1=10' } });
    await s.bus.submit('width=12');
    expect(s.asked).toEqual(['rename d1 width', 'expression width=12']);
    expect(s.dim('D1')?.parameter).toBe('width');
    expect(s.bus.command).toBeUndefined();
  });

  it('a value alone sets the expression; Enter keeps the text', async () => {
    const s = setup();
    await s.bus.doubleClick({ x: 5, y: 2 });
    await s.bus.submit('');
    expect(s.asked).toEqual([]);
    await s.bus.doubleClick({ x: 5, y: 2 });
    await s.bus.submit('15');
    expect(s.asked).toEqual(['expression d1=15']);
  });

  it('a double click on no constraint goes to the objects as before', async () => {
    const s = setup();
    await s.bus.doubleClick({ x: 50, y: 50 });
    expect(s.bus.command).toBeUndefined();
  });
});
