// TriyaToAcad for a table's table-wide overrides (M1-75 part 38), the inverse of map/entities.ts
// `statedOverrides` and `contentOverrides`: what a table overrides of its table style for the
// whole table (its cell margins) and per row type (title, header and data rows: alignment, text
// style and height, content colour and fill), as AutoCAD's Properties palette sets them with the
// whole table selected, for a new table (part 32) and an edited one.
//
// DXF and DWG before R2010 state them in one flag word with the values after it (DXF 93 on, the
// DWG fields as the ODA specification lists them). acad-ts keeps a DXF table's override codes as
// read (DEC-043) and writes them back, so the codes are written again from the flag word as
// AutoCAD writes them: 93 to 96 (the border overrides, 94 to 96, are not mapped, M1-81, so a DXF
// table stating some is refused), then the title and header suppression and flow direction a
// table states (not mapped, kept), the margins and the row values grouped by code, each code's
// row types in AcDb::RowType order (data, title, header). Only the properties that change are
// written; the rest of the flag word stays as read.
//
// A DWG from R2010 states them in cell styles: the margins in the table's own, a row type's
// values in the cell style of each of its rows (the row's style id names the table style's
// `_TITLE`, `_HEADER` or `_DATA`), so a value every row of the type states alike is the type's.
// A changed value is written into every row of the type, and a value taken off leaves them all.
// The cells fold their row's cell style in (`tableCellFormat`), so after the rows the save works
// out what each cell maps as on its new rows, and writes into the cell's own cell style only
// what its format says beyond that (table-cells.ts `writeCellStyleFormat`); `stylesAfter` does
// the same on copies first, for the checks.

import {
  CellStyleType,
  CellStyle,
  Color as AcadColor,
  MarginFlags,
  TableCellStylePropertyFlags,
  TableEntityCell,
  TableOverrideFlags,
  TableStyle,
  TableStyleOverrides,
  TextStyle,
  type TableEntity,
} from '@node-projects/acad-ts';
import type {
  Color,
  TableCell,
  TableCellFormat,
  TableGeometry,
  TableOverrides,
  TableRowFormat,
} from '@triya/engine';
import { rowTypeOf, tableCellFormat, tableMargins } from '../map/entities';
import { acadColor, resolve, same, type Resolver } from './entities';
import { beginCellStyle, dwgFrom2010, formatValueProblems } from './table-cells';
import { copyStyle, originProblems, rowsAt, cellStylesAt } from './table-grid';
import { newCell, newRows } from './table-new';
import { colorProblems } from './table-styles';

const ROW_TYPES = ['title', 'header', 'data'] as const;
type RowType = (typeof ROW_TYPES)[number];
type Side = 'left' | 'top' | 'right' | 'bottom';
const SIDES: readonly Side[] = ['left', 'top', 'right', 'bottom'];
type RowKey = keyof TableRowFormat;
const ROW_KEYS: readonly RowKey[] = [
  'alignment',
  'textStyle',
  'textHeight',
  'contentColor',
  'background',
];

const changed = (b: unknown, a: unknown): boolean => !same(a, b);

// ── Checks ─────────────────────────────────────────────────────────────────────────────────

/**
 * Why the overrides `a` (that were `b`; undefined for a new table) are not values AutoCAD takes,
 * in whatever file: a margin is a number of 0 or more, and a row type's values are those a cell
 * takes (`formatValueProblems`).
 */
export function overrideValueProblems(
  r: Resolver,
  b: TableOverrides | undefined,
  a: TableOverrides | undefined,
): string[] {
  if (same(a, b)) return [];
  const out: string[] = [];
  for (const side of SIDES) {
    const v = a?.margins?.[side];
    if (v === undefined || !changed(b?.margins?.[side], v)) continue;
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      out.push(`table margins: ${side} ${JSON.stringify(v)} is not a number of 0 or more`);
    }
  }
  for (const type of ROW_TYPES) {
    const f = a?.[type];
    if (!f) continue;
    const was = b?.[type] ? ({ format: b[type] } as TableCell) : undefined;
    out.push(
      ...formatValueProblems(r, { format: f } as TableCell, was).map((p) => `${type} rows: ${p}`),
    );
  }
  return out;
}

