// System variables (M2-42): what SETVAR, and a variable's name typed at `Command:`, read and
// set (AutoCAD 2024 Help, "SETVAR (Command)", "System Variables"). Triya keeps them in three
// places:
//
// - the drawing's header (`$LTSCALE`, the DIMVARs, `$CLAYER`, …): every variable the file's
//   HEADER section holds, as io maps it, and the AcDbVariableDictionary ones it carries under
//   their bare names (`CETRANSPARENCY`). Setting one is an edit, one undo step, saved with the
//   drawing as AutoCAD saves it;
// - an object: WIPEOUTFRAME, kept in the drawing's WIPEOUTVARIABLES (`wipeout.ts`);
// - the app (`APP_VARIABLES`): the drafting aids of the status bar (ORTHOMODE, OSMODE, …) and
//   the per-user settings AutoCAD keeps in the registry (APERTURE, REVCLOUDGRIPS, …). The
//   command asks the app for them through the view host (`sysvar` requests): commands never
//   read UI state themselves.
//
// AutoCAD also works some variables out, read only (M2-59): the date (DATE, CDATE, from the
// bus's clock), the tab shown (CTAB) and its view (VIEWSIZE, VIEWCTR, asked of the canvas) are
// `COMPUTED_VARIABLES`; the drawing's file (DWGNAME, DWGPREFIX, DWGTITLED) and whether it has
// unsaved changes (DBMOD) are the app's to tell, `DRAWING_VARIABLES`.
//
// AutoCAD's refusals are not all documented word for word: "Unknown variable name.  Type SETVAR
// ? for a list of variables." and "Requires an integer value." are AutoCAD's own; the range
// messages ("Value must be between 0 and 1.") follow its wording for the variables it bounds,
// and a name that names no record ("No layer named …") is Triya's.
import { formatNumber } from './units';
import type { DocumentModel } from '../model/document';
import type { HeaderValue } from '../model/types';
import { OSNAP_OFF } from '../input/osnap';
import { CETRANSPARENCY } from '../properties/current';

export type VariableKind =
  /** A whole number, `min`–`max` when bounded. */
  | 'integer'
  /** A number. */
  | 'real'
  /** An angle the header holds in radians, shown and typed in degrees. */
  | 'angle'
  /** 0 or 1, which the header may hold as false or true. */
  | 'switch'
  /** Text. */
  | 'text'
  /** A point. */
  | 'point'
  /** The name of a record of `table` (CLAYER names a layer). */
  | 'name'
  /** CECOLOR: BYLAYER, BYBLOCK or an ACI (the DXF header has no true colour). */
  | 'color'
  /** A lineweight: −3 Default, −2 ByBlock, −1 ByLayer or AutoCAD's hundredths of a millimetre. */
  | 'lineweight'
  /** CETRANSPARENCY: ByLayer, ByBlock or 0–90 percent. */
  | 'transparency';

/** The records a name variable can name. */
export type NameTable =
  'layers' | 'linetypes' | 'textStyles' | 'dimStyles' | 'blockRecords' | 'mlineStyles';

export interface SystemVariable {
  /** AutoCAD's name, upper case, without the header's `$`. */
  readonly name: string;
  readonly store: 'header' | 'wipeout' | 'app' | 'computed';
  /** The header entry (`$LTSCALE`, `CETRANSPARENCY`) of a header variable. */
  readonly key?: string;
  readonly kind: VariableKind;
  readonly readOnly?: boolean;
  readonly min?: number;
  readonly max?: number;
  /** The only values it takes (POLARANG). */
  readonly choices?: readonly number[];
  /** Greater than zero (LTSCALE: "Value must be positive and nonzero."). */
  readonly positive?: boolean;
  /** Zero or more (DIMSCALE). */
  readonly nonNegative?: boolean;
  readonly table?: NameTable;
  /** A name variable may name nothing (DIMBLK: the closed filled arrowhead). */
  readonly empty?: boolean;
  /** Decimal places a real always shows, whatever LUPREC is (DATE's day fraction). */
  readonly places?: number;
}

