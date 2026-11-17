// Table cell data formats (M4-16 part 2), as AutoCAD's Table Cell Format dialog sets them
// (AutoCAD 2024 Help, "Table Cell Format Dialog Box"): a data type (Angle, Currency, Date,
// Decimal Number, General, Percentage, Point, Text, Whole Number) with its format and precision.
// The file states what the dialog chose in the cell's CELL_VALUE: the value's type (DXF 90), its
// unit type (94), the format string (300) and the text it shows (302). acadsharp's AC1021–AC1032
// samples hold one of each (table A35): an angle `%au0` (1.0472 radians shown "60"), a currency
// `%lu2%pr2%ps[$,]` (100 shown "$100.00", units 16), a percentage `%lu2%pr2%ps[,%]` (35 shown
// "35.00%", units 32), a date with no format ("11/15/2024"), a point ("0.000000, 0.000000,
// 0.000000"), a whole number ("5") and a text `%tc1`; the strings here are built to match them.
//
// Where the documentation is silent, the common drafter expectation is encoded (noted in the PR):
// - A cell given a data type keeps its value when it already is one of that kind (a number stays
//   that number, re-formatted), else its text is read as the type; text that does not read stays
//   text, the format kept for what is typed later. Typing into a cell reads the text the same way
//   (`$12.5` or `12.5` in a Currency cell is 12.5, shown "$12.50").
// - A Decimal Number and a Point state no unit type (0), as the sample's plain number does; Whole
//   Number, General and a Text without a case state no format string, so a file cannot tell an
//   empty Whole Number or a case-less Text cell from a General one, which they read back as.
// - Percentage stores the number shown (35 for 35 %), as the sample does.
// - A date typed as numbers reads day and month in the order the picture puts them.
import type { TableCell, TableCellValue, TableGeometry } from '../model/types';
import { formatFieldDate, formatFieldNumber } from './fields';
import { tableCellShown } from '../annotation/table';
import { parseAngleValue, parseDistance, parseNumber } from '../commands/parse';
import type { DrawingUnits } from '../commands/units';
import type { TableCellRange } from './table-grid';

/** The Data type list, as the dialog orders it. */
export const TABLE_DATA_TYPES = [
  'angle',
  'currency',
  'date',
  'decimal',
  'general',
  'percentage',
  'point',
  'text',
  'whole',
] as const;

export type TableDataType = (typeof TABLE_DATA_TYPES)[number];

/** The dialog's names for the data types. */
export const TABLE_DATA_TYPE_NAMES: Readonly<Record<TableDataType, string>> = {
  angle: 'Angle',
  currency: 'Currency',
  date: 'Date',
  decimal: 'Decimal Number',
  general: 'General',
  percentage: 'Percentage',
  point: 'Point',
  text: 'Text',
  whole: 'Whole Number',
};

/** An Angle's Format list (`%au0`…`%au4`, AUNITS's order). */
export const TABLE_ANGLE_FORMATS: readonly string[] = [
  'Decimal Degrees',
  'Deg/Min/Sec',
  'Grads',
  'Radians',
  "Surveyor's Units",
];

/** A Currency's Symbol list. */
export const TABLE_CURRENCY_SYMBOLS: readonly string[] = ['$', '€', '£', '¥'];

/** The Table Cell Format dialog's fields. */
export interface TableDataFormat {
  readonly type: TableDataType;
  /**
   * Angle: `TABLE_ANGLE_FORMATS` index (`%au`). Decimal Number and Point: `NUMBER_FORMATS`
   * index (`%lu`, 0 the drawing's units). Text: `TEXT_CASES` index (`%tc`, 0 as typed).
   */
  readonly format?: number;
  /** Decimal places (`%pr`); absent, the drawing's (LUPREC or AUPREC). */
  readonly precision?: number;
  /** Date: its picture (`M/d/yyyy`). */
  readonly date?: string;
  /** Currency: its symbol, and whether it follows the number (Append symbol). */
  readonly symbol?: string;
  readonly appendSymbol?: boolean;
}

const DEFAULT_DATE = 'M/d/yyyy';
const ANGLE = 2;
const CURRENCY = 0x10;
const PERCENTAGE = 0x20;

const precisionCode = (p: number | undefined) => (p === undefined ? '' : `%pr${p}`);
const unitsCode = (u: number | undefined) => (u !== undefined && u > 0 ? `%lu${u}` : '');

/** The format string (DXF 300) data format `f` states. */
export function tableFormatString(f: TableDataFormat): string {
  switch (f.type) {
    case 'angle':
      return `%au${f.format ?? 0}${precisionCode(f.precision)}`;
    case 'currency': {
      const s = f.symbol ?? '$';
      return `%lu2%pr${f.precision ?? 2}%ps[${f.appendSymbol ? `,${s}` : `${s},`}]`;
    }
    case 'percentage':
      return `%lu2%pr${f.precision ?? 2}%ps[,%]`;
    case 'date':
      return f.date ?? DEFAULT_DATE;
    case 'decimal':
    case 'point':
      return unitsCode(f.format) + precisionCode(f.precision);
    case 'text':
      return f.format !== undefined && f.format > 0 ? `%tc${f.format}` : '';
    default:
      return '';
  }
}

