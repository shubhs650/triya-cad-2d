// TABLESTYLE (TS; M4-05 part 5): AutoCAD 2024's Table Style dialog and its New and Modify Table
// Style dialog (AutoCAD Help, "TABLESTYLE (Command)", "Table Style Dialog Box", "Create New Table
// Style Dialog Box", "New and Modify Table Style Dialog Boxes").
//
// The dialog lists the drawing's table styles (all, or those in use) with the current one
// (CTABLESTYLE) and its description; Set Current, New..., Modify... and Delete, and the list's
// shortcut menu (Set current, Rename, Delete), act on the style selected. New asks a name and the
// style to start with, then opens the style's settings; Modify opens the selected style's. Each
// action is made at once and the dialog opens again on the style it left selected; Close ends
// the command, everything it did one undo step.
//
// The settings are the table direction and, for each of the Data, Header and Title cell styles,
// the General tab's fill colour, alignment and margins, the Text tab's text style, height and
// colour, and the Borders tab's lineweight, linetype, colour, double line and its spacing, and
// which borders show (the linetype and double line since M4-16 part 8). A modified style's
// tables are drawn again in it (their `*T` blocks), each row growing to hold its text at the new
// height, as AutoCAD updates them; a row never shrinks, as when a cell's text is edited.
//
// Where the drawing's file has no place for a setting it is shown and not changed: a TABLESTYLE
// before R2010 (and the DXF, which AutoCAD writes in that form) holds one horizontal and one
// vertical margin for the whole style, so the margins are the style's, shown on each cell style;
// it holds no text angle, cell format other than the data and unit types, or "merge cells on
// row/column creation" setting of its own; a border's linetype and double line are kept in the
// named cell styles beside it (io export/table-styles.ts). A DXF table style
// holds index colours only, so true colours are refused.
//
// Cell styles of the drafter's own (M4-16 part 9): the Cell styles list has, after Data, Header
// and Title, those the style holds, with Create a new cell style (a name and the cell style to
// start with) and Manage Cell Styles (New, Rename, Delete) beside it, as AutoCAD's. They are made,
// renamed and deleted in the dialog and sent with its settings (`userCellStyles`); OK gives a new
// one the next free id (101 and up, as AutoCAD numbers them), which a table's rows and cells name
// it by, so a rename leaves the tables as they are. One a table of the style is on cannot be
// deleted. Each has the General, Text and Borders settings of the three, the margins the style's.
//
// Select table to start from (M4-16 part 4) hides the dialogs and asks "Select a table:"; the
// New or Modify Table Style dialog then opens again on the table's formatting (`tableStartSettings`),
// which OK makes the style's. AutoCAD also keeps the table's structure and contents in the style
// as a template for new tables (with Remove Table to drop it); a DXF table style has no place
// Triya writes for that template, so only the formatting is taken (noted in the PR).
//
// A drawing with no table style lists AutoCAD's Standard, which the first New, Modify or Set
// Current adds, as TABLE adds it. A drawing that keeps no CTABLESTYLE variable (one AutoCAD did
// not save) keeps Standard current: a save cannot add the variable (header.ts). AutoCAD has no
// -TABLESTYLE; SETVAR CTABLESTYLE makes a style current at the command line.
import type { CommandContext, CommandDef } from './command';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  Color,
  Lineweight,
  TableBorderFormat,
  TableCellBorder,
  TableCellStyle,
  TableGeometry,
  TableStyleRecord,
  TableUserCellStyle,
} from '../model/types';
import type { Prompt, PromptAnswer } from './prompt';
import {
  tableCellText,
  tableParts,
  tableRangeHeads,
  tableRowStyles,
  type TablePart,
} from '../annotation/table';
import {
  currentTableStyle,
  fitTableRow,
  newTableGeometry,
  standardTableStyle,
  tableDrawingOf,
  withCellText,
  writeTableBlock,
} from '../edit/table';
import { validViewName } from '../edit/named-view';
import { LINEWEIGHTS } from '../properties/sheet';
import { linesOf } from './draw/table-cells';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The cell styles every table style has: the rows of the file's record. */
export const TABLE_CELL_STYLES = ['data', 'header', 'title'] as const;

/** Where each cell style sits in the record's `cellStyles` (the file's order data, title, header). */
const STYLE_INDEX: Readonly<Record<(typeof TABLE_CELL_STYLES)[number], number>> = {
  data: 0,
  title: 1,
  header: 2,
};

/** One cell style as the New and Modify Table Style dialog shows it. */
export interface TableCellStyleSettings {
  /** General, Fill color: null for None. */
  readonly fill: Color | null;
  /** General, Alignment: 1 top left … 9 bottom right. */
  readonly alignment: number;
  /** Text, Text style: the text style's name. */
  readonly textStyle: string;
  readonly textHeight: number;
  readonly textColor: Color;
  /** Borders, in the order top, inside horizontal, bottom, left, inside vertical, right. */
  readonly borders: readonly TableCellBorder[];
}

/** A cell style of the drafter's own as the New and Modify Table Style dialog shows it. */
export interface TableUserCellStyleSettings {
  /** Its id in the style; absent for one made in the dialog, which OK gives the next free id. */
  readonly id?: number;
  readonly name: string;
  readonly settings: TableCellStyleSettings;
}

