// M4-05 part 3: rows and columns inserted into and deleted from a table, and cells merged and
// unmerged, as the Table Cell menu does them (the table's own edit; its block is redrawn by
// the command).
import { describe, expect, it } from 'vitest';
import {
  standardTableStyle,
  tableCellOptions,
  tableCellRange,
  withCellsMerged,
  withCellsUnmerged,
  withColumnsDeleted,
  withColumnsInserted,
  withRowsDeleted,
  withRowsInserted,
  type TableCell,
  type TableGeometry,
  type TableStyleRecord,
} from '../../src/index';

const STYLE: TableStyleRecord = { handle: 'S', ...standardTableStyle(false, 'T1') };

const cell = (text: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});
const covered = cell('', { merged: true });

/** Title over three columns, a header row, three data rows; data cell (2,0) red. */
const table = (more: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.45, 0.36, 0.3, 0.4, 0.5],
  columnWidths: [1, 2, 3],
  cells: [
    [cell('T', { columnSpan: 3 }), covered, covered],
    [cell('A'), cell('B'), cell('C')],
    [cell('1', { format: { contentColor: { kind: 'aci', index: 1 } } }), cell('2'), cell('3')],
    [cell('4'), cell('5'), cell('6')],
    [cell('7'), cell('8'), cell('9')],
  ],
  ...more,
});

/** Each cell as text, `^` covered, a head's span after it as `/rows x columns`. */
const grid = (g: TableGeometry) =>
  g.cells.map((row) =>
    row.map((c) =>
      c.merged
        ? '^'
        : c.rowSpan > 1 || c.columnSpan > 1
          ? `${c.text}/${c.rowSpan}x${c.columnSpan}`
          : c.text,
    ),
  );

describe('a cell range', () => {
  it('is normalised and grows to hold the merged cells it touches', () => {
    expect(tableCellRange(table(), [3, 2], [2, 1])).toEqual({ r0: 2, c0: 1, r1: 3, c1: 2 });
    // The title merged across every column: a cell of it is the whole row.
    expect(tableCellRange(table(), [0, 1], [0, 1])).toEqual({ r0: 0, c0: 0, r1: 0, c1: 2 });
    // A range touching a merged block grows to hold it, and then what that touches.
    const g = withCellsMerged(table(), { r0: 3, c0: 1, r1: 4, c1: 2 }, 'all');
    expect(tableCellRange(g, [2, 0], [3, 1])).toEqual({ r0: 2, c0: 0, r1: 4, c1: 2 });
  });
});

describe('rows', () => {
  it('are inserted as many as are selected, as high as the row beside, its formats kept', () => {
    // Insert Below on data rows 2–3: two rows after row 3, as high as row 3.
    const g = withRowsInserted(table(), 4, 2, 3);
    expect(grid(g)).toEqual([
      ['T/1x3', '^', '^'],
      ['A', 'B', 'C'],
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['', '', ''],
      ['', '', ''],
      ['7', '8', '9'],
    ]);
    expect(g.rowHeights).toEqual([0.45, 0.36, 0.3, 0.4, 0.4, 0.4, 0.5]);
    expect(g.rowOrigins).toEqual([0, 1, 2, 3, null, null, 4]);
    expect(g.columnOrigins).toBeUndefined();
    // Insert Above row 2 takes row 2's formats.
    const above = withRowsInserted(table(), 2, 1, 2);
    expect(above.cells[2]![0]!.format).toEqual({ contentColor: { kind: 'aci', index: 1 } });
    expect(above.cells[3]![0]!.text).toBe('1');
  });

  it('inserted inside a merged cell make it taller', () => {
    const merged = withCellsMerged(table(), { r0: 2, c0: 0, r1: 3, c1: 0 }, 'all');
    const g = withRowsInserted(merged, 3, 1, 2);
    expect(grid(g).map((r) => r[0])).toEqual(['T/1x3', 'A', '1/3x1', '^', '^', '7']);
    expect(grid(g)[3]).toEqual(['^', '', '']);
  });

  it('are deleted, a merged cell losing them keeping its text in its first row left', () => {
    const merged = withCellsMerged(table(), { r0: 2, c0: 0, r1: 4, c1: 0 }, 'all');
    const g = withRowsDeleted(merged, 2, 3);
    expect(grid(g)).toEqual([
      ['T/1x3', '^', '^'],
      ['A', 'B', 'C'],
      ['1', '8', '9'],
    ]);
    expect(g.rowHeights).toEqual([0.45, 0.36, 0.5]);
    expect(g.rowOrigins).toEqual([0, 1, 4]);
    // Origins stated before are carried on.
    expect(withRowsDeleted(withRowsInserted(table(), 5, 1, 4), 2, 2).rowOrigins).toEqual([
      0,
      1,
      3,
      4,
      null,
    ]);
  });
});

