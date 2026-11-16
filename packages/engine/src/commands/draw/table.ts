// -TABLE (M4-05): a new empty table on the command line, with AutoCAD 2024's prompts
// ("-TABLE (Command)", AutoCAD 2024 Help):
//   Current table style: Standard  Cell width: 2.5000  Cell height: 1 line(s)
//   Enter number of columns or [Auto] <5>:
//   Enter number of rows or [Auto] <1>:
//   Specify insertion point or [Style/Width/Height]:
//     Style:  Enter a table style name or [?] <Standard>:
//     Width:  Specify column width <2.5000>:
//     Height: Enter row height (in lines) <1>:
// The rows are data rows, under the title and header rows the table style does not suppress,
// as in the Insert Table dialog's Column & row settings. The table takes the current table
// style (CTABLESTYLE); a drawing without table styles gets AutoCAD's Standard. The insertion
// point is the table's upper left corner (its lower left in a style that flows up). Its block
// is drawn by the table engine. The column count, row count, width and height stay for the next
// table of the drawing, as AutoCAD keeps them this session. Auto (sizing the table by picking
// its corners) is not offered yet.
import type { TableStyleRecord } from '../../model/types';
import {
  currentTableStyle,
  newTableGeometry,
  standardTableStyle,
  writeTableBlock,
} from '../../edit/table';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatDistance } from '../units';

/** AutoCAD's Insert Table defaults: five columns 2.5 wide (63.5 metric), one data row a line high. */
interface TableSettings {
  columns: number;
  rows: number;
  width: number | undefined;
  lines: number;
}

const value = (a: PromptAnswer): number => (a as { readonly value: number }).value;

/** "Enter a table style name or [?]": a style of the drawing (any case); undefined when ended. */
async function* askStyle(
  ctx: CommandContext,
  current: string,
): AsyncGenerator<Prompt, TableStyleRecord | null | undefined, PromptAnswer> {
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
    const styles = [...ctx.model.tables.tableStyles.values()];
    // A drawing without table styles has only the Standard it will get.
    if (styles.length === 0 && name.toUpperCase() === 'STANDARD') return null;
    const style = styles.find((s) => s.name.toUpperCase() === name.toUpperCase());
    if (style) return style;
    ctx.message(`Cannot find table style "${name}".`);
  }
}

/** -TABLE for one document; it keeps the table's size for the next. */
export function tableCommand(): CommandDef {
  const state: TableSettings = { columns: 5, rows: 1, width: undefined, lines: 1 };
  return {
    name: '-TABLE',
    async *run(ctx) {
      const model = ctx.model;
      const units = drawingUnits(model.header);
      const metric = model.meta.measurement !== 'imperial';
      const width = () => state.width ?? (metric ? 63.5 : 2.5);
      // null: the Standard style the drawing gets with its first table.
      let style: TableStyleRecord | null = currentTableStyle(model) ?? null;
      // That style names a text style, and the save writes none without one (an R1 or R2.5
      // drawing has no text styles; AutoCAD's always have STANDARD, so it never says this).
      if (!style && model.tables.textStyles.size === 0) {
        ctx.message('The drawing has no text style, which a table style needs.');
        return;
      }
      const styleName = () => style?.name ?? 'Standard';
      ctx.message(
        `Current table style: ${styleName()}  Cell width: ${formatDistance(width(), units)}  Cell height: ${state.lines} line(s)`,
      );
      const count = async function* (
        message: string,
        current: number,
      ): AsyncGenerator<Prompt, number | undefined, PromptAnswer> {
        for (;;) {
          const a = yield ctx.prompt.integer({
            message,
            options: ['Auto'],
            default: { kind: 'number', value: current },
          });
          if (a.kind === 'keyword') {
            ctx.message('Auto is not available yet: enter a number.');
            continue;
          }
          if (a.kind !== 'number') return undefined;
          if (a.value >= 1 && a.value <= 32767) return a.value;
          ctx.message('Value must be between 1 and 32767.');
        }
      };
      const columns: number | undefined = yield* count('Enter number of columns or', state.columns);
      if (columns === undefined) return;
      state.columns = columns;
      const rows: number | undefined = yield* count('Enter number of rows or', state.rows);
      if (rows === undefined) return;
      state.rows = rows;

      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Specify insertion point or',
          options: ['Style', 'Width', 'Height'],
        });
        if (a.kind === 'keyword') {
          if (a.keyword === 'Style') {
            const s: TableStyleRecord | null | undefined = yield* askStyle(ctx, styleName());
            if (s === undefined) return;
            style = s;
          } else if (a.keyword === 'Width') {
            for (;;) {
              const w = yield ctx.prompt.distance({
                message: 'Specify column width',
                default: { kind: 'number', value: width() },
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
        const at = a.point;
        const props = currentProps(model);
        const chosen = style;
        ctx.edit((b) => {
          const textStyles = [...model.tables.textStyles.values()];
          const standardText =
            textStyles.find((s) => s.name.toUpperCase() === 'STANDARD') ?? textStyles[0];
          const s =
            chosen ??
            b.addTableRecord('tableStyles', standardTableStyle(metric, standardText?.handle));
          const geom = newTableGeometry({
            style: s,
            columns,
            dataRows: rows,
            columnWidth: width(),
            rowLines: state.lines,
            position: at,
          });
          const table = b.addEntity({ owner: ctx.space, ...props, geom });
          writeTableBlock(b, model, table.id);
        });
        return;
      }
    },
  };
}