/** What the New and Modify Table Style dialog shows of a style. */
export interface TableStyleSettings {
  readonly description: string;
  /** General, Table direction: Up (the title row at the bottom) or Down. */
  readonly up: boolean;
  /** The style's cell margins (General, Margins), the same for each cell style. */
  readonly horizontalMargin: number;
  readonly verticalMargin: number;
  readonly data: TableCellStyleSettings;
  readonly header: TableCellStyleSettings;
  readonly title: TableCellStyleSettings;
  /** The cell styles of the drafter's own, in the style's order (M4-16 part 9). */
  readonly userCellStyles?: readonly TableUserCellStyleSettings[];
}

/** One style in the dialog's list. */
export interface TableStyleRow {
  readonly name: string;
  readonly settings: TableStyleSettings;
  /** A table uses it ("Styles in use"). */
  readonly used: boolean;
  /** AutoCAD's Standard, listed for a drawing without table styles until an action adds it. */
  readonly unsaved?: true;
  /** The ids of its cell styles of the drafter's own that a table's rows or cells are on. */
  readonly usedCellStyles?: readonly number[];
}

/** The Table Style dialog as TABLESTYLE opens it. */
export interface TableStyleRequest {
  readonly type: 'tablestyle';
  readonly styles: readonly TableStyleRow[];
  /** CTABLESTYLE's style. */
  readonly current: string;
  readonly selected: string;
  /** The drawing's text styles, for the Text tab's Text style list. */
  readonly textStyles: readonly string[];
  /** The drawing's linetypes, for the Borders tab's Linetype list (beside ByBlock and ByLayer). */
  readonly linetypes: readonly { readonly name: string; readonly handle: Handle }[];
  /** The Borders tab's Spacing for a border not yet double: AutoCAD's 0.045, in the drawing's units. */
  readonly doubleSpacing: number;
  /** Why the last action did nothing ("The current table style cannot be deleted."). */
  readonly note?: string;
  /**
   * The New or Modify Table Style dialog to open again at once, on these settings: after Select
   * table to start from, on the table's formatting (or the settings it left, when none was picked).
   */
  readonly editing?: TableStyleEditing;
}

/** The New or Modify Table Style dialog being worked in: the style's name and its settings. */
export interface TableStyleEditing {
  readonly name: string;
  /** New Table Style (OK makes the style), else Modify Table Style. */
  readonly isNew: boolean;
  readonly settings: TableStyleSettings;
}

/** What a Table Style dialog button or shortcut menu choice asks of TABLESTYLE. */
export type TableStyleAction =
  | { readonly op: 'current'; readonly name: string }
  /** New...'s name, with the settings its New Table Style dialog closed on. */
  | { readonly op: 'new'; readonly name: string; readonly settings: TableStyleSettings }
  | { readonly op: 'modify'; readonly name: string; readonly settings: TableStyleSettings }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string }
  /** Select table to start from, in the New or Modify Table Style dialog on these settings. */
  | ({ readonly op: 'start' } & TableStyleEditing);

const upper = (s: string) => s.toUpperCase();
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const BY_BLOCK: Color = { kind: 'byBlock' };
const UNFILLED: Color = { kind: 'aci', index: 7 };
const EDGES = 6;

/** The text style a cell style names, else the drawing's Standard (what the table engine draws). */
function textStyleName(model: DocumentModel, h: Handle | undefined): string {
  const styles = [...model.tables.textStyles.values()];
  const named = h !== undefined ? model.tables.textStyles.get(h) : undefined;
  return (named ?? styles.find((s) => upper(s.name) === 'STANDARD') ?? styles[0])?.name ?? '';
}

function cellSettings(model: DocumentModel, c: TableCellStyle | undefined): TableCellStyleSettings {
  const border = (k: number): TableCellBorder =>
    c?.borders[k] ?? { lineweight: 'ByBlock', visible: true, color: BY_BLOCK };
  return {
    fill: c?.fillOn ? c.fillColor : null,
    alignment: c?.alignment ?? 1,
    textStyle: textStyleName(model, c?.textStyle),
    textHeight: c?.textHeight ?? 0.18,
    textColor: c?.textColor ?? BY_BLOCK,
    borders: Array.from({ length: EDGES }, (_, k) => border(k)),
  };
}

/** A style as the New and Modify Table Style dialog shows it. */
export function tableStyleSettings(
  model: DocumentModel,
  s: Omit<TableStyleRecord, 'handle'>,
): TableStyleSettings {
  const cell = (n: (typeof TABLE_CELL_STYLES)[number]) =>
    cellSettings(model, s.cellStyles[STYLE_INDEX[n]]);
  const own = s.userCellStyles ?? [];
  return {
    description: s.description,
    up: s.flowDirection === 1,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
    data: cell('data'),
    header: cell('header'),
    title: cell('title'),
    ...(own.length > 0 && {
      userCellStyles: own.map((c) => ({
        id: c.id,
        name: c.name,
        settings: cellSettings(model, c),
      })),
    }),
  };
}

