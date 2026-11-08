// External references (M1-21, FR-B4): loading an xref's drawing into the host.
//
// AutoCAD keeps an attached or overlaid drawing in its own file. The host holds only the xref's
// block record (DXF 70 bit 4, overlay 8) with the path, and the references to it. When the file
// is found, AutoCAD loads it in memory as the content of that block: the xref's model space
// becomes the block's entities, and its symbols come in as xref-dependent records named
// `xref|symbol` (DXF 70 bit 16, resolved bit 32), which the Layer palette lists and the user
// may turn off or freeze. Triya does the same with a ChangeSet, so every replica and the
// spatial index see the content as they see any block's, and the save leaves it out again.
//
// AutoCAD rules encoded here (AutoCAD 2024 help, "About Attaching Drawing References (Xrefs)",
// "About Xref-Dependent Named Objects"):
// - Layer 0 and DEFPOINTS of the xref are the host's (objects on 0 take the reference's
//   layer, as in any block); the linetypes BYLAYER, BYBLOCK and CONTINUOUS are the host's.
// - Every other layer, linetype, text style, dimension style, other style and block comes in
//   as `name|symbol`. A host record of that name already there (VISRETAIN keeps the xref
//   layers' settings in the host file) is used as it is, which is how the host's overrides of
//   the xref's layers last from one load to the next.
// - A nested attached xref keeps its own name and path and is loaded as an xref of its own; a
//   nested overlay is not loaded at all ("overlays are ignored when the drawing is attached
//   or overlaid as an xref"), so its references inside the xref draw nothing.
// - Only the xref's model space comes in; its layouts never do.
// The xref's block keeps the base point the host file stores (what AutoCAD wrote from the
// xref's INSBASE when it last loaded it); an INSBASE changed since moves the xref in AutoCAD
// when it reloads, which is left for RELOAD (M5-04).

import type { ChangeSet, KeyedChanges, PositionedEntity } from './changeset';
import { DocumentModel, type DocumentInit } from './document';
import { isHandle, compareHandles, type Handle } from './handle';
import type {
  BlockDefinition,
  BlockTableRecord,
  Entity,
  EntityInit,
  NonGraphicalObject,
  ObjectCommon,
  TableName,
  TableRecords,
  SortEntsTable,
  SymbolTableRecord,
} from './types';
import { createEntity, createRecord, deepFreeze } from './update';

/** DXF 70 of a BLOCK and its record: xref, overlay, xref-dependent, resolved. */
export const XREF_FLAG = 4;
export const XREF_OVERLAY_FLAG = 8;
const DEPENDENT_FLAG = 16;
const RESOLVED_FLAG = 32;

/** Whether a block record is an xref's (attached or overlaid). */
export function isXrefRecord(r: SymbolTableRecord | undefined): boolean {
  return r !== undefined && ((r.flags ?? 0) & (XREF_FLAG | XREF_OVERLAY_FLAG)) !== 0;
}

/** The tables whose records an xref brings in. Views, UCSs, VPORTs and app ids stay home. */
const COPIED_TABLES: readonly TableName[] = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'mleaderStyles',
  'tableStyles',
  'mlineStyles',
  'blockRecords',
];

/** The objects that drawing the xref needs: draw order, image and PDF definitions, XCLIPs. */
const COPIED_OBJECTS = new Set(['SORTENTSTABLE', 'IMAGEDEF', 'PDFDEFINITION', 'SPATIAL_FILTER']);

/** Records that are the host's own whatever the xref holds (see the rules above). */
const SHARED_NAMES: Partial<Record<TableName, ReadonlySet<string>>> = {
  layers: new Set(['0', 'DEFPOINTS']),
  linetypes: new Set(['BYLAYER', 'BYBLOCK', 'CONTINUOUS']),
};

/**
 * Every field of the model's records, entities and objects that holds a handle (types.ts). A
 * string under one of these keys is a handle of the xref and is renumbered; xdata is carried as
 * it is (its 1005 handles are application data).
 */
