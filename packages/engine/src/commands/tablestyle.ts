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
// colour, and the Borders tab's lineweight, colour and which borders show. A modified style's
// tables are drawn again in it (their `*T` blocks), each row growing to hold its text at the new
// height, as AutoCAD updates them; a row never shrinks, as when a cell's text is edited.
//
// Where the drawing's file has no place for a setting it is shown and not changed: a TABLESTYLE
// before R2010 (and the DXF, which AutoCAD writes in that form) holds one horizontal and one
// vertical margin for the whole style, so the margins are the style's, shown on each cell style;
// it holds no text angle, cell format other than the data and unit types, border linetype,
// double line or "merge cells on row/column creation" setting of its own. A DXF table style
// holds index colours only, so true colours are refused. Cell styles of the drafter's own
// (Create a new cell style, Manage Cell Styles) wait for M1-99.
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
  TableCellBorder,
  TableCellStyle,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import type { Prompt, PromptAnswer } from './prompt';
import { tableCellText, tableParts, tableRangeHeads, type TablePart } from '../annotation/table';
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

/** The cell styles a table style has: the rows of the file's record. */
export const TABLE_CELL_STYLES = ['data', 'header', 'title'] as const;
export type TableCellStyleName = (typeof TABLE_CELL_STYLES)[number];

/** Where each cell style sits in the record's `cellStyles` (the file's order data, title, header). */
const STYLE_INDEX: Readonly<Record<TableCellStyleName, number>> = { data: 0, title: 1, header: 2 };

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
}

/** One style in the dialog's list. */
export interface TableStyleRow {
  readonly name: string;
  readonly settings: TableStyleSettings;
  /** A table uses it ("Styles in use"). */
  readonly used: boolean;
  /** AutoCAD's Standard, listed for a drawing without table styles until an action adds it. */
  readonly unsaved?: true;
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
  /** Why the last action did nothing ("The current table style cannot be deleted."). */
  readonly note?: string;
}

/** What a Table Style dialog button or shortcut menu choice asks of TABLESTYLE. */
export type TableStyleAction =
  | { readonly op: 'current'; readonly name: string }
  /** New...'s name, with the settings its New Table Style dialog closed on. */
  | { readonly op: 'new'; readonly name: string; readonly settings: TableStyleSettings }
  | { readonly op: 'modify'; readonly name: string; readonly settings: TableStyleSettings }
  | { readonly op: 'rename'; readonly name: string; readonly to: string }
  | { readonly op: 'delete'; readonly name: string };

const upper = (s: string) => s.toUpperCase();
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const BY_BLOCK: Color = { kind: 'byBlock' };
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
  const cell = (n: TableCellStyleName) => cellSettings(model, s.cellStyles[STYLE_INDEX[n]]);
  return {
    description: s.description,
    up: s.flowDirection === 1,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
    data: cell('data'),
    header: cell('header'),
    title: cell('title'),
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
          isAnyColor((b as TableCellBorder).color),
      )
    );
  };
  return (
    typeof v.description === 'string' &&
    typeof v.up === 'boolean' &&
    typeof v.horizontalMargin === 'number' &&
    typeof v.verticalMargin === 'number' &&
    TABLE_CELL_STYLES.every((n) => cell(v[n]))
  );
}

const CELL_LABEL: Readonly<Record<TableCellStyleName, string>> = {
  data: 'Data',
  header: 'Header',
  title: 'Title',
};

