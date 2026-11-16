// A spreadsheet's cells pasted as a table (M4-06). AutoCAD pastes cells copied in a spreadsheet
// as a TABLE (AutoCAD 2024 Help, "PASTESPEC": "AutoCAD Entities" converts a spreadsheet's cells
// to a table); Triya's PASTECLIP does it for whatever a spreadsheet put on the system clipboard:
// - Excel, LibreOffice Calc and Google Sheets write the cells as an HTML table (text/html), which
//   holds the merged ranges too, beside tab-separated rows (text/plain);
// - an app that writes only text writes tab-separated rows; text is taken for a spreadsheet's
//   rows only when it has two lines or more cells and every row has the same number of cells
//   (a spreadsheet's copy is a rectangle), so prose and code with stray tabs stay text;
// - a CSV file's text (text/csv) is comma-separated rows (RFC 4180).
// The HTML is read here, not by the browser, so that the engine (and the tests) read it in Node:
// only what a table's cells say is wanted, its text, line breaks and spans.
import type { Vec2 } from '../geom/types';
import type { TableCell, TableGeometry, TableStyleRecord } from '../model/types';
import { rowCellStyle, tableRowHeight, tableRowTypes } from '../annotation/table';
import { mtextLiteral } from './clipboard-data';

/** One cell of a spreadsheet's copy: its text (plain, line breaks as `\n`) and its range. */
export interface SheetCell {
  readonly text: string;
  /** Rows and columns the cell spans when it heads a merged range. */
  readonly rowSpan: number;
  readonly columnSpan: number;
  /** Covered by a merged range another cell heads. */
  readonly merged: boolean;
}

/** A spreadsheet's copy: `cells[row][column]`, every row as long. */
export type SheetCells = readonly (readonly SheetCell[])[];

const cell = (text: string): SheetCell => ({ text, rowSpan: 1, columnSpan: 1, merged: false });
const covered: SheetCell = { text: '', rowSpan: 1, columnSpan: 1, merged: true };

/** Whether any cell has text: a copy of empty cells pastes nothing. */
const hasText = (rows: SheetCells) => rows.some((r) => r.some((c) => c.text.trim() !== ''));

/**
 * The rows of `text` separated by `delimiter`, a cell opened by `"` running to the `"` that
 * closes it (`""` a quote inside): what Excel writes for a cell with a line break, and CSV for a
 * cell with a comma. A `"` that does not open a cell so is kept as written. The line break after
 * the last row is dropped.
 */
function delimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  const endsCell = (k: number) =>
    k >= n || text[k] === delimiter || text[k] === '\n' || text[k] === '\r';
  for (;;) {
    let value = '';
    let quoted = false;
    if (text[i] === '"') {
      // A quoted cell, if it closes before a delimiter or a line break.
      let k = i + 1;
      let v = '';
      for (; k < n; k++) {
        if (text[k] !== '"') v += text[k];
        else if (text[k + 1] === '"') {
          v += '"';
          k++;
        } else break;
      }
      if (k < n && endsCell(k + 1)) {
        value = v.replace(/\r\n?/g, '\n');
        i = k + 1;
        quoted = true;
      }
    }
    if (!quoted) {
      while (!endsCell(i)) value += text[i++];
    }
    row.push(value);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === delimiter) {
      i++;
      continue;
    }
    // A line break: \r\n, \r or \n; the one after the last row ends the text.
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }
  return rows;
}

/**
 * A spreadsheet's cells copied as tab-separated rows; undefined when `text` is not one: a single
 * cell, rows of different lengths, or no text in any cell.
 */
export function tabSeparatedCells(text: string): SheetCells | undefined {
  const rows = delimitedRows(text, '\t');
  const width = rows[0]?.length ?? 0;
  if (width < 2 || rows.some((r) => r.length !== width)) return undefined;
  const cells = rows.map((r) => r.map(cell));
  return hasText(cells) ? cells : undefined;
}

/** A CSV file's text as cells, short rows filled with empty ones; undefined with no text. */
export function csvCells(text: string): SheetCells | undefined {
  const rows = delimitedRows(text, ',');
  const width = Math.max(0, ...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: width }, (_, j) => cell(r[j] ?? '')));
  return hasText(cells) ? cells : undefined;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // A spreadsheet writes a cell's leading or repeated spaces as no-break spaces: in a drawing's
  // table they are spaces.
  nbsp: ' ',
};

