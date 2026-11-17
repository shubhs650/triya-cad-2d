// M4-05 part 4: a table's grips: the corners size its width, height or both in proportion, a
// column grip moves the line between two columns, the table keeping its width.
import { describe, expect, it } from 'vitest';
import {
  gripsOf,
  moveGrip,
  movedTableGrip,
  standardTableStyle,
  tableCellGrips,
  tableGridLines,
  type TableCell,
  type TableGeometry,
  type TableStyleRecord,
} from '../../src/index';

const STYLE: TableStyleRecord = { handle: 'S', ...standardTableStyle(false, 'T1') };
const UP: TableStyleRecord = { ...STYLE, flowDirection: 1 };

const cell = (text: string): TableCell => ({
  type: 'text',
  text,
  rowSpan: 1,
  columnSpan: 1,
  merged: false,
  rotation: 0,
});

/** Three columns 1, 2 and 3 wide, rows 0.5 and 1 high, at (10, 20). */
const table = (more: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 10, y: 20 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.5, 1],
  columnWidths: [1, 2, 3],
  cells: [
    [cell('a'), cell('b'), cell('c')],
    [cell('d'), cell('e'), cell('f')],
  ],
  ...more,
});

const info = { tableStyle: STYLE };
const shape = (r: ReturnType<typeof moveGrip>) =>
  r.kind === 'shape' && r.geom.kind === 'ACAD_TABLE' ? r.geom : undefined;

describe('a table’s grips', () => {
  it('are its insertion point, the corners, its breaking grip and the tops of the lines between columns', () => {
    expect(gripsOf(table(), info).map((g) => [g.point, g.kind, g.table?.kind])).toEqual([
      [{ x: 10, y: 20 }, 'move', undefined],
      [{ x: 16, y: 20 }, 'table', 'width'],
      [{ x: 10, y: 18.5 }, 'table', 'height'],
      [{ x: 16, y: 18.5 }, 'table', 'size'],
      // The table breaking grip (M4-16 part 10), in the middle of the bottom edge.
      [{ x: 13, y: 18.5 }, 'table', 'break'],
      [{ x: 11, y: 20 }, 'table', 'column'],
      [{ x: 13, y: 20 }, 'table', 'column'],
    ]);
  });

  it('lie along the table’s direction, and above it in a table that flows up', () => {
    const turned = table({ direction: { x: 0, y: 1 } });
    expect(gripsOf(turned, info)[1]!.point).toEqual({ x: 10, y: 26 });
    expect(gripsOf(turned, info)[2]!.point).toEqual({ x: 11.5, y: 20 });
    const up = gripsOf(table(), { tableStyle: UP });
    expect(up.slice(1).map((g) => g.point)).toEqual([
      { x: 16, y: 20 },
      { x: 10, y: 21.5 },
      { x: 16, y: 21.5 },
      { x: 13, y: 21.5 },
      { x: 11, y: 21.5 },
      { x: 13, y: 21.5 },
    ]);
  });

  it('size the width or height in proportion, or both', () => {
    expect(shape(moveGrip(table(), { x: 16, y: 20 }, { x: 22, y: 25 }, info))).toMatchObject({
      columnWidths: [2, 4, 6],
      rowHeights: [0.5, 1],
    });
    expect(shape(moveGrip(table(), { x: 10, y: 18.5 }, { x: 0, y: 17 }, info))).toMatchObject({
      columnWidths: [1, 2, 3],
      rowHeights: [1, 2],
    });
    expect(shape(moveGrip(table(), { x: 16, y: 18.5 }, { x: 13, y: 17 }, info))).toMatchObject({
      columnWidths: [0.5, 1, 1.5],
      rowHeights: [1, 2],
    });
    // Upwards in a table flowing up.
    const up = { tableStyle: UP };
    expect(shape(moveGrip(table(), { x: 10, y: 21.5 }, { x: 10, y: 23 }, up))).toMatchObject({
      rowHeights: [1, 2],
    });
  });

  it('keep a row one line of text high and a column its two margins wide', () => {
    // 0.06 margins: the title row (0.25 text) is at least 0.37, the header (0.18) 0.3.
    const low = shape(moveGrip(table(), { x: 10, y: 18.5 }, { x: 10, y: 19.9 }, info))!;
    expect(low.rowHeights.map((h) => +h.toFixed(9))).toEqual([0.37, 0.3]);
    // One row at its least, the other takes the rest of the height dragged to.
    const some = shape(moveGrip(table(), { x: 10, y: 18.5 }, { x: 10, y: 19.2 }, info))!;
    expect(some.rowHeights.map((h) => +h.toFixed(9))).toEqual([0.37, 0.43]);
    const narrow = shape(moveGrip(table(), { x: 16, y: 20 }, { x: 0, y: 20 }, info))!;
    expect(narrow.columnWidths.every((w) => w >= 0.12 - 1e-12)).toBe(true);
  });

  it('move the line between two columns, the table keeping its width', () => {
    expect(shape(moveGrip(table(), { x: 11, y: 20 }, { x: 12.5, y: 30 }, info))).toMatchObject({
      columnWidths: [2.5, 0.5, 3],
    });
    // No further than leaves the column beside its margins.
    const far = shape(moveGrip(table(), { x: 13, y: 20 }, { x: 20, y: 20 }, info))!;
    expect(far.columnWidths.map((w) => +w.toFixed(9))).toEqual([1, 4.88, 0.12]);
    expect(moveGrip(table(), { x: 11, y: 20 }, { x: 11, y: 30 }, info)).toEqual({ kind: 'none' });
  });

  it('show the table’s grid as it would be while dragged', () => {
    const lines = tableGridLines(table({ columnWidths: [1, 1, 1] }), STYLE);
    expect(lines).toHaveLength(3 + 4);
    expect(lines[0]).toMatchObject({
      kind: 'LINE',
      start: { x: 10, y: 20 },
      end: { x: 13, y: 20 },
    });
  });
});

