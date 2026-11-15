// UNITS and -UNITS (M3-09): the Drawing Units dialog and its command-line version (AutoCAD 2024
// Help, "UNITS (Command)", "Drawing Units Dialog Box", "Direction Control Dialog Box" and
// "-UNITS (Command)"). Both set the header variables that say how lengths and angles are shown
// and typed: LUNITS, LUPREC, AUNITS, AUPREC, ANGBASE and ANGDIR; the dialog also sets INSUNITS,
// its "Units to scale inserted content", which PASTECLIP, PASTEBLOCK and PASTEORIG scale by
// (M2-32, `insUnitsScale`). Nothing drawn is rescaled: INSUNITS only says what a unit is
// (PRD FR-F9, DEC-024). The changes are one undo step; Cancel (Esc) leaves the drawing as it was.
// The dialog's Lighting group is left out: lights are a PRD non-goal (13).
//
// UNITS runs transparently ('UNITS), as AutoCAD's does. The dialog's Direction Control "Pick an
// angle" closes it for "Pick angle" (two points, or a typed angle counter-clockwise from east)
// and opens it again on Direction Control with the angle picked, as AutoCAD returns to it.
import type { CommandContext, CommandDef } from './command';
import type { HeaderValue } from '../model/types';
import type { DocumentModel } from '../model/document';
import { insUnitsOf } from '../model/units';
import { drawingUnits, formatAngle, formatDistance, type DrawingUnits } from './units';
import type { Prompt, PromptAnswer } from './prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** What the Drawing Units dialog shows and sets. */
export interface UnitsSettings {
  /** LUNITS: 1 scientific, 2 decimal, 3 engineering, 4 architectural, 5 fractional. */
  readonly lunits: number;
  /** LUPREC, 0–8: decimal places, or 2^LUPREC as the smallest fraction's denominator. */
  readonly luprec: number;
  /** AUNITS: 0 decimal degrees, 1 degrees/minutes/seconds, 2 grads, 3 radians, 4 surveyor's. */
  readonly aunits: number;
  /** AUPREC, 0–8. */
  readonly auprec: number;
  /** ANGBASE: the direction of angle 0, radians counter-clockwise from east. */
  readonly angbase: number;
  /** ANGDIR 1: angles measured clockwise. */
  readonly clockwise: boolean;
  /** INSUNITS, 0–24: the drawing's unit, which inserted content is scaled to. */
  readonly insunits: number;
}

/**
 * The INSUNITS codes by name, as the dialog's "Units to scale inserted content" list names them
 * (AutoCAD 2024 Help, "INSUNITS (System Variable)"); the index is the code.
 */
export const INSUNITS_NAMES: readonly string[] = [
  'Unitless',
  'Inches',
  'Feet',
  'Miles',
  'Millimeters',
  'Centimeters',
  'Meters',
  'Kilometers',
  'Microinches',
  'Mils',
  'Yards',
  'Angstroms',
  'Nanometers',
  'Microns',
  'Decimeters',
  'Decameters',
  'Hectometers',
  'Gigameters',
  'Astronomical Units',
  'Light Years',
  'Parsecs',
  'US Survey Feet',
  'US Survey Inch',
  'US Survey Yard',
  'US Survey Mile',
];

const turn = 2 * Math.PI;

/** An angle in [0, 2π). */
const normalised = (a: number): number => {
  const r = a % turn;
  return r < 0 ? r + turn : r;
};

/** The drawing's settings, AutoCAD's defaults for what its header lacks. */
export function unitsSettings(model: DocumentModel): UnitsSettings {
  const u = drawingUnits(model.header);
  const base = model.header.get('$ANGBASE');
  const dir = model.header.get('$ANGDIR');
  const ins = insUnitsOf(model);
  return {
    lunits: u.lunits,
    luprec: u.luprec,
    aunits: u.aunits,
    auprec: u.auprec,
    angbase: typeof base === 'number' && Number.isFinite(base) ? normalised(base) : 0,
    clockwise: dir === 1 || dir === true,
    insunits: Number.isInteger(ins) && ins >= 0 && ins < INSUNITS_NAMES.length ? ins : 0,
  };
}

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
export function validUnitsSettings(s: UnitsSettings): boolean {
  return (
    inRange(s.lunits, 1, 5) &&
    inRange(s.luprec, 0, 8) &&
    inRange(s.aunits, 0, 4) &&
    inRange(s.auprec, 0, 8) &&
    typeof s.angbase === 'number' &&
    Number.isFinite(s.angbase) &&
    typeof s.clockwise === 'boolean' &&
    inRange(s.insunits, 0, INSUNITS_NAMES.length - 1)
  );
}

