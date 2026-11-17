// M4-16 part 5: each row's and cell's cell style (Title, Header, Data) kept in the table, so
// title and header rows can be inserted and deleted anywhere, a cell or row put on another cell
// style (the Table Cell tab's Cell Styles) and a new table's first rows given other cell styles
// (Insert Table's Set cell styles).
import { describe, expect, it } from 'vitest';
import {
  newTableGeometry,
  standardTableStyle,
  tableCellOptions,
  tableCellStyleNames,
  tableParts,
  tableRowStyles,
  windowTableSize,
  withCellsStyled,
  withColumnsInserted,
  withRowStyles,
  withRowsDeleted,
  withRowsInserted,
  type TableCell,
  type TableGeometry,
  type TablePart,
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

/** Title over two columns, a header row and two data rows. */
const table = (more: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.4533, 0.36, 0.36, 0.36],
  columnWidths: [2, 3],
  cells: [
    [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
    [cell('Tag'), cell('Size')],
    [cell('N1'), cell('DN50')],
    [cell('N2'), cell('DN80')],
  ],
  ...more,
});

/** `g` with cell (`i`, `j`) replaced. */
const setCell = (g: TableGeometry, i: number, j: number, c: TableCell): TableGeometry => ({
  ...g,
  cells: g.cells.map((row, k) => (k === i ? row.map((x, l) => (l === j ? c : x)) : row)),
});

const heights = (parts: readonly TablePart[]) =>
  parts.flatMap((p) => (p.geom.kind === 'MTEXT' ? [[p.geom.contents, p.geom.height]] : []));

describe('rows and cells on cell styles of their own', () => {
  it('draws each row and cell with its own cell style, else the row’s by its place', () => {
    expect(tableRowStyles(table(), STYLE)).toEqual(['title', 'header', 'data', 'data']);
    let g = table({ rowStyles: ['title', 'header', 'title', 'data'] });
    g = setCell(g, 3, 1, cell('DN80', { cellStyle: 'header' }));
    expect(tableCellStyleNames(g, STYLE)).toEqual([
      ['title', 'title'],
      ['header', 'header'],
      ['title', 'title'],
      ['data', 'header'],
    ]);
    // Title text 0.25 high, middle centre; header and data 0.18.
    expect(heights(tableParts(g, STYLE, { textStyle: 'T' }))).toEqual([
      ['Schedule', 0.25],
      ['Tag', 0.18],
      ['Size', 0.18],
      ['N1', 0.25],
      ['DN50', 0.25],
      ['N2', 0.18],
      ['DN80', 0.18],
    ]);
    // A row list that does not match the rows is ignored (rows by their place).
    expect(tableRowStyles(table({ rowStyles: ['data'] }), STYLE)).toEqual([
      'title',
      'header',
      'data',
      'data',
    ]);
  });

  it('frames a run of cells of one style with its outside borders', () => {
    // A style whose title cells have a red top border and data cells none: a title row moved
    // to the third row draws its red top there.
    const red = { kind: 'aci', index: 1 } as const;
    const style: TableStyleRecord = {
      ...STYLE,
      cellStyles: STYLE.cellStyles.map((s, k) =>
        k === 1
          ? { ...s, borders: s.borders.map((b, n) => (n === 0 ? { ...b, color: red } : b)) }
          : s,
      ),
    };
    const reds = (g: TableGeometry) =>
      tableParts(g, style, { textStyle: 'T' })
        .filter((p) => p.geom.kind === 'LINE' && JSON.stringify(p.color) === JSON.stringify(red))
        .map((p) => {
          const l = p.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
          return [l.start.x, Math.round(l.start.y * 1e4) / 1e4 + 0, l.end.x];
        });
    expect(reds(table())).toEqual([[0, 0, 5]]);
    expect(reds(table({ rowStyles: ['title', 'header', 'title', 'data'] }))).toEqual([
      [0, 0, 5],
      [0, -0.8133, 5],
    ]);
    // A single cell on the title style takes its top border alone.
    let one = table();
    one = setCell(one, 3, 1, cell('DN80', { cellStyle: 'title' }));
    expect(reds(one)).toEqual([
      [0, 0, 5],
      [2, -1.1733, 5],
    ]);
  });

  it('states the rows only when they are not by their place, and drops cells’ own styles that are their row’s', () => {
    let g = table();
    g = setCell(g, 2, 0, cell('N1', { cellStyle: 'data' }));
    g = setCell(g, 2, 1, cell('DN50', { cellStyle: 'title' }));
    const same = withRowStyles(g, STYLE, ['title', 'header', 'data', 'data']);
    expect(same.rowStyles).toBeUndefined();
    expect(same.cells[2]!.map((c) => c.cellStyle)).toEqual([undefined, 'title']);
    const moved = withRowStyles(g, STYLE, ['title', 'header', 'title', 'data']);
    expect(moved.rowStyles).toEqual(['title', 'header', 'title', 'data']);
    expect(moved.cells[2]!.map((c) => c.cellStyle)).toEqual(['data', undefined]);
  });
});

