// M9-05 part 1: GEOMCONSTRAINT and GCHORIZONTAL … GCFIX on the PromptBus, with AutoCAD 2024's
// prompts ("GEOMCONSTRAINT (Command)" and each GC* command's page). The solver here is a stand-in
// that records what it was asked and answers as told; packages/constraints/test/solver.test.ts
// runs the same commands against PlaneGCS.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  edgeCurvesOf,
  isGeometricConstraint,
  toleranceForSize,
  type BusEvent,
  type ConstraintAddResult,
  type ConstraintRef,
  type ConstraintSolver,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type GeometricConstraintKind,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

const LOCKED = '12';

/** Picks take the model-space objects within 0.25 of the pick (a POINT within 0.25 of it). */
function host(model: () => DocumentModel): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const hits: [number, EntityId][] = [];
      for (const e of model().entities()) {
        if (e.owner !== MODEL_SPACE) continue;
        const g = e.geom;
        const d =
          g.kind === 'POINT' || g.kind === 'TEXT'
            ? Math.hypot(g.position.x - r.point.x, g.position.y - r.point.y)
            : (() => {
                const c = edgeCurvesOf(g, false)[0];
                return c ? closestPoint(c, r.point, toleranceForSize(100)).distance : Infinity;
              })();
        if (d < 0.25) hits.push([d, e.id]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
    },
  };
}

interface Call {
  readonly kind: GeometricConstraintKind;
  readonly refs: readonly ConstraintRef[];
  readonly existing: number;
}

/**
 * A drawing: line 30 (0,0)-(10,0), line 31 (0,5)-(10,8), circle 32 at (20,0) r 2, a polyline 33
 * (30,0)-(40,0)-(40,10), a POINT 34 at (50,0), a text 35 at (60,0), and line 36 (0,20)-(10,20) on a
 * locked layer. `answer` is what the solver says (by default: applied, nothing moved).
 */
function setup(
  answer: (call: Call) => ConstraintAddResult = () => ({ ok: true, updated: [], dofs: 0 }),
  solver = true,
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      layers: [layer(LAYER_0, '0'), { ...layer(LOCKED, 'LOCKED'), locked: true }],
    },
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
      entityInit('34', { kind: 'POINT', position: { x: 50, y: 0 } }),
      entityInit('35', {
        kind: 'TEXT',
        text: 'A',
        position: { x: 60, y: 0 },
        height: 1,
        rotation: 0,
      } as unknown as EntityGeometry),
      entityInit('36', lineGeom(0, 20, 10, 20), { layer: LOCKED }),
    ],
  });
  const calls: Call[] = [];
  const service: ConstraintSolver = {
    add: (existing, c, lookup, tol) => {
      expect(tol.linear).toBeGreaterThan(0);
      expect(lookup(c.refs[0]!.entity)).toBeDefined();
      const call = { kind: c.kind, refs: c.refs, existing: existing.length };
      calls.push(call);
      return answer(call);
    },
    // The GC* commands solve their own edits: the bus never re-solves after them.
    solveEdit: () => {
      throw new Error('not asked');
    },
    measure: () => {
      throw new Error('no dimensional constraints here');
    },
    addDimension: () => {
      throw new Error('no dimensional constraints here');
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model),
    ...(solver && { constraints: () => Promise.resolve(service) }),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const constraints = () => [...model.objects.values()].filter(isGeometricConstraint);
  return { model, bus, log, calls, byHandle, constraints };
}

/** The solver's answer for Parallel on lines 30 and 31: line 31 made level. */
const levelled = (model: DocumentModel): ConstraintAddResult => {
  const before = model.entityByHandle('31')!;
  const after = { ...before, geom: lineGeom(0, 5, 10, 5) } as Entity;
  return { ok: true, updated: [{ before, after }], dofs: 4 };
};