/**
 * The variables the app keeps (AutoCAD 2024's system variable reference for each range): the
 * status bar's drafting aids and the per-user settings. The app answers `sysvar` requests for
 * each of them by name (apps/web `system-variables.ts`).
 */
/** PICKFIRST: objects picked at `Command:` are what the next command takes (noun-verb). */
export const PICKFIRST = 'PICKFIRST';

export const APP_VARIABLES: readonly SystemVariable[] = [
  { name: 'ORTHOMODE', store: 'app', kind: 'switch' },
  { name: 'SNAPMODE', store: 'app', kind: 'switch' },
  { name: 'GRIDMODE', store: 'app', kind: 'switch' },
  // OSMODE's 14 mode bits, and 16384 for "running snaps off" (F3).
  { name: 'OSMODE', store: 'app', kind: 'integer', min: 0, max: 0x3fff | OSNAP_OFF },
  { name: 'POLARANG', store: 'app', kind: 'real', choices: [90, 45, 30, 22.5, 18, 15, 10, 5] },
  { name: 'APERTURE', store: 'app', kind: 'integer', min: 1, max: 50 },
  { name: 'LWDISPLAY', store: 'app', kind: 'switch' },
  { name: 'TRANSPARENCYDISPLAY', store: 'app', kind: 'switch' },
  { name: 'PDFOSNAP', store: 'app', kind: 'switch' },
  // 1 (AutoCAD 2021+): a revision cloud shows its corners; 0: a grip at every arc's end.
  { name: 'REVCLOUDGRIPS', store: 'app', kind: 'switch' },
  // Quick Properties (M2-35 part 16): QPMODE 0 off, 1 for all objects, 2 only for objects with
  // quick properties of their own, a negative value off keeping what it turns back on to;
  // QPLOCATION 0 by the cursor, 1 static.
  { name: 'QPMODE', store: 'app', kind: 'integer', min: -2, max: 2 },
  { name: 'QPLOCATION', store: 'app', kind: 'integer', min: 0, max: 1 },
  // M2-59 (AutoCAD 2024 Help, each variable's page): AUTOSNAP's bits are 1 the marker, 2 the
  // SnapTip, 4 the magnet, 8 polar tracking (POLAR), 16 object snap tracking (OTRACK) and 32
  // their tooltips; AUTOSNAPSIZE the marker's size in pixels; DYNMODE −3 to 3, a negative value
  // off keeping what F12 turns back on; PICKFIRST noun-verb selection, which each drawing's
  // command line is told (the session's `sysvar` edit).
  { name: 'AUTOSNAP', store: 'app', kind: 'integer', min: 0, max: 63 },
  { name: 'AUTOSNAPSIZE', store: 'app', kind: 'integer', min: 1, max: 20 },
  { name: 'DYNMODE', store: 'app', kind: 'integer', min: -3, max: 3 },
  { name: PICKFIRST, store: 'app', kind: 'switch' },
];

/**
 * The variables of the drawing the app tells (AutoCAD 2024 Help, "System Variables"), read only:
 * DWGNAME the drawing's file name, DWGPREFIX its folder (a browser never reveals one: always
 * empty), DWGTITLED 1 once it has a name, DBMOD nonzero while it has changes no save holds.
 * Asked of the app through `sysvar` requests (apps/web `system-variables.ts`).
 */
export const DRAWING_VARIABLES: readonly SystemVariable[] = [
  { name: 'DBMOD', store: 'app', kind: 'integer', readOnly: true },
  { name: 'DWGNAME', store: 'app', kind: 'text', readOnly: true },
  { name: 'DWGPREFIX', store: 'app', kind: 'text', readOnly: true },
  { name: 'DWGTITLED', store: 'app', kind: 'integer', readOnly: true },
];

/**
 * The variables the engine works out when read (setvar.ts): DATE and CDATE from the bus's clock,
 * shown to the hundredth of a second as AutoCAD shows them; CTAB the tab of the space commands
 * draw in; VIEWSIZE and VIEWCTR the view the canvas shows (its height in drawing units, and its
 * centre); SCREENSIZE the canvas's size in (CSS) pixels.
 */
