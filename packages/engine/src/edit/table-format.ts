// A table's cells formatted, and the table scaled (M4-05 part 4): what AutoCAD 2024's Table Cell
// tab and cell shortcut menu set on the cells selected ("Table Cell Ribbon Contextual Tab": Cell
// Styles panel's Background Fill, Edit Borders and Alignment; the text height Properties sets),
// and what SCALE does to the text inside a table.
//
// A format goes on every cell of the range, the cells a merged cell covers too: they keep their
// own borders, which draw the merged cell's outline where it runs along them
// (annotation/table.ts). Borders follow the Cell Border Properties dialog's buttons: all
// borders, the outside ones, the inside ones, or one side of the range. An edge two cells share
// is drawn by the cell below (right of) it when that one overrides it, else by the cell above
// (left); so where the cell across the edge outside the range already overrides that edge, it
// takes the new border too, or the change would not show.
import type {
  Color,
  Lineweight,
  TableBorderFormat,
  TableCell,
  TableCellFormat,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import { rowCellStyle, tableRowTypes } from '../annotation/table';
import type { TableCellRange } from './table-grid';

/** The borders Edit Borders applies to (the Cell Border Properties dialog's buttons). */
export const TABLE_BORDER_SETS = [
  'All',
  'Outside',
  'Inside',
  'Top',
  'Bottom',
  'Left',
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

/** A border's colour and lineweight (Edit Borders' Color and Lineweight). */
export interface TableBorderStyle {
  readonly color: Color;
  readonly lineweight: Lineweight;
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
      return all;
    case 'Outside':
      return all.filter((s) => edge[s]);
    case 'Inside':
      return all.filter((s) => !edge[s]);
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

/** `c` with its border `side` given `b` over what it overrode. */
function bordered(c: TableCell, side: Side, b: TableBorderFormat): TableCell {
  const borders = { ...c.format?.borders, [side]: { ...c.format?.borders?.[side], ...b } };
  return { ...c, format: { ...c.format, borders } };
}

/** The borders `set` names of range `r` given colour and lineweight `b` (Edit Borders). */
export function withCellBorders(
  g: TableGeometry,
  r: TableCellRange,
  set: TableBorderSet,
  b: TableBorderStyle,
): TableGeometry {
  const cells: Cells = g.cells.map((row) => [...row]);
  const border: TableBorderFormat = { color: b.color, lineweight: b.lineweight };
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
  const types = tableRowTypes(style, g.cells.length);
  const cells = g.cells.map((row, i) =>
    row.map((c) => {
      const h = c.format?.textHeight ?? rowCellStyle(style, types[i]!)?.textHeight ?? 0.18;
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
