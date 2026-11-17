// Field evaluation (M4-10 part 1): what a text's fields show, as AutoCAD 2024 evaluates them
// ("FIELD (Command)", "Field Dialog Box", "UPDATEFIELD (Command)", AutoCAD 2024 Help). A field
// is a FIELD object (`DrawingField`): the root `_text` field holds the text with
// `%<\_FldIdx n>%` where each child's value goes, and each child holds one field code:
//
//   \AcVar Date \f "dd/MM/yyyy"                        today's date
//   \AcVar CreateDate / SaveDate / PlotDate             the drawing's TDCREATE, TDUPDATE, plot
//   \AcVar Filename \f "%fn6"                           the drawing's file
//   \AcVar ctab                                         the layout's name (CTAB)
//   \AcVar PlotScale / PageSetupName                    the layout's page setup
//   \AcVar <name>                                       any other system variable in the header
//   \AcObjProp Object(%<\_ObjIdx 0>%).Area \f "%lu2"    a property of objects[0]
//
// Formats, as the Field dialog writes them (no published table; read off the codes the dialog
// writes and drafters' examples):
// - Dates: Windows date pictures (d dd ddd dddd, M MM MMM MMMM, yy yyyy, h hh H HH, m mm,
//   s ss, tt, 'quoted text') and the C runtime's %x %X %c %#x %#c in the en-US locale.
// - Numbers: %lu<n> the linear units (LUNITS 1–5), %pr<n> the precision, %au<n> angular units,
//   %zs<n> zero suppression (4 leading, 8 trailing, as DIMZIN), %ds<c>/%th<c> the decimal and
//   thousands separators by character code, %ps[prefix,suffix], %ct8[f] a conversion factor,
//   %.<n>f printf decimals; the text before the first code and after the last is kept as a
//   prefix and suffix ("1:%lu2", "%lu2%pr0 sq.ft."). Other codes (%qf, %ct<n> without a
//   factor) change nothing here.
// - Text: %tc1 upper case, %tc2 lower case, %tc3 first capital, %tc4 title case.
// - Filename %fn<bits>: 1 the folder, 2 the name, 4 the extension (%fn6 the name with its
//   extension, %fn7 all of it, which the field shows without a format).
//
// Readings where the help is silent, as the drafter would expect them:
// - CTAB shows the name of the layout the text is on (model space: Model), so a title block's
//   layout name field is right on every sheet; AutoCAD's own evaluates to the tab current at
//   regeneration, which is that layout whenever the sheet is shown or plotted.
// - PlotScale without a format is "1:50" from the page setup's paper : drawing units; with one,
//   the drawing units per paper unit (50) formatted as a number.
// - PlotDate changes only when the drawing plots (`plotDate`); UPDATEFIELD keeps it.
// - A field Triya cannot evaluate (formulas, DIESEL, sheet sets, Login, the drawing properties,
//   a property it does not measure) keeps its value as last evaluated; one whose object is gone
//   shows ####, as AutoCAD shows an invalid field.
import { measureObject } from '../commands/inquiry/measure';
import {
  drawingUnits,
  formatAngle,
  formatDistance,
  formatNumber,
  type DrawingUnits,
} from '../commands/units';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { DrawingField, EntityGeometry } from '../model/types';

/** What the fields of one text evaluate against. */
export interface FieldContext {
  readonly model: DocumentModel;
  /** The time Date fields show. */
  readonly now: Date;
  /** DWGNAME: the drawing's file name; unknown (Filename fields kept) when absent. */
  readonly fileName?: string;
  /** DWGPREFIX: its folder, empty in a browser, which never reveals one. */
  readonly folder: string;
  /** The block record (model space or a layout's paper space) the text is in. */
  readonly space: Handle;
  /** Set while plotting: the time PlotDate fields take. */
  readonly plotDate?: Date;
  /** Set while saving: the time SaveDate fields take, the save's own (M4-10 part 3). */
  readonly saveDate?: Date;
}

