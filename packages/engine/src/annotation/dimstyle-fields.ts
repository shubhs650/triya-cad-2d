// The New, Modify and Override Dimension Style dialog's fields (M4-03), tab by tab with AutoCAD
// 2024's groups and labels (AutoCAD Help, "Lines Tab", "Symbols and Arrows Tab", "Text Tab",
// "Fit Tab", "Primary Units Tab", "Alternate Units Tab" and "Tolerances Tab" of the "New,
// Modify, and Override Dimension Style Dialog Boxes"). Each field reads the DIMVARs of the style
// being edited and gives the DIMVARs a typed or chosen value sets; a field may set several, as
// AutoCAD's do: First arrowhead sets DIMBLK (and the Second to match), Tolerance Method DIMTOL,
// DIMLIM, DIMTM and DIMGAP's sign, Prefix and Suffix the two halves of DIMPOST.
//
// The DIMVARs are AutoCAD's DIMSTYLE reference:
// https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-F2FAD36F-0CE3-4943-9DAD-A9BCD2AE81DA
//
// What the dialog has but a DIMSTYLE record has no group for (Dimension Break's break size,
// Linear Jog's height factor, the sub-units factor and suffix, Tolerance Alignment) is AutoCAD's
// `ACAD_DSTYLE_*` xdata on the record (part 2, dimstyle-xdata.ts): the fields set them under the
// names DIMBREAK, DIMJAG, DIMMZF, DIMMZS, DIMALTMZF, DIMALTMZS and DIMTALN, which the command
// writes there. Annotative is shown and never set (DEC-013, DEC-058). DIMTVP and DIMTSZ are not in AutoCAD's dialog either; the dialog keeps them as they
// were (SETVAR and -DIMSTYLE set them).
import type { DimVarValue } from '../model/types';
import { parseNumber } from '../commands/parse';
import { lineweightText, type LineweightUnits } from '../commands/lweight';
import { DIMVAR_DEFAULTS } from '../properties/dimension';
import { DIMSTYLE_XDATA_DEFAULTS } from './dimstyle-xdata';

export type DimStyleVars = Readonly<Record<string, DimVarValue>>;

export type DimStyleTab =
  'lines' | 'symbols' | 'text' | 'fit' | 'primary' | 'alternate' | 'tolerances';

/** The dialog's tabs, in AutoCAD's order. */
export const DIMSTYLE_TABS: readonly { readonly id: DimStyleTab; readonly label: string }[] = [
  { id: 'lines', label: 'Lines' },
  { id: 'symbols', label: 'Symbols and Arrows' },
  { id: 'text', label: 'Text' },
  { id: 'fit', label: 'Fit' },
  { id: 'primary', label: 'Primary Units' },
  { id: 'alternate', label: 'Alternate Units' },
  { id: 'tolerances', label: 'Tolerances' },
];

export interface DimStyleOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The drawing's records a field may name: text styles (DIMTXSTY), linetypes (DIMLTYPE,
 * DIMLTEX1/2, ByBlock among them) and arrowheads (DIMBLK…: `''` closed filled, a block's handle,
 * or the `_NAME` of an AutoCAD arrowhead the drawing lacks, which the command adds).
 */
export interface DimStyleLists {
  readonly textStyles: readonly DimStyleOption[];
  readonly linetypes: readonly DimStyleOption[];
  readonly arrowheads: readonly DimStyleOption[];
  /**
   * The units LWUNITS lists lineweights in (M5-12), which the app knows and hands in with the
   * engine's lists; millimetres when it does not say.
   */
  readonly lineweightUnits?: LineweightUnits;
}

export type DimStyleFieldValue = string | number | boolean;

export interface DimStyleField {
  /** Unique within the dialog; the DIMVAR it shows, or `NAME.part`. */
  readonly key: string;
  readonly tab: DimStyleTab;
  readonly group: string;
  readonly label: string;
  /**
   * `choice` a list, `radio` buttons, `number` a typed number (`degrees`: shown in degrees),
   * `check` a check box, `text` typed text.
   */
  readonly kind: 'choice' | 'radio' | 'number' | 'check' | 'text';
  readonly options?:
    readonly DimStyleOption[] | ((lists: DimStyleLists, v: DimStyleVars) => DimStyleOption[]);
  /** The DIMVARs the field reads and sets. */
  readonly vars: readonly string[];
  readonly get: (v: DimStyleVars) => DimStyleFieldValue;
  /** The DIMVARs `value` sets, or undefined when the field cannot take it. */
  readonly set: (value: DimStyleFieldValue, v: DimStyleVars) => DimStyleVars | undefined;
  /** Whether the field can be changed now (AutoCAD greys it out otherwise). */
  readonly enabled?: ((v: DimStyleVars) => boolean) | undefined;
}

/**
 * The DIMVARs AutoCAD's acad.dwt Standard holds, for a style that does not state one: the
 * Properties palette's (`DIMVAR_DEFAULTS`) and the rest `@triya/dims` draws with.
 */
export const DIMSTYLE_DEFAULTS: DimStyleVars = {
  ...DIMVAR_DEFAULTS,
  DIMDLI: 0.38,
  DIMCEN: 0.09,
  DIMTSZ: 0,
  DIMTVP: 0,
  DIMJOGANG: Math.PI / 4,
  DIMARCSYM: 0,
  DIMUPT: 0,
};

/** The reference DIMVARs: a handle, absent for the default (closed filled, ByBlock). */
export const DIMSTYLE_REFERENCES: ReadonlySet<string> = new Set([
  'DIMTXSTY',
  'DIMBLK',
  'DIMBLK1',
  'DIMBLK2',
  'DIMLDRBLK',
  'DIMLTYPE',
  'DIMLTEX1',
  'DIMLTEX2',
]);