/** Why settings cannot be a style's, or undefined. */
export function tableStyleProblem(
  s: TableStyleSettings,
  textStyles: readonly string[],
): string | undefined {
  for (const k of ['horizontalMargin', 'verticalMargin'] as const) {
    if (!(Number.isFinite(s[k]) && s[k] >= 0)) return 'A cell margin must be 0 or more.';
  }
  const names = new Set(textStyles.map(upper));
  for (const n of TABLE_CELL_STYLES) {
    const c = s[n];
    const where = `${CELL_LABEL[n]} cell style: `;
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
  }
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
): TableStyleRequest {
  const listed = listedStyles(model).sort((a, b) => byName(a.name, b.name));
  const used = usedTableStyles(model);
  const current = currentTableStyle(model) ?? unsavedStandard(model);
  const shown = selected === undefined ? undefined : styleNamed(model, selected);
  return {
    type: 'tablestyle',
    styles: listed.map((s) => ({
      name: s.name,
      settings: tableStyleSettings(model, s),
      used: used.has(s.handle),
      ...(s.handle === '' && { unsaved: true as const }),
    })),
    current: current?.name ?? '',
    selected: shown?.name ?? current?.name ?? listed[0]?.name ?? '',
    textStyles: [...model.tables.textStyles.values()]
      .filter((s) => ((s.flags ?? 0) & 1) === 0)
      .map((s) => s.name)
      .sort(byName),
    ...(note !== undefined && { note }),
  };
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
): TableCellStyle {
  const textStyle = textStyleHandle(model, s.textStyle, c?.textStyle);
  const fillOn = s.fill !== null;
  return {
    ...(textStyle !== undefined && { textStyle }),
    textHeight: s.textHeight,
    alignment: s.alignment,
    textColor: s.textColor,
    // An unfilled style keeps the colour it holds, as the file does with its fill off.
    fillColor: s.fill ?? c?.fillColor ?? BY_BLOCK,
    fillOn,
    dataType: c?.dataType ?? 0,
    unitType: c?.unitType ?? 0,
    borders: s.borders.map((b) => ({
      lineweight: b.lineweight,
      visible: b.visible,
      color: b.color,
    })),
  };
}

/** The record fields `s` sets on `was`. */
function recordFields(
  model: DocumentModel,
  was: Omit<TableStyleRecord, 'handle' | 'name'>,
  s: TableStyleSettings,
): Pick<
  TableStyleRecord,
  'description' | 'flowDirection' | 'horizontalMargin' | 'verticalMargin' | 'cellStyles'
> {
  const cellStyles = [...was.cellStyles];
  for (const n of TABLE_CELL_STYLES) {
    const k = STYLE_INDEX[n];
    cellStyles[k] = cellStyleOf(model, was.cellStyles[k], s[n]);
  }
  return {
    description: s.description,
    flowDirection: s.up ? 1 : 0,
    horizontalMargin: s.horizontalMargin,
    verticalMargin: s.verticalMargin,
    cellStyles,
  };
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
  return { ...was, name, ...recordFields(model, was, s) };
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
  const textStyles = tableStyleRequest(model).textStyles;
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
      const problem = nameProblem(model, name) ?? tableStyleProblem(a.settings, textStyles);
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
      const problem = tableStyleProblem(a.settings, textStyles);
      if (problem) return { selected: s.name, note: problem };
      const patch = changedFields(model, s, a.settings);
      if (!patch) return { selected: s.name };
      if (s.handle === '') {
        ctx.edit((b) => {
          const made = addStandard(b, model)!;
          b.updateTableRecord('tableStyles', made, patch);
        });
        return { selected: s.name };
      }
      const tables = await redrawTables(ctx, s.handle, { ...s, ...patch });
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

/**
 * The Table Style dialog until Close: TABLESTYLE's, and the Insert Table dialog's launcher's.
 * Returns the style selected when it closed.
 */
export async function* tableStyleDialog(ctx: CommandContext, start?: string): Sub<string> {
  let selected: string | undefined = start;
  let note: string | undefined;
  for (;;) {
    const request = tableStyleRequest(ctx.model, selected, note);
    const a: PromptAnswer = yield ctx.prompt.dialog({ message: 'Table Style', dialog: request });
    if (a.kind !== 'dialog' || a.action !== 'apply' || !a.tablestyle) return request.selected;
    const shown = await act(ctx, a.tablestyle);
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
