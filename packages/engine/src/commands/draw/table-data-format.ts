// The Table Cell menu's Data Format... (M4-16 part 2): AutoCAD's Table Cell Format dialog on the
// cells selected (AutoCAD 2024 Help, "Table Cell Format Dialog Box"), opened on the first cell's
// data type; OK gives every text cell selected that data type (`withCellsDataFormat`), one undo
// step, rows growing to fit. Block cells hold no value and are left alone.
import { tableRangeHeads } from '../../annotation/table';
import {
  tableDataFormatOf,
  withCellsDataFormat,
  type TableDataFormat,
} from '../../edit/table-data';
import type { TableCellRange } from '../../edit/table-grid';
import type { TableCell, TableGeometry } from '../../model/types';
import type { CommandContext } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, type DrawingUnits } from '../units';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The Table Cell Format dialog, opened on `settings` for the first cell selected, `cell`. */
export interface TableCellFormatRequest {
  readonly type: 'tablecellformat';
  readonly settings: TableDataFormat;
  /** The first cell selected, which the Preview shows (`tableDataPreview`). */
  readonly cell: TableCell;
  /** The drawing's units, which a format stating none shows numbers in. */
  readonly units: DrawingUnits;
}

/**
 * The Table Cell Format dialog on range `r` of table `g`, and the table with the data format OK
 * gave the cells; undefined on Cancel.
 */
export async function* dataFormattedTable(
  ctx: CommandContext,
  g: TableGeometry,
  r: TableCellRange,
): Sub<TableGeometry | undefined> {
  const [i, j] = tableRangeHeads(g)[r.r0]![r.c0]!;
  const cell = g.cells[i]![j]!;
  const units = drawingUnits(ctx.model.header);
  const a = yield ctx.prompt.dialog({
    message: 'Table Cell Format',
    dialog: { type: 'tablecellformat', settings: tableDataFormatOf(cell), cell, units },
  });
  if (a.kind !== 'dialog' || a.action !== 'ok' || !a.tableDataFormat) return undefined;
  return withCellsDataFormat(g, r, a.tableDataFormat, units);
}