const num = (v: DimVarValue | undefined): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
const on = (v: DimVarValue | undefined): boolean => num(v) !== 0;
const str = (v: DimVarValue | undefined): string => (typeof v === 'string' ? v : '');
/** A reference DIMVAR: absent, empty and `0` all name nothing. */
const handle = (v: DimVarValue | undefined): string =>
  typeof v === 'string' && v !== '0' ? v : '';

/** A typed number, as the command line parses one. */
function typed(v: DimStyleFieldValue): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  return parseNumber(v.trim());
}

const opts = (pairs: readonly (readonly [number | string, string])[]): DimStyleOption[] =>
  pairs.map(([value, label]) => ({ value: String(value), label }));

type FieldBase = Pick<DimStyleField, 'tab' | 'group' | 'label'> & {
  readonly enabled?: DimStyleField['enabled'];
};

function numberField(
  name: string,
  at: FieldBase,
  takes: (n: number) => boolean = (n) => n >= 0,
): DimStyleField {
  return {
    key: name,
    ...at,
    kind: 'number',
    vars: [name],
    get: (v) => num(v[name]),
    set: (value) => {
      const n = typed(value);
      return n !== undefined && takes(n) ? { [name]: n } : undefined;
    },
  };
}

function choiceField(
  name: string,
  at: FieldBase,
  options: readonly DimStyleOption[] | ((l: DimStyleLists) => DimStyleOption[]),
  kind: 'choice' | 'radio' = 'choice',
): DimStyleField {
  // A list's labels may follow the lists (the lineweights' units), never its values.
  const values =
    typeof options === 'function'
      ? options({ textStyles: [], linetypes: [], arrowheads: [] })
      : options;
  return {
    key: name,
    ...at,
    kind,
    options,
    vars: [name],
    get: (v) => String(num(v[name])),
    set: (value) =>
      values.some((o) => o.value === String(value)) ? { [name]: Number(value) } : undefined,
  };
}

/** A check box; `suppress` for a DIMVAR that is on when the box says the part is drawn. */
function checkField(name: string, at: FieldBase): DimStyleField {
  return {
    key: name,
    ...at,
    kind: 'check',
    vars: [name],
    get: (v) => on(v[name]),
    set: (value) => (typeof value === 'boolean' ? { [name]: Number(value) } : undefined),
  };
}

// --- Colours, linetypes, lineweights -----------------------------------------------------------

const ACI_NAMES = ['', 'Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'];

const aciLabel = (n: number): string =>
  n === 0 ? 'ByBlock' : n === 256 ? 'ByLayer' : (ACI_NAMES[n] ?? `Color ${n}`);

const STANDARD_ACI = [0, 256, 1, 2, 3, 4, 5, 6, 7];

/** ByBlock, ByLayer, the seven named colours and `current` when it is another ACI. */
function colorOptions(current: number): DimStyleOption[] {
  const list = STANDARD_ACI.includes(current) ? STANDARD_ACI : [...STANDARD_ACI, current];
  return list.map((n) => ({ value: String(n), label: aciLabel(n) }));
}

const aciOf = (value: DimStyleFieldValue): number | undefined => {
  const n = typed(value);
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 256 ? n : undefined;
};

function colorField(name: string, at: FieldBase): DimStyleField {
  return {
    key: name,
    ...at,
    kind: 'choice',
    options: (_, v) => colorOptions(num(v[name])),
    vars: [name],
    get: (v) => String(num(v[name])),
    set: (value) => {
      const n = aciOf(value);
      return n === undefined ? undefined : { [name]: n };
    },
  };
}

/** AutoCAD's lineweights, hundredths of a millimetre; −1 ByLayer, −2 ByBlock. */
const LINEWEIGHTS = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];
/** ByBlock, ByLayer, Default and AutoCAD's lineweights, listed in LWUNITS' units (M5-12). */
const weightOptions = (l: DimStyleLists): DimStyleOption[] =>
  opts([
    [-2, 'ByBlock'],
    [-1, 'ByLayer'],
    [-3, 'Default'],
    ...LINEWEIGHTS.map((w) => [w, lineweightText(w, l.lineweightUnits)] as const),
  ]);

/** A reference DIMVAR chosen from one of the drawing's lists (`''`: the default). */
function referenceField(
  name: string,
  at: FieldBase,
  list: (l: DimStyleLists) => readonly DimStyleOption[],
): DimStyleField {
  return {
    key: name,
    ...at,
    kind: 'choice',
    options: (l) => [...list(l)],
    vars: [name],
    get: (v) => handle(v[name]),
    set: (value) => (typeof value === 'string' ? { [name]: value } : undefined),
  };
}

// --- Lines --------------------------------------------------------------------------------------

const dimLines = { tab: 'lines', group: 'Dimension lines' } as const;
const extLines = { tab: 'lines', group: 'Extension lines' } as const;

const LINES: DimStyleField[] = [
  colorField('DIMCLRD', { ...dimLines, label: 'Color' }),
  referenceField('DIMLTYPE', { ...dimLines, label: 'Linetype' }, (l) => l.linetypes),
  choiceField('DIMLWD', { ...dimLines, label: 'Lineweight' }, weightOptions),
  numberField('DIMDLE', { ...dimLines, label: 'Extend beyond ticks' }),
  numberField('DIMDLI', { ...dimLines, label: 'Baseline spacing' }),
  checkField('DIMSD1', { ...dimLines, label: 'Suppress: Dim line 1' }),
  checkField('DIMSD2', { ...dimLines, label: 'Suppress: Dim line 2' }),
  colorField('DIMCLRE', { ...extLines, label: 'Color' }),
  referenceField('DIMLTEX1', { ...extLines, label: 'Linetype ext line 1' }, (l) => l.linetypes),
  referenceField('DIMLTEX2', { ...extLines, label: 'Linetype ext line 2' }, (l) => l.linetypes),
  choiceField('DIMLWE', { ...extLines, label: 'Lineweight' }, weightOptions),
  checkField('DIMSE1', { ...extLines, label: 'Suppress: Ext line 1' }),
  checkField('DIMSE2', { ...extLines, label: 'Suppress: Ext line 2' }),
  numberField('DIMEXE', { ...extLines, label: 'Extend beyond dim lines' }),
  numberField('DIMEXO', { ...extLines, label: 'Offset from origin' }),
  checkField('DIMFXLON', { ...extLines, label: 'Fixed length extension lines' }),
  numberField('DIMFXL', {
    ...extLines,
    label: 'Length',
    enabled: (v) => on(v.DIMFXLON),
  }),
];

