// Draw order within a block (ARCHITECTURE.md §7.2): DRAWORDER and the TEXTTOFRONT family write
// a SORTENTSTABLE whose entries give an entity a sort handle to be drawn as. Entities are drawn
// in ascending sort handle, an entity with no entry sorting by its own handle; this is how
// acad-ts (`SortEntitiesTable.getSorterHandle`) and ezdxf read the table. Without a table the
// block's own order stands. Equal sort handles keep the block order.

import type { Handle } from '@triya/engine';

export function drawOrder(
  entities: readonly Handle[],
  entries?: readonly { readonly entity: Handle; readonly sort: Handle }[],
): Handle[] {
  if (!entries) return [...entities];
  const sortOf = new Map(entries.map((e) => [e.entity, e.sort]));
  const key = (h: Handle) => BigInt(`0x${sortOf.get(h) ?? h}`);
  return entities
    .map((h, i) => ({ h, i, k: key(h) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.h);
}
