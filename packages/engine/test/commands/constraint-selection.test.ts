// M9-03 part 10: dimensional constraints are selected by a pick at `Command:` (the canvas says
// which one is drawn under the cursor), shown in the Properties palette's Constraint rows and
// edited there (Constraint Form, Reference, Name, Expression, Description), and erased by ERASE.
// AutoCAD 2024 Help, "To Edit a Dimensional Constraint Using the Properties Palette": "Select a
// dimensional constraint … Under Constraint, click the value that you want to change"; "About
// Applying Dimensional Constraints": "You can set the Reference property in the Properties
// palette to convert a dynamic or annotational constraint to a reference parameter", and use
// it "to change dynamic constraints to annotational constraints". The solver is a stand-in;
// packages/constraints/test/dimensional.test.ts runs setReference against PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DIMCONSTRAINT_SHEET_TYPE,
  DocumentModel,
  PromptBus,
  builtinCommands,
  isDimensionalConstraint,
  propertySheet,
  type BusEvent,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type Entity,
  type ParameterChangeResult,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';
import { NO_PARAMETERS } from './solver-stub';

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
  dimension: 'angular',
  refs: [{ entity: '30' }, { entity: '31' }],
  parameter: 'ang1',
  expression: '90',
  description: 'Corner',
  reference: true,
  form: 'annotational',
};

function setup(answer: (asked: string) => ParameterChangeResult = () => ok()) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta, rootDictionary: 'C' },
    entities: [entityInit('30', lineGeom(0, 0, 10, 0)), entityInit('31', lineGeom(0, 0, 0, 10))],
    objects: [...(init.objects ?? []), D1, D2],
  });
  const asked: string[] = [];
  /** What the canvas has drawn under each point: a constraint's handle, or an entity. */
  const under = new Map<string, { constraint?: string; ids?: number[] }>();
  const views: ViewRequest[] = [];
  const service = {
    ...NO_PARAMETERS,
    renameParameter: (_dims, from, to) => {
      asked.push(`rename ${from} ${to}`);
      return answer(asked.at(-1)!);
    },
    setExpression: (_c, _dims, name, expression) => {
      asked.push(`expression ${name}=${expression}`);
      return answer(asked.at(-1)!);
    },
    setReference: (_c, dims, handle, reference, lookup, tol) => {
      expect(lookup('30')).toBeDefined();
      expect(tol.linear).toBeGreaterThan(0);
      expect(dims.map((d) => d.parameter)).toContain('d1');
      asked.push(`reference ${handle} ${reference}`);
      return answer(asked.at(-1)!);
    },
  } as Partial<ConstraintSolver> as ConstraintSolver;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        views.push(r);
        const key = 'point' in r ? `${r.point.x},${r.point.y}` : '';
        if (r.op === 'constraintAt') {
          const c = under.get(key)?.constraint;
          return Promise.resolve({ ok: true, ...(c && { constraint: c }) });
        }
        if (r.op === 'pick') return Promise.resolve({ ok: true, ids: under.get(key)?.ids ?? [] });
        return Promise.resolve({ ok: true });
      },
    },
    constraints: () => Promise.resolve(service),
  });
  const events: BusEvent[] = [];
  bus.on((e) => events.push(e));
  const dims = () => [...model.objects.values()].filter(isDimensionalConstraint);
  const dim = (h: string) => dims().find((d) => d.handle === h);
  const line = model.entityByHandle('30')!;
  under.set('5,2', { constraint: 'D1' });
  under.set('1,1', { constraint: 'D2' });
  under.set('5,0', { ids: [line.id] });
  const pick = (x: number, y: number, shift = false) =>
    bus.pick({ x, y }, shift ? { shift: true } : {});
  const selections = () =>
    events.flatMap((e) => (e.type === 'selection' ? [e.constraints ?? []] : []));
  const log = () => events.flatMap((e) => (e.type === 'log' ? [e.line] : []));
  return { model, bus, asked, views, dims, dim, line, pick, selections, log };
}

function ok(extra: Partial<ParameterChangeResult & { ok: true }> = {}): ParameterChangeResult {
  return { ok: true, updated: [], expressions: [], ...extra };
}

