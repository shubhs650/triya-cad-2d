// M4-05 part 4: a table's cells formatted (alignment, text height, fill, borders) and its text
// scaled with the table.
import { describe, expect, it } from 'vitest';
import {
  standardTableStyle,
  tableTextScaled,
  withCellBorders,
  withCellsFormatted,
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

/** Title over two columns, a header row, two data rows. */
const table = (more: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.45, 0.36, 0.36, 0.36],
  columnWidths: [1, 2],
  cells: [
    [cell('T', { columnSpan: 2 }), cell('', { merged: true })],
    [cell('A'), cell('B')],
    [cell('1'), cell('2', { format: { textHeight: 0.1 } })],
    [cell('3'), cell('4')],
  ],
  ...more,
});

const RED = { color: { kind: 'aci' as const, index: 1 }, lineweight: 50 as const };

describe('withCellsFormatted', () => {
  it('sets the format on every cell of the range, over what each had', () => {
    const g = withCellsFormatted(table(), { r0: 2, c0: 0, r1: 3, c1: 1 }, { alignment: 5 });
    expect(g.cells.slice(2).map((r) => r.map((c) => c.format))).toEqual([
      [{ alignment: 5 }, { alignment: 5, textHeight: 0.1 }],
      [{ alignment: 5 }, { alignment: 5 }],
    ]);
    expect(g.cells[1]![0]!.format).toBeUndefined();
    // A covered cell of a merged range takes it too.
    const t = withCellsFormatted(table(), { r0: 0, c0: 0, r1: 0, c1: 1 }, { background: null });
    expect(t.cells[0]!.map((c) => c.format)).toEqual([{ background: null }, { background: null }]);
  });
});

describe('withCellBorders', () => {
  const r = { r0: 1, c0: 0, r1: 2, c1: 1 };
  const sides = (g: TableGeometry) =>
    g.cells.map((row) =>
      row.map((c) =>
        Object.keys(c.format?.borders ?? {})
          .sort()
          .join(''),
      ),
    );

  it('gives all, outside, inside or one side of the range', () => {
    expect(sides(withCellBorders(table(), r, 'All', RED)).slice(1, 3)).toEqual([
      ['bottomleftrighttop', 'bottomleftrighttop'],
      ['bottomleftrighttop', 'bottomleftrighttop'],
    ]);
    expect(sides(withCellBorders(table(), r, 'Outside', RED)).slice(1, 3)).toEqual([
      ['lefttop', 'righttop'],
      ['bottomleft', 'bottomright'],
    ]);
    expect(sides(withCellBorders(table(), r, 'Inside', RED)).slice(1, 3)).toEqual([
      ['bottomright', 'bottomleft'],
      ['righttop', 'lefttop'],
    ]);
    expect(sides(withCellBorders(table(), r, 'Top', RED)).slice(1, 3)).toEqual([
      ['top', 'top'],
      ['', ''],
    ]);
    expect(sides(withCellBorders(table(), r, 'Right', RED)).slice(1, 3)).toEqual([
      ['', 'right'],
      ['', 'right'],
    ]);
  });

  it('keeps what a border overrode besides, and gives the cell across an edge it overrides', () => {
    const blue = { color: { kind: 'aci' as const, index: 5 }, hidden: true as const };
    const g = table({
      cells: [
        [cell('T', { columnSpan: 2 }), cell('', { merged: true })],
        [cell('A', { format: { borders: { bottom: blue } } }), cell('B')],
        [cell('1', { format: { borders: { top: { lineweight: 13 } } } }), cell('2')],
        [cell('3'), cell('4')],
      ],
    });
    const out = withCellBorders(g, { r0: 2, c0: 0, r1: 2, c1: 0 }, 'Top', RED);
    expect(out.cells[2]![0]!.format!.borders!.top).toEqual(RED);
    // Cell (1, 0) above overrides the shared edge: it takes the border, its hidden flag kept.
    expect(out.cells[1]![0]!.format!.borders!.bottom).toEqual({ ...RED, hidden: true });
    // Not the cell beside, which states nothing there.
    expect(out.cells[1]![1]!.format).toBeUndefined();
  });
});

describe('tableTextScaled', () => {
  it('scales each cell’s text height into a format of its own, and the margins', () => {
    const g = tableTextScaled(table(), STYLE, 2);
    expect(g.cells.map((r) => r.map((c) => c.format?.textHeight))).toEqual([
      [0.5, 0.5],
      [0.36, 0.36],
      [0.36, 0.2],
      [0.36, 0.36],
    ]);
    expect(g.overrides).toEqual({ margins: { left: 0.12, top: 0.12, right: 0.12, bottom: 0.12 } });
    // Margins the table or a cell overrides already are scaled from theirs.
    const own = tableTextScaled(
      table({
        overrides: { margins: { left: 0.1, top: 0.2 } },
        cells: [[cell('x', { format: { margins: { left: 0.3 } } })]],
        rowHeights: [1],
        columnWidths: [1],
      }),
      STYLE,
      0.5,
    );
    expect(own.overrides!.margins).toEqual({ left: 0.05, top: 0.1, right: 0.03, bottom: 0.03 });
    expect(own.cells[0]![0]!.format!.margins).toEqual({ left: 0.15 });
    expect(tableTextScaled(table(), STYLE, 1)).toEqual(table());
  });
});