const HANDLE_KEYS = new Set([
  'handle',
  'owner',
  'layer',
  'linetype',
  'style',
  'textStyle',
  'block',
  'annotation',
  'arrowhead',
  'definition',
  'clipBoundary',
  'frozenLayers',
  'visualStyle',
  'sources',
  'plotStyle',
  'material',
  'layout',
  'beginHandle',
  'endHandle',
  'dynamicOf',
  'blockRecord',
  'entity',
  'sort',
  'entities',
  'geometry',
  'dimension',
  'insert',
  'scale',
  'appId',
  'reactors',
  'extDict',
]);

const SPACE = /^\*(model|paper)_space\d*$/i;
const isModelSpace = (name: string) => name.toUpperCase() === '*MODEL_SPACE';

/**
 * A copy of `value` with the xref's handles renumbered by `map`. A handle the load leaves out
 * (a layout, a dictionary, an overlay's block) is dropped with its key.
 */
function renumber<T>(value: T, map: ReadonlyMap<Handle, Handle>): T {
  const walk = (v: unknown, key: string | undefined): unknown => {
    if (typeof v === 'string') {
      if (key === undefined || !HANDLE_KEYS.has(key) || v === '0' || !isHandle(v)) return v;
      return map.get(v);
    }
    if (Array.isArray(v)) {
      const handles = key !== undefined && HANDLE_KEYS.has(key);
      const out: unknown[] = [];
      for (const item of v) {
        const w = walk(item, handles ? key : undefined);
        if (w !== undefined) out.push(w);
      }
      return out;
    }
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v)) {
      // The xref's original objects stay in its own file; xdata is application data.
      if (k === 'raw') continue;
      const w = k === 'xdata' ? item : walk(item, k);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return walk(value, undefined) as T;
}

/** Every value under a `handle` key, at any depth. */
function collectHandles(v: unknown, out: Handle[]): void {
  if (Array.isArray(v)) for (const item of v) collectHandles(item, out);
  else if (typeof v === 'object' && v !== null && !ArrayBuffer.isView(v)) {
    for (const [k, item] of Object.entries(v)) {
      if (k === 'handle' && typeof item === 'string' && isHandle(item)) out.push(item);
      else if (k !== 'xdata') collectHandles(item, out);
    }
  }
}

/** Why an xref cannot be loaded into `block`, or undefined. */
export function xrefLoadProblem(model: DocumentModel, block: Handle): string | undefined {
  const record = model.tables.blockRecords.get(block);
  const def = model.blocks.get(block);
  if (!record || !def) return `No block ${block}.`;
  if (!isXrefRecord(record)) return `${record.name} is not an external reference.`;
  if (def.xrefLoaded) return `${record.name} is already loaded.`;
  return undefined;
}

/**
 * The ChangeSet that loads `drawing` (the xref's file, as the importer maps it) as the content
 * of the host's xref block `block`. Handles come from the host's allocator, in the xref's own
 * handle order, so the content keeps its draw order and SORTENTS order. Throws when
 * `xrefLoadProblem` names a reason.
 */
