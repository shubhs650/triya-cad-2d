// The table engine (M4-05): what an ACAD_TABLE's anonymous `*T` block holds, drawn from its rows,
// columns, cells and table style, as AutoCAD regenerates it when a table changes. A table read
// from a file keeps the block it came with until it is edited (DEC-011, as a dimension's `*D`
// block); a new or edited table gets the block drawn here (edit/table-block.ts).
//
// What AutoCAD puts in the block is read from the corpus tables (acadsharp sample_AC1015 to
// sample_AC1032, ezdxf acad_table_*): the block is in the table's own frame, x along the
// columns from the left edge and y down the rows from the top edge (the insertion point), and
// holds, in this order:
// - a SOLID per filled cell (merged range), its corners top left, bottom left, top right,
//   bottom right, in the fill colour;
// - an MTEXT per cell with text, row by row: attached by the cell's alignment (DXF 170, 1 top
//   left … 9 bottom right) at that point of the cell less its margins, wrapping at the cell's
//   width less both horizontal margins, by-style direction (72 = 5), in the cell's text style,
//   height and content colour;
// - an INSERT per block cell, scaled to fit inside the margins (AutoCAD's default AutoFit) and
//   placed by the cell's alignment;
// - the grid as LINEs: each row boundary from top to bottom, then each column boundary from
//   left to right, a line running on across cells while its colour, lineweight and linetype do
//   not change and stopping where a merged range or a hidden edge interrupts it;
// - a zero-length LINE at the insertion point on layer Defpoints, colour 8 and lineweight 0,
//   which every AutoCAD table block ends with.
// Everything is ByBlock (colour, linetype, lineweight) unless the style or the cell states
// another, and lies on the table's layer, as AutoCAD writes it.
//
// Where the corpus does not settle it (noted in the PR as the common drafter expectation):
// - The row-type cell style borders follow AutoCAD 2008's Borders tab: the first row of a row
//   type takes its style's top border and the last its bottom, the rows between the inside
//   horizontal one; the first column takes the left border, the last the right, the columns
//   between the inside vertical one.
// - An edge two cells share is drawn by the cell below (or to the right) when that cell's format
//   overrides it, else by the cell above (or to the left) when that one's does, else by the
//   cell below's (right's) style.
// - A table whose style flows up (DXF 70 = 1) has its title row at the bottom and grows upwards
//   from the insertion point at its lower left corner.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import type { Handle } from '../model/handle';
import type {
  Color,
  LinetypeRef,
  Lineweight,
  TableBorderFormat,
  TableCell,
  TableCellBorder,
  TableCellStyle,
  TableGeometry,
  TableStyleRecord,
} from '../model/types';
import type { AnnotationPart } from './multileader';

/** The kind of row a table row is, by its table style. */
export type TableRowType = 'title' | 'header' | 'data';

/** A part of a table's block; `defpoint` marks the zero-length line on layer Defpoints. */
export type TablePart = AnnotationPart & { readonly defpoint?: true };

/** What drawing a table's block needs besides the table and its style. */
export interface TableDrawing {
  /** The text style of a cell whose cell style names none: the drawing's Standard. */
  readonly textStyle: Handle;
  /** A block cell's block extents about its base point; a block without any is left out. */
  readonly blockExtents?: (block: Handle) => Box | undefined;
}

/** The order of a table style's cell styles in the file (DXF and DWG before R2010). */
const STYLE_INDEX: Readonly<Record<TableRowType, number>> = { data: 0, title: 1, header: 2 };

/** Border index in a cell style: top, inside horizontal, bottom, left, inside vertical, right. */
const TOP = 0;
const INSIDE_H = 1;
const BOTTOM = 2;
const LEFT = 3;
const INSIDE_V = 4;
const RIGHT = 5;

const BY_BLOCK: Color = { kind: 'byBlock' };

/** The row type of each of `rows` rows: the title and header rows first unless suppressed. */
export function tableRowTypes(
  style: Pick<TableStyleRecord, 'suppressTitle' | 'suppressHeader'> | undefined,
  rows: number,
): TableRowType[] {
  const first: TableRowType[] = [];
  if (!style?.suppressTitle) first.push('title');
  if (!style?.suppressHeader) first.push('header');
  return Array.from({ length: rows }, (_, i) => first[i] ?? 'data');
}