describe('GCPARALLEL', () => {
  it('asks for two objects, applies what the solver moved and keeps the constraint', async () => {
    const s = setup(() => levelled(s.model));
    await s.bus.script(['GCPARALLEL']);
    expect(s.bus.promptText).toBe('Select first object:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select second object:');
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.bus.command).toBeUndefined();
    expect(s.calls).toEqual([
      { kind: 'parallel', refs: [{ entity: '30' }, { entity: '31' }], existing: 0 },
    ]);
    expect(s.byHandle('31').geom).toEqual(lineGeom(0, 5, 10, 5));
    expect(s.constraints()).toEqual([
      expect.objectContaining({
        type: 'TRIYA_GEOMCONSTRAINT',
        owner: 'C',
        kind: 'parallel',
        refs: [{ entity: '30' }, { entity: '31' }],
      }),
    ]);
    // One step: U takes back the constraint and the move together.
    await s.bus.script(['U']);
    expect(s.constraints()).toEqual([]);
    expect(s.byHandle('31').geom).toEqual(lineGeom(0, 5, 10, 8));
  });

  it('says why the solver refused and asks again, changing nothing', async () => {
    const s = setup(() => ({
      ok: false,
      reason: 'overconstrained',
      message: 'The constraint would over-constrain the geometry',
      conflicting: ['0'],
    }));
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.log).toContain('The constraint would over-constrain the geometry.');
    expect(s.bus.promptText).toBe('Select first object:');
    expect(s.constraints()).toEqual([]);
    await s.bus.cancel();
  });

  it('passes the constraints the drawing already has', async () => {
    const s = setup();
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.script(['GCPERPENDICULAR']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 40, y: 5 });
    expect(s.calls.map((c) => [c.kind, c.existing])).toEqual([
      ['parallel', 0],
      ['perpendicular', 1],
    ]);
    // A polyline segment is picked as its own object.
    expect(s.calls[1]!.refs).toEqual([{ entity: '30' }, { entity: '33', segment: 1 }]);
  });

  it('asks again after a pick on nothing, an object it cannot take or a locked one', async () => {
    const s = setup();
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 100, y: 100 });
    expect(s.bus.promptText).toBe('Select first object:');
    await s.bus.pick({ x: 50, y: 0 });
    expect(s.log).toContain('Invalid selection. Select a line, circle, arc or polyline segment.');
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.log).toContain('The object is on a locked layer.');
    expect(s.bus.promptText).toBe('Select first object:');
    expect(s.calls).toEqual([]);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
  });

  it('says so when there is no solver', async () => {
    const s = setup(undefined, false);
    await s.bus.script(['GCPARALLEL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.log).toContain('Geometric constraints are not available here.');
    await s.bus.cancel();
  });

  it('says so when the solver cannot load', async () => {
    const init = sampleInit();
    const model = DocumentModel.create(init);
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: host(() => model),
      constraints: () => Promise.reject(new Error('no WebAssembly')),
    });
    const log: string[] = [];
    bus.on((e) => e.type === 'log' && log.push(e.line));
    await bus.script(['GCPARALLEL']);
    await bus.pick({ x: 5, y: 0 });
    await bus.pick({ x: 0, y: 5 });
    expect(log).toContain('The constraint solver could not load: no WebAssembly');
    await bus.cancel();
  });
});

