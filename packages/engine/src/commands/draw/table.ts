// TABLE and -TABLE (M4-05): a new empty table, with AutoCAD 2024's Insert Table dialog
// ("Insert Table Dialog Box") and its command-line prompts ("-TABLE (Command)"):
//   Current table style: Standard  Cell width: 2.5000  Cell height: 1 line(s)
//   Enter number of columns or [Auto] <5>:
//   Enter number of rows or [Auto] <1>:
//   Specify insertion point or [Style/Width/Height]:
//     Style:  Enter a table style name or [?] <Standard>:
//     Width:  Specify column width <2.5000>:
//     Height: Enter row height (in lines) <1>:
// Auto sizes the table by a window: "Specify first corner or [Style/Width/Height]:", then
// "Specify second corner:"; Auto at the columns takes as many columns of the width as fit, else
// the columns share the window's width; Auto at the rows takes as many data rows as fit, else
// the rows take as many lines as fit (`windowTableSize`). The dialog's Specify window does the
// same, its Columns or Column width (and Data rows or Row height) being the one the window sets.
// The rows are data rows, under the title and header rows the table style does not suppress.
// The table takes the current table style (CTABLESTYLE); a drawing without table styles gets
// AutoCAD's Standard. The insertion point is the table's upper left corner (its lower left in a
// style that flows up), and the table is dragged with the cursor until it is picked. Its block
// is drawn by the table engine, and the In-Place Text Editor then opens in its first cell, as
// AutoCAD's does. The sizes and the dialog's choices stay for the drawing's next table, as
// AutoCAD keeps them this session.
import type { Vec2 } from '../../geom/types';
import type { EntityGeometry, TableStyleRecord } from '../../model/types';
import type { EntityId } from '../../model/entity-ids';
import { tableParts } from '../../annotation/table';
import {
  currentTableStyle,
  newTableGeometry,
  standardTableStyle,
  tableDrawingOf,
  windowTableSize,
  writeTableBlock,
  type TableSize,
} from '../../edit/table';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { InsertTableSettings, Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatDistance } from '../units';
import { editTableCells, tableditCommand } from './table-cells';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/**
 * What TABLE and -TABLE keep for the next table: AutoCAD's Insert Table defaults, five columns
 * 2.5 wide (63.5 metric), one data row a line high, placed by its insertion point; with Specify
 * window, the window sets the column width and the number of data rows.
 */
interface TableSettings {
  columns: number;
  rows: number;
  width: number | undefined;
  lines: number;
  window: boolean;
  autoColumns: boolean;
  autoRows: boolean;
}

const value = (a: PromptAnswer): number => (a as { readonly value: number }).value;

/** A table style of the drawing by name (any case); null: the Standard a drawing without any gets. */
function styleNamed(ctx: CommandContext, name: string): TableStyleRecord | null | undefined {
  const styles = [...ctx.model.tables.tableStyles.values()];
  if (styles.length === 0 && name.toUpperCase() === 'STANDARD') return null;
  return styles.find((s) => s.name.toUpperCase() === name.toUpperCase());
}

/** "Enter a table style name or [?]": a style of the drawing; undefined when ended. */
async function* askStyle(
  ctx: CommandContext,
  current: string,
): Sub<TableStyleRecord | null | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter a table style name or',
      options: ['?'],
      default: { kind: 'string', value: current },
    });
    if (a.kind === 'keyword') {
      ctx.message('Table styles:');
      const names = [...ctx.model.tables.tableStyles.values()].map((s) => s.name).sort();
      for (const n of names) ctx.message(`  ${n}`);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const name = a.value.trim();
    const style = styleNamed(ctx, name);
    if (style !== undefined) return style;
    ctx.message(`Cannot find table style "${name}".`);
  }
}

/** What placing a table needs: its style (null: the Standard it brings) and the drawing's units. */
interface Placing {
  readonly style: TableStyleRecord | null;
  readonly metric: boolean;
}

/** The style a table is drawn with, Standard standing in until the drawing gets it. */
const shownStyle = (p: Placing): TableStyleRecord =>
  p.style ?? { handle: '', ...standardTableStyle(p.metric, undefined) };

/** The lines of a new table of `size` inserted at the origin: what is dragged to place it. */
function tablePreview(ctx: CommandContext, p: Placing, size: TableSize): EntityGeometry[] {
  const style = shownStyle(p);
  const g = newTableGeometry({ style, ...size, position: { x: 0, y: 0 } });
  return tableParts(g, style, tableDrawingOf(ctx.model))
    .filter((x) => !x.defpoint && x.geom.kind === 'LINE')
    .map((x) => x.geom as EntityGeometry);
}

