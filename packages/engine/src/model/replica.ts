// Replicas (ARCHITECTURE.md §3): a DocumentModel built from the same `DocumentInit` as the
// engine's and fed the change sets the engine applied, in order. The render worker draws from
// one (M1-67); the I/O worker's save rebuilds one from the opened file and the session's change
// log (M2-13). Both get the change sets as structured clones, which the model's own checks
// would refuse, so `applyToReplica` first makes a change set the replica's own.

import type { ChangeSet, KeyedChanges, TableChanges } from './changeset';
import type { DocumentModel } from './document';
import type { Handle } from './handle';
import type { Entity, TableName } from './types';

/**
 * Applies to `model` a change set the engine already applied, and returns it as applied there.
 * Entity ids are dense and handed out in order, so binding the new handles in id order
 * reproduces the engine's ids; a mismatch means the replica missed a change. `what` names the
 * replica in that error.
 */
export function applyToReplica(model: DocumentModel, cs: ChangeSet, what = 'replica'): ChangeSet {
  const added = [...(cs.entities?.added ?? [])].sort((a, b) => a.entity.id - b.entity.id);
  for (const { entity } of added) {
    const id = model.ids.assign(entity.handle);
    if (id !== entity.id) {
      throw new Error(
        `${what} out of step: handle ${entity.handle} is id ${id} here, ${entity.id} in the engine`,
      );
    }
  }
  const local = rebase(model, cs);
  model.apply(local);
  return local;
}

/**
 * The model checks that a change set's `before` side is the very object it holds, which a
 * change set that crossed a postMessage (a structured clone) never is. Swap in the replica's
 * own objects, matched by id and handle; one it does not hold means the replica missed a
 * change, and the model then rejects the change set.
 */
function rebase(m: DocumentModel, cs: ChangeSet): ChangeSet {
  const own = (e: Entity): Entity => m.entity(e.id) ?? e;
  const out: { -readonly [K in keyof ChangeSet]: ChangeSet[K] } = { ...cs };
  if (cs.entities) {
    const { added, updated, removed } = cs.entities;
    out.entities = {
      ...(added && { added }),
      ...(updated && {
        updated: updated.map((u) => ({ before: own(u.before), after: u.after })),
      }),
      ...(removed && {
        removed: removed.map((r) => ({ entity: own(r.entity), index: r.index })),
      }),
    };
  }
  if (cs.tables) {
    const tables: Record<string, KeyedChanges<{ readonly handle: Handle }>> = {};
    for (const [name, c] of Object.entries(cs.tables) as [TableName, KeyedChanges<never>][]) {
      const map = m.tables[name] as ReadonlyMap<Handle, { readonly handle: Handle }>;
      tables[name] = rebaseKeyed(c, map);
    }
    out.tables = tables as TableChanges;
  }
  if (cs.objects) out.objects = rebaseKeyed(cs.objects, m.objects);
  if (cs.blocks) out.blocks = rebaseKeyed(cs.blocks, m.blocks);
  if (cs.layouts) {
    const own = new Map(m.layouts.map((l) => [l.handle, l]));
    out.layouts = rebaseKeyed(cs.layouts, own);
  }
  return out;
}

function rebaseKeyed<T extends { readonly handle: Handle }>(
  c: KeyedChanges<T>,
  map: ReadonlyMap<Handle, T>,
): KeyedChanges<T> {
  const own = (r: T): T => map.get(r.handle) ?? r;
  return {
    ...(c.added && { added: c.added }),
    ...(c.updated && {
      updated: c.updated.map((u) => ({ before: own(u.before), after: u.after })),
    }),
    ...(c.removed && { removed: c.removed.map(own) }),
  };
}
