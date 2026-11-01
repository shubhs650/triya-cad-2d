// SORTENTSTABLE objects to Triya `SortEntsTable` values (M1-13 part 2), for draw order.

import { SortEntitiesTable, type CadDocument } from '@node-projects/acad-ts';
import type { SortEntsTable } from '@triya/engine';
import { common, hex, ref } from './common';

/** Every block record's draw-order table, by table handle. */
export function mapSortEnts(doc: CadDocument): SortEntsTable[] {
  const out: SortEntsTable[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof SortEntitiesTable)) continue;
    const block = ref(o.blockOwner) ?? ref(o.owner);
    if (!block) continue;
    out.push({
      ...common(o),
      type: 'SORTENTSTABLE',
      owner: ref(o.owner) ?? block,
      block,
      // `entries` is the stored order; iterating the table would sort it.
      entries: o.entries.flatMap((s) => {
        const entity = ref(s.entity);
        return entity ? [{ entity, sort: hex(s.sortHandle) }] : [];
      }),
    });
  }
  return out.sort((a, b) => parseInt(a.handle, 16) - parseInt(b.handle, 16));
}