const isIndexColor = (c: unknown): c is Color => {
  if (typeof c !== 'object' || c === null) return false;
  const v = c as { kind?: unknown; index?: unknown };
  if (v.kind === 'byBlock' || v.kind === 'byLayer') return true;
  return (
    v.kind === 'aci' && typeof v.index === 'number' && Number.isInteger(v.index) && v.index >= 1
  );
};
const isAnyColor = (c: unknown): boolean =>
  typeof c === 'object' && c !== null && (isIndexColor(c) || (c as Color).kind === 'rgb');
const isLineweight = (w: unknown): w is Lineweight =>
  w === 'ByBlock' || w === 'ByLayer' || (typeof w === 'number' && LINEWEIGHTS.includes(w));

/** Whether the bus brought settings the dialog can give (it takes any object). */
function wellFormed(s: unknown): s is TableStyleSettings {
  if (typeof s !== 'object' || s === null) return false;
  const v = s as Record<string, unknown>;
  const cell = (c: unknown): boolean => {
    if (typeof c !== 'object' || c === null) return false;
    const x = c as Record<string, unknown>;
    return (
      (x.fill === null || isAnyColor(x.fill)) &&
      typeof x.alignment === 'number' &&
      typeof x.textStyle === 'string' &&
      typeof x.textHeight === 'number' &&
      isAnyColor(x.textColor) &&
      Array.isArray(x.borders) &&
      x.borders.length === EDGES &&
      x.borders.every(
        (b: unknown) =>
          typeof b === 'object' &&
          b !== null &&
          typeof (b as TableCellBorder).visible === 'boolean' &&
          isAnyColor((b as TableCellBorder).color) &&
          ['undefined', 'string'].includes(typeof (b as TableCellBorder).linetype) &&
          [undefined, true].includes((b as TableCellBorder).double) &&
          ['undefined', 'number'].includes(typeof (b as TableCellBorder).spacing),
      )
    );
  };
  const own = (u: unknown): boolean => {
    if (typeof u !== 'object' || u === null) return false;
    const x = u as Record<string, unknown>;
    return (
      (x.id === undefined || (typeof x.id === 'number' && Number.isInteger(x.id))) &&
      typeof x.name === 'string' &&
      cell(x.settings)
    );
  };
  return (
    typeof v.description === 'string' &&
    typeof v.up === 'boolean' &&
    typeof v.horizontalMargin === 'number' &&
    typeof v.verticalMargin === 'number' &&
    TABLE_CELL_STYLES.every((n) => cell(v[n])) &&
    (v.userCellStyles === undefined ||
      (Array.isArray(v.userCellStyles) && v.userCellStyles.every(own)))
  );
}

const CELL_LABEL: Readonly<Record<(typeof TABLE_CELL_STYLES)[number], string>> = {
  data: 'Data',
  header: 'Header',
  title: 'Title',
};

/** Why settings cannot be a style's, or undefined. */
export function tableStyleProblem(
  s: TableStyleSettings,
  textStyles: readonly string[],
  /** The linetypes a border may take (`TableStyleRequest.linetypes`), beside ByLayer. */
  linetypes?: readonly Handle[],
): string | undefined {
  for (const k of ['horizontalMargin', 'verticalMargin'] as const) {
    if (!(Number.isFinite(s[k]) && s[k] >= 0)) return 'A cell margin must be 0 or more.';
  }
  const names = new Set(textStyles.map(upper));
  const cellProblem = (c: TableCellStyleSettings, label: string): string | undefined => {
    const where = `${label} cell style: `;
    if (!(Number.isFinite(c.textHeight) && c.textHeight > 0))
      return `${where}the text height must be greater than 0.`;
    if (!Number.isInteger(c.alignment) || c.alignment < 1 || c.alignment > 9)
      return `${where}choose an alignment.`;
    if (!names.has(upper(c.textStyle))) return `${where}choose a text style of the drawing.`;
    // A DXF TABLESTYLE writes index colours only (io export/table-styles.ts).
    const colors = [c.fill, c.textColor, ...c.borders.map((b) => b.color)];
    if (colors.some((x) => x !== null && !isIndexColor(x)))
      return `${where}a table style takes index colors only.`;
    if (c.borders.some((b) => !isLineweight(b.lineweight)))
      return `${where}choose a lineweight from the list.`;
    const linetype = (l: string) => l === 'ByLayer' || (linetypes?.includes(l) ?? true);
    if (c.borders.some((b) => b.linetype !== undefined && !linetype(b.linetype)))
      return `${where}choose a linetype of the drawing.`;
    if (c.borders.some((b) => b.double && !(Number.isFinite(b.spacing) && b.spacing! > 0)))
      return `${where}the double line spacing must be greater than 0.`;
    return undefined;
  };
  for (const n of TABLE_CELL_STYLES) {
    const p = cellProblem(s[n], CELL_LABEL[n]);
    if (p) return p;
  }
  const own = s.userCellStyles ?? [];
  for (const [k, u] of own.entries()) {
    const p =
      cellStyleNameProblem(
        u.name,
        own.filter((_, m) => m !== k).map((o) => o.name),
      ) ?? cellProblem(u.settings, `The “${u.name}”`);
    if (p) return p;
  }
  return undefined;
}