/** How `s` shows lengths and angles. */
export function unitsOf(s: UnitsSettings): DrawingUnits {
  return { lunits: s.lunits, luprec: s.luprec, aunits: s.aunits, auprec: s.auprec, unitmode: 0 };
}

/**
 * The dialog's Sample Output: a point and a polar distance in `s`'s units (AutoCAD's
 * `1.5000,2.0039,0.0000` and `3.0000<45,0.0000`).
 */
export function unitsSample(s: UnitsSettings): [string, string] {
  const u = unitsOf(s);
  const d = (v: number) => formatDistance(v, u);
  return [`${d(1.5)},${d(2.0039)},${d(0)}`, `${d(3)}<${formatAngle(Math.PI / 4, u)},${d(0)}`];
}

/** The header entries `s` changes in `model`, each kept in the type the drawing holds it in. */
function changedEntries(model: DocumentModel, s: UnitsSettings): [string, HeaderValue][] {
  const was = unitsSettings(model);
  const out: [string, HeaderValue][] = [];
  const put = (key: string, value: number) => {
    const before = model.header.get(key);
    out.push([key, typeof before === 'boolean' ? value === 1 : value]);
  };
  if (s.lunits !== was.lunits) put('$LUNITS', s.lunits);
  if (s.luprec !== was.luprec) put('$LUPREC', s.luprec);
  if (s.aunits !== was.aunits) put('$AUNITS', s.aunits);
  if (s.auprec !== was.auprec) put('$AUPREC', s.auprec);
  const base = normalised(s.angbase);
  if (Math.abs(base - was.angbase) > 1e-12) put('$ANGBASE', base);
  if (s.clockwise !== was.clockwise) put('$ANGDIR', s.clockwise ? 1 : 0);
  if (s.insunits !== was.insunits) put('$INSUNITS', s.insunits);
  return out;
}

/** Sets what changed, as one undo step. */
function apply(ctx: CommandContext, s: UnitsSettings): void {
  const entries = changedEntries(ctx.model, s);
  if (entries.length > 0) ctx.edit((b) => entries.forEach(([k, v]) => b.setHeader(k, v)));
}

/** UNITS (UN): the Drawing Units dialog. */
export function unitsCommand(): CommandDef {
  return {
    name: 'UNITS',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      let settings = unitsSettings(ctx.model);
      let direction = false;
      for (;;) {
        const a: PromptAnswer = yield ctx.prompt.dialog({
          message: 'Drawing Units',
          dialog: { type: 'units', settings, ...(direction && { direction: true as const }) },
        });
        if (a.kind !== 'dialog' || !a.units || !validUnitsSettings(a.units)) return;
        settings = a.units;
        if (a.action === 'select') {
          // Direction Control's "Pick an angle": two points, or an angle typed from east.
          const p = yield ctx.prompt.angle({
            message: 'Pick angle',
            zero: 0,
            counterClockwise: true,
          });
          if (p.kind === 'angle') settings = { ...settings, angbase: normalised(p.value) };
          direction = true;
          continue;
        }
        if (a.action === 'ok') apply(ctx, settings);
        return;
      }
    },
  };
}

const LENGTH_FORMATS = [
  'Report formats:   (Examples)',
  '  1. Scientific    1.55E+01',
  '  2. Decimal       15.50',
  `  3. Engineering   1'-3.50"`,
  `  4. Architectural 1'-3 1/2"`,
  '  5. Fractional    15 1/2',
  'With the exception of Engineering and Architectural formats, these formats can be used with',
  'any basic unit of measurement. For example, Decimal mode is perfect for metric units as well',
  'as decimal English units.',
];

