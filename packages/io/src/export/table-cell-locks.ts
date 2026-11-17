// TriyaToAcad for table cell locks (M4-16 part 6): what of a cell is locked
// (`TableCell.locked`), as AutoCAD's Cell Locking sets it. A table states it as each cell's state
// flags, 0x1 content locked and 0x10 format locked (Open Design Specification, AcDbTableContent
// cell state; acad-ts `TableCellStateFlags`): a DWG from R2010 in the table, a DXF only in the
// table's AutoCAD 2008 data (its TABLECONTENT, table-content.ts), which a DXF save writes from the
// table as it writes the DWG's. The legacy ACAD_TABLE codes have no place for them.
//
// Only the two lock flags are written; the others (read only, linked, modified after an update:
// a data link's) stay as read.
import { ACadVersion, TableCellStateFlags, type TableEntity } from '@node-projects/acad-ts';
import type { TableCell, TableGeometry } from '@triya/engine';
import type { Resolver } from './entities';
import { rowOrigins } from './table-grid';

const LOCKS = TableCellStateFlags.ContentLocked | TableCellStateFlags.FormatLocked;

/** The state flags lock `locked` sets. */
function lockFlags(locked: TableCell['locked']): number {
  if (locked === 'both') return LOCKS;
  if (locked === 'content') return TableCellStateFlags.ContentLocked;
  if (locked === 'format') return TableCellStateFlags.FormatLocked;
  return 0;
}

/**
 * Writes the cells' locks of `g` into `t` (whose rows and cells are where `g` puts them), a DWG
 * from R2010's table or a DXF table's content. A cell whose lock flags already say what the model
 * does is left as it is.
 */
export function writeCellLocks(t: TableEntity, g: TableGeometry): void {
  for (const [i, row] of t.rows.entries()) {
    for (const [j, cell] of row.cells.entries()) {
      const c = g.cells[i]?.[j];
      if (!c) continue;
      const want = lockFlags(c.locked);
      if ((cell.stateFlags & LOCKS) !== want) cell.stateFlags = (cell.stateFlags & ~LOCKS) | want;
    }
  }
}

/**
 * Why the file at hand cannot hold the cell locks of `g` (`was` the table as read, undefined for
 * a new one): only a DWG from R2010 and a DXF table's TABLECONTENT state them, which a DXF save
 * writes for a new table from R2000 and keeps for an edited one from R2007 (before R2007 an
 * edited table's round-trip data is dropped, DEC-069). As for cell styles
 * (table-cell-styles.ts), what the table held as read is left to the save; only a change is
 * refused.
 */
export function cellLockFileProblems(
  r: Resolver,
  was: TableGeometry | undefined,
  g: TableGeometry,
): string[] {
  const { version, format } = r;
  const least =
    format === 'dwg' ? ACadVersion.AC1024 : was ? ACadVersion.AC1021 : ACadVersion.AC1015;
  if (version === undefined || version === ACadVersion.Unknown || version >= least) return [];
  if (!g.cells.some((row) => row.some((c) => c.locked))) return [];
  if (was && sameLocks(was, g)) return [];
  return [
    `locked cells (M4-16 part 6), which ${ACadVersion[version]} ${format === 'dwg' ? 'DWG' : 'DXF'} cannot state`,
  ];
}

/** Whether `g` has the rows and cells of `was`, locked as they were. */
function sameLocks(was: TableGeometry, g: TableGeometry): boolean {
  if (g.rowOrigins || g.columnOrigins) return false;
  const rows = rowOrigins(g);
  return g.cells.every((row, i) =>
    row.every((c, j) => {
      const o = rows[i];
      const b = o === null || o === undefined ? undefined : was.cells[o]?.[j];
      return (b?.locked ?? undefined) === c.locked;
    }),
  );
}
