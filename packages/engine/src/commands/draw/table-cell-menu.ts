// Table cells selected and the Table Cell menu (M4-05 part 3). In AutoCAD 2024 a click inside a
// table cell selects the cell ("To Select Table Cells": Shift+click another cell selects the
// cells between), its border shown, and the Table Cell ribbon tab and the cell shortcut menu
// then insert and delete rows and columns, merge and unmerge cells and edit the text.
// Triya has no ribbon yet, so TABLECELL is the selection, its prompt's options the Table Cell
// tab's actions and its right-click menu the cell shortcut menu; every action is one undo step
// and ends it, the click elsewhere or Esc too. A click at `Command:` inside a cell, farther from
// its lines than the pickbox reaches, starts it (a click on a line still selects the table);
// typed, it asks "Pick a table cell:" first. A double click gives way to TABLEDIT.
//
// The cells selected show a grip in the middle of each edge of the selection (M4-05 part 6,
// `tableCellGrips`): a click on one asks for the point it goes to, its column or row sized so.
// Paste (Ctrl+V while cells are selected, M4-13) pastes a spreadsheet's cells into the cells
// from the first one selected (`withCellsPasted`), or another app's text into that cell.
// Match Cell gives the cells clicked the first cell's format; Remove All Property Overrides
// leaves the cells selected their cell style's (M4-05 part 7). Insert Block... opens TINSERT's
// dialog on the first cell selected (M4-16). Data Format... opens the Table Cell Format dialog
// (M4-16 part 2, `dataFormattedTable`).
import { tableCellAt, tableCellBox, tableCellText, tableRangeHeads } from '../../annotation/table';
import {
  fitTableRow,
  tableDrawingOf,
  tableFromPlan,
  tableToPlan,
  writeTableBlock,
} from '../../edit/table';
import { tableCellGrips, type TableGripRole } from '../../edit/table-grips';
import { withCellMatched, withCellOverridesRemoved } from '../../edit/table-format';
import { tabSeparatedCells, type SheetCells } from '../../edit/spreadsheet';
import { sameGrip } from '../../edit/grips';
import {
  tableCellOptions,
  tableCellRange,
  withCellsPasted,
  withCellsMerged,
  withCellsUnmerged,
  withColumnsDeleted,
  withColumnsInserted,
  withRowsDeleted,
  withRowsInserted,
  TABLE_CELL_OPTIONS,
  type TableCellOption,
  type TableCellRange,
} from '../../edit/table-grid';
import type { Vec2 } from '../../geom/types';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { TableGeometry, TableStyleRecord } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer, ShortcutMenuItem } from '../prompt';
import { sub } from '../../geom/vec';
import { movedTableGrip } from '../../edit/table-grips';
import { editTableCells, linesOf, pickTableCell, tableOf } from './table-cells';
import { formattedTable, type TableCellFormatOption } from './table-cell-format';
import { insertCellBlock } from './table-block';
import { dataFormattedTable } from './table-data-format';

type Cell = [number, number];

/** The cell shortcut menu's labels (AutoCAD's, its Rows, Columns and Merge items flattened). */
const LABELS: Readonly<Record<TableCellOption, string>> = {
  Text: 'Edit Text',
  // AutoCAD's cell menu has Cut, Copy and Paste; Triya pastes another app's cells (M4-13).
  Paste: 'Paste',
  // AutoCAD's cell menu: Insert > Block... (TINSERT's dialog, M4-16).
  BLock: 'Insert Block...',
  BAckground: 'Background Fill',
  ALignment: 'Alignment',
  BOrders: 'Borders',
  // Not on AutoCAD's cell menu (Properties sets it): here as Triya has no Properties for cells.
  Height: 'Text Height',
  // AutoCAD's cell menu: Data Format... (the Table Cell Format dialog, M4-16).
  DataFormat: 'Data Format...',
  Match: 'Match Cell',
  RemoveOverrides: 'Remove All Property Overrides',
  Above: 'Insert Rows Above',
  Below: 'Insert Rows Below',
  DeleteRows: 'Delete Rows',
  Left: 'Insert Columns Left',
  Right: 'Insert Columns Right',
  DeleteColumns: 'Delete Columns',
  MergeAll: 'Merge All',
  MergeRows: 'Merge By Row',
  MergeColumns: 'Merge By Column',
  Unmerge: 'Unmerge',
};

