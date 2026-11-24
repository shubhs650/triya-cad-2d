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

/** Line 30 (0,0)-(10,0) and circle 31 at (50,0) r 5, with CONSTRAINTINFER `infer`. */
function drawing(infer = 1) {
  const { solver, asked } = stub();
  const requests: ViewRequest[] = [];
  const s = setup([], {
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
  return { ...s, asked, requests, constraints, snap, made };
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
