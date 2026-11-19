// TriyaToAcad for DGN linestyle data (M5-09 part 5): the components PURGE's "Orphaned data"
// removes go from the `ACAD_DGNLINESTYLECOMP` dictionary, each with what it owns; once the last
// goes the dictionary goes from the named-object dictionary too, as AutoCAD's DGN purge tool
// leaves no empty one (keanw.com, 2012). The anonymous blocks only their symbols drew go as any
// purged block does (purge.ts).
//
// Refused, before anything changes: a component the save would add or change (Triya never edits
// line style data: a paste does not bring it), one a linetype the drawing keeps still uses
// (through its line style definition, or a compound or point component that stays), and one the
// file still refers to otherwise (`purgePinned`).
import type { CadDictionary, CadDocument, CadObject } from '@node-projects/acad-ts';
import {
  isDgnLinestyleComponent,
  type DgnLinestyleComponent,
  type DocumentInit,
  type DocumentModel,
} from '@triya/engine';
import { DGN_COMPONENTS, dgnComponentsDictionary } from '../map/dgn-linestyles';
import { same, type Resolver } from './entities';

export interface DgnLinestylesPlan {
  /** Each component going, with the dictionary listing it and its key there. */
  readonly removed: readonly { readonly dict: CadDictionary; readonly key: string }[];
}

export function planDgnLinestyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: DgnLinestylesPlan; problems: string[] } {
  const problems: string[] = [];
  const removed: { dict: CadDictionary; key: string }[] = [];
  const before = new Map(
    (base.objects ?? []).filter(isDgnLinestyleComponent).map((o) => [o.handle, o]),
  );
  const after = [...model.objects.values()].filter(isDgnLinestyleComponent);
  const problem = (c: DgnLinestyleComponent, p: string) =>
    problems.push(`DGN linestyle component ${c.name} (${c.handle}): ${p}`);
  for (const a of after) {
    const b = before.get(a.handle);
    if (!b) problem(a, 'a save does not add DGN linestyle data');
    else if (!same(b, a)) problem(a, 'a save does not change DGN linestyle data');
  }
  const staying = new Map(after.map((a) => [a.handle, a]));
  const pinned = new Set(base.purgePinned ?? []);
  const dict = dgnComponentsDictionary(doc);
  for (const [h, b] of before) {
    if (staying.has(h)) continue;
    const users = b.usedBy.filter((l) => model.tables.linetypes.has(l));
    if (users.length > 0) problem(b, `linetype ${users[0]} still uses it`);
    const holder = after.find((a) => a.parts.includes(h));
    if (holder) problem(b, `${holder.name} (${holder.handle}) still uses it`);
    if (pinned.has(h)) problem(b, 'the file still refers to it');
    const acad: CadObject | undefined = r.store.original(h);
    const key = dict?.entryNames.find((k) => dict.getEntry(k) === acad);
    if (!acad || !dict || key === undefined) problem(b, `it is not an entry of ${DGN_COMPONENTS}`);
    else removed.push({ dict, key });
  }
  return { plan: { removed }, problems };
}

/** Takes the components out of their dictionary, and the dictionary out once it is empty. */
export function writeDgnLinestyles(doc: CadDocument, plan: DgnLinestylesPlan): void {
  for (const { dict, key } of plan.removed) {
    if (!dict.remove(key))
      throw new Error(`${DGN_COMPONENTS} ${key}: acad-ts did not remove it from its dictionary`);
  }
  const dict = plan.removed[0]?.dict;
  const root = doc.rootDictionary;
  if (!dict || dict.entryNames.length > 0 || !root) return;
  const key = root.entryNames.find((k) => root.getEntry(k) === dict);
  if (key !== undefined && !root.remove(key))
    throw new Error(
      `${DGN_COMPONENTS}: acad-ts did not remove it from the named-object dictionary`,
    );
}