// --- Symbols and Arrows -------------------------------------------------------------------------

const arrows = { tab: 'symbols', group: 'Arrowheads' } as const;

/** Each end's arrowhead: DIMBLK, or DIMBLK1/DIMBLK2 when DIMSAH is on. */
const endBlock = (v: DimStyleVars, end: 1 | 2): string =>
  handle(v[on(v.DIMSAH) ? `DIMBLK${end}` : 'DIMBLK']);

/**
 * First and Second: AutoCAD's First sets both ends (DIMBLK, DIMSAH off); a Second unlike the
 * First turns DIMSAH on with DIMBLK1 and DIMBLK2 each end's.
 */
function arrowField(end: 1 | 2): DimStyleField {
  return {
    key: `DIMBLK${end}`,
    ...arrows,
    label: end === 1 ? 'First' : 'Second',
    kind: 'choice',
    options: (l) => [...l.arrowheads],
    vars: ['DIMBLK', 'DIMBLK1', 'DIMBLK2', 'DIMSAH'],
    get: (v) => endBlock(v, end),
    set: (value, v) => {
      if (typeof value !== 'string') return undefined;
      const first = end === 1 ? value : endBlock(v, 1);
      if (first === value) return { DIMBLK: value, DIMSAH: 0 };
      return { DIMBLK1: first, DIMBLK2: value, DIMSAH: 1 };
    },
  };
}

const centers = { tab: 'symbols', group: 'Center marks' } as const;

const CENTER_TYPES = opts([
  ['none', 'None'],
  ['mark', 'Mark'],
  ['line', 'Line'],
]);

/** DIMCEN: 0 none, positive a mark of that size, negative a mark and lines. */
const centerType: DimStyleField = {
  key: 'DIMCEN.type',
  ...centers,
  label: 'Center marks',
  kind: 'radio',
  options: CENTER_TYPES,
  vars: ['DIMCEN'],
  get: (v) => {
    const c = num(v.DIMCEN);
    return c === 0 ? 'none' : c > 0 ? 'mark' : 'line';
  },
  set: (value, v) => {
    // A mark brought back from None takes AutoCAD's default, half the arrow size.
    const size = Math.abs(num(v.DIMCEN)) || num(v.DIMASZ) / 2 || 0.09;
    if (value === 'none') return { DIMCEN: 0 };
    if (value === 'mark') return { DIMCEN: size };
    if (value === 'line') return { DIMCEN: -size };
    return undefined;
  },
};

const centerSize: DimStyleField = {
  key: 'DIMCEN.size',
  ...centers,
  label: 'Size',
  kind: 'number',
  vars: ['DIMCEN'],
  enabled: (v) => num(v.DIMCEN) !== 0,
  get: (v) => Math.abs(num(v.DIMCEN)),
  set: (value, v) => {
    const n = typed(value);
    if (n === undefined || !(n > 0)) return undefined;
    return { DIMCEN: num(v.DIMCEN) < 0 ? -n : n };
  },
};

const jogAngle: DimStyleField = {
  key: 'DIMJOGANG',
  tab: 'symbols',
  group: 'Radius jog dimension',
  label: 'Jog angle',
  kind: 'number',
  vars: ['DIMJOGANG'],
  get: (v) => Number(((num(v.DIMJOGANG) * 180) / Math.PI).toPrecision(12)),
  // AutoCAD takes 5° to 90°.
  set: (value) => {
    const n = typed(value);
    return n !== undefined && n >= 5 && n <= 90 ? { DIMJOGANG: (n * Math.PI) / 180 } : undefined;
  },
};

const SYMBOLS: DimStyleField[] = [
  arrowField(1),
  arrowField(2),
  referenceField('DIMLDRBLK', { ...arrows, label: 'Leader' }, (l) => l.arrowheads),
  numberField('DIMASZ', { ...arrows, label: 'Arrow size' }),
  centerType,
  centerSize,
  choiceField(
    'DIMARCSYM',
    { tab: 'symbols', group: 'Arc length symbol', label: 'Arc length symbol' },
    opts([
      [0, 'Preceding dimension text'],
      [1, 'Above dimension text'],
      [2, 'None'],
    ]),
    'radio',
  ),
  jogAngle,
  numberField('DIMBREAK', { tab: 'symbols', group: 'Dimension Break', label: 'Break size' }),
  // AutoCAD's "Jog height factor: <n> * Text height".
  numberField(
    'DIMJAG',
    { tab: 'symbols', group: 'Linear jog dimension', label: 'Jog height factor' },
    (n) => n > 0,
  ),
];

// --- Text ---------------------------------------------------------------------------------------

const appearance = { tab: 'text', group: 'Text appearance' } as const;
const placement = { tab: 'text', group: 'Text placement' } as const;

