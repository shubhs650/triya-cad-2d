// M9-05 part 3: the Constraint Settings dialog's model (AutoCAD 2024 Help, "Constraint Settings
// Dialog Box": Geometric, Dimensional and AutoConstrain tabs). The dialog edits a copy of the
// user's settings and OK gives them back; the AutoConstrain tab is kept per user, in the
// preferences, and answered to AUTOCONSTRAIN.
import { describe, expect, it } from 'vitest';
import { AUTOCONSTRAIN_DEFAULTS, CONSTRAINT_BAR_ALL } from '@triya/engine';
import { Drafting, INITIAL_DRAFTING } from '../src/drafting';
import { keymap } from '../src/shortcuts';
import { systemVariableReply } from '../src/system-variables';
import {
  CONSTRAINT_SETTINGS_TABS,
  draftOf,
  draftPatch,
  draftProblem,
  moveRow,
  resetAutoConstrain,
  withApply,
  withBar,
} from '../src/constraint-settings';
import { normalizePreferences } from '../src/preferences';

describe('Constraint Settings (M9-05 part 3)', () => {
  it("has AutoCAD's three tabs", () => {
    expect(CONSTRAINT_SETTINGS_TABS.map((t) => t.label)).toEqual([
      'Geometric',
      'Dimensional',
      'AutoConstrain',
    ]);
  });

  it('opens on the user settings and gives back what changed on OK', () => {
    const d = draftOf(INITIAL_DRAFTING);
    expect(d).toMatchObject({
      barMode: CONSTRAINT_BAR_ALL,
      transparency: 50,
      showApplied: true,
      showSelected: true,
      nameFormat: 2,
      showHidden: true,
      distance: '0.05',
      angle: '1',
    });
    expect(draftPatch(d)).toEqual({
      constraintInfer: false,
      constraintBarMode: 4095,
      cbarTransparency: 50,
      constraintBarDisplay: 3,
      constraintNameFormat: 2,
      dimConstraintIcon: 3,
      dynConstraintMode: true,
      autoConstrain: AUTOCONSTRAIN_DEFAULTS,
    });
    const edited = {
      ...d,
      barMode: withBar(withBar(d.barMode, 'horizontal', false), 'fix', false),
      showApplied: false,
      nameFormat: 0 as const,
      showHidden: false,
      order: withApply(moveRow(d.order, 1, -1), 'equal', false),
      tangentTouch: false,
      distance: '0.5',
      angle: '2.5',
    };
    const patch = draftPatch(edited);
    expect(patch.constraintBarMode).toBe(4095 - 1 - 2048);
    expect(patch.constraintBarDisplay).toBe(2);
    expect(patch.constraintNameFormat).toBe(0);
    expect(patch.dynConstraintMode).toBe(false);
    expect(patch.autoConstrain).toEqual({
      order: [
        { kind: 'collinear', apply: true },
        { kind: 'coincident', apply: true },
        ...AUTOCONSTRAIN_DEFAULTS.order.slice(2, -1),
        { kind: 'equal', apply: false },
      ],
      tangentTouch: false,
      perpendicularTouch: true,
      distance: 0.5,
      angle: 2.5,
    });
    // Reset puts back the AutoConstrain tab only.
    const reset = resetAutoConstrain(edited);
    expect(reset.order).toEqual(AUTOCONSTRAIN_DEFAULTS.order);
    expect(reset.distance).toBe('0.05');
    expect(reset.nameFormat).toBe(0);
  });

  it('moves rows within the list only', () => {
    const order = AUTOCONSTRAIN_DEFAULTS.order;
    expect(moveRow(order, 0, -1)).toBe(order);
    expect(moveRow(order, order.length - 1, 1)).toBe(order);
    expect(
      moveRow(order, 2, 1)
        .map((o) => o.kind)
        .slice(2, 4),
    ).toEqual(['perpendicular', 'parallel']);
  });

  it('refuses tolerances that are not numbers in range', () => {
    const d = draftOf(INITIAL_DRAFTING);
    expect(draftProblem(d)).toBeUndefined();
    expect(draftProblem({ ...d, distance: '0' })).toMatch(/distance tolerance/);
    expect(draftProblem({ ...d, distance: 'x' })).toMatch(/distance tolerance/);
    expect(draftProblem({ ...d, angle: '-1' })).toMatch(/angle tolerance/);
    expect(draftProblem({ ...d, angle: '91' })).toMatch(/angle tolerance/);
    expect(draftProblem({ ...d, angle: '0' })).toBeUndefined();
  });

  it('keeps the AutoConstrain tab in the preferences, mending a bad one', () => {
    const order = withApply(AUTOCONSTRAIN_DEFAULTS.order, 'tangent', false);
    const stored = { drafting: { autoConstrain: { ...AUTOCONSTRAIN_DEFAULTS, order, angle: 3 } } };
    const p = normalizePreferences(stored);
    expect(p.drafting.autoConstrain.order).toEqual(order);
    expect(p.drafting.autoConstrain.angle).toBe(3);
    const bad = normalizePreferences({ drafting: { autoConstrain: { distance: 'x' } } });
    expect(bad.drafting.autoConstrain).toEqual(AUTOCONSTRAIN_DEFAULTS);
  });
});

