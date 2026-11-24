// M9-06: the drawing's geometric constraints kept in step with modify commands (PRD FR-X4). The
// solver here is a stand-in that records what it is asked and answers as told;
// packages/constraints/test/upkeep.test.ts runs the same commands against PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DROPS_CONSTRAINTS,
  MOVES_CHANGED_VALUES,
  carriedKind,
  isDimensionalConstraint,
  isGeometricConstraint,
  moveBy,
  mirrorIn,
  netEntityChanges,
  planUpkeep,
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
import { lineGeom } from '../model/fixtures';
import { setup } from './edit-harness';

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
  o: { solver?: 'none' | 'broken'; dimensions?: boolean } = {},
) {
  const asked: Asked[] = [];
  const solver: ConstraintSolver = {
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
      ],
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