/** `html`'s character references decoded. */
function decodeEntities(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      if (!(code > 0 && code <= 0x10ffff)) return whole;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A cell's text from its HTML: tags dropped, `<br>` a line break, white space collapsed. */
function cellText(html: string): string {
  // A table inside the cell is not its text (innermost tables first).
  let own = html;
  for (let was = ''; was !== own;) {
    was = own;
    own = own.replace(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table\s*>/gi, '');
  }
  return own
    .split(/<br\b[^>]*>/i)
    .map((line) =>
      decodeEntities(line.replace(/<[^>]*>/g, ''))
        .replace(/[ \t\r\n\f]+/g, ' ')
        .trim(),
    )
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** A tag's whole-number attribute (`colspan=2`, `rowspan="3"`), at least 1. */
function span(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(tag);
  const v = m ? +m[1]! : 1;
  return v >= 1 ? v : 1;
}

/**
 * The cells of the first table in `html`, merged ranges headed by the cell that spans them (a
 * row span is cut back to the table's last row); undefined when there is no table or no text in it. A
 * table inside a cell is not read.
 */
export function htmlTableCells(html: string): SheetCells | undefined {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, '');
  const open = /<table\b[^>]*>/i.exec(source);
  if (!open) return undefined;
  // The table's own rows and cells, at depth 1 of nested tables.
  const tags = /<(\/?)(table|tr|td|th)\b[^>]*>/gi;
  tags.lastIndex = open.index + open[0].length;
  type Raw = { text: string; rowSpan: number; columnSpan: number };
  const rows: Raw[][] = [];
  let depth = 1;
  let row: Raw[] | undefined;
  let start: { tag: string; at: number } | undefined;
  const closeCell = (at: number) => {
    if (start && row) {
      row.push({
        text: cellText(source.slice(start.at, at)),
        rowSpan: span(start.tag, 'rowspan'),
        columnSpan: span(start.tag, 'colspan'),
      });
    }
    start = undefined;
  };
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (name === 'table') {
      depth += closing ? -1 : 1;
      if (depth === 0) {
        closeCell(m.index);
        break;
      }
      continue;
    }
    if (depth !== 1) continue;
    if (name === 'tr') {
      closeCell(m.index);
      if (!closing) rows.push((row = []));
      else row = undefined;
    } else if (closing) {
      closeCell(m.index);
    } else {
      closeCell(m.index);
      if (!row) rows.push((row = []));
      start = { tag: m[0], at: m.index + m[0].length };
    }
  }
  closeCell(source.length);

  // Lay the cells out as HTML does: each in the first column its row's earlier ranges leave.
  const grid: (SheetCell | undefined)[][] = rows.map(() => []);
  rows.forEach((r, i) => {
    let j = 0;
    for (const c of r) {
      while (grid[i]![j]) j++;
      const rowSpan = Math.min(c.rowSpan, rows.length - i);
      for (let a = 0; a < rowSpan; a++) {
        for (let b = 0; b < c.columnSpan; b++) grid[i + a]![j + b] = covered;
      }
      grid[i]![j] = { text: c.text, rowSpan, columnSpan: c.columnSpan, merged: false };
      j += c.columnSpan;
    }
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  const filled = grid.filter((r) => r.length > 0);
  if (filled.length === 0) return undefined;
  // Short rows filled with empty cells.
  const cells = filled.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? cell('')));
  return hasText(cells) ? cells : undefined;
}

/**
 * A table of `cells` in `style` at `position` (its upper left corner, as TABLE inserts one), each
 * column `columnWidths` wide and each row a line of its row type's text high: the rows are the
 * spreadsheet's, the first ones taking the title and header cell styles the style gives them as
 * any table's do. Each cell's text is MTEXT, its line breaks paragraphs.
 */
export function pastedTableGeometry(
  style: TableStyleRecord,
  cells: SheetCells,
  columnWidths: readonly number[],
  position: Vec2,
): TableGeometry {
  const types = tableRowTypes(style, cells.length);
  const rowHeights = types.map((type) =>
    tableRowHeight(1, rowCellStyle(style, type)?.textHeight ?? 0.18, style.verticalMargin),
  );
  return {
    kind: 'ACAD_TABLE',
    style: style.handle,
    position,
    direction: { x: 1, y: 0 },
    rowHeights,
    columnWidths: [...columnWidths],
    cells: cells.map((row) =>
      row.map((c): TableCell => ({
        type: 'text',
        text: c.merged ? '' : mtextLiteral(c.text),
        rowSpan: c.rowSpan,
        columnSpan: c.columnSpan,
        merged: c.merged,
        rotation: 0,
      })),
    ),
  };
}
