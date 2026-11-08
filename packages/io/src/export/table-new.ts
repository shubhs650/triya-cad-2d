// TriyaToAcad for a new ACAD_TABLE (M1-75 part 32), what the TABLE command and COPY add: the
// grid AutoCAD builds for a table, and the table-wide overrides (DXF 93 and the values after it,
// DWG before R2010) a new table states. The cells' text, blocks, rotation, formats and merges are
// then written as for an edited table (entities.ts `tableWriter`, table-cells.ts).
//
// What AutoCAD writes for a table is taken from the corpus tables (acadsharp sample_AC1014 to
// sample_AC1032, DWG and DXF): DXF 90 is 22 on every one; a plain cell spans 1 × 1 (DXF 175 /
// 176); a cell nothing was typed into holds no value; a block cell's scale is 1 (DXF 144) and
// its value an empty string (R2007+ DWG). A DWG
// from R2010 gives each row the cell style of its row type (`_TITLE`, `_HEADER`, `_DATA` by the
// table style's ids) and states row, cell and table cell styles that override nothing.
//
// The table-wide overrides a new table states are written by table-overrides.ts (into cell
// styles in a DWG from R2010, the flag word and values otherwise), its cell formats as an
// edited cell's are (table-cells.ts).

import type { TableStyle } from '@node-projects/acad-ts';
import {
  ACadVersion,
  BlockRecord,
  CadValueType,
  CellContent,
  CellStyleType,
  CellType,
  TableCellContentType,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  type TableEntity,
} from '@node-projects/acad-ts';
import type { Handle, TableCell, TableGeometry } from '@triya/engine';
import { resolve, type Resolver } from './entities';
import { cellStyleProblems, dwgFrom2010, formatFileProblems } from './table-cells';
import { overrideFileProblems, overrideValueProblems, stylesAfter } from './table-overrides';

/** DXF 90, the table value flag, on every corpus table (DXF and DWG before R2010). */
const VALUE_FLAG = 22;

type RowType = 'title' | 'header' | 'data';

/** The row type of each row: the title and header rows first unless the style suppresses them. */
function rowTypes(style: TableStyle | null, rows: number): RowType[] {
  const first: RowType[] = [];
  if (!style?.suppressTitle) first.push('title');
  if (!style?.suppressHeaderRow) first.push('header');
  return Array.from({ length: rows }, (_, i) => first[i] ?? 'data');
}

/** The table style's cell style id of each row type (DWG R2010+), 1 to 3 when it lists none. */
function rowStyleIds(style: TableStyle | null): Record<RowType, number> {
  const ids = new Map((style?.cellStyles ?? []).map((c) => [c.name.toUpperCase(), c.id]));
  return {
    title: ids.get('_TITLE') ?? 1,
    header: ids.get('_HEADER') ?? 2,
    data: ids.get('_DATA') ?? 3,
  };
}

/**
 * The rows of a new table's grid, or of rows inserted where no row of the table is left to take
 * the style of (table-grid.ts): each on the cell style of its row type, by its place.
 */
export function newRows(style: TableStyle | null, count: number): TableEntityRow[] {
  const ids = rowStyleIds(style);
  return rowTypes(style, count).map((type) => {
    const row = new TableEntityRow();
    row.styleId = ids[type];
    row.cellStyleOverride.cellStyleType = CellStyleType.Row;
    row.cellStyleOverride.hasData = true;
    return row;
  });
}

/** A new column, `width` wide, its cell style overriding nothing. */
export function newColumn(width: number): TableEntityColumn {
  const column = new TableEntityColumn();
  column.width = width;
  column.cellStyleOverride.cellStyleType = CellStyleType.Column;
  return column;
}

/**
 * A new cell for `c`, as AutoCAD makes one: a cell style overriding nothing, and a block cell
 * holding a block content. Its value is written after, as for an edited cell.
 */
