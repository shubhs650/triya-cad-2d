// TriyaToAcad for a new ACAD_TABLE (M1-75 part 32), what the TABLE command and COPY add: the
// grid AutoCAD builds for a table, and the table-wide overrides (DXF 93 and the values after it,
// DWG before R2010) a new table states. The cells' text, blocks, rotation, formats and merges are
// then written as for an edited table (entities.ts `tableWriter`, table-cells.ts).
//
// What AutoCAD writes for a table is taken from the corpus tables (acadsharp sample_AC1014 to
// sample_AC1032, DWG and DXF): DXF 90 is 22 on every one; a plain cell spans 1 × 1 (DXF 175 /
// 176); a cell nothing was typed into holds no value; a block cell's scale is 1 (DXF 144) and
// its value an empty string (R2007+ DWG). A DWG
// from R2010 gives each row the cell style of its row type (`_TITLE`, `_HEADER`, `_DATA` by the
// table style's ids) and states row, cell and table cell styles that override nothing.
//
// A DWG from R2010 states a cell's rotation and the table-wide overrides in cell styles and
// content formats, which are not written yet (M1-75): a new table there carries neither. Its
// cell formats go into each cell's own cell style, as an edited cell's do (table-cells.ts). DXF and DWG before R2010 state the overrides in one flag word with the values
// after it, by row type (title, header, data): a horizontal and a vertical margin, and each row
// type's text style, height, alignment, content colour and fill. acad-ts keeps a DXF table's
// override codes as read (DEC-043) and writes them back, so a new table gets the codes as
// AutoCAD writes them: 93 to 96 (the border overrides, 94 to 96, are not mapped: M1-81), then
// the values grouped by code, each code's row types in AcDb::RowType order (data, title, header).

import type { TableStyle } from '@node-projects/acad-ts';
import {
  ACadVersion,
  BlockRecord,
  CadValueType,
  CellContent,
  CellStyleType,
  CellType,
  TableCellContentType,
  TableEntityCell,
  TableEntityColumn,
  TableEntityRow,
  TableOverrideFlags,
  TableStyleOverrides,
  TextStyle,
  type TableEntity,
} from '@node-projects/acad-ts';
import type {
  Color,
  Handle,
  TableCell,
  TableGeometry,
  TableOverrides,
  TableRowFormat,
} from '@triya/engine';
import type { CadFormat } from '../read';
import { acadColor, resolve, type Resolver } from './entities';
import {
  cellStyleProblems,
  dwgFrom2010,
  formatFileProblems,
  formatValueProblems,
} from './table-cells';
import { colorProblems } from './table-styles';

/** DXF 90, the table value flag, on every corpus table (DXF and DWG before R2010). */
const VALUE_FLAG = 22;

const ROW_TYPES = ['title', 'header', 'data'] as const;
type RowType = (typeof ROW_TYPES)[number];

/** The row type of each row: the title and header rows first unless the style suppresses them. */
function rowTypes(style: TableStyle | null, rows: number): RowType[] {
  const first: RowType[] = [];
  if (!style?.suppressTitle) first.push('title');
  if (!style?.suppressHeaderRow) first.push('header');
  return Array.from({ length: rows }, (_, i) => first[i] ?? 'data');
}

/** The table style's cell style id of each row type (DWG R2010+), 1 to 3 when it lists none. */
function rowStyleIds(style: TableStyle | null): Record<RowType, number> {
  const ids = new Map((style?.cellStyles ?? []).map((c) => [c.name.toUpperCase(), c.id]));
  return {
    title: ids.get('_TITLE') ?? 1,
    header: ids.get('_HEADER') ?? 2,
    data: ids.get('_DATA') ?? 3,
  };
}

/**
 * The rows of a new table's grid, or of rows inserted where no row of the table is left to take
 * the style of (table-grid.ts): each on the cell style of its row type, by its place.
 */
export function newRows(style: TableStyle | null, count: number): TableEntityRow[] {
  const ids = rowStyleIds(style);
  return rowTypes(style, count).map((type) => {
    const row = new TableEntityRow();
    row.styleId = ids[type];
    row.cellStyleOverride.cellStyleType = CellStyleType.Row;
    row.cellStyleOverride.hasData = true;
    return row;
  });
}

/** A new column, `width` wide, its cell style overriding nothing. */
export function newColumn(width: number): TableEntityColumn {
  const column = new TableEntityColumn();
  column.width = width;
  column.cellStyleOverride.cellStyleType = CellStyleType.Column;
  return column;
}

/**
 * A new cell for `c`, as AutoCAD makes one: a cell style overriding nothing, and a block cell
 * holding a block content. Its value is written after, as for an edited cell.
 */
