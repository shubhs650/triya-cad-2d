// Table cells selected and the Table Cell menu (M4-05 part 3). In AutoCAD 2024 a click inside a
// table cell selects the cell ("To Select Table Cells": Shift+click another cell selects the
// cells between), its border shown, and the Table Cell ribbon tab and the cell shortcut menu
// then insert and delete rows and columns, merge and unmerge cells and edit the text.
// Triya has no ribbon yet, so TABLECELL is the selection, its prompt's options the Table Cell
// tab's actions and its right-click menu the cell shortcut menu; every action is one undo step
// and ends it, the click elsewhere or Esc too. A click at `Command:` inside a cell, farther from
// its lines than the pickbox reaches, starts it (a click on a line still selects the table);
// typed, it asks "Pick a table cell:" first. A double click gives way to TABLEDIT.
import { tableCellAt, tableCellBox } from '../../annotation/table';
import { tableFromPlan, tableToPlan, writeTableBlock } from '../../edit/table';
import {
  tableCellOptions,
  tableCellRange,
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
import type { TableGeometry } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { ShortcutMenuItem } from '../prompt';
import { editTableCells, pickTableCell, tableOf } from './table-cells';

type Cell = [number, number];

/** The cell shortcut menu's labels (AutoCAD's, its Rows, Columns and Merge items flattened). */
const LABELS: Readonly<Record<TableCellOption, string>> = {
  Text: 'Edit Text',
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

const SEPARATED = new Set<TableCellOption>(['Above', 'Left', 'MergeAll']);

/** Why an option is refused for the cells selected. */
function refusal(o: TableCellOption, g: TableGeometry, r: TableCellRange): string {
  if (o === 'DeleteColumns') return 'The last column cannot be deleted.';
  if (o === 'DeleteRows' && r.r1 - r.r0 + 1 >= g.cells.length) {
    return 'The last row cannot be deleted.';
  }
  if (o === 'Unmerge') return 'No merged cell is selected.';
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
        });
        if (a.kind === 'point') {
          const cell = cellAt(ctx, id, a.point);
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
        const g = edited(t.g, r, o);
        ctx.preview([]);
        ctx.edit((b) => {
          b.updateEntity(id, { geom: g });
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