export function xrefLoadChange(
  model: DocumentModel,
  block: Handle,
  drawing: DocumentInit,
): ChangeSet {
  const problem = xrefLoadProblem(model, block);
  if (problem) throw new Error(problem);
  const xrefRecord = model.tables.blockRecords.get(block)!;
  const xrefDef = model.blocks.get(block)!;
  const prefix = `${xrefRecord.name}|`;

  // ── Which of the xref's handles come in, and as what ──────────────────────────────────────
  const map = new Map<Handle, Handle>();
  /** The xref's handles that become new host objects. */
  const fresh: Handle[] = [];
  const records = new Map<TableName, { record: ObjectCommon; name: string; flags: number }[]>();
  const hostByName = (table: TableName, name: string): Handle | undefined => {
    const upper = name.toUpperCase();
    for (const r of model.tables[table].values())
      if ((r as SymbolTableRecord).name.toUpperCase() === upper) return r.handle;
    return undefined;
  };
  let modelSpace: Handle | undefined;
  for (const table of COPIED_TABLES) {
    const list: { record: ObjectCommon; name: string; flags: number }[] = [];
    for (const r of (drawing.tables?.[table] ?? []) as readonly SymbolTableRecord[]) {
      const flags = r.flags ?? 0;
      if (table === 'blockRecords') {
        if (isModelSpace(r.name)) {
          modelSpace = r.handle;
          map.set(r.handle, block);
          continue;
        }
        // Layouts stay in the xref, and so do its overlays (they are never loaded nested).
        if (SPACE.test(r.name) || flags & XREF_OVERLAY_FLAG) continue;
      }
      // A nested xref keeps its own name, and so does a symbol that already belongs to one
      // (`nested|layer`, kept by the xref's own VISRETAIN).
      const own =
        SHARED_NAMES[table]?.has(r.name.toUpperCase()) ||
        (table === 'blockRecords' && flags & XREF_FLAG) ||
        r.name.includes('|');
      const name = own ? r.name : prefix + r.name;
      const existing = hostByName(table, name);
      if (existing !== undefined) {
        map.set(r.handle, existing);
        continue;
      }
      fresh.push(r.handle);
      list.push({ record: r, name, flags: own ? flags : flags | DEPENDENT_FLAG | RESOLVED_FLAG });
    }
    records.set(table, list);
  }
  if (modelSpace === undefined)
    throw new Error(`${xrefRecord.name}: the drawing has no model space.`);
  const copiedBlocks = new Set((records.get('blockRecords') ?? []).map((r) => r.record.handle));
  const owners = new Set([modelSpace, ...copiedBlocks]);
  const entities = (drawing.entities ?? []).filter((e) => owners.has(e.owner));
  // An entity's own handle and those of what it carries (an INSERT's ATTRIBs, annotation
  // representations).
  for (const e of entities) collectHandles(e, fresh);
  const objects = (drawing.objects ?? []).filter((o) => COPIED_OBJECTS.has(o.type));
  for (const o of objects) {
    fresh.push(o.handle);
    // A sort handle is an ordering key, often no object's: it is renumbered with the rest.
    for (const x of (o as Partial<SortEntsTable>).entries ?? []) fresh.push(x.sort);
  }

  // Host handles in the xref's handle order: SORTENTS sort handles and the plain draw order
  // compare the same afterwards.
  fresh.sort(compareHandles);
  const added: Handle[] = [];
  for (const h of fresh) {
    if (map.has(h)) continue;
    const to = model.handles.allocate();
    map.set(h, to);
    added.push(to);
  }

  // ── The change set ────────────────────────────────────────────────────────────────────────
  const tables: { [K in TableName]?: KeyedChanges<TableRecords[K]> } = {};
  for (const [table, list] of records) {
    if (list.length === 0) continue;
    const out = list.map(({ record, name, flags }) => {
      const r = renumber(record, map) as SymbolTableRecord;
      const { flags: _old, ...rest } = r;
      return createRecord({ ...rest, name, ...(flags ? { flags } : {}) });
    });
    (tables as Record<string, KeyedChanges<ObjectCommon>>)[table] = { added: out };
  }
  const defs = new Map((drawing.blocks ?? []).map((b) => [b.handle, b]));
  const blocks: BlockDefinition[] = [];
  for (const { record, name } of records.get('blockRecords') ?? []) {
    const d = defs.get(record.handle) ?? { handle: record.handle, name, basePoint: { x: 0, y: 0 } };
    // BLOCK and ENDBLK are the xref's own file's.
    const { beginHandle: _b, endHandle: _e, ...rest } = renumber(d, map);
    blocks.push(createRecord({ ...rest, name }));
  }

  const positioned: PositionedEntity[] = [];
  const next = new Map<Handle, number>();
  for (const e of entities) {
    const init = renumber<EntityInit>(e, map);
    // An entity on a layer the load left out cannot draw (a damaged xref).
    if (init.layer === undefined) continue;
    // A reference to an overlay (or a block left out) draws nothing.
    if (init.geom.kind === 'INSERT' && init.geom.block === undefined) continue;
    const owner = init.owner;
    const index =
      next.get(owner) ?? (model.hasBlock(owner) ? model.blockEntities(owner).length : 0);
    next.set(owner, index + 1);
    const entity: Entity = createEntity(model.ids.assign(init.handle), init);
    positioned.push({ entity, index });
  }

  const newObjects: NonGraphicalObject[] = [];
  for (const o of objects) {
    const r = renumber(o, map) as NonGraphicalObject & {
      entries?: readonly { entity?: Handle; sort?: Handle }[];
      block?: Handle;
      insert?: Handle;
      definition?: Handle;
    };
    // An object whose subject did not come in is left out.
    if (o.type === 'SORTENTSTABLE' && r.block === undefined) continue;
    if (o.type === 'SPATIAL_FILTER' && r.insert === undefined) continue;
    const entries = r.entries?.filter((x) => x.entity !== undefined && x.sort !== undefined);
    newObjects.push(
      createRecord({
        ...r,
        // Its dictionary stays in the xref's file: the xref's block owns it here.
        owner: r.owner ?? block,
        ...(entries ? { entries } : {}),
      }),
    );
  }

  const after = deepFreeze({ ...xrefDef, xrefLoaded: added });
  return {
    ...(Object.keys(tables).length ? { tables: tables as NonNullable<ChangeSet['tables']> } : {}),
    blocks: { added: blocks, updated: [{ before: xrefDef, after }] },
    ...(positioned.length ? { entities: { added: positioned } } : {}),
    ...(newObjects.length ? { objects: { added: newObjects } } : {}),
  };
}

