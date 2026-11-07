// TriyaToAcad for a table's merged cells and cell formats (M1-75 part 26), the inverse of the
// cell part of map/entities.ts `tableGeometry`: what Merge Cells and Unmerge Cells do, and what
// the Table Cell ribbon's Cell Styles panel sets on one cell (alignment, text style and height,
// content colour, background fill, the edges' colour, lineweight and visibility).
//
// A merge is stated two ways. DXF and DWG before R2010 state it per cell: the head cell's
// spans (DXF 175 columns, 176 rows) and a merged flag on every cell it covers (DXF 173), the
// covered cells keeping spans of 1, as every AutoCAD-saved corpus table shows. DWG R2010+ states
// the table's merged ranges (top, left, bottom, right). Both are written, so a save to either
// kind of file states the merge; ranges still in the table keep their place in the list.
//
// A cell format is written into the cell's override flag word and the values beside it (DXF 177
// before R2007 and 91 from it, DWG before R2010), which already fold in the row's and column's
// overrides: a property set gets its flag and value, a property cleared loses its flag. What
// the format at hand cannot state is refused (margins outside DWG R2010+, ACI-only colours, DXF
// edge visibility).
//
// DWG R2010+ keeps overrides apart, in the cell's content format and the cell, row and column
// cell styles (AcDb::CellProperty and AcDb::GridProperty bits), folded content over cell over
// row over column (map/entities.ts `tableCellFormat`). A format change there is written into
// the cell's own cell style (M1-75 part 36), as the Table Cell ribbon sets a cell's properties,
// except a content property the content format already overrides, which is changed there since
// the content format wins (AutoCAD's in-place editor sets text height and colour per content).
// A property the cell no longer overrides loses its bit in both. One the cell's row or column
// states cannot be taken off one cell (the cell would show the row's), so that is refused; an
// edge shown again keeps its visibility bit with the edge visible, which shows it whatever the
// row says.

