// A table's rows and columns inserted and deleted, and its cells merged and unmerged (M4-05
// part 3): what AutoCAD 2024's Table Cell tab and the cell shortcut menu do ("Table Cell
// Ribbon Contextual Tab": Insert Above / Below, Delete Row(s), Insert Left / Right, Delete
// Column(s), Merge All / By Row / By Column, Unmerge). Each edit returns the table's new
// geometry; the command redraws its `*T` block (`writeTableBlock`).
//
// A row or column inserted or deleted is stated in `rowOrigins` / `columnOrigins`, which a save
// needs to move what each row and cell holds beyond what Triya maps (DEC-046). Columns are done
// as rows of the table turned on its side (`turned`), so both follow the same rules:
// - as many are inserted as the selection holds, each as high (wide) as the row (column) the
//   selection starts or ends with, its cells taking that row's cell formats and the row and its
//   cells their cell styles (AutoCAD's Help: the new row takes the formatting of the row it is
//   inserted next to), so a row inserted beside a title or header row is one too (M4-16 part 5);
// - a merged cell an insertion falls inside grows across the new rows; one spanning the whole
//   table (the title across every column) grows even when the insertion is at its edge, as a
//   drafter expects a title to stay across the table (AutoCAD's Help does not say);
// - a merged cell losing rows shrinks, and keeps its text in its first row left.
// Merging keeps the text of the range's first cell, the covered cells holding nothing: AutoCAD's
// Help does not say what becomes of the others' contents; the common expectation (as in a
// spreadsheet) is that the top-left one stays.
import type {
  TableCell,
  TableCellFormat,
  TableCellStyleName,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import { tableRangeHeads, tableRowStyles, withRowStyles } from '../annotation/table';
import { withCellOverridesRemoved } from './table-format';
import { mtextLiteral } from './clipboard-data';
import type { SheetCells } from './spreadsheet';

/** Rows `r0`–`r1` and columns `c0`–`c1` of a table, inclusive, `r0` ≤ `r1` and `c0` ≤ `c1`. */
export interface TableCellRange {
  readonly r0: number;
  readonly c0: number;
  readonly r1: number;
  readonly c1: number;
}

/** How Merge Cells merges a range: into one cell, a cell per row, or a cell per column. */
export type TableMerge = 'all' | 'rows' | 'columns';

/**
 * The options of the Table Cell menu, in its order, as typed at the command line: the cell's
 * text, its formatting (M4-05 part 4; Match Cell and Remove All Property Overrides, part 7), then
 * rows, columns and merging.
 */
export const TABLE_CELL_OPTIONS = [
  'Text',
  'Paste',
  'BLock',
  'BAckground',
  'ALignment',
  'BOrders',
  'Height',
  'DataFormat',
  'Match',
  'RemoveOverrides',
  'CellStyle',
  'Above',
  'Below',
  'DeleteRows',
  'Left',
  'Right',
  'DeleteColumns',
  'MergeAll',
  'MergeRows',
  'MergeColumns',
  'Unmerge',
] as const;

export type TableCellOption = (typeof TABLE_CELL_OPTIONS)[number];

type Cells = TableCell[][];

/** `v` as JSON with its keys in order, so formats compare whatever order they were built in. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

const sameFormat = (a: TableCellFormat | undefined, b: TableCellFormat | undefined) =>
  canonical(a ?? {}) === canonical(b ?? {});
type Origins = readonly (number | null)[] | undefined;

/** An empty cell with `c`'s format and cell style. */
const empty = (c: Pick<TableCell, 'format' | 'cellStyle'>): TableCell => ({
  type: 'text',
  text: '',
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...(c.format && { format: c.format }),
  ...(c.cellStyle && { cellStyle: c.cellStyle }),
});

/** Cell `c` covered by a merged cell: its format and cell style kept, its contents gone. */
function cover(c: TableCell): TableCell {
  return { ...empty(c), rotation: c.rotation, merged: true };
}

/**
 * What the rows' cell styles are worked out from: the table style's suppressed rows; null for a
 * table turned on its side (a column edit), whose rows' cell styles are left alone.
 */
type RowStyleSource = Pick<TableStyleRecord, 'suppressTitle' | 'suppressHeader'> | undefined | null;

/** `g` with its rows, columns and their origins as given, origins left out when undefined. */
function regrid(
  g: TableGeometry,
  cells: Cells,
  rowHeights: readonly number[],
  columnWidths: readonly number[],
  rowOrigins: Origins,
  columnOrigins: Origins,
): TableGeometry {
  const { rowOrigins: _r, columnOrigins: _c, ...rest } = g;
  return {
    ...rest,
    cells,
    rowHeights,
    columnWidths,
    ...(rowOrigins && { rowOrigins }),
    ...(columnOrigins && { columnOrigins }),
  };
}

/**
 * Table `g` turned on its side: its columns as rows, each cell's spans swapped. The rows' cell
 * styles are left out, as they would be the columns'; `withColumns` puts them back.
 */
function turned(g: TableGeometry): TableGeometry {
  const cells = g.columnWidths.map((_, j) =>
    g.cells.map((row) => {
      const c = row[j]!;
      return { ...c, rowSpan: c.columnSpan, columnSpan: c.rowSpan };
    }),
  );
  return regrid(g, cells, g.columnWidths, g.rowHeights, g.columnOrigins, g.rowOrigins);
}

const origins = (o: Origins, n: number): (number | null)[] =>
  o ? [...o] : Array.from({ length: n }, (_, k) => k);

/** The cells heading a merged cell (spanning more than one), with where they are. */
function mergedHeads(g: TableGeometry): { i: number; j: number; c: TableCell }[] {
  const out: { i: number; j: number; c: TableCell }[] = [];
  g.cells.forEach((row, i) =>
    row.forEach((c, j) => {
      if (!c.merged && (c.rowSpan > 1 || c.columnSpan > 1)) out.push({ i, j, c });
    }),
  );
  return out;
}

/**
 * The range from cell `a` to cell `b` (`[row, column]`), grown until every merged cell it
 * touches lies wholly inside it, as AutoCAD selects a merged cell whole.
 */
export function tableCellRange(
  g: TableGeometry,
  a: readonly [number, number],
  b: readonly [number, number],
): TableCellRange {
  let r = {
    r0: Math.min(a[0], b[0]),
    c0: Math.min(a[1], b[1]),
    r1: Math.max(a[0], b[0]),
    c1: Math.max(a[1], b[1]),
  };
  const heads = mergedHeads(g);
  for (let grown = true; grown;) {
    grown = false;
    for (const { i, j, c } of heads) {
      const i1 = i + c.rowSpan - 1;
      const j1 = j + c.columnSpan - 1;
      if (i > r.r1 || i1 < r.r0 || j > r.c1 || j1 < r.c0) continue;
      const next = {
        r0: Math.min(r.r0, i),
        c0: Math.min(r.c0, j),
        r1: Math.max(r.r1, i1),
        c1: Math.max(r.c1, j1),
      };
      if (JSON.stringify(next) !== JSON.stringify(r)) grown = true;
      r = next;
    }
  }
  return r;
}

/**
 * `count` rows inserted before row `at`, as high as row `like` and with its cell formats and
 * cell styles (`style`, the table style, places the rows that state none).
 */
export function withRowsInserted(
  g: TableGeometry,
  at: number,
  count: number,
  like: number,
  style?: RowStyleSource,
): TableGeometry {
  const n = g.cells.length;
  const likeRow = g.cells[like]!;
  const fresh = () => likeRow.map(empty);
  const types = tableRowStyles(g, style ?? undefined);
  const rowStyles = [
    ...types.slice(0, at),
    ...Array.from({ length: count }, () => types[like]!),
    ...types.slice(at),
  ];
  const cells: Cells = [
    ...g.cells.slice(0, at).map((r) => [...r]),
    ...Array.from({ length: count }, fresh),
    ...g.cells.slice(at).map((r) => [...r]),
  ];
  for (const { i, j, c } of mergedHeads(g)) {
    const whole = i === 0 && c.rowSpan === n && (at === 0 || at === n);
    if (!whole && !(i < at && at < i + c.rowSpan)) continue;
    const head = i === at ? at : i;
    const was = i < at ? i : i + count;
    for (let r = head; r < head + c.rowSpan + count; r++) {
      for (let k = j; k < j + c.columnSpan; k++) cells[r]![k] = cover(cells[r]![k]!);
    }
    cells[head]![j] = { ...c, rowSpan: c.rowSpan + count };
    if (was !== head) cells[was]![j] = cover(c);
  }
  const h = g.rowHeights;
  const o = origins(g.rowOrigins, n);
  return restyled(
    regrid(
      g,
      cells,
      [...h.slice(0, at), ...Array.from({ length: count }, () => h[like]!), ...h.slice(at)],
      g.columnWidths,
      [...o.slice(0, at), ...Array.from({ length: count }, () => null), ...o.slice(at)],
      g.columnOrigins,
    ),
    style,
    rowStyles,
  );
}

/** `g` on row cell styles `types`, unless it is turned on its side (`style` null). */
function restyled(
  g: TableGeometry,
  style: RowStyleSource,
  types: readonly TableCellStyleName[],
): TableGeometry {
  return style === null ? g : withRowStyles(g, style, types);
}

/** Rows `from`–`to` deleted, the others keeping their cell styles (`style` as for insertion). */
export function withRowsDeleted(
  g: TableGeometry,
  from: number,
  to: number,
  style?: RowStyleSource,
): TableGeometry {
  const types = tableRowStyles(g, style ?? undefined);
  const cells: Cells = g.cells.map((r) => [...r]);
  for (const { i, j, c } of mergedHeads(g)) {
    const last = i + c.rowSpan - 1;
    const gone = Math.max(0, Math.min(last, to) - Math.max(i, from) + 1);
    if (gone === 0 || gone === c.rowSpan) continue;
    cells[i < from ? i : to + 1]![j] = { ...c, rowSpan: c.rowSpan - gone };
  }
  const keep = (_: unknown, k: number) => k < from || k > to;
  return restyled(
    regrid(
      g,
      cells.filter(keep),
      g.rowHeights.filter(keep),
      g.columnWidths,
      origins(g.rowOrigins, g.cells.length).filter(keep),
      g.columnOrigins,
    ),
    style,
    types.filter(keep),
  );
}

/** `edit` done on `g` turned on its side, the rows' cell styles kept. */
function withColumns(g: TableGeometry, edit: (t: TableGeometry) => TableGeometry): TableGeometry {
  const { rowStyles, ...rest } = g;
  const { rowStyles: _, ...out } = turned(edit(turned(rest)));
  return rowStyles ? { ...out, rowStyles } : out;
}

/** `count` columns inserted before column `at`, as wide as column `like`, with its formats. */
export function withColumnsInserted(
  g: TableGeometry,
  at: number,
  count: number,
  like: number,
): TableGeometry {
  return withColumns(g, (t) => withRowsInserted(t, at, count, like, null));
}

/** Columns `from`–`to` deleted. */
export function withColumnsDeleted(g: TableGeometry, from: number, to: number): TableGeometry {
  return withColumns(g, (t) => withRowsDeleted(t, from, to, null));
}

/** Every merged cell heading in range `r` made single cells again, their cells empty. */
export function withCellsUnmerged(g: TableGeometry, r: TableCellRange): TableGeometry {
  const cells: Cells = g.cells.map((row) => [...row]);
  for (const { i, j, c } of mergedHeads(g)) {
    if (i < r.r0 || i > r.r1 || j < r.c0 || j > r.c1) continue;
    for (let a = i; a < Math.min(i + c.rowSpan, cells.length); a++) {
      for (let b = j; b < Math.min(j + c.columnSpan, cells[a]!.length); b++) {
        cells[a]![b] = { ...cells[a]![b]!, merged: false };
      }
    }
    cells[i]![j] = { ...c, rowSpan: 1, columnSpan: 1 };
  }
  return { ...g, cells };
}

/** Range `r` (whole merged cells, `tableCellRange`) merged as `how` says. */
export function withCellsMerged(
  g: TableGeometry,
  r: TableCellRange,
  how: TableMerge,
): TableGeometry {
  const cells: Cells = withCellsUnmerged(g, r).cells.map((row) => [...row]);
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) {
      const hi = how === 'rows' ? i : r.r0;
      const hj = how === 'columns' ? j : r.c0;
      const c = cells[i]![j]!;
      cells[i]![j] =
        i === hi && j === hj
          ? {
              ...c,
              rowSpan: how === 'rows' ? 1 : r.r1 - r.r0 + 1,
              columnSpan: how === 'columns' ? 1 : r.c1 - r.c0 + 1,
            }
          : cover(c);
    }
  }
  return { ...g, cells };
}