describe('selecting dimensional constraints', () => {
  it('a pick on a constraint at Command: selects it; Shift removes it; Esc deselects', async () => {
    const s = setup();
    await s.pick(5, 2);
    expect(s.bus.constraintSelection).toEqual(['D1']);
    expect(s.bus.selection).toEqual([]);
    expect(s.selections().at(-1)).toEqual(['D1']);
    // PICKADD 2: a pick adds, to entities and constraints alike.
    await s.pick(5, 0);
    await s.pick(1, 1);
    expect(s.bus.selection).toEqual([s.line.id]);
    expect(s.bus.constraintSelection).toEqual(['D1', 'D2']);
    await s.pick(5, 2, true);
    expect(s.bus.constraintSelection).toEqual(['D2']);
    await s.bus.cancel();
    expect(s.bus.constraintSelection).toEqual([]);
    expect(s.bus.selection).toEqual([]);
    expect(s.selections().at(-1)).toEqual([]);
  });

  it('picks the object under the cursor when no constraint is drawn there', async () => {
    const s = setup();
    await s.pick(5, 0);
    expect(s.bus.selection).toEqual([s.line.id]);
    expect(s.bus.constraintSelection).toEqual([]);
  });

  it('is not asked while a command selects: its prompts take objects only', async () => {
    const s = setup();
    await s.bus.submit('MOVE');
    s.views.length = 0;
    await s.pick(5, 2);
    expect(s.views.map((v) => v.op)).toEqual(['pick']);
    expect(s.bus.constraintSelection).toEqual([]);
  });

  it('a command that does not take them deselects them; a constraint erased leaves the set', async () => {
    const s = setup();
    await s.pick(5, 2);
    await s.bus.submit('LINE');
    expect(s.bus.constraintSelection).toEqual([]);
    await s.bus.cancel();
    await s.pick(5, 2);
    await s.bus.run({
      name: 'X',
      usesSelection: 'none',
      keepsSelection: true,
      // eslint-disable-next-line require-yield -- a test edit
      async *run(ctx) {
        ctx.edit((b) => b.removeObject('D1'));
      },
    });
    expect(s.bus.constraintSelection).toEqual([]);
  });

  it('ERASE erases the constraints selected, one undo step, without asking for objects', async () => {
    const s = setup();
    await s.pick(5, 2);
    await s.bus.submit('ERASE');
    expect(s.bus.command).toBeUndefined();
    expect(s.dims().map((d) => d.handle)).toEqual(['D2']);
    expect(s.model.entityByHandle('30')).toBeDefined();
    expect(s.bus.constraintSelection).toEqual([]);
    await s.bus.script(['U']);
    expect(
      s
        .dims()
        .map((d) => d.handle)
        .sort(),
    ).toEqual(['D1', 'D2']);
  });

  it('ERASE with objects and constraints selected erases both', async () => {
    const s = setup();
    await s.pick(1, 1);
    await s.pick(5, 0);
    await s.bus.submit('ERASE');
    expect(s.model.entityByHandle('30')).toBeUndefined();
    // D1 went with its line; D2 was selected.
    expect(s.dims()).toEqual([]);
  });
});

describe("the Properties palette's Constraint rows", () => {
  const rows = (s: ReturnType<typeof setup>, handles: string[], filter?: string) =>
    propertySheet(s.model, [], filter as never, 0, undefined, handles);

  it('lists Constraint Form, Reference, Name, Expression, Value and Description', () => {
    const s = setup();
    const sheet = rows(s, ['D1']);
    expect(sheet.count).toBe(1);
    expect(sheet.types).toEqual([
      { type: DIMCONSTRAINT_SHEET_TYPE, label: 'Dimensional Constraint', count: 1 },
    ]);
    expect(sheet.sections.map((x) => x.title)).toEqual(['Constraint']);
    const r = sheet.sections[0]!.rows;
    expect(r.map((x) => x.label)).toEqual([
      'Constraint Form',
      'Reference',
      'Name',
      'Expression',
      'Value',
      'Description',
    ]);
    expect(r.map((x) => [x.key, x.value, x.readOnly ?? false])).toEqual([
      ['constraint-form', 'dynamic', false],
      ['constraint-reference', 'no', false],
      ['constraint-name', 'd1', false],
      ['constraint-expression', '10', false],
      ['constraint-value', 10, true],
      ['constraint-description', '', false],
    ]);
    expect(r[4]!.kind).toBe('distance');
  });

  it("shows an angle's value in radians, and a reference constraint's expression read only", () => {
    const s = setup();
    const r = rows(s, ['D2']).sections[0]!.rows;
    const value = r.find((x) => x.key === 'constraint-value')!;
    expect(value.kind).toBe('angle');
    expect(value.value).toBeCloseTo(Math.PI / 2, 12);
    expect(r.find((x) => x.key === 'constraint-expression')!.readOnly).toBe(true);
    expect(r.find((x) => x.key === 'constraint-reference')!.value).toBe('yes');
    expect(r.find((x) => x.key === 'constraint-form')!.value).toBe('annotational');
  });

  it('several: shared values, the rest *VARIES*; a name and expression are one constraint’s', () => {
    const s = setup();
    const r = rows(s, ['D1', 'D2']).sections[0]!.rows;
    const by = (key: string) => r.find((x) => x.key === key)!;
    expect(by('constraint-form').varies).toBe(true);
    expect(by('constraint-name').readOnly).toBe(true);
    expect(by('constraint-expression').readOnly).toBe(true);
    expect(by('constraint-value').varies).toBe(true);
    expect(by('constraint-description').readOnly).toBeUndefined();
  });

  it('with objects selected too, lists both types and narrows to either', () => {
    const s = setup();
    const mixed = propertySheet(s.model, [s.line.id], undefined, 0, undefined, ['D1']);
    expect(mixed.count).toBe(2);
    expect(mixed.types.map((t) => t.label)).toEqual(['Line', 'Dimensional Constraint']);
    // Nothing is common to an object and a constraint.
    expect(mixed.sections).toEqual([]);
    const narrowed = propertySheet(s.model, [s.line.id], DIMCONSTRAINT_SHEET_TYPE, 0, undefined, [
      'D1',
    ]);
    expect(narrowed.filter).toBe(DIMCONSTRAINT_SHEET_TYPE);
    expect(narrowed.sections.map((x) => x.title)).toEqual(['Constraint']);
    const line = propertySheet(s.model, [s.line.id], 'LINE', 0, undefined, ['D1']);
    expect(line.sections[0]!.title).toBe('General');
  });
});

