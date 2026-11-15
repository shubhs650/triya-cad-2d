// The Drafting Settings dialog's state (M3-06 part 1; AutoCAD 2024 Help, "Drafting Settings
// Dialog Box"): what its Polar Tracking, Object Snap and Quick Properties tabs show, taken from
// the drafting aids as the dialog opens and given back to them on OK. The dialog edits a copy,
// so Cancel changes nothing, as AutoCAD's does.
import { OSNAP_OFF, type DraftingSettingsTab } from '@triya/engine';
import {
  MAX_ADDITIONAL_ANGLES,
  POLARMODE_ADDITIONAL,
  POLARMODE_TRACK_POLAR,
  QP_DISTANCES,
  QP_ROW_COUNTS,
  additionalAngles,
  angleText,
  type DraftingState,
  type QpQuadrant,
} from './drafting';

export const DRAFTING_SETTINGS_TABS: readonly { tab: DraftingSettingsTab; label: string }[] = [
  { tab: 'polar', label: 'Polar Tracking' },
  { tab: 'osnap', label: 'Object Snap' },
  { tab: 'qp', label: 'Quick Properties' },
];

export interface DraftingSettingsDraft {
  /** Polar Tracking On (F10). */
  readonly polar: boolean;
  /** Increment angle, degrees (POLARANG). */
  readonly polarAngle: number;
  /** Additional angles (POLARMODE 4) and the list of them (POLARADDANG), degrees. */
  readonly additional: boolean;
  readonly angles: readonly number[];
  /** Track using all polar angle settings (POLARMODE 2), else track orthogonally only. */
  readonly trackPolar: boolean;
  /** Object Snap On (F3), and the modes checked (OSMODE without OSNAP_OFF). */
  readonly osnap: boolean;
  readonly modes: number;
  /** Object Snap Tracking On (F11). */
  readonly otrack: boolean;
  /** Display the Quick Properties palette on selection (QPMODE above 0), and for which. */
  readonly qp: boolean;
  readonly qpMode: 1 | 2;
  /** Cursor-dependent (QPLOCATION 0) or Static (1). */
  readonly qpLocation: 0 | 1;
  readonly quadrant: QpQuadrant;
  /** Distance in pixels and Minimum number of rows, as typed. */
  readonly distance: string;
  readonly collapse: boolean;
  readonly rows: string;
}

/** The dialog as it opens on the drafting aids. */
export function draftOf(s: DraftingState): DraftingSettingsDraft {
  return {
    polar: s.polar,
    polarAngle: s.polarAngle,
    additional: (s.polarMode & POLARMODE_ADDITIONAL) !== 0,
    angles: additionalAngles(s.polarAddAngles) ?? [],
    trackPolar: (s.polarMode & POLARMODE_TRACK_POLAR) !== 0,
    osnap: (s.osmode & OSNAP_OFF) === 0 && s.osmode !== 0,
    modes: s.osmode & ~OSNAP_OFF,
    otrack: s.otrack,
    qp: s.qpmode > 0,
    // QPMODE 0 (off, with no mode kept) turns on for all objects, as Ctrl+Shift+P does.
    qpMode: Math.abs(s.qpmode) === 2 ? 2 : 1,
    qpLocation: s.qpLocation,
    quadrant: s.qpQuadrant,
    distance: String(s.qpDistance),
    collapse: s.qpCollapse,
    rows: String(s.qpRows),
  };
}

/** A whole number typed in `range`, else undefined. */
function whole(text: string, range: { min: number; max: number }): number | undefined {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= range.min && n <= range.max ? n : undefined;
}

/** Why OK cannot close the dialog yet, or undefined when it can. */
export function draftProblem(d: DraftingSettingsDraft): string | undefined {
  if (whole(d.distance, QP_DISTANCES) === undefined)
    return `Distance in pixels must be a whole number from ${QP_DISTANCES.min} to ${QP_DISTANCES.max}.`;
  if (whole(d.rows, QP_ROW_COUNTS) === undefined)
    return `Minimum number of rows must be a whole number from ${QP_ROW_COUNTS.min} to ${QP_ROW_COUNTS.max}.`;
  return undefined;
}

/**
 * A new additional angle typed after New: decimal degrees, refused when it is not a number, is
 * listed already or the list is full (AutoCAD 2024 Help: "Adds up to 10 additional polar
 * tracking alignment angles").
 */
export function addAngle(
  angles: readonly number[],
  text: string,
): { angles: number[] } | { problem: string } {
  const parsed = additionalAngles(text.trim());
  if (!parsed || parsed.length !== 1) return { problem: 'Enter an angle in degrees.' };
  const a = parsed[0]!;
  if (angles.length >= MAX_ADDITIONAL_ANGLES)
    return { problem: `Up to ${MAX_ADDITIONAL_ANGLES} additional angles.` };
  if (angles.includes(a)) return { problem: `${angleText(a)} is listed already.` };
  return { angles: [...angles, a] };
}

/** What OK sets: the drafting aids the dialog shows, `s` the state it opened over. */
export function draftPatch(d: DraftingSettingsDraft, s: DraftingState): Partial<DraftingState> {
  if (draftProblem(d)) return {};
  const keptBits = s.polarMode & ~(POLARMODE_ADDITIONAL | POLARMODE_TRACK_POLAR);
  return {
    polar: d.polar,
    polarAngle: d.polarAngle,
    polarMode:
      keptBits |
      (d.additional ? POLARMODE_ADDITIONAL : 0) |
      (d.trackPolar ? POLARMODE_TRACK_POLAR : 0),
    polarAddAngles: d.angles.map(angleText).join(';'),
    // Object Snap Off keeps the modes for F3 to turn back on, as AutoCAD's OSMODE 16384 bit does.
    osmode: d.osnap ? d.modes : d.modes | OSNAP_OFF,
    otrack: d.otrack,
    qpmode: d.qp ? d.qpMode : -d.qpMode,
    qpLocation: d.qpLocation,
    qpQuadrant: d.quadrant,
    qpDistance: whole(d.distance, QP_DISTANCES)!,
    qpCollapse: d.collapse,
    qpRows: whole(d.rows, QP_ROW_COUNTS)!,
  };
}