describe('Ctrl with a column grip (M4-05 part 6)', () => {
  const ctrl = { tableStyle: STYLE, ctrl: true as const };

  it('sizes the column before the line, the table growing or shrinking with it', () => {
    expect(shape(moveGrip(table(), { x: 11, y: 20 }, { x: 12.5, y: 30 }, ctrl))).toMatchObject({
      columnWidths: [2.5, 2, 3],
      position: { x: 10, y: 20 },
    });
    // No narrower than its margins; the other columns keep their widths.
    const narrow = shape(moveGrip(table(), { x: 13, y: 20 }, { x: 0, y: 20 }, ctrl))!;
    expect(narrow.columnWidths.map((w) => +w.toFixed(9))).toEqual([1, 0.12, 3]);
    expect(moveGrip(table(), { x: 11, y: 20 }, { x: 11, y: 25 }, ctrl)).toEqual({ kind: 'none' });
  });

  it('leaves the corner grips as they are', () => {
    expect(shape(moveGrip(table(), { x: 16, y: 20 }, { x: 22, y: 25 }, ctrl))).toMatchObject({
      columnWidths: [2, 4, 6],
    });
  });
});

describe('the grips of table cells selected (M4-05 part 6)', () => {
  it('are the middles of the selection’s edges, in plan', () => {
    const grips = tableCellGrips(table(), STYLE, { r0: 1, c0: 1, r1: 1, c1: 2 });
    expect(grips).toEqual([
      { point: { x: 13.5, y: 19.5 }, role: { kind: 'cellRow', i: 1, start: true } },
      { point: { x: 16, y: 19 }, role: { kind: 'cellColumn', j: 2, start: false } },
      { point: { x: 13.5, y: 18.5 }, role: { kind: 'cellRow', i: 1, start: false } },
      { point: { x: 11, y: 19 }, role: { kind: 'cellColumn', j: 1, start: true } },
    ]);
    // A table flowing up has its first row lowest: the top edge ends the selection's rows.
    const up = tableCellGrips(table(), UP, { r0: 0, c0: 0, r1: 1, c1: 0 });
    expect(up[0]).toEqual({
      point: { x: 10.5, y: 21.5 },
      role: { kind: 'cellRow', i: 1, start: false },
    });
    expect(up[2]).toEqual({
      point: { x: 10.5, y: 20 },
      role: { kind: 'cellRow', i: 0, start: true },
    });
  });

  it('size the selection’s last column or row, the table with it', () => {
    const right = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellColumn', j: 1, start: false },
      {
        x: 1.5,
        y: 4,
      },
    );
    expect(right).toMatchObject({ columnWidths: [1, 3.5, 3], position: { x: 10, y: 20 } });
    const bottom = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellRow', i: 1, start: false },
      {
        x: 3,
        y: -0.5,
      },
    );
    expect(bottom).toMatchObject({ rowHeights: [0.5, 1.5], position: { x: 10, y: 20 } });
  });

  it('size the first column or row by its other edge, what lies before it moving along', () => {
    const left = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellColumn', j: 1, start: true },
      {
        x: -0.5,
        y: 0,
      },
    );
    expect(left).toMatchObject({ columnWidths: [1, 2.5, 3], position: { x: 9.5, y: 20 } });
    const top = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellRow', i: 1, start: true },
      {
        x: 0,
        y: 0.25,
      },
    );
    expect(top).toMatchObject({ rowHeights: [0.5, 1.25], position: { x: 10, y: 20.25 } });
    // Flowing up, row 0's start is its bottom edge: dragged down, the table moves down.
    const up = movedTableGrip(
      table(),
      UP,
      { kind: 'cellRow', i: 0, start: true },
      {
        x: 0,
        y: -1,
      },
    );
    expect(up).toMatchObject({ rowHeights: [1.5, 1], position: { x: 10, y: 19 } });
    // Along a table turned a quarter: its x axis is the world's y.
    const turned = movedTableGrip(
      table({ direction: { x: 0, y: 1 } }),
      STYLE,
      { kind: 'cellColumn', j: 0, start: true },
      { x: 0, y: -1 },
    );
    expect(turned).toMatchObject({ columnWidths: [2, 2, 3], position: { x: 10, y: 19 } });
  });

  it('keep a row one line of text high and a column its margins wide', () => {
    const low = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellRow', i: 0, start: false },
      {
        x: 0,
        y: 5,
      },
    )!;
    expect(+low.rowHeights[0]!.toFixed(9)).toBe(0.37);
    const narrow = movedTableGrip(
      table(),
      STYLE,
      { kind: 'cellColumn', j: 0, start: true },
      {
        x: 5,
        y: 0,
      },
    )!;
    expect(+narrow.columnWidths[0]!.toFixed(9)).toBe(0.12);
    expect(+narrow.position.x.toFixed(9)).toBe(10.88);
    expect(
      movedTableGrip(table(), STYLE, { kind: 'cellColumn', j: 0, start: false }, { x: 0, y: 3 }),
    ).toBeUndefined();
  });
});
