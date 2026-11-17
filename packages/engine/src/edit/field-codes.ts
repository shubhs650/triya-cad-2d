// The Field dialog's fields (M4-10 part 2), as AutoCAD 2024 Help, "Field Dialog Box": a Field
// category, the Field names in it, and for each name the format choices that make its field
// expression. Triya offers the fields it evaluates (edit/fields.ts):
//
//   Date & Time  CreateDate, Date, PlotDate, SaveDate      a date picture (Date format, Examples)
//   Document     Filename                                  Filename only / Path only / Path and
//                                                          filename, Display file extension
//   Objects      Object                                    Select object, Property, Format,
//                                                          Precision (a number) or text case
//   Other        SystemVariable                            the variable, its Format
//   Plot         PageSetupName, PlotDate, PlotScale        text case; the scale's format
//
// The codes are those the dialog writes (`\AcVar Date \f "M/d/yyyy"`, `\AcVar Filename \f
// "%tc1%fn2"`, `\AcObjProp Object(%<\_ObjId 2A>%).Area \f "%lu2%pr2"`); the help lists the
// choices, not the codes, so these are read off the codes AutoCAD drawings hold. Fields Triya
// does not evaluate (the drawing properties, sheet sets, formulas, DIESEL, hyperlinks) are not
// offered: a field the dialog makes always shows its value.
import type { Handle } from '../model/handle';

export type FieldName =
  | 'CreateDate'
  | 'Date'
  | 'Filename'
  | 'Object'
  | 'PageSetupName'
  | 'PlotDate'
  | 'PlotScale'
  | 'SaveDate'
  | 'SystemVariable';

/** The Field category list, in AutoCAD's order, with the names each shows. */
export const FIELD_CATEGORIES: readonly {
  readonly name: string;
  readonly fields: readonly FieldName[];
}[] = [
  {
    name: 'All',
    fields: [
      'CreateDate',
      'Date',
      'Filename',
      'Object',
      'PageSetupName',
      'PlotDate',
      'PlotScale',
      'SaveDate',
      'SystemVariable',
    ],
  },
  { name: 'Date & Time', fields: ['CreateDate', 'Date', 'PlotDate', 'SaveDate'] },
  { name: 'Document', fields: ['Filename'] },
  { name: 'Objects', fields: ['Object'] },
  { name: 'Other', fields: ['SystemVariable'] },
  { name: 'Plot', fields: ['PageSetupName', 'PlotDate', 'PlotScale'] },
];

export const DATE_FIELDS: ReadonlySet<FieldName> = new Set([
  'CreateDate',
  'Date',
  'PlotDate',
  'SaveDate',
]);

/** The Examples list of a date field, the pictures it offers (AutoCAD's list, en-US). */
export const DATE_EXAMPLES: readonly string[] = [
  'M/d/yyyy',
  'dddd, MMMM dd, yyyy',
  'MMMM d, yyyy',
  'M/d/yy',
  'MM/dd/yy',
  'MMM d, yy',
  'yyyy-MM-dd',
  'd-MMM-yy',
  'dd/MM/yyyy',
  'h:mm tt',
  'h:mm:ss tt',
  'HH:mm',
  'M/d/yyyy h:mm tt',
];

/** The Format list of a text value (`%tc1`…`%tc4`), index = the code's number. */
export const TEXT_CASES: readonly string[] = [
  '(none)',
  'Uppercase',
  'Lowercase',
  'First capital',
  'Title case',
];

/** The Format list of a number (`%lu1`…`%lu5`), index = LUNITS; 0 the drawing's units. */
export const NUMBER_FORMATS: readonly string[] = [
  'Current units',
  'Scientific',
  'Decimal',
  'Engineering',
  'Architectural',
  'Fractional',
];

/** PlotScale's Format list: the scale as 1:n (no format), or its drawing units alone. */
export const PLOT_SCALE_FORMATS: readonly string[] = ['Use scale name', '#'];

/** What a filename field shows (`%fn`): the name, the folder, or both. */
export type FilenameParts = 'name' | 'path' | 'full';

