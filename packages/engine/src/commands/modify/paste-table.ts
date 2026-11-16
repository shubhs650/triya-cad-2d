// PASTECLIP of a spreadsheet's cells (M4-06, edit/spreadsheet.ts): a table of them in the current
// table style (AutoCAD's Standard where the drawing has none, as TABLE adds it), dragged by its
// insertion point, its upper left corner, until it is picked; one undo step. AutoCAD 2024 pastes
// cells copied in a spreadsheet as a table with PASTESPEC's "AutoCAD Entities" (its PASTECLIP
// pastes them as an OLE object, which Triya does not have, PRD non-goal 9); Triya's PASTECLIP
// does it, the common drafter's expectation of a paste of a spreadsheet into a drawing.
//
// A spreadsheet's columns have widths of their own, which its copy does not carry as drawing
// units: each column is as wide as its widest text and the cell margins, as the renderer lays the
// text out unwrapped, at least half and at most four times TABLE's default column width (2.5, or
// 63.5 metric), a longer text wrapping; each row is then as high as its cells' text needs. Without
// the fonts (no canvas) the columns take TABLE's width and a row the lines its text breaks into.
import { tableCellText, tableParts } from '../../annotation/table';
import type { Vec2 } from '../../geom/types';
import type { EntityGeometry, TableGeometry, TableStyleRecord } from '../../model/types';
import {
  currentTableStyle,
  fitTableRow,
  standardTableStyle,
  tableDrawingOf,
  writeTableBlock,
} from '../../edit/table';
import { pastedTableGeometry, type SheetCells } from '../../edit/spreadsheet';
import { currentProps } from '../../properties/current';
import { linesOf } from '../draw/table-cells';
import type { CommandContext } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const ORIGIN: Vec2 = { x: 0, y: 0 };

/** Table `g`'s columns fitted to their text and its rows to their lines, where the fonts allow. */
async function fitted(
  ctx: CommandContext,
  g: TableGeometry,
  style: TableStyleRecord,
  cells: SheetCells,
  width: number,
): Promise<TableGeometry> {
  const drawing = tableDrawingOf(ctx.model);
  const heads: [number, number][] = [];
  cells.forEach((row, i) =>
    row.forEach((c, j) => {
      if (!c.merged && c.text.trim() !== '') heads.push([i, j]);
    }),
  );
  // The columns: each one's widest text alone in a column, unwrapped.
  const single = heads.filter(([i, j]) => cells[i]![j]!.columnSpan === 1);
  if (single.length > 0) {
    const r = await ctx.view.request({
      op: 'textWidths',
      texts: single.map(([i, j]) => ({ ...tableCellText(g, style, drawing, i, j), width: 0 })),
    });
    if (r.ok && r.widths) {
      const widest = g.columnWidths.map(() => -1);
      r.widths.forEach((w, k) => {
        const j = single[k]![1];
        if (w !== null && w > widest[j]!) widest[j] = w;
      });
      const margins = 2 * style.horizontalMargin;
      const columnWidths = widest.map((w) =>
        w < 0 ? width : Math.min(4 * width, Math.max(width / 2, w + margins)),
      );
      g = { ...g, columnWidths };
    }
  }
  // The rows: each as high as its cells' lines.
  for (const [i, j] of heads) {
    const lines =
      (await linesOf(ctx, tableCellText(g, style, drawing, i, j))) ??
      cells[i]![j]!.text.split('\n').length;
    g = fitTableRow(g, style, i, j, lines);
  }
  return g;
}

/** Pastes `cells` as a table at the insertion point asked for. */
export async function* pasteTable(ctx: CommandContext, cells: SheetCells): Sub<void> {
  const model = ctx.model;
  const current = currentTableStyle(model);
  // A table style names a text style (see TABLE).
  if (!current && model.tables.textStyles.size === 0) {
    ctx.message('The drawing has no text style, which a table style needs.');
    return;
  }
  const metric = model.meta.measurement !== 'imperial';
  const textStyles = [...model.tables.textStyles.values()];
  const standardText = textStyles.find((s) => s.name.toUpperCase() === 'STANDARD') ?? textStyles[0];
  const style: TableStyleRecord = current ?? {
    handle: '',
    ...standardTableStyle(metric, standardText?.handle),
  };
  const width = metric ? 63.5 : 2.5;
  const columns = cells[0]!.map(() => width);
  const g = await fitted(
    ctx,
    pastedTableGeometry(style, cells, columns, ORIGIN),
    style,
    cells,
    width,
  );

  ctx.preview(
    tableParts(g, style, tableDrawingOf(model))
      .filter((x) => !x.defpoint && x.geom.kind === 'LINE')
      .map((x) => x.geom as EntityGeometry),
  );
  const a = yield ctx.prompt.point({
    message: 'Specify insertion point',
    drag: { kind: 'preview', from: ORIGIN },
  });
  ctx.preview([]);
  if (a.kind !== 'point') return;
  const props = currentProps(model);
  ctx.edit((b) => {
    const s =
      current ?? b.addTableRecord('tableStyles', standardTableStyle(metric, standardText?.handle));
    const geom: TableGeometry = { ...g, style: s.handle, position: a.point };
    const { id } = b.addEntity({ owner: ctx.space, ...props, geom });
    writeTableBlock(b, model, id);
  });
}