/**
 * The names a cell style of the drafter's own cannot take: the three every style holds, by their
 * dialog names and the names a file gives them (`_TITLE`, `_HEADER`, `_DATA`), and the "Table"
 * cell style a DWG from R2010 keeps the table-wide settings in.
 */
const RESERVED_CELL_STYLES = ['TITLE', 'HEADER', 'DATA', '_TITLE', '_HEADER', '_DATA', 'TABLE'];

/**
 * Why `name` cannot name a cell style of the drafter's own beside `others` (the style's other
 * ones), or undefined (AutoCAD's Create New Cell Style and Manage Cell Styles; M4-16 part 9).
 */
export function cellStyleNameProblem(name: string, others: readonly string[]): string | undefined {
  const n = name.trim();
  if (n === '' || n !== name || !validViewName(n) || n.includes('|'))
    return 'Invalid cell style name.';
  if (RESERVED_CELL_STYLES.includes(upper(n)) || others.some((o) => upper(o) === upper(n)))
    return 'A cell style with this name already exists.';
  return undefined;
}

/** The drawing's table style named `name` (any case), else the unsaved Standard by its name. */
function styleNamed(model: DocumentModel, name: unknown): TableStyleRecord | undefined {
  if (typeof name !== 'string') return undefined;
  return listedStyles(model).find((s) => upper(s.name) === upper(name));
}

/** The text style a table style made in the drawing names: Standard, else the first. */
function standardText(model: DocumentModel): Handle | undefined {
  const styles = [...model.tables.textStyles.values()];
  return (styles.find((s) => upper(s.name) === 'STANDARD') ?? styles[0])?.handle;
}

/** AutoCAD's Standard as TABLE adds it to a drawing without table styles; undefined otherwise. */
function unsavedStandard(model: DocumentModel): TableStyleRecord | undefined {
  if (model.tables.tableStyles.size > 0 || model.tables.textStyles.size === 0) return undefined;
  const metric = model.meta.measurement !== 'imperial';
  return { handle: '', ...standardTableStyle(metric, standardText(model)) };
}

/** The styles the dialog lists: the drawing's, else the unsaved Standard. */
function listedStyles(model: DocumentModel): TableStyleRecord[] {
  const standard = unsavedStandard(model);
  return standard ? [standard] : [...model.tables.tableStyles.values()];
}

/** The table styles tables use (in any block). */
export function usedTableStyles(model: DocumentModel): Set<Handle> {
  const out = new Set<Handle>();
  for (const e of model.entities()) {
    if (e.geom.kind === 'ACAD_TABLE' && e.geom.style !== undefined) out.add(e.geom.style);
  }
  return out;
}

/** The dialog as it opens on `selected`. */
export function tableStyleRequest(
  model: DocumentModel,
  selected?: string,
  note?: string,
  editing?: TableStyleEditing,
): TableStyleRequest {
  const listed = listedStyles(model).sort((a, b) => byName(a.name, b.name));
  const used = usedTableStyles(model);
  const current = currentTableStyle(model) ?? unsavedStandard(model);
  const shown = selected === undefined ? undefined : styleNamed(model, selected);
  return {
    type: 'tablestyle',
    styles: listed.map((s) => {
      const inUse = s.handle === '' ? [] : [...cellStylesInUse(model, s.handle)];
      return {
        name: s.name,
        settings: tableStyleSettings(model, s),
        used: used.has(s.handle),
        ...(s.handle === '' && { unsaved: true as const }),
        ...(inUse.length > 0 && { usedCellStyles: inUse.sort((a, b) => a - b) }),
      };
    }),
    current: current?.name ?? '',
    selected: shown?.name ?? current?.name ?? listed[0]?.name ?? '',
    textStyles: [...model.tables.textStyles.values()]
      .filter((s) => ((s.flags ?? 0) & 1) === 0)
      .map((s) => s.name)
      .sort(byName),
    linetypes: borderLinetypes(model),
    // Every corpus table style's borders state 0.045 (imperial); a metric drawing's is in mm.
    doubleSpacing: model.meta.measurement === 'imperial' ? 0.045 : 1.125,
    ...(note !== undefined && { note }),
    ...(editing !== undefined && { editing }),
  };
}

/**
 * The linetypes a border may take: the drawing's, but ByBlock and ByLayer (offered by name) and
 * linetypes of xrefs, in the order the file lists them.
 */
function borderLinetypes(model: DocumentModel): { name: string; handle: Handle }[] {
  return [...model.tables.linetypes.values()]
    .filter((l) => !['BYBLOCK', 'BYLAYER'].includes(upper(l.name)) && !l.name.includes('|'))
    .map((l) => ({ name: l.name, handle: l.handle }));
}

const NAME_IN_USE = 'A table style with this name already exists.';
const NAME_INVALID = 'Invalid table style name.';