/** Fill color: DIMTFILL 0 none, 1 the drawing's background, 2 DIMTFILLCLR. */
const fillField: DimStyleField = {
  key: 'DIMTFILL',
  ...appearance,
  label: 'Fill color',
  kind: 'choice',
  options: (_, v) => [
    { value: 'none', label: 'None' },
    { value: 'background', label: 'Background' },
    ...colorOptions(num(v.DIMTFILL) === 2 ? num(v.DIMTFILLCLR) : 0),
  ],
  vars: ['DIMTFILL', 'DIMTFILLCLR'],
  get: (v) => {
    const mode = num(v.DIMTFILL);
    return mode === 1 ? 'background' : mode === 2 ? String(num(v.DIMTFILLCLR)) : 'none';
  },
  set: (value) => {
    if (value === 'none') return { DIMTFILL: 0 };
    if (value === 'background') return { DIMTFILL: 1 };
    const n = aciOf(value);
    return n === undefined ? undefined : { DIMTFILL: 2, DIMTFILLCLR: n };
  },
};

/** A fraction's text height scale is used by Architectural and Fractional units only. */
const fractional = (v: DimStyleVars) => [4, 5].includes(num(v.DIMLUNIT));

/** Draw frame around text: a negative DIMGAP (Tolerances' Basic method says the same). */
const frameField: DimStyleField = {
  key: 'DIMGAP.frame',
  ...appearance,
  label: 'Draw frame around text',
  kind: 'check',
  vars: ['DIMGAP'],
  get: (v) => num(v.DIMGAP) < 0,
  set: (value, v) =>
    typeof value === 'boolean' ? { DIMGAP: Math.abs(num(v.DIMGAP)) * (value ? -1 : 1) } : undefined,
};

const gapField: DimStyleField = {
  key: 'DIMGAP',
  ...placement,
  label: 'Offset from dim line',
  kind: 'number',
  vars: ['DIMGAP'],
  get: (v) => Math.abs(num(v.DIMGAP)),
  set: (value, v) => {
    const n = typed(value);
    return n !== undefined && n >= 0 ? { DIMGAP: num(v.DIMGAP) < 0 ? -n : n } : undefined;
  },
};

/** Text alignment: DIMTIH and DIMTOH both on (Horizontal), both off (Aligned), or ISO. */
const alignmentField: DimStyleField = {
  key: 'DIMTIH.alignment',
  tab: 'text',
  group: 'Text alignment',
  label: 'Text alignment',
  kind: 'radio',
  options: opts([
    ['horizontal', 'Horizontal'],
    ['aligned', 'Aligned with dimension line'],
    ['iso', 'ISO standard'],
  ]),
  vars: ['DIMTIH', 'DIMTOH'],
  get: (v) => (on(v.DIMTIH) ? 'horizontal' : on(v.DIMTOH) ? 'iso' : 'aligned'),
  set: (value) => {
    if (value === 'horizontal') return { DIMTIH: 1, DIMTOH: 1 };
    if (value === 'aligned') return { DIMTIH: 0, DIMTOH: 0 };
    if (value === 'iso') return { DIMTIH: 0, DIMTOH: 1 };
    return undefined;
  },
};

const TEXT: DimStyleField[] = [
  referenceField('DIMTXSTY', { ...appearance, label: 'Text style' }, (l) => l.textStyles),
  colorField('DIMCLRT', { ...appearance, label: 'Text color' }),
  fillField,
  numberField('DIMTXT', { ...appearance, label: 'Text height' }, (n) => n > 0),
  numberField(
    'DIMTFAC',
    { ...appearance, label: 'Fraction height scale', enabled: fractional },
    (n) => n > 0,
  ),
  frameField,
  choiceField(
    'DIMTAD',
    { ...placement, label: 'Vertical' },
    opts([
      [0, 'Centered'],
      [1, 'Above'],
      [2, 'Outside'],
      [3, 'JIS'],
      [4, 'Below'],
    ]),
  ),
  choiceField(
    'DIMJUST',
    { ...placement, label: 'Horizontal' },
    opts([
      [0, 'Centered'],
      [1, 'At Ext Line 1'],
      [2, 'At Ext Line 2'],
      [3, 'Over Ext Line 1'],
      [4, 'Over Ext Line 2'],
    ]),
  ),
  choiceField(
    'DIMTXTDIRECTION',
    { ...placement, label: 'View Direction' },
    opts([
      [0, 'Left-to-Right'],
      [1, 'Right-to-Left'],
    ]),
  ),
  gapField,
  alignmentField,
];

// --- Fit ----------------------------------------------------------------------------------------

/**
 * Fit options: what moves outside the extension lines first (DIMATFIT), or Always keep text
 * between ext lines (DIMTIX on).
 */
const fitField: DimStyleField = {
  key: 'DIMATFIT',
  tab: 'fit',
  group: 'Fit options',
  label: 'Fit options',
  kind: 'radio',
  options: opts([
    [3, 'Either text or arrows (best fit)'],
    [1, 'Arrows'],
    [2, 'Text'],
    [0, 'Both text and arrows'],
    ['tix', 'Always keep text between ext lines'],
  ]),
  vars: ['DIMATFIT', 'DIMTIX'],
  get: (v) => (on(v.DIMTIX) ? 'tix' : String(num(v.DIMATFIT))),
  set: (value) => {
    if (value === 'tix') return { DIMTIX: 1 };
    return ['0', '1', '2', '3'].includes(String(value))
      ? { DIMATFIT: Number(value), DIMTIX: 0 }
      : undefined;
  },
};

/**
 * Scale for dimension features: Scale dimensions to layout is DIMSCALE 0; Use overall scale of
 * any other. Annotative is shown and never set (DEC-013, DEC-058).
 */
const scaleTypeField: DimStyleField = {
  key: 'DIMSCALE.type',
  tab: 'fit',
  group: 'Scale for dimension features',
  label: 'Scale for dimension features',
  kind: 'radio',
  options: opts([
    ['layout', 'Scale dimensions to layout'],
    ['overall', 'Use overall scale of'],
  ]),
  vars: ['DIMSCALE'],
  get: (v) => (num(v.DIMSCALE) === 0 ? 'layout' : 'overall'),
  set: (value, v) => {
    if (value === 'layout') return { DIMSCALE: 0 };
    if (value === 'overall') return { DIMSCALE: num(v.DIMSCALE) || 1 };
    return undefined;
  },
};