/** The cell style rows of `type` take in `style`. */
export function rowCellStyle(
  style: TableStyleRecord | undefined,
  type: TableRowType,
): TableCellStyle | undefined {
  return style?.cellStyles[STYLE_INDEX[type]];
}

/**
 * The height AutoCAD gives a row of `lines` lines of `textHeight` text: 4/3 of the text height
 * a line, and a vertical cell margin above and below (AutoCAD 2024 Help, "Insert Table Dialog
 * Box": "the height of a line is based on the text height and the cell margin"). acadsharp's
 * sample tables hold it: a Standard title row, 0.25 text and 0.06 margins, is 0.4533 high.
 */
export function tableRowHeight(lines: number, textHeight: number, verticalMargin: number): number {
  return (lines * textHeight * 4) / 3 + 2 * verticalMargin;
}

/** The cell heading the merged range that covers each cell, `[row, column]`. */
function rangeHeads(g: TableGeometry): [number, number][][] {
  const heads = g.cells.map((row, i) => row.map((_, j): [number, number] => [i, j]));
  g.cells.forEach((row, i) =>
    row.forEach((c, j) => {
      if (c.merged) return;
      for (let r = i; r < Math.min(i + c.rowSpan, g.cells.length); r++) {
        for (let k = j; k < Math.min(j + c.columnSpan, row.length); k++) heads[r]![k] = [i, j];
      }
    }),
  );
  return heads;
}

/** Running sums of `sizes` from 0: the edges between them. */
function edges(sizes: readonly number[]): number[] {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1]! + s);
  return out;
}

interface Edge {
  readonly color: Color;
  readonly lineweight: Lineweight;
  readonly linetype: LinetypeRef;
}

const sameColor = (a: Color, b: Color): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameEdge = (a: Edge, b: Edge): boolean =>
  sameColor(a.color, b.color) && a.lineweight === b.lineweight && a.linetype === b.linetype;

/** The style border `b` with the cell's override `o` over it; undefined when hidden. */
function edgeOf(
  b: TableCellBorder | undefined,
  o: TableBorderFormat | undefined,
): Edge | undefined {
  if (o?.hidden) return undefined;
  if (b && !b.visible && !o) return undefined;
  return {
    color: o?.color ?? b?.color ?? BY_BLOCK,
    lineweight: o?.lineweight ?? b?.lineweight ?? 'ByBlock',
    linetype: 'ByBlock',
  };
}

/**
 * The parts of table `g`'s `*T` block, in block coordinates (see the head of this file), drawn
 * with `style`, the table's table style.
 */
