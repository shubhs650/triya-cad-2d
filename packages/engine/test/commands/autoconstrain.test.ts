// M9-05 part 3: AUTOCONSTRAIN (AutoCAD 2024 Help, "AUTOCONSTRAIN (Command)": "Select objects or
// [Settings]", Settings opening the Constraint Settings dialog on its AutoConstrain tab),
// GCCOINCIDENT's Autoconstrain, and CONSTRAINTSETTINGS (CSETTINGS), which opens the dialog. The
// constraints are tried in the tab's order through the solver, those it refuses skipped, all one
// undo step; the settings are the user's, which the app answers with.
import { describe, expect, it } from 'vitest';
import {
  AUTOCONSTRAIN_DEFAULTS,
  isGeometricConstraint,
  type AutoConstrainSettings,
  type ConstraintSolver,
  type GeometricConstraintObject,
  type ViewRequest,
} from '../../src/index';
import { setup } from './edit-harness';
import { NO_PARAMETERS } from './solver-stub';
import { lineGeom } from '../model/fixtures';

/** A solver taking every constraint but those `refuse` names, recording what it was asked. */
function stub(refuse: (c: GeometricConstraintObject) => boolean = () => false) {
  const asked: GeometricConstraintObject[] = [];
  const solver: ConstraintSolver = {
    ...NO_PARAMETERS,
    add: (existing, c) => {
      asked.push(c);
      // The constraints already applied come back each time, the new one's handle their own.
      expect(existing.every((e) => e.handle !== c.handle)).toBe(true);
      return refuse(c)
        ? { ok: false, reason: 'redundant', message: 'redundant', conflicting: [] }
        : { ok: true, updated: [], dofs: 0 };
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
 * Line 30 (0,0)-(10,0) and line 40 (10,0)-(10,10), an L, and circle 31 far off; `autoConstrain`
 * the user's settings.
 */
function drawing(solver: ConstraintSolver, autoConstrain?: AutoConstrainSettings) {
  const requests: ViewRequest[] = [];
  const s = setup([lineGeom(10, 0, 10, 10)], {
    requests,
    constraints: () => Promise.resolve(solver),
    ...(autoConstrain && { autoConstrain }),
  });
  const constraints = () =>
    [...s.model.objects.values()].filter(isGeometricConstraint).map((c) => c.kind);
  const select = async (...points: { x: number; y: number }[]) => {
    for (const p of points) await s.bus.pick(p);
    await s.bus.submit('');
  };
  return { ...s, requests, constraints, select };
}

describe('AUTOCONSTRAIN (M9-05 part 3)', () => {
  it("applies the L's constraints in the tab's order, one undo step", async () => {
    const { solver, asked } = stub();
    const d = drawing(solver);
    await d.bus.script(['AUTOCONSTRAIN']);
    expect(d.bus.promptText).toBe('Select objects or [Settings]:');
    await d.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    expect(d.bus.command).toBeUndefined();
    expect(asked.map((c) => c.kind)).toEqual([
      'coincident',
      'perpendicular',
      'horizontal',
      'vertical',
      'equal',
    ]);
    expect(d.constraints()).toEqual([
      'coincident',
      'perpendicular',
      'horizontal',
      'vertical',
      'equal',
    ]);
    expect(d.log).toContain('5 constraints applied to 2 objects.');
    // The objects' bars show, as a constraint applied shows them (M9-05 part 2).
    expect(d.requests).toContainEqual({
      op: 'constraintBars',
      action: 'applied',
      entities: ['30', '40'],
    });
    expect(d.bus.undo.state.undoable).toBe(1);
    await d.bus.script(['U']);
    expect(d.constraints()).toEqual([]);
  });

  it('skips what the solver refuses and what the drawing has already', async () => {
    const { solver, asked } = stub((c) => c.kind === 'horizontal' || c.kind === 'vertical');
    const d = drawing(solver);
    await d.bus.script(['GCPERPENDICULAR']);
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.pick({ x: 10, y: 5 });
    asked.length = 0;
    await d.bus.script(['AUTOCONSTRAIN']);
    await d.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    // The Perpendicular the drawing has is not asked again.
    expect(asked.map((c) => c.kind)).toEqual(['coincident', 'horizontal', 'vertical', 'equal']);
    expect(d.constraints()).toEqual(['perpendicular', 'coincident', 'equal']);
    expect(d.log).toContain('2 constraints applied to 2 objects.');
  });

  it("follows the user's settings, which the app keeps", async () => {
    const { solver } = stub();
    const d = drawing(solver, {
      ...AUTOCONSTRAIN_DEFAULTS,
      order: AUTOCONSTRAIN_DEFAULTS.order.map((o) => ({ ...o, apply: o.kind === 'vertical' })),
    });
    await d.bus.script(['AUTOCONSTRAIN']);
    await d.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    expect(d.constraints()).toEqual(['vertical']);
    expect(d.log).toContain('1 constraint applied to 1 object.');
  });

  it('says so when nothing applies, and takes objects selected first', async () => {
    const { solver } = stub(() => true);
    const d = drawing(solver);
    await d.bus.script(['AUTOCONSTRAIN']);
    await d.select({ x: 50, y: 5 });
    expect(d.log).toContain('No constraints applied.');
    await d.bus.pick({ x: 5, y: 0 });
    await d.bus.script(['AUTOCONSTRAIN']);
    expect(d.bus.command).toBeUndefined();
    expect(d.log).toContain('No constraints applied.');
    expect(d.bus.undo.state.undoable).toBe(0);
  });

  it('opens the Constraint Settings on its AutoConstrain tab for Settings, then asks again', async () => {
    const { solver } = stub();
    const d = drawing(solver);
    await d.bus.script(['AUTOCONSTRAIN', 'S']);
    expect(d.bus.prompt).toMatchObject({
      kind: 'dialog',
      message: 'Constraint Settings',
      dialog: { type: 'csettings', tab: 'autoconstrain' },
    });
    await d.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(d.bus.promptText).toBe('Select objects or [Settings]:');
    await d.bus.cancel();
  });
});

describe("GCCOINCIDENT's Autoconstrain (M9-05 part 3)", () => {
  it('makes the ends that meet among the objects selected coincident', async () => {
    const { solver } = stub();
    const d = drawing(solver);
    await d.bus.script(['GCCOINCIDENT']);
    expect(d.bus.promptText).toBe('Select first point or [Object/Autoconstrain] <Object>:');
    await d.bus.script(['A']);
    expect(d.bus.promptText).toBe('Select objects:');
    await d.select({ x: 5, y: 0 }, { x: 10, y: 5 });
    expect(d.constraints()).toEqual(['coincident']);
    expect(d.log).toContain('1 constraint applied to 2 objects.');
  });
});

describe('CONSTRAINTSETTINGS (M9-05 part 3)', () => {
  it('opens the dialog on the tab shown last, transparently too, editing nothing', async () => {
    for (const typed of ['CONSTRAINTSETTINGS', 'CSETTINGS']) {
      const { solver } = stub();
      const d = drawing(solver);
      const version = d.model.version;
      await d.bus.submit(typed);
      expect(d.bus.prompt).toMatchObject({ kind: 'dialog', dialog: { type: 'csettings' } });
      const dialog = d.bus.prompt?.kind === 'dialog' ? d.bus.prompt.dialog : undefined;
      expect(dialog && 'tab' in dialog ? dialog.tab : undefined).toBeUndefined();
      await d.bus.answer({ kind: 'dialog', action: 'ok' });
      expect(d.bus.command).toBeUndefined();
      expect(d.model.version).toBe(version);
    }
    const { solver } = stub();
    const d = drawing(solver);
    await d.bus.submit('LINE');
    await d.bus.submit("'CSETTINGS");
    expect(d.bus.prompt).toMatchObject({ kind: 'dialog', dialog: { type: 'csettings' } });
    await d.bus.answer({ kind: 'dialog', action: 'cancel' });
    expect(d.bus.promptText).toBe('Specify first point:');
    await d.bus.cancel();
  });
});