describe('Show lock icon for annotational constraints (M9-05 part 9)', () => {
  it('is DIMCONSTRAINTICON, 3 at first (both icons), a bitcode from 0 to 3', () => {
    expect(INITIAL_DRAFTING.dimConstraintIcon).toBe(3);
    const d = new Drafting();
    expect(systemVariableReply(d, 'DIMCONSTRAINTICON')).toEqual({ ok: true, value: 3 });
    expect(systemVariableReply(d, 'DIMCONSTRAINTICON', 1)).toEqual({ ok: true, value: 1 });
    expect(d.get().dimConstraintIcon).toBe(1);
  });

  it("is the Dimensional tab's check, its bit 2 alone", () => {
    const draft = draftOf({ ...INITIAL_DRAFTING, dimConstraintIcon: 1 });
    expect(draft.lockAnnotational).toBe(false);
    expect(draftPatch({ ...draft, lockAnnotational: true }).dimConstraintIcon).toBe(3);
    const off = draftOf({ ...INITIAL_DRAFTING, dimConstraintIcon: 2 });
    expect(off.lockAnnotational).toBe(true);
    // Bit 1, the dynamic constraints' icon, which the dialog does not show, is kept.
    expect(draftPatch({ ...off, lockAnnotational: false }).dimConstraintIcon).toBe(0);
    expect(draftPatch(draftOf(INITIAL_DRAFTING)).dimConstraintIcon).toBe(3);
  });

  it('is kept per user in the preferences, a bad one mended', () => {
    const at = (v: unknown) =>
      normalizePreferences({ drafting: { dimConstraintIcon: v } }).drafting.dimConstraintIcon;
    expect(at(2)).toBe(2);
    expect(at(4)).toBe(3);
    expect(at('x')).toBe(3);
  });
});

describe('Infer Constraints (M9-05 part 7)', () => {
  it('is off at first; the status bar toggle, Ctrl+Shift+I and the dialog turn it', () => {
    expect(INITIAL_DRAFTING.constraintInfer).toBe(false);
    const d = new Drafting();
    expect(d.isOn('infer')).toBe(false);
    d.toggle('infer');
    expect(d.isOn('infer')).toBe(true);
    expect(d.get().constraintInfer).toBe(true);
    expect(keymap().keysOf('drafting:infer')).toEqual(['Ctrl+Shift+I']);
    const draft = draftOf(INITIAL_DRAFTING);
    expect(draft.infer).toBe(false);
    expect(draftPatch({ ...draft, infer: true }).constraintInfer).toBe(true);
  });

  it('is CONSTRAINTINFER, kept per user in the preferences', () => {
    const d = new Drafting();
    expect(systemVariableReply(d, 'CONSTRAINTINFER')).toEqual({ ok: true, value: 0 });
    expect(systemVariableReply(d, 'CONSTRAINTINFER', 1)).toEqual({ ok: true, value: 1 });
    expect(d.isOn('infer')).toBe(true);
    expect(
      normalizePreferences({ drafting: { constraintInfer: true } }).drafting.constraintInfer,
    ).toBe(true);
    expect(
      normalizePreferences({ drafting: { constraintInfer: 'x' } }).drafting.constraintInfer,
    ).toBe(false);
  });
});
