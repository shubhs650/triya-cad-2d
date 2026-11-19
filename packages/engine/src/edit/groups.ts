// Groups (M3-08): what GROUP, UNGROUP, GROUPEDIT, -GROUP and the Object Grouping dialog
// (CLASSICGROUP) change, as AutoCAD 2024 changes it (AutoCAD Help, "About Groups", "-GROUP
// (Command)", "Object Grouping Dialog Box"):
//   - a group is a GROUP object filed in the ACAD_GROUP dictionary under its name; an unnamed
//     one is named `*A` and a number, one more than the highest such number used so far;
//   - each member lists the group in its reactors, as AutoCAD links them both ways (the save
//     refuses a member that does not point back, M1-75 part 23);
//   - removing every member leaves the group defined; Explode (UNGROUP) deletes the definition
//     and the objects stay;
//   - group names are up to 31 characters, letters, digits, `$`, `-` and `_`, no spaces, and
//     are converted to upper case.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Group, NonGraphicalObject, SpatialFilter } from '../model/types';

const isGroup = (o: NonGraphicalObject | undefined): o is Group => o?.type === 'GROUP';

/** How AutoCAD names an unnamed group. */
const UNNAMED = /^\*A(\d+)$/i;

/** A group name: letters, digits, `$`, `-` and `_`, at most 31 of them. */
const NAME = /^[A-Za-z0-9$_-]{1,31}$/;

/** The longest description the Object Grouping dialog takes. */
export const GROUP_DESCRIPTION_MAX = 64;

/** A group's own name is unnamed (`*A3`). */
export function isUnnamedGroup(g: Pick<Group, 'name'>): boolean {
  return g.name.startsWith('*');
}

/** The drawing's groups, by name (case aside), as the builder will leave them. */
export function groupsOf(source: DocumentModel | ChangeSetBuilder): Group[] {
  const objects =
    typeof source.objects === 'function'
      ? (source as ChangeSetBuilder).objects()
      : (source as DocumentModel).objects.values();
  return [...objects].filter(isGroup).sort((a, b) => compareNames(a.name, b.name));
}