/**
 * Why the file at hand cannot state the overrides of `g` (that were `b`): DXF and DWG before
 * R2010 state one horizontal and one vertical margin and some colours as ACI only, and acad-ts
 * cannot write the values of a DXF table's border overrides back in place (M1-81); a DWG from
 * R2010 states a row type's values in its rows, so a type with none cannot take one. `acad` is
 * the edited table's original (undefined for a new table).
 */
export function overrideFileProblems(
  r: Resolver,
  acad: TableEntity | undefined,
  g: TableGeometry,
  b: TableOverrides | undefined,
): string[] {
  const a = g.overrides;
  if (same(a, b)) return [];
  const out: string[] = [];
  if (dwgFrom2010(r.format, r.version)) {
    const types = rowTypesAfter(r, acad, g);
    if (!types) return out;
    for (const type of ROW_TYPES) {
      if (!same(a?.[type], b?.[type]) && a?.[type] && !types.includes(type)) {
        out.push(
          `${type} rows: an override in a DWG from R2010, which states it in the rows of the type, and the table has none`,
        );
      }
    }
    return out;
  }
  const m = a?.margins;
  if (m && changed(b?.margins, m)) {
    // DXF 40 / 41 and the DWG fields state one horizontal and one vertical margin.
    if (m.left !== m.right) out.push('table margins: left and right differ');
    if (m.top !== m.bottom) out.push('table margins: top and bottom differ');
  }
  for (const type of ROW_TYPES) {
    for (const k of ['contentColor', 'background'] as const) {
      const c = a?.[type]?.[k];
      if (!c || !changed(b?.[type]?.[k], c)) continue;
      for (const p of colorProblems(r.version, r.format, k, c)) {
        out.push(`${type} rows: ${p.replace('table style', 'table')}`);
      }
    }
  }
  if (r.format === 'dxf' && acad && borderCodes(acad)) {
    out.push('table overrides change in a DXF table that overrides its borders (M1-81)');
  }
  return out;
}

/** Whether a DXF table's kept override codes state border overrides (94 to 96 not 0). */
const borderCodes = (t: TableEntity): boolean =>
  t.tableOverrideDxfCodes.some((c) => c.code >= 94 && c.code <= 96 && Number(c.value) !== 0);

// ── DXF and DWG before R2010: the flag word ────────────────────────────────────────────────

type FlagKey = 'contentColor' | 'fillNone' | 'fillColor' | 'alignment' | 'textStyle' | 'textHeight';

/**
 * Each row-type value with its title row bit (the header's and data's follow it, ODA spec) and
 * its DXF code, in the order AutoCAD lists them.
 */
const ROW_BITS: readonly [FlagKey, TableOverrideFlags, number][] = [
  ['contentColor', TableOverrideFlags.TitleRowColor, 64],
  ['fillNone', TableOverrideFlags.TitleRowFillNone, 283],
  ['fillColor', TableOverrideFlags.TitleRowFillColor, 63],
  ['alignment', TableOverrideFlags.TitleRowAlign, 170],
  ['textStyle', TableOverrideFlags.TitleTextStyle, 7],
  ['textHeight', TableOverrideFlags.TitleRowHeight, 140],
];

/** Row types in the order DXF repeats a row-type code (AcDb::RowType: data, title, header). */
const DXF_ROW_ORDER: readonly RowType[] = ['data', 'title', 'header'];

const OFFSET: Record<RowType, number> = { title: 0, header: 1, data: 2 };

/**
 * Writes the change from `b` to `a` (`b` undefined for a new table) into the flag word and values
 * of `t` (DWG before R2010) and the DXF codes acad-ts writes them from.
 */