const FIT: DimStyleField[] = [
  fitField,
  checkField('DIMSOXD', {
    tab: 'fit',
    group: 'Fit options',
    label: "Suppress arrows if they don't fit inside extension lines",
  }),
  choiceField(
    'DIMTMOVE',
    { tab: 'fit', group: 'Text placement', label: 'Text placement' },
    opts([
      [0, 'Beside the dimension line'],
      [1, 'Over dimension line, with leader'],
      [2, 'Over dimension line, without leader'],
    ]),
    'radio',
  ),
  scaleTypeField,
  numberField(
    'DIMSCALE',
    {
      tab: 'fit',
      group: 'Scale for dimension features',
      label: 'Overall scale',
      enabled: (v) => num(v.DIMSCALE) !== 0,
    },
    (n) => n > 0,
  ),
  checkField('DIMUPT', { tab: 'fit', group: 'Fine tuning', label: 'Place text manually' }),
  checkField('DIMTOFL', {
    tab: 'fit',
    group: 'Fine tuning',
    label: 'Draw dim line between ext lines',
  }),
];

// --- Units --------------------------------------------------------------------------------------

/** Precision as AutoCAD lists it for the unit format: decimal places, or a fraction's size. */
function precisionOptions(format: number, fractions: boolean): DimStyleOption[] {
  return Array.from({ length: 9 }, (_, i) => {
    if (fractions) return { value: String(i), label: i === 0 ? '0' : `0 1/${2 ** i}` };
    const places = i === 0 ? '0' : `0.${'0'.repeat(i)}`;
    return { value: String(i), label: format === 1 ? `${places}E+01` : places };
  });
}

function precisionField(
  name: string,
  at: FieldBase,
  formatOf: (v: DimStyleVars) => { format: number; fractions: boolean },
): DimStyleField {
  return {
    key: name,
    ...at,
    kind: 'choice',
    options: (_, v) => {
      const f = formatOf(v);
      return precisionOptions(f.format, f.fractions);
    },
    vars: [name],
    get: (v) => String(num(v[name])),
    set: (value) => {
      const n = typed(value);
      return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 8 ? { [name]: n } : undefined;
    },
  };
}

/**
 * Prefix or Suffix: the text before or after the measurement's place in DIMPOST (`<>`) or
 * DIMAPOST (`[]`); a value without the marker is all suffix. DIMAPOST's leading `\X` (Below
 * primary value) is kept off both halves.
 */
function affixField(
  name: 'DIMPOST' | 'DIMAPOST',
  part: 'prefix' | 'suffix',
  at: Omit<FieldBase, 'label'>,
) {
  const marker = name === 'DIMPOST' ? '<>' : '[]';
  const below = (s: string) => (name === 'DIMAPOST' && s.startsWith('\\X') ? '\\X' : '');
  const split = (v: DimStyleVars): [string, string, string] => {
    const s = str(v[name]);
    const lead = below(s);
    const rest = s.slice(lead.length);
    const at = rest.indexOf(marker);
    return at < 0 ? [lead, '', rest] : [lead, rest.slice(0, at), rest.slice(at + 2)];
  };
  return {
    key: `${name}.${part}`,
    ...at,
    label: part === 'prefix' ? 'Prefix' : 'Suffix',
    kind: 'text',
    vars: [name],
    get: (v) => split(v)[part === 'prefix' ? 1 : 2],
    set: (value, v) => {
      if (typeof value !== 'string') return undefined;
      const [lead, prefix, suffix] = split(v);
      const [p, s] = part === 'prefix' ? [value, suffix] : [prefix, value];
      return { [name]: lead + (p === '' ? s : `${p}${marker}${s}`) };
    },
  } satisfies DimStyleField;
}

/**
 * Zero suppression for a DIMZIN-like variable: bit 4 leading, bit 8 trailing; its low bits 0–3
 * say whether zero feet and zero inches are left out (0 both, 1 neither, 2 inches, 3 feet).
 */
function zeroField(
  name: string,
  part: 'leading' | 'trailing' | 'feet' | 'inches',
  at: Omit<FieldBase, 'label'>,
): DimStyleField {
  const label = { leading: 'Leading', trailing: 'Trailing', feet: '0 feet', inches: '0 inches' };
  const bit = part === 'leading' ? 4 : 8;
  const feetInches = (low: number) => [low === 0 || low === 3, low === 0 || low === 2];
  return {
    key: `${name}.${part}`,
    ...at,
    label: label[part],
    kind: 'check',
    vars: [name],
    get: (v) => {
      const z = num(v[name]);
      if (part === 'leading' || part === 'trailing') return (z & bit) !== 0;
      const [feet, inches] = feetInches(z & 3);
      return part === 'feet' ? feet! : inches!;
    },
    set: (value, v) => {
      if (typeof value !== 'boolean') return undefined;
      const z = num(v[name]);
      if (part === 'leading' || part === 'trailing') {
        return { [name]: value ? z | bit : z & ~bit };
      }
      let [feet, inches] = feetInches(z & 3) as [boolean, boolean];
      if (part === 'feet') feet = value;
      else inches = value;
      const low = feet ? (inches ? 0 : 3) : inches ? 2 : 1;
      return { [name]: (z & ~3) | low };
    },
  };
}

/**
 * Sub-units factor and Sub-unit suffix, which AutoCAD offers once Leading zeros are suppressed:
 * a distance under one unit is then shown in sub-units (AutoCAD Help, "Primary Units Tab").
 */
