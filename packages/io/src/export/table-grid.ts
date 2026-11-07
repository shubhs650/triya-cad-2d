// TriyaToAcad for rows and columns inserted into or deleted from an ACAD_TABLE (M1-75 part 34),
// what the Table Cell ribbon's Insert Above / Below, Insert Left / Right, Delete Rows and Delete
// Columns do. DWG and DXF give rows and cells no identity, so the edited table states where each
// row and column came from (`TableGeometry.rowOrigins` / `columnOrigins`, DEC-046), and the save
// moves each acad-ts row, column and cell to its new place with everything Triya does not map
// (tooltips, custom data, content geometry, a DWG's cell style ids). The table's values are
// then written as for an edited table (entities.ts `tableWriter`), each cell against the cell
// it was.
//
// A new row or column takes the cell style of the one it follows (the one after it when it comes
// first): AutoCAD's help says an inserted row or column takes the formatting of the row or column
// it is inserted next to, without saying which side, and a row inserted below is the common
// case. Its new cells override nothing of their own, so in a DWG from R2010, whose cell styles
// have no writer yet, a new cell's format must be the one its row and column give it.

import {
  CellStyle,
  CellBorder,
  TableCellContentType,
  TableEntityRow,
  BreakOptionFlags,
  type TableEntity,
  type TableEntityCell,
  type TableEntityColumn,
} from '@node-projects/acad-ts';
import type { TableCell, TableCellFormat, TableGeometry } from '@triya/engine';
import { tableCellFormat } from '../map/entities';
import { newCell, newColumn, newRows } from './table-new';

type Origins = readonly (number | null)[];

/** Where each row of `g` came from: as stated, else each its own place. */
const rowOrigins = (g: TableGeometry): Origins => g.rowOrigins ?? g.rowHeights.map((_, i) => i);

/** Where each column of `g` came from: as stated, else each its own place. */
const columnOrigins = (g: TableGeometry): Origins =>
  g.columnOrigins ?? g.columnWidths.map((_, j) => j);

/** Whether `g` states where its rows or columns came from: rows or columns inserted or deleted. */
export const regridded = (g: TableGeometry): boolean =>
  g.rowOrigins !== undefined || g.columnOrigins !== undefined;