/** What `evaluateFields` gives for one text. */
export interface EvaluatedFields {
  /** The field tree with each value updated. */
  readonly field: DrawingField;
  /** The text with each field's value in place: the text's new value or contents. */
  readonly text: string;
  /** The fields in the text (its root's children). */
  readonly found: number;
  /** How many of them were evaluated (the others keep their values). */
  readonly evaluated: number;
}

/** Shown for a field that has no value yet (AutoCAD's unevaluated field). */
export const UNEVALUATED_FIELD = '----';
/** Shown for a field whose evaluation failed: its object is gone (AutoCAD's invalid field). */
export const INVALID_FIELD = '####';

const PLACE = /%<\\_FldIdx\s+(\d+)>%/g;

/** The root's code with each child's code in place: the text as the Field dialog shows it. */
export function fieldCodeText(f: DrawingField): string {
  return f.code.replace(PLACE, (m, n: string) => {
    const c = f.children[Number(n)];
    return c ? `%<${fieldCodeText(c)}>%` : m;
  });
}

/** The root's code with each child's value in place: what the text shows. */
export function fieldText(f: DrawingField): string {
  return f.code.replace(PLACE, (_, n: string) => f.children[Number(n)]?.value ?? UNEVALUATED_FIELD);
}

/** The format string of a field code (`\f "…"`, its last part), '' when it has none. */
export function fieldFormat(code: string): string {
  const at = code.search(/\s\\f\s*"/);
  if (at < 0) return '';
  const rest = code.slice(code.indexOf('"', at) + 1);
  const end = rest.lastIndexOf('"');
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\\"/g, '"');
}

// ── Dates ──────────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The C runtime's date and time forms in the en-US locale. */
const RUNTIME_FORMS: Readonly<Record<string, string>> = {
  '%#c': 'dddd, MMMM d, yyyy h:mm:ss tt',
  '%#x': 'dddd, MMMM d, yyyy',
  '%c': 'M/d/yyyy h:mm:ss tt',
  '%x': 'M/d/yyyy',
  '%X': 'h:mm:ss tt',
};
const DEFAULT_DATE = 'M/d/yyyy';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function datePart(d: Date, token: string): string {
  const hours12 = d.getHours() % 12 || 12;
  switch (token) {
    case 'dddd':
      return DAYS[d.getDay()]!;
    case 'ddd':
      return DAYS[d.getDay()]!.slice(0, 3);
    case 'dd':
      return pad(d.getDate());
    case 'd':
      return String(d.getDate());
    case 'MMMM':
      return MONTHS[d.getMonth()]!;
    case 'MMM':
      return MONTHS[d.getMonth()]!.slice(0, 3);
    case 'MM':
      return pad(d.getMonth() + 1);
    case 'M':
      return String(d.getMonth() + 1);
    case 'yyyy':
      return pad(d.getFullYear(), 4);
    case 'yy':
      return pad(d.getFullYear() % 100);
    case 'hh':
      return pad(hours12);
    case 'h':
      return String(hours12);
    case 'HH':
      return pad(d.getHours());
    case 'H':
      return String(d.getHours());
    case 'mm':
      return pad(d.getMinutes());
    case 'm':
      return String(d.getMinutes());
    case 'ss':
      return pad(d.getSeconds());
    case 's':
      return String(d.getSeconds());
    case 'tt':
      return d.getHours() < 12 ? 'AM' : 'PM';
    default:
      // 't' and runs the picture does not define are written as they stand.
      return token === 't' ? (d.getHours() < 12 ? 'A' : 'P') : token;
  }
}

const DATE_TOKEN = /'[^']*'|dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy|hh|h|HH|H|mm|m|ss|s|tt|t/g;