/** Why `name` cannot name a new or renamed style (`except`: the style being renamed). */
function nameProblem(model: DocumentModel, name: string, except?: Handle): string | undefined {
  if (!validViewName(name) || name.includes('|')) return NAME_INVALID;
  const other = styleNamed(model, name);
  return other && other.handle !== except ? NAME_IN_USE : undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The text style handle the settings name; `was` kept while it is the one the dialog showed. */
function textStyleHandle(model: DocumentModel, name: string, was: Handle | undefined) {
  if (upper(textStyleName(model, was)) === upper(name)) return was;
  for (const s of model.tables.textStyles.values())
    if (upper(s.name) === upper(name)) return s.handle;
  return was;
}

/** Cell style `c` given the settings `s` (what the file holds and the dialog does not, kept). */
function cellStyleOf(
  model: DocumentModel,
  c: TableCellStyle | undefined,
  s: TableCellStyleSettings,
  fresh: boolean,
): TableCellStyle {
  const textStyle = textStyleHandle(model, s.textStyle, c?.textStyle);
  const fillOn = s.fill !== null;
  return {
    ...(textStyle !== undefined && { textStyle }),
    textHeight: s.textHeight,
    alignment: s.alignment,
    textColor: s.textColor,
    // A style left unfilled keeps the colour it holds; one turned off, or a new one, holds ACI 7,
    // as AutoCAD's Standard does (and an R2010+ cell style reads back as, io table-styles.ts).
    fillColor: s.fill ?? (c && !c.fillOn && !fresh ? c.fillColor : UNFILLED),
    fillOn,
    dataType: c?.dataType ?? 0,
    unitType: c?.unitType ?? 0,
    borders: s.borders.map(styleBorder),
  };
}

/**
 * A border as the settings give it: ByBlock is no linetype, and a spacing is kept on a double
 * line only, as io maps a named cell style's border (M4-16 part 8).
 */
function styleBorder(b: TableCellBorder): TableCellBorder {
  return {
    lineweight: b.lineweight,
    visible: b.visible,
    color: b.color,
    ...(b.linetype !== undefined && b.linetype !== 'ByBlock' && { linetype: b.linetype }),
    ...(b.double && { double: true as const, spacing: b.spacing! }),
  };
}

/** The record fields the settings set; `userCellStyles` undefined when the style has none. */
type RecordFields = Pick<
  TableStyleRecord,
  'description' | 'flowDirection' | 'horizontalMargin' | 'verticalMargin' | 'cellStyles'
> & { readonly userCellStyles: readonly TableUserCellStyle[] | undefined };

/** The record fields `s` sets on `was`. */
function recordFields(
  model: DocumentModel,
  was: Omit<TableStyleRecord, 'handle' | 'name'>,
  s: TableStyleSettings,
  fresh = false,
): RecordFields {
  const cellStyles = [...was.cellStyles];
  for (const n of TABLE_CELL_STYLES) {
    const k = STYLE_INDEX[n];
    cellStyles[k] = cellStyleOf(model, was.cellStyles[k], s[n], fresh);
  }
  const userCellStyles = userCellStylesOf(model, was.userCellStyles ?? [], s, fresh);
  return {
    description: s.description,
    flowDirection: s.up ? 1 : 0,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
    cellStyles,
    userCellStyles,
  };
}

/** The first id AutoCAD gives a cell style of the drafter's own (the three are 1 to 3). */
const FIRST_USER_ID = 101;

/**
 * The cell styles of the drafter's own the settings give, over `was` (the style's): one keeping
 * its id keeps what the file holds and the dialog does not; a new one takes the next id after
 * every one the style holds or held (`fresh`: a new style, whose ids are its own).
 */
function userCellStylesOf(
  model: DocumentModel,
  was: readonly TableUserCellStyle[],
  s: TableStyleSettings,
  fresh: boolean,
): TableUserCellStyle[] | undefined {
  const own = s.userCellStyles ?? [];
  if (own.length === 0) return undefined;
  const kept = new Map(fresh ? [] : was.map((c) => [c.id, c]));
  let next =
    Math.max(FIRST_USER_ID - 1, ...[...kept.keys()], ...own.map((u) => (fresh ? 0 : (u.id ?? 0)))) +
    1;
  const ids = new Set<number>();
  return own.map((u) => {
    const c = u.id !== undefined && !ids.has(u.id) ? kept.get(u.id) : undefined;
    const id = c ? u.id! : fresh && u.id !== undefined && !ids.has(u.id) ? u.id : next++;
    ids.add(id);
    const made = cellStyleOf(model, c, u.settings, !c);
    // A new one names its text style, as a written cell style must (one read without keeps none).
    const textStyle =
      made.textStyle ??
      (c
        ? undefined
        : (textStyleHandle(model, u.settings.textStyle, undefined) ?? standardText(model)));
    return { id, name: u.name, ...made, ...(textStyle !== undefined && { textStyle }) };
  });
}

/** The record patch that sets `s` on `style`; undefined when it changes nothing. */
function changedFields(model: DocumentModel, style: TableStyleRecord, s: TableStyleSettings) {
  const f = recordFields(model, style, s);
  const patch: Partial<typeof f> = {};
  for (const k of Object.keys(f) as (keyof typeof f)[]) {
    if (!same(f[k], style[k])) (patch as Record<string, unknown>)[k] = f[k];
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** A new style named `name` with `s`, from `from`'s fields beside them (none of its links). */
function newStyle(
  model: DocumentModel,
  name: string,
  s: TableStyleSettings,
  from: TableStyleRecord | undefined,
): Omit<TableStyleRecord, 'handle'> {
  const metric = model.meta.measurement !== 'imperial';
  const base = standardTableStyle(metric, standardText(model));
  const fields = from
    ? {
        styleFlags: from.styleFlags,
        suppressTitle: from.suppressTitle,
        suppressHeader: from.suppressHeader,
        cellStyles: from.cellStyles,
      }
    : {};
  const was = { ...base, ...fields };
  const { userCellStyles, ...set } = recordFields(model, was, s, true);
  return { ...was, name, ...set, ...(userCellStyles && { userCellStyles }) };
}

/** The ids of the cell styles of the drafter's own the rows and cells of style `handle`'s tables are on. */
export function cellStylesInUse(model: DocumentModel, handle: Handle): Set<number> {
  const out = new Set<number>();
  for (const e of model.entities()) {
    const g = e.geom;
    if (g.kind !== 'ACAD_TABLE' || g.style !== handle) continue;
    for (const t of g.rowStyles ?? []) if (typeof t === 'number') out.add(t);
    for (const row of g.cells)
      for (const c of row) if (typeof c.cellStyle === 'number') out.add(c.cellStyle);
  }
  return out;
}

/** The tables drawn in style `handle`. */
function tablesIn(model: DocumentModel, handle: Handle): EntityId[] {
  const out: EntityId[] = [];
  for (const e of model.entities()) {
    if (e.geom.kind === 'ACAD_TABLE' && e.geom.style === handle) out.push(e.id);
  }
  return out;
}

/**
 * Table `g` with each row grown to hold its cells' text as `style` draws it, the renderer
 * measuring the text (one line where it cannot): AutoCAD keeps a row as high as its text and
 * the margins, and never shrinks one here, as the cell editor's fit does not.
 */
export async function restyledTable(
  ctx: CommandContext,
  g: TableGeometry,
  style: TableStyleRecord | undefined,
): Promise<TableGeometry> {
  const drawing = tableDrawingOf(ctx.model);
  const heads = tableRangeHeads(g);
  let out = g;
  for (const [i, row] of g.cells.entries()) {
    for (const j of row.keys()) {
      const [hi, hj] = heads[i]![j]!;
      if (hi !== i || hj !== j) continue;
      const lines = await linesOf(ctx, tableCellText(out, style, drawing, i, j));
      out = fitTableRow(out, style, i, j, lines ?? 1);
    }
  }
  return out;
}

/** Draws again the tables of style `handle` as it is now (`style`), their rows fitted. */
async function redrawTables(
  ctx: CommandContext,
  handle: Handle,
  style: TableStyleRecord,
): Promise<Map<EntityId, TableGeometry>> {
  const out = new Map<EntityId, TableGeometry>();
  for (const id of tablesIn(ctx.model, handle)) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind !== 'ACAD_TABLE') continue;
    out.set(id, await restyledTable(ctx, g, style));
  }
  return out;
}

/** Writes the fitted tables and their blocks into the change being built. */
function writeTables(
  b: ChangeSetBuilder,
  model: DocumentModel,
  tables: Map<EntityId, TableGeometry>,
) {
  for (const [id, g] of tables) {
    if (!same(b.entity(id)?.geom, g)) b.updateEntity(id, { geom: g });
    writeTableBlock(b, model, id);
  }
}

/** Adds the unsaved Standard, if the drawing still lists it; its handle. */
function addStandard(b: ChangeSetBuilder, model: DocumentModel): Handle | undefined {
  const standard = unsavedStandard(model);
  if (!standard) return undefined;
  const { handle: _h, ...rest } = standard;
  return b.addTableRecord('tableStyles', rest).handle;
}

/** Makes `a`; what to show next (the style left selected, a refusal). */
async function act(
  ctx: CommandContext,
  a: TableStyleAction,
): Promise<{ selected?: string; note?: string }> {
  const model = ctx.model;
  const { textStyles } = tableStyleRequest(model);
  const linetypes = borderLinetypes(model).map((l) => l.handle);
  const current = currentTableStyle(model) ?? unsavedStandard(model);
  switch (a.op) {
    case 'current': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (s.handle === current?.handle) return { selected: s.name };
      const variable = model.header.get('CTABLESTYLE');
      if (variable === undefined)
        return {
          selected: s.name,
          note: 'This drawing keeps no CTABLESTYLE variable, so another style cannot be made current.',
        };
      ctx.edit((b) => b.setHeader('CTABLESTYLE', s.name));
      return { selected: s.name };
    }
    case 'new': {
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (!wellFormed(a.settings)) return {};
      if (model.tables.textStyles.size === 0)
        return { note: 'The drawing has no text style, which a table style needs.' };
      const problem =
        nameProblem(model, name) ?? tableStyleProblem(a.settings, textStyles, linetypes);
      if (problem) return { note: problem };
      // The record of the style shown when New... was chosen gives what the dialog does not.
      const from = current?.handle === '' ? undefined : current;
      ctx.edit((b) => {
        addStandard(b, model);
        b.addTableRecord('tableStyles', newStyle(model, name, a.settings, from));
      });
      return { selected: name };
    }
    case 'modify': {
      const s = styleNamed(model, a.name);
      if (!s || !wellFormed(a.settings)) return {};
      const problem = tableStyleProblem(a.settings, textStyles, linetypes);
      if (problem) return { selected: s.name, note: problem };
      const patch = changedFields(model, s, a.settings);
      if (!patch) return { selected: s.name };
      // A cell style of the drafter's own a table is on stays (Manage Cell Styles' Delete).
      const inUse = 'userCellStyles' in patch ? cellStylesInUse(model, s.handle) : new Set();
      const gone = (s.userCellStyles ?? []).find(
        (c) => inUse.has(c.id) && !patch.userCellStyles?.some((u) => u.id === c.id),
      );
      if (gone)
        return {
          selected: s.name,
          note: `The cell style “${gone.name}” is in use by a table and cannot be deleted.`,
        };
      if (s.handle === '') {
        ctx.edit((b) => {
          const made = addStandard(b, model)!;
          b.updateTableRecord('tableStyles', made, patch);
        });
        return { selected: s.name };
      }
      const { userCellStyles, ...rest } = { ...s, ...patch };
      const after = { ...rest, ...(userCellStyles && { userCellStyles }) };
      const tables = await redrawTables(ctx, s.handle, after);
      ctx.edit((b) => {
        b.updateTableRecord('tableStyles', s.handle, patch);
        writeTables(b, model, tables);
      });
      return { selected: s.name };
    }
    case 'rename': {
      const s = styleNamed(model, a.name);
      const to = typeof a.to === 'string' ? a.to.trim() : '';
      if (!s) return {};
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be renamed.' };
      if (to === s.name) return { selected: s.name };
      const problem = nameProblem(model, to, s.handle);
      if (problem) return { selected: s.name, note: problem };
      ctx.edit((b) => {
        b.updateTableRecord('tableStyles', s.handle, { name: to });
        // CTABLESTYLE names the current style, and follows its rename (M1-95).
        const variable = model.header.get('CTABLESTYLE');
        if (typeof variable === 'string' && upper(variable) === upper(s.name))
          b.setHeader('CTABLESTYLE', to);
      });
      return { selected: to };
    }
    case 'delete': {
      const s = styleNamed(model, a.name);
      if (!s) return {};
      if (upper(s.name) === 'STANDARD')
        return { selected: s.name, note: 'Standard cannot be deleted.' };
      if (s.handle === current?.handle)
        return { selected: s.name, note: 'The current table style cannot be deleted.' };
      if (usedTableStyles(model).has(s.handle))
        return { selected: s.name, note: 'Style in use, can’t be deleted.' };
      ctx.edit((b) => b.removeTableRecord('tableStyles', s.handle));
      return { selected: current?.name ?? '' };
    }
  }
  return {};
}

