// The document container (ARCHITECTURE.md §4.1). It lives in the engine worker and is the
// authoritative copy of the drawing.
//
// Values inside it (entities, records, objects) are immutable; the container itself is not,
// so applying a change set costs O(size of the change) rather than a copy of a 100k-entity
// drawing. All mutation goes through `apply(changeSet)`, which validates the whole change set
// before touching anything: a rejected change set leaves the model exactly as it was.

import type { ChangeSet, KeyedChanges, PositionedEntity } from './changeset';
import { EntityIdMap, type EntityId } from './entity-ids';
import { assertObjectHandle, HandleAllocator, type Handle } from './handle';
import {
  TABLE_NAMES,
  type BlockDefinition,
  type DocumentMeta,
  type Entity,
  type EntityInit,
  type HeaderValue,
  type Layout,
  type NonGraphicalObject,
  type ObjectCommon,
  type TableName,
  type TableRecords,
  type Tables,
} from './types';
import { createEntity, createRecord, deepFreeze } from './update';

/** What the importer (M1-03/M1-04) hands over to build a model. Entities in block order. */
export interface DocumentInit {
  readonly meta: DocumentMeta;
  /** `$HANDSEED` as read from the file. */
  readonly handSeed: string;
  readonly header?: Iterable<readonly [string, HeaderValue]>;
  readonly tables?: { readonly [K in TableName]?: readonly TableRecords[K][] };
  readonly blocks?: readonly BlockDefinition[];
  readonly layouts?: readonly Layout[];
  readonly objects?: readonly NonGraphicalObject[];
  /**
   * Handles of objects the I/O layer keeps without mapping (ARCHITECTURE.md §6.2). The engine
   * never looks inside them, but must never hand their handles out again.
   */
  readonly passthrough?: readonly Handle[];
  readonly entities?: readonly EntityInit[];
}

/** Tab order, then name, as AutoCAD lists layout tabs (the order is stable for equal keys). */
const emptyLayouts = (c: KeyedChanges<Layout>): boolean =>
  !c.added?.length && !c.updated?.length && !c.removed?.length;

const byTabOrder = (a: Layout, b: Layout): number =>
  a.tabOrder - b.tabOrder || a.name.localeCompare(b.name);

type MutableTables = { [K in TableName]: Map<Handle, TableRecords[K]> };

function sameHeaderValue(a: HeaderValue | undefined, b: HeaderValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const az = 'z' in a ? a.z : undefined;
  const bz = 'z' in b ? b.z : undefined;
  return a.x === b.x && a.y === b.y && az === bz;
}

export class DocumentModel {
  readonly meta: DocumentMeta;
  readonly ids = new EntityIdMap();
  readonly handles: HandleAllocator;
  readonly passthrough: ReadonlySet<Handle>;

  readonly #header = new Map<string, HeaderValue>();
  readonly #tables = Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()])) as MutableTables;
  readonly #blocks = new Map<Handle, BlockDefinition>();
  readonly #blockEntities = new Map<Handle, EntityId[]>();
  /** In tab order (`byTabOrder`). */
  readonly #layouts: Layout[] = [];
  readonly #objects = new Map<Handle, NonGraphicalObject>();
  readonly #entities = new Map<EntityId, Entity>();
  /** Every handle present in the model, of any kind, for uniqueness checks. */
  readonly #used = new Set<Handle>();
  #version = 0;

