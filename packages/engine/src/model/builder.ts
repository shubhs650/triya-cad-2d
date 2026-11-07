// ChangeSetBuilder: how commands produce change sets (ARCHITECTURE.md §5.1).
//
// A command records what it wants against a working view of the model (`entity`,
// `blockEntities`), then `build()` turns that into a ChangeSet with the before versions and
// block positions filled in. Repeated edits to the same object fold together: one change per
// object, with the "before" taken from the model and the "after" from the last edit.
//
// Handles are allocated as soon as an object is added, so a command can reference a new
// object's handle immediately. If the command is cancelled the handles are simply skipped,
// as AutoCAD does.

import type {
  ChangeSet,
  EntityChanges,
  HeaderChange,
  KeyedChanges,
  PositionedEntity,
  Replacement,
  TableChanges,
} from './changeset';
import type { DocumentModel } from './document';
import type { EntityId } from './entity-ids';
import type { Handle } from './handle';
import type {
  BlockDefinition,
  BlockTableRecord,
  Entity,
  EntityGeometry,
  EntityProps,
  HeaderValue,
  Layout,
  NonGraphicalObject,
  ObjectCommon,
  TableName,
  TableRecords,
} from './types';
import type { Vec2 } from '../geom/types';
import {
  createEntity,
  createRecord,
  deepFreeze,
  updateEntity,
  updateRecord,
  type EntityPatch,
  type RecordPatch,
} from './update';

/** A new entity: owner, layer and geometry are required; other properties default to ByLayer. */
export type NewEntity = {
  readonly owner: Handle;
  readonly layer: Handle;
  readonly geom: EntityGeometry;
} & Partial<Omit<EntityProps, 'layer'> & Omit<ObjectCommon, 'handle'>>;

/**
 * A new block definition (BLOCK): its name and base point, and its record's units and
 * Allow exploding / Scale uniformly settings, which default as AutoCAD's BLOCK dialog does
 * (unitless, explodable, any scale). `flags` is the BLOCK entity's DXF 70 (1 anonymous).
 */
export interface NewBlock {
  readonly name: string;
  readonly basePoint: Vec2;
  readonly flags?: number;
  readonly units?: number;
  readonly explodable?: boolean;
  readonly scalable?: boolean;
}

/** LAYOUT New: the tab; the builder makes the `*Paper_Space` block that holds its sheet. */
export interface NewLayout {
  readonly name: string;
  /** The tab's place; omitted, after the last layout. */
  readonly tabOrder?: number;
  /** DXF 70: 1 PSLTSCALE, 2 LIMCHECK; omitted, 1. */
  readonly flags?: number;
  readonly limits?: Layout['limits'];
  readonly plot?: Layout['plot'];
}

/** A layout's sheet block: `*Paper_Space` (the current layout's) or `*Paper_Space` and a number. */
const PAPER_SPACE = /^\*paper_space(\d*)$/i;
const MODEL_SPACE = '*MODEL_SPACE';