const isWhole = (n: unknown, min: number, max: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/**
 * Why the origins `g` states cannot be where its rows and columns came from in `before`, the
 * table as read: one per row (column), each a row (column) of `before` or null, in order and
 * none twice (AutoCAD inserts and deletes, it does not move rows or columns). Without them the
 * grid must be the one read.
 */
export function originProblems(before: TableGeometry, g: TableGeometry): string[] {
  const out: string[] = [];
  const kinds = [
    ['rowOrigins', 'row', g.rowOrigins, g.rowHeights.length, before.rowHeights.length],
    ['columnOrigins', 'column', g.columnOrigins, g.columnWidths.length, before.columnWidths.length],
  ] as const;
  for (const [key, noun, origins, count, was] of kinds) {
    if (origins === undefined) {
      if (count !== was) {
        out.push(
          `rows or columns added or removed without rowOrigins and columnOrigins (where each came from)`,
        );
      }
      continue;
    }
    if (!Array.isArray(origins) || origins.length !== count) {
      const n = Array.isArray(origins) ? origins.length : JSON.stringify(origins);
      out.push(`${key}: ${n} for ${count} ${noun}s`);
      continue;
    }
    let last = -1;
    let unordered = false;
    for (const o of origins) {
      if (o === null) continue;
      if (!isWhole(o, 0, was - 1)) {
        out.push(`${key}: ${JSON.stringify(o)} is not a ${noun} of the table as read`);
        continue;
      }
      if (o <= last) unordered = true;
      last = o;
    }
    if (unordered) out.push(`${key}: ${noun}s in another order, or one twice`);
  }
  return out;
}

/**
 * `before` laid out on the grid of `g`: each row and column at the place it has in `g`, a new
 * one empty (no height or width, no cells), so `before.cells[i][j]` is the cell (i, j) of `g`
 * was, if any. `g`'s origins must be sound (`originProblems`).
 */
export function alignedBefore(before: TableGeometry, g: TableGeometry): TableGeometry {
  if (!regridded(g)) return before;
  const rows = rowOrigins(g);
  const columns = columnOrigins(g);
  return {
    ...before,
    rowHeights: rows.map((o) => (o === null ? Number.NaN : before.rowHeights[o]!)),
    columnWidths: columns.map((p) => (p === null ? Number.NaN : before.columnWidths[p]!)),
    // Sparse on purpose: a cell a row or column insert made has no before.
    cells: rows.map((o) =>
      o === null ? [] : columns.map((p) => (p === null ? undefined : before.cells[o]![p]!)),
    ) as TableCell[][],
    ...(g.rowOrigins ? { rowOrigins: g.rowOrigins } : {}),
    ...(g.columnOrigins ? { columnOrigins: g.columnOrigins } : {}),
  };
}

/** The row (column) of the table as read a new row (column) at `i` takes its style from. */
function neighbour(origins: Origins, i: number): number | undefined {
  for (let k = i - 1; k >= 0; k--) if (origins[k] !== null) return origins[k]!;
  for (let k = i + 1; k < origins.length; k++) if (origins[k] !== null) return origins[k]!;
  return undefined;
}

/** A copy of a row's or column's cell style; the styles and linetypes it names are shared. */
function copyStyle(s: CellStyle): CellStyle {
  const out = Object.assign(new CellStyle(), s);
  for (const k of [
    'topBorder',
    'rightBorder',
    'bottomBorder',
    'leftBorder',
    'horizontalInsideBorder',
    'verticalInsideBorder',
  ] as const) {
    out[k] = Object.assign(new CellBorder(s[k].edgeFlags), s[k]);
  }
  return out;
}

/** The cell styles a row (column) at each place of `origins` sits on, by the table as read. */
function stylesAt<T extends { cellStyleOverride: CellStyle }>(
  read: readonly T[],
  origins: Origins,
): (CellStyle | undefined)[] {
  return origins.map((o, i) => read[o ?? neighbour(origins, i) ?? -1]?.cellStyleOverride);
}

/**
 * What a cell of `g` was before, for the cell's format: its own when it was there, otherwise
 * what a new cell in its row and column maps as (`acad` is the table as read). The cells of `g`
 * are its row by column grid.
 */
export function formatsBefore(
  acad: TableEntity,
  before: TableGeometry,
  g: TableGeometry,
): (TableCellFormat | undefined)[][] {
  const was = alignedBefore(before, g);
  const rows = stylesAt(acad.rows, rowOrigins(g));
  const columns = stylesAt(acad.columns, columnOrigins(g));
  return g.cells.map((row, i) =>
    row.map((c, j) => {
      const b = was.cells[i]?.[j];
      if (b) return b.format;
      return tableCellFormat(acad.cellStyleOverride, columns[j], rows[i], newCell(c));
    }),
  );
}

/**
 * Why `acad`'s rows or columns cannot be inserted or deleted as `g` states: a field or formula
 * names cells by their row and column, which AutoCAD moves with them (FIELD, M4-10); cells
 * linked to external data are refreshed from it by place; and a table broken into parts (table
 * breaks) lists its parts by row.
 */
export function regridProblems(acad: TableEntity, g: TableGeometry): string[] {
  const out: string[] = [];
  const cells = acad.rows.flatMap((r) => r.cells);
  const field = (c: TableEntityCell) =>
    c.contents.some((k) => k.field || k.contentType & TableCellContentType.Field);
  if (acad.content.fieldReferences.length > 0 || cells.some(field)) {
    out.push(
      'rows or columns inserted or deleted in a table that holds a field or formula, whose cell references AutoCAD moves with them (M4-10)',
    );
  }
  if (cells.some((c) => c.hasLinkedData || c.dataLink)) {
    out.push('rows or columns inserted or deleted in a table linked to external data');
  }
  const rows = rowOrigins(g);
  const rowsChange = rows.length !== acad.rows.length || rows.some((o, i) => o !== i);
  if (rowsChange && !wholeTableBreak(acad)) {
    out.push('rows inserted or deleted in a table broken into parts (table breaks)');
  }
  return out;
}

/** Whether the table's break data is no break: none, or one part holding every row. */
function wholeTableBreak(t: TableEntity): boolean {
  if (t.tableBreakData.flags & BreakOptionFlags.EnableBreaks) return false;
  const r = t.breakRowRanges;
  return (
    r.length === 0 ||
    (r.length === 1 && r[0]!.startRowIndex === 0 && r[0]!.endRowIndex === t.rows.length - 1)
  );
}

/**
 * Moves `t`'s rows, columns and cells to the places `g` states (its origins are sound and its
 * cells a row by column grid), making a row, column or cell for each new one, and keeps the
 * merged ranges (DWG R2010+) and the one break range (every row) on the rows they were on. A
 * merge losing its head or its far corner goes; the writer then states `g`'s merges.
 */
export function regrid(t: TableEntity, g: TableGeometry): void {
  const rows = rowOrigins(g);
  const columns = columnOrigins(g);
  const readRows = [...t.rows];
  const readColumns = [...t.columns];
  const wholeBreak = t.breakRowRanges.length === 1;
  const fresh = newRows(t.style, rows.length);
  const newColumns: TableEntityColumn[] = columns.map((p, j) => {
    if (p !== null) return readColumns[p]!;
    const column = newColumn(0);
    const from = readColumns[neighbour(columns, j) ?? -1];
    if (from) {
      column.styleId = from.styleId;
      column.cellStyleOverride = copyStyle(from.cellStyleOverride);
    }
    return column;
  });
  const newRowsList: TableEntityRow[] = rows.map((o, i) => {
    let row: TableEntityRow;
    if (o !== null) row = readRows[o]!;
    else {
      const from = readRows[neighbour(rows, i) ?? -1];
      row = from ? new TableEntityRow() : fresh[i]!;
      if (from) {
        row.styleId = from.styleId;
        row.cellStyleOverride = copyStyle(from.cellStyleOverride);
      }
    }
    const cells = o === null ? [] : row.cells;
    row.cells = columns.map((p, j) =>
      o !== null && p !== null ? cells[p]! : newCell(g.cells[i]![j]!),
    );
    return row;
  });
  t.columns.splice(0, t.columns.length, ...newColumns);
  t.rows.splice(0, t.rows.length, ...newRowsList);

  const rowAt = new Map(rows.flatMap((o, i) => (o === null ? [] : [[o, i] as const])));
  const columnAt = new Map(columns.flatMap((p, j) => (p === null ? [] : [[p, j] as const])));
  const kept = t.mergedCellRanges.filter((r) => {
    const top = rowAt.get(r.topRowIndex);
    const bottom = rowAt.get(r.bottomRowIndex);
    const left = columnAt.get(r.leftColumnIndex);
    const right = columnAt.get(r.rightColumnIndex);
    if (top === undefined || bottom === undefined || left === undefined || right === undefined) {
      return false;
    }
    r.topRowIndex = top;
    r.bottomRowIndex = bottom;
    r.leftColumnIndex = left;
    r.rightColumnIndex = right;
    return true;
  });
  t.mergedCellRanges.splice(0, t.mergedCellRanges.length, ...kept);
  if (wholeBreak) t.breakRowRanges[0]!.endRowIndex = rows.length - 1;
}