  private constructor(init: DocumentInit) {
    this.meta = deepFreeze({ ...init.meta });
    for (const [name, value] of init.header ?? []) this.#header.set(name, deepFreeze(value));

    const claim = (h: Handle, what: string): void => {
      assertObjectHandle(h, what);
      if (this.#used.has(h)) throw new Error(`handle ${h} is used twice`);
      this.#used.add(h);
    };

    for (const t of TABLE_NAMES) {
      const table = this.#tables[t] as Map<Handle, ObjectCommon>;
      for (const r of init.tables?.[t] ?? []) {
        claim(r.handle, `${t} record handle`);
        table.set(r.handle, createRecord(r));
      }
    }
    for (const b of init.blocks ?? []) {
      if (!this.#tables.blockRecords.has(b.handle)) {
        throw new Error(`block ${b.handle} has no BLOCK_RECORD`);
      }
      if (b.beginHandle !== undefined) claim(b.beginHandle, 'BLOCK handle');
      if (b.endHandle !== undefined) claim(b.endHandle, 'ENDBLK handle');
      this.#blocks.set(b.handle, deepFreeze({ ...b }));
      this.#blockEntities.set(b.handle, []);
    }
    for (const l of init.layouts ?? []) {
      claim(l.handle, 'layout handle');
      this.#layouts.push(deepFreeze({ ...l }));
    }
    this.#layouts.sort(byTabOrder);
    for (const o of init.objects ?? []) {
      claim(o.handle, 'object handle');
      this.#objects.set(o.handle, createRecord(o));
    }
    for (const h of init.passthrough ?? []) claim(h, 'passthrough handle');
    this.passthrough = new Set(init.passthrough ?? []);
    for (const e of init.entities ?? []) {
      const list = this.#blockEntities.get(e.owner);
      if (!list) throw new Error(`entity ${e.handle}: owner block ${e.owner} does not exist`);
      claim(e.handle, 'entity handle');
      const entity = createEntity(this.ids.assign(e.handle), e);
      this.#entities.set(entity.id, entity);
      list.push(entity.id);
    }
    this.handles = new HandleAllocator(init.handSeed, this.#used);
  }

  static create(init: DocumentInit): DocumentModel {
    return new DocumentModel(init);
  }

  // ── Read access ─────────────────────────────────────────────────────────────────────────

  /** Incremented by every applied change set; cheap staleness check for caches. */
  get version(): number {
    return this.#version;
  }

  /** The next free handle, written back as `$HANDSEED` on export. */
  get handSeed(): Handle {
    return this.handles.handSeed;
  }

  get header(): ReadonlyMap<string, HeaderValue> {
    return this.#header;
  }

  get tables(): Tables {
    return this.#tables;
  }

  get blocks(): ReadonlyMap<Handle, BlockDefinition> {
    return this.#blocks;
  }

  /** Every layout in tab order (Model first), ties by name. */
  get layouts(): readonly Layout[] {
    return this.#layouts;
  }

  get objects(): ReadonlyMap<Handle, NonGraphicalObject> {
    return this.#objects;
  }

  get entityCount(): number {
    return this.#entities.size;
  }

  entity(id: EntityId): Entity | undefined {
    return this.#entities.get(id);
  }

  entityByHandle(handle: Handle): Entity | undefined {
    const id = this.ids.idOf(handle);
    return id === undefined ? undefined : this.#entities.get(id);
  }

  entities(): IterableIterator<Entity> {
    return this.#entities.values();
  }

  /** The entities of a block in file order. A live view: copy it to keep it across changes. */
  blockEntities(block: Handle): readonly EntityId[] {
    const list = this.#blockEntities.get(block);
    if (!list) throw new Error(`owner block ${block} does not exist`);
    return list;
  }

  hasBlock(block: Handle): boolean {
    return this.#blockEntities.has(block);
  }

  /** True when any object in the model (or passthrough) uses `handle`. */
  hasHandle(handle: Handle): boolean {
    return this.#used.has(handle);
  }

  // ── Mutation ────────────────────────────────────────────────────────────────────────────

  /** Applies `cs` atomically, or throws and changes nothing. */
  apply(cs: ChangeSet): void {
    const freed = new Set<Handle>();
    const claimed = new Set<Handle>();
    const claim = (h: Handle): void => {
      assertObjectHandle(h);
      if ((this.#used.has(h) && !freed.has(h)) || claimed.has(h)) {
        throw new Error(`handle ${h} is already used`);
      }
      claimed.add(h);
    };

    // Validate. Removals first, so their handles count as free for additions.
    const ents = cs.entities ?? {};
    const removedIds = new Set<EntityId>();
    for (const { entity, index } of ents.removed ?? []) {
      if (removedIds.has(entity.id))
        throw new Error(`entity ${entity.handle} is changed more than once`);
      removedIds.add(entity.id);
      this.#checkCurrent(entity);
      if (this.#blockEntities.get(entity.owner)?.[index] !== entity.id) {
        throw new Error(
          `entity ${entity.handle} is not at index ${index} of block ${entity.owner}`,
        );
      }
      freed.add(entity.handle);
    }
    const tableEntries = Object.entries(cs.tables ?? {}) as [
      TableName,
      KeyedChanges<ObjectCommon>,
    ][];
    const keyed: [string, Map<Handle, ObjectCommon>, KeyedChanges<ObjectCommon>][] = [
      ...tableEntries.map(
        ([t, c]) =>
          [`${t} record`, this.#tables[t], c] as [
            string,
            Map<Handle, ObjectCommon>,
            KeyedChanges<ObjectCommon>,
          ],
      ),
    ];
    if (cs.objects) keyed.push(['object', this.#objects, cs.objects]);
    for (const [label, map, c] of keyed) {
      for (const r of c.removed ?? []) {
        this.#checkCurrentRecord(label, map, r);
        if (freed.has(r.handle)) throw new Error(`${label} ${r.handle} is changed more than once`);
        freed.add(r.handle);
      }
    }

    // Block definitions (M1-75 part 22) travel with their BLOCK_RECORD: one is added only where
    // its record will exist, and goes only with its entities. BLOCK and ENDBLK handles are claimed
    // like any other.
    const blocks = cs.blocks ?? {};
    const removedBlocks = new Set<Handle>();
    for (const d of blocks.removed ?? []) {
      if (removedBlocks.has(d.handle))
        throw new Error(`block ${d.handle} is changed more than once`);
      removedBlocks.add(d.handle);
      this.#checkCurrentBlock(d);
      if (d.beginHandle !== undefined) freed.add(d.beginHandle);
      if (d.endHandle !== undefined) freed.add(d.endHandle);
    }
    const addedBlocks = new Set<Handle>();
    for (const d of blocks.added ?? []) {
      if (addedBlocks.has(d.handle)) throw new Error(`block ${d.handle} is changed more than once`);
      if (this.#blocks.has(d.handle) && !removedBlocks.has(d.handle))
        throw new Error(`block ${d.handle} already exists`);
      addedBlocks.add(d.handle);
      if (d.beginHandle !== undefined) claim(d.beginHandle);
      if (d.endHandle !== undefined) claim(d.endHandle);
    }
    const updatedBlocks = new Set<Handle>();
    for (const { before, after } of blocks.updated ?? []) {
      const h = before.handle;
      if (updatedBlocks.has(h) || removedBlocks.has(h) || addedBlocks.has(h))
        throw new Error(`block ${h} is changed more than once`);
      updatedBlocks.add(h);
      this.#checkCurrentBlock(before);
      if (after.handle !== h) throw new Error(`block ${h}: an update cannot change handle`);
      if (after.beginHandle !== before.beginHandle || after.endHandle !== before.endHandle)
        throw new Error(`block ${h}: an update cannot change its BLOCK or ENDBLK handle`);
    }
    const records = cs.tables?.blockRecords;
    const recordGone = new Set((records?.removed ?? []).map((r) => r.handle));
    const recordNew = new Set((records?.added ?? []).map((r) => r.handle));
    for (const h of addedBlocks) {
      if (!recordNew.has(h) && (!this.#tables.blockRecords.has(h) || recordGone.has(h)))
        throw new Error(`block ${h} has no BLOCK_RECORD`);
    }
    for (const h of recordGone) {
      if (this.#blocks.has(h) && !removedBlocks.has(h) && !recordNew.has(h))
        throw new Error(`block ${h}: its BLOCK_RECORD is removed`);
    }
    const blockExists = (h: Handle): boolean =>
      addedBlocks.has(h) || (this.#blocks.has(h) && !removedBlocks.has(h));

    const updatedIds = new Set<EntityId>();
    for (const { before, after } of ents.updated ?? []) {
      if (removedIds.has(before.id) || updatedIds.has(before.id)) {
        throw new Error(`entity ${before.handle} is changed more than once`);
      }
      updatedIds.add(before.id);
      this.#checkCurrent(before);
      if (after.id !== before.id || after.handle !== before.handle) {
        throw new Error(`entity ${before.handle}: an update cannot change identity`);
      }
      if (after.owner !== before.owner)
        throw new Error(`entity ${before.handle}: an update cannot change owner`);
      if (after.type !== before.type)
        throw new Error(`entity ${before.handle}: an update cannot change type`);
    }

    const addedIds = new Set<EntityId>();
    const room = new Map<Handle, number>();
    for (const { entity } of ents.removed ?? [])
      room.set(entity.owner, (room.get(entity.owner) ?? 0) - 1);
    for (const { entity, index } of [...(ents.added ?? [])].sort((a, b) => a.index - b.index)) {
      if (!blockExists(entity.owner))
        throw new Error(`entity ${entity.handle}: owner block ${entity.owner} does not exist`);
      // A block re-added under the same handle starts empty.
      const list = addedBlocks.has(entity.owner) ? [] : this.#blockEntities.get(entity.owner)!;
      if (addedIds.has(entity.id) || updatedIds.has(entity.id)) {
        throw new Error(`entity ${entity.handle} is changed more than once`);
      }
      addedIds.add(entity.id);
      if (this.ids.idOf(entity.handle) !== entity.id) {
        throw new Error(`id ${entity.id} is not bound to handle ${entity.handle}`);
      }
      claim(entity.handle);
      const size = list.length + (room.get(entity.owner) ?? 0);
      if (!Number.isInteger(index) || index < 0 || index > size) {
        throw new Error(`index ${index} is out of range for block ${entity.owner} (size ${size})`);
      }
      room.set(entity.owner, (room.get(entity.owner) ?? 0) + 1);
    }
    for (const h of removedBlocks) {
      if (this.#blockEntities.get(h)!.length + (room.get(h) ?? 0) !== 0)
        throw new Error(`block ${h} still holds entities`);
    }

    for (const [label, map, c] of keyed) {
      const seen = new Set<Handle>();
      for (const { before, after } of c.updated ?? []) {
        if (seen.has(before.handle) || freed.has(before.handle)) {
          throw new Error(`${label} ${before.handle} is changed more than once`);
        }
        seen.add(before.handle);
        this.#checkCurrentRecord(label, map, before);
        if (after.handle !== before.handle)
          throw new Error(`${label} ${before.handle}: an update cannot change handle`);
      }
      for (const r of c.added ?? []) {
        if (seen.has(r.handle)) throw new Error(`${label} ${r.handle} is changed more than once`);
        claim(r.handle);
      }
    }

    // Layouts (M1-75 parts 20 and 28): a new one sits on a block record that exists once the
    // change set is applied.
    const lays = cs.layouts ?? {};
    const layoutsSeen = new Set<Handle>();
    const once = (h: Handle) => {
      if (layoutsSeen.has(h)) throw new Error(`layout ${h} is changed more than once`);
      layoutsSeen.add(h);
    };
    for (const l of lays.removed ?? []) {
      once(l.handle);
      this.#checkCurrentLayout(l);
      freed.add(l.handle);
    }
    for (const { before, after } of lays.updated ?? []) {
      once(before.handle);
      this.#checkCurrentLayout(before);
      if (after.handle !== before.handle)
        throw new Error(`layout ${before.handle}: an update cannot change handle`);
    }
    for (const l of lays.added ?? []) {
      once(l.handle);
      claim(l.handle);
      const record =
        recordNew.has(l.blockRecord) ||
        (this.#tables.blockRecords.has(l.blockRecord) && !recordGone.has(l.blockRecord));
      if (!record)
        throw new Error(`layout ${l.handle}: its block record ${l.blockRecord} does not exist`);
    }

    const names = new Set<string>();
    for (const { name, before } of cs.header ?? []) {
      if (names.has(name)) throw new Error(`header ${name} is changed more than once`);
      names.add(name);
      if (!sameHeaderValue(this.#header.get(name), before))
        throw new Error(`header ${name} is stale`);
    }

    // Commit. Nothing below can throw.
    this.#removeEntities(ents.removed ?? []);
    for (const { after } of ents.updated ?? []) this.#entities.set(after.id, after);
    for (const [, map, c] of keyed) {
      for (const r of c.removed ?? []) {
        map.delete(r.handle);
        this.#used.delete(r.handle);
      }
      for (const { after } of c.updated ?? []) map.set(after.handle, after);
    }
    for (const d of blocks.removed ?? []) {
      this.#blocks.delete(d.handle);
      this.#blockEntities.delete(d.handle);
      if (d.beginHandle !== undefined) this.#used.delete(d.beginHandle);
      if (d.endHandle !== undefined) this.#used.delete(d.endHandle);
    }
    for (const { after } of blocks.updated ?? []) this.#blocks.set(after.handle, after);
    for (const d of blocks.added ?? []) {
      this.#blocks.set(d.handle, d);
      this.#blockEntities.set(d.handle, []);
      for (const h of [d.beginHandle, d.endHandle]) {
        if (h === undefined) continue;
        this.#used.add(h);
        this.handles.observe(h);
      }
    }
    this.#addEntities(ents.added ?? []);
    for (const [, map, c] of keyed) {
      for (const r of c.added ?? []) {
        map.set(r.handle, r);
        this.#used.add(r.handle);
        this.handles.observe(r.handle);
      }
    }
    if (!emptyLayouts(lays)) {
      for (const l of lays.removed ?? []) {
        this.#layouts.splice(this.#layouts.indexOf(l), 1);
        this.#used.delete(l.handle);
      }
      for (const { after } of lays.updated ?? []) {
        this.#layouts[this.#layouts.findIndex((l) => l.handle === after.handle)] = after;
      }
      for (const l of lays.added ?? []) {
        this.#layouts.push(l);
        this.#used.add(l.handle);
        this.handles.observe(l.handle);
      }
      this.#layouts.sort(byTabOrder);
    }
    for (const { name, after } of cs.header ?? []) {
      if (after === undefined) this.#header.delete(name);
      else this.#header.set(name, after);
    }
    this.#version++;
  }

  #checkCurrent(e: Entity): void {
    const cur = this.#entities.get(e.id);
    if (cur === undefined) throw new Error(`entity ${e.handle} is not in the model`);
    if (cur !== e)
      throw new Error(`entity ${e.handle} is stale (changed since this change set was built)`);
  }

  #checkCurrentLayout(l: Layout): void {
    const cur = this.#layouts.find((x) => x.handle === l.handle);
    if (cur === undefined) throw new Error(`layout ${l.handle} is not in the model`);
    if (cur !== l)
      throw new Error(`layout ${l.handle} is stale (changed since this change set was built)`);
  }

  #checkCurrentBlock(d: BlockDefinition): void {
    const cur = this.#blocks.get(d.handle);
    if (cur === undefined) throw new Error(`block ${d.handle} is not in the model`);
    if (cur !== d)
      throw new Error(`block ${d.handle} is stale (changed since this change set was built)`);
  }

  #checkCurrentRecord(label: string, map: Map<Handle, ObjectCommon>, r: ObjectCommon): void {
    const cur = map.get(r.handle);
    if (cur === undefined) throw new Error(`${label} ${r.handle} is not in the model`);
    if (cur !== r)
      throw new Error(`${label} ${r.handle} is stale (changed since this change set was built)`);
  }

  #removeEntities(removed: readonly PositionedEntity[]): void {
    for (const { entity, index } of [...removed].sort((a, b) => b.index - a.index)) {
      this.#blockEntities.get(entity.owner)!.splice(index, 1);
      this.#entities.delete(entity.id);
      this.#used.delete(entity.handle);
    }
  }

  #addEntities(added: readonly PositionedEntity[]): void {
    for (const { entity, index } of [...added].sort((a, b) => a.index - b.index)) {
      this.#blockEntities.get(entity.owner)!.splice(index, 0, entity.id);
      this.#entities.set(entity.id, entity);
      this.#used.add(entity.handle);
      this.handles.observe(entity.handle);
    }
  }
}
