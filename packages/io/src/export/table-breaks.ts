// Where a table's break settings (M4-16 part 10) can be saved: a DXF table's round-trip record
// (map/table-breaks.ts), which a DXF save writes for a new table from R2000 and keeps for an
// edited one from R2007, as it does the table's TABLECONTENT (table-content.ts). A DWG from R2010
// states them in the table, but DWG saves get no new work (DEC-047): a change there is refused,
// as one in a DXF that cannot state them is.
import { ACadVersion } from '@node-projects/acad-ts';
import type { TableGeometry } from '@triya/engine';
import type { Resolver } from './entities';
import { same } from './entities';

/** Why the file at hand cannot hold the break settings of `g` (`was` as read, if it was). */
export function breakFileProblems(
  r: Resolver,
  was: TableGeometry | undefined,
  g: TableGeometry,
): string[] {
  if (g.breaks === undefined || (was && same(was.breaks, g.breaks))) return [];
  const { version, format } = r;
  const known = version !== undefined && version !== ACadVersion.Unknown;
  const least = was ? ACadVersion.AC1021 : ACadVersion.AC1015;
  if (format !== 'dwg' && (!known || version >= least)) return [];
  const file = `${known ? ACadVersion[version] : ''} ${format === 'dwg' ? 'DWG' : 'DXF'}`.trim();
  return [
    format === 'dwg'
      ? `table breaks (M4-16 part 10), which a ${file} save does not write (DXF only, DEC-047)`
      : `table breaks (M4-16 part 10), which ${file} cannot state`,
  ];
}