describe('GCHORIZONTAL and GCVERTICAL', () => {
  it('take an object picked', async () => {
    const s = setup();
    await s.bus.script(['GCHORIZONTAL']);
    expect(s.bus.promptText).toBe('Select an object or [2Points] <2Points>:');
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.calls).toEqual([{ kind: 'horizontal', refs: [{ entity: '31' }], existing: 0 }]);
    expect(s.bus.command).toBeUndefined();
  });

  it('take two points, the nearest constraint point of each object picked (Enter: 2Points)', async () => {
    const s = setup();
    await s.bus.script(['GCVERTICAL', '']);
    expect(s.bus.promptText).toBe('Select first point:');
    await s.bus.pick({ x: 9.9, y: 0 });
    expect(s.bus.promptText).toBe('Select second point:');
    await s.bus.pick({ x: 5.1, y: 6.5 });
    expect(s.calls[0]!.refs).toEqual([
      { entity: '30', point: 'end' },
      { entity: '31', point: 'mid' },
    ]);
  });

  it('take the polyline vertex or a circle centre for a point', async () => {
    const s = setup();
    await s.bus.script(['GCVERTICAL', '2P']);
    await s.bus.pick({ x: 39.9, y: 0 });
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.calls[0]!.refs).toEqual([
      { entity: '33', point: 'vertex', index: 1 },
      { entity: '32', point: 'center' },
    ]);
  });

  it('asks again when the solver refuses, and ends on Esc at a point', async () => {
    const s = setup(() => ({ ok: false, reason: 'invalid', message: 'no', conflicting: [] }));
    await s.bus.script(['GCHORIZONTAL']);
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.log).toContain('No.');
    expect(s.bus.promptText).toBe('Select an object or [2Points] <2Points>:');
    await s.bus.script(['']);
    await s.bus.pick({ x: 0, y: 0 });
    await s.bus.pick({ x: 0, y: 5 });
    expect(s.bus.promptText).toBe('Select an object or [2Points] <2Points>:');
    await s.bus.script(['']);
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.log).toContain('Invalid selection. Select a line, circle, arc, point or polyline.');
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.log).toContain('The object is on a locked layer.');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
  });
});

describe('GCCOINCIDENT', () => {
  it('makes two points coincide', async () => {
    const s = setup();
    await s.bus.script(['GCCOINCIDENT']);
    expect(s.bus.promptText).toBe('Select first point or [Object] <Object>:');
    await s.bus.pick({ x: 0.1, y: 0 });
    await s.bus.pick({ x: 0.1, y: 5 });
    expect(s.calls[0]).toMatchObject({
      kind: 'coincident',
      refs: [
        { entity: '30', point: 'start' },
        { entity: '31', point: 'start' },
      ],
    });
  });

  it('puts a point on an object (Object)', async () => {
    const s = setup();
    await s.bus.script(['GCCOINCIDENT', '']);
    expect(s.bus.promptText).toBe('Select an object:');
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.bus.promptText).toBe('Select a point:');
    await s.bus.pick({ x: 50, y: 0 });
    expect(s.calls[0]!.refs).toEqual([{ entity: '32' }, { entity: '34', point: 'position' }]);
  });
});

describe('GCCOLLINEAR and GCEQUAL', () => {
  it('take two objects', async () => {
    const s = setup();
    await s.bus.script(['GCEQUAL']);
    expect(s.bus.promptText).toBe('Select first object or [Multiple]:');
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.calls[0]).toMatchObject({ kind: 'equal' });
    expect(s.bus.command).toBeUndefined();
  });

  it('make each object picked after the first collinear to it (Multiple) until Enter', async () => {
    const s = setup();
    await s.bus.script(['GCCOLLINEAR', 'M']);
    expect(s.bus.promptText).toBe('Select first object:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select object to make collinear to the first:');
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 35, y: 0 });
    expect(s.bus.promptText).toBe('Select object to make collinear to the first:');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.calls.map((c) => c.refs)).toEqual([
      [{ entity: '30' }, { entity: '31' }],
      [{ entity: '30' }, { entity: '33', segment: 0 }],
    ]);
  });

  it('asks again when refused, and Enter at the first prompt ends', async () => {
    const s = setup(() => ({ ok: false, reason: 'invalid', message: 'no.', conflicting: [] }));
    await s.bus.script(['GCEQUAL']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.log).toContain('No.');
    expect(s.bus.promptText).toBe('Select first object or [Multiple]:');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
  });
});