import {
  CellOverrideFlags,
  CellRange,
  CellStyleType,
  Color as AcadColor,
  MarginFlags,
  TableBorderPropertyFlags,
  TableCellContentLayoutFlags,
  TableCellStylePropertyFlags,
  TextStyle,
  ACadVersion,
  type CellBorder,
  type TableEntity,
  type TableEntityCell,
} from '@node-projects/acad-ts';
import type {
  Color,
  TableBorderFormat,
  TableCell,
  TableCellFormat,
  TableGeometry,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { acadColor, acadLineweight, resolve, same, type Resolver } from './entities';
import { colorProblems, LINEWEIGHTS } from './table-styles';

type Edge = 'top' | 'right' | 'bottom' | 'left';
const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/** Each edge's colour, lineweight and visibility bits in the flag word (ODA spec, TABLE). */
const EDGE_FLAGS: Record<Edge, { color: number; lineweight: number; visibility: number }> = {
  top: {
    color: CellOverrideFlags.TopGridColor,
    lineweight: CellOverrideFlags.TopGridLineWeight,
    visibility: CellOverrideFlags.TopVisibility,
  },
  right: {
    color: CellOverrideFlags.RightGridColor,
    lineweight: CellOverrideFlags.RightGridLineWeight,
    visibility: CellOverrideFlags.RightVisibility,
  },
  bottom: {
    color: CellOverrideFlags.BottomGridColor,
    lineweight: CellOverrideFlags.BottomGridLineWeight,
    visibility: CellOverrideFlags.BottomVisibility,
  },
  left: {
    color: CellOverrideFlags.LeftGridColor,
    lineweight: CellOverrideFlags.LeftGridLineWeight,
    visibility: CellOverrideFlags.LeftVisibility,
  },
};

/** Whether a save to `format` in `version` states cell formats in cell styles: DWG from R2010. */
export const dwgFrom2010 = (
  format: CadFormat | undefined,
  version: ACadVersion | undefined,
): boolean => format === 'dwg' && version !== undefined && version >= ACadVersion.AC1024;

const isWhole = (n: unknown, min: number, max = Infinity): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

const at = (i: number, j: number): string => `cell (${i}, ${j})`;

/** Whether any cell's spans or merged flag differ between `before` and `after`. */
export function mergesChange(before: TableGeometry, after: TableGeometry): boolean {
  return after.cells.some((row, i) =>
    row.some((a, j) => {
      const b = before.cells[i]?.[j];
      return (
        !b || a.rowSpan !== b.rowSpan || a.columnSpan !== b.columnSpan || a.merged !== b.merged
      );
    }),
  );
}

/** The merged ranges `g` states: one per head cell spanning more than itself, row by row. */
function rangesOf(
  g: TableGeometry,
): { top: number; left: number; bottom: number; right: number }[] {
  const out = [];
  for (const [i, row] of g.cells.entries()) {
    for (const [j, c] of row.entries()) {
      if (c.rowSpan > 1 || c.columnSpan > 1) {
        out.push({ top: i, left: j, bottom: i + c.rowSpan - 1, right: j + c.columnSpan - 1 });
      }
    }
  }
  return out;
}

/**
 * Why the merges of `g` cannot be what AutoCAD makes: each head cell spans a rectangle inside
 * the table, every other cell of it is marked merged with spans of 1, no cell is in two, and a
 * cell marked merged is inside one. The grid is `g`'s rows by columns.
 */
export function mergeProblems(g: TableGeometry): string[] {
  const out: string[] = [];
  const rows = g.cells.length;
  const columns = g.columnWidths.length;
  const owner = new Map<string, string>();
  for (const [i, row] of g.cells.entries()) {
    for (const [j, c] of row.entries()) {
      for (const k of ['rowSpan', 'columnSpan'] as const) {
        if (!isWhole(c[k], 1)) {
          out.push(`${at(i, j)}: ${k} ${JSON.stringify(c[k])} is not a whole number of 1 or more`);
        }
      }
    }
  }
  if (out.length > 0) return out;
  for (const r of rangesOf(g)) {
    const head = at(r.top, r.left);
    if (g.cells[r.top]![r.left]!.merged) out.push(`${head} heads a merge but is marked merged`);
    if (r.bottom >= rows || r.right >= columns) {
      out.push(`${head}: its merge runs off the table`);
      continue;
    }
    for (let i = r.top; i <= r.bottom; i++) {
      for (let j = r.left; j <= r.right; j++) {
        const key = `${i},${j}`;
        const other = owner.get(key);
        if (other !== undefined) out.push(`${at(i, j)} is in the merges of ${other} and ${head}`);
        owner.set(key, head);
        if (i === r.top && j === r.left) continue;
        const c = g.cells[i]![j]!;
        if (!c.merged) out.push(`${at(i, j)} is in the merge of ${head} but not marked merged`);
      }
    }
  }
  for (const [i, row] of g.cells.entries()) {
    for (const [j, c] of row.entries()) {
      if (c.merged && !owner.has(`${i},${j}`)) {
        out.push(`${at(i, j)} is marked merged but no merge covers it`);
      }
    }
  }
  return out;
}

/**
 * Writes the merges of `g` onto `t`: every changed cell's spans and flag (every cell of a new
 * table, `before` undefined), and the ranges.
 */
export function writeMerges(
  t: TableEntity,
  before: TableGeometry | undefined,
  g: TableGeometry,
): void {
  for (const [i, row] of g.cells.entries()) {
    for (const [j, a] of row.entries()) {
      const b = before?.cells[i]?.[j];
      if (b && a.rowSpan === b.rowSpan && a.columnSpan === b.columnSpan && a.merged === b.merged) {
        continue;
      }
      const cell = t.rows[i]!.cells[j]!;
      cell.borderWidth = a.columnSpan;
      cell.borderHeight = a.rowSpan;
      cell.mergedValue = a.merged ? 1 : 0;
    }
  }
  const key = (r: { top: number; left: number; bottom: number; right: number }) =>
    `${r.top},${r.left},${r.bottom},${r.right}`;
  const wanted = new Map(rangesOf(g).map((r) => [key(r), r]));
  const kept = t.mergedCellRanges.filter((r) => {
    const k = key({
      top: r.topRowIndex,
      left: r.leftColumnIndex,
      bottom: r.bottomRowIndex,
      right: r.rightColumnIndex,
    });
    return wanted.delete(k);
  });
  for (const r of wanted.values()) {
    const range = new CellRange();
    range.topRowIndex = r.top;
    range.leftColumnIndex = r.left;
    range.bottomRowIndex = r.bottom;
    range.rightColumnIndex = r.right;
    kept.push(range);
  }
  t.mergedCellRanges.splice(0, t.mergedCellRanges.length, ...kept);
}

// ── Cell formats ───────────────────────────────────────────────────────────────────────────

/** Why a cell format's values are not ones AutoCAD takes, in whatever file. */
export function formatValueProblems(r: Resolver, cell: TableCell, was?: TableCell): string[] {
  const f = cell.format;
  const b = was?.format;
  if (!f || same(f, b)) return [];
  const out: string[] = [];
  const changed = (k: keyof TableCellFormat): boolean => !same(f[k], b?.[k]);
  if (changed('alignment') && f.alignment !== undefined && !isWhole(f.alignment, 1, 9)) {
    out.push(`alignment ${JSON.stringify(f.alignment)} is not 1 to 9`);
  }
  if (
    changed('textHeight') &&
    f.textHeight !== undefined &&
    !(typeof f.textHeight === 'number' && Number.isFinite(f.textHeight) && f.textHeight > 0)
  ) {
    out.push(`textHeight ${JSON.stringify(f.textHeight)} is not a number more than 0`);
  }
  if (changed('textStyle') && f.textStyle !== undefined && !resolve(r, f.textStyle, TextStyle)) {
    out.push(`text style ${f.textStyle} does not exist`);
  }
  for (const side of EDGES) {
    const e = f.borders?.[side];
    const w = e?.lineweight;
    if (w === undefined || same(w, b?.borders?.[side]?.lineweight)) continue;
    const named = w === 'ByLayer' || w === 'ByBlock' || w === 'Default';
    if (!named && !LINEWEIGHTS.includes(w)) {
      out.push(`${side} border lineweight ${JSON.stringify(w)} is not a lineweight`);
    }
  }
  return out;
}

/** The colours a format sets, by the property name a problem reports. */
function colorsOf(f: TableCellFormat | undefined): [string, Color | null | undefined][] {
  return [
    ['contentColor', f?.contentColor],
    ['background', f?.background],
    ...EDGES.map((s): [string, Color | undefined] => [`${s} border color`, f?.borders?.[s]?.color]),
  ];
}

/**
 * Why the format change from `b` to `a` cannot be written to the file at hand (`dwgFrom2010`:
 * a DWG from R2010, which states it in cell styles; `cellStyleProblems` checks those).
 */
export function formatFileProblems(
  b: TableCellFormat | undefined,
  a: TableCellFormat | undefined,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  dwgFrom2010: boolean,
): string[] {
  if (same(a, b)) return [];
  const out: string[] = [];
  if (!dwgFrom2010 && !same(a?.margins, b?.margins) && a?.margins !== undefined) {
    out.push('cell margins, which only a DWG from R2010 states per cell');
  }
  const was = new Map(colorsOf(b));
  for (const [k, c] of colorsOf(a)) {
    if (c === undefined || c === null || same(c, was.get(k))) continue;
    // DXF 63–69 are ACI codes; acad-ts writes a DWG cell's colour before R2004 as an index.
    for (const p of colorProblems(version, format, k, c)) {
      out.push(p.replace('table style', 'table cell'));
    }
  }
  if (format === 'dxf') {
    for (const side of EDGES) {
      if (a?.borders?.[side]?.hidden && !b?.borders?.[side]?.hidden) {
        out.push(`a hidden ${side} edge, which acad-ts cannot write to DXF (M1-81)`);
      }
    }
  }
  return out;
}

function borderOf(cell: TableEntityCell, side: Edge): CellBorder {
  const s = cell.styleOverride;
  return side === 'top'
    ? s.topBorder
    : side === 'right'
      ? s.rightBorder
      : side === 'bottom'
        ? s.bottomBorder
        : s.leftBorder;
}

/**
 * Writes the format change from `b` to `a` into `cell`'s override flag word and values. A
 * background colour clears a "no fill" the cell stated (DXF 283, acad-ts `isFillColorOn`, 1 being
 * no fill); a visibility flag left on with the edge shown states nothing, as AutoCAD sets it
 * beside every colour and lineweight override.
 */
export function writeCellFormat(
  r: Resolver,
  cell: TableEntityCell,
  b: TableCellFormat | undefined,
  a: TableCellFormat | undefined,
): void {
  const s = cell.styleOverride;
  let flags = cell.overrideFlags as number;
  const set = (flag: number, on: boolean): void => {
    flags = on ? flags | flag : flags & ~flag;
  };
  const changed = (k: keyof TableCellFormat): boolean => !same(a?.[k], b?.[k]);
  if (changed('alignment')) {
    set(CellOverrideFlags.CellAlignment, a?.alignment !== undefined);
    if (a?.alignment !== undefined) s.cellAlignment = a.alignment;
  }
  if (changed('textStyle')) {
    set(CellOverrideFlags.TextStyle, a?.textStyle !== undefined);
    if (a?.textStyle !== undefined) s.textStyle = resolve(r, a.textStyle, TextStyle)!;
  }
  if (changed('textHeight')) {
    set(CellOverrideFlags.TextHeight, a?.textHeight !== undefined);
    if (a?.textHeight !== undefined) s.textHeight = a.textHeight;
  }
  if (changed('contentColor')) {
    set(CellOverrideFlags.ContentColor, a?.contentColor !== undefined);
    if (a?.contentColor !== undefined) s.contentColor = acadColor(a.contentColor);
  }
  if (changed('background')) {
    const bg = a?.background;
    if (bg === undefined) {
      set(CellOverrideFlags.BackgroundColor | CellOverrideFlags.BackgroundFillNone, false);
    } else if (bg === null) {
      set(CellOverrideFlags.BackgroundFillNone, true);
      s.isFillColorOn = true;
    } else {
      set(CellOverrideFlags.BackgroundColor, true);
      s.backgroundColor = acadColor(bg);
      if (flags & CellOverrideFlags.BackgroundFillNone) s.isFillColorOn = false;
    }
  }
  for (const side of EDGES) {
    const was: TableBorderFormat | undefined = b?.borders?.[side];
    const now: TableBorderFormat | undefined = a?.borders?.[side];
    if (same(was, now)) continue;
    const border = borderOf(cell, side);
    const bits = EDGE_FLAGS[side];
    if (!same(was?.color, now?.color)) {
      set(bits.color, now?.color !== undefined);
      if (now?.color !== undefined) border.color = acadColor(now.color);
    }
    if (!same(was?.lineweight, now?.lineweight)) {
      set(bits.lineweight, now?.lineweight !== undefined);
      if (now?.lineweight !== undefined)
        border.lineWeight = acadLineweight(now.lineweight) as never;
    }
    if (!!was?.hidden !== !!now?.hidden) {
      if (now?.hidden) set(bits.visibility, true);
      border.isInvisible = !!now?.hidden;
    }
  }
  cell.overrideFlags = flags as CellOverrideFlags;
}

// ── Cell formats in cell styles (DWG R2010+, M1-75 part 36) ────────────────────────────────

const P = TableCellStylePropertyFlags;

/** The content properties, with their bit in a cell style or content format. */
const CONTENT_PROPS: readonly [
  'alignment' | 'contentColor' | 'textStyle' | 'textHeight',
  number,
][] = [
  ['alignment', P.Alignment],
  ['contentColor', P.ContentColor],
  ['textStyle', P.TextStyle],
  ['textHeight', P.TextHeight],
];

type Side = 'left' | 'top' | 'right' | 'bottom';
const MARGIN_PROPS: readonly [Side, number][] = [
  ['left', P.MarginLeft],
  ['top', P.MarginTop],
  ['right', P.MarginRight],
  ['bottom', P.MarginBottom],
];

/**
 * Why the format change from `b` to `a` cannot be written into a DWG R2010+ cell's cell styles:
 * `inherited` is what the cell's row and column cell styles give it (nothing for a new table),
 * `tableMargins` the margins of the table's own cell style. A property the cell stops
 * overriding that its row or column states would come back from there; a margin equal to the
 * table's maps as no override, and one below 0 is not a margin.
 */
export function cellStyleProblems(
  inherited: TableCellFormat | undefined,
  tableMargins: NonNullable<TableCellFormat['margins']>,
  b: TableCellFormat | undefined,
  a: TableCellFormat | undefined,
): string[] {
  if (same(a, b)) return [];
  const out: string[] = [];
  const kept = (what: string) =>
    out.push(
      `${what} is its row's or column's (their cell styles), which one cell cannot take off`,
    );
  for (const k of ['alignment', 'contentColor', 'textStyle', 'textHeight', 'background'] as const) {
    if (b?.[k] !== undefined && a?.[k] === undefined && inherited?.[k] !== undefined) kept(k);
  }
  for (const [side] of MARGIN_PROPS) {
    const v = a?.margins?.[side];
    const was = b?.margins?.[side];
    if (same(v, was)) continue;
    if (v === undefined) {
      if (inherited?.margins?.[side] !== undefined) kept(`the ${side} margin`);
    } else if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      out.push(`${side} margin ${JSON.stringify(v)} is not a number of 0 or more`);
    } else if (v === tableMargins[side]) {
      out.push(`${side} margin ${v} is the table's own, which a cell states by not overriding it`);
    }
  }
  for (const side of EDGES) {
    const was = b?.borders?.[side];
    const now = a?.borders?.[side];
    for (const k of ['color', 'lineweight'] as const) {
      if (was?.[k] !== undefined && now?.[k] === undefined) {
        if (inherited?.borders?.[side]?.[k] !== undefined) kept(`the ${side} border ${k}`);
      }
    }
  }
  return out;
}