/**
 * The Table Cell menu's options that apply to range `r`, in its order. Rows are inserted and
 * deleted anywhere, title and header rows too, as each row keeps its cell style (M4-16 part 5;
 * until then only among the data rows). The last row or column is not deleted. Merging needs
 * more than one cell; Unmerge, a merged cell.
 */
export function tableCellOptions(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  r: TableCellRange,
): TableCellOption[] {
  const rows = g.cells.length;
  const columns = g.columnWidths.length;
  const heads = new Set<string>();
  const all = tableRangeHeads(g);
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) heads.add(String(all[i]![j]));
  }
  const many = heads.size > 1;
  const merged = mergedHeads(g).some(
    ({ i, j }) => i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1,
  );
  const on: Record<TableCellOption, boolean> = {
    Text: true,
    Paste: true,
    BLock: true,
    BAckground: true,
    ALignment: true,
    BOrders: true,
    Height: true,
    DataFormat: true,
    Match: true,
    RemoveOverrides: withCellOverridesRemoved(g, style, r).cells.some((row, i) =>
      row.some((c, j) => c !== g.cells[i]![j] && !sameFormat(c.format, g.cells[i]![j]!.format)),
    ),
    CellStyle: true,
    Above: true,
    Below: true,
    DeleteRows: r.r1 - r.r0 + 1 < rows,
    Left: true,
    Right: true,
    DeleteColumns: r.c1 - r.c0 + 1 < columns,
    MergeAll: many,
    MergeRows: many && r.c1 > r.c0,
    MergeColumns: many && r.r1 > r.r0,
    Unmerge: merged,
  };
  return TABLE_CELL_OPTIONS.filter((k) => on[k]);
}