export function tableParts(
  g: TableGeometry,
  style: TableStyleRecord | undefined,
  drawing: TableDrawing,
): TablePart[] {
  const rows = g.rowHeights.length;
  const columns = g.columnWidths.length;
  if (rows === 0 || columns === 0) return [];
  const up = style?.flowDirection === 1;
  const types = tableRowTypes(style, rows);
  const heads = rangeHeads(g);
  const xs = edges(g.columnWidths);
  // Row i spans [yBottom(i), yTop(i)]: downwards from 0 in a table that flows down; upwards
  // from 0, its first row lowest, in one that flows up.
  const sums = edges(g.rowHeights);
  const yTop = (i: number) => (up ? sums[i + 1]! : -sums[i]!);
  const yBottom = (i: number) => (up ? sums[i]! : -sums[i + 1]!);
  // The rows from the top down, as drawn.
  const visual = up ? [...Array(rows).keys()].reverse() : [...Array(rows).keys()];
  // The n-th row boundary from the top: above visual row n, or below the last one.
  const boundaryY = (n: number) => (n < rows ? yTop(visual[n]!) : yBottom(visual[rows - 1]!));
  const hMargin = g.overrides?.margins?.left ?? style?.horizontalMargin ?? 0;
  const vMargin = g.overrides?.margins?.top ?? style?.verticalMargin ?? 0;
  const cellStyle = (i: number) => rowCellStyle(style, types[i]!);

  const parts: TablePart[] = [];
  const ranges: {
    readonly i: number;
    readonly c: TableCell;
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
  }[] = [];
  g.cells.forEach((row, i) =>
    row.forEach((c, j) => {
      if (c.merged) return;
      const i1 = Math.min(i + c.rowSpan, rows) - 1;
      const j1 = Math.min(j + c.columnSpan, columns) - 1;
      ranges.push({
        i,
        c,
        x0: xs[j]!,
        x1: xs[j1 + 1]!,
        y0: Math.min(yBottom(i), yBottom(i1)),
        y1: Math.max(yTop(i), yTop(i1)),
      });
    }),
  );

  // Fills.
  for (const r of ranges) {
    const s = cellStyle(r.i);
    const fill =
      r.c.format?.background !== undefined ? r.c.format.background : s?.fillOn ? s.fillColor : null;
    if (!fill) continue;
    parts.push({
      geom: {
        kind: 'SOLID',
        corners: [
          { x: r.x0, y: r.y1 },
          { x: r.x0, y: r.y0 },
          { x: r.x1, y: r.y1 },
          { x: r.x1, y: r.y0 },
        ],
      },
      color: fill,
    });
  }

  // Contents: the text cells', then the block cells'.
  const contents = [
    ...ranges.filter((x) => x.c.type === 'text'),
    ...ranges.filter((x) => x.c.type === 'block'),
  ];
  for (const r of contents) {
    const s = cellStyle(r.i);
    const f = r.c.format;
    const alignment = f?.alignment ?? s?.alignment ?? 1;
    const ax = ((alignment - 1) % 3) - 1; // -1 left, 0 centre, 1 right
    const ay = 1 - Math.floor((alignment - 1) / 3); // 1 top, 0 middle, -1 bottom
    const hm = f?.margins?.left ?? hMargin;
    const vm = f?.margins?.top ?? vMargin;
    const centre = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
    // The cell as its contents see it: turned by the cell's rotation.
    const turned = Math.abs(Math.sin(r.c.rotation)) > 0.5;
    const w = turned ? r.y1 - r.y0 : r.x1 - r.x0;
    const h = turned ? r.x1 - r.x0 : r.y1 - r.y0;
    const local = { x: ax * (w / 2 - hm), y: ay * (h / 2 - vm) };
    const cos = Math.cos(r.c.rotation);
    const sin = Math.sin(r.c.rotation);
    const at = (p: Vec2): Vec2 => ({
      x: centre.x + p.x * cos - p.y * sin,
      y: centre.y + p.x * sin + p.y * cos,
    });
    const color = f?.contentColor ?? s?.textColor ?? BY_BLOCK;
    if (r.c.type === 'text') {
      if (r.c.text === '') continue;
      parts.push({
        geom: {
          kind: 'MTEXT',
          contents: r.c.text,
          style: f?.textStyle ?? s?.textStyle ?? drawing.textStyle,
          position: at(local),
          height: f?.textHeight ?? s?.textHeight ?? 0.18,
          width: Math.max(w - 2 * hm, 0),
          rotation: r.c.rotation,
          attachment: alignment,
          direction: 5,
          lineSpacingStyle: 1,
          lineSpacing: 1,
        },
        color,
      });
      continue;
    }
    const box = r.c.block !== undefined ? drawing.blockExtents?.(r.c.block) : undefined;
    if (!box || r.c.block === undefined) continue;
    const bw = box.maxX - box.minX;
    const bh = box.maxY - box.minY;
    const room = { x: w - 2 * hm, y: h - 2 * vm };
    const scale = Math.min(bw > 0 ? room.x / bw : Infinity, bh > 0 ? room.y / bh : Infinity);
    const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
    // The scaled extents' point the alignment names goes to the cell's.
    const anchor = {
      x: (ax < 0 ? box.minX : ax > 0 ? box.maxX : (box.minX + box.maxX) / 2) * k,
      y: (ay > 0 ? box.maxY : ay < 0 ? box.minY : (box.minY + box.maxY) / 2) * k,
    };
    parts.push({
      geom: {
        kind: 'INSERT',
        block: r.c.block,
        position: at({ x: local.x - anchor.x, y: local.y - anchor.y }),
        scale: { x: k, y: k, z: k },
        rotation: r.c.rotation,
      } as AnnotationPart['geom'],
      color,
    });
  }

  // The grid.
  const groupFirst = (i: number) => i === 0 || types[i - 1] !== types[i];
  const groupLast = (i: number) => i === rows - 1 || types[i + 1] !== types[i];
  type Side = 'top' | 'bottom' | 'left' | 'right';
  /**
   * The edge `side` of cell (i, j). A cell covered by a merged range keeps its own borders, which
   * draw the range's outline where it runs along that cell (acadsharp's sample tables).
   */
  const cellEdge = (i: number, j: number, side: Side): { edge?: Edge; overridden: boolean } => {
    const o = g.cells[i]![j]!.format?.borders?.[side];
    const index =
      side === 'top'
        ? groupFirst(i)
          ? TOP
          : INSIDE_H
        : side === 'bottom'
          ? groupLast(i)
            ? BOTTOM
            : INSIDE_H
          : side === 'left'
            ? j === 0
              ? LEFT
              : INSIDE_V
            : j === columns - 1
              ? RIGHT
              : INSIDE_V;
    const edge = edgeOf(cellStyle(i)?.borders[index], o);
    return { ...(edge && { edge }), overridden: o !== undefined };
  };
  /** The edge between `a` (above or left, if any) and `b` (below or right, if any). */
  const shared = (
    a: { edge?: Edge; overridden: boolean } | undefined,
    b: { edge?: Edge; overridden: boolean } | undefined,
  ): Edge | undefined => {
    if (b?.overridden) return b.edge;
    if (a?.overridden) return a.edge;
    return (b ?? a)?.edge;
  };
  const sameRange = (i: number, j: number, k: number, l: number) =>
    heads[i]![j]![0] === heads[k]![l]![0] && heads[i]![j]![1] === heads[k]![l]![1];

  /** Lines along one boundary from `segments` (each an edge or a gap), joined where alike. */
  const run = (
    segments: (Edge | undefined)[],
    line: (from: number, to: number) => TablePart['geom'],
  ) => {
    let from = 0;
    for (let k = 1; k <= segments.length; k++) {
      const a = segments[from];
      const b = segments[k];
      if (k < segments.length && a && b && sameEdge(a, b)) continue;
      if (k < segments.length && !a && !b) continue;
      if (a) {
        parts.push({
          geom: line(from, k),
          color: a.color,
          linetype: a.linetype,
          lineweight: a.lineweight,
        });
      }
      from = k;
    }
  };

  // Row boundaries from the top down, each from the left.
  for (let n = 0; n <= rows; n++) {
    const above = n > 0 ? visual[n - 1] : undefined;
    const below = n < rows ? visual[n] : undefined;
    const y = boundaryY(n);
    const segments = Array.from({ length: columns }, (_, j): Edge | undefined => {
      if (above !== undefined && below !== undefined && sameRange(above, j, below, j)) {
        return undefined;
      }
      return shared(
        above !== undefined ? cellEdge(above, j, 'bottom') : undefined,
        below !== undefined ? cellEdge(below, j, 'top') : undefined,
      );
    });
    run(segments, (from, to) => ({
      kind: 'LINE',
      start: { x: xs[from]!, y },
      end: { x: xs[to]!, y },
    }));
  }
  // Column boundaries from the left, each from the top down.
  for (let k = 0; k <= columns; k++) {
    const segments = visual.map((i): Edge | undefined => {
      if (k > 0 && k < columns && sameRange(i, k - 1, i, k)) return undefined;
      return shared(
        k > 0 ? cellEdge(i, k - 1, 'right') : undefined,
        k < columns ? cellEdge(i, k, 'left') : undefined,
      );
    });
    run(segments, (from, to) => ({
      kind: 'LINE',
      start: { x: xs[k]!, y: boundaryY(from) },
      end: { x: xs[k]!, y: boundaryY(to) },
    }));
  }
  parts.push({
    geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    color: { kind: 'aci', index: 8 },
    linetype: 'ByLayer',
    lineweight: 0,
    defpoint: true,
  });
  return parts;
}
