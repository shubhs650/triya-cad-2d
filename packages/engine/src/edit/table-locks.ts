// Table cell locking (M4-16 part 6). AutoCAD 2024's Table Cell tab, Cell Format > Cell Locking
// (and the cell shortcut menu's Locking) sets each cell selected Unlocked, Content Locked,
// Format Locked or Content and Format Locked: "Locks or unlocks the content and/or the
// formatting of the selected cells" (AutoCAD 2024 Help, "Table Cell Contextual Tab"). A cell's
// content locked, its text, value, block and fields cannot be edited; its format locked, its
// fill, alignment, borders, text height, data format and cell style cannot be changed.
//
// AutoCAD's documentation does not say what a lock does to rows and columns. Triya takes the
// common drafter expectation, that a lock keeps what is locked where it is: rows and columns
// holding a content-locked cell are not deleted and such cells are not merged away (inserting
// rows and columns beside them is free, the new cells unlocked).
import type { TableCell, TableCellLock, TableGeometry } from '../model/types';
import type { TableCellRange } from './table-grid';

/** Whether cell `c`'s content (text, value, block, fields) is locked. */
export function contentLocked(c: Pick<TableCell, 'locked'> | undefined): boolean {
  return c?.locked === 'content' || c?.locked === 'both';
}

/** Whether cell `c`'s format is locked. */
export function formatLocked(c: Pick<TableCell, 'locked'> | undefined): boolean {
  return c?.locked === 'format' || c?.locked === 'both';
}

/** What of the cells of range `r` (every one, merged-over cells too) is locked. */
export function rangeLocks(
  g: TableGeometry,
  r: TableCellRange,
): { readonly content: boolean; readonly format: boolean } {
  let content = false;
  let format = false;
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) {
      const c = g.cells[i]?.[j];
      content ||= contentLocked(c);
      format ||= formatLocked(c);
    }
  }
  return { content, format };
}

/** Table `g` with every cell of range `r` locked as `lock` says (undefined: unlocked). */
export function withCellsLocked(
  g: TableGeometry,
  r: TableCellRange,
  lock: TableCellLock | undefined,
): TableGeometry {
  const cells = g.cells.map((row, i) =>
    i < r.r0 || i > r.r1
      ? row
      : row.map((c, j): TableCell => {
          if (j < r.c0 || j > r.c1 || c.locked === lock) return c;
          const { locked: _locked, ...rest } = c;
          return lock ? { ...rest, locked: lock } : rest;
        }),
  );
  return { ...g, cells };
}