function subUnitFields(
  zin: string,
  factor: string,
  suffix: string,
  at: Omit<FieldBase, 'label'>,
): DimStyleField[] {
  const enabled = (v: DimStyleVars) => (at.enabled?.(v) ?? true) && (num(v[zin]) & 4) !== 0;
  return [
    numberField(factor, { ...at, label: 'Sub-units factor', enabled }, (n) => n > 0),
    {
      key: suffix,
      ...at,
      label: 'Sub-unit suffix',
      kind: 'text',
      vars: [suffix],
      enabled,
      get: (v) => str(v[suffix]),
      set: (value) => (typeof value === 'string' ? { [suffix]: value } : undefined),
    },
  ];
}

/** Feet and inches are shown by Engineering and Architectural units only. */
const feetInches =
  (name: string, ...formats: number[]) =>
  (v: DimStyleVars) =>
    formats.includes(num(v[name]));

const linear = { tab: 'primary', group: 'Linear dimensions' } as const;
const linearZeros = { tab: 'primary', group: 'Zero suppression' } as const;
const angular = { tab: 'primary', group: 'Angular dimensions' } as const;

const LINEAR_UNITS = opts([
  [1, 'Scientific'],
  [2, 'Decimal'],
  [3, 'Engineering'],
  [4, 'Architectural'],
  [5, 'Fractional'],
  [6, 'Windows Desktop'],
]);

const SEPARATORS = opts([
  ['.', "'.' (Period)"],
  [',', "',' (Comma)"],
  [' ', "' ' (Space)"],
]);

/** Decimal separator: a DIMSTYLE keeps the character (DXF 278 as text). */
const separatorField: DimStyleField = {
  key: 'DIMDSEP',
  ...linear,
  label: 'Decimal separator',
  kind: 'choice',
  options: SEPARATORS,
  vars: ['DIMDSEP'],
  enabled: (v) => [1, 2, 6].includes(num(v.DIMLUNIT)),
  get: (v) => {
    const s = v.DIMDSEP;
    return typeof s === 'number' ? String.fromCharCode(s) : str(s) || '.';
  },
  set: (value) =>
    SEPARATORS.some((o) => o.value === value) ? { DIMDSEP: String(value) } : undefined,
};

/** Scale factor (DIMLFAC's size) and Apply to layout dimensions only (its sign). */
const lfacField: DimStyleField = {
  key: 'DIMLFAC',
  tab: 'primary',
  group: 'Measurement scale',
  label: 'Scale factor',
  kind: 'number',
  vars: ['DIMLFAC'],
  get: (v) => Math.abs(num(v.DIMLFAC)),
  set: (value, v) => {
    const n = typed(value);
    return n !== undefined && n > 0 ? { DIMLFAC: num(v.DIMLFAC) < 0 ? -n : n } : undefined;
  },
};

const layoutOnlyField: DimStyleField = {
  key: 'DIMLFAC.layout',
  tab: 'primary',
  group: 'Measurement scale',
  label: 'Apply to layout dimensions only',
  kind: 'check',
  vars: ['DIMLFAC'],
  get: (v) => num(v.DIMLFAC) < 0,
  set: (value, v) =>
    typeof value === 'boolean'
      ? { DIMLFAC: Math.abs(num(v.DIMLFAC) || 1) * (value ? -1 : 1) }
      : undefined,
};

const ANGLE_FORMATS = opts([
  [0, 'Decimal Degrees'],
  [1, 'Degrees Minutes Seconds'],
  [2, 'Gradians'],
  [3, 'Radians'],
]);

/** DIMAZIN: bit 1 leading zeros, bit 2 trailing zeros. */
function angleZeroField(part: 'leading' | 'trailing'): DimStyleField {
  const bit = part === 'leading' ? 1 : 2;
  return {
    key: `DIMAZIN.${part}`,
    ...angular,
    label: part === 'leading' ? 'Leading' : 'Trailing',
    kind: 'check',
    vars: ['DIMAZIN'],
    get: (v) => (num(v.DIMAZIN) & bit) !== 0,
    set: (value, v) =>
      typeof value === 'boolean'
        ? { DIMAZIN: value ? num(v.DIMAZIN) | bit : num(v.DIMAZIN) & ~bit }
        : undefined,
  };
}

const PRIMARY: DimStyleField[] = [
  choiceField('DIMLUNIT', { ...linear, label: 'Unit format' }, LINEAR_UNITS),
  precisionField('DIMDEC', { ...linear, label: 'Precision' }, (v) => ({
    format: num(v.DIMLUNIT),
    fractions: [4, 5].includes(num(v.DIMLUNIT)),
  })),
  choiceField(
    'DIMFRAC',
    { ...linear, label: 'Fraction format', enabled: fractional },
    opts([
      [0, 'Horizontal'],
      [1, 'Diagonal'],
      [2, 'Not Stacked'],
    ]),
  ),
  separatorField,
  numberField('DIMRND', { ...linear, label: 'Round off' }),
  affixField('DIMPOST', 'prefix', linear),
  affixField('DIMPOST', 'suffix', linear),
  lfacField,
  layoutOnlyField,
  zeroField('DIMZIN', 'leading', linearZeros),
  ...subUnitFields('DIMZIN', 'DIMMZF', 'DIMMZS', linearZeros),
  zeroField('DIMZIN', 'trailing', linearZeros),
  zeroField('DIMZIN', 'feet', { ...linearZeros, enabled: feetInches('DIMLUNIT', 3, 4) }),
  zeroField('DIMZIN', 'inches', { ...linearZeros, enabled: feetInches('DIMLUNIT', 3, 4) }),
  {
    ...choiceField('DIMAUNIT', { ...angular, label: 'Units format' }, ANGLE_FORMATS),
    // Surveyor's units (4) are not in the list; a style that has them shows them.
    options: (_, v) =>
      num(v.DIMAUNIT) === 4
        ? [...ANGLE_FORMATS, { value: '4', label: "Surveyor's units" }]
        : [...ANGLE_FORMATS],
    set: (value) => {
      const n = typed(value);
      return n !== undefined && [0, 1, 2, 3, 4].includes(n) ? { DIMAUNIT: n } : undefined;
    },
  },
  precisionField('DIMADEC', { ...angular, label: 'Precision' }, () => ({
    format: 2,
    fractions: false,
  })),
  angleZeroField('leading'),
  angleZeroField('trailing'),
];