function writeFlagOverrides(
  r: Resolver,
  t: TableEntity,
  b: TableOverrides | undefined,
  a: TableOverrides | undefined,
): void {
  const s = t.tableOverrides ?? new TableStyleOverrides();
  const set = (flag: number, on: boolean): void => {
    s.flags = (on ? s.flags | flag : s.flags & ~flag) as TableOverrideFlags;
  };
  const h = a?.margins?.left;
  const v = a?.margins?.top;
  if (changed(b?.margins?.left, h)) {
    set(TableOverrideFlags.HorizontalCellMargin, h !== undefined);
    if (h !== undefined) s.horizontalCellMargin = h;
  }
  if (changed(b?.margins?.top, v)) {
    set(TableOverrideFlags.VerticalCellMargin, v !== undefined);
    if (v !== undefined) s.verticalCellMargin = v;
  }
  for (const type of ROW_TYPES) {
    const row = s[type];
    const bit = (first: TableOverrideFlags) => first << OFFSET[type];
    const was = b?.[type];
    const now = a?.[type];
    if (changed(was?.contentColor, now?.contentColor)) {
      set(bit(TableOverrideFlags.TitleRowColor), now?.contentColor !== undefined);
      if (now?.contentColor) row.contentColor = acadColor(now.contentColor);
    }
    if (changed(was?.background, now?.background)) {
      const bg = now?.background;
      set(bit(TableOverrideFlags.TitleRowFillNone), bg === null);
      set(bit(TableOverrideFlags.TitleRowFillColor), bg !== undefined && bg !== null);
      row.fillNone = bg === null;
      if (bg) row.fillColor = acadColor(bg);
    }
    if (changed(was?.alignment, now?.alignment)) {
      set(bit(TableOverrideFlags.TitleRowAlign), now?.alignment !== undefined);
      if (now?.alignment !== undefined) row.alignment = now.alignment;
    }
    if (changed(was?.textStyle, now?.textStyle)) {
      set(bit(TableOverrideFlags.TitleTextStyle), now?.textStyle !== undefined);
      if (now?.textStyle !== undefined) row.textStyle = resolve(r, now.textStyle, TextStyle)!;
    }
    if (changed(was?.textHeight, now?.textHeight)) {
      set(bit(TableOverrideFlags.TitleRowHeight), now?.textHeight !== undefined);
      if (now?.textHeight !== undefined) row.textHeight = now.textHeight;
    }
  }
  t.tableOverrides = s.flags === TableOverrideFlags.None ? null : s;
  t.tableOverrideDxfCodes = dxfCodes(s, t.tableOverrideDxfCodes);
}

/** A row-type value as its DXF code states it. */
function rowCode(s: TableStyleOverrides, type: RowType, key: FlagKey): unknown {
  const row = s[type];
  switch (key) {
    case 'contentColor':
      return row.contentColor.getApproxIndex();
    case 'fillNone':
      return row.fillNone ? 1 : 0;
    case 'fillColor':
      return row.fillColor.getApproxIndex();
    case 'textStyle':
      return row.textStyle?.name ?? '';
    default:
      return row[key];
  }
}

/**
 * The DXF codes of the overrides `s` as AutoCAD writes them (see the top of this file); the border
 * override flags (94 to 96) are taken from the codes `kept` as read.
 */