/** The dialog's state for one field: what its code is made of. */
export interface FieldSpec {
  readonly name: FieldName;
  /** A date field's picture (the Date format box). */
  readonly date?: string;
  /** A text value's Format: 1 upper case … 4 title case, 0 or absent as it is. */
  readonly textCase?: number;
  /** Filename's choices. */
  readonly parts?: FilenameParts;
  readonly extension?: boolean;
  /** SystemVariable's variable (`CTAB`, `LTSCALE`), in upper case. */
  readonly variable?: string;
  /** Object's object and property (AutoCAD's names: Area, Length, Layer). */
  readonly object?: Handle;
  readonly property?: string;
  /** A number's Format (`NUMBER_FORMATS` index; 0 the drawing's) and Precision (none: the drawing's). */
  readonly units?: number;
  readonly precision?: number;
  /** PlotScale's Format (`PLOT_SCALE_FORMATS` index). */
  readonly scaleFormat?: number;
}

const quoted = (format: string): string =>
  format === '' ? '' : ` \\f "${format.replace(/"/g, '\\"')}"`;

const caseCode = (spec: FieldSpec): string =>
  spec.textCase !== undefined && spec.textCase > 0 ? `%tc${spec.textCase}` : '';

const numberCode = (spec: FieldSpec): string =>
  (spec.units !== undefined && spec.units > 0 ? `%lu${spec.units}` : '') +
  (spec.precision !== undefined ? `%pr${spec.precision}` : '');

/** The bits of `%fn`: 1 the folder, 2 the name, 4 the extension. */
function filenameBits(spec: FieldSpec): number {
  const parts = spec.parts ?? 'name';
  const bits = parts === 'name' ? 2 : parts === 'path' ? 1 : 3;
  return bits | (spec.extension === false || parts === 'path' ? 0 : 4);
}

/**
 * The code of the field the dialog's state makes, as its Field expression shows it (without
 * `%<` `>%`); undefined while it is missing a choice (Object with no object or property).
 */
export function fieldCode(spec: FieldSpec): string | undefined {
  switch (spec.name) {
    case 'CreateDate':
    case 'Date':
    case 'PlotDate':
    case 'SaveDate':
      return `\\AcVar ${spec.name}${quoted(spec.date ?? DATE_EXAMPLES[0]!)}`;
    case 'Filename':
      return `\\AcVar Filename${quoted(`${caseCode(spec)}%fn${filenameBits(spec)}`)}`;
    case 'PageSetupName':
      return `\\AcVar PageSetupName${quoted(caseCode(spec))}`;
    case 'PlotScale':
      return `\\AcVar PlotScale${quoted(spec.scaleFormat === 1 ? numberCode({ ...spec, units: 2 }) : '')}`;
    case 'SystemVariable': {
      if (!spec.variable) return undefined;
      const name = spec.variable.toUpperCase() === 'CTAB' ? 'ctab' : spec.variable;
      return `\\AcVar ${name}${quoted(caseCode(spec) + numberCode(spec))}`;
    }
    case 'Object': {
      if (spec.object === undefined || !spec.property) return undefined;
      const format = spec.property === 'Layer' ? caseCode(spec) : numberCode(spec);
      return `\\AcObjProp Object(%<\\_ObjId ${spec.object}>%).${spec.property}${quoted(format)}`;
    }
  }
}

/** The `\AcVar` names that are the drawing's properties (DWGPROPS), which the dialog does not offer. */
const DRAWING_PROPERTIES = new Set([
  'AUTHOR',
  'COMMENTS',
  'HYPERLINKBASE',
  'KEYWORDS',
  'LASTSAVEDBY',
  'REVISIONNUMBER',
  'SUBJECT',
  'TITLE',
]);

const NAMED: ReadonlySet<string> = new Set<FieldName>([
  'CreateDate',
  'Date',
  'Filename',
  'PageSetupName',
  'PlotDate',
  'PlotScale',
  'SaveDate',
]);

