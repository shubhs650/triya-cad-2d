// The Table Cell menu's formatting (M4-05 part 4): Background Fill, Alignment, Edit Borders
// (AutoCAD 2024's Table Cell tab, Cell Styles panel, and the cell shortcut menu) and the text
// height Properties sets, asked at the command line, as Triya has no ribbon yet. Edit Borders is
// AutoCAD's Cell Border Properties dialog as prompts: which borders (No Borders hides them and
// asks nothing more), then their colour, lineweight and linetype (the dialog's defaults, ByBlock,
// at Enter), Double Line and its Spacing (M4-16 part 7). The dialog's Spacing default is .1800,
// the data text height of AutoCAD's imperial Standard table style; the help does not say whether
// it follows the drawing, so the default here is the text height of the first cell selected,
// which is that .1800 in an imperial drawing and keeps the lines apart alike in a metric one.
import { tableCellStyle } from '../../annotation/table';
import {
  TABLE_BORDER_SETS,
  withCellBorders,
  withCellsFormatted,
  type TableBorderSet,
} from '../../edit/table-format';
import type { TableCellRange } from '../../edit/table-grid';
import type {
  Color,
  LinetypeRef,
  Lineweight,
  TableGeometry,
  TableStyleRecord,
} from '../../model/types';
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
  const s = tableCellStyle(g, style, r.r0, r.c0);
  const b = c.format?.borders;
  return {
    alignment: c.format?.alignment ?? s?.alignment ?? 1,
    textHeight: c.format?.textHeight ?? s?.textHeight ?? 0.18,
    /** The spacing of a double border the cell already has, if any. */
    spacing: [b?.top, b?.right, b?.bottom, b?.left].find((e) => e?.double)?.spacing,
  };
}

/** A linetype typed as CHPROP takes one: ByLayer, ByBlock or a loaded linetype's name. */
function linetypeByName(ctx: CommandContext, name: string): LinetypeRef | undefined {
  const u = name.trim().toUpperCase();
  if (u === 'BYLAYER') return 'ByLayer';
  if (u === 'BYBLOCK') return 'ByBlock';
  for (const l of ctx.model.tables.linetypes.values()) {
    if (l.name.toUpperCase() === u) return l.handle;
  }
  return undefined;
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
        // A file's alignment out of 1–9 reads as the nearest.
        default: {
          kind: 'keyword',
          keyword: ALIGNMENTS[Math.min(Math.max(Math.round(now.alignment), 1), 9) - 1]!,
        },
        shortcutMenu: menu,
      });
      if (a.kind !== 'keyword') return undefined;
      const alignment = ALIGNMENTS.indexOf(a.keyword as (typeof ALIGNMENTS)[number]) + 1;
      return withCellsFormatted(g, r, { alignment });
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
      if (which.keyword === 'None') {
        return withCellBorders(g, r, 'None', { color: BY_BLOCK, lineweight: 'ByBlock' });
      }
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
      let linetype: LinetypeRef | undefined;
      while (linetype === undefined) {
        const a = yield ctx.prompt.string({
          message: 'Enter border linetype',
          defaultLabel: 'ByBlock',
        });
        if (a.kind === 'enter') linetype = 'ByBlock';
        else if (a.kind !== 'string') return undefined;
        else if ((linetype = linetypeByName(ctx, a.value)) === undefined) {
          ctx.message(
            `Linetype ${a.value.trim()} not found.  Use the LINETYPE command to load it.`,
          );
        }
      }
      const twice = yield ctx.prompt.keyword({
        message: 'Double line?',
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: 'No' },
      });
      if (twice.kind !== 'keyword') return undefined;
      let double: number | undefined;
      while (twice.keyword === 'Yes' && double === undefined) {
        const a = yield ctx.prompt.distance({
          message: 'Specify double line spacing',
          default: { kind: 'distance', value: now.spacing ?? now.textHeight },
        });
        if (a.kind !== 'distance') return undefined;
        if (a.value > 0) double = a.value;
        else ctx.message('Requires a value greater than 0.');
      }
      return withCellBorders(g, r, which.keyword as TableBorderSet, {
        color,
        lineweight,
        linetype,
        ...(double !== undefined && { double }),
      });
    }
  }
}