describe('title and header rows inserted and deleted (M4-16 part 5)', () => {
  it('offers Insert Rows and Delete Rows on the title and header rows', () => {
    const on = (r0: number, r1: number) =>
      tableCellOptions(table(), STYLE, { r0, c0: 0, r1, c1: 1 });
    for (const r of [0, 1])
      expect(on(r, r)).toEqual(
        expect.arrayContaining(['Above', 'Below', 'DeleteRows', 'CellStyle']),
      );
    expect(on(0, 3)).not.toContain('DeleteRows');
  });

  it('inserts rows on the cell style of the row they are inserted next to', () => {
    const above = withRowsInserted(table(), 0, 1, 0, STYLE);
    expect(tableRowStyles(above, STYLE)).toEqual(['title', 'title', 'header', 'data', 'data']);
    expect(above.rowStyles).toEqual(['title', 'title', 'header', 'data', 'data']);
    const below = withRowsInserted(table(), 2, 1, 1, STYLE);
    expect(below.rowStyles).toEqual(['title', 'header', 'header', 'data', 'data']);
    // A data row after the last row is by its place: nothing stated.
    expect(withRowsInserted(table(), 4, 1, 3, STYLE).rowStyles).toBeUndefined();
    // Its cells take the row's cells' own styles too.
    let g = table();
    g = setCell(g, 3, 1, cell('DN80', { cellStyle: 'header' }));
    expect(withRowsInserted(g, 4, 1, 3, STYLE).cells[4]!.map((c) => c.cellStyle)).toEqual([
      undefined,
      'header',
    ]);
  });

  it('deletes the title or header row, the other rows keeping their cell styles', () => {
    const noTitle = withRowsDeleted(table(), 0, 0, STYLE);
    expect(noTitle.rowStyles).toEqual(['header', 'data', 'data']);
    expect(noTitle.cells[0]!.map((c) => c.text)).toEqual(['Tag', 'Size']);
    const noHeader = withRowsDeleted(table(), 1, 1, STYLE);
    expect(noHeader.rowStyles).toEqual(['title', 'data', 'data']);
  });

  it('keeps the rows’ cell styles through column edits', () => {
    const g = table({ rowStyles: ['title', 'header', 'title', 'data'] });
    const wider = withColumnsInserted(g, 2, 1, 1);
    expect(wider.rowStyles).toEqual(['title', 'header', 'title', 'data']);
    expect(wider.cells.map((r) => r.length)).toEqual([3, 3, 3, 3]);
    expect(withColumnsInserted(table(), 0, 1, 0).rowStyles).toBeUndefined();
  });
});

describe('Cell Style (M4-16 part 5)', () => {
  it('puts whole rows on the cell style, and cells of part of a row on it as their own', () => {
    const whole = withCellsStyled(table(), STYLE, { r0: 2, c0: 0, r1: 2, c1: 1 }, 'title');
    expect(whole.rowStyles).toEqual(['title', 'header', 'title', 'data']);
    expect(whole.cells[2]!.every((c) => c.cellStyle === undefined)).toBe(true);
    const part = withCellsStyled(table(), STYLE, { r0: 2, c0: 1, r1: 3, c1: 1 }, 'header');
    expect(part.rowStyles).toBeUndefined();
    expect(part.cells.map((r) => r[1]!.cellStyle)).toEqual([
      undefined,
      undefined,
      'header',
      'header',
    ]);
    // The row's own style is no style of the cell's own; By Row drops it.
    expect(
      withCellsStyled(table(), STYLE, { r0: 2, c0: 1, r1: 2, c1: 1 }, 'data').cells[2]![1]!
        .cellStyle,
    ).toBeUndefined();
    const byRow = withCellsStyled(part, STYLE, { r0: 2, c0: 0, r1: 3, c1: 1 }, undefined);
    expect(byRow.cells.map((r) => r[1]!.cellStyle)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Setting a moved row back to its place's style states nothing again.
    expect(
      withCellsStyled(whole, STYLE, { r0: 2, c0: 0, r1: 2, c1: 1 }, 'data').rowStyles,
    ).toBeUndefined();
  });
});

describe('Insert Table’s Set cell styles (M4-16 part 5)', () => {
  const at = { x: 0, y: 0 };
  it('puts the first, second and other rows on the cell styles chosen', () => {
    const plain = newTableGeometry({
      style: STYLE,
      columns: 2,
      dataRows: 2,
      columnWidth: 2,
      rowLines: 1,
      position: at,
    });
    expect(plain.rowStyles).toBeUndefined();
    const placed = newTableGeometry({
      style: STYLE,
      columns: 2,
      dataRows: 2,
      columnWidth: 2,
      rowLines: 1,
      position: at,
      cellStyles: { first: 'title', second: 'header', others: 'data' },
    });
    expect(placed.rowStyles).toBeUndefined();
    const g = newTableGeometry({
      style: STYLE,
      columns: 2,
      dataRows: 2,
      columnWidth: 2,
      rowLines: 1,
      position: at,
      cellStyles: { first: 'header', second: 'data', others: 'title' },
    });
    expect(g.rowStyles).toEqual(['header', 'data', 'title', 'title']);
    // Rows as high as one line of their style's text; title rows merged across.
    expect(g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4)).toEqual([
      0.36, 0.36, 0.4533, 0.4533,
    ]);
    expect(g.cells.map((r) => r[0]!.columnSpan)).toEqual([1, 1, 2, 2]);
  });

  it('sizes a window’s rows by the cell styles chosen', () => {
    const size = { columns: 1, columnWidth: 1, dataRows: 2, rowLines: 1 };
    // Other rows of title text are 0.4533 high: below a 0.36 header and a 0.36 data row, two fit
    // in 2; data rows below the title and header, three.
    const sized = windowTableSize(
      STYLE,
      { ...size, cellStyles: { first: 'header', second: 'data', others: 'title' } },
      false,
      true,
      1,
      2,
    );
    expect(sized).toMatchObject({ dataRows: 2, cellStyles: { others: 'title' } });
    expect(windowTableSize(STYLE, size, false, true, 1, 2).dataRows).toBe(3);
  });
});
