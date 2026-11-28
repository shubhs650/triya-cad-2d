// M9-13: constraints inside blocks. The constraints among the objects an associative array or
// BLOCK takes in go into the block with them, held there (not drawn, picked or solved) until
// ARRAYEDIT Source opens the objects or the Block Editor shows the block, where they act again.
// The solver here is a stand-in that records what it is asked; constraints/test/upkeep.test.ts
// drives the same edits with PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  assocArrayOf,
  dimensionalConstraints,
  geometricConstraints,
  isDimensionalConstraint,
  isGeometricConstraint,
  parameterObjects,
  type ConstraintRef,
  type ConstraintSolver,
  type DimensionalConstraintObject,
  type Entity,
  type EntityGeometry,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
} from '../../src/index';
import { NO_PARAMETERS } from './solver-stub';
import { MODEL_SPACE, lineGeom } from '../model/fixtures';
import { setup } from './edit-harness';

const constraint = (
  handle: string,
  kind: GeometricConstraintKind,
  refs: readonly ConstraintRef[],
): GeometricConstraintObject => ({ handle, type: 'TRIYA_GEOMCONSTRAINT', owner: 'C', kind, refs });

/** Line 40's length, d1 = 10. */
const D1: DimensionalConstraintObject = {
  handle: 'D1',
  type: 'TRIYA_DIMCONSTRAINT',
  owner: 'C',
  dimension: 'aligned',
  refs: [
    { entity: '40', point: 'start' },
    { entity: '40', point: 'end' },
  ],
  parameter: 'd1',
  expression: '10',
  location: { x: 12, y: 5 },
  form: 'dynamic',
};

/**
 * An L: line 30 (0,0)-(10,0) horizontal, its end on line 40 (10,0)-(10,10), 40 vertical and
 * d1 long; circle 31 (the harness's) fixed, line 41 (20,0)-(30,0) parallel to 30.
 */
function drawing() {
  const asked: string[][] = [];
  const solver: ConstraintSolver = {
    ...NO_PARAMETERS,
    add: () => {
      throw new Error('not asked');
    },
    measure: () => {
      throw new Error('not asked');
    },
    addDimension: () => {
      throw new Error('not asked');
    },
    solveEdit: (constraints, edits, _lookup, _tol, _whole, dimensions = []) => {
      asked.push([...constraints.map((c) => c.handle), ...dimensions.map((d) => d.handle)]);
      return { ok: true, updated: [...edits] };
    },
  };
  const s = setup([lineGeom(10, 0, 10, 10), lineGeom(20, 0, 30, 0) as EntityGeometry], {
    objects: [
      constraint('C1', 'horizontal', [{ entity: '30' }]),
      constraint('C2', 'coincident', [
        { entity: '30', point: 'end' },
        { entity: '40', point: 'start' },
      ]),
      constraint('C3', 'vertical', [{ entity: '40' }]),
      constraint('C4', 'fix', [{ entity: '31' }]),
      constraint('C5', 'parallel', [{ entity: '30' }, { entity: '41' }]),
      D1,
    ],
    variables: new Map([['ARRAYASSOCIATIVITY', 1]]),
    constraints: () => Promise.resolve(solver),
  });
  /** Every constraint as `handle:kind:owner of each object`, M for model space. */
  const where = () =>
    [...s.model.objects.values()]
      .filter((o) => isGeometricConstraint(o) || isDimensionalConstraint(o))
      .map((c) => {
        const kind = isGeometricConstraint(c) ? c.kind : c.dimension;
        const owners = c.refs.map((r) => {
          const owner = s.model.entityByHandle(r.entity)?.owner;
          return owner === MODEL_SPACE ? 'M' : (owner ?? 'gone');
        });
        return `${c.handle}:${kind}:${[...new Set(owners)].join(',')}`;
      })
      .sort();
  const acting = () =>
    [...geometricConstraints(s.model), ...dimensionalConstraints(s.model)]
      .map((c) => c.handle)
      .sort();
  const array = () => s.space().find((e) => assocArrayOf(s.model.objects.values(), e))!;
  const source = () => assocArrayOf(s.model.objects.values(), array())!.source;
  const lines = (owner: string) =>
    s.model
      .blockEntities(owner)
      .map((id) => s.model.entity(id)!)
      .filter((e) => e.geom.kind === 'LINE');
  return { ...s, asked, where, acting, array, source, lines };
}

