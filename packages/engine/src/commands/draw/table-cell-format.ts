// The Table Cell menu's formatting (M4-05 part 4): Background Fill, Alignment, Edit Borders
// (AutoCAD 2024's Table Cell tab, Cell Styles panel, and the cell shortcut menu) and the text
// height Properties sets, asked at the command line, as Triya has no ribbon yet. Edit Borders is
// AutoCAD's Cell Border Properties dialog as prompts: which borders, then their colour and
// lineweight (the dialog's defaults, ByBlock, at Enter). A border's linetype and double lines,
// and hiding a border (which a DXF save cannot state yet, M1-81), are not done.
import { rowCellStyle, tableRowTypes } from '../../annotation/table';
import {
  TABLE_BORDER_SETS,
  withCellBorders,
  withCellsFormatted,
  type TableBorderSet,
} from '../../edit/table-format';
import type { TableCellRange } from '../../edit/table-grid';
import type { Color, Lineweight, TableGeometry, TableStyleRecord } from '../../model/types';
import type { CommandContext } from '../command';
import type { Prompt, PromptAnswer, ShortcutMenuItem } from '../prompt';
import { lineweightFromText } from '../modify/chprop';
import { colorText, parseColor, parseTrueColor } from '../modify/attributes';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The formatting options of the Table Cell menu. */
export type TableCellFormatOption = 'BAckground' | 'ALignment' | 'BOrders' | 'Height';

/** The alignments as typed (MTEXT's Justify letters), 1 top left … 9 bottom right. */
const ALIGNMENTS = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'] as const;
const ALIGNMENT_LABELS = [
  'Top Left',
  'Top Center',
  'Top Right',
  'Middle Left',
  'Middle Center',
  'Middle Right',
  'Bottom Left',
  'Bottom Center',
  'Bottom Right',
];

const BY_BLOCK: Color = { kind: 'byBlock' };

/** What the range's first cell is drawn with: its own format, else its row's cell style. */
function firstCell(g: TableGeometry, style: TableStyleRecord | undefined, r: TableCellRange) {
  const c = g.cells[r.r0]![r.c0]!;
  const s = rowCellStyle(style, tableRowTypes(style, g.cells.length)[r.r0]!);
  return {
    alignment: c.format?.alignment ?? s?.alignment ?? 1,
    textHeight: c.format?.textHeight ?? s?.textHeight ?? 0.18,
  };
}

/** A colour typed as AutoCAD types one: a name, an ACI number, ByLayer, ByBlock or r,g,b. */
const typedColor = (text: string): Color | undefined => parseColor(text) ?? parseTrueColor(text);

/**
 * Table `g` with option `o` asked and applied to range `r`; undefined when the drafter ends it
 * at a prompt.
 */
export async function* formattedTable(
  ctx: CommandContext,
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  r: TableCellRange,
  o: TableCellFormatOption,
): Sub<TableGeometry | undefined> {
  const now = firstCell(g, style, r);
  switch (o) {
    case 'ALignment': {
      const menu: ShortcutMenuItem[] = ALIGNMENTS.map((k, i) => ({
        label: ALIGNMENT_LABELS[i]!,
        keyword: k,
      }));
      const a = yield ctx.prompt.keyword({
        message: 'Enter cell alignment',
        options: ALIGNMENTS,
        default: { kind: 'keyword', keyword: ALIGNMENTS[now.alignment - 1] ?? 'TL' },
        shortcutMenu: menu,
      });
      if (a.kind !== 'keyword') return undefined;
      const alignment = ALIGNMENTS.indexOf(a.keyword as (typeof ALIGNMENTS)[number]) + 1;
      return alignment > 0 ? withCellsFormatted(g, r, { alignment }) : undefined;
    }
    case 'Height': {
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: 'Specify text height',
          default: { kind: 'distance', value: now.textHeight },
        });
        if (a.kind !== 'distance') return undefined;
        if (a.value > 0) return withCellsFormatted(g, r, { textHeight: a.value });
        ctx.message('Requires a value greater than 0.');
      }
    }
    case 'BAckground': {
      for (;;) {
        const a = yield ctx.prompt.string({
          message: 'Enter background fill color',
          options: ['None'],
          default: { kind: 'keyword', keyword: 'None' },
        });
        if (a.kind === 'keyword') return withCellsFormatted(g, r, { background: null });
        if (a.kind !== 'string') return undefined;
        const c = typedColor(a.value);
        if (c) return withCellsFormatted(g, r, { background: c });
        ctx.message('Invalid color.');
      }
    }
    case 'BOrders': {
      const which = yield ctx.prompt.keyword({
        message: 'Apply the border properties to',
        options: TABLE_BORDER_SETS,
        default: { kind: 'keyword', keyword: 'All' },
      });
      if (which.kind !== 'keyword') return undefined;
      let color: Color | undefined;
      while (!color) {
        const a = yield ctx.prompt.string({
          message: 'Enter border color',
          defaultLabel: colorText(BY_BLOCK),
        });
        if (a.kind === 'enter') color = BY_BLOCK;
        else if (a.kind !== 'string') return undefined;
        else if (!(color = typedColor(a.value))) ctx.message('Invalid color.');
      }
      let lineweight: Lineweight | undefined;
      while (lineweight === undefined) {
        const a = yield ctx.prompt.string({
          message: 'Enter border lineweight',
          defaultLabel: 'ByBlock',
        });
        if (a.kind === 'enter') lineweight = 'ByBlock';
        else if (a.kind !== 'string') return undefined;
        else if ((lineweight = lineweightFromText(a.value)) === undefined) {
          ctx.message('Invalid lineweight.');
        }
      }
      return withCellBorders(g, r, which.keyword as TableBorderSet, { color, lineweight });
    }
  }
}