export const COMPUTED_VARIABLES: readonly SystemVariable[] = [
  { name: 'CDATE', store: 'computed', kind: 'real', readOnly: true, places: 8 },
  { name: 'CTAB', store: 'computed', kind: 'text', readOnly: true },
  { name: 'DATE', store: 'computed', kind: 'real', readOnly: true, places: 8 },
  { name: 'SCREENSIZE', store: 'computed', kind: 'point', readOnly: true },
  { name: 'VIEWCTR', store: 'computed', kind: 'point', readOnly: true },
  { name: 'VIEWSIZE', store: 'computed', kind: 'real', readOnly: true },
];

/**
 * AutoCAD's Julian date of a local date and time: the Julian day number of the date (1 January
 * 2020 is 2458850) and the fraction of the day since midnight (AutoCAD 2024 Help, "DATE"; the
 * same reckoning acad-ts gives TDUPDATE, CadUtils.toJulianCalendar).
 */
export function julianDate(d: Date): number {
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  if (month < 3) {
    year -= 1;
    month += 12;
  }
  const century = Math.floor(year / 100);
  const gregorian = 2 - century + Math.floor(century / 4);
  const days =
    gregorian +
    Math.floor(365.25 * year) +
    Math.floor(30.6001 * (month + 1)) +
    1720995 +
    d.getDate();
  const seconds =
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  return days + seconds / 86400;
}

/**
 * CDATE: a local date and time as the real YYYYMMDD.HHMMSS and hundredths of a second (AutoCAD
 * 2024 Help, "CDATE"); a real holds no more places beside an eight-digit date.
 */
export function calendarDate(d: Date): number {
  const date = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const centiseconds = Math.floor(d.getMilliseconds() / 10);
  const time = d.getHours() * 1e6 + d.getMinutes() * 1e4 + d.getSeconds() * 100 + centiseconds;
  return date + time / 1e8;
}

const WIPEOUTFRAME: SystemVariable = {
  name: 'WIPEOUTFRAME',
  store: 'wipeout',
  kind: 'integer',
  min: 0,
  max: 2,
};

/**
 * The header variables DXF writes with an integer group code (62, 70, 280, 370, 380), as
 * acad-ts's header map has them; io's `sysvar-kinds.test.ts` keeps this list true. A number
 * the header holds for any other variable is a real.
 */
