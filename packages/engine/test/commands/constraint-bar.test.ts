// M9-05 part 2: CONSTRAINTBAR shows or hides the constraint bars of the objects selected (AutoCAD
// 2024 Help, "CONSTRAINTBAR (Command)": Select Objects, then Show, Hide or Reset), Showall and
// Hideall every bar (the Parametric tab's Show All and Hide All); a constraint applied asks for
// its objects' bars (CONSTRAINTBARDISPLAY bit 1, the app's); DELCONSTRAINT removes every
// constraint on the objects selected ("The number of constraints removed are displayed on the
// command line").
import { describe, expect, it } from 'vitest';
import {
  deleteConstraintsCommand,
  isDimensionalConstraint,
  isGeometricConstraint,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type GeometricConstraintObject,
  type ViewRequest,
} from '../../src/index';
import { setup } from './edit-harness';
import { NO_PARAMETERS } from './solver-stub';
import { lineGeom } from '../model/fixtures';

const geometric = (
  handle: string,
  kind: GeometricConstraintObject['kind'],
  entities: string[],
): GeometricConstraintObject => ({
  handle,
  type: 'TRIYA_GEOMCONSTRAINT',
  owner: 'C',
  kind,
  refs: entities.map((entity) => ({ entity })),
});

const dimension = (
  handle: string,
  entity: string,
  parameter: string,
  expression = '10',
): DimensionalConstraintObject => ({
  handle,
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [
    { entity, point: 'start' },
    { entity, point: 'end' },
  ],
  parameter,
  expression,
  location: { x: 0, y: 0 },
  form: 'dynamic',
});

/**
 * Line 30 (0,0)-(10,0), line 40 (10,0)-(10,10) and line 41 (20,0)-(30,0), unconstrained. E1 makes
 * 30 horizontal, E2 30 and 40 perpendicular; D1 measures 40.
 */
function drawing(o: { solver?: ConstraintSolver } = {}) {
  const requests: ViewRequest[] = [];
  const s = setup([lineGeom(10, 0, 10, 10), lineGeom(20, 0, 30, 0)], {
    objects: [
      geometric('E1', 'horizontal', ['30']),
      geometric('E2', 'perpendicular', ['30', '40']),
      dimension('D1', '40', 'd1'),
    ],
    requests,
    ...(o.solver && { constraints: () => Promise.resolve(o.solver!) }),
  });
  const objects = () =>
    [...s.model.objects.values()]
      .filter((c) => isGeometricConstraint(c) || isDimensionalConstraint(c))
      .map((c) => c.handle);
  return { ...s, requests, objects };
}

