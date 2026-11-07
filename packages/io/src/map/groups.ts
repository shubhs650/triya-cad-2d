// GROUP objects to Triya (M1-75 part 23): each entry of the ACAD_GROUP dictionary, with its
// members in the group's order. The members list the group in their reactors (`common`).

import { Group as AcadGroup, type CadDocument } from '@node-projects/acad-ts';
import type { Group } from '@triya/engine';
import { common, hex, ref } from './common';

/** The drawing's groups, by handle. */
export function mapGroups(doc: CadDocument): Group[] {
  const out: Group[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof AcadGroup)) continue;
    out.push({
      ...common(o),
      type: 'GROUP',
      owner: ref(o.owner) ?? '0',
      name: o.name,
      description: o.description,
      selectable: o.selectable,
      entities: o.entities.map((e) => hex(e.handle)),
    });
  }
  return out.sort((a, b) => parseInt(a.handle, 16) - parseInt(b.handle, 16));
}
