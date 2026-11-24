// M9-06: the drawing's geometric constraints kept in step with modify commands (PRD FR-X4). The
// solver here is a stand-in that records what it is asked and answers as told;
// packages/constraints/test/upkeep.test.ts runs the same commands against PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  APP_VARIABLES,
  DROPS_CONSTRAINTS,
  MOVES_CHANGED_VALUES,
  carriedKind,
  isDimensionalConstraint,
  isGeometricConstraint,
  moveBy,
  mirrorIn,
  netEntityChanges,
  parameterCopyMode,
  planUpkeep,
  renameInExpression,
  turnAbout,
  type ChangeSet,
  type ConstraintEditResult,
  type ConstraintRef,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type Entity,
  type EntityGeometry,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type Replacement,
} from '../../src/index';
import { NO_PARAMETERS } from './solver-stub';
import { lineGeom } from '../model/fixtures';
import { setup, type SharedClipboard } from './edit-harness';

const constraint = (
  handle: string,
  kind: GeometricConstraintKind,
  refs: readonly ConstraintRef[],
): GeometricConstraintObject => ({
  handle,
  type: 'TRIYA_GEOMCONSTRAINT',
  owner: 'C',
  kind,
  refs,
});

/** An aligned dimensional constraint on line `entity`'s length. */
const dimension = (
  handle: string,
  entity: string,
  parameter: string,
  expression: string,
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

interface Asked {
  readonly constraints: readonly string[];
  readonly edits: readonly Replacement<Entity>[];
  readonly lookup: (h: string) => Entity | undefined;
  readonly whole: boolean;
  readonly dimensions: readonly string[];
}

/**
 * Line 30 (0,0)-(10,0) and circle 31 (from the harness), line 40 (10,0)-(10,10) and polyline 41
 * (20,0)-(30,0)-(30,10). Constraints: C1 line 30 horizontal, C2 30's end on 40's start, C3 41's
 * first segment horizontal, C4 circle 31 fixed. `answer` is the stand-in solver's.
 */
function drawing(
  answer?: (asked: Asked) => ConstraintEditResult,
  o: {
    solver?: 'none' | 'broken';
    dimensions?: boolean;
    /** More constraints (M9-10). */
    objects?: readonly (GeometricConstraintObject | DimensionalConstraintObject)[];
    /** The app's system variables (PARAMETERCOPYMODE, ARRAYASSOCIATIVITY). */
    variables?: Map<string, number>;
    clipboard?: SharedClipboard;
    /** What the solver's deleteParameter answers (M9-10). */
    deleteParameter?: ConstraintSolver['deleteParameter'];
  } = {},
) {
  const asked: Asked[] = [];
  const solver: ConstraintSolver = {
    ...NO_PARAMETERS,
    ...(o.deleteParameter && { deleteParameter: o.deleteParameter }),
    add: () => {
      throw new Error('not asked');
    },
    measure: () => {
      throw new Error('not asked');
    },
    addDimension: () => {
      throw new Error('not asked');
    },
    solveEdit: (constraints, edits, lookup, tol, whole, dimensions = []) => {
      expect(tol.linear).toBeGreaterThan(0);
      const a = {
        constraints: constraints.map((c) => c.handle),
        edits,
        lookup,
        whole,
        dimensions: dimensions.map((d) => d.handle),
      };
      asked.push(a);
      return answer ? answer(a) : { ok: true, updated: [...edits] };
    },
  };
  const s = setup(
    [
      lineGeom(10, 0, 10, 10),
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 20, y: 0, bulge: 0 },
          { x: 30, y: 0, bulge: 0 },
          { x: 30, y: 10, bulge: 0 },
        ],
      } as EntityGeometry,
    ],
    {
      objects: [
        constraint('C1', 'horizontal', [{ entity: '30' }]),
        constraint('C2', 'coincident', [
          { entity: '30', point: 'end' },
          { entity: '40', point: 'start' },
        ]),
        constraint('C3', 'horizontal', [{ entity: '41', segment: 0 }]),
        constraint('C4', 'fix', [{ entity: '31' }]),
        ...(o.dimensions
          ? [
              dimension('D1', '40', 'd1', '10'),
              { ...dimension('D2', '30', 'd2', '10'), reference: true },
            ]
          : []),
        ...(o.objects ?? []),
      ],
      ...(o.variables && { variables: o.variables }),
      ...(o.clipboard && { clipboard: o.clipboard }),
      ...(o.solver !== 'none' && {
        constraints:
          o.solver === 'broken'
            ? () => Promise.reject(new Error('no WebAssembly'))
            : () => Promise.resolve(solver),
      }),
    },
  );
  const constraints = () =>
    [...s.model.objects.values()]
      .filter(isGeometricConstraint)
      .map((c) => `${c.handle}:${c.kind}:${c.refs.map((r) => r.entity).join(',')}`)
      .sort();
  /** The constraints the drawing did not start with. */
  const added = () => constraints().filter((c) => !ORIGINAL.includes(c));
  return { ...s, asked, constraints, added };
}

