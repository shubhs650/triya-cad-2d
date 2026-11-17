// TriyaToAcad for table border linetypes, double lines and hidden edges (M4-16 part 7): what a
// cell's border states beyond its colour and lineweight (`TableBorderFormat` linetype, double,
// spacing, hidden), as AutoCAD's Cell Border Properties sets it. A DWG from R2010 states them in
// each cell's cell style (table-cells.ts `writeCellStyleFormat`); a DXF only in the table's
// AutoCAD 2008 data (its TABLECONTENT, table-content.ts), which a DXF save writes from the table
// as it writes the DWG's. The legacy cell codes have a visibility bit per edge, which a DWG before
// R2010 writes and acad-ts's DXF writer does not (289/285/286/288, M1-81), and no linetype or
// double line.
import { ACadVersion } from '@node-projects/acad-ts';
import type { TableBorderFormat, TableCell, TableGeometry } from '@triya/engine';
import type { Resolver } from './entities';
import { rowOrigins } from './table-grid';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** What of border `b` only the R2010 cell styles state; hidden too in a DXF. */
function extrasOf(b: TableBorderFormat | undefined, hidden: boolean): string {
  const v = [b?.linetype, b?.double, b?.spacing, hidden ? b?.hidden : undefined];
  return v.every((x) => x === undefined) ? '' : JSON.stringify(v);
}

const stated = (c: TableCell | undefined, hidden: boolean): string =>
  SIDES.map((s) => extrasOf(c?.format?.borders?.[s], hidden)).join('|');

/** Whether any cell of `g` states a border linetype, double line or (`hidden`) hidden edge. */
export function statesBorderExtras(g: TableGeometry, hidden = true): boolean {
  const none = stated(undefined, hidden);
  return g.cells.some((row) => row.some((c) => stated(c, hidden) !== none));
}

/**
 * Why the file at hand cannot hold the border linetypes, double lines and hidden edges of `g`
 * (`was` the table as read, undefined for a new one): a DWG from R2010 states them, a DXF table's
 * TABLECONTENT does, which a DXF save writes for a new table from R2000 and keeps for an edited
 * one from R2007 (DEC-069); a DWG before R2010 states a hidden edge in its cell flags. As for cell
 * locks (table-cell-locks.ts), what the table held as read is left to the save; only a change is
 * refused.
 */
export function borderFileProblems(
  r: Resolver,
  was: TableGeometry | undefined,
  g: TableGeometry,
): string[] {
  const { version, format } = r;
  const least =
    format === 'dwg' ? ACadVersion.AC1024 : was ? ACadVersion.AC1021 : ACadVersion.AC1015;
  if (version === undefined || version === ACadVersion.Unknown || version >= least) return [];
  const hidden = format !== 'dwg';
  if (!statesBorderExtras(g, hidden)) return [];
  if (was && sameExtras(was, g, hidden)) return [];
  const what = hidden
    ? 'border linetypes, double lines or hidden borders'
    : 'border linetypes or double lines';
  return [
    `${what} (M4-16 part 7), which ${ACadVersion[version]} ${format === 'dwg' ? 'DWG' : 'DXF'} cannot state`,
  ];
}

/** Whether `g` has the rows and cells of `was`, their borders' extras as they were. */
function sameExtras(was: TableGeometry, g: TableGeometry, hidden: boolean): boolean {
  if (g.rowOrigins || g.columnOrigins) return false;
  const rows = rowOrigins(g);
  return g.cells.every((row, i) =>
    row.every((c, j) => {
      const o = rows[i];
      const b = o === null || o === undefined ? undefined : was.cells[o]?.[j];
      return stated(b, hidden) === stated(c, hidden);
    }),
  );
}
