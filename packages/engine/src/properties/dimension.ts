// A dimension's DIMVAR rows in the Properties palette (M2-30 part 2, M2-35 part 5): AutoCAD
// 2024's Properties groups for a dimension (Lines & Arrows, Text, Fit, Primary Units,
// Alternate Units, Tolerances) with its labels and choices, each shown as the dimension draws
// (its style's value, or its `DSTYLE` override) and each edit written as `DSTYLE` overrides
// (`withDimvarOverride`). A row may set more than one DIMVAR, as AutoCAD's do: Arrow 1 sets
// DIMBLK1 and DIMSAH, Tolerance display DIMTOL, DIMLIM, DIMTM and DIMGAP's sign, Dim prefix
// and Dim suffix the two halves of DIMPOST, the Suppress rows bits of DIMZIN.
//
// The DIMVARs themselves are AutoCAD's DIMSTYLE reference:
// https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-F2FAD36F-0CE3-4943-9DAD-A9BCD2AE81DA
// Where AutoCAD's help does not give a Properties row's choices, they are its Dimension Style
// Manager's names for the same values.
import { parseNumber } from '../commands/parse';
import { dimVars } from '../annotation/leader';
import type { AnnotationTables } from '../annotation/multileader';
import type { DimVarValue } from '../model/types';
import type { PropertyOption, PropertyValue } from './sheet';

type Vars = Readonly<Record<string, DimVarValue>>;

export type DimvarSection =
  'Lines & Arrows' | 'Text' | 'Fit' | 'Primary Units' | 'Alternate Units' | 'Tolerances';

/** How a dimension's measurement is formatted: as a length, or as an angle. */
export type DimensionUnits = 'linear' | 'angular';

/** An angular dimension's measurement is an angle; every other's a length. */
export const dimensionUnits = (g: { readonly dimType: string }): DimensionUnits =>
  g.dimType === 'angular' || g.dimType === 'angular3pt' ? 'angular' : 'linear';

export interface DimvarRow {
  /** The row's key after `dimvar:`: the DIMVAR it shows, or `NAME.part` for a part of one. */
  readonly name: string;
  readonly label: string;
  readonly section: DimvarSection;
  /**
   * The dimensions the row is for (M2-35 part 10): an angular dimension's units are DIMAUNIT,
   * DIMADEC and DIMAZIN, where the others' are DIMLUNIT, DIMDEC, DIMZIN and the alternate
   * units. Undefined for every dimension.
   */
  readonly for?: DimensionUnits;
  readonly kind: 'distance' | 'number' | 'choice' | 'text';
  /** A choice's options; a function where they are the drawing's (linetypes, styles). */
  readonly options?:
    readonly PropertyOption[] | ((model: AnnotationTables, v: Vars) => PropertyOption[]);
  /** A colour row: the palette offers the Select Color dialog's Index Color tab. */
  readonly color?: true;
  /** The value shown, from the dimension's DIMVARs (defaults filled in). */
  readonly get: (v: Vars, model: AnnotationTables) => PropertyValue;
  /** The DIMVARs a typed or chosen value sets, or undefined when the row cannot take it. */
  readonly set: (value: PropertyValue, v: Vars, model: AnnotationTables) => Vars | undefined;
}

/**
 * AutoCAD's imperial defaults (acad.dwt's STANDARD) for the DIMVARs the rows show, for a style
 * that does not state one; the values `@triya/dims` draws with (its style.ts DEFAULTS, which a
 * dims test keeps in step). Handles have none: absent is closed filled, ByBlock, Standard.
 */