// prettier-ignore
export const INTEGER_HEADER_VARIABLES: ReadonlySet<string> = new Set([
  'ACADMAINTVER', 'ANGDIR', 'ATTDIA', 'ATTMODE', 'ATTREQ', 'AUNITS', 'AUPREC', 'BLIPMODE',
  'CECOLOR', 'CELWEIGHT', 'CEPSNTYPE', 'CMLJUST', 'COORDS', 'CSHADOW', 'DELOBJ', 'DGNFRAME',
  'DIMADEC', 'DIMALT', 'DIMALTD', 'DIMALTTD', 'DIMALTTZ', 'DIMALTU', 'DIMALTZ', 'DIMARCSYM',
  'DIMASO', 'DIMASSOC', 'DIMATFIT', 'DIMAUNIT', 'DIMAZIN', 'DIMCLRD', 'DIMCLRE', 'DIMCLRT',
  'DIMDEC', 'DIMDSEP', 'DIMFIT', 'DIMFRAC', 'DIMFXLON', 'DIMJUST', 'DIMLIM', 'DIMLUNIT', 'DIMLWD',
  'DIMLWE', 'DIMSAH', 'DIMSD1', 'DIMSD2', 'DIMSE1', 'DIMSE2', 'DIMSHO', 'DIMSOXD', 'DIMTAD',
  'DIMTDEC', 'DIMTFILL', 'DIMTFILLCLR', 'DIMTIH', 'DIMTIX', 'DIMTMOVE', 'DIMTOFL', 'DIMTOH',
  'DIMTOL', 'DIMTOLJ', 'DIMTXTDIRECTION', 'DIMTZIN', 'DIMUNIT', 'DIMUPT', 'DIMZIN', 'DISPSILH',
  'DRAGMODE', 'DWFFRAME', 'ENDCAPS', 'FILLMODE', 'HALOGAP', 'HANDLING', 'HIDETEXT', 'INDEXCTL',
  'INSUNITS', 'INTERFERECOLOR', 'INTERSECTIONCOLOR', 'INTERSECTIONDISPLAY', 'JOINSTYLE',
  'LIGHTGLYPHDISPLAY', 'LIMCHECK', 'LOFTNORMALS', 'LOFTPARAM', 'LUNITS', 'LUPREC', 'MAXACTVP',
  'MEASUREMENT', 'MIRRTEXT', 'OBSCOLOR', 'OBSLTYPE', 'ORTHOMODE', 'OSMODE', 'PDMODE', 'PELLIPSE',
  'PICKSTYLE', 'PLIMCHECK', 'PLINEGEN', 'PROXYGRAPHICS', 'PSLTSCALE', 'PUCSORTHOVIEW', 'QTEXTMODE',
  'REGENMODE', 'REQUIREDVERSIONS', 'SAVEIMAGES', 'SHADEDGE', 'SHADEDIF', 'SHOWHIST', 'SKPOLY',
  'SOLIDHIST', 'SORTENTS', 'SPLFRAME', 'SPLINESEGS', 'SPLINETYPE', 'SURFTAB1', 'SURFTAB2',
  'SURFTYPE', 'SURFU', 'SURFV', 'TILEMODE', 'TILEMODELIGHTSYNCH', 'TIMEZONE', 'TREEDEPTH',
  'UCSORTHOVIEW', 'UNITMODE', 'USERI1', 'USERI2', 'USERI3', 'USERI4', 'USERI5', 'USRTIMER',
  'VISRETAIN', 'WORLDVIEW', 'XCLIPFRAME',
]);

/**
 * Header variables SETVAR shows but does not set: those AutoCAD keeps read-only (the dates,
 * the extents, ACADVER, DWGCODEPAGE), those a save sets itself, HANDSEED (handles are never
 * renumbered), the UCS (UCS commands own it; renaming its record is not a variable's job),
 * TILEMODE (the layout tabs switch spaces) and the handle-valued ones.
 */
// prettier-ignore
const READ_ONLY_HEADER = new Set([
  'ACADVER', 'ACADMAINTVER', 'DWGCODEPAGE', 'HANDSEED', 'HANDLING', 'LASTSAVEDBY',
  'REQUIREDVERSIONS', 'TDCREATE', 'TDUCREATE', 'TDUPDATE', 'TDUUPDATE', 'TDINDWG', 'TDUSRTIMER',
  'VERSIONGUID', 'FINGERPRINTGUID', 'EXTMIN', 'EXTMAX', 'PEXTMIN', 'PEXTMAX', 'TILEMODE',
  'CMATERIAL', 'INTERFEREOBJVS', 'INTERFEREVPVS', 'CANNOSCALEVALUE',
]);
const READ_ONLY_PATTERN =
  /^P?UCS(NAME|BASE|ORTHOREF|ORG|ORGBACK|ORGBOTTOM|ORGFRONT|ORGLEFT|ORGRIGHT|ORGTOP|XDIR|YDIR|ORTHOVIEW)$/;

/** The header's name variables and the records each names. */
const NAME_VARIABLES: Readonly<Record<string, { table: NameTable; empty?: true }>> = {
  CLAYER: { table: 'layers' },
  CELTYPE: { table: 'linetypes' },
  TEXTSTYLE: { table: 'textStyles' },
  DIMTXSTY: { table: 'textStyles' },
  DIMSTYLE: { table: 'dimStyles' },
  CMLSTYLE: { table: 'mlineStyles' },
  DIMBLK: { table: 'blockRecords', empty: true },
  DIMBLK1: { table: 'blockRecords', empty: true },
  DIMBLK2: { table: 'blockRecords', empty: true },
  DIMLDRBLK: { table: 'blockRecords', empty: true },
  DIMLTYPE: { table: 'linetypes', empty: true },
  DIMLTEX1: { table: 'linetypes', empty: true },
  DIMLTEX2: { table: 'linetypes', empty: true },
};

