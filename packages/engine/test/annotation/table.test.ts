// M4-05: the table engine draws a table's `*T` block from its rows, columns, cells and table
// style, in AutoCAD's order: fills, texts, blocks, row lines, column lines, the Defpoints line.
import { describe, expect, it } from 'vitest';
import {
  standardTableStyle,
  tableCellShown,
  tableParts,
  tableRowHeight,
  tableRowTypes,
  type TableCell,
  type TableGeometry,
  type TablePart,
  type TableStyleRecord,
} from '../../src/index';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

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

/** A title over two columns 2.5 and 3 wide, a header row and a data row, one line each. */
const table = (more: Partial<TableGeometry> = {}): TableGeometry => ({
  kind: 'ACAD_TABLE',
  style: 'S',
  position: { x: 0, y: 0 },
  direction: { x: 1, y: 0 },
  rowHeights: [0.4533, 0.36, 0.36],
  columnWidths: [2.5, 3],
  cells: [
    [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
    [cell('Tag'), cell('Size')],
    [cell('N1'), cell('')],
  ],
  ...more,
});

const draw = (g: TableGeometry, style: TableStyleRecord | undefined = STYLE) =>
  tableParts(g, style, { textStyle: 'STD' });

/** Lines as [x1, y1, x2, y2]. */
const lines = (parts: readonly TablePart[]) =>
  parts
    .filter((p) => p.geom.kind === 'LINE' && !p.defpoint)
    .map((p) => {
      const g = p.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
      return [r4(g.start.x), r4(g.start.y), r4(g.end.x), r4(g.end.y)];
    });

const texts = (parts: readonly TablePart[]) =>
  parts.flatMap((p) =>
    p.geom.kind === 'MTEXT'
      ? [
          {
            text: p.geom.contents,
            at: [r4(p.geom.position.x), r4(p.geom.position.y)],
            width: r4(p.geom.width),
            height: p.geom.height,
            attachment: p.geom.attachment,
            style: p.geom.style,
          },
        ]
      : [],
  );

describe('table engine (M4-05)', () => {
  it('gives a row 4/3 of its text height a line and a margin above and below', () => {
    expect(r4(tableRowHeight(1, 0.25, 0.06))).toBe(0.4533);
    expect(r4(tableRowHeight(2, 0.18, 0.06))).toBe(0.6);
    expect(r4(tableRowHeight(1, 4.5, 1.5))).toBe(9);
  });

  it('types rows title, header and data unless the style suppresses them', () => {
    expect(tableRowTypes(STYLE, 4)).toEqual(['title', 'header', 'data', 'data']);
    expect(tableRowTypes({ suppressTitle: true, suppressHeader: false }, 2)).toEqual([
      'header',
      'data',
    ]);
    expect(tableRowTypes({ suppressTitle: true, suppressHeader: true }, 1)).toEqual(['data']);
    expect(tableRowTypes(undefined, 3)).toEqual(['title', 'header', 'data']);
  });

  it('draws texts, row lines, column lines and the Defpoints line', () => {
    const parts = draw(table());
    expect(parts.map((p) => p.geom.kind)).toEqual([
      'MTEXT',
      'MTEXT',
      'MTEXT',
      'MTEXT',
      ...Array(4).fill('LINE'),
      ...Array(3).fill('LINE'),
      'LINE',
    ]);
    // The title middle centre over both columns, the header middle centre, the data top centre,
    // each wrapping inside its margins; empty cells draw nothing.
    expect(texts(parts)).toEqual([
      {
        text: 'Schedule',
        at: [2.75, -0.2266],
        width: 5.38,
        height: 0.25,
        attachment: 5,
        style: 'T1',
      },
      { text: 'Tag', at: [1.25, -0.6333], width: 2.38, height: 0.18, attachment: 5, style: 'T1' },
      { text: 'Size', at: [4, -0.6333], width: 2.88, height: 0.18, attachment: 5, style: 'T1' },
      { text: 'N1', at: [1.25, -0.8733], width: 2.38, height: 0.18, attachment: 2, style: 'T1' },
    ]);
    expect(lines(parts)).toEqual([
      [0, 0, 5.5, 0],
      [0, -0.4533, 5.5, -0.4533],
      [0, -0.8133, 5.5, -0.8133],
      [0, -1.1733, 5.5, -1.1733],
      [0, 0, 0, -1.1733],
      // Not through the merged title.
      [2.5, -0.4533, 2.5, -1.1733],
      [5.5, 0, 5.5, -1.1733],
    ]);
    // Everything ByBlock, the lines' linetype and lineweight too.
    expect(parts[4]).toMatchObject({
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
    });
    expect(parts.at(-1)).toEqual({
      geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
      color: { kind: 'aci', index: 8 },
      linetype: 'ByLayer',
      lineweight: 0,
      defpoint: true,
    });
  });

  it('fills cells, under the text, from the style or the cell, and none where the cell says so', () => {
    const red = { kind: 'aci', index: 1 } as const;
    const style: TableStyleRecord = {
      ...STYLE,
      // Header rows filled in the style.
      cellStyles: STYLE.cellStyles.map((c, i) => (i === 2 ? { ...c, fillOn: true } : c)),
    };
    const g = table({
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        [cell('Tag'), cell('Size', { format: { background: null } })],
        [cell('N1', { format: { background: red } }), cell('')],
      ],
    });
    const fills = draw(g, style).filter((p) => p.geom.kind === 'SOLID');
    const corners = (p: TablePart) =>
      (p.geom as unknown as { corners: { x: number; y: number }[] }).corners.map((c) => ({
        x: r4(c.x),
        y: r4(c.y),
      }));
    expect(fills.map((p) => [p.color, corners(p)])).toEqual([
      [
        { kind: 'aci', index: 7 },
        [
          { x: 0, y: -0.4533 },
          { x: 0, y: -0.8133 },
          { x: 2.5, y: -0.4533 },
          { x: 2.5, y: -0.8133 },
        ],
      ],
      [
        red,
        [
          { x: 0, y: -0.8133 },
          { x: 0, y: -1.1733 },
          { x: 2.5, y: -0.8133 },
          { x: 2.5, y: -1.1733 },
        ],
      ],
    ]);
    expect(draw(g, style)[0]!.geom.kind).toBe('SOLID');
  });

  it('takes the cell format over the style: alignment, height, style, colour, margins', () => {
    const blue = { kind: 'aci', index: 5 } as const;
    const g = table({
      overrides: { margins: { left: 0.1, top: 0.05, right: 0.1, bottom: 0.05 } },
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        [
          cell('Tag', {
            format: { alignment: 7, textHeight: 0.1, textStyle: 'T2', contentColor: blue },
          }),
          cell(''),
        ],
        [cell('N1', { format: { alignment: 6, margins: { left: 0.2 } } }), cell('')],
      ],
    });
    const parts = draw(g);
    expect(texts(parts).slice(1)).toEqual([
      // Bottom left, inside the table's margins.
      { text: 'Tag', at: [0.1, -0.7633], width: 2.3, height: 0.1, attachment: 7, style: 'T2' },
      // Middle right, inside the cell's own horizontal margin.
      { text: 'N1', at: [2.3, -0.9933], width: 2.1, height: 0.18, attachment: 6, style: 'T1' },
    ]);
    expect(parts[1]!.color).toEqual(blue);
    // A style naming no text style takes the drawing's Standard.
    const plain = {
      ...STYLE,
      cellStyles: STYLE.cellStyles.map(({ textStyle: _t, ...c }) => c),
    };
    expect(texts(draw(table(), plain))[0]!.style).toBe('STD');
    // No style at all: Standard's sizes are not known, AutoCAD's defaults are taken.
    expect(texts(tableParts(table(), undefined, { textStyle: 'STD' }))[0]).toMatchObject({
      height: 0.18,
      attachment: 1,
      width: 5.5,
    });
  });

  it('breaks a line where its colour or lineweight changes and leaves hidden edges out', () => {
    const red = { kind: 'aci', index: 1 } as const;
    const g = table({
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        // The cell below overrides the shared edge; the cell above's override counts where the
        // one below states none.
        [
          cell('Tag', { format: { borders: { bottom: { color: red } } } }),
          cell('Size', { format: { borders: { bottom: { color: red, lineweight: 50 } } } }),
        ],
        [
          cell('N1', { format: { borders: { top: { lineweight: 35 }, right: { hidden: true } } } }),
          cell(''),
        ],
      ],
    });
    const parts = draw(g).filter((p) => p.geom.kind === 'LINE' && !p.defpoint);
    const row = parts.filter((p) => r4((p.geom as { start: { y: number } }).start.y) === -0.8133);
    expect(row.map((p) => [lines([p])[0], p.color, p.lineweight])).toEqual([
      [[0, -0.8133, 2.5, -0.8133], { kind: 'byBlock' }, 35],
      [[2.5, -0.8133, 5.5, -0.8133], red, 50],
    ]);
    // The data row's middle column line is hidden; the header row's still drawn.
    expect(lines(parts)).toContainEqual([2.5, -0.4533, 2.5, -0.8133]);
    expect(lines(parts)).not.toContainEqual([2.5, -0.4533, 2.5, -1.1733]);
    // A style border that is off draws nothing unless a cell overrides it.
    const off: TableStyleRecord = {
      ...STYLE,
      cellStyles: STYLE.cellStyles.map((c) => ({
        ...c,
        borders: c.borders.map((b) => ({ ...b, visible: false })),
      })),
    };
    expect(lines(draw(g, off))).toEqual([
      [0, -0.8133, 2.5, -0.8133],
      [2.5, -0.8133, 5.5, -0.8133],
    ]);
  });

  it('merges a block of cells: one text and fill across it, no lines inside', () => {
    const g: TableGeometry = {
      ...table(),
      rowHeights: [0.4533, 0.36, 0.36, 0.36],
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        [cell('Tag'), cell('Size')],
        [
          cell('Both', { rowSpan: 2, columnSpan: 2, format: { alignment: 5 } }),
          cell('', { merged: true }),
        ],
        [cell('', { merged: true }), cell('', { merged: true })],
      ],
    };
    const parts = draw(g);
    expect(texts(parts).at(-1)).toMatchObject({ text: 'Both', at: [2.75, -1.1733], width: 5.38 });
    expect(lines(parts)).toEqual([
      [0, 0, 5.5, 0],
      [0, -0.4533, 5.5, -0.4533],
      [0, -0.8133, 5.5, -0.8133],
      [0, -1.5333, 5.5, -1.5333],
      [0, 0, 0, -1.5333],
      [2.5, -0.4533, 2.5, -0.8133],
      [5.5, 0, 5.5, -1.5333],
    ]);
  });

  it('turns a rotated cell’s text, wrapping it across the row', () => {
    const g = table({
      rowHeights: [0.4533, 0.36, 2],
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        [cell('Tag'), cell('Size')],
        [cell('Up', { rotation: Math.PI / 2 }), cell('')],
      ],
    });
    const t = draw(g).find((p) => p.geom.kind === 'MTEXT' && p.geom.contents === 'Up')!.geom;
    // Top centre of the turned cell: its left edge's middle, inside the margin.
    expect(t).toMatchObject({ rotation: Math.PI / 2, attachment: 2, width: 1.88 });
    const at = (t as { position: { x: number; y: number } }).position;
    expect([r4(at.x), r4(at.y)]).toEqual([0.06, -1.8133]);
  });

  it('flows up from the insertion point, the title row lowest', () => {
    const up: TableStyleRecord = { ...STYLE, flowDirection: 1 };
    const parts = draw(table(), up);
    expect(texts(parts).map((t) => [t.text, t.at])).toEqual([
      ['Schedule', [2.75, 0.2267]],
      ['Tag', [1.25, 0.6333]],
      ['Size', [4, 0.6333]],
      ['N1', [1.25, 1.1133]],
    ]);
    expect(lines(parts)).toEqual([
      [0, 1.1733, 5.5, 1.1733],
      [0, 0.8133, 5.5, 0.8133],
      [0, 0.4533, 5.5, 0.4533],
      [0, 0, 5.5, 0],
      [0, 1.1733, 0, 0],
      [2.5, 1.1733, 2.5, 0.4533],
      [5.5, 1.1733, 5.5, 0],
    ]);
  });

  it('fits a block cell inside its margins, placed by its alignment, after the texts', () => {
    const g = table({
      cells: [
        [cell('Schedule', { columnSpan: 2 }), cell('', { merged: true })],
        [cell('Tag'), cell('Size')],
        [cell('', { type: 'block', block: 'B1', format: { alignment: 5 } }), cell('x')],
      ],
    });
    const parts = tableParts(g, STYLE, {
      textStyle: 'STD',
      blockExtents: (h) => (h === 'B1' ? { minX: -1, minY: -1, maxX: 3, maxY: 1 } : undefined),
    });
    const kinds = parts.map((p) => p.geom.kind);
    expect(kinds.indexOf('INSERT')).toBe(kinds.lastIndexOf('MTEXT') + 1);
    const ins = parts.find((p) => p.geom.kind === 'INSERT')!.geom as {
      block: string;
      position: { x: number; y: number };
      scale: { x: number };
    };
    // 0.24 of room up and down for a block 2 high: 0.12; centred in the cell.
    expect(ins.block).toBe('B1');
    expect(r4(ins.scale.x)).toBe(0.12);
    expect([r4(ins.position.x), r4(ins.position.y)]).toEqual([1.13, -0.9933]);
    // A block without extents is left out.
    expect(
      tableParts(g, STYLE, { textStyle: 'STD' }).filter((p) => p.geom.kind === 'INSERT'),
    ).toEqual([]);
  });

  describe('a value format string’s text case (%tc, M4-05 part 7)', () => {
    it('draws %tc1 upper case, %tc2 lower case, %tc3 a first capital and %tc4 title case', () => {
      const shown = (text: string, valueFormat: string) =>
        tableCellShown(cell(text, { valueFormat }));
      expect(shown('cell format 1', '%tc1')).toBe('CELL FORMAT 1');
      expect(shown('Cell FORMAT 2', '%tc2')).toBe('cell format 2');
      expect(shown('cell format 3', '%tc3')).toBe('Cell format 3');
      expect(shown('cell format 4', '%tc4')).toBe('Cell Format 4');
      // A format without a text case, or none at all, leaves the value as typed.
      expect(shown('35.00%', '%lu2%pr2%ps[,%]')).toBe('35.00%');
      expect(tableCellShown(cell('as typed'))).toBe('as typed');
    });

    it('changes the text, never the MTEXT format codes around it', () => {
      const c = cell('{\\C1;\\fArial|b1;bolt} m\\Pnut \\S1/2;', { valueFormat: '%tc1' });
      expect(tableCellShown(c)).toBe('{\\C1;\\fArial|b1;BOLT} M\\PNUT \\S1/2;');
    });

    it('draws the cell so and leaves the value as typed for the editor', () => {
      const g = table();
      const rows = g.cells.map((r) => [...r]);
      rows[2]![0] = cell('n1', { valueFormat: '%tc1' });
      const t = texts(draw({ ...g, cells: rows }));
      expect(t.map((x) => x.text)).toContain('N1');
      expect(rows[2]![0]!.text).toBe('n1');
    });
  });

  it('draws nothing for a table without rows or columns', () => {
    expect(draw(table({ rowHeights: [], cells: [] }))).toEqual([]);
  });
});