export const DIMVAR_DEFAULTS: Readonly<Record<string, DimVarValue>> = {
  DIMASZ: 0.18,
  DIMEXE: 0.18,
  DIMEXO: 0.0625,
  DIMDLE: 0,
  DIMFXL: 1,
  DIMFXLON: 0,
  DIMSD1: 0,
  DIMSD2: 0,
  DIMSE1: 0,
  DIMSE2: 0,
  DIMSAH: 0,
  DIMCLRD: 0,
  DIMCLRE: 0,
  DIMCLRT: 0,
  DIMLWD: -2,
  DIMLWE: -2,
  DIMTXT: 0.18,
  DIMGAP: 0.09,
  DIMTFILL: 0,
  DIMTFILLCLR: 0,
  DIMFRAC: 0,
  DIMTIH: 1,
  DIMTOH: 1,
  DIMJUST: 0,
  DIMTAD: 0,
  DIMSCALE: 1,
  DIMATFIT: 3,
  DIMTIX: 0,
  DIMTMOVE: 0,
  DIMTOFL: 0,
  DIMSOXD: 0,
  DIMDSEP: '.',
  DIMPOST: '',
  DIMRND: 0,
  DIMLFAC: 1,
  DIMLUNIT: 2,
  DIMZIN: 0,
  DIMDEC: 4,
  DIMALT: 0,
  DIMALTU: 2,
  DIMALTD: 2,
  DIMALTF: 25.4,
  DIMALTRND: 0,
  DIMAPOST: '',
  DIMALTZ: 0,
  DIMTOL: 0,
  DIMLIM: 0,
  DIMTP: 0,
  DIMTM: 0,
  DIMTOLJ: 1,
  DIMTDEC: 4,
  DIMTZIN: 0,
  DIMTFAC: 1,
  DIMALTTD: 2,
  DIMALTTZ: 0,
  DIMAUNIT: 0,
  DIMADEC: 0,
  DIMAZIN: 0,
};

/** A dimension's DIMVARs as its rows read them: style, overrides, then the defaults. */
export function rowVars(
  style: string,
  xdata: Parameters<typeof dimVars>[1],
  model: AnnotationTables,
): Vars {
  return { ...DIMVAR_DEFAULTS, ...dimVars(style, xdata, model) };
}

const asNumber = (v: DimVarValue | undefined): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
const asString = (v: DimVarValue | undefined): string => (typeof v === 'string' ? v : '');
/** A handle DIMVAR: absent, empty and `0` all name nothing. */
const asHandle = (v: DimVarValue | undefined): string =>
  typeof v === 'string' && v !== '0' ? v : '';

/** A typed number, as the command line parses one. */
function typed(v: PropertyValue): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  return parseNumber(v.trim());
}

const opts = (pairs: readonly (readonly [number | string, string])[]): PropertyOption[] =>
  pairs.map(([value, label]) => ({ value: String(value), label }));

const nonNegative = (n: number) => n >= 0;
const positive = (n: number) => n > 0;
const any = () => true;

/** A row typed as a number (or distance) that sets one DIMVAR. */
function numberRow(
  name: string,
  label: string,
  section: DimvarSection,
  kind: 'distance' | 'number',
  takes: (n: number) => boolean,
): DimvarRow {
  return {
    name,
    label,
    section,
    kind,
    get: (v) => asNumber(v[name]),
    set: (value) => {
      const n = typed(value);
      return n !== undefined && takes(n) ? { [name]: n } : undefined;
    },
  };
}

/** A choice among the DIMVAR's integer values. */
function choiceRow(
  name: string,
  label: string,
  section: DimvarSection,
  options: readonly PropertyOption[],
): DimvarRow {
  return {
    name,
    label,
    section,
    kind: 'choice',
    options,
    get: (v) => String(asNumber(v[name])),
    set: (value) =>
      options.some((o) => o.value === value) ? { [name]: Number(value) } : undefined,
  };
}

const ON_OFF = opts([
  ['on', 'On'],
  ['off', 'Off'],
]);
const YES_NO = opts([
  ['yes', 'Yes'],
  ['no', 'No'],
]);

/** An On/Off row; `suppress` for the DIMVARs that are on when the part is not drawn. */
function onOffRow(
  name: string,
  label: string,
  section: DimvarSection,
  suppress = false,
): DimvarRow {
  return {
    name,
    label,
    section,
    kind: 'choice',
    options: ON_OFF,
    get: (v) => ((asNumber(v[name]) !== 0) !== suppress ? 'on' : 'off'),
    set: (value) =>
      value === 'on' || value === 'off'
        ? { [name]: Number((value === 'on') !== suppress) }
        : undefined,
  };
}

// --- Colours, lineweights, linetypes ---------------------------------------------------------

const ACI_NAMES = ['', 'Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'];