/** Adds the table and draws its block; its id. */
function makeTable(ctx: CommandContext, p: Placing, size: TableSize, at: Vec2): EntityId {
  const model = ctx.model;
  const props = currentProps(model);
  let id: EntityId | undefined;
  ctx.edit((b) => {
    const textStyles = [...model.tables.textStyles.values()];
    const standardText =
      textStyles.find((s) => s.name.toUpperCase() === 'STANDARD') ?? textStyles[0];
    const s =
      p.style ??
      b.addTableRecord('tableStyles', standardTableStyle(p.metric, standardText?.handle));
    const geom = newTableGeometry({ style: s, ...size, position: at });
    id = b.addEntity({ owner: ctx.space, ...props, geom }).id;
    writeTableBlock(b, model, id);
  });
  return id!;
}

/**
 * The window a table is sized by, from `first`: its second corner, then the table's size and
 * insertion point (the window's upper left corner, its lower left in a style that flows up).
 */
async function* tableWindow(
  ctx: CommandContext,
  p: Placing,
  size: TableSize,
  autoColumns: boolean,
  autoRows: boolean,
  first: Vec2,
): Sub<{ size: TableSize; at: Vec2 } | undefined> {
  const q = yield ctx.prompt.point({
    message: 'Specify second corner',
    rubberBand: { from: first, box: true },
  });
  if (q.kind !== 'point') return undefined;
  const w = Math.abs(q.point.x - first.x);
  const h = Math.abs(q.point.y - first.y);
  if (!(w > 0) || !(h > 0)) {
    ctx.message('The window must have a width and a height.');
    return undefined;
  }
  const style = shownStyle(p);
  const sized = windowTableSize(style, size, autoColumns, autoRows, w, h);
  const x = Math.min(first.x, q.point.x);
  const y = style.flowDirection === 1 ? Math.min(first.y, q.point.y) : Math.max(first.y, q.point.y);
  return { size: sized, at: { x, y } };
}

/** The table placed: the editor opens in its first cell. */
async function* placed(ctx: CommandContext, p: Placing, size: TableSize, at: Vec2): Sub<void> {
  ctx.preview([]);
  const id = makeTable(ctx, p, size, at);
  yield* editTableCells(ctx, id, 0, 0);
}

/** The settings the Insert Table dialog opens on. */
function dialogSettings(
  state: TableSettings,
  styleName: string,
  width: number,
): InsertTableSettings {
  return {
    style: styleName,
    window: state.window,
    columns: state.columns,
    width,
    dataRows: state.rows,
    lines: state.lines,
    autoColumns: state.autoColumns,
    autoRows: state.autoRows,
  };
}

/** Why the dialog's settings cannot make a table, or undefined. */
function settingsProblem(s: InsertTableSettings): string | undefined {
  const whole = (n: number, max = 32767) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!whole(s.columns)) return 'The number of columns must be between 1 and 32767.';
  if (!whole(s.dataRows)) return 'The number of data rows must be between 1 and 32767.';
  if (!(s.width > 0)) return 'The column width must be positive and nonzero.';
  if (!whole(s.lines)) return 'The row height must be a whole number of lines from 1.';
  return undefined;
}

