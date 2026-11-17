// A table's cells formatted, and the table scaled (M4-05 part 4): what AutoCAD 2024's Table Cell
// tab and cell shortcut menu set on the cells selected ("Table Cell Ribbon Contextual Tab": Cell
// Styles panel's Background Fill, Edit Borders and Alignment; the text height Properties sets),
// and what SCALE does to the text inside a table.
//
// A format goes on every cell of the range, the cells a merged cell covers too: they keep their
// own borders, which draw the merged cell's outline where it runs along them
// (annotation/table.ts). Borders follow the Cell Border Properties dialog's buttons: all
// borders, the outside ones, the inside ones (or only the horizontal or vertical ones), no
// borders (which hides them: the Table Style dialog's No Border "hides borders"; the Cell Border
// Properties page says only that it applies the settings to none, and a drafter clicking it
// expects the grid gone), or one side of the range. The dialog sets a border whole: its colour,
// lineweight, linetype and double line (M4-16 part 7), and shows it. An edge two cells share
// is drawn by the cell below (right of) it when that one overrides it, else by the cell above
// (left); so where the cell across the edge outside the range already overrides that edge, it
// takes the new border too, or the change would not show.
import type {
  Color,
  LinetypeRef,
  Lineweight,
  TableBorderFormat,
  TableCell,
  TableCellFormat,
  TableCellStyleName,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import {
  isRowType,
  rowCellStyle,
  tableCellStyleNames,
  tableRowStyles,
  withRowStyles,
} from '../annotation/table';
import type { TableCellRange } from './table-grid';

/** The borders Edit Borders applies to (the Cell Border Properties dialog's buttons). */
export const TABLE_BORDER_SETS = [
  'All',
  'Outside',
  'Inside',
  'None',
  'Top',
  'Horizontal',
  'Bottom',
  'Left',
  'Vertical',
  'Right',
] as const;

export type TableBorderSet = (typeof TABLE_BORDER_SETS)[number];

/** What one formatting action sets on the cells of a range. */
export interface TableCellFormatting {
  /** 1 top left … 9 bottom right. */
  readonly alignment?: number;
  readonly textHeight?: number;
  /** A fill colour, or null for no fill. */
  readonly background?: Color | null;
}

/** A border as Edit Borders sets it (Cell Border Properties' Border Properties). */
export interface TableBorderStyle {
  readonly color: Color;
  readonly lineweight: Lineweight;
  /** ByBlock when absent, as the dialog's default. */
  readonly linetype?: LinetypeRef;
  /** Double Line on, at this spacing. */
  readonly double?: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';
type Cells = TableCell[][];

const OPPOSITE: Readonly<Record<Side, Side>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const STEP: Readonly<Record<Side, readonly [number, number]>> = {
  top: [-1, 0],
  bottom: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

/** `c` with `f` over its format. */
function formatted(c: TableCell, f: TableCellFormat): TableCell {
  return { ...c, format: { ...c.format, ...f } };
}

/** Every cell of range `r` with `f` set (the cells merged cells cover too). */
export function withCellsFormatted(
  g: TableGeometry,
  r: TableCellRange,
  f: TableCellFormatting,
): TableGeometry {
  const cells = g.cells.map((row, i) =>
    row.map((c, j) => (i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1 ? formatted(c, f) : c)),
  );
  return { ...g, cells };
}

/** The sides of cell (`i`, `j`) of range `r` that border set `set` names. */
function sidesOf(set: TableBorderSet, r: TableCellRange, i: number, j: number): Side[] {
  const edge: Record<Side, boolean> = {
    top: i === r.r0,
    bottom: i === r.r1,
    left: j === r.c0,
    right: j === r.c1,
  };
  const all: Side[] = ['top', 'right', 'bottom', 'left'];
  switch (set) {
    case 'All':
    case 'None':
      return all;
    case 'Outside':
      return all.filter((s) => edge[s]);
    case 'Inside':
      return all.filter((s) => !edge[s]);
    case 'Horizontal':
      return (['top', 'bottom'] as const).filter((s) => !edge[s]);
    case 'Vertical':
      return (['right', 'left'] as const).filter((s) => !edge[s]);
    case 'Top':
      return edge.top ? ['top'] : [];
    case 'Bottom':
      return edge.bottom ? ['bottom'] : [];
    case 'Left':
      return edge.left ? ['left'] : [];
    case 'Right':
      return edge.right ? ['right'] : [];
  }
}

/** `c` with its border `side` set to `b`, in place of what it overrode. */
function bordered(c: TableCell, side: Side, b: TableBorderFormat): TableCell {
  const borders = { ...c.format?.borders, [side]: b };
  return { ...c, format: { ...c.format, borders } };
}

/** The borders `set` names of range `r` given border `b`, or hidden for None (Edit Borders). */
export function withCellBorders(
  g: TableGeometry,
  r: TableCellRange,
  set: TableBorderSet,
  b: TableBorderStyle,
): TableGeometry {
  const cells: Cells = g.cells.map((row) => [...row]);
  // ByBlock is what an edge is drawn in without an override (a table style states no linetype).
  const border: TableBorderFormat =
    set === 'None'
      ? { hidden: true }
      : {
          color: b.color,
          lineweight: b.lineweight,
          ...(b.linetype !== undefined && b.linetype !== 'ByBlock' && { linetype: b.linetype }),
          ...(b.double !== undefined && { double: true, spacing: b.double }),
        };
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) {
      for (const side of sidesOf(set, r, i, j)) {
        cells[i]![j] = bordered(cells[i]![j]!, side, border);
        // The cell across an edge of the range, outside it, whose override would draw it.
        const [di, dj] = STEP[side];
        const ni = i + di;
        const nj = j + dj;
        const inside = ni >= r.r0 && ni <= r.r1 && nj >= r.c0 && nj <= r.c1;
        const n = cells[ni]?.[nj];
        if (!inside && n?.format?.borders?.[OPPOSITE[side]]) {
          cells[ni]![nj] = bordered(n, OPPOSITE[side], border);
        }
      }
    }
  }
  return { ...g, cells };
}

/**
 * Table `g`, whose rows and columns a scale by `k` has already sized (edit/transform.ts), with
 * its text and cell margins scaled too: each cell's text height becomes its own override (the
 * height it was drawn with, by `k`) and the table's margins an override of its style's.
 * AutoCAD's SCALE scales a table whole, its text with it; its Help does not say how the heights
 * are stored, and overrides are what Properties then shows on each cell.
 */
export function tableTextScaled(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  k: number,
): TableGeometry {
  if (k === 1) return g;
  const types = tableCellStyleNames(g, style);
  const cells = g.cells.map((row, i) =>
    row.map((c, j) => {
      const h = c.format?.textHeight ?? rowCellStyle(style, types[i]![j]!)?.textHeight ?? 0.18;
      const m = c.format?.margins;
      const margins = m && {
        margins: Object.fromEntries(Object.entries(m).map(([s, v]) => [s, v * k])),
      };
      return { ...c, format: { ...c.format, textHeight: h * k, ...margins } };
    }),
  );
  const m = g.overrides?.margins;
  const h = style?.horizontalMargin ?? 0;
  const v = style?.verticalMargin ?? 0;
  const margins = {
    left: (m?.left ?? h) * k,
    top: (m?.top ?? v) * k,
    right: (m?.right ?? h) * k,
    bottom: (m?.bottom ?? v) * k,
  };
  return { ...g, cells, overrides: { ...g.overrides, margins } };
}

/** Cell `c` with `format` as its format, none when it is undefined or empty. */
function withFormat(c: TableCell, format: TableCellFormat | undefined): TableCell {
  const { format: _, ...rest } = c;
  return format && Object.keys(format).length > 0 ? { ...rest, format } : rest;
}

/**
 * Table `g` with the cells of range `r` overriding nothing of their cell style (AutoCAD's Table
 * Cell tab and cell shortcut menu, Remove All Property Overrides, M4-05 part 7): each keeps only
 * what the table itself overrides for its row type (`TableGeometry.overrides`), which the file
 * states for the table, not the cell. The text and merges stay.
 */
export function withCellOverridesRemoved(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  r: TableCellRange,
): TableGeometry {
  const types = tableRowStyles(g, style);
  const cells: Cells = g.cells.map((row, i) =>
    i < r.r0 || i > r.r1
      ? [...row]
      : row.map((c, j) => {
          if (j < r.c0 || j > r.c1) return c;
          // A row on a cell style of the drafter's own has no table-wide overrides (the legacy
          // codes state them for the three row types only).
          const type = types[i]!;
          const table = isRowType(type) ? g.overrides?.[type] : undefined;
          return withFormat(c, table && { ...table });
        }),
  );
  return { ...g, cells };
}

/**
 * Table `g` with the cells of range `r` on cell style `name`, or their row's when undefined
 * (AutoCAD's Table Cell tab, Cell Styles, with By Row; M4-16 part 5). Cells across every column
 * put their rows on it, their own cell styles dropped: a title or header row is a row on that
 * cell style (AutoCAD's Help does not say which of row and cells a whole row selected sets; the
 * row is what Insert Rows then copies, as a drafter making a title row expects). Fewer cells each
 * take it as their own, unless it is their row's. Formats stay as they are: what a cell overrides
 * overrides its new cell style too.
 */
export function withCellsStyled(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  r: TableCellRange,
  name: TableCellStyleName | undefined,
): TableGeometry {
  const rows = tableRowStyles(g, style);
  const inRange = (i: number, j: number) => i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1;
  const own = (c: TableCell, i: number, as: TableCellStyleName | undefined): TableCell => {
    const { cellStyle: _, ...rest } = c;
    return as === undefined || as === rows[i] ? rest : { ...rest, cellStyle: as };
  };
  const whole = r.c0 === 0 && r.c1 === g.columnWidths.length - 1;
  const cells = g.cells.map((row, i) =>
    row.map((c, j) => (inRange(i, j) ? own(c, i, whole ? undefined : name) : c)),
  );
  if (!whole || name === undefined) return { ...g, cells };
  const types = rows.map((t, i) => (i >= r.r0 && i <= r.r1 ? name : t));
  return withRowStyles({ ...g, cells }, style, types);
}

/**
 * Table `g` with the cells of range `r` formatted as cell `from` is (AutoCAD's Match Cell, M4-05
 * part 7): its whole format, none where it has none. The value's data format (`valueFormat`) is
 * not matched: a save can only keep the one a cell came with.
 */
export function withCellMatched(
  g: TableGeometry,
  from: readonly [number, number],
  r: TableCellRange,
): TableGeometry {
  const format = g.cells[from[0]]?.[from[1]]?.format;
  const cells: Cells = g.cells.map((row, i) =>
    i < r.r0 || i > r.r1
      ? [...row]
      : row.map((c, j) => (j < r.c0 || j > r.c1 ? c : withFormat(c, format))),
  );
  return { ...g, cells };
}