const ORIGINAL = ['C1:horizontal:30', 'C2:coincident:30,40', 'C3:horizontal:41', 'C4:fix:31'];

describe('ERASE (M9-06)', () => {
  it("removes an erased object's constraints in its undo step, and U puts them back", async () => {
    const d = drawing();
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    expect(d.byHandle('40')).toBeUndefined();
    expect(d.constraints()).toEqual(['C1:horizontal:30', 'C3:horizontal:41', 'C4:fix:31']);
    expect(d.log).toContain('1 geometric constraint removed.');
    // Line 30 is unchanged: nothing to re-solve.
    expect(d.asked).toEqual([]);
    await d.bus.script(['U']);
    expect(d.byHandle('40')).toBeDefined();
    expect(d.constraints()).toEqual(ORIGINAL);
  });

  it('says nothing when the objects erased have no constraints', async () => {
    const d = drawing();
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 50, y: 5 });
    await d.bus.submit('');
    // The circle had a Fix: an erased circle takes its Fix with it.
    expect(d.constraints()).toEqual(ORIGINAL.slice(0, 3));
    const plain = setup([lineGeom(0, 30, 10, 30)]);
    await plain.bus.script(['ERASE']);
    await plain.bus.pick({ x: 5, y: 30 });
    await plain.bus.submit('');
    expect(plain.log.some((l) => /constraint/.test(l))).toBe(false);
  });
});

