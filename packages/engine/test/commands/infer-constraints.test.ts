// M9-05 part 7: Infer Constraints (CONSTRAINTINFER; AutoCAD 2024 Help, "About Inferring
// Geometric Constraints"). While the app's CONSTRAINTINFER is 1 the objects a command makes take
// constraints from the points object snaps gave it (ENDpoint, MIDpoint, CENter, NODe, NEArest,
// PERpendicular, TANgent; not INTersection, APParent, EXTension or QUAdrant), LINE's segments
// meet end to start (and Close), RECTANG's sides are two Parallel and one Perpendicular, all in
// the command's undo step, nothing moved; SCALE, MIRROR, OFFSET, BREAK, TRIM, EXTEND and ARRAY
// infer nothing.
import { describe, expect, it } from 'vitest';
import {
  inferredConstraints,
  trackedSnaps,
  isGeometricConstraint,
  toleranceForSize,
  type ConstraintSolver,
  type Entity,
  type GeometricConstraintObject,
  type OsnapMode,
  type ViewRequest,
} from '../../src/index';
import { EngineSession } from '../../src/session/index';
import { sampleInit } from '../model/fixtures';
import { setup } from './edit-harness';
import { NO_PARAMETERS } from './solver-stub';

/** A solver taking every constraint, recording what it was asked. */
function stub() {
  const asked: GeometricConstraintObject[] = [];
  const solver: ConstraintSolver = {
    ...NO_PARAMETERS,
    add: (_existing, c) => {
      asked.push(c);
      return { ok: true, updated: [], dofs: 0 };
    },
    solveEdit: () => ({ ok: true, updated: [] }),
    measure: () => {
      throw new Error('not asked');
    },
    addDimension: () => {
      throw new Error('not asked');
    },
  };
  return { solver, asked };
}

/**
 * Line 30 (0,0)-(10,0) and circle 31 at (50,0) r 5, with CONSTRAINTINFER `infer`, and `extra`
 * objects from handle 40 on.
 */
function drawing(infer = 1, extra: readonly Entity['geom'][] = []) {
  const { solver, asked } = stub();
  const requests: ViewRequest[] = [];
  const s = setup(extra as Entity['geom'][], {
    requests,
    constraints: () => Promise.resolve(solver),
  });
  // The app tells each drawing's engine CONSTRAINTINFER (the session's `sysvar` edit).
  s.bus.setConstraintInfer(infer === 1);
  const constraints = () => [...s.model.objects.values()].filter(isGeometricConstraint);
  const idOf = (h: string) => s.byHandle(h)!.id;
  /** A click given by object snap `mode` on the object with handle `h`. */
  const snap = (x: number, y: number, mode: OsnapMode, h: string) =>
    s.bus.pick({ x, y }, { snap: { mode, id: idOf(h) } });
  const made = () => s.space().filter((e) => !['30', '31'].includes(e.handle));
  /** A click on tracking paths (PARallel, OTRACK) from the objects with the handles given. */
  const track = (
    x: number,
    y: number,
    tracks: readonly {
      mode: OsnapMode;
      h: string;
      from: [number, number];
      along?: 'horizontal' | 'vertical';
    }[],
  ) =>
    s.bus.pick(
      { x, y },
      {
        tracks: tracks.map((t) => ({
          mode: t.mode,
          id: idOf(t.h),
          from: { x: t.from[0], y: t.from[1] },
          ...(t.along && { along: t.along }),
        })),
      },
    );
  return { ...s, asked, requests, constraints, snap, made, track };
}

const summary = (cs: readonly GeometricConstraintObject[]) =>
  cs.map((c) => `${c.kind} ${c.refs.map((r) => Object.values(r).join('.')).join(' ')}`);