/** `d` as a date picture writes it (`dd/MM/yyyy`), with a text case code. */
export function formatFieldDate(d: Date, picture: string): string {
  const { rest, textCase } = takeTextCase(picture);
  const form = RUNTIME_FORMS[rest.trim()] ?? (rest === '' ? DEFAULT_DATE : rest);
  const shown = form.replace(DATE_TOKEN, (t) =>
    t.startsWith("'") ? t.slice(1, -1) : datePart(d, t),
  );
  return applyTextCase(shown, textCase);
}

// ── Text case ──────────────────────────────────────────────────────────────────────────────

function takeTextCase(format: string): { rest: string; textCase: number } {
  let textCase = 0;
  const rest = format.replace(/%tc(\d)/gi, (_, n: string) => {
    textCase = Number(n);
    return '';
  });
  return { rest, textCase };
}

function applyTextCase(s: string, textCase: number): string {
  switch (textCase) {
    case 1:
      return s.toUpperCase();
    case 2:
      return s.toLowerCase();
    case 3:
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    case 4:
      return s
        .toLowerCase()
        .replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
    default:
      return s;
  }
}

/** A text value (a file or layer name) in the format's text case. */
const formatFieldString = (s: string, format: string): string =>
  applyTextCase(s, takeTextCase(format).textCase);

// ── Numbers ────────────────────────────────────────────────────────────────────────────────

/** What a number measures, which units write it. */
export type FieldNumberKind = 'linear' | 'area' | 'angle' | 'plain';

const NUMBER_CODE = /%\.(\d+)f|%[a-zA-Z]{2}(\d*)(?:\[([^\]]*)\])?|%[a-zA-Z]/g;

/** Thousands separators every three digits of the whole part. */
function groupThousands(s: string, sep: string): string {
  return s.replace(/^(-?)(\d+)/, (_, sign: string, digits: string) => {
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  });
}

/** `value` written by a field's number format (`%lu2%pr3`), in the drawing's units otherwise. */
export function formatFieldNumber(
  value: number,
  format: string,
  units: DrawingUnits,
  kind: FieldNumberKind = 'linear',
): string {
  let lunits: number | undefined;
  let aunits: number | undefined;
  let places: number | undefined;
  let printf: number | undefined;
  let zeros = 0;
  let decimal: string | undefined;
  let thousands: string | undefined;
  let prefix = '';
  let suffix = '';
  let factor = 1;
  let textCase = 0;
  let hex: boolean | undefined;
  let before = '';
  let after = '';
  let seen = false;
  let last = 0;
  for (const m of format.matchAll(NUMBER_CODE)) {
    const literal = format.slice(last, m.index);
    if (seen) after += literal;
    else before += literal;
    last = m.index + m[0].length;
    seen = true;
    if (m[1] !== undefined) {
      printf = Number(m[1]);
      continue;
    }
    const code = m[0].slice(1, 3).toLowerCase();
    const n = m[2] === undefined || m[2] === '' ? undefined : Number(m[2]);
    if (m[0].length === 2) {
      if (m[0] === '%X' || m[0] === '%x') hex = m[0] === '%X';
      continue;
    }
    switch (code) {
      case 'lu':
        lunits = n;
        break;
      case 'au':
        aunits = n;
        break;
      case 'pr':
        places = n;
        break;
      case 'zs':
        zeros = n ?? 0;
        break;
      case 'ds':
        if (n !== undefined) decimal = String.fromCharCode(n);
        break;
      case 'th':
        if (n !== undefined) thousands = String.fromCharCode(n);
        break;
      case 'tc':
        textCase = n ?? 0;
        break;
      case 'ps': {
        const [p = '', s = ''] = (m[3] ?? '').split(',');
        prefix = p;
        suffix = s;
        break;
      }
      case 'ct':
        if (m[3] !== undefined && Number.isFinite(Number(m[3]))) factor = Number(m[3]);
        break;
      default:
        break;
    }
  }
  const tail = format.slice(last);
  if (seen) after += tail;
  else before += tail;
  const v = value * factor;
  let text: string;
  if (hex !== undefined) {
    const h = Math.round(v).toString(16);
    text = hex ? h.toUpperCase() : h;
  } else if (printf !== undefined) {
    text = formatNumber(v, printf);
  } else if (kind === 'plain' && places === undefined && lunits !== 1) {
    // A scale or a variable without a precision is written as it is: 50, 0.25.
    text = String(Number(v.toFixed(8)));
  } else if (kind === 'angle') {
    text = formatAngle(v, {
      ...units,
      aunits: aunits ?? units.aunits,
      auprec: places ?? units.auprec,
    });
  } else {
    const u: DrawingUnits = {
      ...units,
      lunits: lunits ?? units.lunits,
      luprec: places ?? units.luprec,
    };
    // An area or a plain number has no feet and inches: decimal unless scientific.
    text = kind === 'linear' || u.lunits === 1 ? formatDistance(v, u) : formatNumber(v, u.luprec);
  }
  if (/^-?\d*\.\d+$/.test(text)) {
    if ((zeros & 8) !== 0) text = text.replace(/\.?0+$/, '');
    if ((zeros & 4) !== 0) text = text.replace(/^(-?)0\./, '$1.');
  }
  if (thousands !== undefined && /^-?\d/.test(text)) text = groupThousands(text, thousands);
  if (decimal !== undefined) {
    // The decimal point only: a thousands separator just put in stays.
    const at = text.lastIndexOf('.');
    if (at >= 0) text = text.slice(0, at) + decimal + text.slice(at + 1);
  }
  return applyTextCase(before + prefix + text + suffix + after, textCase);
}