export function newCell(c: TableCell): TableEntityCell {
  const cell = new TableEntityCell();
  cell.styleOverride.cellStyleType = CellStyleType.Cell;
  cell.styleOverride.hasData = true;
  if (c.type === 'block') {
    cell.type = CellType.Block;
    cell.blockScale = 1;
    const content = new CellContent();
    content.contentType = TableCellContentType.Block;
    // AutoCAD states a block cell's value as an empty string (R2007+ DWG).
    content.cadValue.valueType = CadValueType.String;
    content.cadValue.isEmpty = true;
    cell.contents.push(content);
  }
  return cell;
}

/**
 * Builds the grid of a new table on `t` (whose style is set): its columns, rows and cells, a
 * block cell holding a block content, the rows' cell styles by row type. Values are written
 * after, as for an edited table.
 */
export function buildGrid(t: TableEntity, g: TableGeometry): void {
  t.valueFlag = VALUE_FLAG;
  t.content.cellStyleOverride.cellStyleType = CellStyleType.FormattedTableData;
  t.content.cellStyleOverride.hasData = true;
  for (const width of g.columnWidths) t.columns.push(newColumn(width));
  const rows = newRows(t.style, g.cells.length);
  for (const [i, cells] of g.cells.entries()) {
    const row = rows[i]!;
    for (const c of cells) row.cells.push(newCell(c));
    t.rows.push(row);
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────

const at = (i: number, j: number): string => `cell (${i}, ${j})`;

const ANONYMOUS_TABLE_BLOCK = /^\*T/i;

/**
 * Why `g` cannot be a new table, in whatever file: its block must be an anonymous `*T` block
 * (the one the TABLE command makes for it; that no other entity uses it is checked in
 * export.ts), and its overrides values AutoCAD takes.
 */
export function newTableProblems(r: Resolver, g: TableGeometry): string[] {
  const out: string[] = [];
  const block = g.block === undefined ? undefined : resolve(r, g.block, BlockRecord);
  if (block && (!block.isAnonymous || !ANONYMOUS_TABLE_BLOCK.test(block.name))) {
    out.push(`block ${g.block} is not an anonymous *T block (the TABLE command makes one)`);
  }
  const o = g.overrides;
  if (!o) return out;
  const m = o.margins;
  if (m) {
    for (const [side, v] of Object.entries(m)) {
      if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        out.push(`table margins: ${side} ${JSON.stringify(v)} is not a number of 0 or more`);
      }
    }
    // DXF 40 / 41 and the DWG fields state one horizontal and one vertical margin.
    if (m.left !== m.right) out.push('table margins: left and right differ');
    if (m.top !== m.bottom) out.push('table margins: top and bottom differ');
  }
  for (const type of ROW_TYPES) {
    const f = o[type];
    if (!f) continue;
    const cell = { format: f } as TableCell;
    out.push(...formatValueProblems(r, cell).map((p) => `${type} rows: ${p}`));
  }
  return out;
}

const COLORS: readonly ('contentColor' | 'background')[] = ['contentColor', 'background'];

/**
 * Why the file at hand cannot hold the new table `g`: a format before R14 (AutoCAD saves a table
 * to R14 and later; R12 has no custom objects), the rotations and table-wide overrides a DWG from
 * R2010 states in cell styles, and colours the format holds as ACI only.
 */
export function newTableFileProblems(
  g: TableGeometry,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
): string[] {
  const known = version !== undefined && version !== ACadVersion.Unknown;
  if (known && version < ACadVersion.AC1014) {
    return [`${ACadVersion[version]} holds no tables (AutoCAD saves them to R14 and later)`];
  }
  const styles = dwgFrom2010(format, version);
  const out: string[] = [];
  for (const [i, row] of g.cells.entries()) {
    for (const [j, c] of row.entries()) {
      out.push(
        ...formatFileProblems(undefined, c.format, version, format, styles).map(
          (p) => `${at(i, j)}: ${p}`,
        ),
      );
      // A new table's rows and columns override nothing, nor does its own cell style.
      if (styles) {
        out.push(
          ...cellStyleProblems(undefined, {}, undefined, c.format).map((p) => `${at(i, j)}: ${p}`),
        );
      }
      if (styles && c.rotation !== 0) {
        out.push(
          `${at(i, j)}: a cell rotation in a DWG from R2010, which keeps it in the content format`,
        );
      }
    }
  }
  const o = g.overrides;
  if (!o) return out;
  if (styles) {
    out.push('table overrides in a DWG from R2010, which states them in cell styles (M1-75)');
    return out;
  }
  for (const type of ROW_TYPES) {
    for (const k of COLORS) {
      const c = o[type]?.[k];
      if (!c) continue;
      for (const p of colorProblems(version, format, k, c)) {
        out.push(`${type} rows: ${p.replace('table style', 'table')}`);
      }
    }
  }
  return out;
}

// ── Table-wide overrides ───────────────────────────────────────────────────────────────────

type RowKey = 'contentColor' | 'fillNone' | 'fillColor' | 'alignment' | 'textStyle' | 'textHeight';

/**
 * Each row-type value with its title row bit (the header's and data's follow it, ODA spec) and
 * its DXF code, in the order AutoCAD lists them.
 */
const ROW_BITS: readonly [RowKey, TableOverrideFlags, number][] = [
  ['contentColor', TableOverrideFlags.TitleRowColor, 64],
  ['fillNone', TableOverrideFlags.TitleRowFillNone, 283],
  ['fillColor', TableOverrideFlags.TitleRowFillColor, 63],
  ['alignment', TableOverrideFlags.TitleRowAlign, 170],
  ['textStyle', TableOverrideFlags.TitleTextStyle, 7],
  ['textHeight', TableOverrideFlags.TitleRowHeight, 140],
];

/** Row types in the order DXF repeats a row-type code (AcDb::RowType: data, title, header). */
const DXF_ROW_ORDER: readonly RowType[] = ['data', 'title', 'header'];

const OFFSET: Record<RowType, number> = { title: 0, header: 1, data: 2 };

/** A row format's value for a ROW_BITS key, or undefined when it states none. */
function rowValue(
  r: Resolver,
  f: TableRowFormat | undefined,
  key: RowKey,
): number | string | TextStyle | Color | true | undefined {
  if (!f) return undefined;
  switch (key) {
    case 'fillNone':
      return f.background === null ? true : undefined;
    case 'fillColor':
      return f.background ?? undefined;
    case 'textStyle':
      return f.textStyle === undefined ? undefined : resolve(r, f.textStyle, TextStyle);
    default:
      return f[key];
  }
}

/**
 * Writes the table-wide overrides `o` of a new table: the flag word and values (DWG before
 * R2010) and the DXF codes acad-ts writes them from.
 */
export function writeTableOverrides(r: Resolver, t: TableEntity, o: TableOverrides): void {
  const s = new TableStyleOverrides();
  const codes: { code: number; value: unknown }[] = [];
  const h = o.margins?.left;
  const v = o.margins?.top;
  if (h !== undefined) {
    s.flags |= TableOverrideFlags.HorizontalCellMargin;
    s.horizontalCellMargin = h;
  }
  if (v !== undefined) {
    s.flags |= TableOverrideFlags.VerticalCellMargin;
    s.verticalCellMargin = v;
  }
  const values: [number, unknown][] = [];
  for (const [key, first, code] of ROW_BITS) {
    for (const type of DXF_ROW_ORDER) {
      const value = rowValue(r, o[type], key);
      if (value === undefined) continue;
      s.flags |= first << OFFSET[type];
      const row = s[type];
      switch (key) {
        case 'contentColor':
          row.contentColor = acadColor(value as Color);
          values.push([code, row.contentColor.getApproxIndex()]);
          break;
        case 'fillNone':
          row.fillNone = true;
          values.push([code, 1]);
          break;
        case 'fillColor':
          row.fillColor = acadColor(value as Color);
          values.push([code, row.fillColor.getApproxIndex()]);
          break;
        case 'alignment':
          row.alignment = value as number;
          values.push([code, value]);
          break;
        case 'textStyle':
          row.textStyle = value as TextStyle;
          values.push([code, (value as TextStyle).name]);
          break;
        case 'textHeight':
          row.textHeight = value as number;
          values.push([code, value]);
          break;
      }
    }
  }
  codes.push({ code: 93, value: s.flags }, ...[94, 95, 96].map((code) => ({ code, value: 0 })));
  if (h !== undefined) codes.push({ code: 40, value: h });
  if (v !== undefined) codes.push({ code: 41, value: v });
  codes.push(...values.map(([code, value]) => ({ code, value })));
  t.tableOverrides = s.flags === TableOverrideFlags.None ? null : s;
  t.tableOverrideDxfCodes = s.flags === TableOverrideFlags.None ? [] : codes;
}

/** The entity (other than `self`) whose block is `block`, if any: a table's `*T` is its own. */
export function blockUser(
  entities: Iterable<{ handle: Handle; type: string; geom: object }>,
  block: Handle,
  self: Handle,
): { handle: Handle; type: string } | undefined {
  for (const e of entities) {
    if (e.handle !== self && (e.geom as { block?: Handle }).block === block) return e;
  }
  return undefined;
}