const SEPARATED = new Set<TableCellOption>(['BAckground', 'Above', 'Left', 'MergeAll']);

const FORMATS = new Set<TableCellOption>(['BAckground', 'ALignment', 'BOrders', 'Height']);

/** Why an option is refused for the cells selected. */
function refusal(o: TableCellOption, g: TableGeometry, r: TableCellRange): string {
  if (o === 'DeleteColumns') return 'The last column cannot be deleted.';
  if (o === 'DeleteRows' && r.r1 - r.r0 + 1 >= g.cells.length) {
    return 'The last row cannot be deleted.';
  }
  if (o === 'Unmerge') return 'No merged cell is selected.';
  if (o === 'RemoveOverrides') return 'The cells selected override nothing of their cell style.';
  if (o === 'Below') return 'Rows can be inserted below the header row and the data rows only.';
  if (o.startsWith('Merge')) return 'Select more than one cell to merge.';
  return 'Rows can be inserted above and deleted only among the data rows.';
}

/** Table `g` after option `o` on range `r`. */
function edited(g: TableGeometry, r: TableCellRange, o: TableCellOption): TableGeometry {
  const rows = r.r1 - r.r0 + 1;
  const columns = r.c1 - r.c0 + 1;
  switch (o) {
    case 'Above':
      return withRowsInserted(g, r.r0, rows, r.r0);
    case 'Below':
      return withRowsInserted(g, r.r1 + 1, rows, r.r1);
    case 'DeleteRows':
      return withRowsDeleted(g, r.r0, r.r1);
    case 'Left':
      return withColumnsInserted(g, r.c0, columns, r.c0);
    case 'Right':
      return withColumnsInserted(g, r.c1 + 1, columns, r.c1);
    case 'DeleteColumns':
      return withColumnsDeleted(g, r.c0, r.c1);
    case 'MergeAll':
      return withCellsMerged(g, r, 'all');
    case 'MergeRows':
      return withCellsMerged(g, r, 'rows');
    case 'MergeColumns':
      return withCellsMerged(g, r, 'columns');
    default:
      return withCellsUnmerged(g, r);
  }
}

/**
 * Table `g` with the rows of range `r` grown to fit their cells' text at its new height, as the
 * renderer lays it out (`linesOf`; a row keeps its height where it cannot).
 */
async function fittedRows(
  ctx: CommandContext,
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  r: TableCellRange,
): Promise<TableGeometry> {
  const drawing = tableDrawingOf(ctx.model);
  const heads = new Set<string>();
  const all = tableRangeHeads(g);
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) heads.add(String(all[i]![j]));
  }
  let out = g;
  for (const h of heads) {
    const [i, j] = h.split(',').map(Number) as [number, number];
    const lines = await linesOf(ctx, tableCellText(out, style, drawing, i, j));
    out = fitTableRow(out, style, i, j, lines ?? 1);
  }
  return out;
}

/**
 * What the Clipboard holds to paste into table cells (M4-13): a spreadsheet's cells, or another
 * app's text as one cell; undefined (said why) for anything else.
 */
async function clipboardCells(ctx: CommandContext): Promise<SheetCells | undefined> {
  const reply = await ctx.view.request({ op: 'clipboard' });
  if (!reply.ok) {
    ctx.message(reply.message);
    return undefined;
  }
  if (reply.cells && reply.cells.length > 0) return reply.cells;
  const text = reply.text?.replace(/\r\n?/g, '\n') ?? '';
  const cells = tabSeparatedCells(text);
  if (cells) return cells;
  if (text.trim() !== '') return [[{ text, rowSpan: 1, columnSpan: 1, merged: false }]];
  ctx.message('The Clipboard holds no cells or text to paste into the table.');
  return undefined;
}

/**
 * A grip of the cells selected (M4-05 part 6) dragged: table `id` with its column or row sized as
 * `role` says to the point given, or undefined when none is given or it changes nothing.
 */