// ── Evaluation ─────────────────────────────────────────────────────────────────────────────

/** A value worked out: the text shown, and the time when it is a date. */
interface Value {
  readonly text: string;
  readonly time?: number;
}

/**
 * A Julian date (TDCREATE, TDUPDATE) as a local date, the inverse of `julianDate`: the whole
 * part is the day's number, the fraction the time since midnight (Meeus's calendar reckoning).
 */
function julianToDate(j: number): Date {
  const z = Math.floor(j);
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const b = z + 1 + alpha - Math.floor(alpha / 4) + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const e = Math.floor((b - Math.floor(365.25 * c)) / 30.6001);
  const day = b - Math.floor(365.25 * c) - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  const seconds = Math.round((j - z) * 86400);
  return new Date(year, month - 1, day, 0, 0, seconds);
}

const dateValue = (d: Date, format: string): Value => ({
  text: formatFieldDate(d, format),
  time: d.getTime(),
});

/** A property of an object a field may show: a number and how it is written, or text. */
export type FieldProperty =
  { readonly n: number; readonly kind: FieldNumberKind } | { readonly s: string };

/** What a layout gives its fields: its name and page setup. */
export interface FieldLayout {
  readonly name: string;
  readonly plot?: {
    readonly scale?: { readonly numerator: number; readonly denominator: number };
    readonly pageSetupName?: string;
  };
}

/**
 * What the Field dialog is given of the drawing to preview a field (M4-10 part 2): the dialog
 * runs beside the engine, not in it, so the values a field may show come with it. A field
 * previewed against it takes the value it would take in the drawing (`previewField`).
 */
export interface FieldSnapshot {
  /** The time Date fields show (ms since the epoch). */
  readonly now: number;
  readonly fileName?: string;
  readonly folder: string;
  readonly units: DrawingUnits;
  /** The header variables a field may show, by name without `$`, in upper case. */
  readonly variables: Readonly<Record<string, number | string>>;
  /** The layout the text goes on. */
  readonly layout?: FieldLayout;
  /** The objects a field may name, with their properties (`objectFieldProperties`). */
  readonly objects: Readonly<Record<Handle, Readonly<Record<string, FieldProperty>>>>;
}