/** What the dialogs' preview draws: a table's parts in its block frame and the box they fill. */
export interface TableStylePreview {
  readonly parts: readonly TablePart[];
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
}

/**
 * The sample table the Table Style dialog and the New and Modify Table Style dialog preview a
 * style with, as AutoCAD's: a title row, a header row and data rows of three columns, with
 * "Title", "Header" and "Data" in their cells, drawn by the table engine. The text style is left
 * to the drawing's (the preview names none).
 */
export function tableStylePreview(s: TableStyleSettings): TableStylePreview {
  const cell = (c: TableCellStyleSettings): TableCellStyle => ({
    textHeight: c.textHeight,
    alignment: c.alignment,
    textColor: c.textColor,
    fillColor: c.fill ?? BY_BLOCK,
    fillOn: c.fill !== null,
    dataType: 0,
    unitType: 0,
    borders: c.borders,
  });
  const style: TableStyleRecord = {
    handle: '',
    name: '',
    description: s.description,
    flowDirection: s.up ? 1 : 0,
    styleFlags: 0,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
    suppressTitle: false,
    suppressHeader: false,
    cellStyles: [cell(s.data), cell(s.title), cell(s.header)],
  };
  const tallest = Math.max(s.data.textHeight, s.header.textHeight, s.title.textHeight);
  const columnWidth = 5 * tallest + 2 * s.horizontalMargin;
  let g = newTableGeometry({
    style,
    columns: 3,
    dataRows: 4,
    columnWidth,
    rowLines: 1,
    position: { x: 0, y: 0 },
  });
  const texts = ['Title', 'Header', 'Data', 'Data', 'Data', 'Data'];
  for (const [i, row] of g.cells.entries())
    for (const [j, c] of row.entries()) if (!c.merged) g = withCellText(g, i, j, texts[i]!);
  const height = g.rowHeights.reduce((a, b) => a + b, 0);
  return {
    parts: tableParts(g, style, { textStyle: '' }).filter((p) => !p.defpoint),
    minY: s.up ? 0 : -height,
    maxY: s.up ? height : 0,
    width: columnWidth * 3,
  };
}

