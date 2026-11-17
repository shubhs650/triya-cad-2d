// Table breaks (M4-16 part 10), after AutoCAD 2024 Help ("To Break a Table into Multiple Parts",
// the Properties palette's Table Breaks): a table whose breaks are enabled is drawn as parts,
// each holding the rows that fit in the break height, the parts after the first laid out to the
// right, the left or below the first, `spacing` apart, and the title and header rows (the
// labels) repeated at the top of each part when Repeat top labels is on (at the bottom, Repeat
// bottom labels, in a table that flows up, whose labels are at the bottom).
//
// A part breaks only between rows no merged cell spans, so a merged cell stays whole in one part
// (AutoCAD's Help does not say; a drafter expects a merged cell kept whole), and holds at least
// one row besides its labels however low the break height. With Manual heights a part after the
// first takes its own height where it has one, with Manual positions its own place.
import type { Vec2 } from '../geom/types';
import type { TableBreaks, TableCellStyleName, TableGeometry } from '../model/types';

/** One part of a broken table: its rows in order (labels first) and where its origin lies. */
export interface TablePiece {
  readonly rows: readonly number[];
  /** The part's origin from the table's insertion point, in block coordinates. */
  readonly offset: Vec2;
  /** How many of `rows` are the labels repeated at the start of every part (0 when not). */
  readonly labels: number;
}

const ORIGIN: Vec2 = { x: 0, y: 0 };

/** Whether `b` breaks a table: enabled with a break height. */
export const breaksOn = (b: TableBreaks | undefined): b is TableBreaks =>
  b?.enabled === true && b.height > 0;

/**
 * The rows a break may not fall before: a row some merged cell from a row above runs into.
 * `ok[i]` is true where a part may start at row `i`.
 */
function breakable(g: TableGeometry): boolean[] {
  const ok = g.rowHeights.map(() => true);
  g.cells.forEach((row, i) =>
    row.forEach((c) => {
      if (c.merged) return;
      for (let r = i + 1; r < Math.min(i + c.rowSpan, ok.length); r++) ok[r] = false;
    }),
  );
  return ok;
}

/**
 * The parts table `g` is drawn as, its rows on cell styles `types` (`tableRowStyles`), flowing up
 * when `up`: one part of every row while its breaks are off.
 */
export function breakPieces(
  g: TableGeometry,
  types: readonly TableCellStyleName[],
  up: boolean,
): TablePiece[] {
  const rows = g.rowHeights.length;
  const all = [...Array(rows).keys()];
  const b = g.breaks;
  if (!breaksOn(b) || rows === 0) return [{ rows: all, offset: ORIGIN, labels: 0 }];
  const ok = breakable(g);
  // The labels: the title and header rows the table starts with, and any row a merged cell
  // from them runs into.
  let labels = 0;
  while (labels < rows && (types[labels] === 'title' || types[labels] === 'header')) labels++;
  while (labels < rows && !ok[labels]) labels++;
  const repeat = (up ? b.repeatBottom : b.repeatTop) && labels < rows;
  const labelRows = all.slice(0, labels);
  const labelHeight = labelRows.reduce((s, i) => s + g.rowHeights[i]!, 0);

  const head = repeat ? labelRows : [];
  const parts: number[][] = [];
  let i = repeat ? labels : 0;
  while (i < rows) {
    const k = parts.length;
    const own = b.manualHeights && k > 0 ? b.parts?.[k]?.height : undefined;
    const limit = own !== undefined && own > 0 ? own : b.height;
    let h = repeat ? labelHeight : 0;
    const body: number[] = [];
    // Whole groups of rows (rows a merged cell keeps together) while they fit, and at least
    // one row that is not a repeated label.
    let held = false;
    while (i < rows) {
      let end = i + 1;
      while (end < rows && !ok[end]) end++;
      let gh = 0;
      for (let r = i; r < end; r++) gh += g.rowHeights[r]!;
      if (held && h + gh > limit * (1 + 1e-9)) break;
      for (let r = i; r < end; r++) body.push(r);
      h += gh;
      held ||= end > labels || !repeat;
      i = end;
    }
    parts.push([...head, ...body]);
  }

  const width = g.columnWidths.reduce((s, w) => s + w, 0);
  const heights = parts.map((p) => p.reduce((s, r) => s + g.rowHeights[r]!, 0));
  let y = 0;
  return parts.map((p, k): TablePiece => {
    let offset: Vec2;
    if (k === 0) offset = ORIGIN;
    else if (b.direction === 'down') {
      // A part's origin is its top, its bottom in a table that flows up.
      y -= up ? heights[k]! + b.spacing : heights[k - 1]! + b.spacing;
      offset = { x: 0, y };
    } else {
      const step = (width + b.spacing) * k;
      offset = { x: b.direction === 'left' ? -step : step, y: 0 };
    }
    const own = b.manualPositions && k > 0 ? b.parts?.[k]?.offset : undefined;
    return { rows: p, offset: own ?? offset, labels: head.length };
  });
}

/**
 * The rows of `g` in `rows` as a table of their own (a part's), each row keeping its cell style.
 * A part never splits a merged cell (`breakPieces`), so the spans hold.
 */
export function pieceGeometry(
  g: TableGeometry,
  types: readonly TableCellStyleName[],
  rows: readonly number[],
): TableGeometry {
  const { rowOrigins: _r, breaks: _b, ...rest } = g;
  return {
    ...rest,
    rowHeights: rows.map((i) => g.rowHeights[i]!),
    cells: rows.map((i) => g.cells[i]!),
    rowStyles: rows.map((i) => types[i] ?? 'data'),
  };
}

/**
 * The break settings a table starts with when its breaking grip is first dragged: AutoCAD's
 * Properties defaults (Direction Right, no labels repeated, no manual positions or heights). Its
 * Help gives no default spacing; one data row's height keeps the parts apart as a row does.
 */
export function defaultTableBreaks(g: TableGeometry): TableBreaks {
  const row = g.rowHeights[g.rowHeights.length - 1] ?? 0;
  return {
    enabled: false,
    direction: 'right',
    repeatTop: false,
    repeatBottom: false,
    manualPositions: false,
    manualHeights: false,
    height: g.rowHeights.reduce((s, h) => s + h, 0),
    spacing: row,
  };
}