describe('columns', () => {
  it('inserted right of the last keep the title across the table', () => {
    const g = withColumnsInserted(table(), 3, 1, 2);
    expect(grid(g)[0]).toEqual(['T/1x4', '^', '^', '^']);
    expect(grid(g)[1]).toEqual(['A', 'B', 'C', '']);
    expect(g.columnWidths).toEqual([1, 2, 3, 3]);
    expect(g.columnOrigins).toEqual([0, 1, 2, null]);
    expect(g.rowOrigins).toBeUndefined();
  });

  it('inserted left of the first make the new column head the title', () => {
    const g = withColumnsInserted(table(), 0, 2, 0);
    expect(grid(g)[0]).toEqual(['T/1x5', '^', '^', '^', '^']);
    expect(grid(g)[2]).toEqual(['', '', '1', '2', '3']);
    expect(g.cells[2]![0]!.format).toEqual({ contentColor: { kind: 'aci', index: 1 } });
    expect(g.columnWidths).toEqual([1, 1, 1, 2, 3]);
  });

  it('are deleted, the title narrowing with them', () => {
    const g = withColumnsDeleted(table(), 0, 1);
    expect(grid(g)).toEqual([['T'], ['C'], ['3'], ['6'], ['9']]);
    expect(g.columnWidths).toEqual([3]);
    expect(g.columnOrigins).toEqual([2]);
  });
});

describe('merging', () => {
  it('All makes one cell of the range, keeping the first cell’s text', () => {
    const g = withCellsMerged(table(), { r0: 2, c0: 0, r1: 3, c1: 1 }, 'all');
    expect(grid(g).slice(2, 4)).toEqual([
      ['1/2x2', '^', '3'],
      ['^', '^', '6'],
    ]);
    // A covered cell holds nothing of its own.
    expect(g.cells[3]![1]).toMatchObject({ text: '', merged: true, rowSpan: 1, columnSpan: 1 });
  });

  it('By Row and By Column merge each row or column of the range', () => {
    const range = { r0: 2, c0: 0, r1: 3, c1: 1 };
    expect(grid(withCellsMerged(table(), range, 'rows')).slice(2, 4)).toEqual([
      ['1/1x2', '^', '3'],
      ['4/1x2', '^', '6'],
    ]);
    expect(grid(withCellsMerged(table(), range, 'columns')).slice(2, 4)).toEqual([
      ['1/2x1', '2/2x1', '3'],
      ['^', '^', '6'],
    ]);
  });

  it('unmerges each merged cell in the range into empty cells', () => {
    const merged = withCellsMerged(table(), { r0: 2, c0: 0, r1: 3, c1: 1 }, 'all');
    expect(grid(withCellsUnmerged(merged, { r0: 2, c0: 0, r1: 3, c1: 1 })).slice(2, 4)).toEqual([
      ['1', '', '3'],
      ['', '', '6'],
    ]);
    expect(grid(withCellsUnmerged(table(), { r0: 0, c0: 0, r1: 0, c1: 2 }))[0]).toEqual([
      'T',
      '',
      '',
    ]);
  });
});

describe('what the Table Cell menu offers', () => {
  it('inserts and deletes rows anywhere, the last row excepted (M4-16 part 5)', () => {
    // The cells' formatting (M4-05 part 4) applies to any cells, Match Cell too (part 7);
    // Remove All Property Overrides only where a cell overrides something.
    const FORMATS = ['BAckground', 'ALignment', 'BOrders', 'Height', 'LOcking', 'DataFormat', 'Match'];
    const at = (r0: number, r1: number, c0 = 0, c1 = 0) =>
      tableCellOptions(table(), STYLE, { r0, c0, r1, c1 });
    expect(at(2, 3)).toEqual([
      'Text',
      'Paste',
      'BLock',
      ...FORMATS,
      // Its first data row's first cell has a colour of its own.
      'RemoveOverrides',
      'CellStyle',
      'Above',
      'Below',
      'DeleteRows',
      'Left',
      'Right',
      'DeleteColumns',
      'MergeAll',
      'MergeColumns',
    ]);
    // The header row: rows inserted beside it are header rows (each row keeps its cell style).
    expect(at(1, 1)).toEqual([
      'Text',
      'Paste',
      'BLock',
      ...FORMATS,
      'CellStyle',
      'Above',
      'Below',
      'DeleteRows',
      'Left',
      'Right',
      'DeleteColumns',
    ]);
    // The title across every column: no column can go, and it unmerges.
    expect(at(0, 0, 0, 2)).toEqual([
      'Text',
      'Paste',
      'BLock',
      ...FORMATS,
      'CellStyle',
      'Above',
      'Below',
      'DeleteRows',
      'Left',
      'Right',
      'Unmerge',
    ]);
    // The last column cannot go; nor can every data row in a style without title and header.
    const one = table({
      rowHeights: [1],
      columnWidths: [1],
      cells: [[cell('x')]],
    });
    const plain = { ...STYLE, suppressTitle: true, suppressHeader: true };
    expect(tableCellOptions(one, plain, { r0: 0, c0: 0, r1: 0, c1: 0 })).toEqual([
      'Text',
      'Paste',
      'BLock',
      ...FORMATS,
      'CellStyle',
      'Above',
      'Below',
      'Left',
      'Right',
    ]);
    const overriding = table({
      rowHeights: [1],
      columnWidths: [1],
      cells: [[cell('x', { format: { alignment: 5 } })]],
    });
    expect(tableCellOptions(overriding, plain, { r0: 0, c0: 0, r1: 0, c1: 0 })).toContain(
      'RemoveOverrides',
    );
    // What the table overrides of the row type is not the cell's own.
    const typeWide = { ...overriding, overrides: { data: { alignment: 5 } } };
    expect(tableCellOptions(typeWide, plain, { r0: 0, c0: 0, r1: 0, c1: 0 })).not.toContain(
      'RemoveOverrides',
    );
  });
});
