// M9-13 with the real solver (`constraintSolver` over PlaneGCS), as the app's engine worker runs
// it: an associative array of a constrained L keeps the L's constraints in its source block;
// ARRAYEDIT Source opens the L, where a MOVE of one line drags the other, and ARRAYCLOSE takes
// the edit, constraints and all, back into every item. The Block Editor solves a block's too.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  applyPoint,
  assocArrayOf,
  builtinCommands,
  closestPoint,
  compose,
  geometricConstraints,
  insertMatrix,
  isGeometricConstraint,
  toleranceForSize,
  type BusEvent,
  type ConstraintRef,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type EntityId,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type LineGeometry,
  type Matrix2D,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { constraintSolver, loadPlaneGcs, type PlaneGcs } from '../src/index';

let gcs: PlaneGcs;
beforeAll(async () => {
  gcs = await loadPlaneGcs(() =>
    Promise.resolve(readFileSync(new URL('../wasm/planegcs.wasm', import.meta.url))),
  );
});

const MODEL = '1F';
const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const line = (handle: string, x1: number, y1: number, x2: number, y2: number) => ({
  handle,
  owner: MODEL,
  type: 'LINE',
  layer: '10',
  color: { kind: 'byLayer' as const },
  linetype: 'ByLayer',
  lineweight: 'ByLayer' as const,
  transparency: 'ByLayer' as const,
  ltScale: 1,
  visible: true,
  geom: { kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } } as EntityGeometry,
});

const constraint = (
  handle: string,
  kind: GeometricConstraintKind,
  refs: readonly ConstraintRef[],
): GeometricConstraintObject => ({ handle, type: 'TRIYA_GEOMCONSTRAINT', owner: '0', kind, refs });

/** The L: line 30 (0,0)-(10,0) horizontal, its end on line 31 (10,0)-(10,10), 31 vertical. */
function setup() {
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '40',
    header: new Map(),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL }],
    entities: [line('30', 0, 0, 10, 0), line('31', 10, 0, 10, 10)],
    objects: [
      constraint('A1', 'horizontal', [{ entity: '30' }]),
      constraint('A2', 'coincident', [
        { entity: '30', point: 'end' },
        { entity: '31', point: 'start' },
      ]),
      constraint('A3', 'vertical', [{ entity: '31' }]),
    ],
  };
  const model = DocumentModel.create(init);
  // Picks take the lines of the space being drawn in (model space, or the Block Editor's).
  let space = MODEL;
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'sysvar' && r.name === 'ARRAYASSOCIATIVITY') {
        return Promise.resolve({ ok: true, value: 1 });
      }
      if (r.op === 'blockEditor') {
        space = r.block ?? MODEL;
        return Promise.resolve({ ok: true });
      }
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const ids: EntityId[] = [];
      for (const e of model.entities()) {
        if (e.owner !== space || e.geom.kind !== 'LINE') continue;
        if (closestPoint(e.geom, r.point, toleranceForSize(100)).distance < 0.25) ids.push(e.id);
      }
      return Promise.resolve({ ok: true, ids });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    constraints: () => Promise.resolve(constraintSolver(gcs)),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  /** Every line as drawn (through the blocks that hold it), as sorted [x1, y1, x2, y2]. */
  const drawn = (): number[][] => {
    const out: number[][] = [];
    const walk = (ids: readonly EntityId[], m: Matrix2D) => {
      for (const id of ids) {
        const g = model.entity(id)!.geom;
        if (g.kind === 'LINE') {
          const a = applyPoint(m, g.start);
          const b = applyPoint(m, g.end);
          out.push([r(a.x), r(a.y), r(b.x), r(b.y)]);
        } else if (g.kind === 'INSERT') {
          const base = model.blocks.get(g.block)!.basePoint;
          walk(model.blockEntities(g.block), compose(insertMatrix(g, base), m));
        }
      }
    };
    walk(model.blockEntities(MODEL), IDENTITY);
    return out.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
  };
  const array = (): Entity =>
    model
      .blockEntities(MODEL)
      .map((id) => model.entity(id)!)
      .find((e) => assocArrayOf(model.objects.values(), e))!;
  const select = async (...points: { x: number; y: number }[]) => {
    for (const p of points) await bus.pick(p);
    await bus.submit('');
  };
  return { model, bus, log, drawn, array, select };
}

