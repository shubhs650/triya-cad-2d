// M9-06: modify commands with the real solver (`constraintSolver` over PlaneGCS), as the app's
// engine worker runs them (PRD FR-X4): an erased object takes its constraints with it, a move of
// part of a constrained set drags the geometry constrained to it, a move of the whole set keeps
// it as it is, an edit the constraints cannot take is refused, and copies carry the constraints
// among the objects copied.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  isGeometricConstraint,
  toleranceForSize,
  type BusEvent,
  type ConstraintRef,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type LineGeometry,
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

/**
 * An L of line 30 (0,0)-(10,0) and line 31 (10,0)-(10,10), line 32 (0,20)-(10,20): 30
 * horizontal, 30's end on 31's start, 31 vertical, 32 parallel to 30; with `fixed`, 32 fixed.
 */
function setup(fixed = false) {
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
    entities: [line('30', 0, 0, 10, 0), line('31', 10, 0, 10, 10), line('32', 0, 20, 10, 20)],
    objects: [
      constraint('A1', 'horizontal', [{ entity: '30' }]),
      constraint('A2', 'coincident', [
        { entity: '30', point: 'end' },
        { entity: '31', point: 'start' },
      ]),
      constraint('A3', 'vertical', [{ entity: '31' }]),
      constraint('A4', 'parallel', [{ entity: '30' }, { entity: '32' }]),
      ...(fixed ? [constraint('A5', 'fix', [{ entity: '32' }])] : []),
    ],
  };
  const model = DocumentModel.create(init);
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'pick') return Promise.resolve({ ok: false, message: 'no' });
      const ids: EntityId[] = [];
      for (const e of model.entities()) {
        const g = e.geom as LineGeometry;
        if (closestPoint(g, r.point, toleranceForSize(100)).distance < 0.25) ids.push(e.id);
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
  const ends = (h: string) => {
    const g = model.entityByHandle(h)!.geom as LineGeometry;
    return [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  };
  const constraints = () => [...model.objects.values()].filter(isGeometricConstraint);
  /** Selects the lines picked at these points and ends the selection. */
  const select = async (...points: { x: number; y: number }[]) => {
    for (const p of points) await bus.pick(p);
    await bus.submit('');
  };
  return { model, bus, log, ends, constraints, select };
}

const L = { x: 5, y: 0 };
const R = { x: 10, y: 5 };
const TOP = { x: 5, y: 20 };

describe('modify commands keep constraints with PlaneGCS (M9-06)', () => {
  it('MOVE of one line drags the line joined to it, which stays horizontal', async () => {
    const s = setup();
    await s.bus.script(['MOVE']);
    await s.select(R);
    await s.bus.script(['0,0', '5,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.ends('31')).toEqual([15, 0, 15, 10]);
    const l30 = s.ends('30');
    expect(l30.slice(2)).toEqual([15, 0]);
    expect(l30[1]).toBe(0);
    // U takes back the move and what it dragged together.
    await s.bus.script(['U']);
    expect(s.ends('30')).toEqual([0, 0, 10, 0]);
    expect(s.ends('31')).toEqual([10, 0, 10, 10]);
  });

  it('MOVE, ROTATE 180, SCALE and MIRROR of the whole set move nothing else', async () => {
    const s = setup();
    await s.bus.script(['MOVE']);
    await s.select(L, R, TOP);
    await s.bus.script(['0,0', '3,4']);
    expect([s.ends('30'), s.ends('31'), s.ends('32')]).toEqual([
      [3, 4, 13, 4],
      [13, 4, 13, 14],
      [3, 24, 13, 24],
    ]);
    await s.bus.script(['ROTATE']);
    await s.select({ x: 8, y: 4 }, { x: 13, y: 9 }, { x: 8, y: 24 });
    await s.bus.script(['0,0', '180']);
    expect(s.ends('31')).toEqual([-13, -4, -13, -14]);
    await s.bus.script(['SCALE']);
    await s.select({ x: -8, y: -4 }, { x: -13, y: -9 }, { x: -8, y: -24 });
    await s.bus.script(['0,0', '2']);
    expect(s.ends('30')).toEqual([-6, -8, -26, -8]);
    await s.bus.script(['MIRROR']);
    await s.select({ x: -16, y: -8 }, { x: -26, y: -18 }, { x: -16, y: -48 });
    await s.bus.script(['0,0', '0,1', 'Y']);
    expect([s.ends('30'), s.ends('31'), s.ends('32')]).toEqual([
      [6, -8, 26, -8],
      [26, -8, 26, -28],
      [6, -48, 26, -48],
    ]);
    expect(s.constraints()).toHaveLength(4);
    expect(s.log.some((l) => /constraint/i.test(l))).toBe(false);
  });

  it('refuses a ROTATE that turns a horizontal line, and a MOVE of a fixed one', async () => {
    const s = setup();
    // About the line's own start, which ROTATE leaves where it was: that is held too, so the
    // line cannot slide up to stay level.
    await s.bus.script(['ROTATE']);
    await s.select(L);
    await s.bus.script(['0,0', '30']);
    expect(s.log.some((l) => /breaks a constraint/.test(l))).toBe(true);
    expect(s.ends('30')).toEqual([0, 0, 10, 0]);
    expect(s.ends('31')).toEqual([10, 0, 10, 10]);
    const f = setup(true);
    await f.bus.script(['MOVE']);
    await f.select(TOP);
    await f.bus.script(['0,0', '0,5']);
    expect(f.log.some((l) => /breaks a constraint/.test(l))).toBe(true);
    expect(f.ends('32')).toEqual([0, 20, 10, 20]);
  });

  it('a grip drag of a horizontal line’s end moves the line up whole, dragging the upright', async () => {
    const s = setup();
    await s.bus.pick(L);
    await s.bus.pick({ x: 0.1, y: 0.1 }, { grip: 0.5 });
    expect(s.bus.command).toBe('GRIP');
    await s.bus.submit('0,3');
    expect(s.bus.command).toBeUndefined();
    // A least-change solve: the line's far end drifts by under 1e-5.
    expect(s.ends('30').map((v) => Math.round(v * 1e3) / 1e3)).toEqual([0, 3, 10, 3]);
    const l31 = s.ends('31').map((v) => Math.round(v * 1e3) / 1e3);
    expect(l31.slice(0, 2)).toEqual([10, 3]);
    expect(l31[2]).toBe(10);
  });

  it('a grip stretch of the vertical line drags the horizontal one along', async () => {
    const s = setup();
    await s.bus.pick(R);
    await s.bus.pick({ x: 10.1, y: 0.1 }, { grip: 0.5 });
    expect(s.bus.command).toBe('GRIP');
    await s.bus.submit('12,0');
    expect(s.bus.command).toBeUndefined();
    const l31 = s.ends('31');
    expect(l31[0]).toBe(12);
    expect(l31[2]).toBe(12);
    expect(s.ends('30').slice(2)).toEqual([12, 0]);
  });

  it('ERASE takes the erased line’s constraints; the rest still hold', async () => {
    const s = setup();
    await s.bus.script(['ERASE']);
    await s.select(R);
    expect(s.constraints().map((c) => c.kind)).toEqual(['horizontal', 'parallel']);
    expect(s.log).toContain('2 geometric constraints removed.');
    // Line 30 can now be moved alone: nothing is joined to it.
    await s.bus.script(['MOVE']);
    await s.select(L);
    await s.bus.script(['0,0', '0,3']);
    expect(s.ends('30')).toEqual([0, 3, 10, 3]);
  });

  it('COPY carries the L’s constraints, which hold its copies together', async () => {
    const s = setup();
    await s.bus.script(['COPY']);
    await s.select(L, R);
    await s.bus.script(['0,0', '30,0', '']);
    const copies = [...s.model.entities()].filter((e) => !['30', '31', '32'].includes(e.handle));
    expect(copies).toHaveLength(2);
    const [c30, c31] = copies.map((e) => e.handle);
    expect(s.constraints().map((c) => [c.kind, c.refs.map((r) => r.entity)])).toEqual([
      ['horizontal', ['30']],
      ['coincident', ['30', '31']],
      ['vertical', ['31']],
      ['parallel', ['30', '32']],
      ['horizontal', [c30]],
      ['coincident', [c30, c31]],
      ['vertical', [c31]],
    ]);
    // Moving the copied vertical line drags the copied horizontal one, not the original.
    await s.bus.script(['MOVE']);
    await s.select({ x: 40, y: 5 });
    await s.bus.script(['0,0', '5,0']);
    expect(s.ends(c30!).slice(2)).toEqual([45, 0]);
    expect(s.ends('30')).toEqual([0, 0, 10, 0]);
  });
});