/**
 * Writes the format change from `b` to `a` into a DWG R2010+ cell: its content format where that
 * overrides a content property already, its own cell style otherwise. A cell style that stated
 * nothing is begun as AutoCAD writes one overriding nothing (every corpus R2010+ cell style:
 * content flowing, background None, scale 1, data type unknown 512).
 */
export function writeCellStyleFormat(
  r: Resolver,
  cell: TableEntityCell,
  b: TableCellFormat | undefined,
  a: TableCellFormat | undefined,
): void {
  const s = cell.styleOverride;
  if (!s.hasData) {
    s.hasData = true;
    s.cellStyleType = CellStyleType.Cell;
    s.contentLayoutFlags = TableCellContentLayoutFlags.Flow;
    s.backgroundColor = AcadColor.byEntity;
    s.scale = 1;
    s.valueDataType = 512;
  }
  let own = s.cellPropertyOverrideFlags ?? 0;
  const content = cell.content?.format;
  const changed = (k: keyof TableCellFormat): boolean => !same(a?.[k], b?.[k]);
  for (const [k, bit] of CONTENT_PROPS) {
    if (!changed(k)) continue;
    const v = a?.[k];
    if (v === undefined) {
      own &= ~bit;
      if (content?.hasData) content.propertyOverrideFlags &= ~bit;
      continue;
    }
    const inContent = content?.hasData && (content.propertyOverrideFlags & bit) !== 0;
    const target = inContent ? content! : s;
    if (!inContent) own |= bit;
    if (k === 'alignment') target.alignment = v as number;
    if (k === 'textHeight') target.textHeight = v as number;
    if (k === 'contentColor') target.color = acadColor(v as Color);
    if (k === 'textStyle') target.textStyle = resolve(r, v as string, TextStyle)!;
  }
  if (changed('background')) {
    const bg = a?.background;
    if (bg === undefined) own &= ~P.BackgroundColor;
    else {
      own |= P.BackgroundColor;
      // No fill is the colour method None, ACI 257 to acad-ts (patch 0120).
      s.backgroundColor = bg === null ? AcadColor.byEntity : acadColor(bg);
    }
  }
  for (const [side, bit] of MARGIN_PROPS) {
    if (same(a?.margins?.[side], b?.margins?.[side])) continue;
    const v = a?.margins?.[side];
    if (v === undefined) {
      own &= ~bit;
      continue;
    }
    own |= bit;
    s.marginOverrideFlags |= MarginFlags.Override;
    if (side === 'left') s.horizontalMargin = v;
    if (side === 'top') s.verticalMargin = v;
    if (side === 'right') s.rightMargin = v;
    if (side === 'bottom') s.bottomMargin = v;
  }
  const B = TableBorderPropertyFlags;
  for (const side of EDGES) {
    const was: TableBorderFormat | undefined = b?.borders?.[side];
    const now: TableBorderFormat | undefined = a?.borders?.[side];
    if (same(was, now)) continue;
    const border = borderOf(cell, side);
    const set = (bit: number, on: boolean): void => {
      border.propertyOverrideFlags = on
        ? border.propertyOverrideFlags | bit
        : border.propertyOverrideFlags & ~bit;
    };
    if (!same(was?.color, now?.color)) {
      set(B.Color, now?.color !== undefined);
      if (now?.color !== undefined) border.color = acadColor(now.color);
    }
    if (!same(was?.lineweight, now?.lineweight)) {
      set(B.LineWeight, now?.lineweight !== undefined);
      if (now?.lineweight !== undefined)
        border.lineWeight = acadLineweight(now.lineweight) as never;
    }
    if (!!was?.hidden !== !!now?.hidden) {
      set(B.Invisibility, true);
      border.isInvisible = !!now?.hidden;
    }
  }
  s.cellPropertyOverrideFlags = own;
}
