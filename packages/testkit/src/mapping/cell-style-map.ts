// M1-96: AutoCAD 2008 and later keep a table style's named cell styles beside its row styles, in
// the CELLSTYLEMAP its extension dictionary names (ACAD_ROUNDTRIP_2008_TABLESTYLE_CELLSTYLEMAP),
// in every DXF they save and in a DWG before R2010, and the two say the same.
import { ACadVersion, TableStyle, type CadDocument } from '@node-projects/acad-ts';
import type { TableStyleRecord } from '@triya/engine';
import { mappedCellStyleMap } from '@triya/io';

const ROWS = ['data', 'title', 'header'] as const;

/**
 * Where the CELLSTYLEMAP of the table style `record` maps from (in `doc`) says other than the
 * record's row styles; undefined when the style has no CELLSTYLEMAP that acad-ts reads. An
 * unfilled row's colour is not compared (AutoCAD states 7 in the rows and None in the map, some
 * files 257 in both), nor the data and unit types before R2007, where the rows have none.
 */
export function cellStyleMapProblems(
  doc: CadDocument,
  record: TableStyleRecord,
): string[] | undefined {
  const s = doc.getCadObject(Number.parseInt(record.handle, 16));
  if (!(s instanceof TableStyle)) return undefined;
  const map = mappedCellStyleMap(s);
  if (!map) return undefined;
  const version = doc.header?.version ?? ACadVersion.AC1032;
  const problems: string[] = [];
  map.forEach((m, i) => {
    const row = record.cellStyles[i]!;
    for (const key of Object.keys(row) as (keyof typeof row)[]) {
      if (key === 'fillColor' && !row.fillOn) continue;
      if ((key === 'dataType' || key === 'unitType') && version < ACadVersion.AC1021) continue;
      if (JSON.stringify(row[key]) !== JSON.stringify(m[key]))
        problems.push(`${record.name} ${ROWS[i]} row ${key}: ${JSON.stringify(m[key])}`);
    }
  });
  return problems;
}