describe('Infer Constraints (M9-05 part 7)', () => {
  it("LINE from a line's END: Coincident ends, and each segment meets the next", async () => {
    const d = drawing();
    await d.bus.script(['LINE']);
    await d.snap(10, 0, 'END', '30');
    await d.bus.submit('10,10');
    await d.bus.submit('0,10');
    await d.bus.submit('');
    const [a, b] = d.made();
    expect(summary(d.constraints())).toEqual([
      `coincident 30.end ${a!.handle}.start`,
      `coincident ${a!.handle}.end ${b!.handle}.start`,
    ]);
    expect(d.requests).toContainEqual({
      op: 'constraintBars',
      action: 'applied',
      entities: ['30', a!.handle, b!.handle],
    });
  });

  it('one undo step with the lines; nothing while CONSTRAINTINFER is 0', async () => {
    const d = drawing();
    await d.bus.script(['LINE']);
    await d.snap(10, 0, 'END', '30');
    await d.bus.submit('10,10');
    await d.bus.submit('');
    expect(d.constraints()).toHaveLength(1);
    await d.bus.script(['U']);
    expect(d.constraints()).toHaveLength(0);
    expect(d.made()).toHaveLength(0);

    const off = drawing(0);
    await off.bus.script(['LINE']);
    await off.snap(10, 0, 'END', '30');
    await off.bus.submit('10,10');
    await off.bus.submit('20,10');
    await off.bus.submit('');
    expect(off.made()).toHaveLength(2);
    expect(off.constraints()).toHaveLength(0);
    expect(off.asked).toHaveLength(0);
  });

  it("LINE's Close joins the last line's end to the first's start, Esc keeps the rest", async () => {
    const d = drawing();
    await d.bus.script(['LINE', '20,20', '30,20', '30,30', 'C']);
    const [a, b, c] = d.made();
    expect(summary(d.constraints())).toEqual([
      `coincident ${a!.handle}.end ${b!.handle}.start`,
      `coincident ${b!.handle}.end ${c!.handle}.start`,
      `coincident ${c!.handle}.end ${a!.handle}.start`,
    ]);
    const e = drawing();
    await e.bus.script(['LINE', '20,20', '30,20', '30,30']);
    await e.bus.cancel();
    expect(e.made()).toHaveLength(2);
    expect(e.constraints()).toHaveLength(1);
  });

  it("RECTANG: two Parallel and one Perpendicular on the polyline's sides", async () => {
    const d = drawing();
    await d.bus.script(['RECTANG', '20,20', '30,25']);
    const [r] = d.made();
    expect(summary(d.constraints())).toEqual([
      `parallel ${r!.handle}.0 ${r!.handle}.2`,
      `parallel ${r!.handle}.1 ${r!.handle}.3`,
      `perpendicular ${r!.handle}.0 ${r!.handle}.1`,
    ]);
  });

  it("RECTANG's corner snapped to a line's MIDpoint is Coincident with it", async () => {
    const d = drawing();
    await d.bus.script(['RECTANG']);
    await d.snap(5, 0, 'MID', '30');
    await d.bus.submit('8,4');
    const [r] = d.made();
    expect(summary(d.constraints())[0]).toBe(`coincident 30.mid ${r!.handle}.vertex.0`);
  });

  it("CIRCLE's centre at a circle's CENter: Coincident centres", async () => {
    const d = drawing();
    await d.bus.script(['CIRCLE']);
    await d.snap(50, 0, 'CEN', '31');
    await d.bus.submit('2');
    const [c] = d.made();
    expect(summary(d.constraints())).toEqual([`coincident 31.center ${c!.handle}.center`]);
  });

  it('NEArest puts the end on the object; PERpendicular adds Perpendicular', async () => {
    const d = drawing();
    await d.bus.script(['LINE']);
    await d.snap(3, 0, 'NEA', '30');
    await d.bus.submit('3,5');
    await d.bus.submit('');
    const [a] = d.made();
    expect(summary(d.constraints())).toEqual([`coincident 30 ${a!.handle}.start`]);

    const p = drawing();
    await p.bus.script(['LINE', '6,8']);
    await p.snap(6, 0, 'PER', '30');
    await p.bus.submit('');
    const [b] = p.made();
    expect(summary(p.constraints())).toEqual([
      `coincident 30 ${b!.handle}.end`,
      `perpendicular 30 ${b!.handle}`,
    ]);
  });

  it('TANgent to a circle: the line Tangent, which holds its end there', async () => {
    const d = drawing();
    await d.bus.script(['LINE', '55,10']);
    await d.snap(55, 0, 'TAN', '31');
    await d.bus.submit('');
    const [a] = d.made();
    expect(summary(d.constraints())).toEqual([`tangent ${a!.handle} 31`]);
  });

  it('INTersection, APParent, EXTension and QUAdrant infer nothing', async () => {
    for (const mode of ['INT', 'APP', 'EXT', 'QUA'] as const) {
      const d = drawing();
      await d.bus.script(['LINE']);
      await d.snap(10, 0, mode, '30');
      await d.bus.submit('10,10');
      await d.bus.submit('');
      expect(d.constraints()).toEqual([]);
    }
  });
});

/** Line 40 (20,20)-(30,20), away from line 30 and circle 31. */
const LINE_40: Entity['geom'] = { kind: 'LINE', start: { x: 20, y: 20 }, end: { x: 30, y: 20 } };