/** TABLE, -TABLE and TABLEDIT for one document, TABLE and -TABLE keeping one table's size. */
export function tableCommands(): CommandDef[] {
  const state: TableSettings = {
    columns: 5,
    rows: 1,
    width: undefined,
    lines: 1,
    window: false,
    autoColumns: false,
    autoRows: true,
  };
  /** The drawing's style for its next table, or why it cannot have one. */
  const start = (ctx: CommandContext): Placing | undefined => {
    const model = ctx.model;
    // That style names a text style, and the save writes none without one (an R1 or R2.5
    // drawing has no text styles; AutoCAD's always have STANDARD, so it never says this).
    const style = currentTableStyle(model) ?? null;
    if (!style && model.tables.textStyles.size === 0) {
      ctx.message('The drawing has no text style, which a table style needs.');
      return undefined;
    }
    return { style, metric: model.meta.measurement !== 'imperial' };
  };
  const widthOf = (p: Placing) => state.width ?? (p.metric ? 63.5 : 2.5);
  const sizeOf = (p: Placing): TableSize => ({
    columns: state.columns,
    columnWidth: widthOf(p),
    dataRows: state.rows,
    rowLines: state.lines,
  });

  const table: CommandDef = {
    name: 'TABLE',
    async *run(ctx) {
      let p = start(ctx);
      if (!p) return;
      const a = yield ctx.prompt.dialog({
        message: 'Insert Table',
        dialog: {
          type: 'inserttable',
          settings: dialogSettings(state, p.style?.name ?? 'Standard', widthOf(p)),
          styles:
            ctx.model.tables.tableStyles.size > 0
              ? [...ctx.model.tables.tableStyles.values()].map((s) => ({
                  name: s.name,
                  suppressTitle: s.suppressTitle,
                  suppressHeader: s.suppressHeader,
                  up: s.flowDirection === 1,
                }))
              : [{ name: 'Standard', suppressTitle: false, suppressHeader: false, up: false }],
        },
      });
      if (a.kind !== 'dialog' || a.action !== 'ok' || !a.table) return;
      const s = a.table;
      const problem = settingsProblem(s);
      const style = styleNamed(ctx, s.style);
      if (problem || style === undefined) {
        ctx.message(problem ?? `Cannot find table style "${s.style}".`);
        return;
      }
      Object.assign(state, {
        columns: s.columns,
        rows: s.dataRows,
        width: s.width,
        lines: s.lines,
        window: s.window,
        autoColumns: s.autoColumns,
        autoRows: s.autoRows,
      });
      p = { ...p, style };
      if (s.window) {
        const c = yield ctx.prompt.point({ message: 'Specify first corner' });
        if (c.kind !== 'point') return;
        const w = yield* tableWindow(ctx, p, sizeOf(p), s.autoColumns, s.autoRows, c.point);
        if (w) yield* placed(ctx, p, w.size, w.at);
        return;
      }
      ctx.preview(tablePreview(ctx, p, sizeOf(p)));
      const at = yield ctx.prompt.point({
        message: 'Specify insertion point',
        drag: { kind: 'preview', from: { x: 0, y: 0 } },
      });
      ctx.preview([]);
      if (at.kind === 'point') yield* placed(ctx, p, sizeOf(p), at.point);
    },
  };

  const dashTable: CommandDef = {
    name: '-TABLE',
    async *run(ctx) {
      let p = start(ctx);
      if (!p) return;
      const units = drawingUnits(ctx.model.header);
      const styleName = () => p!.style?.name ?? 'Standard';
      ctx.message(
        `Current table style: ${styleName()}  Cell width: ${formatDistance(widthOf(p), units)}  Cell height: ${state.lines} line(s)`,
      );
      /** A count, or 'Auto'; undefined when ended. */
      const count = async function* (
        message: string,
        current: number,
      ): Sub<number | 'Auto' | undefined> {
        for (;;) {
          const a = yield ctx.prompt.integer({
            message,
            options: ['Auto'],
            default: { kind: 'number', value: current },
          });
          if (a.kind === 'keyword') return 'Auto';
          if (a.kind !== 'number') return undefined;
          if (a.value >= 1 && a.value <= 32767) return a.value;
          ctx.message('Value must be between 1 and 32767.');
        }
      };
      const columns = yield* count('Enter number of columns or', state.columns);
      if (columns === undefined) return;
      if (columns !== 'Auto') state.columns = columns;
      const rows = yield* count('Enter number of rows or', state.rows);
      if (rows === undefined) return;
      if (rows !== 'Auto') state.rows = rows;
      const auto = columns === 'Auto' || rows === 'Auto';

      for (;;) {
        if (!auto) ctx.preview(tablePreview(ctx, p, sizeOf(p)));
        const a = yield ctx.prompt.point({
          message: auto ? 'Specify first corner or' : 'Specify insertion point or',
          options: ['Style', 'Width', 'Height'],
          ...(!auto && { drag: { kind: 'preview', from: { x: 0, y: 0 } } }),
        });
        ctx.preview([]);
        if (a.kind === 'keyword') {
          if (a.keyword === 'Style') {
            const s: TableStyleRecord | null | undefined = yield* askStyle(ctx, styleName());
            if (s === undefined) return;
            p = { ...p, style: s };
          } else if (a.keyword === 'Width') {
            for (;;) {
              const w = yield ctx.prompt.distance({
                message: 'Specify column width',
                default: { kind: 'number', value: widthOf(p) },
              });
              if (w.kind !== 'distance' && w.kind !== 'number') return;
              if (value(w) > 0) {
                state.width = value(w);
                break;
              }
              ctx.message('Value must be positive and nonzero.');
            }
          } else {
            for (;;) {
              const h = yield ctx.prompt.integer({
                message: 'Enter row height (in lines)',
                default: { kind: 'number', value: state.lines },
              });
              if (h.kind !== 'number') return;
              if (h.value >= 1) {
                state.lines = h.value;
                break;
              }
              ctx.message('Value must be positive and nonzero.');
            }
          }
          continue;
        }
        if (a.kind !== 'point') return;
        if (!auto) {
          yield* placed(ctx, p, sizeOf(p), a.point);
          return;
        }
        const w = yield* tableWindow(
          ctx,
          p,
          sizeOf(p),
          columns === 'Auto',
          rows === 'Auto',
          a.point,
        );
        if (w) yield* placed(ctx, p, w.size, w.at);
        return;
      }
    },
  };

  return [table, dashTable, tableditCommand()];
}