/** Bounds AutoCAD 2024's system variable reference gives (those a wrong value would break). */
const RANGES: Readonly<Record<string, readonly [number, number]>> = {
  LUNITS: [1, 5],
  LUPREC: [0, 8],
  AUNITS: [0, 4],
  AUPREC: [0, 8],
  ANGDIR: [0, 1],
  ATTMODE: [0, 2],
  ATTREQ: [0, 1],
  ATTDIA: [0, 1],
  FILLMODE: [0, 1],
  MIRRTEXT: [0, 1],
  QTEXTMODE: [0, 1],
  PSLTSCALE: [0, 1],
  PLINEGEN: [0, 1],
  INSUNITS: [0, 24],
  MEASUREMENT: [0, 1],
  DIMDEC: [0, 8],
  DIMADEC: [-1, 8],
  DIMTDEC: [0, 8],
  DIMALTD: [0, 8],
  DIMALTTD: [0, 8],
  DIMASSOC: [0, 2],
  DIMCLRD: [0, 256],
  DIMCLRE: [0, 256],
  DIMCLRT: [0, 256],
  DIMTFILL: [0, 2],
  DIMTFILLCLR: [0, 256],
  DIMTAD: [0, 4],
  DIMJUST: [0, 4],
  DIMATFIT: [0, 3],
  DIMTMOVE: [0, 2],
  DIMLUNIT: [1, 6],
  DIMAUNIT: [0, 4],
  DIMFRAC: [0, 2],
  DIMTOLJ: [0, 2],
  DIMARCSYM: [0, 2],
  STEPSPERSEC: [1, 30],
};

/** Reals AutoCAD takes only above zero, and those it takes from zero up. */
const POSITIVE = new Set(['LTSCALE', 'CELTSCALE', 'TEXTSIZE', 'DIMTXT']);
const NON_NEGATIVE = new Set(['DIMSCALE', 'DIMASZ', 'DIMEXO', 'DIMEXE', 'DIMDLI', 'DIMTSZ']);

const LINEWEIGHT_VARIABLES = new Set(['CELWEIGHT', 'DIMLWD', 'DIMLWE']);

/** AutoCAD's lineweights, hundredths of a millimetre. */
export const LINEWEIGHT_VALUES: readonly number[] = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

/** The variable a header entry is, from the value the drawing holds. */
function headerVariable(key: string, value: HeaderValue): SystemVariable {
  const name = key.startsWith('$') ? key.slice(1) : key;
  const base = { name, store: 'header' as const, key };
  if (READ_ONLY_HEADER.has(name) || READ_ONLY_PATTERN.test(name)) {
    return { ...base, kind: kindOf(name, value), readOnly: true };
  }
  if (!key.startsWith('$')) {
    // AcDbVariableDictionary entries hold text; Triya sets only the one it understands.
    if (key === CETRANSPARENCY) return { ...base, kind: 'transparency' };
    return { ...base, kind: 'text', readOnly: true };
  }
  const named = NAME_VARIABLES[name];
  if (named) {
    return { ...base, kind: 'name', table: named.table, ...(named.empty && { empty: true }) };
  }
  const kind = kindOf(name, value);
  const range = RANGES[name];
  return {
    ...base,
    kind,
    ...(range && { min: range[0], max: range[1] }),
    ...(POSITIVE.has(name) && { positive: true }),
    ...(NON_NEGATIVE.has(name) && { nonNegative: true }),
  };
}

function kindOf(name: string, value: HeaderValue): VariableKind {
  if (name === 'CECOLOR') return 'color';
  if (LINEWEIGHT_VARIABLES.has(name)) return 'lineweight';
  if (name === 'ANGBASE') return 'angle';
  if (typeof value === 'boolean') return 'switch';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'object') return 'point';
  return INTEGER_HEADER_VARIABLES.has(name) ? 'integer' : 'real';
}