/** Every handle loaded xrefs added to the model. */
export function loadedXrefHandles(model: DocumentModel): Set<Handle> {
  const out = new Set<Handle>();
  for (const b of model.blocks.values()) for (const h of b.xrefLoaded ?? []) out.add(h);
  return out;
}

/**
 * The model as it would be with no xref loaded: what a save writes (FR-B4: xrefs are
 * read-only, their content lives in their own files). The same model when none is loaded.
 * `$HANDSEED` stays where the loads took it, as AutoCAD's does.
 */
export function withoutXrefContent(model: DocumentModel): DocumentModel {
  const loaded = loadedXrefHandles(model);
  if (loaded.size === 0) return model;
  const keep = <T extends ObjectCommon>(m: ReadonlyMap<Handle, T>): T[] =>
    [...m.values()].filter((r) => !loaded.has(r.handle));
  const tables = Object.fromEntries(
    Object.entries(model.tables).map(([k, m]) => [k, keep(m as ReadonlyMap<Handle, ObjectCommon>)]),
  ) as NonNullable<DocumentInit['tables']>;
  const blocks = keep(model.blocks).map((b) => {
    if (!b.xrefLoaded) return b;
    const { xrefLoaded: _l, ...rest } = b;
    return rest;
  });
  const entities: EntityInit[] = [];
  for (const b of blocks) {
    for (const id of model.blockEntities(b.handle)) {
      const { id: _id, ...e } = model.entity(id)!;
      if (!loaded.has(e.handle)) entities.push(e);
    }
  }
  return DocumentModel.create({
    meta: model.meta,
    handSeed: model.handSeed,
    header: model.header,
    tables,
    blocks,
    layouts: model.layouts,
    objects: keep(model.objects),
    passthrough: [...model.passthrough],
    entities,
  });
}

/** The xref block records of a model that point at a file but hold nothing yet. */
export function unloadedXrefs(model: DocumentModel): BlockTableRecord[] {
  const out: BlockTableRecord[] = [];
  for (const r of model.tables.blockRecords.values()) {
    if (isXrefRecord(r) && !model.blocks.get(r.handle)?.xrefLoaded) out.push(r);
  }
  return out;
}