/** What fields evaluate against: the drawing, or a snapshot of it. */
interface FieldSource {
  readonly now: Date;
  readonly fileName?: string;
  readonly folder: string;
  readonly plotDate?: Date;
  readonly saveDate?: Date;
  readonly units: DrawingUnits;
  /** A header variable by its name without `$`, in upper case. */
  variable(name: string): number | string | undefined;
  /** The layout the text is on. */
  readonly layout?: FieldLayout;
  /** An object's properties by AutoCAD's names (Area, Layer), undefined when it is gone. */
  properties(handle: Handle): Readonly<Record<string, FieldProperty>> | undefined;
}

function headerDate(src: FieldSource, name: string): Date | undefined {
  const v = src.variable(name);
  return typeof v === 'number' && v > 0 ? julianToDate(v) : undefined;
}

/** The file name parts %fn names: 1 the folder, 2 the name, 4 the extension. */
function fileNameValue(fileName: string, folder: string, format: string): string {
  const m = /%fn(\d+)/i.exec(format);
  const bits = m ? Number(m[1]) : 7;
  const dot = fileName.lastIndexOf('.');
  const name = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  return (
    ((bits & 1) !== 0 ? folder : '') +
    ((bits & 2) !== 0 ? name : '') +
    ((bits & 4) !== 0 ? extension : '')
  );
}

/** An `\AcVar` field: undefined when Triya cannot evaluate it. */
function variable(name: string, format: string, src: FieldSource): Value | undefined {
  switch (name.toUpperCase()) {
    case 'DATE':
      return dateValue(src.now, format);
    case 'CREATEDATE': {
      const d = headerDate(src, 'TDCREATE');
      return d && dateValue(d, format);
    }
    case 'SAVEDATE': {
      const d = src.saveDate ?? headerDate(src, 'TDUPDATE');
      return d && dateValue(d, format);
    }
    case 'PLOTDATE':
      return src.plotDate && dateValue(src.plotDate, format);
    case 'FILENAME':
      return src.fileName === undefined
        ? undefined
        : { text: formatFieldString(fileNameValue(src.fileName, src.folder, format), format) };
    // DWGNAME and DWGPREFIX are the app's, not the header's (M4-10 part 2).
    case 'DWGNAME':
      return src.fileName === undefined
        ? undefined
        : { text: formatFieldString(src.fileName, format) };
    case 'DWGPREFIX':
      return { text: formatFieldString(src.folder, format) };
    case 'CTAB':
      return src.layout && { text: formatFieldString(src.layout.name, format) };
    case 'PLOTSCALE': {
      const scale = src.layout?.plot?.scale;
      if (!scale || scale.numerator <= 0 || scale.denominator <= 0) return undefined;
      const plain = (n: number) => String(Number(n.toFixed(6)));
      if (takeTextCase(format).rest === '') {
        return {
          text: formatFieldString(`${plain(scale.numerator)}:${plain(scale.denominator)}`, format),
        };
      }
      return {
        text: formatFieldNumber(scale.denominator / scale.numerator, format, src.units, 'plain'),
      };
    }
    case 'PAGESETUPNAME': {
      const plot = src.layout?.plot;
      return plot && { text: formatFieldString(plot.pageSetupName ?? '', format) };
    }
    default: {
      const v = src.variable(name.toUpperCase());
      if (typeof v === 'number') return { text: formatFieldNumber(v, format, src.units, 'plain') };
      if (typeof v === 'string') return { text: formatFieldString(v, format) };
      return undefined;
    }
  }
}

/** The length AutoCAD's Length or Circumference property gives, undefined when none. */
function lengthOf(g: EntityGeometry): number | undefined {
  if (g.kind === 'LINE') return Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);
  if (g.kind === 'ARC') {
    let sweep = g.endAngle - g.startAngle;
    if (sweep <= 0) sweep += 2 * Math.PI;
    return g.radius * sweep;
  }
  return measureObject(g)?.perimeter;
}

/**
 * The properties of an object a field can show, by AutoCAD's names (the Field dialog's Property
 * list for an Object field): Area, Length (Circumference for a circle), Radius, Diameter and
 * Layer, those the object has; undefined when it is not in the drawing.
 */