/** A DIMVAR colour (ACI; 0 ByBlock, 256 ByLayer) as the Color row's value (`colorValue`). */
function aciValue(n: number): string {
  if (n === 0) return 'ByBlock';
  if (n === 256) return 'ByLayer';
  return `aci:${n}`;
}

function aciLabel(n: number): string {
  if (n === 0) return 'ByBlock';
  if (n === 256) return 'ByLayer';
  return ACI_NAMES[n] ?? `Color ${n}`;
}

/** The ACI a colour value names: DSTYLE overrides hold ACIs only (a true colour is refused). */
function aciOf(value: PropertyValue): number | undefined {
  if (value === 'ByBlock') return 0;
  if (value === 'ByLayer') return 256;
  const m = typeof value === 'string' ? /^aci:(\d+)$/.exec(value) : null;
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 255 ? n : undefined;
}

const STANDARD_ACI = [0, 256, 1, 2, 3, 4, 5, 6, 7];

function colorOptions(current: number): PropertyOption[] {
  const list = STANDARD_ACI.includes(current) ? STANDARD_ACI : [...STANDARD_ACI, current];
  return list.map((n) => ({ value: aciValue(n), label: aciLabel(n) }));
}

function colorRow(name: string, label: string, section: DimvarSection): DimvarRow {
  return {
    name,
    label,
    section,
    kind: 'choice',
    color: true,
    options: (_, v) => colorOptions(asNumber(v[name])),
    get: (v) => aciValue(asNumber(v[name])),
    set: (value) => {
      const n = aciOf(value);
      return n === undefined ? undefined : { [name]: n };
    },
  };
}

/** AutoCAD's lineweights, hundredths of a millimetre; DIMLWD/DIMLWE −1 ByLayer, −2 ByBlock. */
const LINEWEIGHTS = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];
const WEIGHT_OPTIONS = opts([
  [-1, 'ByLayer'],
  [-2, 'ByBlock'],
  [-3, 'Default'],
  ...LINEWEIGHTS.map((w) => [w, `${(w / 100).toFixed(2)} mm`] as const),
]);

/** A DIMVAR linetype: a handle to one of the drawing's linetypes, absent read as ByBlock. */
function linetypeRow(name: string, label: string): DimvarRow {
  const records = (model: AnnotationTables) => [...model.tables.linetypes.values()];
  const byBlock = (model: AnnotationTables) =>
    records(model).find((l) => l.name.toUpperCase() === 'BYBLOCK')?.handle ?? '';
  return {
    name,
    label,
    section: 'Lines & Arrows',
    kind: 'choice',
    options: (model) => {
      const named = records(model).map((l) => ({ value: l.handle as string, label: l.name }));
      // ByLayer and ByBlock first, as AutoCAD lists them; the rest by name.
      const rank = (o: PropertyOption) => ['BYLAYER', 'BYBLOCK'].indexOf(o.label.toUpperCase());
      return named.sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        if (ra >= 0 || rb >= 0) return (ra < 0 ? 2 : ra) - (rb < 0 ? 2 : rb);
        return a.label.localeCompare(b.label);
      });
    },
    get: (v, model) => asHandle(v[name]) || byBlock(model),
    set: (value, _, model) =>
      typeof value === 'string' && model.tables.linetypes.has(value)
        ? { [name]: value }
        : undefined,
  };
}

// --- Arrowheads ------------------------------------------------------------------------------

/** AutoCAD's arrowhead blocks by name, with the Properties palette's names for them. */
const ARROWHEADS: Readonly<Record<string, string>> = {
  _CLOSEDBLANK: 'Closed blank',
  _CLOSED: 'Closed',
  _DOT: 'Dot',
  _ARCHTICK: 'Architectural tick',
  _OBLIQUE: 'Oblique',
  _OPEN: 'Open',
  _ORIGIN: 'Origin indicator',
  _ORIGIN2: 'Origin indicator 2',
  _OPEN90: 'Right angle',
  _OPEN30: 'Open 30',
  _DOTSMALL: 'Dot small',
  _DOTBLANK: 'Dot blank',
  _SMALL: 'Dot small blank',
  _BOXBLANK: 'Box',
  _BOXFILLED: 'Box filled',
  _DATUMBLANK: 'Datum triangle',
  _DATUMFILLED: 'Datum triangle filled',
  _INTEGRAL: 'Integral',
  _NONE: 'None',
};