function sameValue(a: HeaderValue | undefined, b: HeaderValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Pending changes to one handle-keyed collection. */
class KeyedDraft<T extends ObjectCommon> {
  readonly #added = new Map<Handle, T>();
  readonly #updated = new Map<Handle, Replacement<T>>();
  readonly #removed = new Map<Handle, T>();

  constructor(
    readonly label: string,
    readonly source: ReadonlyMap<Handle, T>,
  ) {}

  get(handle: Handle): T | undefined {
    return (
      this.#added.get(handle) ??
      this.#updated.get(handle)?.after ??
      (this.#removed.has(handle) ? undefined : this.source.get(handle))
    );
  }

  add(record: T): void {
    this.#added.set(record.handle, record);
  }

  update(handle: Handle, patch: RecordPatch<T>): T {
    const cur = this.#require(handle);
    const next = updateRecord(cur, patch);
    if (this.#added.has(handle)) this.#added.set(handle, next);
    else
      this.#updated.set(handle, { before: this.#updated.get(handle)?.before ?? cur, after: next });
    return next;
  }

  remove(handle: Handle): void {
    this.#require(handle);
    if (this.#added.delete(handle)) return;
    this.#updated.delete(handle);
    this.#removed.set(handle, this.source.get(handle)!);
  }

  changes(): KeyedChanges<T> | undefined {
    if (!this.#added.size && !this.#updated.size && !this.#removed.size) return undefined;
    return {
      added: [...this.#added.values()],
      updated: [...this.#updated.values()],
      removed: [...this.#removed.values()],
    };
  }

  #require(handle: Handle): T {
    const cur = this.get(handle);
    if (cur === undefined) throw new Error(`${this.label} ${handle} does not exist`);
    return cur;
  }
}

export class ChangeSetBuilder {
  readonly #model: DocumentModel;
  /** New entities and moved entities' new versions, in insertion order (= append order). */
  readonly #added = new Map<EntityId, Entity>();
  readonly #updated = new Map<EntityId, Replacement<Entity>>();
  /** Original versions of removed (or moved) model entities. */
  readonly #removed = new Map<EntityId, Entity>();
  readonly #header = new Map<string, HeaderChange>();
  readonly #objects: KeyedDraft<NonGraphicalObject>;
  readonly #tables = new Map<TableName, KeyedDraft<ObjectCommon>>();
  #layouts: KeyedDraft<Layout> | undefined;
  /** Layouts this builder added, in order (the draft keeps no list of them). */
  readonly #addedLayouts: Handle[] = [];
  readonly #blocks: KeyedDraft<BlockDefinition>;
  #built = false;

  constructor(model: DocumentModel) {
    this.#model = model;
    this.#objects = new KeyedDraft('object', model.objects);
    this.#blocks = new KeyedDraft('block', model.blocks);
  }

  // ── Working view ────────────────────────────────────────────────────────────────────────

  /** The entity as it will be after this change set, or undefined if it will not exist. */
  entity(id: EntityId): Entity | undefined {
    return (
      this.#added.get(id) ??
      this.#updated.get(id)?.after ??
      (this.#removed.has(id) ? undefined : this.#model.entity(id))
    );
  }

  /** The block's entities as they will be after this change set. */
  blockEntities(block: Handle): EntityId[] {
    if (!this.#blocks.get(block)) throw new Error(`owner block ${block} does not exist`);
    const own = this.#model.hasBlock(block) ? this.#model.blockEntities(block) : [];
    const out = own.filter((id) => !this.#removed.has(id));
    for (const e of this.#added.values()) if (e.owner === block) out.push(e.id);
    return out;
  }

  /** The block definition as it will be after this change set. */
  block(handle: Handle): BlockDefinition | undefined {
    return this.#blocks.get(handle);
  }

  object(handle: Handle): NonGraphicalObject | undefined {
    return this.#objects.get(handle);
  }

  layout(handle: Handle): Layout | undefined {
    return this.#layoutDraft().get(handle);
  }

  tableRecord<K extends TableName>(table: K, handle: Handle): TableRecords[K] | undefined {
    return this.#table(table).get(handle) as TableRecords[K] | undefined;
  }

  // ── Entities ────────────────────────────────────────────────────────────────────────────

  addEntity(draft: NewEntity): Entity {
    this.#open();
    if (!this.#blocks.get(draft.owner))
      throw new Error(`owner block ${draft.owner} does not exist`);
    const handle = this.#model.handles.allocate();
    const entity = createEntity(this.#model.ids.assign(handle), {
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
      ...draft,
      handle,
      type: draft.geom.kind,
    });
    this.#added.set(entity.id, entity);
    return entity;
  }

  updateEntity(id: EntityId, patch: EntityPatch): Entity {
    this.#open();
    const cur = this.#requireEntity(id);
    const next = updateEntity(cur, patch);
    if (this.#added.has(id)) this.#added.set(id, next);
    else this.#updated.set(id, { before: this.#updated.get(id)?.before ?? cur, after: next });
    return next;
  }

  removeEntity(id: EntityId): void {
    this.#open();
    this.#requireEntity(id);
    // A pending addition just disappears; if it was a move, the original's removal stays.
    if (this.#added.delete(id)) return;
    this.#updated.delete(id);
    this.#removed.set(id, this.#model.entity(id)!);
  }

  /** Moves an entity to another block (appended), keeping its handle and id. */
  moveEntity(id: EntityId, owner: Handle): Entity {
    this.#open();
    const cur = this.#requireEntity(id);
    if (!this.#blocks.get(owner)) throw new Error(`owner block ${owner} does not exist`);
    if (!this.#added.has(id)) {
      this.#updated.delete(id);
      this.#removed.set(id, this.#model.entity(id)!);
    }
    this.#added.delete(id);
    const moved = createEntity(id, { ...cur, owner });
    this.#added.set(id, moved);
    return moved;
  }

  // ── Header, objects, tables ─────────────────────────────────────────────────────────────

  setHeader(name: string, value: HeaderValue | undefined): void {
    this.#open();
    const before = this.#header.has(name)
      ? this.#header.get(name)!.before
      : this.#model.header.get(name);
    this.#header.set(name, {
      name,
      before,
      after: value === undefined ? undefined : deepFreeze(value),
    });
  }

  addObject(init: Omit<NonGraphicalObject, 'handle'>): NonGraphicalObject {
    this.#open();
    const record = createRecord({ ...init, handle: this.#model.handles.allocate() });
    this.#objects.add(record);
    return record;
  }

  updateObject(handle: Handle, patch: RecordPatch<NonGraphicalObject>): NonGraphicalObject {
    this.#open();
    return this.#objects.update(handle, patch);
  }

  removeObject(handle: Handle): void {
    this.#open();
    this.#objects.remove(handle);
  }

  addTableRecord<K extends TableName>(
    table: K,
    init: Omit<TableRecords[K], 'handle'>,
  ): TableRecords[K] {
    this.#open();
    const record = createRecord({
      ...init,
      handle: this.#model.handles.allocate(),
    } as TableRecords[K]);
    this.#table(table).add(record);
    return record;
  }

  updateTableRecord<K extends TableName>(
    table: K,
    handle: Handle,
    patch: RecordPatch<TableRecords[K]>,
  ): TableRecords[K] {
    this.#open();
    return this.#table(table).update(handle, patch as RecordPatch<ObjectCommon>) as TableRecords[K];
  }

  removeTableRecord(table: TableName, handle: Handle): void {
    this.#open();
    this.#table(table).remove(handle);
  }

  /** Renames, reorders or edits a layout. */
  updateLayout(handle: Handle, patch: RecordPatch<Layout>): Layout {
    this.#open();
    return this.#layoutDraft().update(handle, patch);
  }

  /**
   * Adds a layout (LAYOUT New) with the block that holds its sheet: a record and definition named
   * `*Paper_Space` and the lowest number no block has had, as AutoCAD names them, linked to the
   * layout, base point at the origin. The record's handle is allocated first.
   */
  addLayout(init: NewLayout): Layout {
    this.#open();
    // A name the same change set frees stays taken: the saved file drops the old block only
    // after it adds the new ones.
    const taken = new Set<number>();
    const records = this.#table('blockRecords');
    const names = [
      ...[...this.#model.tables.blockRecords.values()].map((r) => r.name),
      ...this.#addedRecords().map((h) => this.tableRecord('blockRecords', h)?.name ?? ''),
    ];
    for (const name of names) {
      const n = PAPER_SPACE.exec(name)?.[1];
      if (n) taken.add(Number(n));
    }
    let n = 0;
    while (taken.has(n)) n++;
    const name = `*Paper_Space${n}`;
    const block = this.#model.handles.allocate();
    const handle = this.#model.handles.allocate();
    records.add(
      createRecord<BlockTableRecord>({
        handle: block,
        name,
        layout: handle,
        units: 0,
        explodable: true,
        scalable: true,
      }),
    );
    this.#blocks.add(
      createRecord<BlockDefinition>({ handle: block, name, basePoint: { x: 0, y: 0 } }),
    );
    const draft = this.#layoutDraft();
    const last = Math.max(0, ...[...this.#layoutHandles()].map((h) => draft.get(h)?.tabOrder ?? 0));
    const layout = createRecord<Layout>({
      handle,
      name: init.name,
      tabOrder: init.tabOrder ?? last + 1,
      blockRecord: block,
      // PSLTSCALE on and LIMCHECK off unless given: the two variables' AutoCAD defaults.
      flags: init.flags ?? 1,
      ...(init.limits ? { limits: init.limits } : {}),
      ...(init.plot ? { plot: init.plot } : {}),
    });
    draft.add(layout);
    this.#addedLayouts.push(handle);
    return layout;
  }

  /**
   * Removes a layout (LAYOUT Delete) with its block record, definition and everything on its
   * sheet; the tabs after it move up. The Model layout cannot go.
   */
  removeLayout(handle: Handle): void {
    this.#open();
    const draft = this.#layoutDraft();
    const layout = draft.get(handle);
    if (!layout) throw new Error(`layout ${handle} does not exist`);
    const block = layout.blockRecord;
    if (this.tableRecord('blockRecords', block)?.name.toUpperCase() === MODEL_SPACE)
      throw new Error(`layout ${handle}: the Model layout cannot be removed`);
    draft.remove(handle);
    // The tabs after it move up one, as AutoCAD keeps them numbered 1 to N.
    for (const h of this.#layoutHandles()) {
      const l = draft.get(h);
      if (l && l.tabOrder > layout.tabOrder) draft.update(h, { tabOrder: l.tabOrder - 1 });
    }
    if (!this.#blocks.get(block)) return;
    for (const id of this.blockEntities(block)) this.removeEntity(id);
    this.removeBlock(block);
  }

  // ── Blocks ──────────────────────────────────────────────────────────────────────────────

  /** Adds a block definition and its BLOCK_RECORD under one new handle (BLOCK). */
  addBlock(init: NewBlock): BlockDefinition {
    this.#open();
    const handle = this.#model.handles.allocate();
    const record: BlockTableRecord = {
      handle,
      name: init.name,
      ...(init.flags ? { flags: init.flags } : {}),
      units: init.units ?? 0,
      explodable: init.explodable ?? true,
      scalable: init.scalable ?? true,
    };
    this.#table('blockRecords').add(createRecord(record));
    const def = createRecord<BlockDefinition>({
      handle,
      name: init.name,
      basePoint: init.basePoint,
    });
    this.#blocks.add(def);
    return def;
  }

  /** Edits a block definition; a new name renames its BLOCK_RECORD too (RENAME). */
  updateBlock(handle: Handle, patch: RecordPatch<BlockDefinition>): BlockDefinition {
    this.#open();
    const next = this.#blocks.update(handle, patch);
    if (patch.name !== undefined)
      this.updateTableRecord('blockRecords', handle, { name: patch.name });
    return next;
  }

  /** Removes an empty block definition and its BLOCK_RECORD (PURGE). */
  removeBlock(handle: Handle): void {
    this.#open();
    if (!this.#blocks.get(handle)) throw new Error(`block ${handle} does not exist`);
    if (this.blockEntities(handle).length > 0)
      throw new Error(`block ${handle} still holds entities`);
    this.#blocks.remove(handle);
    this.#table('blockRecords').remove(handle);
  }

  // ── Result ──────────────────────────────────────────────────────────────────────────────

  build(): ChangeSet {
    this.#open();
    this.#built = true;
    const cs: {
      entities?: EntityChanges;
      tables?: TableChanges;
      objects?: KeyedChanges<NonGraphicalObject>;
      blocks?: KeyedChanges<BlockDefinition>;
      header?: readonly HeaderChange[];
      layouts?: KeyedChanges<Layout>;
    } = {};

    const entities = this.#entityChanges();
    if (entities) cs.entities = entities;
    const tables: Record<string, KeyedChanges<ObjectCommon>> = {};
    for (const [name, draft] of this.#tables) {
      const c = draft.changes();
      if (c) tables[name] = c;
    }
    if (Object.keys(tables).length) cs.tables = tables as TableChanges;
    const objects = this.#objects.changes();
    if (objects) cs.objects = objects;
    const blocks = this.#blocks.changes();
    if (blocks) cs.blocks = blocks;
    const header = [...this.#header.values()].filter((h) => !sameValue(h.before, h.after));
    if (header.length) cs.header = header;
    const layouts = this.#layouts?.changes();
    if (layouts) cs.layouts = layouts;
    return cs;
  }

  #entityChanges(): EntityChanges | undefined {
    if (!this.#added.size && !this.#updated.size && !this.#removed.size) return undefined;
    // Positions before the change: one pass over each block that loses entities.
    const removedBy = new Map<Handle, number>();
    const removed: PositionedEntity[] = [];
    const byOwner = new Map<Handle, Entity[]>();
    for (const e of this.#removed.values()) {
      const list = byOwner.get(e.owner) ?? [];
      list.push(e);
      byOwner.set(e.owner, list);
    }
    for (const [owner, list] of byOwner) {
      const ids = this.#model.blockEntities(owner);
      const pos = new Map<EntityId, number>();
      ids.forEach((id, i) => pos.set(id, i));
      for (const entity of list) removed.push({ entity, index: pos.get(entity.id)! });
      removedBy.set(owner, list.length);
    }
    // Positions after the change: additions are appended in the order they were made.
    const next = new Map<Handle, number>();
    const added: PositionedEntity[] = [];
    for (const entity of this.#added.values()) {
      const before = this.#model.hasBlock(entity.owner)
        ? this.#model.blockEntities(entity.owner).length
        : 0;
      const index = next.get(entity.owner) ?? before - (removedBy.get(entity.owner) ?? 0);
      added.push({ entity, index });
      next.set(entity.owner, index + 1);
    }
    return { added, updated: [...this.#updated.values()], removed };
  }

  /** Every layout handle the change set may hold: the model's and those added. */
  #layoutHandles(): Handle[] {
    return [...this.#model.layouts.map((l) => l.handle), ...this.#addedLayouts];
  }

  /** Block records added so far. */
  #addedRecords(): Handle[] {
    return (this.#tables.get('blockRecords')?.changes()?.added ?? []).map((r) => r.handle);
  }

  #layoutDraft(): KeyedDraft<Layout> {
    this.#layouts ??= new KeyedDraft(
      'layout',
      new Map(this.#model.layouts.map((l) => [l.handle, l])),
    );
    return this.#layouts;
  }

  #table(table: TableName): KeyedDraft<ObjectCommon> {
    let draft = this.#tables.get(table);
    if (!draft) {
      draft = new KeyedDraft(`${table} record`, this.#model.tables[table]);
      this.#tables.set(table, draft);
    }
    return draft;
  }

  #requireEntity(id: EntityId): Entity {
    const cur = this.entity(id);
    if (cur === undefined) throw new Error(`entity ${id} does not exist`);
    return cur;
  }

  #open(): void {
    if (this.#built) throw new Error('this ChangeSetBuilder was already built; start a new one');
  }
}
