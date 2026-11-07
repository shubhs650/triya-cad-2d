// TriyaToAcad for GROUP objects (M1-75 part 23), the inverse of map/groups.ts: GROUP makes a
// group, UNGROUP removes one, and GROUPEDIT and the Object Grouping dialog add and remove
// members, reorder them, rename the group, describe it and make it selectable or not. A group is
// an entry of the ACAD_GROUP dictionary under its name (an unnamed group's is `*A` and a number,
// DXF 70 1, which acad-ts derives from the name) and lists its members (DXF 340, DWG hard
// pointers); each member lists the group in its reactors, as every grouped entity of the corpus
// shows. The members' side is checked in reactors.ts; here, the group's.
//
// Refused, before anything changes: a group before R13, which introduced groups, a member that
// is not an entity of the drawing, listed twice or not pointing back at the group, an old member
// still pointing at it, an erased entity a group still lists (AutoCAD's ERASE takes it out of its
// groups), a duplicate (case aside) or invalid name, an unnamed group named otherwise than `*A`
// and a number, a group moving to another dictionary, and xdata, reactor and extension
// dictionary changes.

import {
  ACadVersion,
  CadDictionary,
  Group as AcadGroup,
  INamedCadObjectExtensions,
  Entity as AcadEntity,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Group, Handle, NonGraphicalObject } from '@triya/engine';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import { resolve, same, type Resolver } from './entities';

const isGroup = (o: NonGraphicalObject | undefined): o is Group => o?.type === 'GROUP';

/** Fields no writer handles yet. */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

/** How AutoCAD names an unnamed group. */
const UNNAMED = /^\*A\d+$/i;