describe('Infer Constraints: tracking, edits, fillets and chamfers (M9-05 part 8)', () => {
  it('PARallel: a line ended on the Parallel path from line 30 is Parallel to it', async () => {
    const d = drawing();
    await d.bus.script(['LINE', '20,20']);
    await d.track(30, 20, [{ mode: 'PAR', h: '30', from: [5, 0] }]);
    await d.bus.submit('');
    const [a] = d.made();
    expect(summary(d.constraints())).toEqual([`parallel 30 ${a!.handle}`]);

    // A point that is not on the path (the canvas said so, the geometry did not) infers nothing.
    const off = drawing();
    await off.bus.script(['LINE', '20,20']);
    await off.track(30, 25, [{ mode: 'PAR', h: '30', from: [5, 0] }]);
    await off.bus.submit('');
    expect(off.constraints()).toEqual([]);
  });

  it("MOVE by a line's END onto line 30's END: Coincident ends", async () => {
    const d = drawing(1, [LINE_40]);
    await d.bus.script(['MOVE', '25,20', '']);
    await d.snap(20, 20, 'END', '40');
    await d.snap(10, 0, 'END', '30');
    expect(d.byHandle('40')!.geom).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 20, y: 0 } });
    expect(summary(d.constraints())).toEqual(['coincident 30.end 40.start']);
    // One undo step puts the line back and takes the constraint away.
    await d.bus.script(['U']);
    expect(d.byHandle('40')!.geom).toMatchObject({ start: { x: 20, y: 20 } });
    expect(d.constraints()).toEqual([]);
  });

  it('MOVE with a typed base point and destination infers nothing', async () => {
    const d = drawing(1, [LINE_40]);
    await d.bus.script(['MOVE', '25,20', '', '20,20', '10,0']);
    expect(d.constraints()).toEqual([]);
    expect(d.asked).toEqual([]);
  });

  it('COPY tracked horizontally from an END: the copy and that point Horizontal', async () => {
    const d = drawing(1, [LINE_40]);
    await d.bus.script(['COPY', '25,20', '']);
    await d.snap(20, 20, 'END', '40');
    await d.track(40, 0, [{ mode: 'END', h: '30', from: [10, 0], along: 'horizontal' }]);
    await d.bus.submit('');
    const [, copy] = d.made();
    expect(copy!.geom).toMatchObject({ start: { x: 40, y: 0 } });
    expect(summary(d.constraints())).toEqual([`horizontal 30.end ${copy!.handle}.start`]);
  });

  it('STRETCH tracked vertically from a CENter: that point and the end stretched Vertical', async () => {
    const d = drawing(1, [LINE_40]);
    await d.bus.script(['STRETCH', 'C', '29,19', '31,21', '']);
    await d.snap(30, 20, 'END', '40');
    await d.track(50, 20, [{ mode: 'CEN', h: '31', from: [50, 0], along: 'vertical' }]);
    expect(d.byHandle('40')!.geom).toMatchObject({ end: { x: 50, y: 20 } });
    expect(summary(d.constraints())).toEqual(['vertical 31.center 40.end']);
  });

  it("LINE's points tracked horizontally infer nothing (the Help names MOVE, COPY, STRETCH)", async () => {
    const d = drawing();
    await d.bus.script(['LINE', '20,20']);
    await d.track(40, 0, [{ mode: 'END', h: '30', from: [10, 0], along: 'horizontal' }]);
    await d.bus.submit('');
    expect(d.constraints()).toEqual([]);
  });

  it("FILLET: the arc's ends Coincident with the trimmed lines' and Tangent to both", async () => {
    const d = drawing(1, [{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    await d.bus.script(['FILLET', 'R', '1']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 12, y: 6 });
    const arc = d.space().find((e) => e.geom.kind === 'ARC')!;
    const got = summary(d.constraints());
    expect([...got].sort()).toEqual(
      [
        `coincident 30.end ${arc.handle}.start`,
        `tangent 30 ${arc.handle}`,
        `coincident 40.start ${arc.handle}.end`,
        `tangent 40 ${arc.handle}`,
      ].sort(),
    );
    // Each Coincident comes before the Tangent it makes solvable at the shared end.
    expect(got.indexOf(`coincident 30.end ${arc.handle}.start`)).toBeLessThan(
      got.indexOf(`tangent 30 ${arc.handle}`),
    );
  });

  it("CHAMFER: the new line's ends Coincident with the trimmed lines'", async () => {
    const d = drawing(1, [{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    await d.bus.script(['CHAMFER', 'D', '1', '1']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 12, y: 6 });
    const chamfer = d.made().find((e) => e.handle !== '40')!;
    expect(summary(d.constraints()).sort()).toEqual(
      [
        `coincident 30.end ${chamfer.handle}.start`,
        `coincident 40.start ${chamfer.handle}.end`,
      ].sort(),
    );
  });

  it('a sharp corner (FILLET radius 0) holds the two ends together', async () => {
    const d = drawing(1, [{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    await d.bus.script(['FILLET', 'R', '0']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 12, y: 6 });
    expect(summary(d.constraints())).toEqual(['coincident 30.end 40.start']);
  });

  it('nothing with CONSTRAINTINFER 0', async () => {
    const d = drawing(0, [{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    await d.bus.script(['FILLET', 'R', '1']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 12, y: 6 });
    expect(d.constraints()).toEqual([]);
  });
});

describe('trackedSnaps (M9-05 part 8)', () => {
  const from = { x: 10, y: 0 };
  const point = { kind: 'point', point: from, mode: 'END', id: 7 } as const;
  const parallel = { kind: 'parallel', point: from, direction: { x: 1, y: 0 }, id: 8 } as const;

  it('PARallel paths and horizontal or vertical OTRACK paths, with their objects', () => {
    expect(
      trackedSnaps({
        point: { x: 40, y: 0 },
        paths: [
          { from, angle: Math.PI, label: 'Endpoint', source: point },
          { from: { x: 0, y: 0 }, angle: 0, label: 'Parallel', source: parallel },
          { from, angle: (3 * Math.PI) / 2, label: 'Endpoint', source: point },
        ],
      }),
    ).toEqual([
      { mode: 'END', id: 7, from, along: 'horizontal' },
      { mode: 'PAR', id: 8, from },
      { mode: 'END', id: 7, from, along: 'vertical' },
    ]);
  });

  it('nothing from polar paths, Extension, slanted or unknown objects', () => {
    expect(
      trackedSnaps({
        point: { x: 40, y: 0 },
        paths: [
          { from, angle: 0, label: 'Polar', polar: true },
          {
            from,
            angle: 0,
            label: 'Extension',
            source: { kind: 'extension', point: from, direction: { x: 1, y: 0 } },
          },
          { from, angle: Math.PI / 4, label: 'Endpoint', source: point },
          {
            from,
            angle: 0,
            label: 'Endpoint',
            source: { kind: 'point', point: from, mode: 'END' },
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('CONSTRAINTINFER in the session (M9-05 part 7)', () => {
  it('is off until the app tells the drawing otherwise, never an undo step', () => {
    const session = new EngineSession(sampleInit());
    expect(session.constraintInfer).toBe(false);
    const r = session.edit({ kind: 'sysvar', name: 'CONSTRAINTINFER', value: 1 });
    expect(r).toEqual({ ok: true, change: {} });
    expect(session.constraintInfer).toBe(true);
    session.edit({ kind: 'sysvar', name: 'CONSTRAINTINFER', value: 0 });
    expect(session.constraintInfer).toBe(false);
  });
});

describe('inferredConstraints (M9-05 part 7)', () => {
  const tol = toleranceForSize(100);
  const line = (handle: string, x1: number, y1: number, x2: number, y2: number): Entity =>
    ({
      id: Number.parseInt(handle, 16),
      handle,
      geom: { kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
    }) as unknown as Entity;
  const a = line('40', 0, 0, 10, 0);
  const b = line('41', 10, 0, 10, 10);
  const entity = (id: number) => [a, b].find((e) => e.id === id);

  it("a snap that is not one of the new object's points infers nothing (nothing moves)", () => {
    expect(
      inferredConstraints({
        command: 'COPY',
        added: [b],
        snaps: [{ point: { x: 0, y: 0 }, mode: 'END', id: a.id }],
        entity,
        tol,
      }),
    ).toEqual([]);
  });

  it('COPY to an END is Coincident; SCALE, MIRROR, OFFSET, TRIM and ARRAY infer nothing', () => {
    const snaps = [{ point: { x: 10, y: 0 }, mode: 'END' as const, id: a.id }];
    expect(inferredConstraints({ command: 'COPY', added: [b], snaps, entity, tol })).toEqual([
      {
        kind: 'coincident',
        refs: [
          { entity: '40', point: 'end' },
          { entity: '41', point: 'start' },
        ],
      },
    ]);
    for (const command of ['SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'BREAK', 'ARRAY']) {
      expect(inferredConstraints({ command, added: [b], snaps, entity, tol })).toEqual([]);
    }
  });

  it('PERpendicular on a line the new one does not meet square adds only Coincident', () => {
    const slant = line('42', 10, 0, 14, 10);
    expect(
      inferredConstraints({
        command: 'LINE',
        added: [slant],
        snaps: [{ point: { x: 10, y: 0 }, mode: 'PER', id: a.id }],
        entity,
        tol,
      }),
    ).toEqual([{ kind: 'coincident', refs: [{ entity: '40' }, { entity: '42', point: 'start' }] }]);
  });
});