export function newCell(c: TableCell): TableEntityCell {
  const cell = new TableEntityCell();
  cell.styleOverride.cellStyleType = CellStyleType.Cell;
  cell.styleOverride.hasData = true;
  if (c.type === 'block') {
    cell.type = CellType.Block;
    cell.blockScale = 1;
    const content = new CellContent();
    content.contentType = TableCellContentType.Block;
    // AutoCAD states a block cell's value as an empty string (R2007+ DWG).
    content.cadValue.valueType = CadValueType.String;
    content.cadValue.isEmpty = true;
    cell.contents.push(content);
  }
  return cell;
}

/**
 * Builds the grid of a new table on `t` (whose style is set): its columns, rows and cells, a
 * block cell holding a block content, the rows' cell styles by row type. Values are written
 * after, as for an edited table.
 */
export function buildGrid(t: TableEntity, g: TableGeometry): void {
  t.valueFlag = VALUE_FLAG;
  t.content.cellStyleOverride.cellStyleType = CellStyleType.FormattedTableData;
  t.content.cellStyleOverride.hasData = true;
  for (const width of g.columnWidths) t.columns.push(newColumn(width));
  const rows = newRows(t.style, g.cells.length);
  for (const [i, cells] of g.cells.entries()) {
    const row = rows[i]!;
    for (const c of cells) row.cells.push(newCell(c));
    t.rows.push(row);
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────

const at = (i: number, j: number): string => `cell (${i}, ${j})`;

const ANONYMOUS_TABLE_BLOCK = /^\*T/i;

/**
 * Why `g` cannot be a new table, in whatever file: its block must be an anonymous `*T` block
 * (the one the TABLE command makes for it; that no other entity uses it is checked in
 * export.ts), and its overrides values AutoCAD takes.
 */
export function newTableProblems(r: Resolver, g: TableGeometry): string[] {
  const out: string[] = [];
  const block = g.block === undefined ? undefined : resolve(r, g.block, BlockRecord);
  if (block && (!block.isAnonymous || !ANONYMOUS_TABLE_BLOCK.test(block.name))) {
    out.push(`block ${g.block} is not an anonymous *T block (the TABLE command makes one)`);
  }
  out.push(...overrideValueProblems(r, undefined, g.overrides));
  return out;
}

/**
 * Why the file at hand cannot hold the new table `g`: a format before R14 (AutoCAD saves a table
 * to R14 and later; R12 has no custom objects), what its cell formats and table-wide overrides
 * cannot state there (table-cells.ts, table-overrides.ts): in a DWG from R2010 a cell format is
 * checked against what the cell's row gives it once the overrides are in the rows.
 */
export function newTableFileProblems(r: Resolver, g: TableGeometry): string[] {
  const { version, format } = r;
  const known = version !== undefined && version !== ACadVersion.Unknown;
  if (known && version < ACadVersion.AC1014) {
    return [`${ACadVersion[version]} holds no tables (AutoCAD saves them to R14 and later)`];
  }
  const styles = dwgFrom2010(format, version);
  const after = styles ? stylesAfter(r, undefined, undefined, g) : undefined;
  const out: string[] = [];
  for (const [i, row] of g.cells.entries()) {
    for (const [j, c] of row.entries()) {
      const was = after?.format[i]?.[j];
      out.push(
        ...formatFileProblems(was, c.format, version, format, styles).map(
          (p) => `${at(i, j)}: ${p}`,
        ),
      );
      if (after) {
        out.push(
          ...cellStyleProblems(after.inherited[i]?.[j], after.margins, was, c.format).map(
            (p) => `${at(i, j)}: ${p}`,
          ),
        );
      }
    }
  }
  out.push(...overrideFileProblems(r, undefined, g, undefined));
  return out;
}

/** The entity (other than `self`) whose block is `block`, if any: a table's `*T` is its own. */
export function blockUser(
  entities: Iterable<{ handle: Handle; type: string; geom: object }>,
  block: Handle,
  self: Handle,
): { handle: Handle; type: string } | undefined {
  for (const e of entities) {
    if (e.handle !== self && (e.geom as { block?: Handle }).block === block) return e;
  }
  return undefined;
}