async function* draggedCellGrip(
  ctx: CommandContext,
  id: EntityId,
  grip: Vec2,
  role: TableGripRole,
): AsyncGenerator<Prompt, TableGeometry | undefined, PromptAnswer> {
  const a = yield ctx.prompt.point({
    message: 'Specify stretch point',
    rubberBand: { from: grip },
    drag: { kind: 'table', id, role, from: grip },
  });
  const t = tableOf(ctx, id);
  if (a.kind !== 'point' || !t) return undefined;
  return movedTableGrip(t.g, t.style, role, sub(a.point, grip));
}

/**
 * Match Cell (M4-05 part 7): each cell of table `id` clicked takes the format of cell `from`, a
 * merged cell whole, its rows growing to fit, until Enter or Esc, as AutoCAD's Match Cell asks
 * for one destination cell after another. Only cells of the same table are taken: AutoCAD's
 * documentation names no other, and a click elsewhere says so.
 */
async function* matchCells(
  ctx: CommandContext,
  id: EntityId,
  from: Cell,
): AsyncGenerator<Prompt, void, PromptAnswer> {
  ctx.preview([]);
  for (;;) {
    const a = yield ctx.prompt.point({ message: 'Select destination cell', osnap: 0 });
    const t = tableOf(ctx, id);
    if (a.kind !== 'point' || !t) return;
    const cell = cellAt(ctx, id, a.point);
    if (!cell) {
      ctx.message('Select a cell of the same table.');
      continue;
    }
    const [i, j] = cell;
    const c = t.g.cells[i]![j]!;
    const range = { r0: i, c0: j, r1: i + c.rowSpan - 1, c1: j + c.columnSpan - 1 };
    const g = await fittedRows(ctx, withCellMatched(t.g, from, range), t.style, range);
    ctx.edit((b) => {
      b.updateEntity(id, { geom: g });
      writeTableBlock(b, ctx.model, id);
    });
  }
}

/** The cell (head of its range) of table `g` that a point in plan lies in, or undefined. */
function cellAt(ctx: CommandContext, id: EntityId, p: Vec2): Cell | undefined {
  const t = tableOf(ctx, id);
  return t && tableCellAt(t.g, t.style, tableFromPlan(t.g, p));
}

/** TABLECELL on table `id` from cell `start`, or asking for the cell first. */
export function tableCellCommand(start?: {
  readonly id: EntityId;
  readonly cell: Cell;
}): CommandDef {
  return {
    name: 'TABLECELL',
    usesSelection: start ? 'none' : 'before',
    yieldsToDoubleClick: true,
    async *run(ctx) {
      const picked = start ?? (yield* pickTableCell(ctx));
      if (!picked) return;
      const id = picked.id;
      let anchor: Cell = picked.cell;
      let corner: Cell = picked.cell;
      for (;;) {
        const t = tableOf(ctx, id);
        if (!t) return;
        const r = tableCellRange(t.g, anchor, corner);
        const box = tableCellBox(t.g, t.style, r);
        const corners = [
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.maxY },
          { x: box.minX, y: box.maxY },
        ];
        ctx.preview([
          {
            kind: 'LWPOLYLINE',
            closed: true,
            vertices: corners.map((p) => ({ ...tableToPlan(t.g, p), bulge: 0 })),
          },
        ]);
        const grips = tableCellGrips(t.g, t.style, r);
        const on = tableCellOptions(t.g, t.style, r);
        const menu: ShortcutMenuItem[] = TABLE_CELL_OPTIONS.map((o) => ({
          label: LABELS[o],
          keyword: o,
          ...(!on.includes(o) && { disabled: true as const }),
          ...(SEPARATED.has(o) && { separatorBefore: true as const }),
        }));
        const a = yield ctx.prompt.point({
          message: 'Enter a table cell option',
          options: TABLE_CELL_OPTIONS,
          // A click picks a cell where it is, not where an object snap would take it.
          osnap: 0,
          shortcutMenu: menu,
          shortcutMenuTitle: 'Table cell options',
          // A press dragged across cells selects them all (M4-05 part 4).
          releaseExtends: true,
          grips: grips.map((g) => g.point),
          pasteKeyword: 'Paste',
        });
        const grip =
          a.kind === 'point' && !a.shift && grips.find((g) => sameGrip(g.point, a.point));
        if (grip) {
          ctx.preview([]);
          const g = yield* draggedCellGrip(ctx, id, grip.point, grip.role);
          if (!g) return;
          ctx.edit((b) => {
            b.updateEntity(id, { geom: g });
            writeTableBlock(b, ctx.model, id);
          });
          return;
        }
        if (a.kind === 'point') {
          const cell = cellAt(ctx, id, a.point);
          // A Shift+click, or a drag's end, outside the table keeps the cells selected.
          if (!cell && a.shift) continue;
          if (!cell) return;
          corner = cell;
          if (!a.shift) anchor = cell;
          continue;
        }
        if (a.kind !== 'keyword') return;
        const o = a.keyword as TableCellOption;
        if (!on.includes(o)) {
          ctx.message(refusal(o, t.g, r));
          continue;
        }
        if (o === 'Text') return yield* editTableCells(ctx, id, r.r0, r.c0);
        if (o === 'BLock') {
          ctx.preview([]);
          const [i, j] = tableRangeHeads(t.g)[r.r0]![r.c0]!;
          return yield* insertCellBlock(ctx, id, i, j);
        }
        if (o === 'Match') {
          const head = tableRangeHeads(t.g)[r.r0]![r.c0]!;
          return yield* matchCells(ctx, id, head);
        }
        let g: TableGeometry | undefined;
        if (o === 'Paste') {
          const cells = await clipboardCells(ctx);
          if (!cells) continue;
          const pasted = withCellsPasted(t.g, [r.r0, r.c0], cells);
          g = await fittedRows(ctx, pasted.geom, t.style, pasted.range);
        } else if (o === 'RemoveOverrides') {
          g = withCellOverridesRemoved(t.g, t.style, r);
        } else if (o === 'DataFormat') {
          ctx.preview([]);
          g = yield* dataFormattedTable(ctx, t.g, r);
          if (!g) return;
          g = await fittedRows(ctx, g, t.style, r);
        } else if (FORMATS.has(o)) {
          g = yield* formattedTable(ctx, t.g, t.style, r, o as TableCellFormatOption);
          if (!g) return;
          if (o === 'Height') g = await fittedRows(ctx, g, t.style, r);
        } else g = edited(t.g, r, o);
        const changed = g;
        ctx.preview([]);
        ctx.edit((b) => {
          b.updateEntity(id, { geom: changed });
          writeTableBlock(b, ctx.model, id);
        });
        return;
      }
    },
  };
}