export function objectFieldProperties(
  model: DocumentModel,
  handle: Handle,
): Readonly<Record<string, FieldProperty>> | undefined {
  const e = model.entityByHandle(handle);
  if (!e) return undefined;
  const g = e.geom;
  const out: Record<string, FieldProperty> = {};
  const area = measureObject(g)?.area;
  if (area !== undefined) out['Area'] = { n: area, kind: 'area' };
  if (g.kind === 'CIRCLE') out['Circumference'] = { n: 2 * Math.PI * g.radius, kind: 'linear' };
  else {
    const length = lengthOf(g);
    if (length !== undefined) out['Length'] = { n: length, kind: 'linear' };
  }
  if (g.kind === 'CIRCLE' || g.kind === 'ARC') {
    out['Radius'] = { n: g.radius, kind: 'linear' };
    out['Diameter'] = { n: 2 * g.radius, kind: 'linear' };
  }
  const layer = model.tables.layers.get(e.layer);
  if (layer) out['Layer'] = { s: layer.name };
  return out;
}

const OBJECT_PROPERTY = /^\\AcObjProp(?:\.[\d.]+)?\s+Object\(%<\\_ObjIdx\s+(\d+)>%\)\.(\w+)/;

/** An `\AcObjProp` field: undefined when Triya cannot evaluate it. */
function objectProperty(f: DrawingField, src: FieldSource): Value | undefined {
  const m = OBJECT_PROPERTY.exec(f.code);
  if (!m) return undefined;
  const handle = f.objects[Number(m[1])];
  const props = handle === undefined ? undefined : src.properties(handle);
  if (!props) return { text: INVALID_FIELD };
  const name = m[2]!.toLowerCase();
  const p = Object.entries(props).find(([k]) => k.toLowerCase() === name)?.[1];
  if (!p) return undefined;
  const format = fieldFormat(f.code);
  if ('s' in p) return { text: formatFieldString(p.s, format) };
  return { text: formatFieldNumber(p.n, format, src.units, p.kind) };
}

/** One child field's new value, or undefined to keep the one it has. */
function evaluateOne(f: DrawingField, src: FieldSource): Value | undefined {
  const v = /^\\AcVar(?:\.[\d.]+)?\s+([^\s\\]+)/.exec(f.code);
  if (v) return variable(v[1]!, fieldFormat(f.code), src);
  if (f.code.startsWith('\\AcObjProp')) return objectProperty(f, src);
  return undefined;
}

/** DXF 91's every bit: a FIELD without options may be evaluated at any time. */
export const FIELD_OPTIONS_ALL = 63;

function evaluateWith(root: DrawingField, src: FieldSource, when?: number): EvaluatedFields {
  let evaluated = 0;
  const children = root.children.map((c): DrawingField => {
    // A field whose own options leave out the event is not evaluated then (M4-10 part 3).
    if (when !== undefined && ((c.options ?? FIELD_OPTIONS_ALL) & when) === 0) return c;
    const v = evaluateOne(c, src);
    if (!v) return c;
    evaluated++;
    const { time: _old, ...rest } = c;
    return { ...rest, value: v.text, ...(v.time === undefined ? {} : { time: v.time }) };
  });
  const updated: DrawingField = { ...root, children };
  const text = fieldText(updated);
  return {
    field: root.value === undefined ? updated : { ...updated, value: text },
    text,
    found: root.children.length,
    evaluated,
  };
}

/** The source of the fields of a text in the drawing. */
function modelSource(ctx: FieldContext): FieldSource {
  const header = ctx.model.header;
  const layout = ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
  return {
    now: ctx.now,
    ...(ctx.fileName === undefined ? {} : { fileName: ctx.fileName }),
    folder: ctx.folder,
    ...(ctx.plotDate === undefined ? {} : { plotDate: ctx.plotDate }),
    ...(ctx.saveDate === undefined ? {} : { saveDate: ctx.saveDate }),
    units: drawingUnits(header),
    variable: (name) => {
      const v = header.get(`$${name}`);
      return typeof v === 'number' || typeof v === 'string' ? v : undefined;
    },
    ...(layout ? { layout } : {}),
    properties: (h) => objectFieldProperties(ctx.model, h),
  };
}

