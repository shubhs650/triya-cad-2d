// The table cell editor (M4-05 part 2): a cell's text typed in the In-Place Text Editor where the
// cell draws it, as AutoCAD 2024 edits table cells (TABLEDIT, a double click on a cell, and the
// first cell of a table TABLE or -TABLE has just inserted). Tab moves to the next cell (a row is
// added after the last one), Shift+Tab to the previous one, and an arrow key at the edge of the
// text to the cell beside; Ctrl+Enter or a click outside the editor ends it, Esc drops what was
// typed in the cell open (the cells closed before keep theirs).
//
// A row grows to fit the text typed in it: the renderer, which has the fonts, lays the text out
// (`textBox`) and the row takes the lines it fills (`fitTableRow`). Without the fonts (no canvas,
// a font not loaded) the row keeps its height.
import { tableCellAt, tableCellText } from '../../annotation/table';
import {
  fitTableRow,
  laidOutLines,
  tableCellMove,
  tableDrawingOf,
  tableFromPlan,
  tableToPlan,
  withCellText,
  withRowAdded,
  writeTableBlock,
} from '../../edit/table';
import type { EntityId } from '../../model/entity-ids';
import { tableAxes } from '../../spatial/entity-bounds';
import type { MTextGeometry, TableGeometry, TableStyleRecord } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { mtextEditorRequest } from './text';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export function tableOf(
  ctx: CommandContext,
  id: EntityId,
): { g: TableGeometry; style: TableStyleRecord | undefined } | undefined {
  const g = ctx.model.entity(id)?.geom;
  if (g?.kind !== 'ACAD_TABLE') return undefined;
  const style = g.style !== undefined ? ctx.model.tables.tableStyles.get(g.style) : undefined;
  return { g, style };
}

/** How many lines the renderer lays `text` out in; undefined when it cannot (no fonts). */
export async function linesOf(
  ctx: CommandContext,
  text: MTextGeometry,
): Promise<number | undefined> {
  if (text.contents === '') return 1;
  const r = await ctx.view.request({ op: 'textBox', text });
  if (!r.ok || !r.box) return undefined;
  return laidOutLines(r.box.maxY - r.box.minY, text.height);
}

/**
 * Edits table `id`'s cells from the one heading the range at (`i`, `j`) until the editor closes
 * without a move. Each cell's text is its own edit, its rows fitted to it and the table's block
 * drawn again.
 */
export async function* editTableCells(
  ctx: CommandContext,
  id: EntityId,
  i: number,
  j: number,
): Sub<void> {
  let at: [number, number] = [i, j];
  for (;;) {
    const t = tableOf(ctx, id);
    if (!t) return;
    const [r, c] = at;
    const cell = t.g.cells[r]?.[c];
    if (!cell) return;
    const drawing = tableDrawingOf(ctx.model);
    const local = tableCellText(t.g, t.style, drawing, r, c);
    const axis = tableAxes(t.g).x;
    const turn = Math.atan2(axis.y, axis.x);
    const plan: MTextGeometry = {
      ...local,
      position: tableToPlan(t.g, local.position),
      rotation: local.rotation + turn,
    };
    const a = yield ctx.prompt.string({
      message: 'Enter text',
      spaces: true,
      editor: { ...mtextEditorRequest(ctx.model, plan), cell: true },
    });
    if (a.kind !== 'string') return;
    let g = t.g;
    if (a.value !== cell.text) {
      g = withCellText(g, r, c, a.value);
      const lines = await linesOf(ctx, tableCellText(g, t.style, drawing, r, c));
      if (lines !== undefined) g = fitTableRow(g, t.style, r, c, lines);
    }
    let next = a.cell ? tableCellMove(g, t.style, r, c, a.cell) : undefined;
    if (a.cell === 'next' && next === undefined) {
      g = withRowAdded(g);
      next = [g.cells.length - 1, 0];
    }
    if (g !== t.g) {
      const changed = g;
      ctx.edit((b) => {
        b.updateEntity(id, { geom: changed });
        writeTableBlock(b, ctx.model, id);
      });
    }
    if (!a.cell) return;
    // An arrow at the table's edge, or Shift+Tab in the first cell, stays in the cell.
    at = next ?? at;
  }
}

/**
 * "Pick a table cell:" until a table cell is picked (or the drafter ends it): the table and the
 * cell heading the range picked. A table picked first, or double-clicked, is taken with the
 * point it was picked at.
 */
export async function* pickTableCell(
  ctx: CommandContext,
): Sub<{ id: EntityId; cell: [number, number] } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Pick a table cell',
      editable: true,
      single: true,
      pickfirst: true,
    });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const id = a.ids.find((x) => ctx.model.entity(x)?.geom.kind === 'ACAD_TABLE');
    const t = id !== undefined ? tableOf(ctx, id) : undefined;
    const cell = t && a.pick ? tableCellAt(t.g, t.style, tableFromPlan(t.g, a.pick)) : undefined;
    if (id !== undefined && cell) return { id, cell };
    ctx.message('The object selected is not a table cell.');
  }
}

/**
 * TABLEDIT (AutoCAD 2024 Help, "TABLEDIT (Command)"): "Pick a table cell:", then the cell's text
 * in the In-Place Text Editor. A double click on a table runs it (`DOUBLE_CLICK`) on the cell
 * double-clicked.
 */
export function tableditCommand(): CommandDef {
  return {
    name: 'TABLEDIT',
    usesSelection: 'before',
    async *run(ctx) {
      const picked = yield* pickTableCell(ctx);
      if (picked) yield* editTableCells(ctx, picked.id, picked.cell[0], picked.cell[1]);
    },
  };
}