describe("the Properties palette's edits of constraints", () => {
  it('Constraint Form and Description apply to every constraint shown, one undo step', async () => {
    const s = setup();
    await s.pick(5, 2);
    await s.pick(1, 1);
    await s.bus.setProperty({ key: 'constraint-form', value: 'annotational' });
    expect(s.dims().map((d) => d.form)).toEqual(['annotational', 'annotational']);
    await s.bus.setProperty({ key: 'constraint-description', value: ' Width ' });
    expect(s.dims().map((d) => d.description)).toEqual(['Width', 'Width']);
    expect(s.bus.constraintSelection).toEqual(['D1', 'D2']);
    await s.bus.script(['U']);
    expect(s.dims().map((d) => d.description)).toEqual([undefined, 'Corner']);
    await s.bus.script(['U']);
    expect(s.dims().map((d) => d.form)).toEqual(['dynamic', 'annotational']);
    expect(s.log()).not.toContain('Command: PROPERTIES');
  });

  it('Name renames the parameter and Expression sets it, through the solver', async () => {
    const s = setup((asked) =>
      asked.startsWith('expression')
        ? ok({ expressions: [{ parameter: 'width', expression: '12' }] })
        : ok(),
    );
    await s.pick(5, 2);
    await s.bus.setProperty({ key: 'constraint-name', value: 'width' });
    expect(s.dim('D1')!.parameter).toBe('width');
    await s.bus.setProperty({ key: 'constraint-expression', value: '12' });
    expect(s.asked).toEqual(['rename d1 width', 'expression width=12']);
    expect(s.dim('D1')!.expression).toBe('12');
  });

  it('Reference converts through the solver: geometry and expressions follow', async () => {
    const s = setup((asked) =>
      asked === 'reference D1 true'
        ? ok({ expressions: [{ parameter: 'd1', expression: '10.5' }] })
        : ok(),
    );
    await s.pick(5, 2);
    await s.bus.setProperty({ key: 'constraint-reference', value: 'yes' });
    expect(s.asked).toEqual(['reference D1 true']);
    expect(s.dim('D1')).toMatchObject({ reference: true, expression: '10.5' });
    await s.bus.setProperty({ key: 'constraint-reference', value: 'no' });
    expect(s.asked).toEqual(['reference D1 true', 'reference D1 false']);
    expect(s.dim('D1')!.reference).toBeUndefined();
  });

  it('Reference moves what a driving constraint solves to', async () => {
    const s = setup();
    const line = s.line;
    const moved = { ...line, geom: lineGeom(0, 0, 10, 0.5) } as Entity;
    const t = setup(() => ok({ updated: [{ before: line, after: moved }] }));
    await t.pick(1, 1);
    await t.bus.setProperty({ key: 'constraint-reference', value: 'no' });
    expect(t.asked).toEqual(['reference D2 false']);
    expect(t.model.entityByHandle('30')!.geom).toEqual(lineGeom(0, 0, 10, 0.5));
    expect(t.dim('D2')!.reference).toBeUndefined();
  });

  it('says why the solver refused, the drawing as it was', async () => {
    const s = setup(() => ({
      ok: false,
      reason: 'redundant',
      message: 'The constraint would over-constrain the geometry',
      conflicting: [],
    }));
    await s.pick(1, 1);
    const version = s.model.version;
    await s.bus.setProperty({ key: 'constraint-reference', value: 'no' });
    expect(s.dim('D2')!.reference).toBe(true);
    expect(s.model.version).toBe(version);
    expect(s.log()).toContain('The constraint would over-constrain the geometry.');
  });

  it('narrowed to the constraints, an edit with objects selected changes the constraints', async () => {
    const s = setup();
    await s.pick(5, 0);
    await s.pick(5, 2);
    await s.bus.setProperty(
      { key: 'constraint-form', value: 'annotational' },
      DIMCONSTRAINT_SHEET_TYPE,
    );
    expect(s.dim('D1')!.form).toBe('annotational');
    // An object's row narrowed to its type still edits the object.
    await s.bus.setProperty({ key: 'color', value: 'aci:1' }, 'LINE');
    expect(s.model.entityByHandle('30')!.color).toEqual({ kind: 'aci', index: 1 });
  });
});
