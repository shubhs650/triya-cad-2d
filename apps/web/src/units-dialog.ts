// The Drawing Units dialog's lists (M3-09), as AutoCAD 2024's dialog shows them (AutoCAD Help,
// "Drawing Units Dialog Box"): the length and angle types in its order, and each type's
// precisions as samples of zero written at that precision. Kept apart from the component so
// they are unit-tested (apps/web/test/units-dialog.test.ts).
import { formatAngle, parseAngle } from '@triya/engine';

export interface Choice {
  readonly value: number;
  readonly label: string;
}

/** Length Type: LUNITS, listed alphabetically as AutoCAD lists them. */
export const LENGTH_TYPES: readonly Choice[] = [
  { value: 4, label: 'Architectural' },
  { value: 2, label: 'Decimal' },
  { value: 3, label: 'Engineering' },
  { value: 5, label: 'Fractional' },
  { value: 1, label: 'Scientific' },
];

/** Angle Type: AUNITS. */
export const ANGLE_TYPES: readonly Choice[] = [
  { value: 0, label: 'Decimal Degrees' },
  { value: 1, label: 'Deg/Min/Sec' },
  { value: 2, label: 'Grads' },
  { value: 3, label: 'Radians' },
  { value: 4, label: "Surveyor's Units" },
];

const PLACES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** `0`, `0.0`, … `0.00000000`. */
const zero = (places: number) => (0).toFixed(places);

/** The Length Precision list of LUNITS `lunits`: LUPREC values and their samples. */
export function lengthPrecisions(lunits: number): Choice[] {
  return PLACES.map((p) => {
    const den = 2 ** p;
    const fraction = p === 0 ? '' : ` 1/${den}`;
    let label: string;
    switch (lunits) {
      case 1:
        label = `${zero(p)}E+01`;
        break;
      case 3:
        label = `0'-${zero(p)}"`;
        break;
      case 4:
        label = `0'-0${fraction}"`;
        break;
      case 5:
        label = `0${fraction}`;
        break;
      default:
        label = zero(p);
    }
    return { value: p, label };
  });
}

/**
 * Degrees, minutes and seconds take AUPREC 0 (degrees), 2 (minutes), 4 (seconds), 5–8 (decimals
 * of a second): AutoCAD's list has no entry for 1 or 3, which show as minutes and seconds
 * (`formatAngle`, after ANGTOS).
 */
const DMS_PRECISIONS = [0, 2, 4, 5, 6, 7, 8];

function dms(p: number): string {
  if (p <= 0) return '0d';
  if (p <= 2) return `0d00'`;
  return `0d00'00${p <= 4 ? '' : `.${'0'.repeat(p - 4)}`}"`;
}

/**
 * The Angle Precision list of AUNITS `aunits`. `current` (the drawing's AUPREC) is listed too
 * when the type's list lacks it (AUPREC 1 or 3 in degrees/minutes/seconds), so opening the
 * dialog never changes it.
 */
export function anglePrecisions(aunits: number, current?: number): Choice[] {
  const sexagesimal = aunits === 1 || aunits === 4;
  const values = sexagesimal ? [...DMS_PRECISIONS] : [...PLACES];
  if (current !== undefined && !values.includes(current) && current >= 0 && current <= 8) {
    values.push(current);
    values.sort((a, b) => a - b);
  }
  return values.map((p) => {
    let label: string;
    switch (aunits) {
      case 1:
        label = dms(p);
        break;
      case 2:
        label = `${zero(p)}g`;
        break;
      case 3:
        label = `${zero(p)}r`;
        break;
      case 4:
        label = `N ${dms(p)} E`;
        break;
      default:
        label = zero(p);
    }
    return { value: p, label };
  });
}

/** AUPREC on a change of Angle Type: kept where the new type lists it, else the nearest above. */
export function anglePrecisionFor(aunits: number, auprec: number): number {
  const list = anglePrecisions(aunits).map((c) => c.value);
  return list.includes(auprec) ? auprec : (list.find((v) => v > auprec) ?? list.at(-1)!);
}

/** Direction Control's Base Angle choices: the four compass directions, in radians. */
export const BASE_ANGLES: readonly { readonly label: string; readonly angle: number }[] = [
  { label: 'East', angle: 0 },
  { label: 'North', angle: Math.PI / 2 },
  { label: 'West', angle: Math.PI },
  { label: 'South', angle: (3 * Math.PI) / 2 },
];

/** The compass direction `angle` is, or undefined for Other. */
export function baseAngleName(angle: number): string | undefined {
  return BASE_ANGLES.find((b) => Math.abs(b.angle - angle) < 1e-9)?.label;
}

/** Other's Angle as the field shows it, in the dialog's angle type and precision. */
export function angleText(angle: number, aunits: number, auprec: number): string {
  return formatAngle(angle, { lunits: 2, luprec: 4, aunits, auprec, unitmode: 0 });
}

/**
 * Other's Angle typed: any form a prompt takes (decimal degrees, `45d30'`, `0.5r`, `50g`, a
 * bearing), counter-clockwise from east; undefined when it is no angle.
 */
export function typedAngle(text: string): number | undefined {
  const a = parseAngle(text.trim());
  if (a === undefined || !Number.isFinite(a)) return undefined;
  const turn = 2 * Math.PI;
  return ((a % turn) + turn) % turn;
}
