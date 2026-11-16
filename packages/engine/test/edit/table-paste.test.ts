// M4-13: a spreadsheet's cells pasted into a table's cells selected, from the top left one, rows
// and columns added as needed.
import { describe, expect, it } from 'vitest';
import {
  withCellsPasted,
  type SheetCell,
  type TableCell,
  type TableGeometry,
} from '../../src/index';

const cell = (text: string, more: Partial<TableCell> = {}): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
  ...more,
});

const sheet = (rows: string[][]): SheetCell[][] =>
  rows.map((r) => r.map((text) => ({ text, rowSpan: 1, columnSpan: 1, merged: false })));

/** A title across two columns, a header and two data rows. */
const table = (): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [1, 0.8, 0.5, 0.6],
  columnWidths: [2, 3],
  cells: [
    [cell('T', { columnSpan: 2 }), cell('', { merged: true })],
    [cell('A'), cell('B')],
    [cell('1'), cell('2', { format: { alignment: 5 } })],
    [cell('3'), cell('4')],
  ],
});

const texts = (g: TableGeometry) => g.cells.map((r) => r.map((c) => (c.merged ? '^' : c.text)));

describe('cells pasted into a table', () => {
  it('fill the cells from the one given, keeping their formats', () => {
    const { geom, range } = withCellsPasted(table(), [2, 0], sheet([['x', 'y']]));
    expect(texts(geom)).toEqual([
      ['T', '^'],
      ['A', 'B'],
      ['x', 'y'],
      ['3', '4'],
    ]);
    expect(geom.cells[2]![1]!.format).toEqual({ alignment: 5 });
    expect(range).toEqual({ r0: 2, c0: 0, r1: 2, c1: 1 });
    expect(geom.rowOrigins).toBeUndefined();
  });

  it('add rows and columns past the table’s last, like the last ones', () => {
    const { geom, range } = withCellsPasted(
      table(),
      [3, 1],
      sheet([
        ['p', 'q'],
        ['r', 's'],
      ]),
    );
    expect(texts(geom)).toEqual([
      ['T', '^', '^'],
      ['A', 'B', ''],
      ['1', '2', ''],
      ['3', 'p', 'q'],
      ['', 'r', 's'],
    ]);
    expect(geom.rowHeights).toEqual([1, 0.8, 0.5, 0.6, 0.6]);
    expect(geom.columnWidths).toEqual([2, 3, 3]);
    expect(geom.rowOrigins).toEqual([0, 1, 2, 3, null]);
    expect(geom.columnOrigins).toEqual([0, 1, null]);
    expect(range).toEqual({ r0: 3, c0: 1, r1: 4, c1: 2 });
  });

  it('write nothing into a cell another merged cell covers, nor from one', () => {
    const merged: SheetCell[][] = [
      [
        { text: 'm', rowSpan: 1, columnSpan: 2, merged: false },
        { text: '', rowSpan: 1, columnSpan: 1, merged: true },
      ],
    ];
    expect(texts(withCellsPasted(table(), [3, 0], merged).geom)[3]).toEqual(['m', '4']);
    expect(texts(withCellsPasted(table(), [0, 0], sheet([['a', 'b']])).geom)[0]).toEqual([
      'a',
      '^',
    ]);
  });

  it('turn a block cell into text and write line breaks as paragraphs', () => {
    const g = table();
    const withBlock: TableGeometry = {
      ...g,
      cells: g.cells.map((r, i) =>
        i === 3 ? [cell('', { type: 'block', block: 'B1' }), r[1]!] : r,
      ),
    };
    const out = withCellsPasted(withBlock, [3, 0], sheet([['a\nb {x}']])).geom.cells[3]![0]!;
    expect(out).toEqual(cell('a\\Pb \\{x\\}'));
  });
});
