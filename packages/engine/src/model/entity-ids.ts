import { assertObjectHandle, type Handle } from './handle';

/**
 * Dense runtime id for hot paths (R-tree payloads, render caches, selection sets), so they can
 * use numbers and typed arrays instead of hex strings. Ids start at 1; see `NO_ENTITY`.
 */
export type EntityId = number;

/** The "no entity" sentinel, so an `Int32Array` slot of 0 can mean empty. */
export const NO_ENTITY: EntityId = 0;

/**
 * Handle ⇄ EntityId map for one open document.
 *
 * The binding is permanent for the session: a removed entity keeps its id so undo restores the
 * same id, and an id is never given to another handle. Since handles are never reused either,
 * no cache keyed by id can ever confuse two different objects.
 */
export class EntityIdMap {
  readonly #byHandle = new Map<Handle, EntityId>();
  readonly #byId: Handle[] = [''];

  /** The id bound to `handle`, binding a fresh one the first time the handle is seen. */
  assign(handle: Handle): EntityId {
    const known = this.#byHandle.get(handle);
    if (known !== undefined) return known;
    assertObjectHandle(handle, 'entity handle');
    const id = this.#byId.length;
    this.#byId.push(handle);
    this.#byHandle.set(handle, id);
    return id;
  }

  idOf(handle: Handle): EntityId | undefined {
    return this.#byHandle.get(handle);
  }

  handleOf(id: EntityId): Handle | undefined {
    return id > NO_ENTITY ? this.#byId[id] : undefined;
  }

  get size(): number {
    return this.#byHandle.size;
  }
}