describe('constraints inside blocks with PlaneGCS (M9-13)', () => {
  it('an associative array of a constrained L keeps them; ARRAYEDIT Source then MOVE drags the other line', async () => {
    const s = setup();
    await s.bus.script(['ARRAYRECT']);
    await s.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    await s.bus.script(['COU', '2', '1', 'S', '15', '', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.some((l) => /constraint/.test(l))).toBe(false);
    // Kept, in the source block, where nothing solves them.
    expect([...s.model.objects.values()].filter(isGeometricConstraint)).toHaveLength(3);
    expect(geometricConstraints(s.model)).toEqual([]);
    expect(s.drawn()).toEqual([
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [15, 0, 25, 0],
      [25, 0, 25, 10],
    ]);
    await s.bus.script(['ARRAYEDIT']);
    await s.bus.answer({ kind: 'selection', ids: [s.array().id] });
    await s.bus.script(['S', '10,5']);
    expect(geometricConstraints(s.model)).toHaveLength(3);
    // The upright moved right: the horizontal line's end follows it and it stays level.
    await s.bus.script(['MOVE']);
    await s.select({ x: 10, y: 5 });
    await s.bus.script(['0,0', '5,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).not.toMatch(/break|refus/i);
    // Every item follows as the edit goes (the item edited stands in model space).
    expect(s.drawn()).toEqual([
      [0, 0, 15, 0],
      [15, 0, 15, 10],
      [15, 0, 30, 0],
      [30, 0, 30, 10],
    ]);
    await s.bus.script(['ARRAYCLOSE', 'Y']);
    expect(s.drawn()).toEqual([
      [0, 0, 15, 0],
      [15, 0, 15, 10],
      [15, 0, 30, 0],
      [30, 0, 30, 10],
    ]);
    expect(geometricConstraints(s.model)).toEqual([]);
    // Opened again, the constraints still hold the L together.
    await s.bus.script(['ARRAYEDIT']);
    await s.bus.answer({ kind: 'selection', ids: [s.array().id] });
    await s.bus.script(['S', '7,0']);
    await s.bus.script(['MOVE']);
    await s.select({ x: 15, y: 5 });
    await s.bus.script(['0,0', '-3,0']);
    await s.bus.script(['ARRAYCLOSE', 'Y']);
    expect(s.drawn()).toEqual([
      [0, 0, 12, 0],
      [12, 0, 12, 10],
      [15, 0, 27, 0],
      [27, 0, 27, 10],
    ]);
  });

  it('the Block Editor solves a block’s constraints: MOVE of the upright drags the other line', async () => {
    const s = setup();
    await s.bus.script(['-BLOCK', 'ELL', '0,0']);
    await s.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    expect(s.bus.command).toBeUndefined();
    expect(geometricConstraints(s.model)).toEqual([]);
    await s.bus.script(['-BEDIT', 'ELL']);
    expect(geometricConstraints(s.model)).toHaveLength(3);
    await s.bus.script(['MOVE']);
    await s.select({ x: 10, y: 5 });
    await s.bus.script(['0,0', '0,4']);
    expect(s.bus.command).toBeUndefined();
    const ell = [...s.model.tables.blockRecords.values()].find((r) => r.name === 'ELL')!.handle;
    const ends = s.model.blockEntities(ell).map((id) => {
      const g = s.model.entity(id)!.geom as LineGeometry;
      return [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v * 1e6) / 1e6 + 0);
    });
    expect(ends).toEqual([
      [0, 4, 10, 4],
      [10, 4, 10, 14],
    ]);
    await s.bus.script(['BSAVE', 'BCLOSE']);
    expect(geometricConstraints(s.model)).toEqual([]);
  });
});