/** The table style a table is drawn in, its style's record, or undefined. */
function tableStyleOf(model: DocumentModel, g: TableGeometry): TableStyleRecord | undefined {
  return g.style === undefined ? undefined : model.tables.tableStyles.get(g.style);
}

/**
 * `b` with what border `f` of a cell overrides: its colour, lineweight, linetype, double line
 * and whether it shows (each property the cell leaves out the style's, as the table engine
 * draws it).
 */
function withBorder(b: TableCellBorder, f: TableBorderFormat | undefined): TableCellBorder {
  if (!f) return b;
  const linetype = f.linetype ?? b.linetype;
  const double = f.double ?? b.double;
  return {
    lineweight: f.lineweight ?? b.lineweight,
    color: f.color ?? b.color,
    visible: f.hidden ? false : b.visible,
    ...(linetype !== undefined && { linetype }),
    ...(double && { double, spacing: (f.double ? f.spacing : undefined) ?? b.spacing ?? 0.18 }),
  };
}

/**
 * The settings Select table to start from gives the New or Modify Table Style dialog: table `g`'s
 * formatting over `was` (what the dialog showed). The table direction and the margins are the
 * table's (its style's, its own overrides over them); each of the Data, Header and Title cell
 * styles is what the first cell of the table's first row of that type is drawn with (its style's
 * cell style, the row type's overrides and the cell's own format, which the cell's format already
 * folds in), as a drafter reads the table they picked; a row type the table has no row of keeps
 * `was`'s. The cell's edges map onto the cell style's borders as the table engine draws them
 * (annotation/table.ts): its top edge is the top border, its bottom edge the inside horizontal one
 * when more rows of its type follow, else the bottom border, and its left and right edges the left
 * border and the inside vertical or right one alike. The description stays `was`'s.
 */
