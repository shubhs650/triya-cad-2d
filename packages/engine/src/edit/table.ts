// Tables in the drawing (M4-05): the table style a new table takes, a new table's grid as the
// TABLE command builds it, and a table's `*T` block written with what the table engine draws
// for it (annotation/table.ts).
//
// The block is rewritten as AutoCAD regenerates it: the old contents go and the new get new
// handles above $HANDSEED, the block record keeping its handle; a table without a block gets a
// new anonymous `*T<n>` one. The contents lie on the table's layer, as AutoCAD's do, and the
// zero-length line every AutoCAD table block ends with on layer Defpoints, which is made (not
// plotted) when the drawing has none, as for a dimension's definition points.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  Color,
  TableCell,
  TableCellBorder,
  TableCellStyle,
  TableCellStyleName,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import type { Vec2 } from '../geom/types';
import {
  tableBlockCellScale,
  tableParts,
  tableRangeHeads,
  tableRowHeight,
  tableRowTypes,
  rowCellStyle,
  tableCellStyle,
  type TableDrawing,
} from '../annotation/table';
import { tableAxes } from '../spatial/entity-bounds';
import { defpointsLayer, layerNamed } from './dimension-block';
import { AnonymousNames } from './edit';
import { blockExtentsOf } from './mleader';
import { cellWithTypedText } from './table-data';
import { DECIMAL_UNITS, type DrawingUnits } from '../commands/units';

/**
 * The style new tables take: the one CTABLESTYLE names, else Standard, else the first;
 * undefined in a drawing with none.
 */