/** The header entry a variable's name is kept under, if the drawing has one. */
function headerKey(model: DocumentModel, name: string): string | undefined {
  if (model.header.has(`$${name}`)) return `$${name}`;
  // A bare name is an AcDbVariableDictionary entry; `$` names are not variables of their own.
  return !name.startsWith('$') && model.header.has(name) ? name : undefined;
}

/**
 * The system variable `name` names (any case), or undefined when Triya keeps none of that name:
 * the app's first, then WIPEOUTFRAME, then the drawing's header.
 */
export function systemVariable(model: DocumentModel, name: string): SystemVariable | undefined {
  const n = name.trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(n)) return undefined;
  const app = APP_VARIABLES.find((v) => v.name === n);
  if (app) return app;
  if (n === WIPEOUTFRAME.name) return WIPEOUTFRAME;
  const known = COMPUTED_VARIABLES.find((v) => v.name === n);
  if (known) return known;
  const drawing = DRAWING_VARIABLES.find((v) => v.name === n);
  if (drawing) return drawing;
  const key = headerKey(model, n);
  return key === undefined ? undefined : headerVariable(key, model.header.get(key)!);
}

/** Every variable Triya keeps for this drawing, by name. */
export function systemVariables(model: DocumentModel): SystemVariable[] {
  const out = new Map<string, SystemVariable>();
  for (const key of model.header.keys()) {
    const v = systemVariable(model, key.replace(/^\$/, ''));
    if (v) out.set(v.name, v);
  }
  out.set(WIPEOUTFRAME.name, WIPEOUTFRAME);
  for (const v of [...APP_VARIABLES, ...COMPUTED_VARIABLES, ...DRAWING_VARIABLES]) {
    out.set(v.name, v);
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A variable's value as SETVAR shows and keeps it: numbers, text or a point. */
export type VariableValue =
  number | string | { readonly x: number; readonly y: number; readonly z?: number };

/** The value a header variable holds, as SETVAR shows it (a switch as 0 or 1, an angle in degrees). */
export function headerValue(v: SystemVariable, value: HeaderValue): VariableValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (v.kind === 'angle' && typeof value === 'number') return (value * 180) / Math.PI;
  return value;
}

/** The header value SETVAR's `value` is kept as: the type the drawing holds it in. */
export function headerEntry(
  v: SystemVariable,
  value: VariableValue,
  was: HeaderValue | undefined,
): HeaderValue {
  if (typeof was === 'boolean') return value === 1;
  if (v.kind === 'angle' && typeof value === 'number') return (value * Math.PI) / 180;
  if (typeof value === 'object' && was && typeof was === 'object' && 'z' in was) {
    return { x: value.x, y: value.y, z: value.z ?? 0 };
  }
  if (typeof value === 'object') return { x: value.x, y: value.y };
  return value;
}

/** Formatting of shown values: LUPREC places for reals and points, AUPREC for angles. */
export interface ValueFormat {
  readonly precision: number;
  readonly anglePrecision: number;
}

const COLOR_NAMES = ['RED', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'MAGENTA', 'WHITE'];

/** A value as the command line shows it: `0`, `1.0000`, `"Standard"`, `0.0000,0.0000`. */
export function formatValue(v: SystemVariable, value: VariableValue, f: ValueFormat): string {
  if (typeof value === 'object') {
    const xs = [value.x, value.y, ...(value.z === undefined ? [] : [value.z])];
    return xs.map((x) => formatNumber(x, f.precision)).join(',');
  }
  if (typeof value === 'string') return `"${value}"`;
  switch (v.kind) {
    case 'color':
      return `"${value === 256 ? 'BYLAYER' : value === 0 ? 'BYBLOCK' : value}"`;
    case 'angle':
      return formatNumber(value, f.anglePrecision);
    case 'real':
      return formatNumber(value, v.places ?? f.precision);
    default:
      return formatNumber(value, 0);
  }
}

/** What typed text sets a variable to, or why it cannot. */
export type ParsedValue = { readonly value: VariableValue } | { readonly problem: string };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

const between = (v: SystemVariable): string => `Value must be between ${v.min} and ${v.max}.`;

/** A record's name as its table spells it, or undefined when it has none of that name. */
function recordName(model: DocumentModel, table: NameTable, typed: string): string | undefined {
  const key = typed.toUpperCase();
  for (const r of model.tables[table].values()) {
    if (r.name.toUpperCase() === key) return r.name;
  }
  return undefined;
}

const TABLE_WORDS: Readonly<Record<NameTable, string>> = {
  layers: 'layer',
  linetypes: 'linetype',
  textStyles: 'text style',
  dimStyles: 'dimension style',
  blockRecords: 'block',
  mlineStyles: 'multiline style',
};

/** Typed text as a value of `v` (not a point: a point prompt parses those). */
export function parseValue(model: DocumentModel, v: SystemVariable, text: string): ParsedValue {
  const t = text.trim();
  switch (v.kind) {
    case 'text':
      // "." sets text to nothing, as AutoCAD takes it (DIMPOST, DIMAPOST).
      return { value: t === '.' ? '' : text };
    case 'name': {
      if (t === '.' || t === '') {
        return v.empty ? { value: '' } : { problem: `${v.name} cannot name nothing.` };
      }
      const name = recordName(model, v.table!, t);
      if (name === undefined) return { problem: `No ${TABLE_WORDS[v.table!]} named "${t}".` };
      if (v.table === 'layers') {
        const layer = [...model.tables.layers.values()].find((l) => l.name === name);
        if (layer?.frozen) return { problem: 'Cannot set a frozen layer current.' };
      }
      return { value: name };
    }
    case 'color': {
      const u = t.toUpperCase();
      if (u === 'BYLAYER') return { value: 256 };
      if (u === 'BYBLOCK') return { value: 0 };
      const named = COLOR_NAMES.indexOf(u);
      if (named >= 0) return { value: named + 1 };
      const n = Number(t);
      if (NUMBER.test(t) && Number.isInteger(n) && n >= 0 && n <= 256) return { value: n };
      return { problem: 'Invalid color.' };
    }
    case 'transparency': {
      const u = t.toUpperCase();
      if (u === 'BYLAYER') return { value: 'ByLayer' };
      if (u === 'BYBLOCK') return { value: 'ByBlock' };
      const n = Number(t);
      if (NUMBER.test(t) && Number.isInteger(n) && n >= 0 && n <= 90) return { value: String(n) };
      return { problem: 'Value must be ByLayer, ByBlock or between 0 and 90.' };
    }
    default:
      break;
  }
  if (!NUMBER.test(t)) {
    return {
      problem:
        v.kind === 'integer' || v.kind === 'switch' || v.kind === 'lineweight'
          ? 'Requires an integer value.'
          : 'Requires numeric value.',
    };
  }
  const n = Number(t);
  switch (v.kind) {
    case 'switch':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      return n === 0 || n === 1 ? { value: n } : { problem: 'Value must be between 0 and 1.' };
    case 'lineweight':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      return n === -1 || n === -2 || n === -3 || LINEWEIGHT_VALUES.includes(n)
        ? { value: n }
        : { problem: 'Invalid lineweight.' };
    case 'integer':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      // DXF keeps these in 16 bits (group codes 70, 280): what AutoCAD's integers hold.
      if (v.min === undefined && (n < -32768 || n > 32767)) {
        return { problem: 'Value must be between -32768 and 32767.' };
      }
      break;
    default:
      break;
  }
  if (v.choices && !v.choices.includes(n)) {
    return { problem: `Value must be one of ${v.choices.join(', ')}.` };
  }
  if (v.min !== undefined && v.max !== undefined && (n < v.min || n > v.max)) {
    return { problem: between(v) };
  }
  if (v.positive && !(n > 0)) return { problem: 'Value must be positive and nonzero.' };
  if (v.nonNegative && n < 0) return { problem: 'Value must be positive or zero.' };
  return { value: n };
}
