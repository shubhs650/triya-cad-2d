// ChangeSet: the unit of change for undo, the renderer and export (ARCHITECTURE.md §3, §4.1).
//
// A change set holds the before and after versions of everything it touches, by reference,
// so it can be applied, inverted and re-applied exactly. Entity additions and removals carry
// their position in the owner block, because block entity order is file order (draw order
// without SORTENTS) and must survive undo.
//
// Index semantics, which make inversion a plain swap:
//   - `removed[i].index` is the entity's position in its block *before* the change set;
//   - `added[i].index` is its position *after* the change set.
// Applying removes in descending index order per block, replaces updates in place, then
// inserts additions in ascending index order. Inverting swaps added/removed and before/after.
//
// Block definitions (M1-75 part 22) are keyed by their BLOCK_RECORD handle and travel with
// that record: a new block adds both (BLOCK, and the dimension and table commands' anonymous
// blocks), a removed one drops both once its entities are gone (PURGE). Layouts are keyed by
// their LAYOUT handle: updated (renamed, reordered, given a new page setup or limits, M1-75
// part 20), added with the `*Paper_Space` block record and definition that hold their sheet
// (LAYOUT New), and removed with them and everything on the sheet (LAYOUT Delete, part 28).

import type {
  BlockDefinition,
  Entity,
  HeaderValue,
  Layout,
  NonGraphicalObject,
  TableName,
  TableRecords,
} from './types';

export interface Replacement<T> {
  readonly before: T;
  readonly after: T;
}

export interface PositionedEntity {
  readonly entity: Entity;
  readonly index: number;
}

export interface EntityChanges {
  readonly added?: readonly PositionedEntity[];
  readonly updated?: readonly Replacement<Entity>[];
  readonly removed?: readonly PositionedEntity[];
}

/** Changes to a handle-keyed collection (table records, objects); order carries no meaning. */
export interface KeyedChanges<T> {
  readonly added?: readonly T[];
  readonly updated?: readonly Replacement<T>[];
  readonly removed?: readonly T[];
}

/** `undefined` on either side means the variable is absent. */
export interface HeaderChange {
  readonly name: string;
  readonly before: HeaderValue | undefined;
  readonly after: HeaderValue | undefined;
}

export type TableChanges = { readonly [K in TableName]?: KeyedChanges<TableRecords[K]> };

export interface ChangeSet {
  readonly entities?: EntityChanges;
  readonly tables?: TableChanges;
  readonly objects?: KeyedChanges<NonGraphicalObject>;
  /** Block definitions, by their BLOCK_RECORD handle (the record changes in `tables`). */
  readonly blocks?: KeyedChanges<BlockDefinition>;
  readonly header?: readonly HeaderChange[];
  /** Layouts, by their LAYOUT handle (their block records and definitions change alongside). */
  readonly layouts?: KeyedChanges<Layout>;
}

const swap = <T>({ before, after }: Replacement<T>): Replacement<T> => ({
  before: after,
  after: before,
});

function invertKeyed<T>(c: KeyedChanges<T>): KeyedChanges<T> {
  const out: { added?: readonly T[]; updated?: readonly Replacement<T>[]; removed?: readonly T[] } =
    {};
  if (c.removed) out.added = c.removed;
  if (c.updated) out.updated = c.updated.map(swap);
  if (c.added) out.removed = c.added;
  return out;
}

/** The change set that undoes `cs` when applied right after it. */
export function invertChangeSet(cs: ChangeSet): ChangeSet {
  const out: {
    entities?: EntityChanges;
    tables?: TableChanges;
    objects?: KeyedChanges<NonGraphicalObject>;
    blocks?: KeyedChanges<BlockDefinition>;
    header?: readonly HeaderChange[];
    layouts?: KeyedChanges<Layout>;
  } = {};
  if (cs.entities) {
    const e = cs.entities;
    const entities: {
      added?: readonly PositionedEntity[];
      updated?: readonly Replacement<Entity>[];
      removed?: readonly PositionedEntity[];
    } = {};
    if (e.removed) entities.added = e.removed;
    if (e.updated) entities.updated = e.updated.map(swap);
    if (e.added) entities.removed = e.added;
    out.entities = entities;
  }
  if (cs.tables) {
    const tables: Record<string, KeyedChanges<unknown>> = {};
    for (const [name, c] of Object.entries(cs.tables)) {
      if (c) tables[name] = invertKeyed(c as KeyedChanges<unknown>);
    }
    out.tables = tables as TableChanges;
  }
  if (cs.objects) out.objects = invertKeyed(cs.objects);
  if (cs.blocks) out.blocks = invertKeyed(cs.blocks);
  if (cs.header) {
    out.header = cs.header.map(({ name, before, after }) => ({
      name,
      before: after,
      after: before,
    }));
  }
  if (cs.layouts) out.layouts = invertKeyed(cs.layouts);
  return out;
}

const emptyKeyed = (c: KeyedChanges<unknown> | undefined): boolean =>
  !c || (!c.added?.length && !c.updated?.length && !c.removed?.length);

export function isEmptyChangeSet(cs: ChangeSet): boolean {
  return (
    emptyKeyed(cs.entities) &&
    emptyKeyed(cs.objects) &&
    emptyKeyed(cs.blocks) &&
    !cs.header?.length &&
    emptyKeyed(cs.layouts) &&
    Object.values(cs.tables ?? {}).every((c) => emptyKeyed(c as KeyedChanges<unknown> | undefined))
  );
}