// --- Alternate Units ----------------------------------------------------------------------------

const alt = (v: DimStyleVars) => on(v.DIMALT);
const altUnits = { tab: 'alternate', group: 'Alternate units', enabled: alt } as const;
const altZeros = { tab: 'alternate', group: 'Zero suppression', enabled: alt } as const;

/** DIMALTU's own numbering: the stacked forms are 4 and 5, plain ones 6 and 7. */
const ALT_FORMATS = opts([
  [1, 'Scientific'],
  [2, 'Decimal'],
  [3, 'Engineering'],
  [4, 'Architectural Stacked'],
  [5, 'Fractional Stacked'],
  [6, 'Architectural'],
  [7, 'Fractional'],
  [8, 'Windows Desktop'],
]);

const altFractions = (v: DimStyleVars) => [4, 5, 6, 7].includes(num(v.DIMALTU));

/**
 * Placement: after the primary value, or below it, which AutoCAD writes as DIMAPOST starting
 * with `\X` (the MTEXT line break of dimension text). The help names the option without saying
 * how it is stored; `\X` is how AutoCAD's own Standard-derived styles keep it.
 */
const altPlacementField: DimStyleField = {
  key: 'DIMAPOST.placement',
  tab: 'alternate',
  group: 'Placement',
  label: 'Placement',
  kind: 'radio',
  options: opts([
    ['after', 'After primary value'],
    ['below', 'Below primary value'],
  ]),
  vars: ['DIMAPOST'],
  enabled: alt,
  get: (v) => (str(v.DIMAPOST).startsWith('\\X') ? 'below' : 'after'),
  set: (value, v) => {
    const s = str(v.DIMAPOST);
    const rest = s.startsWith('\\X') ? s.slice(2) : s;
    if (value === 'after') return { DIMAPOST: rest };
    if (value === 'below') return { DIMAPOST: `\\X${rest}` };
    return undefined;
  },
};

const ALTERNATE: DimStyleField[] = [
  checkField('DIMALT', {
    tab: 'alternate',
    group: 'Alternate units',
    label: 'Display alternate units',
  }),
  choiceField('DIMALTU', { ...altUnits, label: 'Unit format' }, ALT_FORMATS),
  precisionField('DIMALTD', { ...altUnits, label: 'Precision' }, (v) => ({
    format: num(v.DIMALTU),
    fractions: altFractions(v),
  })),
  numberField('DIMALTF', { ...altUnits, label: 'Multiplier for alt units' }, (n) => n > 0),
  numberField('DIMALTRND', { ...altUnits, label: 'Round distances to' }),
  affixField('DIMAPOST', 'prefix', altUnits),
  affixField('DIMAPOST', 'suffix', altUnits),
  zeroField('DIMALTZ', 'leading', altZeros),
  ...subUnitFields('DIMALTZ', 'DIMALTMZF', 'DIMALTMZS', altZeros),
  zeroField('DIMALTZ', 'trailing', altZeros),
  zeroField('DIMALTZ', 'feet', {
    ...altZeros,
    enabled: (v) => alt(v) && [3, 4, 6].includes(num(v.DIMALTU)),
  }),
  zeroField('DIMALTZ', 'inches', {
    ...altZeros,
    enabled: (v) => alt(v) && [3, 4, 6].includes(num(v.DIMALTU)),
  }),
  altPlacementField,
];

// --- Tolerances ---------------------------------------------------------------------------------

const format = { tab: 'tolerances', group: 'Tolerance format' } as const;

type Method = 'none' | 'symmetrical' | 'deviation' | 'limits' | 'basic';

function methodOf(v: DimStyleVars): Method {
  if (on(v.DIMLIM)) return 'limits';
  if (on(v.DIMTOL)) return num(v.DIMTP) === num(v.DIMTM) ? 'symmetrical' : 'deviation';
  return num(v.DIMGAP) < 0 ? 'basic' : 'none';
}

const tolerances = (v: DimStyleVars) => methodOf(v) !== 'none' && methodOf(v) !== 'basic';

/**
 * Method: None, Symmetrical (DIMTOL with DIMTM equal to DIMTP), Deviation (DIMTOL), Limits
 * (DIMLIM) or Basic (a framed measurement, DIMGAP negative). A deviation whose limits are equal
 * reads as symmetrical, as AutoCAD's dialog shows it.
 */
const methodField: DimStyleField = {
  key: 'DIMTOL.method',
  ...format,
  label: 'Method',
  kind: 'choice',
  options: opts([
    ['none', 'None'],
    ['symmetrical', 'Symmetrical'],
    ['deviation', 'Deviation'],
    ['limits', 'Limits'],
    ['basic', 'Basic'],
  ]),
  vars: ['DIMTOL', 'DIMLIM', 'DIMTM', 'DIMGAP'],
  get: methodOf,
  set: (value, v) => {
    const gap = Math.abs(num(v.DIMGAP));
    switch (value) {
      case 'none':
        return { DIMTOL: 0, DIMLIM: 0, DIMGAP: gap };
      case 'symmetrical':
        return { DIMTOL: 1, DIMLIM: 0, DIMTM: num(v.DIMTP), DIMGAP: gap };
      case 'deviation':
        return { DIMTOL: 1, DIMLIM: 0, DIMGAP: gap };
      case 'limits':
        return { DIMTOL: 0, DIMLIM: 1, DIMGAP: gap };
      case 'basic':
        return { DIMTOL: 0, DIMLIM: 0, DIMGAP: -gap };
      default:
        return undefined;
    }
  },
};

