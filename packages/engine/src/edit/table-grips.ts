// A table's grips (M4-05 part 4), after AutoCAD 2024 Help ("About Modifying Tables"): the
// insertion point moves the table; the corner across the top from it changes the table's width,
// its columns in proportion; the corner below it (above, in a table that flows up) the height,
// its rows in proportion; the corner opposite both; and a grip at the top of each line between
// two columns changes the width of the columns on either side, the table keeping its width ("only
// the row or column adjacent to the grip you have selected will change. The table will maintain
// its height or width"). Ctrl with a column grip, which resizes the table instead, and the table
// breaking grip are not done yet.
//
// A drag is read along the table's own axes. A row is not made lower than one line of its text
// and its margins, nor a column narrower than its two margins (AutoCAD keeps a table's cells
// round their contents; its Help gives no minimum, so this is the common expectation); a row
// laid out in more lines than one keeps the height a drag gives it, as only the renderer
// measures text (the cell editor fits rows as text is typed).
import type { Vec2 } from '../geom/types';
import type { EntityGeometry, TableGeometry, TableStyleRecord } from '../model/types';
import { rowCellStyle, tableCellBox, tableCellStyleNames, tableParts } from '../annotation/table';
import { tableAxes } from '../spatial/entity-bounds';
import { tableToPlan } from './table';

/**
 * What a table grip sizes: its width, height, both, or the columns either side of line `k`; or,
 * a grip of the cells selected (M4-05 part 6), column `j` or row `i` by its edge that `start`s
 * it (the left, or the one towards the first row) or the one that ends it.
 */
export type TableGripRole =
  | { readonly kind: 'width' }
  | { readonly kind: 'height' }
  | { readonly kind: 'size' }
  | { readonly kind: 'column'; readonly k: number }
  | { readonly kind: 'cellColumn'; readonly j: number; readonly start: boolean }
  | { readonly kind: 'cellRow'; readonly i: number; readonly start: boolean };

/** What a table's grips need of its table style: which way it flows and its sizes. */
export type TableGripStyle = TableStyleRecord | undefined;

const sum = (a: readonly number[]) => a.reduce((s, x) => s + x, 0);

/** The sizing grips of table `g` (its insertion point's aside), in plan. */
export function tableGrips(
  g: TableGeometry,
  style: TableGripStyle,
): { point: Vec2; role: TableGripRole }[] {
  const w = sum(g.columnWidths);
  const h = sum(g.rowHeights);
  if (g.columnWidths.length === 0 || g.rowHeights.length === 0) return [];
  // The other edge of the rows: below the insertion point, above it in a table flowing up.
  const across = style?.flowDirection === 1 ? h : -h;
  const out: { point: Vec2; role: TableGripRole }[] = [
    { point: tableToPlan(g, { x: w, y: 0 }), role: { kind: 'width' } },
    { point: tableToPlan(g, { x: 0, y: across }), role: { kind: 'height' } },
    { point: tableToPlan(g, { x: w, y: across }), role: { kind: 'size' } },
  ];
  // The column grips along the top edge: where the rows start, the bottom in a table flowing up.
  const top = style?.flowDirection === 1 ? h : 0;
  let x = 0;
  for (let k = 1; k < g.columnWidths.length; k++) {
    x += g.columnWidths[k - 1]!;
    out.push({ point: tableToPlan(g, { x, y: top }), role: { kind: 'column', k } });
  }
  return out;
}

/**
 * The grips of table `g`'s cells in range `r` (TABLECELL, M4-05 part 6), in plan: the middles of
 * the selection's top, right, bottom and left edges.
 */
export function tableCellGrips(
  g: TableGeometry,
  style: TableGripStyle,
  r: { readonly r0: number; readonly c0: number; readonly r1: number; readonly c1: number },
): { point: Vec2; role: TableGripRole }[] {
  const b = tableCellBox(g, style, r);
  const up = style?.flowDirection === 1;
  const x = (b.minX + b.maxX) / 2;
  const y = (b.minY + b.maxY) / 2;
  // The top edge starts the selection's rows in a table flowing down, ends them flowing up.
  const top: TableGripRole = up
    ? { kind: 'cellRow', i: r.r1, start: false }
    : { kind: 'cellRow', i: r.r0, start: true };
  const bottom: TableGripRole = up
    ? { kind: 'cellRow', i: r.r0, start: true }
    : { kind: 'cellRow', i: r.r1, start: false };
  return [
    { point: tableToPlan(g, { x, y: b.maxY }), role: top },
    {
      point: tableToPlan(g, { x: b.maxX, y }),
      role: { kind: 'cellColumn', j: r.c1, start: false },
    },
    { point: tableToPlan(g, { x, y: b.minY }), role: bottom },
    { point: tableToPlan(g, { x: b.minX, y }), role: { kind: 'cellColumn', j: r.c0, start: true } },
  ];
}