function dxfCodes(
  s: TableStyleOverrides,
  kept: readonly { code: number; value: unknown }[],
): { code: number; value: unknown }[] {
  const flag = (code: number) => kept.find((c) => c.code === code)?.value ?? 0;
  const out: { code: number; value: unknown }[] = [
    { code: 93, value: s.flags as number },
    ...[94, 95, 96].map((code) => ({ code, value: flag(code) })),
  ];
  const f = s.flags;
  if (f & TableOverrideFlags.TitleSuppressed) out.push({ code: 280, value: +s.suppressTitle });
  if (f & TableOverrideFlags.HeaderSuppressed) out.push({ code: 281, value: +s.suppressHeader });
  if (f & TableOverrideFlags.FlowDirection) out.push({ code: 70, value: s.flowDirection });
  if (f & TableOverrideFlags.HorizontalCellMargin) {
    out.push({ code: 40, value: s.horizontalCellMargin });
  }
  if (f & TableOverrideFlags.VerticalCellMargin)
    out.push({ code: 41, value: s.verticalCellMargin });
  for (const [key, first, code] of ROW_BITS) {
    for (const type of DXF_ROW_ORDER) {
      if (f & (first << OFFSET[type])) out.push({ code, value: rowCode(s, type, key) });
    }
  }
  return out;
}

// ── DWG from R2010: cell styles ────────────────────────────────────────────────────────────

const P = TableCellStylePropertyFlags;

/** The bit of each row-type property in a cell style (AcDb::CellProperty). */
const ROW_PROPS: Record<RowKey, number> = {
  alignment: P.Alignment,
  textStyle: P.TextStyle,
  textHeight: P.TextHeight,
  contentColor: P.ContentColor,
  background: P.BackgroundColor,
};

const MARGIN_PROPS: Record<Side, number> = {
  left: P.MarginLeft,
  top: P.MarginTop,
  right: P.MarginRight,
  bottom: P.MarginBottom,
};

/**
 * Writes the change from `b` to `a` into a DWG R2010+ table's cell styles: the margins into the
 * table's own (`table`), a row type's values into the cell style of each row of the type.
 */
function writeStyleOverrides(
  r: Resolver,
  table: CellStyle,
  rows: readonly { style: CellStyle; type: RowType | undefined }[],
  b: TableOverrides | undefined,
  a: TableOverrides | undefined,
): void {
  for (const side of SIDES) {
    const v = a?.margins?.[side];
    if (!changed(b?.margins?.[side], v)) continue;
    beginCellStyle(table, CellStyleType.FormattedTableData);
    let own = table.cellPropertyOverrideFlags ?? 0;
    own = v === undefined ? own & ~MARGIN_PROPS[side] : own | MARGIN_PROPS[side];
    table.cellPropertyOverrideFlags = own;
    if (v === undefined) continue;
    table.marginOverrideFlags |= MarginFlags.Override;
    if (side === 'left') table.horizontalMargin = v;
    if (side === 'top') table.verticalMargin = v;
    if (side === 'right') table.rightMargin = v;
    if (side === 'bottom') table.bottomMargin = v;
  }
  for (const type of ROW_TYPES) {
    for (const k of ROW_KEYS) {
      const v = a?.[type]?.[k];
      if (!changed(b?.[type]?.[k], v)) continue;
      for (const row of rows) {
        if (row.type !== type) continue;
        const s = row.style;
        beginCellStyle(s, CellStyleType.Row);
        const own = s.cellPropertyOverrideFlags ?? 0;
        s.cellPropertyOverrideFlags = v === undefined ? own & ~ROW_PROPS[k] : own | ROW_PROPS[k];
        if (v === undefined) continue;
        if (k === 'alignment') s.alignment = v as number;
        if (k === 'textHeight') s.textHeight = v as number;
        if (k === 'contentColor') s.color = acadColor(v as Color);
        if (k === 'textStyle') s.textStyle = resolve(r, v as string, TextStyle)!;
        // No fill is the colour method None, ACI 257 to acad-ts (patch 0120).
        if (k === 'background')
          s.backgroundColor = v === null ? AcadColor.byEntity : acadColor(v as Color);
      }
    }
  }
}

/**
 * The row type of each row `g` has once saved (DWG from R2010): by the row it is or copies
 * (`acad`, the table as read), or for a new table by its place. Undefined when `g`'s rows are
 * not sound (the writer reports that).
 */