/** Upper value: a symmetrical tolerance's lower value follows it. */
const upperField: DimStyleField = {
  key: 'DIMTP',
  ...format,
  label: 'Upper value',
  kind: 'number',
  vars: ['DIMTP', 'DIMTM'],
  enabled: tolerances,
  get: (v) => num(v.DIMTP),
  set: (value, v) => {
    const n = typed(value);
    if (n === undefined) return undefined;
    return methodOf(v) === 'symmetrical' ? { DIMTP: n, DIMTM: n } : { DIMTP: n };
  },
};

const TOLERANCES: DimStyleField[] = [
  methodField,
  precisionField('DIMTDEC', { ...format, label: 'Precision', enabled: tolerances }, (v) => ({
    format: num(v.DIMLUNIT),
    fractions: fractional(v),
  })),
  upperField,
  numberField(
    'DIMTM',
    {
      ...format,
      label: 'Lower value',
      enabled: (v) => methodOf(v) === 'deviation' || methodOf(v) === 'limits',
    },
    () => true,
  ),
  {
    // The Text tab's Fraction height scale is the same DIMTFAC.
    ...numberField(
      'DIMTFAC',
      { ...format, label: 'Scaling for height', enabled: tolerances },
      (n) => n > 0,
    ),
    key: 'DIMTFAC.tolerance',
  },
  choiceField(
    'DIMTOLJ',
    { ...format, label: 'Vertical position', enabled: tolerances },
    opts([
      [0, 'Bottom'],
      [1, 'Middle'],
      [2, 'Top'],
    ]),
  ),
  choiceField(
    'DIMTALN',
    {
      tab: 'tolerances',
      group: 'Tolerance alignment',
      label: 'Tolerance alignment',
      enabled: tolerances,
    },
    opts([
      [0, 'Align decimal separators'],
      [1, 'Align operational symbols'],
    ]),
    'radio',
  ),
  zeroField('DIMTZIN', 'leading', {
    tab: 'tolerances',
    group: 'Zero suppression',
    enabled: tolerances,
  }),
  zeroField('DIMTZIN', 'trailing', {
    tab: 'tolerances',
    group: 'Zero suppression',
    enabled: tolerances,
  }),
  zeroField('DIMTZIN', 'feet', {
    tab: 'tolerances',
    group: 'Zero suppression',
    enabled: tolerances,
  }),
  zeroField('DIMTZIN', 'inches', {
    tab: 'tolerances',
    group: 'Zero suppression',
    enabled: tolerances,
  }),
  precisionField(
    'DIMALTTD',
    {
      tab: 'tolerances',
      group: 'Alternate unit tolerance',
      label: 'Precision',
      enabled: (v) => alt(v) && tolerances(v),
    },
    (v) => ({ format: num(v.DIMALTU), fractions: altFractions(v) }),
  ),
  zeroField('DIMALTTZ', 'leading', {
    tab: 'tolerances',
    group: 'Alternate unit tolerance',
    enabled: (v) => alt(v) && tolerances(v),
  }),
  zeroField('DIMALTTZ', 'trailing', {
    tab: 'tolerances',
    group: 'Alternate unit tolerance',
    enabled: (v) => alt(v) && tolerances(v),
  }),
  zeroField('DIMALTTZ', 'feet', {
    tab: 'tolerances',
    group: 'Alternate unit tolerance',
    enabled: (v) => alt(v) && tolerances(v),
  }),
  zeroField('DIMALTTZ', 'inches', {
    tab: 'tolerances',
    group: 'Alternate unit tolerance',
    enabled: (v) => alt(v) && tolerances(v),
  }),
];

/** Every field of the dialog, tab by tab in AutoCAD's order. */
export const DIMSTYLE_FIELDS: readonly DimStyleField[] = [
  ...LINES,
  ...SYMBOLS,
  ...TEXT,
  ...FIT,
  ...PRIMARY,
  ...ALTERNATE,
  ...TOLERANCES,
];

/** The DIMVARs the dialog cannot set, which it keeps as they were (AutoCAD's dialog has none). */
export const DIMSTYLE_DIALOG_KEEPS: readonly string[] = ['DIMTVP', 'DIMTSZ', 'DIMFIT', 'DIMUNIT'];

/** A style's DIMVARs as the dialog shows them: AutoCAD's defaults for what it does not state. */
export function dialogVars(vars: DimStyleVars): DimStyleVars {
  return { ...DIMSTYLE_DEFAULTS, ...DIMSTYLE_XDATA_DEFAULTS, ...vars };
}

/** The options a field offers for `v`. */
export function fieldOptions(
  f: DimStyleField,
  lists: DimStyleLists,
  v: DimStyleVars,
): readonly DimStyleOption[] {
  if (!f.options) return [];
  return typeof f.options === 'function' ? f.options(lists, v) : f.options;
}

/**
 * `v` with field `key` set to `value`; `v` itself when the field cannot take it. A reference set
 * to `''` (closed filled, ByBlock) is removed, as a style holds none for the default.
 */
export function setField(v: DimStyleVars, key: string, value: DimStyleFieldValue): DimStyleVars {
  const f = DIMSTYLE_FIELDS.find((x) => x.key === key);
  const patch = f?.set(value, v);
  if (!patch) return v;
  const out: Record<string, DimVarValue> = { ...v };
  for (const [name, value] of Object.entries(patch)) {
    if (DIMSTYLE_REFERENCES.has(name) && value === '') delete out[name];
    else out[name] = value;
  }
  return out;
}