/** The lowest each row may be: one line of its tallest text and its margins. */
function rowMinimums(g: TableGeometry, style: TableGripStyle): number[] {
  const types = tableCellStyleNames(g, style);
  const vm = g.overrides?.margins?.top ?? style?.verticalMargin ?? 0;
  return g.cells.map((row, i) => {
    let need = 0;
    for (const [j, c] of row.entries()) {
      if (c.merged || c.rowSpan > 1) continue;
      const th = c.format?.textHeight ?? rowCellStyle(style, types[i]![j]!)?.textHeight ?? 0.18;
      need = Math.max(need, th + 2 * (c.format?.margins?.top ?? vm));
    }
    return need;
  });
}

/** The narrowest a column may be: its two margins, or a sliver where it has none. */
function columnMinimum(g: TableGeometry, style: TableGripStyle): number {
  const hm = g.overrides?.margins?.left ?? style?.horizontalMargin ?? 0;
  return hm > 0 ? 2 * hm : 1e-6 * Math.max(1, sum(g.columnWidths));
}

/**
 * `sizes` scaled to add up to `total`, none below its minimum: those that would be take it, and
 * the rest share what is left in proportion.
 */
function scaledTo(sizes: readonly number[], total: number, min: readonly number[]): number[] {
  const fixed = new Set<number>();
  for (;;) {
    const free = sizes.map((_, i) => i).filter((i) => !fixed.has(i));
    const left = total - [...fixed].reduce((a, i) => a + min[i]!, 0);
    const k = left / free.reduce((a, i) => a + sizes[i]!, 0);
    const low = free.filter((i) => !(sizes[i]! * k >= min[i]!));
    if (low.length === 0 || low.length === free.length) {
      return sizes.map((s, i) => (fixed.has(i) ? min[i]! : Math.max(s * k, min[i]!)));
    }
    for (const i of low) fixed.add(i);
  }
}

/**
 * Table `g` with its grip `role` dragged by `d` (plan), or undefined when the drag changes
 * nothing. `ctrl`: Ctrl is held, with which a column grip sizes the table (M4-05 part 6).
 */
export function movedTableGrip(
  g: TableGeometry,
  style: TableGripStyle,
  role: TableGripRole,
  d: Vec2,
  ctrl = false,
): TableGeometry | undefined {
  const { x, y } = tableAxes(g);
  const dx = d.x * x.x + d.y * x.y;
  const dy = d.x * y.x + d.y * y.y;
  const up = style?.flowDirection === 1;
  const cmin = columnMinimum(g, style);
  const widths = g.columnWidths;
  const heights = g.rowHeights;
  let columnWidths = widths;
  let rowHeights = heights;
  if (role.kind === 'width' || role.kind === 'size') {
    columnWidths = scaledTo(
      widths,
      Math.max(sum(widths) + dx, cmin * widths.length),
      widths.map(() => cmin),
    );
  }
  if (role.kind === 'height' || role.kind === 'size') {
    const min = rowMinimums(g, style);
    rowHeights = scaledTo(heights, Math.max(sum(heights) + (up ? dy : -dy), sum(min)), min);
  }
  let position = g.position;
  if (role.kind === 'column' && ctrl) {
    columnWidths = widths.map((w, i) => (i === role.k - 1 ? Math.max(w + dx, cmin) : w));
  } else if (role.kind === 'column') {
    const a = widths[role.k - 1]!;
    const b = widths[role.k]!;
    // As far as the drag goes while both columns keep their minimum.
    const move = Math.min(Math.max(dx, cmin - a), b - cmin);
    if (!(a + move >= cmin && b - move >= cmin)) return undefined;
    columnWidths = widths.map((w, i) =>
      i === role.k - 1 ? a + move : i === role.k ? b - move : w,
    );
  }
  if (role.kind === 'cellColumn') {
    const w = widths[role.j]!;
    const grown = Math.max(w + (role.start ? -dx : dx), cmin) - w;
    columnWidths = widths.map((v, i) => (i === role.j ? w + grown : v));
    if (role.start) position = tableToPlan(g, { x: -grown, y: 0 });
  }
  if (role.kind === 'cellRow') {
    // Rows follow one another down the table's y axis, up it in a table flowing up.
    const along = up ? 1 : -1;
    const h = heights[role.i]!;
    const e = (role.start ? -dy : dy) * along;
    const grown = Math.max(h + e, rowMinimums(g, style)[role.i]!) - h;
    rowHeights = heights.map((v, i) => (i === role.i ? h + grown : v));
    if (role.start) position = tableToPlan(g, { x: 0, y: -grown * along });
  }
  const same = (p: readonly number[], q: readonly number[]) => p.every((v, i) => v === q[i]);
  if (same(columnWidths, widths) && same(rowHeights, heights)) return undefined;
  return { ...g, position, columnWidths, rowHeights };
}

/**
 * The lines of table `g`'s grid, in plan: what a drag of its grips shows, as AutoCAD shows the
 * table's lines while it is resized.
 */
export function tableGridLines(g: TableGeometry, style: TableGripStyle): EntityGeometry[] {
  return tableParts(g, style, { textStyle: '' }).flatMap((p) =>
    !p.defpoint && p.geom.kind === 'LINE'
      ? [{ ...p.geom, start: tableToPlan(g, p.geom.start), end: tableToPlan(g, p.geom.end) }]
      : [],
  );
}