/** The tables of each space, kept until the drawing changes: a click looks for cells in them. */
const tablesSeen = new WeakMap<
  DocumentModel,
  { version: number; space: Handle; ids: EntityId[] }
>();

function tablesIn(model: DocumentModel, space: Handle): EntityId[] {
  const seen = tablesSeen.get(model);
  if (seen && seen.version === model.version && seen.space === space) return seen.ids;
  const ids = model.hasBlock(space)
    ? model.blockEntities(space).filter((id) => model.entity(id)?.geom.kind === 'ACAD_TABLE')
    : [];
  tablesSeen.set(model, { version: model.version, space, ids });
  return ids;
}

/**
 * The table cell a click at `p` in `space` is inside, more than `reach` from the lines around
 * it (the lines inside a merged cell do not count), in a table shown on a layer that is not
 * locked: the last table drawn first, as a pick takes what is on top.
 */
export function tableCellUnder(
  model: DocumentModel,
  space: Handle,
  p: Vec2,
  reach: number,
): { id: EntityId; cell: Cell } | undefined {
  for (const id of [...tablesIn(model, space)].reverse()) {
    const e = model.entity(id);
    const g = e?.geom;
    if (!e || g?.kind !== 'ACAD_TABLE' || !e.visible) continue;
    // Only a table that is shown and can be edited: not on a layer off, frozen or locked.
    const l = model.tables.layers.get(e.layer);
    if (l && (!l.on || l.frozen || l.locked)) continue;
    const style = g.style !== undefined ? model.tables.tableStyles.get(g.style) : undefined;
    const q = tableFromPlan(g, p);
    const cell = tableCellAt(g, style, q);
    if (!cell) continue;
    const near = [
      { x: q.x + reach, y: q.y },
      { x: q.x - reach, y: q.y },
      { x: q.x, y: q.y + reach },
      { x: q.x, y: q.y - reach },
    ].some((n) => String(tableCellAt(g, style, n)) !== String(cell));
    if (!near) return { id, cell };
  }
  return undefined;
}