/** Names in the Object Grouping dialog's order: alphabetical, case aside. */
function compareNames(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The group named `name` (case aside). */
export function findGroup(
  source: DocumentModel | ChangeSetBuilder,
  name: string,
): Group | undefined {
  const key = name.trim().toUpperCase();
  return groupsOf(source).find((g) => g.name.toUpperCase() === key);
}

/** Why `name` cannot name a group; undefined when it can. */
export function groupNameProblem(name: string): string | undefined {
  return NAME.test(name) ? undefined : 'Invalid group name.';
}

/** The name the next unnamed group gets: `*A` and one more than the highest used. */
export function nextUnnamedGroup(source: DocumentModel | ChangeSetBuilder): string {
  let n = 0;
  for (const g of groupsOf(source)) {
    const m = UNNAMED.exec(g.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `*A${n + 1}`;
}

/**
 * The members of `g` in `space` that a pick or window can take with it (group selection,
 * PICKSTYLE 1): objects on frozen or locked layers are not selected ("Selectable", Object
 * Grouping Dialog Box).
 */
export function selectableMembers(model: DocumentModel, g: Group, space: Handle): EntityId[] {
  return selectableHandles(model, g.entities, space);
}

/**
 * The objects of `handles` in `space` a selection can take along (a group's members, an
 * associative hatch's boundary, M3-13): not those gone or on frozen or locked layers.
 */
export function selectableHandles(
  model: DocumentModel,
  handles: readonly Handle[],
  space: Handle,
): EntityId[] {
  const out: EntityId[] = [];
  for (const h of handles) {
    const id = model.ids.idOf(h);
    const e = id === undefined ? undefined : model.entity(id);
    if (!e || e.owner !== space || out.includes(e.id)) continue;
    const l = model.tables.layers.get(e.layer);
    if (l && (l.frozen || l.locked)) continue;
    out.push(e.id);
  }
  return out;
}

/**
 * The selectable groups `ids` hold whole, with the members they hold (M3-13): a group whose
 * every member a selection could take (`selectableMembers`) is selected. What GROUPDISPLAYMODE
 * shows one grip for.
 */
export function wholeGroups(
  model: DocumentModel,
  ids: readonly EntityId[],
  space: Handle,
): { readonly group: Group; readonly ids: readonly EntityId[] }[] {
  const chosen = new Set(ids);
  const out: { group: Group; ids: EntityId[] }[] = [];
  for (const g of groupsOf(model)) {
    if (!g.selectable || !g.entities.some((h) => chosen.has(model.ids.idOf(h)!))) continue;
    const members = selectableMembers(model, g, space);
    if (members.length > 0 && members.every((id) => chosen.has(id))) {
      out.push({ group: g, ids: members });
    }
  }
  return out;
}

/** The handles of `ids`, in order, without repeats or objects that are gone. */
function handlesOf(b: ChangeSetBuilder, ids: readonly EntityId[]): Handle[] {
  const out: Handle[] = [];
  for (const id of ids) {
    const e = b.entity(id);
    if (e && !out.includes(e.handle)) out.push(e.handle);
  }
  return out;
}

function link(b: ChangeSetBuilder, model: DocumentModel, member: Handle, group: Handle): void {
  const id = model.ids.idOf(member);
  const e = id === undefined ? undefined : b.entity(id);
  if (!e || (e.reactors ?? []).includes(group)) return;
  b.updateEntity(e.id, { reactors: [...(e.reactors ?? []), group] });
}

function unlink(b: ChangeSetBuilder, model: DocumentModel, member: Handle, group: Handle): void {
  const id = model.ids.idOf(member);
  const e = id === undefined ? undefined : b.entity(id);
  if (!e || !(e.reactors ?? []).includes(group)) return;
  const reactors = e.reactors!.filter((r) => r !== group);
  b.updateEntity(e.id, { reactors: reactors.length > 0 ? reactors : undefined });
}

export interface NewGroup {
  /** Its name, or undefined for an unnamed group (`*A` and a number). */
  readonly name?: string;
  readonly description?: string;
  readonly selectable?: boolean;
  readonly ids: readonly EntityId[];
}

/**
 * Makes a group of `ids` in the order given, filed in the drawing's ACAD_GROUP dictionary. A
 * drawing without one cannot hold groups: undefined.
 */
export function createGroup(
  b: ChangeSetBuilder,
  model: DocumentModel,
  g: NewGroup,
): Group | undefined {
  const owner = model.meta.groupDictionary;
  if (owner === undefined) return undefined;
  const group = b.addObject({
    type: 'GROUP',
    owner,
    reactors: [owner],
    name: g.name === undefined ? nextUnnamedGroup(b) : g.name.toUpperCase(),
    description: g.description ?? '',
    selectable: g.selectable ?? true,
    entities: handlesOf(b, g.ids),
  } as Omit<Group, 'handle'>) as Group;
  for (const h of group.entities) link(b, model, h, group.handle);
  return group;
}

/** Explode: the group's definition goes, its members let go of it and stay. */
export function explodeGroup(b: ChangeSetBuilder, model: DocumentModel, g: Group): void {
  const now = b.object(g.handle) as Group | undefined;
  if (!now) return;
  for (const h of now.entities) unlink(b, model, h, g.handle);
  b.removeObject(g.handle);
}

/** Adds `ids` (those it does not list yet) to the end of the group. Returns how many. */
export function addToGroup(
  b: ChangeSetBuilder,
  model: DocumentModel,
  g: Group,
  ids: readonly EntityId[],
): number {
  const now = b.object(g.handle) as Group;
  const added = handlesOf(b, ids).filter((h) => !now.entities.includes(h));
  if (added.length === 0) return 0;
  b.updateObject(g.handle, { entities: [...now.entities, ...added] } as Partial<Group>);
  for (const h of added) link(b, model, h, g.handle);
  return added.length;
}

/** Takes `ids` out of the group, which stays defined however few it keeps. Returns how many. */
export function removeFromGroup(
  b: ChangeSetBuilder,
  model: DocumentModel,
  g: Group,
  ids: readonly EntityId[],
): number {
  const now = b.object(g.handle) as Group;
  const out = new Set(handlesOf(b, ids).filter((h) => now.entities.includes(h)));
  if (out.size === 0) return 0;
  b.updateObject(g.handle, {
    entities: now.entities.filter((h) => !out.has(h)),
  } as Partial<Group>);
  for (const h of out) unlink(b, model, h, g.handle);
  return out.size;
}

/** Renames, describes or makes the group selectable or not. */
export function changeGroup(
  b: ChangeSetBuilder,
  g: Group,
  patch: { readonly name?: string; readonly description?: string; readonly selectable?: boolean },
): void {
  b.updateObject(g.handle, {
    ...(patch.name !== undefined && { name: patch.name.toUpperCase() }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.selectable !== undefined && { selectable: patch.selectable }),
  } as Partial<Group>);
}

/**
 * -GROUP Order: moves `count` members from position `from` to position `to` (positions from 0,
 * as AutoCAD numbers them), or reverses the whole order.
 */
export function reorderGroup(
  b: ChangeSetBuilder,
  g: Group,
  move: { readonly from: number; readonly to: number; readonly count: number } | 'reverse',
): void {
  const now = (b.object(g.handle) as Group).entities;
  let entities: Handle[];
  if (move === 'reverse') entities = [...now].reverse();
  else {
    const rest = [...now];
    const moved = rest.splice(move.from, move.count);
    rest.splice(Math.min(move.to, rest.length), 0, ...moved);
    entities = rest;
  }
  b.updateObject(g.handle, { entities } as Partial<Group>);
}

/**
 * Copies of whole groups (M3-13; AutoCAD Help, "About Groups": a copy of a group is an unnamed
 * group): each group of the drawing whose every member `copies` copied (source handle → copy)
 * gets an unnamed group of the copies, in the group's order, as selectable as it is.
 */
export function copyGroups(
  b: ChangeSetBuilder,
  model: DocumentModel,
  copies: ReadonlyMap<Handle, { readonly id: EntityId }>,
): void {
  for (const g of groupsOf(model)) {
    if (g.entities.length === 0 || !g.entities.every((h) => copies.has(h))) continue;
    createGroup(b, model, {
      ids: g.entities.map((h) => copies.get(h)!.id),
      selectable: g.selectable,
    });
  }
}

/**
 * Takes copies back (COPY's, a grip mode's or ARRAY's Undo) with the groups their copying made:
 * a group a copy lists in its reactors is one made of copies. A copied reference's clip goes with
 * it (M5-16), as ERASE takes one.
 */
export function removeCopies(b: ChangeSetBuilder, ids: readonly EntityId[]): void {
  const gone = new Set<Handle>();
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    for (const r of e.reactors ?? []) if (isGroup(b.object(r))) b.removeObject(r);
    gone.add(e.handle);
    b.removeEntity(id);
  }
  if (gone.size === 0) return;
  for (const o of [...b.objects()]) {
    if (o.type === 'SPATIAL_FILTER' && gone.has((o as SpatialFilter).insert)) {
      b.removeObject(o.handle);
    }
  }
}