const ANGLE_FORMATS = [
  'Systems of angle measure:        (Examples)',
  '  1. Decimal degrees         45.0000',
  `  2. Degrees/minutes/seconds 45d0'0"`,
  '  3. Grads                   50.0000g',
  '  4. Radians                 0.7854r',
  `  5. Surveyor's units        N 45d0'0" E`,
];

/** An integer `ok` takes, asked again (saying `problem`) until one is given. */
async function* integerIn(
  ctx: CommandContext,
  message: string,
  value: number,
  ok: (n: number) => boolean,
  problem: string,
): Sub<number | undefined> {
  for (;;) {
    const a = yield ctx.prompt.integer({ message, default: { kind: 'number', value } });
    if (a.kind !== 'number') return undefined;
    if (ok(a.value)) return a.value;
    ctx.message(problem);
  }
}

const DENOMINATORS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** -UNITS: the same settings asked at the command line, INSUNITS aside (as AutoCAD's). */
export function dashUnitsCommand(): CommandDef {
  return {
    name: '-UNITS',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const was = unitsSettings(ctx.model);
      for (const line of LENGTH_FORMATS) ctx.message(line);
      const lunits = yield* integerIn(
        ctx,
        'Enter choice, 1 to 5',
        was.lunits,
        (n) => n >= 1 && n <= 5,
        'Requires an integer between 1 and 5.',
      );
      if (lunits === undefined) return;
      let luprec: number | undefined;
      if (lunits === 4 || lunits === 5) {
        const den = yield* integerIn(
          ctx,
          'Enter denominator of smallest fraction to display (1, 2, 4, 8, 16, 32, 64, 128, or 256)',
          2 ** was.luprec,
          (n) => DENOMINATORS.includes(n),
          'Requires 1, 2, 4, 8, 16, 32, 64, 128 or 256.',
        );
        luprec = den === undefined ? undefined : Math.log2(den);
      } else {
        luprec = yield* integerIn(
          ctx,
          'Enter number of digits to right of decimal point (0 to 8)',
          was.luprec,
          (n) => n >= 0 && n <= 8,
          'Requires an integer between 0 and 8.',
        );
      }
      if (luprec === undefined) return;
      for (const line of ANGLE_FORMATS) ctx.message(line);
      const choice = yield* integerIn(
        ctx,
        'Enter choice, 1 to 5',
        was.aunits + 1,
        (n) => n >= 1 && n <= 5,
        'Requires an integer between 1 and 5.',
      );
      if (choice === undefined) return;
      const aunits = choice - 1;
      const auprec = yield* integerIn(
        ctx,
        'Enter number of fractional places for display of angles (0 to 8)',
        was.auprec,
        (n) => n >= 0 && n <= 8,
        'Requires an integer between 0 and 8.',
      );
      if (auprec === undefined) return;
      // The directions in the angle units just chosen, as AutoCAD lists them.
      const u: DrawingUnits = { lunits, luprec, aunits, auprec, unitmode: 0 };
      const at = (deg: number) => formatAngle((deg * Math.PI) / 180, u);
      ctx.message('Direction for angle 0:');
      ctx.message(`  East   3 o'clock = ${at(0)}`);
      ctx.message(`  North 12 o'clock = ${at(90)}`);
      ctx.message(`  West   9 o'clock = ${at(180)}`);
      ctx.message(`  South  6 o'clock = ${at(270)}`);
      const dir = yield ctx.prompt.angle({
        message: 'Enter direction for angle 0',
        zero: 0,
        counterClockwise: true,
        default: { kind: 'angle', value: was.angbase },
      });
      if (dir.kind !== 'angle') return;
      const cw = yield ctx.prompt.keyword({
        message: 'Do you want angles measured clockwise?',
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: was.clockwise ? 'Yes' : 'No' },
      });
      if (cw.kind !== 'keyword') return;
      apply(ctx, {
        lunits,
        luprec,
        aunits,
        auprec,
        angbase: normalised(dir.value),
        clockwise: cw.keyword === 'Yes',
        insunits: was.insunits,
      });
    },
  };
}

export const UNITS_COMMANDS: readonly (() => CommandDef)[] = [unitsCommand, dashUnitsCommand];