export function currentTableStyle(model: DocumentModel): TableStyleRecord | undefined {
  const name = model.header.get('CTABLESTYLE') ?? model.header.get('$CTABLESTYLE');
  const styles = [...model.tables.tableStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return (typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0];
}

const BY_BLOCK: Color = { kind: 'byBlock' };

const border = (): TableCellBorder => ({ lineweight: 'ByBlock', visible: true, color: BY_BLOCK });

const cellStyle = (textHeight: number, alignment: number, textStyle?: Handle): TableCellStyle => ({
  ...(textStyle !== undefined && { textStyle }),
  textHeight,
  alignment,
  textColor: BY_BLOCK,
  fillColor: { kind: 'aci', index: 7 },
  fillOn: false,
  dataType: 512,
  unitType: 0,
  borders: Array.from({ length: 6 }, border),
});

/**
 * AutoCAD's Standard table style, for a drawing that has none: acadsharp's sample drawings hold
 * the imperial one (acad.dwt: 0.06 margins, data 0.18 top centre, title 0.25 and header 0.18
 * middle centre, ByBlock borders and text, no fill); acadiso.dwt's is the same at 25 times the
 * size, rounded as AutoCAD rounds it (1.5 margins, data and header 4.5, title 6).
 */
export function standardTableStyle(
  metric: boolean,
  textStyle: Handle | undefined,
): Omit<TableStyleRecord, 'handle'> {
  const [margin, text, title] = metric ? [1.5, 4.5, 6] : [0.06, 0.18, 0.25];
  return {
    name: 'Standard',
    description: '',
    flowDirection: 0,
    styleFlags: 0,
    horizontalMargin: margin,
    verticalMargin: margin,
    suppressTitle: false,
    suppressHeader: false,
    // The file's order: data, title, header.
    cellStyles: [
      cellStyle(text, 2, textStyle),
      cellStyle(title, 5, textStyle),
      cellStyle(text, 5, textStyle),
    ],
  };
}

const empty = (more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text: '',
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

/** What the TABLE command builds: its style, size and where it goes. */
export interface NewTable {
  readonly style: TableStyleRecord;
  readonly columns: number;
  /** Data rows, below the title and header rows the style does not suppress. */
  readonly dataRows: number;
  readonly columnWidth: number;
  /** Each row's height in lines of its row type's text (`tableRowHeight`). */
  readonly rowLines: number;
  readonly position: { readonly x: number; readonly y: number };
  /** Insert Table's Set cell styles; absent for the table style's by their place. */
  readonly cellStyles?: TableRowCellStyles;
}

/**
 * Insert Table's Set cell styles (AutoCAD 2024 Help, "Insert Table Dialog Box": First row cell
 * style, Second row cell style, All other row cell styles; M4-16 part 5).
 */
export interface TableRowCellStyles {
  readonly first: TableCellStyleName;
  readonly second: TableCellStyleName;
  readonly others: TableCellStyleName;
}

/** The cell styles the first two rows of a table in `style` take by their place, and the rest. */
export function placedRowCellStyles(
  style: Pick<TableStyleRecord, 'suppressTitle' | 'suppressHeader'> | undefined,
): TableRowCellStyles {
  const [first, second] = tableRowTypes(style, 2) as [TableCellStyleName, TableCellStyleName];
  return { first, second, others: 'data' };
}

/**
 * The cell style of each of a new table's `rows` rows: by their place in `style` unless `chosen`
 * (Insert Table's Set cell styles) says, its first and second for the first two rows and the
 * rest for the others.
 */
function newRowTypes(
  style: TableStyleRecord,
  rows: number,
  chosen: TableRowCellStyles | undefined,
): TableCellStyleName[] {
  if (!chosen) return tableRowTypes(style, rows);
  return Array.from({ length: rows }, (_, i) =>
    i === 0 ? chosen.first : i === 1 ? chosen.second : chosen.others,
  );
}

/**
 * A new table's geometry, without its block: a title row merged across every column (as
 * AutoCAD's Standard title cell style merges it), a header row and `dataRows` data rows, each
 * `rowLines` lines of its own row type's text high, every cell empty. Insert Table's Set cell
 * styles (`cellStyles`) put the rows on others; a title row is merged wherever it is.
 */
export function newTableGeometry(t: NewTable): TableGeometry {
  const first = tableRowTypes(t.style, 2).filter((r) => r !== 'data').length;
  const rows = first + t.dataRows;
  const placed = tableRowTypes(t.style, rows);
  const types = newRowTypes(t.style, rows, t.cellStyles);
  const rowHeights = types.map((type) =>
    tableRowHeight(
      t.rowLines,
      rowCellStyle(t.style, type)?.textHeight ?? 0.18,
      t.style.verticalMargin,
    ),
  );
  const cells = types.map((type) =>
    Array.from({ length: t.columns }, (_, j) =>
      type !== 'title'
        ? empty()
        : j === 0
          ? empty({ columnSpan: t.columns })
          : empty({ merged: true }),
    ),
  );
  return {
    kind: 'ACAD_TABLE',
    style: t.style.handle,
    position: t.position,
    direction: { x: 1, y: 0 },
    rowHeights,
    columnWidths: Array.from({ length: t.columns }, () => t.columnWidth),
    cells,
    ...(types.some((type, i) => type !== placed[i]) && { rowStyles: types }),
  };
}

/** The text style a cell whose cell style names none takes: Standard, else the first. */
function standardTextStyle(model: DocumentModel): Handle {
  const styles = [...model.tables.textStyles.values()];
  return (styles.find((s) => s.name.toUpperCase() === 'STANDARD') ?? styles[0])?.handle ?? '';
}

/** What the table engine draws a table of `model` with besides the table and its style. */
export function tableDrawingOf(model: DocumentModel): TableDrawing {
  return {
    textStyle: standardTextStyle(model),
    blockExtents: (h) => blockExtentsOf(model, h),
  };
}

/** A point of table `g`'s block (its own frame) in plan, as the renderer places the block. */
export function tableToPlan(g: TableGeometry, p: Vec2): Vec2 {
  const { x, y } = tableAxes(g);
  return {
    x: g.position.x + p.x * x.x + p.y * y.x,
    y: g.position.y + p.x * x.y + p.y * y.y,
  };
}

/** A point in plan in table `g`'s block frame. */
export function tableFromPlan(g: TableGeometry, p: Vec2): Vec2 {
  const { x, y } = tableAxes(g);
  const d = { x: p.x - g.position.x, y: p.y - g.position.y };
  return { x: d.x * x.x + d.y * x.y, y: d.x * y.x + d.y * y.y };
}

/** MTEXT's line spacing at factor 1: 5/3 of the text height between baselines. */
const LINE_SPACING = 5 / 3;

/**
 * How many lines a cell's text of height `textHeight` was laid out in, from the height of the
 * box its glyphs fill: one line's glyphs are about the text height, each line more one line
 * spacing.
 */
export function laidOutLines(boxHeight: number, textHeight: number): number {
  if (!(textHeight > 0)) return 1;
  return 1 + Math.max(0, Math.round((boxHeight - textHeight) / (LINE_SPACING * textHeight)));
}

/**
 * Table `g` with the rows of the range cell (`i`, `j`) heads grown to fit `lines` lines of its
 * text: AutoCAD keeps a row at least as high as its text and the cell margins above and below
 * (AutoCAD's Help on table cells: a row grows to hold what is typed in its cells). A row
 * never shrinks here, as the table stores no minimum height to shrink back to; the last row of
 * a range spanning several takes what they lack. A turned cell's text runs across its rows and
 * is not fitted.
 */
export function fitTableRow(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  i: number,
  j: number,
  lines: number,
): TableGeometry {
  const c = g.cells[i]?.[j];
  if (!c || Math.abs(Math.sin(c.rotation)) > 0.5) return g;
  const th = c.format?.textHeight ?? tableCellStyle(g, style, i, j)?.textHeight ?? 0.18;
  const vm = c.format?.margins?.top ?? g.overrides?.margins?.top ?? style?.verticalMargin ?? 0;
  const need = th * (1 + (lines - 1) * LINE_SPACING) + 2 * vm;
  const last = Math.min(i + c.rowSpan, g.rowHeights.length) - 1;
  const have = g.rowHeights.slice(i, last + 1).reduce((a, b) => a + b, 0);
  if (need <= have * (1 + 1e-9)) return g;
  const rowHeights = g.rowHeights.map((h, k) => (k === last ? h + need - have : h));
  return { ...g, rowHeights };
}

/**
 * Table `g` with cell (`i`, `j`)'s text set to `text`: a block cell typed in holds the text, and
 * a cell with a data format holds the value the text reads as (`cellWithTypedText`, M4-16), in
 * the drawing's `units`.
 */
export function withCellText(
  g: TableGeometry,
  i: number,
  j: number,
  text: string,
  units: DrawingUnits = DECIMAL_UNITS,
): TableGeometry {
  const cells = g.cells.map((row, k) =>
    k !== i ? row : row.map((c, l) => (l !== j ? c : cellWithTypedText(textOnly(c), text, units))),
  );
  return { ...g, cells };
}

/** Cell `c` as a text cell: a block cell's block and its scale gone. */
function textOnly(c: TableCell): TableCell {
  const { block: _block, blockScale: _scale, autoFit: _fit, ...rest } = c;
  return { ...rest, type: 'text' };
}

/** What TINSERT's Insert a Block in a Table Cell dialog puts in a cell (M4-16). */
export interface TableCellBlock {
  /** BLOCK_RECORD handle. */
  readonly block: Handle;
  /** The block scale; with `autoFit` the block is scaled to fit the cell instead. */
  readonly scale: number;
  readonly autoFit: boolean;
  /** Radians, the cell's rotation (DXF 145), which turns its content. */
  readonly rotation: number;
  /** Overall cell alignment, 1 top left … 9 bottom right; absent keeps the cell's. */
  readonly alignment?: number;
}

/**
 * Table `g` with block `b` in cell (`i`, `j`) (the head of its range) in place of what it held,
 * as TINSERT inserts one (AutoCAD 2024 Help, "TINSERT (Command)"). With AutoFit the cell states
 * the scale the block is fitted at, as AutoCAD writes it (DXF 144 beside 174 = 1 in the corpus
 * tables); without it the cell's row grows to hold the block at its scale (`fitTableBlockRow`).
 * An alignment the cell's row style already gives is not kept as an override.
 */
export function withCellBlock(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  drawing: TableDrawing,
  i: number,
  j: number,
  b: TableCellBlock,
): TableGeometry {
  const c = g.cells[i]?.[j];
  if (!c) return g;
  const styled = tableCellStyle(g, style, i, j)?.alignment ?? 1;
  const { alignment: _alignment, ...kept } = c.format ?? {};
  const alignment = b.alignment ?? c.format?.alignment;
  const format = alignment !== undefined && alignment !== styled ? { ...kept, alignment } : kept;
  const { valueFormat: _valueFormat, value: _value, format: _format, ...rest } = c;
  const cell: TableCell = {
    ...rest,
    type: 'block',
    text: '',
    block: b.block,
    blockScale: b.scale,
    autoFit: b.autoFit,
    rotation: b.rotation,
    ...(Object.keys(format).length > 0 && { format }),
  };
  const cells = g.cells.map((row, k) => (k !== i ? row : row.map((x, l) => (l !== j ? x : cell))));
  let out: TableGeometry = { ...g, cells };
  if (b.autoFit) {
    const fitted = tableBlockCellScale(out, style, drawing, i, j);
    if (fitted !== undefined) out = withBlockScale(out, i, j, fitted);
  } else out = fitTableBlockRow(out, style, drawing, i, j);
  return out;
}

function withBlockScale(g: TableGeometry, i: number, j: number, blockScale: number): TableGeometry {
  const cells = g.cells.map((row, k) =>
    k !== i ? row : row.map((c, l) => (l !== j ? c : { ...c, blockScale })),
  );
  return { ...g, cells };
}

/**
 * Table `g` with the row of block cell (`i`, `j`) grown, as `fitTableRow` grows a row to its
 * text, to hold the cell's block at the block scale with the cell's margins above and below
 * (turned by the cell's rotation). Only the row grows: AutoCAD's documentation does not say a
 * column widens for a block, and a column keeps its width for text too.
 */
export function fitTableBlockRow(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  drawing: TableDrawing,
  i: number,
  j: number,
): TableGeometry {
  const c = g.cells[i]?.[j];
  if (!c || c.type !== 'block' || c.autoFit !== false || c.block === undefined) return g;
  const box = drawing.blockExtents?.(c.block);
  if (!box) return g;
  const k = c.blockScale !== undefined && c.blockScale > 0 ? c.blockScale : 1;
  const bw = (box.maxX - box.minX) * k;
  const bh = (box.maxY - box.minY) * k;
  const tall = Math.abs(bw * Math.sin(c.rotation)) + Math.abs(bh * Math.cos(c.rotation));
  const vm = c.format?.margins?.top ?? g.overrides?.margins?.top ?? style?.verticalMargin ?? 0;
  const need = tall + 2 * vm;
  const last = Math.min(i + c.rowSpan, g.rowHeights.length) - 1;
  const have = g.rowHeights.slice(i, last + 1).reduce((a, x) => a + x, 0);
  if (need <= have * (1 + 1e-9)) return g;
  const rowHeights = g.rowHeights.map((h, k2) => (k2 === last ? h + need - have : h));
  return { ...g, rowHeights };
}

/**
 * Table `g` with a row added at its end as Tab in its last cell adds one (AutoCAD's Help on
 * entering text in table cells: Tab in the last cell adds a row): as high as the
 * last row, its cells empty, with the last row's cell formats; the save inserts it as a new row
 * (`rowOrigins`, DEC-046).
 */
export function withRowAdded(g: TableGeometry): TableGeometry {
  const rows = g.rowHeights.length;
  const lastRow = g.cells[rows - 1] ?? [];
  const row = g.columnWidths.map((_, j) => {
    const format = lastRow[j]?.format;
    return empty(format ? { format } : {});
  });
  return {
    ...g,
    rowHeights: [...g.rowHeights, g.rowHeights[rows - 1] ?? 0],
    cells: [...g.cells, row],
    rowOrigins: [...(g.rowOrigins ?? g.rowHeights.map((_, k) => k)), null],
  };
}

/**
 * The cell heading the range the editor moves to from the range (`i`, `j`) heads, as
 * `[row, column]`: Tab the next in reading order and Shift+Tab the previous, the arrows the
 * one beside as drawn (a table that reads upwards has its first row lowest). Undefined when
 * there is none that way.
 */
export function tableCellMove(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  i: number,
  j: number,
  move: 'next' | 'previous' | 'left' | 'right' | 'up' | 'down',
): [number, number] | undefined {
  const heads = tableRangeHeads(g);
  const rows = g.cells.length;
  const columns = g.columnWidths.length;
  const c = g.cells[i]![j]!;
  const at = (r: number, k: number): [number, number] | undefined =>
    r >= 0 && r < rows && k >= 0 && k < columns ? heads[r]![k] : undefined;
  if (move === 'next' || move === 'previous') {
    const order: [number, number][] = [];
    g.cells.forEach((row, r) => row.forEach((x, k) => !x.merged && order.push([r, k])));
    const n = order.findIndex(([r, k]) => r === i && k === j);
    return order[move === 'next' ? n + 1 : n - 1];
  }
  const up = style?.flowDirection === 1;
  const lastRow = i + c.rowSpan - 1;
  if (move === 'left') return at(i, j - 1);
  if (move === 'right') return at(i, j + c.columnSpan);
  return (move === 'up') !== up ? at(i - 1, j) : at(lastRow + 1, j);
}

/**
 * Rewrites table `id`'s `*T` block with what the table engine draws for it now, as the change
 * being built sees the table and its style. Returns false when the table is gone or the drawing
 * has no layer 0.
 */
export function writeTableBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  id: EntityId,
  names: AnonymousNames = new AnonymousNames(model),
): boolean {
  const e = b.entity(id);
  if (!e || e.geom.kind !== 'ACAD_TABLE') return false;
  const g = e.geom;
  const zero = layerNamed(b, model, '0');
  if (zero === undefined) return false;
  const style = g.style !== undefined ? b.tableRecord('tableStyles', g.style) : undefined;
  const parts = tableParts(g, style, {
    textStyle: standardTextStyle(model),
    blockExtents: (h) => blockExtentsOf(model, h),
  });
  let block = g.block !== undefined && b.block(g.block) ? g.block : undefined;
  if (block === undefined) {
    block = b.addBlock({ name: names.take('T'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  } else {
    for (const old of b.blockEntities(block)) b.removeEntity(old);
  }
  const defpoints = defpointsLayer(b, model, zero);
  for (const p of parts) {
    b.addEntity({
      owner: block,
      layer: p.defpoint ? defpoints : e.layer,
      geom: p.geom,
      color: p.color ?? BY_BLOCK,
      ...(p.linetype !== undefined && { linetype: p.linetype }),
      ...(p.lineweight !== undefined && { lineweight: p.lineweight }),
    });
  }
  if (block !== g.block) b.updateEntity(id, { geom: { ...g, block } });
  return true;
}

/** A new table's size as the TABLE command asks it. */
export interface TableSize {
  readonly columns: number;
  readonly columnWidth: number;
  readonly dataRows: number;
  /** Each row's height in lines (`tableRowHeight`). */
  readonly rowLines: number;
  /** Insert Table's Set cell styles; absent for the table style's by their place. */
  readonly cellStyles?: TableRowCellStyles;
}

/**
 * A new table's size from a window `width` by `height` (the Insert Table dialog's Specify window,
 * -TABLE's Auto), as AutoCAD 2024's Help puts it: the window sets the number of columns or the
 * column width, not both, and the number of data rows or the row height. `autoColumns`: the
 * columns are as many of `size.columnWidth` as fit the window's width (at least one); else
 * `size.columns` share it. `autoRows`: the data rows are as many of `size.rowLines` lines as
 * fit below the title and header rows (at least one); else the row height is the most whole
 * lines (at least one) with which `size.dataRows` and the title and header rows fit.
 *
 * Where the documentation is silent (the common drafter expectation): the table never comes
 * out larger than the window unless one column or row, or one line, is already larger.
 */
export function windowTableSize(
  style: TableStyleRecord,
  size: TableSize,
  autoColumns: boolean,
  autoRows: boolean,
  width: number,
  height: number,
): TableSize {
  const fits = (n: number) => Math.max(1, Math.floor(n + 1e-9));
  const columns = autoColumns ? fits(width / size.columnWidth) : size.columns;
  const columnWidth = autoColumns ? size.columnWidth : width / size.columns;
  const placed = tableRowTypes(style, 2).filter((r) => r !== 'data').length;
  const chosen = size.cellStyles;
  const above = newRowTypes(style, placed, chosen);
  const others = chosen?.others ?? 'data';
  const vm = style.verticalMargin;
  const th = (type: TableCellStyleName) => rowCellStyle(style, type)?.textHeight ?? 0.18;
  const kept = chosen ? { cellStyles: chosen } : {};
  if (autoRows) {
    const taken = above.reduce((h, type) => h + tableRowHeight(size.rowLines, th(type), vm), 0);
    const dataRows = fits((height - taken) / tableRowHeight(size.rowLines, th(others), vm));
    return { columns, columnWidth, dataRows, rowLines: size.rowLines, ...kept };
  }
  const types = newRowTypes(style, placed + size.dataRows, chosen);
  const perLine = types.reduce((h, type) => h + (th(type) * 4) / 3, 0);
  const rowLines = fits((height - 2 * vm * types.length) / perLine);
  return { columns, columnWidth, dataRows: size.dataRows, rowLines, ...kept };
}