/**
 * Arrowhead choices: closed filled (no block, value ''), then the drawing's arrowhead blocks by
 * AutoCAD's names and the blocks the objects use now (`current`), by label. AutoCAD makes a
 * missing arrowhead block when one is chosen; Triya offers the ones the drawing holds (authoring
 * the rest is left on the roadmap). A dimension's Arrow 1/2 and a multileader's Arrowhead.
 */
export function arrowheadOptions(
  model: Pick<AnnotationTables, 'blocks'>,
  current: readonly (string | undefined)[],
): PropertyOption[] {
  const out: PropertyOption[] = [{ value: '', label: 'Closed filled' }];
  for (const b of model.blocks.values()) {
    const known = ARROWHEADS[b.name.toUpperCase()];
    if (known || current.includes(b.handle)) out.push({ value: b.handle, label: known ?? b.name });
  }
  return out.sort((a, b) =>
    a.value === '' ? -1 : b.value === '' ? 1 : a.label.localeCompare(b.label),
  );
}

/** Arrow 1 and Arrow 2: each end's block (DIMBLK, or DIMBLK1/DIMBLK2 when DIMSAH is on). */
function arrowRow(end: 1 | 2): DimvarRow {
  const name = `DIMBLK${end}`;
  const other = `DIMBLK${end === 1 ? 2 : 1}`;
  const of = (v: Vars, n: string) => asHandle(v[asNumber(v.DIMSAH) !== 0 ? n : 'DIMBLK']);
  return {
    name,
    label: `Arrow ${end}`,
    section: 'Lines & Arrows',
    kind: 'choice',
    // Closed filled (no block), the drawing's arrowhead blocks, and the end's own block.
    options: (model, v) => arrowheadOptions(model, [of(v, 'DIMBLK1'), of(v, 'DIMBLK2')]),
    get: (v) => of(v, name),
    // AutoCAD's Arrow 1 sets DIMBLK1 and turns DIMSAH on, the other end keeping its block.
    // Closed filled is written as handle 0, which every reader takes as no block.
    set: (value, v, model) => {
      if (typeof value !== 'string' || (value !== '' && !model.blocks.has(value))) return undefined;
      if (value === of(v, name)) return {};
      return { DIMSAH: 1, [name]: value || '0', [other]: of(v, other) || '0' };
    },
  };
}

// --- Text ------------------------------------------------------------------------------------

/** Fill color: DIMTFILL 0 none, 1 the drawing's background, 2 DIMTFILLCLR. */
const fillRow: DimvarRow = {
  name: 'DIMTFILL',
  label: 'Fill color',
  section: 'Text',
  kind: 'choice',
  color: true,
  options: (_, v) => [
    { value: 'None', label: 'None' },
    { value: 'Background', label: 'Background' },
    ...colorOptions(asNumber(v.DIMTFILL) === 2 ? asNumber(v.DIMTFILLCLR) : 0),
  ],
  get: (v) => {
    const mode = asNumber(v.DIMTFILL);
    return mode === 1 ? 'Background' : mode === 2 ? aciValue(asNumber(v.DIMTFILLCLR)) : 'None';
  },
  set: (value) => {
    if (value === 'None') return { DIMTFILL: 0 };
    if (value === 'Background') return { DIMTFILL: 1 };
    const n = aciOf(value);
    return n === undefined ? undefined : { DIMTFILL: 2, DIMTFILLCLR: n };
  },
};