/** The number in `code`'s first `%xxN` in `f`, if any. */
const codeNumber = (f: string, code: string): number | undefined => {
  const m = new RegExp(`%${code}(\\d+)`).exec(f);
  return m ? Number(m[1]) : undefined;
};

/** The data type cell `c` has, from its value and its format string. */
export function tableDataFormatOf(c: TableCell): TableDataFormat {
  const f = c.valueFormat ?? '';
  const v = c.value;
  const precision = codeNumber(f, 'pr');
  const withPrecision = precision === undefined ? {} : { precision };
  if (v?.kind === 'long') return { type: 'whole' };
  if (v?.kind === 'date' || (f !== '' && !f.includes('%'))) {
    return { type: 'date', date: f === '' ? DEFAULT_DATE : f };
  }
  const lu = codeNumber(f, 'lu');
  const numberFormat = { ...(lu !== undefined && { format: lu }), ...withPrecision };
  if (v?.kind === 'point') return { type: 'point', ...numberFormat };
  const units = v?.kind === 'double' ? v.units : 0;
  if (units === ANGLE || /%au\d/.test(f)) {
    return { type: 'angle', format: codeNumber(f, 'au') ?? 0, ...withPrecision };
  }
  const ps = /%ps\[([^,\]]*),?([^\]]*)\]/.exec(f);
  if (units === PERCENTAGE || ps?.[2] === '%') return { type: 'percentage', ...withPrecision };
  if (units === CURRENCY || ps) {
    const before = ps?.[1] ?? '';
    const after = ps?.[2] ?? '';
    return {
      type: 'currency',
      symbol: before || after || '$',
      ...(before === '' && after !== '' && { appendSymbol: true }),
      ...withPrecision,
    };
  }
  const tc = codeNumber(f, 'tc');
  if (tc !== undefined) return { type: 'text', format: tc };
  if (v?.kind === 'double' || lu !== undefined || precision !== undefined) {
    return { type: 'decimal', ...numberFormat };
  }
  return { type: 'general' };
}

/** `v` as format string `format` shows it, in the drawing's `units` where it states none. */
export function tableValueText(v: TableCellValue, format: string, units: DrawingUnits): string {
  switch (v.kind) {
    case 'long':
      return formatFieldNumber(v.n, format, units, 'plain');
    case 'double':
      if (v.units === ANGLE) return formatFieldNumber(v.n, format, units, 'angle');
      return formatFieldNumber(v.n, format, units, format === '' ? 'plain' : 'linear');
    case 'date':
      return formatFieldDate(new Date(v.time), format === '' ? DEFAULT_DATE : format);
    case 'point':
      return v.point
        .slice(0, v.dimensions)
        .map((x) => formatFieldNumber(x, format, units, format === '' ? 'plain' : 'linear'))
        .join(', ');
  }
}

/** A number typed in a cell: its currency or percent sign and thousands separators left out. */
function typedNumber(text: string, lunits: number): number | undefined {
  const t = text
    .trim()
    .replace(/^[$€£¥]\s*|\s*[$€£¥%]$/g, '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  if (t === '') return undefined;
  return parseDistance(t, lunits) ?? parseNumber(t);
}

/** An angle typed in a cell, in radians: a bare number in the format's units. */
function typedAngle(text: string, format: number): number | undefined {
  const t = text.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) {
    const n = Number(t);
    if (format === 2) return (n * Math.PI) / 200;
    if (format === 3) return n;
    return (n * Math.PI) / 180;
  }
  return parseAngleValue(t.replace(/°/g, 'd'));
}

/** A date typed in a cell: numbers in the picture's day and month order, else a written date. */
function typedDate(text: string, picture: string): number | undefined {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  let y: number;
  let m: number;
  let d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (parts) {
    const dayFirst = picture.search(/d/) >= 0 && picture.search(/d/) < picture.search(/M/);
    const [a, b] = [Number(parts[1]), Number(parts[2])];
    [d, m] = dayFirst ? [a, b] : [b, a];
    y = Number(parts[3]);
    if (parts[3]!.length === 2) y += y < 50 ? 2000 : 1900;
  } else {
    const n = Date.parse(t);
    return Number.isNaN(n) || !/[a-z]/i.test(t) ? undefined : n;
  }
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : undefined;
}

/**
 * Text `text` read as data format `f` (in the drawing's linear units where the format states
 * none): the value it is, undefined when it does not read as one, or when `f` keeps text.
 */
