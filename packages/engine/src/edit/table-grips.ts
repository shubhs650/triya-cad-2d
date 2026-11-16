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
import { rowCellStyle, tableParts, tableRowTypes } from '../annotation/table';
import { tableAxes } from '../spatial/entity-bounds';
import { tableToPlan } from './table';

/** What a table grip sizes: its width, height, both, or the columns either side of line `k`. */
export type TableGripRole =
  | { readonly kind: 'width' }
  | { readonly kind: 'height' }
  | { readonly kind: 'size' }
  | { readonly kind: 'column'; readonly k: number };

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

/** The lowest each row may be: one line of its tallest text and its margins. */
function rowMinimums(g: TableGeometry, style: TableGripStyle): number[] {
  const types = tableRowTypes(style, g.cells.length);
  const vm = g.overrides?.margins?.top ?? style?.verticalMargin ?? 0;
  return g.cells.map((row, i) => {
    let need = 0;
    for (const c of row) {
      if (c.merged || c.rowSpan > 1) continue;
      const th = c.format?.textHeight ?? rowCellStyle(style, types[i]!)?.textHeight ?? 0.18;
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
 * nothing.
 */
export function movedTableGrip(
  g: TableGeometry,
  style: TableGripStyle,
  role: TableGripRole,
  d: Vec2,
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
  if (role.kind === 'column') {
    const a = widths[role.k - 1]!;
    const b = widths[role.k]!;
    // As far as the drag goes while both columns keep their minimum.
    const move = Math.min(Math.max(dx, cmin - a), b - cmin);
    if (!(a + move >= cmin && b - move >= cmin)) return undefined;
    columnWidths = widths.map((w, i) =>
      i === role.k - 1 ? a + move : i === role.k ? b - move : w,
    );
  }
  const same = (p: readonly number[], q: readonly number[]) => p.every((v, i) => v === q[i]);
  if (same(columnWidths, widths) && same(rowHeights, heights)) return undefined;
  return { ...g, columnWidths, rowHeights };
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
