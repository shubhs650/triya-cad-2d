// Immutable update helpers. Every entity, record and object in the model is frozen, so code
// that tries to edit one in place fails loudly instead of silently corrupting undo history.

import type { EntityId } from './entity-ids';
import { assertObjectHandle, type Handle } from './handle';
import type { Entity, EntityInit, EntityProps, ObjectCommon } from './types';

/**
 * Freezes plain objects and arrays recursively. Typed arrays (binary xdata) cannot be frozen
 * and are left as they are; nothing in the engine writes to them.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return value;
  if (Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** Optional properties may be patched to `undefined`, which removes them. */
type Patch<T> = { readonly [K in keyof T]?: T[K] | undefined };

/** What an update may change: everything except identity, owner and type. */
export type EntityPatch = Patch<
  EntityProps & Pick<Entity, 'geom' | 'xdata' | 'reactors' | 'extDict' | 'raw'>
>;

/** What a record update may change: everything except the handle. */
export type RecordPatch<T extends ObjectCommon> = Patch<Omit<T, 'handle'>>;

const ENTITY_FIXED = ['id', 'handle', 'owner', 'type'] as const;

function applyPatch<T extends object>(base: T, patch: object): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  // Only the patched values are new; the rest are already frozen and stay shared.
  for (const v of Object.values(patch)) deepFreeze(v);
  return Object.freeze(next) as T;
}

function assertTypeMatches(type: string, geomKind: string): void {
  if (type !== geomKind) throw new Error(`entity type ${type} does not match geometry ${geomKind}`);
}

/** Builds a frozen entity from an init record and its runtime id. */
export function createEntity(id: EntityId, init: EntityInit): Entity {
  if (!Number.isInteger(id) || id < 1) throw new Error(`invalid EntityId ${id}`);
  assertObjectHandle(init.handle, 'entity handle');
  assertTypeMatches(init.type, init.geom.kind);
  return deepFreeze({ ...init, id });
}

/** Returns a new version of `entity` with `patch` applied. */
export function updateEntity(entity: Entity, patch: EntityPatch): Entity {
  for (const k of ENTITY_FIXED) {
    if (k in patch) throw new Error(`an entity update cannot change ${k}; remove and add instead`);
  }
  if (patch.geom) assertTypeMatches(entity.type, patch.geom.kind);
  return applyPatch(entity, patch);
}

/** Returns a new version of a table record or object with `patch` applied. */
export function updateRecord<T extends ObjectCommon>(record: T, patch: RecordPatch<T>): T {
  if ('handle' in patch) throw new Error('a record update cannot change handle');
  return applyPatch(record, patch);
}

/** Freezes a new record after checking its handle. */
export function createRecord<T extends ObjectCommon>(record: T): T {
  assertObjectHandle(record.handle as Handle, 'record handle');
  return deepFreeze({ ...record });
}