/**
 * Evaluates the fields of one text (its root `_text` field): each child Triya can evaluate takes
 * its new value, the others keep theirs, and the text is rebuilt around them. `when`, an event's
 * DXF 91 bit (edit/field-eval.ts), evaluates only the fields whose options include it.
 */
export function evaluateFields(
  root: DrawingField,
  ctx: FieldContext,
  when?: number,
): EvaluatedFields {
  return evaluateWith(root, modelSource(ctx), when);
}

// ── Fields typed into text (M4-10 part 2) ────────────────────────────────────────────────────
//
// The MTEXT editor and the Field dialog hold a field as its code in place, `%<\AcVar Date>%`,
// as AutoCAD's In-Place Text Editor and the dialog's Field expression show it. An object is
// named in the code by its handle, `%<\_ObjId 2A>%`, where the FIELD object holds an index into
// its objects (`%<\_ObjIdx 0>%`, DXF 331). AutoCAD's own expression shows the object's id,
// which no file holds; the handle is what Triya has.

/** The code of the field the MTEXT editor's Insert Field leaves where the field goes. */
export const FIELD_INSERT = '\u0000FIELD';

/**
 * The prefix the editors' Edit Field puts before the code of the field to edit (M4-10 part 4):
 * `%<FIELD_EDIT\AcVar Date>%`.
 */
export const FIELD_EDIT = '\u0000EDIT';

/**
 * The prefix the MTEXT editor's Update Field puts before the code of the field to evaluate now
 * (M4-23): `%<FIELD_UPDATE\AcVar Date>%`.
 */
export const FIELD_UPDATE = '\u0000UPDATE';

/** Where in `text` the field marked by `prefix` is (`%<` to `>%`) and its code; none if none. */
export function markedField(
  text: string,
  prefix: string,
): { readonly start: number; readonly end: number; readonly code: string } | undefined {
  const start = text.indexOf(`%<${prefix}`);
  const end = start < 0 ? -1 : fieldEnd(text, start);
  if (end < 0) return undefined;
  return { start, end, code: text.slice(start + 2 + prefix.length, end - 2) };
}

const OBJECT_INDEX = /%<\\_ObjIdx\s+(\d+)>%/g;

/** One field's code with its children's codes and its objects' handles in place. */
export function editableFieldCode(f: DrawingField): string {
  return fieldCodeOf(f).replace(OBJECT_INDEX, (m, n: string) => {
    const h = f.objects[Number(n)];
    return h === undefined ? m : `%<\\_ObjId ${h}>%`;
  });
}

function fieldCodeOf(f: DrawingField): string {
  return f.code.replace(PLACE, (m, n: string) => {
    const c = f.children[Number(n)];
    return c ? `%<${editableFieldCode(c)}>%` : m;
  });
}

/** The text of a root `_text` field with each field's code in place: what the editor opens on. */
export const editableFieldText = (root: DrawingField): string => fieldCodeOf(root);

/** Each field of a text as the editor shows it, by its code (`editableFieldCode`). */
export function fieldValues(root: DrawingField): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of root.children) out[editableFieldCode(c)] = c.value ?? UNEVALUATED_FIELD;
  return out;
}

/** The end of the field opened at `start` (`%<`), allowing nested fields; -1 if unclosed. */
function fieldEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '%' && s[i + 1] === '<') {
      depth++;
      i++;
    } else if (s[i] === '>' && s[i + 1] === '%') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `s` with each outermost `%<…>%` replaced by what `f` gives for its code. */