export interface GroupsPlan {
  readonly updated: { readonly acad: AcadGroup; readonly before: Group; readonly after: Group }[];
  /** New groups, already holding their handle, for the ACAD_GROUP dictionary. */
  readonly added: { readonly acad: AcadGroup; readonly after: Group }[];
  readonly removed: AcadGroup[];
  readonly dictionary: CadDictionary | undefined;
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const hex = (n: number): Handle => n.toString(16).toUpperCase();

/** The model's group changes against the original's mapping, and why any cannot be written. */
export function planGroups(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: GroupsPlan; problems: string[] } {
  const dict = doc.rootDictionary?.get(CadDictionary.acadGroup);
  const dictionary = dict instanceof CadDictionary ? dict : undefined;
  const plan: GroupsPlan = { updated: [], added: [], removed: [], dictionary };
  const problems: string[] = [];
  const version = doc.header?.version;
  const baseObjects = new Map((base.objects ?? []).map((o) => [o.handle, o]));
  const before = new Map([...baseObjects].filter((e): e is [Handle, Group] => isGroup(e[1])));
  const after = [...model.objects.values()].filter(isGroup);
  const baseEntities = new Set((base.entities ?? []).map((e) => e.handle));

  // Group names are unique without regard to case.
  const names = new Map<string, number>();
  for (const g of after) {
    const key = String(g.name).toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }

  for (const [h, b] of before) {
    const a = model.objects.get(h);
    if (a && a.type !== b.type) {
      problems.push(`GROUP ${b.name} (${h}): type changes`);
    } else if (!a) {
      // UNGROUP: the members let go of it.
      const acad = resolve(r, h, AcadGroup);
      if (!acad) problems.push(`GROUP ${b.name} (${h}): the original is not a GROUP`);
      else plan.removed.push(acad);
      for (const m of b.entities) {
        if ((model.entityByHandle(m)?.reactors ?? []).includes(h))
          problems.push(
            `GROUP ${b.name} (${h}): its old member ${m} still points at it (reactors)`,
          );
      }
    }
  }

  for (const a of after) {
    const h = a.handle;
    const b = before.get(h);
    const out: string[] = [];
    // ERASE takes an entity out of its groups; one a group still lists would be saved dangling.
    for (const m of a.entities ?? []) {
      if (baseEntities.has(m) && !model.entityByHandle(m))
        out.push(`still lists the erased entity ${m}`);
    }
    if (b && same(b, a)) {
      problems.push(...out.map((p) => `GROUP ${a.name} (${h}): ${p}`));
      continue;
    }
    if (!b && baseObjects.has(h)) continue; // another object's type change, reported by its writer
    let acad: AcadGroup | undefined;
    if (b) {
      acad = resolve(r, h, AcadGroup);
      if (!acad) out.push('the original is not a GROUP');
      if (b.owner !== a.owner) out.push('owner changes');
      for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
      if (acad && b.name !== a.name) {
        out.push(...nameProblems(a.name, names, version));
        out.push(
          ...entryRenameProblems(acad, a.name, (o) => isGroup(model.objects.get(hex(o.handle)))),
        );
      }
    } else {
      if (doc.getCadObject(Number.parseInt(h, 16))) out.push('the handle is already used');
      if (known(version) && version < ACadVersion.AC1012)
        out.push(`${ACadVersion[version]} has no groups (R13 introduced them)`);
      if (!dictionary || a.owner !== hex(dictionary.handle))
        out.push(
          `a new group belongs in ACAD_GROUP${dictionary ? ` (${hex(dictionary.handle)})` : ', which the drawing does not have'}`,
        );
      // The save links a new group to the dictionary holding it, and makes nothing else.
      if (a.xdata !== undefined) out.push('xdata changes');
      if (a.extDict !== undefined) out.push('extDict changes');
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) out.push('reactors changes');
      out.push(...nameProblems(a.name, names, version));
    }
    out.push(...valueProblems(b, a));
    out.push(...memberProblems(model, a, b));
    if (out.length > 0) {
      problems.push(...out.map((p) => `GROUP ${String(a.name)} (${h}): ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      acad = new AcadGroup(a.name);
      // acad-ts keeps a non-zero handle it has not seen, so the group keeps Triya's handle.
      acad.handle = Number.parseInt(h, 16);
      plan.added.push({ acad, after: a });
      r.created.set(h, acad);
    }
  }
  return { plan, problems };
}

/** Why a group cannot be named `name` (GROUP's name, the Object Grouping dialog's Rename). */
function nameProblems(
  name: string,
  names: ReadonlyMap<string, number>,
  version: ACadVersion | undefined,
): string[] {
  if (typeof name !== 'string' || name === '') return ['a group needs a name'];
  if ((names.get(name.toUpperCase()) ?? 0) > 1) return [`another group is named ${name}`];
  if (!INamedCadObjectExtensions.isValidDxfName({ name } as never, version))
    return [`${JSON.stringify(name)} is not a valid group name`];
  if (name.startsWith('*') && !UNNAMED.test(name))
    return [`${JSON.stringify(name)}: an unnamed group is named *A and a number`];
  return [];
}

function valueProblems(b: Group | undefined, a: Group): string[] {
  const out: string[] = [];
  if ((!b || b.description !== a.description) && typeof a.description !== 'string')
    out.push(`description: ${JSON.stringify(a.description)} is not text`);
  if ((!b || b.selectable !== a.selectable) && typeof a.selectable !== 'boolean')
    out.push(`selectable: ${JSON.stringify(a.selectable)} is not true or false`);
  if (!Array.isArray(a.entities) || !a.entities.every((h) => typeof h === 'string'))
    out.push('entities: not a list of handles');
  return out;
}

/** The group's side of the link with its members: they exist and point back, old ones do not. */
function memberProblems(model: DocumentModel, a: Group, b: Group | undefined): string[] {
  if (!Array.isArray(a.entities) || (b && same(b.entities, a.entities))) return [];
  const out: string[] = [];
  const seen = new Set<Handle>();
  for (const m of a.entities) {
    if (seen.has(m)) out.push(`member ${m} twice`);
    seen.add(m);
    const e = model.entityByHandle(m);
    if (!e) {
      // An erased one is reported once, above.
      if (!out.some((p) => p.endsWith(`erased entity ${m}`)))
        out.push(`member ${m} is not an entity of the drawing`);
    } else if (!(e.reactors ?? []).includes(a.handle)) {
      out.push(`member ${m} does not point back at it (reactors)`);
    }
  }
  for (const m of b?.entities ?? []) {
    if (seen.has(m)) continue;
    if ((model.entityByHandle(m)?.reactors ?? []).includes(a.handle))
      out.push(`its old member ${m} still points at it (reactors)`);
  }
  return out;
}

/**
 * Writes the planned group changes onto `doc` before the entities: renames first (a new group may
 * take a name one gives up), then new groups join ACAD_GROUP, then removed ones leave it. The
 * members are set by `writeGroupMembers` once every entity the save adds exists.
 */
export function writeGroups(plan: GroupsPlan): void {
  renameEntries(
    plan.updated
      .filter(({ before, after }) => before.name !== after.name)
      .map(({ acad, after }) => ({ acad, name: after.name })),
  );
  for (const acad of plan.removed) {
    const dict = acad.owner;
    if (dict instanceof CadDictionary) dict.remove(acad.name);
  }
  for (const { acad, after } of plan.added) {
    plan.dictionary!.add(acad);
    // The dictionary's reactor, as AutoCAD links an entry to it.
    if (after.reactors?.length) acad.addReactor(plan.dictionary!);
  }
  for (const { acad, before, after } of [
    ...plan.updated,
    ...plan.added.map((a) => ({ ...a, before: undefined })),
  ]) {
    if (!before || before.description !== after.description) acad.description = after.description;
    if (!before || before.selectable !== after.selectable) acad.selectable = after.selectable;
  }
}

/**
 * Sets the members of the new groups and of those whose members change, in the model's order.
 * The members' reactors are written from the model (entities.ts), so the list is set without
 * `Group.add`/`Group.remove`, which would push the group onto them or take it off again.
 */
export function writeGroupMembers(r: Resolver, plan: GroupsPlan): void {
  for (const { acad, before, after } of [
    ...plan.updated,
    ...plan.added.map((a) => ({ ...a, before: undefined })),
  ]) {
    if (before && same(before.entities, after.entities)) continue;
    const members = after.entities.map((h) => resolve(r, h, AcadEntity)!);
    (acad as unknown as { _entities: AcadEntity[] })._entities = members;
  }
}