/**
 * A spreadsheet's cells pasted into table `g` from cell `at` (M4-13), as AutoCAD pastes cells
 * into the cells selected: each cell's text into the cell as far right and down from `at` as it
 * is in the copy, rows and columns added past the table's last ones like them (as Insert Below
 * and Insert Right add them) where the copy goes further. A cell keeps its format, a block cell
 * becomes a text cell, and the table's merged cells stay as they are: a cell another covers
 * takes nothing, nor does a cell the copy's merged cells cover give any. What the copy fills is
 * `range`.
 */
export function withCellsPasted(
  g: TableGeometry,
  at: readonly [number, number],
  cells: SheetCells,
  style?: TableStyleRecord,
): { geom: TableGeometry; range: TableCellRange } {
  const [r0, c0] = at;
  const r1 = r0 + cells.length - 1;
  const c1 = c0 + Math.max(...cells.map((r) => r.length)) - 1;
  let geom = g;
  const rows = geom.cells.length;
  if (r1 >= rows) geom = withRowsInserted(geom, rows, r1 - rows + 1, rows - 1, style);
  const columns = geom.columnWidths.length;
  if (c1 >= columns) geom = withColumnsInserted(geom, columns, c1 - columns + 1, columns - 1);
  const out: Cells = geom.cells.map((row) => [...row]);
  cells.forEach((row, i) =>
    row.forEach((c, j) => {
      const target = out[r0 + i]![c0 + j]!;
      if (c.merged || target.merged) return;
      // A pasted cell holds the text pasted, not a value (M4-16).
      const { block: _, value: _value, ...rest } = target;
      out[r0 + i]![c0 + j] = { ...rest, type: 'text', text: mtextLiteral(c.text) };
    }),
  );
  return { geom: { ...geom, cells: out }, range: { r0, c0, r1, c1 } };
}
