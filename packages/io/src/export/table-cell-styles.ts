// TriyaToAcad for each table row's and cell's cell style (M4-16 part 5): the Title, Header or
// Data cell style a row or cell is on (`TableGeometry.rowStyles`, `TableCell.cellStyle`). A
// table states them as each row's and cell's cell style id (the table style's `_TITLE`,
// `_HEADER` and `_DATA`; a cell's 0 is By Row): a DWG from R2010 in the table, a DXF only in the
// table's AutoCAD 2008 data (its TABLECONTENT, table-content.ts), which a DXF save writes from
// the table as it writes the DWG's, so the legacy ACAD_TABLE codes, which give the first rows
// their type by their place, never state them.
//
// Only what the edit changes is written: a row or cell on a cell style of the drafter's own (an
// id naming none of the three, M1-99) keeps it unless the model's style for it changed. A cell
// stating its row's style id as its own (ezdxf's tables do) is By Row to Triya, and is set to 0
// only when its row changes under it.
import { ACadVersion, type TableEntity } from '@node-projects/acad-ts';
import { tableRowStyles, type TableCellStyleName, type TableGeometry } from '@triya/engine';
import { rowTypeOf } from '../map/entities';
import { tableStyleRows } from '../map/styles';
import type { Resolver } from './entities';
import { neighbour, rowOrigins } from './table-grid';
import { rowStyleIds } from './table-new';

/**
 * Each row's cell style in `g`, and each row's in `was` (the table as read, aligned to `g`'s rows
 * by their origins; for a new row the row the save copies it from, table-grid.ts `regrid`;
 * undefined for a new table).
 */
function rowStylesOf(
  rows: Parameters<typeof tableRowStyles>[1],
  was: TableGeometry | undefined,
  g: TableGeometry,
): { after: TableCellStyleName[]; before: (TableCellStyleName | undefined)[] } {
  const after = tableRowStyles(g, rows);
  if (!was) return { after, before: after.map(() => undefined) };
  const read = tableRowStyles(was, rows);
  const origins = rowOrigins(g);
  return {
    after,
    before: origins.map((o, i) => read[o ?? neighbour(origins, i) ?? -1]),
  };
}

/**
 * Writes the rows' and cells' cell styles of `g` into `t` (whose rows and cells are where `g`
 * puts them, its style set), a DWG from R2010's table or a DXF table's content: `was` is the
 * table as read (undefined for a new one), its rows by their own index.
 */
export function writeCellStyleNames(
  t: TableEntity,
  was: TableGeometry | undefined,
  g: TableGeometry,
): void {
  const ids = rowStyleIds(t.style);
  const typeOf = rowTypeOf(t.style);
  const { after, before } = rowStylesOf(tableStyleRows(t.style), was, g);
  const origins = was ? rowOrigins(g) : g.cells.map(() => null);
  const columns = g.columnOrigins ?? g.columnWidths.map((_, j) => j);
  for (const [i, row] of t.rows.entries()) {
    const type = after[i]!;
    const rowChanged = before[i] !== type;
    if (rowChanged && typeOf(row.styleId) !== type) row.styleId = ids[type];
    const o = origins[i];
    for (const [j, cell] of row.cells.entries()) {
      const c = g.cells[i]?.[j];
      if (!c) continue;
      const p = columns[j];
      const b =
        was && o !== null && o !== undefined && p !== null && p !== undefined
          ? was.cells[o]?.[p]
          : undefined;
      if (!rowChanged && b && b.cellStyle === c.cellStyle) continue;
      const want = c.cellStyle ?? type;
      const has = cell.styleId === 0 ? type : typeOf(cell.styleId);
      if (has !== want) cell.styleId = c.cellStyle ? ids[c.cellStyle] : 0;
    }
  }
}

/**
 * Why the file at hand cannot hold the rows' and cells' cell styles of `g` (`was` the table as
 * read, undefined for a new one): only a DWG from R2010 and a DXF table's TABLECONTENT state
 * them, which a DXF save writes for a new table from R2000 and keeps for an edited one from
 * R2007 (before R2007 an edited table's round-trip data is dropped, DEC-069).
 */
export function cellStyleFileProblems(
  r: Resolver,
  was: TableGeometry | undefined,
  g: TableGeometry,
  rows: Parameters<typeof tableRowStyles>[1],
): string[] {
  const { version, format } = r;
  const least =
    format === 'dwg' ? ACadVersion.AC1024 : was ? ACadVersion.AC1021 : ACadVersion.AC1015;
  if (version === undefined || version === ACadVersion.Unknown || version >= least) return [];
  const placed = tableRowStyles({ rowHeights: g.rowHeights }, rows);
  const stated =
    tableRowStyles(g, rows).some((type, i) => type !== placed[i]) ||
    g.cells.some((row) => row.some((c) => c.cellStyle !== undefined));
  // What the table held as read is left to the save as before (DEC-069); only a change is refused.
  if (!stated || (was && sameStyles(was, g))) return [];
  return [
    `rows or cells on a cell style other than their place gives them (M4-16 part 5), which ${ACadVersion[version]} ${format === 'dwg' ? 'DWG' : 'DXF'} cannot state`,
  ];
}

/** Whether `g` has the rows and cells of `was`, on the cell styles they had. */
function sameStyles(was: TableGeometry, g: TableGeometry): boolean {
  if (g.rowOrigins || g.columnOrigins) return false;
  if (JSON.stringify(was.rowStyles) !== JSON.stringify(g.rowStyles)) return false;
  const rows = rowOrigins(g);
  const columns = g.columnOrigins ?? g.columnWidths.map((_, j) => j);
  return g.cells.every((row, i) =>
    row.every((c, j) => {
      const o = rows[i];
      const p = columns[j];
      const b =
        o === null || o === undefined || p === null || p === undefined
          ? undefined
          : was.cells[o]?.[p];
      return b ? b.cellStyle === c.cellStyle : c.cellStyle === undefined;
    }),
  );
}