describe('GCSYMMETRIC', () => {
  it('takes two objects and the symmetry line', async () => {
    const s = setup();
    await s.bus.script(['GCSYMMETRIC']);
    expect(s.bus.promptText).toBe('Select first object or [2Points] <2Points>:');
    await s.bus.pick({ x: 5, y: 6.5 });
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.bus.promptText).toBe('Select symmetry line:');
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.calls[0]!.refs).toEqual([{ entity: '31' }, { entity: '32' }, { entity: '30' }]);
  });

  it('takes two points and the symmetry line (2Points), asking again when refused', async () => {
    let n = 0;
    const s = setup(() =>
      n++ === 0
        ? { ok: false, reason: 'invalid', message: 'no', conflicting: [] }
        : { ok: true, updated: [], dofs: 0 },
    );
    await s.bus.script(['GCSYMMETRIC', '']);
    await s.bus.pick({ x: 0, y: 5 });
    await s.bus.pick({ x: 20, y: 2 });
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.promptText).toBe('Select first object or [2Points] <2Points>:');
    await s.bus.script(['2P']);
    await s.bus.pick({ x: 0, y: 5 });
    await s.bus.pick({ x: 20, y: 2 });
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.bus.command).toBeUndefined();
    expect(s.calls[1]!.refs).toEqual([
      { entity: '31', point: 'start' },
      { entity: '32', point: 'center' },
      { entity: '30' },
    ]);
  });
});

describe('GCFIX', () => {
  it('fixes a point', async () => {
    const s = setup();
    await s.bus.script(['GCFIX']);
    expect(s.bus.promptText).toBe('Select point or [Object] <Object>:');
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.calls[0]!.refs).toEqual([{ entity: '30', point: 'end' }]);
  });

  it('fixes an object, a POINT by its position (Object)', async () => {
    const s = setup();
    await s.bus.script(['GCFIX', '']);
    expect(s.bus.promptText).toBe('Select an object:');
    await s.bus.pick({ x: 50, y: 0 });
    await s.bus.script(['GCFIX', 'O']);
    await s.bus.pick({ x: 100, y: 100 });
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.log).toContain('Invalid selection. Select a line, circle, arc or polyline segment.');
    await s.bus.pick({ x: 5, y: 20 });
    expect(s.log).toContain('The object is on a locked layer.');
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.calls.map((c) => c.refs)).toEqual([
      [{ entity: '34', point: 'position' }],
      [{ entity: '32' }],
    ]);
  });

  it('asks again when refused', async () => {
    const s = setup(() => ({ ok: false, reason: 'invalid', message: 'no', conflicting: [] }));
    await s.bus.script(['GCFIX']);
    await s.bus.pick({ x: 10, y: 0 });
    expect(s.bus.promptText).toBe('Select point or [Object] <Object>:');
    await s.bus.script(['O']);
    await s.bus.pick({ x: 20, y: 2 });
    expect(s.bus.promptText).toBe('Select an object:');
    await s.bus.cancel();
  });
});

describe('GCTANGENT and GCCONCENTRIC', () => {
  it('take two objects', async () => {
    const s = setup();
    await s.bus.script(['GCTANGENT']);
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 20, y: 2 });
    await s.bus.script(['GCCONCENTRIC']);
    await s.bus.pick({ x: 20, y: 2 });
    await s.bus.cancel();
    expect(s.calls.map((c) => c.kind)).toEqual(['tangent']);
  });
});

describe('GEOMCONSTRAINT', () => {
  it('asks for the type, then runs its prompts; the last type is the default', async () => {
    const s = setup();
    await s.bus.script(['GCON']);
    expect(s.bus.promptText).toBe(
      'Enter constraint type [Horizontal/Vertical/Perpendicular/PArallel/Tangent/SMooth/Coincident/CONcentric/COLlinear/Symmetric/Equal/Fix] <Horizontal>:',
    );
    await s.bus.script(['COL']);
    expect(s.bus.promptText).toBe('Select first object or [Multiple]:');
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 5, y: 6.5 });
    expect(s.calls[0]!.kind).toBe('collinear');
    await s.bus.script(['GEOMCONSTRAINT']);
    expect(s.bus.promptText).toMatch(/<COLlinear>:$/);
    await s.bus.script(['CON']);
    expect(s.bus.promptText).toBe('Select first object:');
    await s.bus.cancel();
  });

  it('says Smooth needs splines', async () => {
    const s = setup();
    await s.bus.script(['GEOMCONSTRAINT', 'SM']);
    expect(s.log).toContain('Smooth needs a spline, which constraints do not support yet.');
    expect(s.bus.command).toBeUndefined();
    expect(builtinCommands().get('GCSMOOTH')).toBeUndefined();
  });
});