function rowTypesAfter(
  r: Resolver,
  acad: TableEntity | undefined,
  g: TableGeometry,
): (RowType | undefined)[] | undefined {
  const style = acad ? acad.style : g.style === undefined ? null : resolve(r, g.style, TableStyle);
  const typeOf = rowTypeOf(style ?? null);
  const fresh = newRows(style ?? null, g.cells.length);
  if (!acad) return fresh.map((row) => typeOf(row.styleId));
  if (!Array.isArray(g.cells)) return undefined;
  return rowsAt(acad, g).map((row, i) => typeOf((row ?? fresh[i])?.styleId ?? 0));
}

/**
 * What each cell of `g` maps as on the cell styles a DWG R2010+ save leaves its table, its rows
 * and its columns with once the overrides change from `b` (undefined for a new table), with only
 * its own cell style as read (`format`), and with none (`inherited`), and the table's margins:
 * worked out on copies, for the checks. `acad` is the edited table's original. Undefined when
 * `g`'s rows and columns are not sound (the writer reports that).
 */
export function stylesAfter(
  r: Resolver,
  acad: TableEntity | undefined,
  b: TableGeometry | undefined,
  g: TableGeometry,
):
  | {
      format: (TableCellFormat | undefined)[][];
      inherited: (TableCellFormat | undefined)[][];
      margins: NonNullable<TableCellFormat['margins']>;
    }
  | undefined {
  if (acad && b && originProblems(b, g).length > 0) return undefined;
  const types = rowTypesAfter(r, acad, g);
  if (!types || types.length !== g.cells.length) return undefined;
  let table: CellStyle;
  let rows: CellStyle[];
  let columns: (CellStyle | undefined)[];
  let cells: (TableEntityCell | undefined)[][];
  if (acad && b) {
    table = copyStyle(acad.cellStyleOverride);
    const at = cellStylesAt(acad, g);
    rows = at.rows.map((s) => copyStyle(s ?? new CellStyle()));
    columns = at.columns;
    const rowOrigins = g.rowOrigins ?? g.rowHeights.map((_, i) => i);
    const columnOrigins = g.columnOrigins ?? g.columnWidths.map((_, j) => j);
    cells = rowOrigins.map((o) =>
      columnOrigins.map((p) => (o === null || p === null ? undefined : acad.rows[o]?.cells[p])),
    );
  } else {
    table = new CellStyle();
    table.cellStyleType = CellStyleType.FormattedTableData;
    table.hasData = true;
    rows = types.map(() => {
      const s = new CellStyle();
      s.cellStyleType = CellStyleType.Row;
      s.hasData = true;
      return s;
    });
    columns = [];
    cells = [];
  }
  writeStyleOverrides(
    r,
    table,
    rows.map((style, i) => ({ style, type: types[i] })),
    b?.overrides,
    g.overrides,
  );
  return {
    format: g.cells.map((row, i) =>
      row.map((c, j) => tableCellFormat(table, columns[j], rows[i], cells[i]?.[j] ?? newCell(c))),
    ),
    inherited: g.cells.map((row, i) =>
      row.map((_, j) => tableCellFormat(table, columns[j], rows[i], new TableEntityCell())),
    ),
    margins: tableMargins(table),
  };
}

/**
 * Writes the change of the table-wide overrides from `b` to `a` (`b` undefined for a new table)
 * onto `t`, whose rows and columns are where `g` puts them: into cell styles in a DWG from R2010,
 * into the flag word and values otherwise.
 */
export function writeTableOverrides(
  r: Resolver,
  t: TableEntity,
  b: TableOverrides | undefined,
  a: TableOverrides | undefined,
): void {
  if (!dwgFrom2010(r.format, r.version)) {
    writeFlagOverrides(r, t, b, a);
    return;
  }
  const typeOf = rowTypeOf(t.style);
  writeStyleOverrides(
    r,
    t.cellStyleOverride,
    t.rows.map((row) => ({ style: row.cellStyleOverride, type: typeOf(row.styleId) })),
    b,
    a,
  );
}