describe('dimensional constraints (M9-06 with M9-03 part 3)', () => {
  const dims = (d: ReturnType<typeof drawing>) =>
    [...d.model.objects.values()]
      .filter(isDimensionalConstraint)
      .map((c) => `${c.handle}:${c.expression}`)
      .sort();

  it('ERASE removes an erased object’s dimensional constraints too, saying so', async () => {
    const d = drawing(undefined, { dimensions: true });
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    expect(dims(d)).toEqual(['D2:10']);
    expect(d.log).toContain('1 geometric constraint removed.');
    expect(d.log).toContain('1 dimensional constraint removed.');
    await d.bus.script(['U']);
    expect(dims(d)).toEqual(['D1:10', 'D2:10']);
  });

  it('a re-solve holds the dimensions and writes the reference values it measured', async () => {
    const d = drawing(
      ({ edits }) => ({
        ok: true,
        updated: [...edits],
        expressions: [{ parameter: 'd2', expression: '15' }],
      }),
      { dimensions: true },
    );
    await d.bus.script(['MOVE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.script(['0,0', '5,0']);
    expect(d.asked.map((a) => a.dimensions)).toEqual([['D1', 'D2']]);
    expect(dims(d)).toEqual(['D1:10', 'D2:15']);
    await d.bus.script(['U']);
    expect(dims(d)).toEqual(['D1:10', 'D2:10']);
  });
});

describe('commands that drop constraints (FR-X4)', () => {
  it('BREAK drops the constraints on the object it breaks, with a notification', async () => {
    const d = drawing();
    await d.bus.script(['BR']);
    await d.bus.pick({ x: 3, y: 0 });
    await d.bus.script(['7,1']);
    expect(d.bus.command).toBeUndefined();
    expect(d.constraints()).toEqual(['C3:horizontal:41', 'C4:fix:31']);
    expect(d.log).toContain('2 geometric constraints removed.');
    expect(d.asked).toEqual([]);
    await d.bus.script(['U']);
    expect(d.constraints()).toEqual(ORIGINAL);
    expect(d.ends(d.byHandle('30')!)).toEqual([0, 0, 10, 0]);
  });

  it('EXPLODE drops the constraints on the polyline it explodes', async () => {
    const d = drawing();
    await d.bus.script(['EXPLODE']);
    await d.bus.pick({ x: 25, y: 0 });
    await d.bus.submit('');
    expect(d.byHandle('41')).toBeUndefined();
    expect(d.constraints()).toEqual(ORIGINAL.filter((c) => !c.includes(':41')));
    expect(d.log).toContain('1 geometric constraint removed.');
  });

  it('keeps the constraints of a command cancelled after its edits in step too', async () => {
    const d = drawing();
    // TRIM's picks are kept when Esc ends it. No edge crosses polyline 41, so Quick mode erases it.
    await d.bus.script(['TRIM']);
    await d.bus.pick({ x: 30, y: 5 });
    await d.bus.cancel();
    expect(d.constraints()).not.toContain('C3:horizontal:41');
    expect(d.log).toContain('1 geometric constraint removed.');
  });

  it('lists the commands FR-X4 names', () => {
    for (const name of ['TRIM', 'EXTEND', 'FILLET', 'BREAK', 'EXPLODE']) {
      expect(DROPS_CONSTRAINTS.has(name)).toBe(true);
    }
    expect(DROPS_CONSTRAINTS.has('MOVE')).toBe(false);
  });
});

describe('commands that re-solve (FR-X4)', () => {
  it('MOVE holds what moved and applies what the solver moved, in the same undo step', async () => {
    const seen: EntityGeometry[] = [];
    const d = drawing(({ edits, lookup }) => {
      // The lookup is the drawing before the edit.
      seen.push(lookup('40')!.geom, lookup('30')!.geom);
      // Line 30's end follows line 40's start.
      const before = lookup('30')!;
      const after = { ...before, geom: lineGeom(0, 0, 15, 0) } as Entity;
      return { ok: true, updated: [...edits, { before, after }] };
    });
    await d.bus.script(['MOVE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.script(['0,0', '5,0']);
    expect(d.bus.command).toBeUndefined();
    expect(d.asked).toHaveLength(1);
    const [a] = d.asked;
    // Every constraint kept; the edit is line 40's move.
    expect(a!.constraints).toEqual(['C1', 'C2', 'C3', 'C4']);
    // MOVE places line 40 whole.
    expect(a!.whole).toBe(true);
    expect(a!.edits.map((e) => [e.after.handle, e.before.geom, e.after.geom])).toEqual([
      ['40', lineGeom(10, 0, 10, 10), lineGeom(15, 0, 15, 10)],
    ]);
    expect(seen).toEqual([lineGeom(10, 0, 10, 10), lineGeom(0, 0, 10, 0)]);
    expect(d.ends(d.byHandle('30')!)).toEqual([0, 0, 15, 0]);
    expect(d.ends(d.byHandle('40')!)).toEqual([15, 0, 15, 10]);
    expect(d.constraints()).toEqual(ORIGINAL);
    await d.bus.script(['U']);
    expect(d.ends(d.byHandle('30')!)).toEqual([0, 0, 10, 0]);
    expect(d.ends(d.byHandle('40')!)).toEqual([10, 0, 10, 10]);
  });

  it('a grip drag holds only the grip moved', async () => {
    const d = drawing();
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.pick({ x: 10.1, y: 10.1 }, { grip: 0.5 });
    expect(d.bus.command).toBe('GRIP');
    await d.bus.submit('10,12');
    expect(d.asked.map((a) => a.whole)).toEqual([false]);
    expect(MOVES_CHANGED_VALUES.has('PROPERTIES')).toBe(true);
  });

  it('takes the edit back, with the solver’s reason, when the constraints refuse it', async () => {
    const d = drawing(() => ({
      ok: false,
      reason: 'overconstrained',
      message: 'The change breaks a constraint the other geometry cannot follow',
      conflicting: ['C4'],
    }));
    await d.bus.script(['MOVE']);
    await d.bus.pick({ x: 55, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['0,0', '5,0']);
    expect(d.log).toContain('The change breaks a constraint the other geometry cannot follow.');
    expect(d.byHandle('31')!.geom).toMatchObject({ center: { x: 50, y: 0 } });
    // No undo step was left: U has nothing of MOVE's to take back.
    await d.bus.script(['U']);
    expect(d.log.at(-1)).not.toMatch(/MOVE/);
    expect(d.byHandle('31')!.geom).toMatchObject({ center: { x: 50, y: 0 } });
  });

  it('asks nothing of the solver for an edit no constraint names or one that changes no geometry', async () => {
    const d = drawing();
    await d.bus.script(['MOVE']);
    await d.bus.pick({ x: 25, y: 10 });
    await d.bus.submit('');
    await d.bus.script(['0,0', '0,0']);
    await d.bus.script(['CHPROP']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.script(['', 'C', '1', '']);
    expect(d.asked).toEqual([]);
  });

  it('leaves the constraints as they are without a solver, and says so when it cannot load', async () => {
    const none = drawing(undefined, { solver: 'none' });
    await none.bus.script(['MOVE']);
    await none.bus.pick({ x: 10, y: 5 });
    await none.bus.submit('');
    await none.bus.script(['0,0', '5,0']);
    expect(none.ends(none.byHandle('40')!)).toEqual([15, 0, 15, 10]);
    expect(none.constraints()).toEqual(ORIGINAL);

    const broken = drawing(undefined, { solver: 'broken' });
    await broken.bus.script(['MOVE']);
    await broken.bus.pick({ x: 10, y: 5 });
    await broken.bus.submit('');
    await broken.bus.script(['0,0', '5,0']);
    expect(broken.log).toContain('The constraint solver could not load: no WebAssembly');
    expect(broken.ends(broken.byHandle('40')!)).toEqual([15, 0, 15, 10]);
  });
});

describe('copies carry the constraints among the objects copied', () => {
  it('COPY gives the copies the constraints wholly among them, not those to objects left', async () => {
    const d = drawing();
    await d.bus.script(['COPY']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.script(['0,0', '0,20', '']);
    const copies = d
      .space()
      .filter((e) => e.geom.kind === 'LINE' && !['30', '40'].includes(e.handle));
    expect(copies.map((e) => d.ends(e))).toEqual([
      [0, 20, 10, 20],
      [10, 20, 10, 30],
    ]);
    const [c30, c40] = copies.map((e) => e.handle);
    expect(d.added()).toEqual([
      expect.stringMatching(new RegExp(`:horizontal:${c30}$`)),
      expect.stringMatching(new RegExp(`:coincident:${c30},${c40}$`)),
    ]);
  });

  it('ROTATE and MIRROR Copy keep Horizontal and Vertical only where the copies stay square', async () => {
    const d = drawing();
    await d.bus.script(['ROTATE']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['0,0', 'C', '90']);
    expect(d.added()).toEqual([expect.stringMatching(/:vertical:/)]);
    await d.bus.script(['ROTATE']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['0,0', 'C', '45']);
    expect(d.added()).toHaveLength(1);
    await d.bus.script(['MIRROR']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['0,-1', '1,-1', 'N']);
    expect(d.added()).toHaveLength(2);
    expect(d.added()).toContainEqual(expect.stringMatching(/:horizontal:/));
  });

  it('carriedKind keeps every other relation under any similarity', () => {
    const turn = (deg: number) => turnAbout({ x: 0, y: 0 }, (deg * Math.PI) / 180);
    expect(carriedKind('horizontal', moveBy({ x: 3, y: 4 }))).toBe('horizontal');
    expect(carriedKind('horizontal', turn(180))).toBe('horizontal');
    expect(carriedKind('vertical', turn(-90))).toBe('horizontal');
    expect(carriedKind('vertical', turn(30))).toBeUndefined();
    expect(carriedKind('vertical', mirrorIn({ x: 0, y: 0 }, { x: 1, y: 1 }))).toBe('horizontal');
    expect(carriedKind('parallel', turn(30))).toBe('parallel');
    expect(carriedKind('fix', mirrorIn({ x: 0, y: 0 }, { x: 1, y: 2 }))).toBe('fix');
  });
});

describe('the rest of constraint upkeep (M9-10)', () => {
  /** The dimensional constraints as `name=expression@entities`, the original ones first. */
  const dims = (d: ReturnType<typeof drawing>) =>
    [...d.model.objects.values()]
      .filter(isDimensionalConstraint)
      .map((c) => `${c.parameter}=${c.expression}@${c.refs.map((r) => r.entity).join(',')}`);
  /** Line 40's length (d1) and line 30's (width, named by an expression of d1). */
  const DIMENSIONS = [dimension('D5', '40', 'd1', '10'), dimension('D6', '30', 'width', 'd1')];
  const copyMode = (mode: number) => new Map([['PARAMETERCOPYMODE', mode]]);
  /** The copies of lines 30 and 40 (by their places), and their handles. */
  const copiesOf = (d: ReturnType<typeof drawing>) =>
    d.space().filter((e) => e.geom.kind === 'LINE' && !['30', '40'].includes(e.handle));
  const pickBoth = async (d: ReturnType<typeof drawing>) => {
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
  };

  it('ARRAY gives each item the constraints among the objects arrayed', async () => {
    const d = drawing(undefined, { variables: new Map([['ARRAYASSOCIATIVITY', 0]]) });
    await d.bus.script(['ARRAYRECT']);
    await pickBoth(d);
    await d.bus.submit('');
    await d.bus.script(['COU', '3', '1', '']);
    expect(d.bus.command).toBeUndefined();
    const copies = copiesOf(d);
    expect(copies).toHaveLength(4);
    const added = d.added();
    expect(added).toHaveLength(4);
    expect(added.filter((c) => /:horizontal:/.test(c))).toHaveLength(2);
    expect(added.filter((c) => /:coincident:/.test(c))).toHaveLength(2);
    // Every carried constraint names copies only: the polyline's stays its own.
    const handles = new Set(copies.map((e) => e.handle));
    for (const c of added) {
      for (const h of c.split(':')[2]!.split(',')) expect(handles.has(h)).toBe(true);
    }
  });

  it('ARRAYPOLAR keeps Horizontal on the items turned level, Vertical on those turned square', async () => {
    const d = drawing(undefined, { variables: new Map([['ARRAYASSOCIATIVITY', 0]]) });
    await d.bus.script(['ARRAYPOLAR']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['0,-20', 'I', '4', '']);
    expect(d.bus.command).toBeUndefined();
    expect(
      d
        .added()
        .map((c) => c.split(':')[1])
        .sort(),
    ).toEqual(['horizontal', 'vertical', 'vertical']);
    // Items 120° apart cannot stay level: they carry none.
    const three = drawing(undefined, { variables: new Map([['ARRAYASSOCIATIVITY', 0]]) });
    await three.bus.script(['ARRAYPOLAR']);
    await three.bus.pick({ x: 5, y: 0 });
    await three.bus.submit('');
    await three.bus.script(['0,-20', 'I', '3', '']);
    expect(three.added()).toEqual([]);
  });

  it('an associative array takes its source, and so its constraints, out of the drawing', async () => {
    const d = drawing(undefined, { variables: new Map([['ARRAYASSOCIATIVITY', 1]]) });
    await d.bus.script(['ARRAYRECT']);
    await pickBoth(d);
    await d.bus.submit('');
    await d.bus.script(['']);
    expect(d.byHandle('30')).toBeUndefined();
    expect(d.constraints()).toEqual(['C3:horizontal:41', 'C4:fix:31']);
    expect(d.log).toContain('2 geometric constraints removed.');
  });

  it('grip Copy gives each copy the constraints, and Undo takes the last copy’s back', async () => {
    const d = drawing();
    await pickBoth(d);
    await d.bus.pick({ x: 0, y: 0 }, { grip: 0.5 });
    await d.bus.script(['', 'C', '0,20', '0,40']);
    expect(d.added()).toHaveLength(4);
    await d.bus.script(['U']);
    expect(d.added()).toHaveLength(2);
    await d.bus.submit('');
    expect(d.bus.command).toBeUndefined();
    const [c30, c40] = copiesOf(d).map((e) => e.handle);
    expect(d.added()).toEqual([
      expect.stringMatching(new RegExp(`:horizontal:${c30}$`)),
      expect.stringMatching(new RegExp(`:coincident:${c30},${c40}$`)),
    ]);
  });

  it('PASTECLIP into the same drawing carries the constraints among the objects pasted', async () => {
    const clipboard: SharedClipboard = {};
    const d = drawing(undefined, { clipboard, objects: DIMENSIONS });
    await d.bus.script(['COPYCLIP']);
    await pickBoth(d);
    await d.bus.submit('');
    await d.bus.script(['PASTECLIP', '0,20']);
    expect(d.bus.command).toBeUndefined();
    const [c30, c40] = copiesOf(d).map((e) => e.handle);
    expect(d.added()).toEqual([
      expect.stringMatching(new RegExp(`:horizontal:${c30}$`)),
      expect.stringMatching(new RegExp(`:coincident:${c30},${c40}$`)),
    ]);
    // Names in use: the copies take the next free ones, their values as constants.
    expect(dims(d)).toEqual([
      'd1=10@40,40',
      'width=d1@30,30',
      `d2=10@${c40},${c40}`,
      `d3=10@${c30},${c30}`,
    ]);
  });

  it('PASTECLIP into another drawing keeps free names and, under 4, the expressions among them', async () => {
    for (const [mode, width] of [
      [1, '10'],
      [4, 'd2'],
    ] as const) {
      const clipboard: SharedClipboard = {};
      const variables = copyMode(mode);
      const from = drawing(undefined, { clipboard, variables, objects: DIMENSIONS });
      const to = drawing(undefined, {
        clipboard,
        variables,
        objects: [dimension('E1', '41', 'd1', '10')],
      });
      await from.bus.script(['COPYCLIP']);
      await pickBoth(from);
      await from.bus.submit('');
      await to.bus.script(['PASTECLIP', '0,20']);
      const [c30, c40] = copiesOf(to).map((e) => e.handle);
      expect(to.added()).toHaveLength(2);
      // d1 is the target's own: the copy is renamed; width is free and keeps its name.
      expect(dims(to)).toEqual([
        'd1=10@41,41',
        `d2=10@${c40},${c40}`,
        `width=${width}@${c30},${c30}`,
      ]);
    }
  });

  it('PARAMETERCOPYMODE 0 copies no constraints, 1 copies values, 4 expressions', async () => {
    const copy = async (mode: number | undefined, scale?: string) => {
      const d = drawing(undefined, {
        objects: DIMENSIONS,
        ...(mode !== undefined && { variables: copyMode(mode) }),
      });
      if (scale) {
        await d.bus.script(['SCALE']);
        await pickBoth(d);
        await d.bus.submit('');
        await d.bus.script(['0,0', 'C', scale]);
      } else {
        await d.bus.script(['COPY']);
        await pickBoth(d);
        await d.bus.submit('');
        await d.bus.script(['0,0', '0,20', '']);
      }
      const [c30, c40] = copiesOf(d).map((e) => e.handle);
      const added = dims(d)
        .slice(2)
        .map((x) => x.replace(`@${c40},${c40}`, '@40copy').replace(`@${c30},${c30}`, '@30copy'));
      return { added, geometric: d.added().length };
    };
    expect(await copy(0)).toEqual({ added: [], geometric: 0 });
    // 1 is the initial value, where the app keeps none.
    expect(await copy(undefined)).toEqual({
      added: ['d2=10@40copy', 'd3=10@30copy'],
      geometric: 2,
    });
    expect((await copy(2)).added).toEqual(['d2=10@40copy', 'd3=10@30copy']);
    expect((await copy(4)).added).toEqual(['d2=10@40copy', 'd3=d2@30copy']);
    // Scaled copies measure other values: an expression would pull them back, so values.
    expect((await copy(4, '2')).added).toEqual(['d2=20@40copy', 'd3=20@30copy']);
  });

  it('OOPS puts back the constraints ERASE removed whose objects are all back', async () => {
    const d = drawing(undefined, { objects: [dimension('D5', '40', 'd1', '10')] });
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    expect(d.constraints()).not.toContain('C2:coincident:30,40');
    expect(dims(d)).toEqual([]);
    await d.bus.script(['LINE', '0,50', '10,50', '']);
    await d.bus.script(['OOPS']);
    expect(d.byHandle('40')).toBeDefined();
    expect(d.constraints()).toEqual(ORIGINAL);
    expect(dims(d)).toEqual(['d1=10@40,40']);

    // Line 40 erased, then line 30: OOPS brings 30 back with its Horizontal, but the coincidence
    // with 40, still erased, stays out.
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.submit('');
    await d.bus.script(['OOPS']);
    expect(d.byHandle('30')).toBeDefined();
    expect(d.constraints()).toEqual(['C1:horizontal:30', 'C3:horizontal:41', 'C4:fix:31']);
    // U takes the OOPS back as one step.
    await d.bus.script(['U']);
    expect(d.byHandle('30')).toBeUndefined();
    expect(d.constraints()).toEqual(['C3:horizontal:41', 'C4:fix:31']);
  });

  it('a dimensional constraint dropped leaves the expressions naming it their values', async () => {
    const asked: [readonly string[], string][] = [];
    const d = drawing(undefined, {
      objects: DIMENSIONS,
      deleteParameter: (dimensions, name) => {
        asked.push([dimensions.map((c) => c.parameter), name]);
        return { ok: true, updated: [], expressions: [{ parameter: 'width', expression: '10' }] };
      },
    });
    await d.bus.script(['ERASE']);
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    expect(asked).toEqual([[['d1', 'width'], 'd1']]);
    expect(dims(d)).toEqual(['width=10@30,30']);
    expect(d.log).toContain('1 dimensional constraint removed.');
    await d.bus.script(['U']);
    expect(dims(d).sort()).toEqual(['d1=10@40,40', 'width=d1@30,30']);
  });

  it('PARAMETERCOPYMODE is a variable the app keeps, 0 to 4', () => {
    expect(APP_VARIABLES.find((v) => v.name === 'PARAMETERCOPYMODE')).toMatchObject({
      store: 'app',
      kind: 'integer',
      min: 0,
      max: 4,
    });
    expect(parameterCopyMode(4)).toBe(4);
    expect(parameterCopyMode(7)).toBe(1);
    expect(parameterCopyMode(undefined)).toBe(1);
  });

  it('renames the parameters an expression names, never numbers, constants or functions', () => {
    const names = new Set<string>();
    const rename = new Map([
      ['d1', 'd4'],
      ['e1', 'x'],
    ]);
    expect(renameInExpression('d1*2+sin(d10)+1e1+pi/e1 - E', rename, names)).toBe(
      'd4*2+sin(d10)+1e1+pi/x - E',
    );
    expect([...names].sort()).toEqual(['d1', 'd10', 'e1']);
  });
});

describe('planUpkeep', () => {
  const entity = (handle: string, geom: EntityGeometry) =>
    ({ handle, id: Number.parseInt(handle, 16), geom }) as unknown as Entity;
  const poly = (n: number, closed = false) =>
    ({
      kind: 'LWPOLYLINE',
      closed,
      vertices: Array.from({ length: n }, (_, i) => ({ x: i, y: 0, bulge: 0 })),
    }) as EntityGeometry;
  const update = (handle: string, a: EntityGeometry, b: EntityGeometry): ChangeSet => ({
    entities: { updated: [{ before: entity(handle, a), after: entity(handle, b) }] },
  });
  const cs = [
    constraint('A', 'horizontal', [{ entity: '1' }]),
    constraint('B', 'horizontal', [{ entity: '2', segment: 0 }]),
    constraint('C', 'horizontal', [{ entity: '3', segment: 0 }]),
    constraint('D', 'vertical', [{ entity: '4' }]),
    constraint('E', 'fix', [{ entity: '5' }]),
  ];

  it('drops constraints on objects that change type or vertices, re-solves the rest', () => {
    const net = netEntityChanges([
      update('1', lineGeom(0, 0, 1, 0), { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }),
      update('2', poly(3), poly(4)),
      update('3', poly(3), poly(3, true)),
      update('4', poly(3), poly(3)),
      update('4', poly(3), poly(3)),
    ]);
    const p = planUpkeep('STRETCH', net, cs);
    expect(p.dropped.map((c) => c.handle)).toEqual(['A', 'B', 'C']);
    expect(p.kept.map((c) => c.handle)).toEqual(['D', 'E']);
    expect(p.edits.map((e) => e.after.handle)).toEqual(['4']);
  });

  it('counts an object added and removed in one command as neither, and an unchanged one as none', () => {
    const e = entity('9', lineGeom(0, 0, 1, 0));
    const net = netEntityChanges([
      { entities: { added: [{ entity: e, index: 0 }] } },
      { entities: { removed: [{ entity: e, index: 0 }] } },
      { objects: { added: [] } },
      { entities: { updated: [{ before: entity('5', e.geom), after: entity('5', e.geom) }] } },
    ]);
    expect(net.removed.size).toBe(0);
    expect(net.updated.size).toBe(0);
  });

  it('a JOIN drops the constraints on what it changes even when its shape stays', () => {
    const net = netEntityChanges([update('4', lineGeom(0, 0, 1, 0), lineGeom(0, 0, 2, 0))]);
    expect(planUpkeep('JOIN', net, cs).dropped.map((c) => c.handle)).toEqual(['D']);
  });
});
