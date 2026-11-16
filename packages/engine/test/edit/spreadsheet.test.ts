// M4-06: a spreadsheet's cells as another app puts them on the system clipboard. Excel, LibreOffice
// Calc and Google Sheets write the cells as tab-separated rows (text/plain) beside an HTML table
// (text/html); a CSV file's text comes as comma-separated rows. Each is read into the same grid,
// with merged cells heading their range as a table's do.
import { describe, expect, it } from 'vitest';
import {
  csvCells,
  htmlTableCells,
  pastedTableGeometry,
  standardTableStyle,
  tabSeparatedCells,
  type SheetCell,
  type TableStyleRecord,
} from '../../src/index';

const texts = (cells: readonly (readonly SheetCell[])[] | undefined) =>
  cells?.map((row) => row.map((c) => (c.merged ? null : c.text)));

describe('tabSeparatedCells', () => {
  it("reads a spreadsheet's rows, the last line break dropped", () => {
    const cells = tabSeparatedCells('Mark\tQty\tSize\r\nB1\t4\t12\r\nB2\t\t16\r\n');
    expect(texts(cells)).toEqual([
      ['Mark', 'Qty', 'Size'],
      ['B1', '4', '12'],
      ['B2', '', '16'],
    ]);
    expect(cells![0]![0]).toEqual({ text: 'Mark', rowSpan: 1, columnSpan: 1, merged: false });
  });

  it('reads a quoted cell with line breaks and quotes, as Excel writes one', () => {
    const cells = tabSeparatedCells('Note\tType\n"Line one\nLine ""two"""\tA\n');
    expect(texts(cells)).toEqual([
      ['Note', 'Type'],
      ['Line one\nLine "two"', 'A'],
    ]);
  });

  it('keeps a quote that does not open a quoted cell', () => {
    expect(texts(tabSeparatedCells('5" pipe\t"x" y\n'))).toEqual([['5" pipe', '"x" y']]);
  });

  it('is not a spreadsheet without tabs, or with rows of other lengths', () => {
    expect(tabSeparatedCells('GENERAL NOTES\r\n1. Dims in mm\r\n')).toBeUndefined();
    expect(tabSeparatedCells('Note 1: see\r\nsecond\tline\r\n')).toBeUndefined();
    expect(tabSeparatedCells('\tindented\n\t\ttwice\n')).toBeUndefined();
    expect(tabSeparatedCells('')).toBeUndefined();
    expect(tabSeparatedCells('\t\n')).toBeUndefined();
  });
});

describe('csvCells', () => {
  it('reads RFC 4180 rows, short rows filled with empty cells', () => {
    const cells = csvCells('a,b,c\r\n"1,5","say ""hi""",\r\n"two\r\nlines"\r\n');
    expect(texts(cells)).toEqual([
      ['a', 'b', 'c'],
      ['1,5', 'say "hi"', ''],
      ['two\nlines', '', ''],
    ]);
  });

  it('is nothing for empty text', () => {
    expect(csvCells('\r\n')).toBeUndefined();
  });
});

describe('htmlTableCells', () => {
  // What Excel puts beside the tab-separated rows (shortened): styles, comments, conditional
  // comments, a <col> per column, line breaks inside a cell and entities.
  const EXCEL = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><style><!--table {mso-displayed-decimal-separator:"\\.";}
td {padding-top:1px;} .xl65 {font-weight:700;}--></style></head>
<body link="#0563C1">
<!--StartFragment-->
<table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse: collapse;width:144pt'>
 <col width=64 span=3 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Mark</td>
  <td class=xl65 width=64>Qty &amp; size</td>
  <td class=xl65 width=64>Note</td>
 </tr>
 <tr height=40 style='height:30.0pt'>
  <td height=40 style='height:30.0pt'>B1</td>
  <td align=right>4</td>
  <td class=xl66 width=64 style='white-space:normal'>Top<br style='mso-data-placement:same-cell' />
  &lt;bottom&gt;&nbsp;bar</td>
 </tr>
<!--EndFragment-->
</table>
</body></html>`;

  it("reads Excel's table: text, entities and line breaks, markup and white space dropped", () => {
    expect(texts(htmlTableCells(EXCEL))).toEqual([
      ['Mark', 'Qty & size', 'Note'],
      ['B1', '4', 'Top\n<bottom> bar'],
    ]);
  });

  it('heads a merged range with the cell that spans it', () => {
    const html = `<table><tr><th colspan="2">Schedule</th><th rowspan=2>Rev</th></tr>
      <tr><td>A</td><td><b>B</b></td></tr>
      <tr><td>C</td><td>D</td><td>&#69;&#x46;</td></tr></table>`;
    const cells = htmlTableCells(html)!;
    expect(texts(cells)).toEqual([
      ['Schedule', null, 'Rev'],
      ['A', 'B', null],
      ['C', 'D', 'EF'],
    ]);
    expect(cells[0]![0]).toMatchObject({ rowSpan: 1, columnSpan: 2 });
    expect(cells[0]![2]).toMatchObject({ rowSpan: 2, columnSpan: 1 });
  });

  it('fills short rows and keeps a row span inside the table', () => {
    const cells = htmlTableCells(
      '<table><tbody><tr><td>1</td><td>2</td><td>3</td></tr><tr><td rowspan=5 colspan="2">x</td></tr></tbody></table>',
    )!;
    expect(texts(cells)).toEqual([
      ['1', '2', '3'],
      ['x', null, ''],
    ]);
    expect(cells[1]![0]).toMatchObject({ rowSpan: 1, columnSpan: 2 });
  });

  it('reads the first table only, skipping a table inside a cell', () => {
    const html =
      '<p>x</p><table><tr><td>a<table><tr><td>inner</td></tr></table></td></tr></table><table><tr><td>b</td></tr></table>';
    expect(texts(htmlTableCells(html))).toEqual([['a']]);
  });

  it('is nothing without a table or without text in it', () => {
    expect(htmlTableCells('<p>Just <b>words</b></p>')).toBeUndefined();
    expect(htmlTableCells('<table><tr><td> </td></tr></table>')).toBeUndefined();
  });
});

describe('pastedTableGeometry', () => {
  const style: TableStyleRecord = { handle: '40', ...standardTableStyle(false, '30') };

  it('makes a table of the cells in the style, its text as MTEXT, merges kept', () => {
    const cells = htmlTableCells(
      '<table><tr><td colspan=2>Title {1}</td></tr><tr><td>a\\b</td><td>c</td></tr></table>',
    )!;
    const g = pastedTableGeometry(style, cells, [3, 4], { x: 1, y: 2 });
    expect(g).toMatchObject({
      kind: 'ACAD_TABLE',
      style: '40',
      position: { x: 1, y: 2 },
      direction: { x: 1, y: 0 },
      columnWidths: [3, 4],
    });
    expect(g.rowHeights).toHaveLength(2);
    expect(g.cells[0]![0]).toMatchObject({ type: 'text', text: 'Title \\{1\\}', columnSpan: 2 });
    expect(g.cells[0]![1]).toMatchObject({ merged: true, text: '' });
    expect(g.cells[1]!.map((c) => c.text)).toEqual(['a\\\\b', 'c']);
  });
});
