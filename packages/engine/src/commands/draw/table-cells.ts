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
//
// Fields (M4-23): the editor offers Insert Field (Ctrl+F), Edit Field and Update Field as the
// MTEXT editor does (`askEditorText`), and a field code typed or inserted makes the cell's fields
// (`TableCell.field`), the cell showing their values; a cell with fields opens on their codes.
// A field's value is the cell's text as it is, not read by the cell's data format.
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
import type {
  DrawingField,
  MTextGeometry,
  TableCell,
  TableGeometry,
  TableStyleRecord,
} from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { mtextEditorRequest } from './text';
import { editableFieldText, fieldValues, textWithFields } from '../../edit/fields';
import type { DrawingUnits } from '../units';
import { askEditorText, fieldContextOf } from './field';
import { tableCellUnder } from './table-cell-menu';
import { drawingUnits } from '../units';

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
    // Fields open as their codes, each shown by its value (M4-23).
    const old = cell.field ? editableFieldText(cell.field) : cell.text;
    let updated = false;
    const a: PromptAnswer = yield* askEditorText(
      ctx,
      {
        message: 'Enter text',
        spaces: true,
        editor: {
          ...mtextEditorRequest(ctx.model, plan),
          cell: true,
          value: old,
          fields: cell.field ? fieldValues(cell.field) : {},
        },
      },
      ctx.model.entity(id)?.owner ?? ctx.space,
      () => (updated = true),
    );
    if (a.kind !== 'string') return;
    let g = t.g;
    if (a.value !== old || updated) {
      const units = drawingUnits(ctx.model.header);
      const typed =
        a.value.includes('%<') || cell.field
          ? textWithFields(
              a.value,
              { ...(await fieldContextOf(ctx)), space: ctx.model.entity(id)?.owner ?? ctx.space },
              cell.field,
            )
          : { text: a.value };
      g = withCellTyped(g, r, c, typed, units);
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
 * Table `g` with the text typed into cell (`i`, `j`): its fields, when it has any, with the text
 * they show, which is the cell's text as it is (no value read from it by the data format); else
 * the text, read by the cell's data format (`withCellText`).
 */
function withCellTyped(
  g: TableGeometry,
  i: number,
  j: number,
  typed: { readonly text: string; readonly field?: DrawingField },
  units: DrawingUnits,
): TableGeometry {
  const withText = withCellText(g, i, j, typed.text, units);
  const cells = withText.cells.map((row, k) =>
    k !== i
      ? row
      : row.map((c, l): TableCell => {
          if (l !== j) return c;
          const { field: _field, ...plain } = c;
          if (!typed.field) return plain;
          const { value: _value, ...rest } = plain;
          return { ...rest, text: typed.text, field: typed.field };
        }),
  );
  return { ...withText, cells };
}

/**
 * "Pick a table cell:" until a table cell is picked (or the drafter ends it): the table and the
 * cell heading the range picked. A table picked first, or double-clicked, is taken with the
 * point it was picked at.
 */
export async function* pickTableCell(
  ctx: CommandContext,
): Sub<{ id: EntityId; cell: [number, number] } | undefined> {
  // A click inside a cell, where nothing is drawn, picks the cell (M4-16): typed at `Command:`
  // with nothing selected, the prompt takes a point, as AutoCAD's does.
  if (ctx.preselected.length === 0) return yield* pointedTableCell(ctx);
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

/** "Pick a table cell:" as a point, the cell of the table under it (the last drawn first). */
async function* pointedTableCell(
  ctx: CommandContext,
): Sub<{ id: EntityId; cell: [number, number] } | undefined> {
  for (;;) {
    const a = yield ctx.prompt.point({ message: 'Pick a table cell', osnap: 0 });
    if (a.kind !== 'point') return undefined;
    const picked = tableCellUnder(ctx.model, ctx.space, a.point, 0);
    if (picked) return picked;
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