/** A format's `%xxN` codes, undefined when it holds one the dialog has no choice for. */
function formatCodes(format: string): Map<string, number> | undefined {
  const codes = new Map<string, number>();
  const rest = format.replace(/%(tc|lu|pr|fn)(\d+)/g, (_m, k: string, n: string) => {
    codes.set(k, Number(n));
    return '';
  });
  return rest === '' ? codes : undefined;
}

/**
 * The Field dialog's state for a field code (`\AcVar Date \f "M/d/yyyy"`, without `%<` `>%`), as
 * Edit Field opens the dialog on a field (M4-10 part 4; AutoCAD 2024 Help, "To Edit a Field");
 * undefined for a field the dialog does not make (drawing properties, formulas, DIESEL, sheet
 * sets) or whose format holds a code it has no choice for, which it could not show as it is.
 * AutoCAD may write a version after the evaluator (`\AcVar.17.0`); a Filename field without a
 * format shows the folder, name and extension (`%fn7`).
 */
export function fieldSpecOf(code: string): FieldSpec | undefined {
  const m = /^\\(AcVar|AcObjProp)(?:\.[\d.]+)?\s+(.+?)(?:\s+\\f\s+"((?:[^"\\]|\\.)*)")?\s*$/.exec(
    code.trim(),
  );
  if (!m) return undefined;
  const format = (m[3] ?? '').replace(/\\(.)/g, '$1');
  const target = m[2]!;
  if (m[1] === 'AcObjProp') {
    const o = /^Object\(%<\\_ObjId\s+([0-9A-Fa-f]+)>%\)\.(\w+)$/.exec(target);
    const codes = formatCodes(format);
    if (!o || !codes || codes.has('fn')) return undefined;
    const property = o[2]!;
    if (property === 'Layer' ? codes.has('lu') || codes.has('pr') : codes.has('tc'))
      return undefined;
    return { name: 'Object', object: o[1]!.toUpperCase(), property, ...numberSpec(codes) };
  }
  const name = target;
  if (!/^\w+$/.test(name) || DRAWING_PROPERTIES.has(name.toUpperCase())) return undefined;
  const known = [...NAMED].find((n) => n.toLowerCase() === name.toLowerCase()) as
    FieldName | undefined;
  if (known && DATE_FIELDS.has(known)) return { name: known, date: format };
  const codes = formatCodes(format);
  if (!codes) return undefined;
  const textCase = codes.get('tc');
  const cased = textCase !== undefined && textCase > 0 ? { textCase } : {};
  if (known === 'Filename') {
    if (codes.has('lu') || codes.has('pr')) return undefined;
    const bits = codes.get('fn') ?? 7;
    const parts: FilenameParts = (bits & 3) === 1 ? 'path' : (bits & 3) === 3 ? 'full' : 'name';
    return { name: 'Filename', parts, extension: (bits & 4) !== 0, ...cased };
  }
  if (codes.has('fn')) return undefined;
  if (known === 'PageSetupName') {
    return codes.has('lu') || codes.has('pr') ? undefined : { name: 'PageSetupName', ...cased };
  }
  if (known === 'PlotScale') {
    if (codes.has('tc')) return undefined;
    if (codes.size === 0) return { name: 'PlotScale' };
    if (codes.get('lu') !== 2) return undefined;
    const precision = codes.get('pr');
    return { name: 'PlotScale', scaleFormat: 1, ...(precision !== undefined && { precision }) };
  }
  return { name: 'SystemVariable', variable: name.toUpperCase(), ...cased, ...numberSpec(codes) };
}

/** A number's Format and Precision choices from its `%lu` and `%pr`. */
function numberSpec(
  codes: Map<string, number>,
): Pick<FieldSpec, 'units' | 'precision' | 'textCase'> {
  const units = codes.get('lu');
  const precision = codes.get('pr');
  const textCase = codes.get('tc');
  return {
    ...(units !== undefined && units > 0 && { units }),
    ...(precision !== undefined && { precision }),
    ...(textCase !== undefined && textCase > 0 && { textCase }),
  };
}