/** ARRAYRECT of lines 30 and 40, two columns, 15 apart. */
async function arrayL(d: ReturnType<typeof drawing>) {
  await d.bus.script(['ARRAYRECT']);
  await d.bus.pick({ x: 5, y: 0 });
  await d.bus.pick({ x: 10, y: 5 });
  await d.bus.submit('');
  await d.bus.script(['COU', '2', '1', 'S', '15', '', '']);
  expect(d.bus.command).toBeUndefined();
}

/** ARRAYEDIT Source on the array's item at `at`. */
async function editSource(d: ReturnType<typeof drawing>, at: string) {
  await d.bus.script(['ARRAYEDIT']);
  await d.bus.answer({ kind: 'selection', ids: [d.array().id] });
  await d.bus.script(['S', at]);
  expect(d.log.at(-1)).toBe('Edit the item, then save or discard the changes with ARRAYCLOSE.');
}

const moveStandIn = async (d: ReturnType<typeof drawing>, e: Entity, by: string) => {
  await d.bus.script(['MOVE']);
  await d.bus.answer({ kind: 'selection', ids: [e.id] });
  await d.bus.script(['0,0', by]);
  expect(d.bus.command).toBeUndefined();
};

describe('an associative array keeps the constraints in its source (M9-13)', () => {
  it('hands the constraints among the objects arrayed to the source block, unannounced', async () => {
    const d = drawing();
    await arrayL(d);
    const src = d.source();
    expect(d.byHandle('30')).toBeUndefined();
    // C5 named line 41, left behind: it goes, as before; the L's own go into the block.
    expect(d.where()).toEqual([
      `C1:horizontal:${src}`,
      `C2:coincident:${src}`,
      `C3:vertical:${src}`,
      'C4:fix:M',
      `D1:aligned:${src}`,
    ]);
    expect(d.log).toContain('1 geometric constraint removed.');
    expect(d.log.some((l) => /dimensional constraint/.test(l))).toBe(false);
    // Held in the block: not drawn, picked or solved, yet d1 keeps its row and name.
    expect(d.acting()).toEqual(['C4']);
    expect(parameterObjects(d.model).map((p) => p.parameter)).toEqual(['d1']);
    // The constraints name the block's lines, d1's dimension line moved with them.
    const [b30, b40] = d.lines(src);
    const c2 = d.model.objects.get('C2') as GeometricConstraintObject;
    expect(c2.refs.map((r) => r.entity)).toEqual([b30!.handle, b40!.handle]);
    // U puts the L and its constraints back in model space.
    await d.bus.script(['U']);
    expect(d.where()).toEqual([
      'C1:horizontal:M',
      'C2:coincident:M',
      'C3:vertical:M',
      'C4:fix:M',
      'C5:parallel:M',
      'D1:aligned:M',
    ]);
  });

  it('ARRAYEDIT Source solves them on the objects opened; ARRAYCLOSE Yes keeps them in the block', async () => {
    const d = drawing();
    await arrayL(d);
    await editSource(d, '20,5');
    const opened = d.lines(MODEL_SPACE).filter((e) => !['41'].includes(e.handle));
    expect(opened).toHaveLength(2);
    expect(d.where()).toEqual([
      'C1:horizontal:M',
      'C2:coincident:M',
      'C3:vertical:M',
      'C4:fix:M',
      'D1:aligned:M',
    ]);
    expect(d.acting()).toEqual(['C1', 'C2', 'C3', 'C4', 'D1']);
    // The opened item is the second: d1's dimension line went with it.
    expect((d.model.objects.get('D1') as DimensionalConstraintObject).location).toEqual({
      x: 27,
      y: 5,
    });
    const upright = opened.find((e) => (e.geom as { start: { x: number } }).start.x === 25)!;
    await moveStandIn(d, upright, '5,0');
    // MOVE re-solved the L's constraints, d1 with them.
    expect(d.asked.at(-1)).toEqual(['C1', 'C2', 'C3', 'C4', 'D1']);
    await d.bus.script(['ARRAYCLOSE', 'Y']);
    const src = d.source();
    expect(d.where()).toEqual([
      `C1:horizontal:${src}`,
      `C2:coincident:${src}`,
      `C3:vertical:${src}`,
      'C4:fix:M',
      `D1:aligned:${src}`,
    ]);
    expect(d.acting()).toEqual(['C4']);
    // Back in the block's coordinates, whose origin is the L's centre (5,5).
    expect((d.model.objects.get('D1') as DimensionalConstraintObject).location).toEqual({
      x: 7,
      y: 0,
    });
    expect(d.log.filter((l) => /constraints? removed/.test(l))).toEqual([
      '1 geometric constraint removed.',
    ]);
  });

  it('ARRAYCLOSE No puts the constraints back on the block’s objects as they were', async () => {
    const d = drawing();
    await arrayL(d);
    const before = d.where();
    const held = [...d.model.objects.values()].filter(isGeometricConstraint);
    await editSource(d, '5,5');
    const opened = d.lines(MODEL_SPACE).filter((e) => e.handle !== '41');
    await moveStandIn(d, opened[1]!, '0,3');
    await d.bus.script(['ARRAYCLOSE', 'N']);
    expect(d.where()).toEqual(before);
    expect([...d.model.objects.values()].filter(isGeometricConstraint)).toEqual(held);
    expect(d.acting()).toEqual(['C4']);
  });

  it('a polar item turned 45° sets Horizontal and Vertical aside, and ARRAYCLOSE brings them back', async () => {
    const d = drawing();
    await d.bus.script(['ARRAYPOLAR']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    await d.bus.script(['0,-20', 'I', '8', '']);
    expect(d.bus.command).toBeUndefined();
    const src = d.source();
    // The item 45° round from the first, about (0,-20): line 40's middle is at (-10.6, 4.75).
    const itemAt = '-10.6,4.75';
    await editSource(d, itemAt);
    expect(d.acting()).toEqual(['C2', 'C4', 'D1']);
    expect(d.model.objects.get('C1')).toBeUndefined();
    await d.bus.script(['ARRAYCLOSE', 'Y']);
    expect(d.where()).toEqual([
      `C1:horizontal:${src}`,
      `C2:coincident:${src}`,
      `C3:vertical:${src}`,
      'C4:fix:M',
      `D1:aligned:${src}`,
    ]);
  });

  it('a copy of the array gets a source block of its own, its constraints too', async () => {
    const d = drawing();
    await arrayL(d);
    const first = d.source();
    await d.bus.script(['COPY']);
    await d.bus.answer({ kind: 'selection', ids: [d.array().id] });
    await d.bus.script(['0,0', '0,50', '']);
    const arrays = d.space().filter((e) => assocArrayOf(d.model.objects.values(), e));
    expect(arrays).toHaveLength(2);
    const second = assocArrayOf(d.model.objects.values(), arrays[1]!)!.source;
    expect(second).not.toBe(first);
    const inSecond = d.where().filter((w) => w.endsWith(`:${second}`));
    expect(inSecond.map((w) => w.split(':')[1]).sort()).toEqual([
      'aligned',
      'coincident',
      'horizontal',
      'vertical',
    ]);
    // Under a name of its own: the drawing's parameter names stay its only ones.
    expect(parameterObjects(d.model).map((p) => p.parameter)).toEqual(['d1', 'd2']);
  });
});

describe('BLOCK and the Block Editor (M9-13)', () => {
  it('BLOCK takes the constraints into the block; the Block Editor solves them, BCLOSE holds them again', async () => {
    const d = drawing();
    await d.bus.script(['-BLOCK', 'ELL', '0,0']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    expect(d.bus.command).toBeUndefined();
    const ell = [...d.model.tables.blockRecords.values()].find((r) => r.name === 'ELL')!.handle;
    expect(d.where()).toEqual([
      `C1:horizontal:${ell}`,
      `C2:coincident:${ell}`,
      `C3:vertical:${ell}`,
      'C4:fix:M',
      `D1:aligned:${ell}`,
    ]);
    expect(d.acting()).toEqual(['C4']);
    await d.bus.script(['-BEDIT', 'ELL']);
    expect(d.acting()).toEqual(['C1', 'C2', 'C3', 'C4', 'D1']);
    const [, upright] = d.lines(ell);
    await moveStandIn(d, upright!, '5,0');
    expect(d.asked.at(-1)).toEqual(['C1', 'C2', 'C3', 'C4', 'D1']);
    await d.bus.script(['BSAVE', 'BCLOSE']);
    expect(d.acting()).toEqual(['C4']);
  });

  it('BLOCK redefined drops the old objects’ constraints without a word', async () => {
    const d = drawing();
    await d.bus.script(['-BLOCK', 'ELL', '0,0']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    await d.bus.submit('');
    const said = d.log.length;
    await d.bus.script(['-BLOCK', 'ELL', 'Y', '0,0']);
    await d.bus.pick({ x: 25, y: 0 });
    await d.bus.submit('');
    expect(d.bus.command).toBeUndefined();
    expect(d.where()).toEqual(['C4:fix:M']);
    // The parallel to 30 went with 30 when the first BLOCK took it, said then.
    expect(d.log.slice(said).some((l) => /constraint/.test(l))).toBe(false);
  });
});
