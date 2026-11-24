// The Constraint Settings dialog's state (M9-05 part 3; AutoCAD 2024 Help, "Constraint Settings
// Dialog Box" and its Geometric, Dimensional and AutoConstrain tabs): what the tabs show, taken
// from the user's settings as the dialog opens and given back to them on OK. The dialog edits a
// copy, so Cancel changes nothing, as DSETTINGS' does.
//
// Geometric: Infer geometric constraints (CONSTRAINTINFER, M9-05 part 7), the kinds the
// constraint bars show (CONSTRAINTBARMODE), the bars' transparency
// (CBARTRANSPARENCY), and CONSTRAINTBARDISPLAY's two bits. Dimensional: the name format
// (CONSTRAINTNAMEFORMAT) and Show hidden dynamic constraints for selected objects
// (DYNCONSTRAINTMODE). AutoConstrain: the types AUTOCONSTRAIN applies, in order, each with its
// Apply check, the two "must share an intersection point" checks and the tolerances.
import {
  AUTOCONSTRAIN_ANGLE_MAX,
  AUTOCONSTRAIN_DEFAULTS,
  CONSTRAINT_BAR_ALL,
  CONSTRAINT_BAR_BITS,
  type AutoConstrainKind,
  type AutoConstrainSettings,
  type ConstraintSettingsTab,
  type GeometricConstraintKind,
} from '@triya/engine';
import type { DraftingState } from './drafting';

export const CONSTRAINT_SETTINGS_TABS: readonly { tab: ConstraintSettingsTab; label: string }[] = [
  { tab: 'geometric', label: 'Geometric' },
  { tab: 'dimensional', label: 'Dimensional' },
  { tab: 'autoconstrain', label: 'AutoConstrain' },
];

/** The constraint types as the dialog names them, in CONSTRAINTBARMODE's bit order. */
export const CONSTRAINT_TYPE_LABELS: Readonly<Record<GeometricConstraintKind, string>> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  tangent: 'Tangent',
  smooth: 'Smooth (G2)',
  coincident: 'Coincident',
  concentric: 'Concentric',
  collinear: 'Collinear',
  symmetric: 'Symmetric',
  equal: 'Equal',
  fix: 'Fix',
};

/** Dimension name format's choices, CONSTRAINTNAMEFORMAT 0, 1 and 2. */
export const NAME_FORMATS: readonly { value: 0 | 1 | 2; label: string }[] = [
  { value: 0, label: 'Name' },
  { value: 1, label: 'Value' },
  { value: 2, label: 'Name and Expression' },
];

export interface ConstraintSettingsDraft {
  /** CONSTRAINTINFER: Infer geometric constraints (M9-05 part 7). */
  readonly infer: boolean;
  /** CONSTRAINTBARMODE: the kinds the bars show. */
  readonly barMode: number;
  /** CBARTRANSPARENCY, 10 to 90. */
  readonly transparency: number;
  /** CONSTRAINTBARDISPLAY bit 1: Show constraint bars after applying constraints. */
  readonly showApplied: boolean;
  /** CONSTRAINTBARDISPLAY bit 2: Temporarily display constraint bars when objects are selected. */
  readonly showSelected: boolean;
  /** CONSTRAINTNAMEFORMAT. */
  readonly nameFormat: 0 | 1 | 2;
  /** DYNCONSTRAINTMODE: Show hidden dynamic constraints for selected objects. */
  readonly showHidden: boolean;
  /** The AutoConstrain tab, its tolerances as typed. */
  readonly order: AutoConstrainSettings['order'];
  readonly tangentTouch: boolean;
  readonly perpendicularTouch: boolean;
  readonly distance: string;
  readonly angle: string;
}

export function draftOf(s: DraftingState): ConstraintSettingsDraft {
  const a = s.autoConstrain;
  return {
    infer: s.constraintInfer,
    barMode: s.constraintBarMode,
    transparency: s.cbarTransparency,
    showApplied: (s.constraintBarDisplay & 1) !== 0,
    showSelected: (s.constraintBarDisplay & 2) !== 0,
    nameFormat: s.constraintNameFormat,
    showHidden: s.dynConstraintMode,
    ...autoConstrainDraft(a),
  };
}

const autoConstrainDraft = (a: AutoConstrainSettings) => ({
  order: a.order,
  tangentTouch: a.tangentTouch,
  perpendicularTouch: a.perpendicularTouch,
  distance: String(a.distance),
  angle: String(a.angle),
});

/** The AutoConstrain tab's Reset: its defaults, the other tabs as they are. */
export function resetAutoConstrain(d: ConstraintSettingsDraft): ConstraintSettingsDraft {
  return { ...d, ...autoConstrainDraft(AUTOCONSTRAIN_DEFAULTS) };
}

const number = (s: string): number | undefined => {
  const t = s.trim();
  if (!/^[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** Why OK cannot take the draft, or undefined. */
export function draftProblem(d: ConstraintSettingsDraft): string | undefined {
  const distance = number(d.distance);
  if (distance === undefined || distance <= 0) {
    return 'The distance tolerance must be a number greater than 0.';
  }
  const angle = number(d.angle);
  if (angle === undefined || angle > AUTOCONSTRAIN_ANGLE_MAX) {
    return `The angle tolerance must be a number from 0 to ${AUTOCONSTRAIN_ANGLE_MAX}.`;
  }
  return undefined;
}

/** What OK sets: the user's settings from the draft (`draftProblem` already checked). */
export function draftPatch(d: ConstraintSettingsDraft): Partial<DraftingState> {
  return {
    constraintInfer: d.infer,
    constraintBarMode: d.barMode,
    cbarTransparency: d.transparency,
    constraintBarDisplay: (d.showApplied ? 1 : 0) | (d.showSelected ? 2 : 0),
    constraintNameFormat: d.nameFormat,
    dynConstraintMode: d.showHidden,
    autoConstrain: {
      order: d.order,
      tangentTouch: d.tangentTouch,
      perpendicularTouch: d.perpendicularTouch,
      distance: number(d.distance)!,
      angle: number(d.angle)!,
    },
  };
}

/** CONSTRAINTBARMODE with `kind` shown or not. */
export function withBar(mode: number, kind: GeometricConstraintKind, on: boolean): number {
  const bit = CONSTRAINT_BAR_BITS[kind];
  return on ? mode | bit : mode & ~bit & CONSTRAINT_BAR_ALL;
}

/** The order with row `index` moved one place up (-1) or down (1); unchanged at either end. */
export function moveRow(
  order: AutoConstrainSettings['order'],
  index: number,
  by: -1 | 1,
): AutoConstrainSettings['order'] {
  const to = index + by;
  if (index < 0 || to < 0 || to >= order.length) return order;
  const out = [...order];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

/** The order with `kind`'s Apply checked or not. */
export function withApply(
  order: AutoConstrainSettings['order'],
  kind: AutoConstrainKind,
  apply: boolean,
): AutoConstrainSettings['order'] {
  return order.map((o) => (o.kind === kind ? { ...o, apply } : o));
}