const textStyleRow: DimvarRow = {
  name: 'DIMTXSTY',
  label: 'Text style',
  section: 'Text',
  kind: 'choice',
  options: (model) =>
    [...model.tables.textStyles.values()]
      // Shape files are text style records too, without a name to choose.
      .filter((s) => s.name !== '')
      .map((s) => ({ value: s.handle as string, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  get: (v, model) => {
    const h = asHandle(v.DIMTXSTY);
    if (h) return h;
    // No style named: AutoCAD draws in Standard.
    for (const s of model.tables.textStyles.values()) {
      if (s.name.toUpperCase() === 'STANDARD') return s.handle;
    }
    return '';
  },
  set: (value, _, model) =>
    typeof value === 'string' && model.tables.textStyles.has(value)
      ? { DIMTXSTY: value }
      : undefined,
};

// --- Units -----------------------------------------------------------------------------------

const PRECISIONS = opts(
  Array.from({ length: 9 }, (_, i) => [i, i === 0 ? '0' : `0.${'0'.repeat(i)}`] as const),
);

const LINEAR_UNITS = opts([
  [1, 'Scientific'],
  [2, 'Decimal'],
  [3, 'Engineering'],
  [4, 'Architectural'],
  [5, 'Fractional'],
  [6, 'Windows Desktop'],
]);

/** DIMALTU's own numbering: the stacked forms are 4 and 5, plain ones 6 and 7. */
const ALT_UNITS = opts([
  [1, 'Scientific'],
  [2, 'Decimal'],
  [3, 'Engineering'],
  [4, 'Architectural stacked'],
  [5, 'Fractional stacked'],
  [6, 'Architectural'],
  [7, 'Fractional'],
  [8, 'Windows Desktop'],
]);

/** Decimal separator: a DIMSTYLE keeps the character, a DSTYLE override its code (DXF 278). */
const SEPARATORS = opts([
  ['.', "'.' Period"],
  [',', "',' Comma"],
  [' ', "' ' Space"],
]);

const separatorRow: DimvarRow = {
  name: 'DIMDSEP',
  label: 'Decimal separator',
  section: 'Primary Units',
  kind: 'choice',
  options: SEPARATORS,
  get: (v) => {
    const s = v.DIMDSEP;
    return typeof s === 'number' ? String.fromCharCode(s) : asString(s) || '.';
  },
  set: (value) =>
    SEPARATORS.some((o) => o.value === value)
      ? { DIMDSEP: String(value).charCodeAt(0) }
      : undefined,
};

/**
 * Dim prefix and Dim suffix (Alt prefix, Alt suffix): the text before and after `<>` (`[]` for
 * the alternate) in DIMPOST (DIMAPOST). Without the marker the whole is a suffix.
 */
function postRow(name: 'DIMPOST' | 'DIMAPOST', part: 'prefix' | 'suffix'): DimvarRow {
  const marker = name === 'DIMPOST' ? '<>' : '[]';
  const split = (s: string): [string, string] => {
    const at = s.indexOf(marker);
    return at < 0 ? ['', s] : [s.slice(0, at), s.slice(at + marker.length)];
  };
  const alt = name === 'DIMAPOST';
  return {
    name: `${name}.${part}`,
    label: `${alt ? 'Alt' : 'Dim'} ${part}`,
    section: alt ? 'Alternate Units' : 'Primary Units',
    kind: 'text',
    get: (v) => split(asString(v[name]))[part === 'prefix' ? 0 : 1],
    set: (value, v) => {
      if (typeof value !== 'string') return undefined;
      const [prefix, suffix] = split(asString(v[name]));
      const [p, s] = part === 'prefix' ? [value, suffix] : [prefix, value];
      return { [name]: p === '' ? s : `${p}${marker}${s}` };
    },
  };
}

/**
 * The Suppress rows: bits of DIMZIN (DIMALTZ, DIMTZIN, DIMALTTZ). 4 drops leading zeros, 8
 * trailing ones; the low two bits are a pair for feet and inches (0 drops zero feet and zero
 * inches, 1 keeps both, 2 keeps zero feet, 3 keeps zero inches).
 */
function suppressRow(
  name: string,
  label: string,
  section: DimvarSection,
  part: 'leading' | 'trailing' | 'feet' | 'inches',
): DimvarRow {
  const read = (z: number) => {
    const low = z & 3;
    return {
      leading: (z & 4) !== 0,
      trailing: (z & 8) !== 0,
      feet: low === 0 || low === 3,
      inches: low === 0 || low === 2,
    };
  };
  return {
    name: `${name}.${part}`,
    label,
    section,
    kind: 'choice',
    options: YES_NO,
    get: (v) => (read(asNumber(v[name]))[part] ? 'yes' : 'no'),
    set: (value, v) => {
      if (value !== 'yes' && value !== 'no') return undefined;
      const z = asNumber(v[name]);
      const s = { ...read(z), [part]: value === 'yes' };
      const low = s.feet ? (s.inches ? 0 : 3) : s.inches ? 2 : 1;
      return {
        [name]: (z & ~15) | (s.leading ? 4 : 0) | (s.trailing ? 8 : 0) | low,
      };
    },
  };
}

function suppressRows(name: string, prefix: string, section: DimvarSection): DimvarRow[] {
  const label = (s: string) => (prefix ? `${prefix} suppress ${s}` : `Suppress ${s}`);
  return [
    suppressRow(name, label('leading zeros'), section, 'leading'),
    suppressRow(name, label('trailing zeros'), section, 'trailing'),
    suppressRow(name, label('zero feet'), section, 'feet'),
    suppressRow(name, label('zero inches'), section, 'inches'),
  ];
}

// --- Tolerances ------------------------------------------------------------------------------

function toleranceDisplay(v: Vars): string {
  if (asNumber(v.DIMGAP) < 0) return 'basic';
  if (asNumber(v.DIMLIM) !== 0) return 'limits';
  if (asNumber(v.DIMTOL) === 0) return 'none';
  return asNumber(v.DIMTP) === asNumber(v.DIMTM) ? 'symmetrical' : 'deviation';
}

/**
 * Tolerance display: None, Symmetrical (DIMTOL with DIMTM = DIMTP), Deviation (DIMTOL),
 * Limits (DIMLIM) or Basic (a negative DIMGAP, which frames the text).
 */
const toleranceRow: DimvarRow = {
  name: 'DIMTOL',
  label: 'Tolerance display',
  section: 'Tolerances',
  kind: 'choice',
  options: opts([
    ['none', 'None'],
    ['symmetrical', 'Symmetrical'],
    ['deviation', 'Deviation'],
    ['limits', 'Limits'],
    ['basic', 'Basic'],
  ]),
  get: (v) => toleranceDisplay(v),
  set: (value, v) => {
    const gap = Math.abs(asNumber(v.DIMGAP));
    const off = { DIMTOL: 0, DIMLIM: 0, DIMGAP: gap };
    switch (value) {
      case 'none':
        return off;
      case 'symmetrical':
        // AutoCAD's Symmetrical shows one value: the lower limit follows the upper.
        return { ...off, DIMTOL: 1, DIMTM: asNumber(v.DIMTP) };
      case 'deviation':
        return { ...off, DIMTOL: 1 };
      case 'limits':
        return { ...off, DIMLIM: 1 };
      case 'basic':
        return { ...off, DIMGAP: -gap };
      default:
        return undefined;
    }
  },
};

/** Tolerance limit upper: under Symmetrical the lower limit is the same value. */
const upperRow: DimvarRow = {
  ...numberRow('DIMTP', 'Tolerance limit upper', 'Tolerances', 'distance', any),
  set: (value, v) => {
    const n = typed(value);
    if (n === undefined) return undefined;
    return toleranceDisplay(v) === 'symmetrical' ? { DIMTP: n, DIMTM: n } : { DIMTP: n };
  },
};

/** Text offset: DIMGAP, whose sign is the Basic tolerance display's frame. */
const gapRow: DimvarRow = {
  ...numberRow('DIMGAP', 'Text offset', 'Text', 'distance', nonNegative),
  get: (v) => Math.abs(asNumber(v.DIMGAP)),
  set: (value, v) => {
    const n = typed(value);
    if (n === undefined || n < 0) return undefined;
    return { DIMGAP: asNumber(v.DIMGAP) < 0 ? -n : n };
  },
};

// --- Angular units (M2-35 part 10) ----------------------------------------------------------

/**
 * Angle format: DIMAUNIT, named as the Dimension Style Manager's Angular Dimensions Units
 * format names them (surveyor's units, 4, are not offered for dimensions).
 */
const ANGLE_FORMATS = opts([
  [0, 'Decimal Degrees'],
  [1, 'Degrees Minutes Seconds'],
  [2, 'Gradians'],
  [3, 'Radians'],
]);

/** An angular dimension's Precision: DIMADEC, whose −1 takes DIMDEC (the linear precision). */
const anglePrecisionRow: DimvarRow = {
  ...choiceRow('DIMADEC', 'Precision', 'Primary Units', PRECISIONS),
  for: 'angular',
  get: (v) => String(asNumber(v.DIMADEC) < 0 ? asNumber(v.DIMDEC) : asNumber(v.DIMADEC)),
};

/** DIMAZIN: 1 drops leading zeros, 2 trailing ones. */
function angleSuppressRow(part: 'leading' | 'trailing'): DimvarRow {
  const bit = part === 'leading' ? 1 : 2;
  return {
    name: `DIMAZIN.${part}`,
    label: `Suppress ${part} zeros`,
    section: 'Primary Units',
    for: 'angular',
    kind: 'choice',
    options: YES_NO,
    get: (v) => ((asNumber(v.DIMAZIN) & bit) !== 0 ? 'yes' : 'no'),
    set: (value, v) => {
      if (value !== 'yes' && value !== 'no') return undefined;
      const z = asNumber(v.DIMAZIN) & ~bit;
      return { DIMAZIN: value === 'yes' ? z | bit : z };
    },
  };
}

/** The row for the linear dimensions only. */
const linearOnly = (r: DimvarRow): DimvarRow => ({ ...r, for: 'linear' });

/**
 * Every DIMVAR row, in AutoCAD 2024's order within each group. AutoCAD's help does not list an
 * angular dimension's rows; they are its ActiveX AcadDimAngular properties (AngleFormat,
 * TextPrecision as DIMADEC, SuppressLeadingZeros and SuppressTrailingZeros as DIMAZIN, no
 * alternate units, no linear units or scale), in the places of the linear ones they replace.
 */
export const DIMVAR_ROWS: readonly DimvarRow[] = [
  arrowRow(1),
  arrowRow(2),
  numberRow('DIMASZ', 'Arrow size', 'Lines & Arrows', 'distance', nonNegative),
  choiceRow('DIMLWD', 'Dim line lineweight', 'Lines & Arrows', WEIGHT_OPTIONS),
  choiceRow('DIMLWE', 'Ext line lineweight', 'Lines & Arrows', WEIGHT_OPTIONS),
  onOffRow('DIMSD1', 'Dim line 1', 'Lines & Arrows', true),
  onOffRow('DIMSD2', 'Dim line 2', 'Lines & Arrows', true),
  colorRow('DIMCLRD', 'Dim line color', 'Lines & Arrows'),
  linetypeRow('DIMLTYPE', 'Dim line linetype'),
  numberRow('DIMDLE', 'Dim line ext', 'Lines & Arrows', 'distance', nonNegative),
  linetypeRow('DIMLTEX1', 'Ext line 1 linetype'),
  linetypeRow('DIMLTEX2', 'Ext line 2 linetype'),
  onOffRow('DIMSE1', 'Ext line 1', 'Lines & Arrows', true),
  onOffRow('DIMSE2', 'Ext line 2', 'Lines & Arrows', true),
  onOffRow('DIMFXLON', 'Ext line fixed', 'Lines & Arrows'),
  numberRow('DIMFXL', 'Ext line fixed length', 'Lines & Arrows', 'distance', nonNegative),
  colorRow('DIMCLRE', 'Ext line color', 'Lines & Arrows'),
  numberRow('DIMEXE', 'Ext line ext', 'Lines & Arrows', 'distance', nonNegative),
  numberRow('DIMEXO', 'Ext line offset', 'Lines & Arrows', 'distance', nonNegative),

  fillRow,
  choiceRow(
    'DIMFRAC',
    'Fraction type',
    'Text',
    opts([
      [0, 'Horizontal'],
      [1, 'Diagonal'],
      [2, 'Not stacked'],
    ]),
  ),
  colorRow('DIMCLRT', 'Text color', 'Text'),
  numberRow('DIMTXT', 'Text height', 'Text', 'distance', positive),
  gapRow,
  onOffRow('DIMTOH', 'Text outside align', 'Text'),
  choiceRow(
    'DIMJUST',
    'Text pos hor',
    'Text',
    opts([
      [0, 'Centered'],
      [1, 'At Ext Line 1'],
      [2, 'At Ext Line 2'],
      [3, 'Over Ext Line 1'],
      [4, 'Over Ext Line 2'],
    ]),
  ),
  choiceRow(
    'DIMTAD',
    'Text pos vert',
    'Text',
    opts([
      [0, 'Centered'],
      [1, 'Above'],
      [2, 'Outside'],
      [3, 'JIS'],
      [4, 'Below'],
    ]),
  ),
  textStyleRow,
  onOffRow('DIMTIH', 'Text inside align', 'Text'),

  onOffRow('DIMTOFL', 'Dim line forced', 'Fit'),
  onOffRow('DIMSOXD', 'Dim line inside', 'Fit'),
  numberRow('DIMSCALE', 'Dim scale overall', 'Fit', 'number', nonNegative),
  choiceRow(
    'DIMATFIT',
    'Fit',
    'Fit',
    opts([
      [0, 'Both text and arrows'],
      [1, 'Arrows'],
      [2, 'Text'],
      [3, 'Best fit'],
    ]),
  ),
  onOffRow('DIMTIX', 'Text inside', 'Fit'),
  choiceRow(
    'DIMTMOVE',
    'Text movement',
    'Fit',
    opts([
      [0, 'Keep dim line with text'],
      [1, 'Move text, add leader'],
      [2, 'Move text, no leader'],
    ]),
  ),

  separatorRow,
  postRow('DIMPOST', 'prefix'),
  postRow('DIMPOST', 'suffix'),
  ...[
    numberRow('DIMRND', 'Dim roundoff', 'Primary Units', 'distance', nonNegative),
    numberRow('DIMLFAC', 'Dim scale linear', 'Primary Units', 'number', (n) => n !== 0),
    choiceRow('DIMLUNIT', 'Dim units', 'Primary Units', LINEAR_UNITS),
    ...suppressRows('DIMZIN', '', 'Primary Units'),
    choiceRow('DIMDEC', 'Precision', 'Primary Units', PRECISIONS),
  ].map(linearOnly),
  { ...choiceRow('DIMAUNIT', 'Angle format', 'Primary Units', ANGLE_FORMATS), for: 'angular' },
  angleSuppressRow('leading'),
  angleSuppressRow('trailing'),
  anglePrecisionRow,

  ...[
    onOffRow('DIMALT', 'Alt enabled', 'Alternate Units'),
    choiceRow('DIMALTU', 'Alt format', 'Alternate Units', ALT_UNITS),
    choiceRow('DIMALTD', 'Alt precision', 'Alternate Units', PRECISIONS),
    numberRow('DIMALTF', 'Alt multiplier', 'Alternate Units', 'number', positive),
    postRow('DIMAPOST', 'prefix'),
    postRow('DIMAPOST', 'suffix'),
    numberRow('DIMALTRND', 'Alt round', 'Alternate Units', 'distance', nonNegative),
    ...suppressRows('DIMALTZ', 'Alt', 'Alternate Units'),
  ].map(linearOnly),

  toleranceRow,
  numberRow('DIMTM', 'Tolerance limit lower', 'Tolerances', 'distance', any),
  upperRow,
  choiceRow(
    'DIMTOLJ',
    'Tolerance pos vert',
    'Tolerances',
    opts([
      [0, 'Bottom'],
      [1, 'Middle'],
      [2, 'Top'],
    ]),
  ),
  choiceRow('DIMTDEC', 'Tolerance precision', 'Tolerances', PRECISIONS),
  // An angle's tolerance drops zeros by DIMTZIN's leading and trailing bits only (feet and
  // inches are lengths), and has no alternate units.
  ...suppressRows('DIMTZIN', 'Tolerance', 'Tolerances').map((r, i) => (i < 2 ? r : linearOnly(r))),
  numberRow('DIMTFAC', 'Tolerance text height', 'Tolerances', 'number', positive),
  ...[
    choiceRow('DIMALTTD', 'Alt tolerance precision', 'Tolerances', PRECISIONS),
    ...suppressRows('DIMALTTZ', 'Alt tolerance', 'Tolerances'),
  ].map(linearOnly),
];