describe('CONSTRAINTBAR (M9-05 part 2)', () => {
  it('hides the bars of the constrained objects selected', async () => {
    const d = drawing();
    await d.bus.script(['CONSTRAINTBAR']);
    expect(d.bus.promptText).toBe('Select objects or [Showall/Hideall]:');
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 25, y: 0 });
    await d.bus.submit('');
    expect(d.bus.promptText).toBe('Enter an option [Show/Hide/Reset] <Show>:');
    await d.bus.submit('H');
    // Line 41 has no constraint and no bar.
    expect(d.requests).toEqual([{ op: 'constraintBars', action: 'hide', entities: ['30'] }]);
    // Display state, not an edit.
    expect(d.bus.undo.state.undoable).toBe(0);
  });

  it('shows them, Show being the default, Reset showing them and putting them back', async () => {
    const d = drawing();
    await d.bus.script(['CONSTRAINTBAR']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.submit('');
    await d.bus.script(['CONSTRAINTBAR']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.submit('Reset');
    // M9-05 part 6: Reset "resets them to their default locations", where dragging left them.
    expect(d.requests).toEqual([
      { op: 'constraintBars', action: 'show', entities: ['40'] },
      { op: 'constraintBars', action: 'reset', entities: ['30'] },
    ]);
  });

  it('Showall and Hideall take every geometrically constrained object', async () => {
    const d = drawing();
    await d.bus.script(['CONSTRAINTBAR', 'Hideall']);
    await d.bus.script(['CONSTRAINTBAR', 'S']);
    expect(d.requests).toEqual([
      { op: 'constraintBars', action: 'hide', entities: ['30', '40'] },
      { op: 'constraintBars', action: 'show', entities: ['30', '40'] },
    ]);
  });

  it('says so when no object selected has a geometric constraint', async () => {
    const d = drawing();
    await d.bus.script(['CONSTRAINTBAR']);
    await d.bus.pick({ x: 25, y: 0 });
    await d.bus.submit('');
    expect(d.log).toContain('No geometric constraints are associated with the objects selected.');
    expect(d.requests).toEqual([]);
  });

  it('a constraint applied asks for its objects bars', async () => {
    const solver: ConstraintSolver = {
      add: () => ({ ok: true, updated: [], dofs: 0 }),
      solveEdit: () => ({ ok: true, updated: [] }),
      measure: () => undefined,
      ...NO_PARAMETERS,
    } as unknown as ConstraintSolver;
    const d = drawing({ solver });
    await d.bus.script(['GCPARALLEL']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.pick({ x: 25, y: 0 });
    expect(d.requests).toEqual([
      { op: 'constraintBars', action: 'applied', entities: ['40', '41'] },
    ]);
  });
});

describe('DELCONSTRAINT (M9-05 part 2)', () => {
  it('removes every constraint on the objects selected as one step, and counts them', async () => {
    const d = drawing();
    await d.bus.script(['DELCONSTRAINT']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    // E2 runs between 30 and 40; D1 is on 40; E1 is 30's alone.
    expect(d.objects()).toEqual(['E1']);
    expect(d.log).toContain('2 constraints removed.');
    expect(d.bus.undo.state.undoable).toBe(1);
    await d.bus.script(['U']);
    expect(d.objects().sort()).toEqual(['D1', 'E1', 'E2']);
  });

  it('says none were removed from objects without constraints', async () => {
    const d = drawing();
    await d.bus.script(['DELCONSTRAINT']);
    await d.bus.pick({ x: 25, y: 0 });
    await d.bus.submit('');
    expect(d.log).toContain('0 constraints removed.');
    expect(d.bus.undo.state.undoable).toBe(0);
  });

  it('an expression naming a removed parameter keeps its value', async () => {
    const asked: string[] = [];
    const solver = {
      ...NO_PARAMETERS,
      deleteParameter: (_: unknown, name: string) => {
        asked.push(name);
        return { ok: true, updated: [], expressions: [{ parameter: 'd2', expression: '20' }] };
      },
    } as unknown as ConstraintSolver;
    const requests: ViewRequest[] = [];
    const d = setup([lineGeom(10, 0, 10, 10)], {
      objects: [dimension('D1', '30', 'd1'), dimension('D2', '40', 'd2', 'd1*2')],
      requests,
      constraints: () => Promise.resolve(solver),
    });
    await d.bus.script(['DELCONSTRAINT']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    expect(asked).toEqual(['d1']);
    const left = [...d.model.objects.values()].filter(isDimensionalConstraint);
    expect(left.map((c) => [c.handle, c.expression])).toEqual([['D2', '20']]);
    expect(d.bus.undo.state.undoable).toBe(1);
  });
});

describe("A bar icon's Delete (M9-05 part 4)", () => {
  it('removes the constraints named, one DELCONSTRAINT undo step, the geometry left alone', async () => {
    const d = drawing();
    const before = d.model.entityByHandle('30')!.geom;
    await d.bus.run(deleteConstraintsCommand(['E2']));
    expect(d.objects().sort()).toEqual(['D1', 'E1']);
    expect(d.model.entityByHandle('30')!.geom).toEqual(before);
    expect(d.bus.undo.state.undoable).toBe(1);
    expect(d.bus.undo.state.nextUndo).toBe('DELCONSTRAINT');
    await d.bus.script(['U']);
    expect(d.objects().sort()).toEqual(['D1', 'E1', 'E2']);
  });

  it('passes over a handle that names no constraint (one deleted meanwhile)', async () => {
    const d = drawing();
    await d.bus.run(deleteConstraintsCommand(['30', 'FF']));
    expect(d.objects().sort()).toEqual(['D1', 'E1', 'E2']);
    expect(d.bus.undo.state.undoable).toBe(0);
  });
});