function replaceFields(s: string, f: (code: string) => string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = s.indexOf('%<', i);
    const end = at < 0 ? -1 : fieldEnd(s, at);
    if (end < 0) return out + s.slice(i);
    out += s.slice(i, at) + f(s.slice(at + 2, end - 2));
    i = end;
  }
}

/** The evaluator a code names (`\AcVar Date` → AcVar). */
const evaluatorOf = (code: string): string => /^\\([A-Za-z_]\w*)/.exec(code)?.[1] ?? '';

/** DXF 91's on-demand bit: UPDATEFIELD only. */
const ON_DEMAND = 32;

/** The FIELD of one code: nested fields its children, `\_ObjId` handles its objects. */
function fieldOfCode(code: string): DrawingField {
  const children: DrawingField[] = [];
  const objects: Handle[] = [];
  const own = replaceFields(code, (inner) => {
    const id = /^\\_ObjId\s+([0-9A-Fa-f]+)$/.exec(inner.trim());
    if (id) {
      objects.push(id[1]!.toUpperCase());
      return `%<\\_ObjIdx ${objects.length - 1}>%`;
    }
    children.push(fieldOfCode(inner));
    return `%<\\_FldIdx ${children.length - 1}>%`;
  });
  return {
    evaluator: evaluatorOf(own),
    code: own,
    children,
    objects,
    // AutoCAD makes a Date field to be evaluated on demand only (DXF 91 = 32, as the Date fields
    // of ezdxf's uncommon.dxf are): FIELDEVAL leaves it as it is, UPDATEFIELD brings it up to
    // date. Every other field takes all the events (63, absent).
    ...(/^\\AcVar(?:\.[\d.]+)?\s+Date\b/i.test(own) && { options: ON_DEMAND }),
  };
}

/**
 * The root `_text` FIELD of a text holding field codes (`%<\AcVar Date>%`), undefined when it
 * holds none: its code is the text with `%<\_FldIdx n>%` where field n goes.
 */
export function fieldOfText(text: string): DrawingField | undefined {
  const children: DrawingField[] = [];
  const code = replaceFields(text, (inner) => {
    children.push(fieldOfCode(inner));
    return `%<\\_FldIdx ${children.length - 1}>%`;
  });
  return children.length === 0 ? undefined : { evaluator: '_text', code, children, objects: [] };
}

/**
 * A text typed with field codes as it is kept (M4-10 part 2): the text it shows, each field's
 * value in place, and its root FIELD (none when it holds no field). A field that was in `old`
 * keeps its value until it is evaluated, so one Triya cannot evaluate keeps what it showed; a
 * new one Triya cannot evaluate shows `----`, as AutoCAD shows a field it has not evaluated.
 */
export function textWithFields(
  text: string,
  ctx: FieldContext,
  old?: DrawingField,
): { readonly text: string; readonly field?: DrawingField } {
  const root = fieldOfText(text);
  if (!root) return { text };
  const kept = new Map((old?.children ?? []).map((c) => [editableFieldCode(c), c]));
  const children = root.children.map((c) => kept.get(editableFieldCode(c)) ?? c);
  const r = evaluateFields({ ...root, children, value: '' }, ctx);
  return { text: r.text, field: r.field };
}

/**
 * The value a field code (`\AcVar Date \f "M/d/yyyy"`, without `%<` `>%`) takes against what
 * the Field dialog was given (its Preview): `----` when Triya cannot evaluate it, `####` when
 * its object is not in the drawing.
 */
export function previewField(code: string, s: FieldSnapshot): string {
  const root = fieldOfText(`%<${code}>%`)!;
  const src: FieldSource = {
    now: new Date(s.now),
    ...(s.fileName === undefined ? {} : { fileName: s.fileName }),
    folder: s.folder,
    units: s.units,
    variable: (name) => s.variables[name],
    ...(s.layout ? { layout: s.layout } : {}),
    properties: (h) => s.objects[h.toUpperCase()],
  };
  return evaluateWith(root, src).text;
}