export function tableStartSettings(
  model: DocumentModel,
  g: TableGeometry,
  was: TableStyleSettings,
): TableStyleSettings {
  const style = tableStyleOf(model, g);
  const base = style ? tableStyleSettings(model, style) : was;
  const types = tableRowStyles(g, style);
  const heads = tableRangeHeads(g);
  const margins = g.overrides?.margins;
  const cell = (n: (typeof TABLE_CELL_STYLES)[number]): TableCellStyleSettings => {
    const i = types.indexOf(n);
    if (i < 0) return was[n];
    const [hi, hj] = heads[i]![0]!;
    const c = g.cells[hi]![hj]!;
    const s = base[n];
    const f = { ...g.overrides?.[n], ...c.format };
    const lastRow = types[hi + c.rowSpan] !== n;
    const lastColumn = hj + c.columnSpan >= g.columnWidths.length;
    const borders = [...s.borders];
    const set = (k: number, e: TableBorderFormat | undefined) => {
      borders[k] = withBorder(borders[k]!, e);
    };
    set(0, f.borders?.top);
    set(lastRow ? 2 : 1, f.borders?.bottom);
    set(3, f.borders?.left);
    set(lastColumn ? 5 : 4, f.borders?.right);
    return {
      fill: f.background !== undefined ? f.background : s.fill,
      alignment: f.alignment ?? s.alignment,
      textStyle: f.textStyle !== undefined ? textStyleName(model, f.textStyle) : s.textStyle,
      textHeight: f.textHeight ?? s.textHeight,
      textColor: f.contentColor ?? s.textColor,
      borders,
    };
  };
  return {
    description: was.description,
    up: base.up,
    horizontalMargin: margins?.left ?? base.horizontalMargin,
    verticalMargin: margins?.top ?? base.verticalMargin,
    data: cell('data'),
    header: cell('header'),
    title: cell('title'),
    ...(was.userCellStyles && { userCellStyles: was.userCellStyles }),
  };
}

/**
 * Select table to start from: "Select a table:" until a table is picked; the dialog's settings
 * with its formatting, or as they were when Enter or Esc picks none.
 */
async function* startFromTable(
  ctx: CommandContext,
  editing: TableStyleEditing,
): Sub<TableStyleEditing> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select a table', single: true, escape: true });
    if (a.kind !== 'selection' || a.ids.length === 0) return editing;
    const g = ctx.model.entity(a.ids[0]!)?.geom;
    if (g?.kind === 'ACAD_TABLE')
      return { ...editing, settings: tableStartSettings(ctx.model, g, editing.settings) };
    ctx.message('The object selected is not a table.');
  }
}

/** The Table Style dialog until Close: TABLESTYLE's, and the Insert Table dialog's launcher's. */
export async function* tableStyleDialog(ctx: CommandContext, start?: string): Sub<void> {
  let selected: string | undefined = start;
  let note: string | undefined;
  let editing: TableStyleEditing | undefined;
  for (;;) {
    const request = tableStyleRequest(ctx.model, selected, note, editing);
    const a: PromptAnswer = yield ctx.prompt.dialog({ message: 'Table Style', dialog: request });
    if (a.kind !== 'dialog' || a.action !== 'apply' || !a.tablestyle) return;
    editing = undefined;
    note = undefined;
    const t = a.tablestyle;
    if (t.op === 'start') {
      if (typeof t.name === 'string' && wellFormed(t.settings))
        editing = yield* startFromTable(ctx, {
          name: t.name,
          isNew: t.isNew === true,
          settings: t.settings,
        });
      continue;
    }
    const shown = await act(ctx, t);
    selected = shown.selected ?? selected;
    note = shown.note;
  }
}

/** TABLESTYLE (TS): the Table Style dialog. */
export function tablestyleCommand(): CommandDef {
  return {
    name: 'TABLESTYLE',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      yield* tableStyleDialog(ctx);
    },
  };
}