export function tableTypedValue(
  text: string,
  f: TableDataFormat,
  units: DrawingUnits,
): TableCellValue | undefined {
  const lunits = f.format !== undefined && f.format > 0 ? f.format : units.lunits;
  switch (f.type) {
    case 'angle': {
      const n = typedAngle(text, f.format ?? 0);
      return n === undefined ? undefined : { kind: 'double', n, units: ANGLE };
    }
    case 'currency':
    case 'percentage':
    case 'decimal': {
      const n = typedNumber(text, f.type === 'decimal' ? lunits : 2);
      if (n === undefined) return undefined;
      const u = f.type === 'currency' ? CURRENCY : f.type === 'percentage' ? PERCENTAGE : 0;
      return { kind: 'double', n, units: u };
    }
    case 'whole': {
      const n = typedNumber(text, 2);
      return n === undefined ? undefined : { kind: 'long', n: Math.round(n) };
    }
    case 'date': {
      const time = typedDate(text, f.date ?? DEFAULT_DATE);
      return time === undefined ? undefined : { kind: 'date', time };
    }
    case 'point': {
      const xs = text.split(/[,;:]/).map((s) => typedNumber(s, lunits));
      if (xs.length < 2 || xs.length > 3 || xs.some((x) => x === undefined)) return undefined;
      const [x, y, z = 0] = xs as number[];
      return { kind: 'point', point: [x!, y!, z], dimensions: xs.length === 2 ? 2 : 3 };
    }
    default:
      return undefined;
  }
}

/** Value `v` as data type `type` keeps it without reading the cell's text again, if it can. */
function keptValue(v: TableCellValue | undefined, type: TableDataType): TableCellValue | undefined {
  if (!v) return undefined;
  if (type === 'date') return v.kind === 'date' ? v : undefined;
  if (type === 'point') return v.kind === 'point' ? v : undefined;
  if (v.kind !== 'long' && v.kind !== 'double') return undefined;
  const wasAngle = v.kind === 'double' && v.units === ANGLE;
  if (type === 'angle') return wasAngle ? v : undefined;
  if (wasAngle) return undefined;
  if (type === 'whole') return { kind: 'long', n: Math.round(v.n) };
  const u = type === 'currency' ? CURRENCY : type === 'percentage' ? PERCENTAGE : 0;
  return type === 'decimal' || type === 'currency' || type === 'percentage'
    ? { kind: 'double', n: v.n, units: u }
    : undefined;
}

/** Cell `c` holding `value` (or text `text` when none) in format string `format`. */
function cellWith(
  c: TableCell,
  value: TableCellValue | undefined,
  text: string,
  format: string,
  units: DrawingUnits,
): TableCell {
  const { value: _value, valueFormat: _format, ...rest } = c;
  return {
    ...rest,
    text: value ? tableValueText(value, format, units) : text,
    ...(value && { value }),
    ...(format !== '' && { valueFormat: format }),
  };
}

/**
 * Text cell `c` given data format `f` (the Table Cell Format dialog's OK): its value kept where
 * it is of `f`'s kind, else its text read as `f`; text that does not read stays as it is.
 */
export function cellWithDataFormat(
  c: TableCell,
  f: TableDataFormat,
  units: DrawingUnits,
): TableCell {
  if (c.type !== 'text' || c.merged) return c;
  const format = tableFormatString(f);
  const value =
    keptValue(c.value, f.type) ?? (c.text === '' ? undefined : tableTypedValue(c.text, f, units));
  return cellWith(c, value, c.text, format, units);
}

/** Text `text` typed into cell `c`, read by its data format (`tableTypedValue`). */
export function cellWithTypedText(c: TableCell, text: string, units: DrawingUnits): TableCell {
  const f = tableDataFormatOf(c);
  const value = text === '' ? undefined : tableTypedValue(text, f, units);
  return cellWith(c, value, text, c.valueFormat ?? '', units);
}

/** Table `g` with the text cells of range `r` given data format `f` (`cellWithDataFormat`). */
export function withCellsDataFormat(
  g: TableGeometry,
  r: TableCellRange,
  f: TableDataFormat,
  units: DrawingUnits,
): TableGeometry {
  const cells = g.cells.map((row, i) =>
    i < r.r0 || i > r.r1
      ? row
      : row.map((c, j) => (j < r.c0 || j > r.c1 ? c : cellWithDataFormat(c, f, units))),
  );
  return { ...g, cells };
}

/**
 * What the dialog's Preview shows for cell `c` in data format `f`: the cell as OK would leave it,
 * or, when it holds nothing of `f`'s kind, a sample (1234.5, 45°, the date `now`, a point, the
 * words "Sample text") as `f` shows one.
 */
export function tableDataPreview(
  c: TableCell,
  f: TableDataFormat,
  units: DrawingUnits,
  now: number,
): string {
  const done = cellWithDataFormat({ ...c, type: 'text', merged: false }, f, units);
  if (done.value || f.type === 'general' || (f.type === 'text' && c.text !== '')) {
    return f.type === 'text' ? tableCellShown(done) : done.text;
  }
  const format = tableFormatString(f);
  const sample: TableCellValue | undefined =
    f.type === 'angle'
      ? { kind: 'double', n: Math.PI / 4, units: ANGLE }
      : f.type === 'date'
        ? { kind: 'date', time: now }
        : f.type === 'point'
          ? { kind: 'point', point: [1234.5, 100, 0], dimensions: 3 }
          : f.type === 'whole'
            ? { kind: 'long', n: 1234 }
            : f.type === 'text'
              ? undefined
              : { kind: 'double', n: 1234.5, units: 0 };
  if (!sample) return tableCellShown({ ...done, text: 'Sample text' });
  return tableValueText(sample, format, units);
}
